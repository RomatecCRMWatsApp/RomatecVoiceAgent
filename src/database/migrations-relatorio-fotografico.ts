// v3.51.0 — VTA Relatorio Fotografico Tecnico (Modulo B).
// Idempotente (CREATE TABLE IF NOT EXISTS). Roda no boot.
import pool from './connection';

async function exec(sql: string, tag: string): Promise<void> {
  try {
    await pool.execute(sql);
    console.log(`[relatorio-fotografico-migrations] OK: ${tag}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === 'ER_TABLE_EXISTS_ERROR' || code === 'ER_DUP_FIELDNAME' || code === 'ER_DUP_KEYNAME') {
      console.log(`[relatorio-fotografico-migrations] ja existe (OK): ${tag}`);
    } else {
      console.warn(`[relatorio-fotografico-migrations] aviso (${tag}):`, (err as Error).message.slice(0, 140));
    }
  }
}

export async function runRelatorioFotograficoMigrations(): Promise<void> {
  await exec(`
    CREATE TABLE IF NOT EXISTS relatorios_fotograficos (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      titulo          VARCHAR(255) NOT NULL,
      laudo_id        INT UNSIGNED NULL,
      proposta_id     INT UNSIGNED NULL,
      colaborador     VARCHAR(150) NOT NULL,
      municipio       VARCHAR(100) NULL,
      data_vistoria   DATE NULL,
      observacoes     TEXT NULL,
      status          ENUM('rascunho','finalizado','enviado') DEFAULT 'rascunho',
      criado_em       DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_relfoto_laudo (laudo_id),
      INDEX idx_relfoto_proposta (proposta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE relatorios_fotograficos');

  await exec(`
    CREATE TABLE IF NOT EXISTS fotos_vistoria (
      id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      relatorio_id        INT UNSIGNED NOT NULL,
      filename_original   VARCHAR(255) NULL,
      filename_overlay    VARCHAR(255) NULL,
      path_original       VARCHAR(500) NULL,
      path_overlay        VARCHAR(500) NULL,
      base64_overlay      LONGTEXT NULL,
      latitude            DECIMAL(10,7) NULL,
      longitude           DECIMAL(10,7) NULL,
      altitude_m          FLOAT NULL,
      utm_zona            VARCHAR(10) NULL,
      utm_e               DECIMAL(12,3) NULL,
      utm_n               DECIMAL(12,3) NULL,
      datum               VARCHAR(30) DEFAULT 'SIRGAS 2000',
      municipio           VARCHAR(150) NULL,
      logradouro          VARCHAR(255) NULL,
      horario_captura     DATETIME NULL,
      colaborador         VARCHAR(150) NULL,
      descricao           VARCHAR(500) NULL,
      ordem               INT DEFAULT 0,
      criado_em           DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_foto_relatorio (relatorio_id),
      CONSTRAINT fk_foto_relatorio FOREIGN KEY (relatorio_id) REFERENCES relatorios_fotograficos(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE fotos_vistoria');
}
