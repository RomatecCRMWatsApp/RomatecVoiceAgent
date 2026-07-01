// v3.78.0 — VTO · Checklist de Atividades da Obra (Gestão de Obra).
// Idempotente (CREATE TABLE IF NOT EXISTS + seed via INSERT IGNORE). Roda no boot.
//
// Adaptação ao repo: `colaborador_id` é VARCHAR(64) (guarda o `sub` do JWT),
// não INT — o subject do token pode não ser numérico.
import pool from './connection';
import { VTO_CATALOGO } from '../data/vtoCatalogo';

async function exec(sql: string, tag: string): Promise<void> {
  try {
    await pool.execute(sql);
    console.log(`[vto-checklist-migrations] OK: ${tag}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === 'ER_TABLE_EXISTS_ERROR' || code === 'ER_DUP_FIELDNAME' || code === 'ER_DUP_KEYNAME') {
      console.log(`[vto-checklist-migrations] ja existe (OK): ${tag}`);
    } else {
      console.warn(`[vto-checklist-migrations] aviso (${tag}):`, (err as Error).message.slice(0, 160));
    }
  }
}

export async function runVtoChecklistMigrations(): Promise<void> {
  await exec(`
    CREATE TABLE IF NOT EXISTS vto_atividades_catalogo (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      disciplina_ordem  SMALLINT UNSIGNED NOT NULL,
      disciplina_nome   VARCHAR(120) NOT NULL,
      atividade         VARCHAR(180) NOT NULL,
      atividade_ordem   SMALLINT UNSIGNED NOT NULL,
      ativo             TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      KEY idx_disc (disciplina_ordem, atividade_ordem),
      UNIQUE KEY uq_item (disciplina_ordem, atividade)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE vto_atividades_catalogo');

  await exec(`
    CREATE TABLE IF NOT EXISTS vto_checklist (
      id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
      colaborador_id       VARCHAR(64) NOT NULL,
      obra_id              INT UNSIGNED NULL,
      numero_vto           VARCHAR(40) NULL,
      obra_nome            VARCHAR(180) NOT NULL,
      cliente              VARCHAR(180) NULL,
      endereco             VARCHAR(240) NULL,
      cidade_uf            VARCHAR(120) NULL,
      data_vistoria        DATE NULL,
      etapa                VARCHAR(120) NULL,
      responsavel_tecnico  VARCHAR(200) NOT NULL DEFAULT 'José Romário Pinto Bezerra — Téc. Edificações / Agrimensura',
      art_trt              VARCHAR(80) NULL,
      observacoes_gerais   TEXT NULL,
      pendencias           TEXT NULL,
      proxima_vistoria     VARCHAR(120) NULL,
      percentual_fisico    DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      status               ENUM('rascunho','finalizado','enviado') NOT NULL DEFAULT 'rascunho',
      hash_validacao       CHAR(64) NULL,
      created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_colab (colaborador_id),
      KEY idx_obra (obra_id),
      KEY idx_hash (hash_validacao)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE vto_checklist');

  await exec(`
    CREATE TABLE IF NOT EXISTS vto_checklist_itens (
      id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
      checklist_id      INT UNSIGNED NOT NULL,
      disciplina_ordem  SMALLINT UNSIGNED NOT NULL,
      disciplina_nome   VARCHAR(120) NOT NULL,
      atividade         VARCHAR(180) NOT NULL,
      atividade_ordem   SMALLINT UNSIGNED NOT NULL,
      status            ENUM('nao_iniciado','iniciado','em_andamento','concluido') NOT NULL DEFAULT 'nao_iniciado',
      comodo_local      VARCHAR(160) NULL,
      metros_quadrados  DECIMAL(10,2) NULL,
      observacao        VARCHAR(400) NULL,
      PRIMARY KEY (id),
      KEY idx_checklist (checklist_id),
      CONSTRAINT fk_item_checklist FOREIGN KEY (checklist_id)
        REFERENCES vto_checklist(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE vto_checklist_itens');

  // Seed idempotente do catálogo (INSERT IGNORE respeitando uq_item).
  try {
    if (VTO_CATALOGO.length) {
      const placeholders = VTO_CATALOGO.map(() => '(?, ?, ?, ?, 1)').join(', ');
      const params: (string | number)[] = [];
      for (const it of VTO_CATALOGO) {
        params.push(it.disciplina_ordem, it.disciplina_nome, it.atividade, it.atividade_ordem);
      }
      await pool.execute(
        `INSERT IGNORE INTO vto_atividades_catalogo
           (disciplina_ordem, disciplina_nome, atividade, atividade_ordem, ativo)
         VALUES ${placeholders}`,
        params,
      );
      console.log(`[vto-checklist-migrations] OK: seed catalogo (${VTO_CATALOGO.length} itens, dupes ignorados)`);
    }
  } catch (err) {
    console.warn('[vto-checklist-migrations] aviso (seed catalogo):', (err as Error).message.slice(0, 160));
  }
}
