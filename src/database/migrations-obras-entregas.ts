// src/database/migrations-obras-entregas.ts
// v3.81.0 — Módulo "Entrega de Obra" (Relatório de Entrega / RE).
// Submódulo de Gestão de Obras que fecha o ciclo Proposta/VTO → Entrega.
//
// Adaptações à realidade do repo (não ao rascunho do spec):
//  - Sem tabela `colaboradores`: o DONO do documento é o `sub` do JWT
//    (VARCHAR(64)), mesmo padrão do VTO Checklist (colaborador_id).
//  - Obra é `romatec_obras`; proposta é `propostas`. NÃO há FK proposta→obra
//    no schema, então `obra_id` é NULLABLE (link opcional/denormalizado).
//  - Fotos e Nota Fiscal são BASE64 em LONGTEXT (Railway = container efêmero,
//    sem volume em disco), igual a reforma-piso/vistorias — o spec usava
//    `path VARCHAR(500)`, inviável aqui.
//  - Sem FK cross-table (convenção do repo): FK só nas tabelas-filhas
//    (fotos/materiais → obras_entregas) com ON DELETE CASCADE, igual
//    vto_checklist_itens. proposta_id/obra_id são INT + índice.
//
// Idempotente (CREATE TABLE IF NOT EXISTS). Roda standalone no boot.
import pool from './connection';

async function exec(sql: string, tag: string): Promise<void> {
  try {
    await pool.execute(sql);
    console.log(`[obras-entregas-migrations] OK: ${tag}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === 'ER_TABLE_EXISTS_ERROR' || code === 'ER_DUP_FIELDNAME' || code === 'ER_DUP_KEYNAME') {
      console.log(`[obras-entregas-migrations] ja existe (OK): ${tag}`);
    } else {
      console.warn(`[obras-entregas-migrations] aviso (${tag}):`, (err as Error).message.slice(0, 160));
    }
  }
}

export async function runObrasEntregasMigrations(): Promise<void> {
  await exec(`
    CREATE TABLE IF NOT EXISTS obras_entregas (
      id                        INT UNSIGNED NOT NULL AUTO_INCREMENT,
      colaborador_id            VARCHAR(64) NOT NULL,
      proposta_id               INT NOT NULL,
      obra_id                   INT NULL,
      numero                    VARCHAR(40) NULL,
      titulo                    VARCHAR(255) NULL,
      cliente                   VARCHAR(200) NULL,
      cliente_telefone          VARCHAR(30) NULL,
      endereco_obra             VARCHAR(300) NULL,
      cidade_uf                 VARCHAR(120) NULL,
      resumo_proposta           TEXT NULL,
      descricao_execucao        MEDIUMTEXT NULL,
      status                    ENUM('rascunho','em_revisao','concluido','entregue') NOT NULL DEFAULT 'rascunho',
      valor_orcado              DECIMAL(12,2) NULL,
      valor_receber             DECIMAL(12,2) NULL,
      nota_fiscal_nome          VARCHAR(255) NULL,
      nota_fiscal_mime          VARCHAR(80) NULL,
      nota_fiscal_base64        LONGTEXT NULL,
      responsavel_equipe_id     INT NULL,
      responsavel_nome          VARCHAR(200) NULL,
      responsavel_cargo         VARCHAR(120) NULL,
      responsavel_foto_base64   LONGTEXT NULL,
      data_execucao             DATE NULL,
      data_entrega              DATETIME NULL,
      hash_publico              CHAR(64) NULL,
      recebimento_confirmado_em DATETIME NULL,
      recebimento_ip            VARCHAR(64) NULL,
      created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_colab (colaborador_id),
      KEY idx_proposta (proposta_id),
      KEY idx_obra (obra_id),
      KEY idx_hash (hash_publico),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE obras_entregas');

  await exec(`
    CREATE TABLE IF NOT EXISTS obras_entregas_fotos (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      entrega_id   INT UNSIGNED NOT NULL,
      tipo         ENUM('antes','execucao','depois','sobra_material') NOT NULL,
      mime         VARCHAR(50) NOT NULL DEFAULT 'image/jpeg',
      data_base64  LONGTEXT NOT NULL,
      legenda      VARCHAR(255) NULL,
      ordem        INT NOT NULL DEFAULT 0,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_entrega_tipo (entrega_id, tipo, ordem),
      CONSTRAINT fk_entrega_foto FOREIGN KEY (entrega_id)
        REFERENCES obras_entregas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE obras_entregas_fotos');

  await exec(`
    CREATE TABLE IF NOT EXISTS obras_entregas_materiais_sobra (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      entrega_id   INT UNSIGNED NOT NULL,
      material     VARCHAR(255) NOT NULL,
      quantidade   DECIMAL(10,2) NULL,
      unidade      VARCHAR(20) NULL,
      foto_mime    VARCHAR(50) NULL,
      foto_base64  LONGTEXT NULL,
      observacao   VARCHAR(255) NULL,
      ordem        INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_entrega (entrega_id, ordem),
      CONSTRAINT fk_entrega_material FOREIGN KEY (entrega_id)
        REFERENCES obras_entregas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, 'CREATE obras_entregas_materiais_sobra');
}
