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
//
// v3.82.0 — Proposta externa (PDF fora do sistema): proposta_id vira NULLABLE,
// proposta_origem discrimina 'interna'/'externa' e o PDF externo é guardado em
// base64 (LONGTEXT), coerente com fotos/NF (Railway efêmero, sem disco). A regra
// "interna⇒proposta_id / externa⇒pdf" é validada no controller (o CHECK do
// rascunho do spec não é enforced de forma portável no MySQL do Railway).
import type { RowDataPacket } from 'mysql2';
import pool from './connection';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

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

  // ── v3.82.0: proposta externa (PDF fora do sistema) ───────────────────────
  // ALTERs idempotentes (checa coluna antes; ignora "Duplicate column").
  const alters: Array<[string, string]> = [
    ['proposta_origem', `ALTER TABLE obras_entregas ADD COLUMN proposta_origem ENUM('interna','externa') NOT NULL DEFAULT 'interna' AFTER proposta_id`],
    ['proposta_externa_pdf_nome', `ALTER TABLE obras_entregas ADD COLUMN proposta_externa_pdf_nome VARCHAR(255) NULL AFTER proposta_origem`],
    ['proposta_externa_pdf_mime', `ALTER TABLE obras_entregas ADD COLUMN proposta_externa_pdf_mime VARCHAR(80) NULL AFTER proposta_externa_pdf_nome`],
    ['proposta_externa_pdf_base64', `ALTER TABLE obras_entregas ADD COLUMN proposta_externa_pdf_base64 LONGTEXT NULL AFTER proposta_externa_pdf_mime`],
    ['proposta_externa_titulo', `ALTER TABLE obras_entregas ADD COLUMN proposta_externa_titulo VARCHAR(255) NULL AFTER proposta_externa_pdf_base64`],
    ['proposta_externa_escopo', `ALTER TABLE obras_entregas ADD COLUMN proposta_externa_escopo TEXT NULL AFTER proposta_externa_titulo`],
    ['proposta_externa_valor_orcado', `ALTER TABLE obras_entregas ADD COLUMN proposta_externa_valor_orcado DECIMAL(12,2) NULL AFTER proposta_externa_escopo`],
  ];
  for (const [col, sql] of alters) {
    try {
      if (!(await columnExists('obras_entregas', col))) {
        await pool.execute(sql);
        console.log(`[obras-entregas-migrations] OK: ADD ${col}`);
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      if (!/Duplicate column|already exists/i.test(msg)) {
        console.warn(`[obras-entregas-migrations] aviso (ADD ${col}):`, msg.slice(0, 160));
      }
    }
  }

  // proposta_id passa a aceitar NULL (entregas de proposta externa não têm FK).
  try {
    await pool.execute('ALTER TABLE obras_entregas MODIFY proposta_id INT NULL');
    console.log('[obras-entregas-migrations] OK: MODIFY proposta_id NULL');
  } catch (err) {
    console.warn('[obras-entregas-migrations] aviso (MODIFY proposta_id):', (err as Error).message.slice(0, 160));
  }

  // ── v3.83.0: coordenadas GPS nas fotos (padrão da galeria/fotos_vistoria) ──
  // O overlay técnico é estampado na própria imagem (data_base64); as colunas
  // guardam os valores brutos pra consulta/PDF.
  const alterCoords: Array<[string, string, string]> = [
    ['obras_entregas_fotos', 'latitude', `ALTER TABLE obras_entregas_fotos ADD COLUMN latitude DECIMAL(10,7) NULL`],
    ['obras_entregas_fotos', 'longitude', `ALTER TABLE obras_entregas_fotos ADD COLUMN longitude DECIMAL(10,7) NULL`],
    ['obras_entregas_fotos', 'altitude_m', `ALTER TABLE obras_entregas_fotos ADD COLUMN altitude_m DECIMAL(8,2) NULL`],
    ['obras_entregas_fotos', 'utm_zona', `ALTER TABLE obras_entregas_fotos ADD COLUMN utm_zona VARCHAR(10) NULL`],
    ['obras_entregas_fotos', 'utm_e', `ALTER TABLE obras_entregas_fotos ADD COLUMN utm_e DECIMAL(12,3) NULL`],
    ['obras_entregas_fotos', 'utm_n', `ALTER TABLE obras_entregas_fotos ADD COLUMN utm_n DECIMAL(12,3) NULL`],
    ['obras_entregas_fotos', 'datum', `ALTER TABLE obras_entregas_fotos ADD COLUMN datum VARCHAR(20) NULL`],
    ['obras_entregas_fotos', 'municipio', `ALTER TABLE obras_entregas_fotos ADD COLUMN municipio VARCHAR(150) NULL`],
    ['obras_entregas_fotos', 'logradouro', `ALTER TABLE obras_entregas_fotos ADD COLUMN logradouro VARCHAR(200) NULL`],
    ['obras_entregas_fotos', 'horario_captura', `ALTER TABLE obras_entregas_fotos ADD COLUMN horario_captura DATETIME NULL`],
    ['obras_entregas_fotos', 'colaborador', `ALTER TABLE obras_entregas_fotos ADD COLUMN colaborador VARCHAR(150) NULL`],
    ['obras_entregas_materiais_sobra', 'latitude', `ALTER TABLE obras_entregas_materiais_sobra ADD COLUMN latitude DECIMAL(10,7) NULL`],
    ['obras_entregas_materiais_sobra', 'longitude', `ALTER TABLE obras_entregas_materiais_sobra ADD COLUMN longitude DECIMAL(10,7) NULL`],
  ];
  for (const [table, col, sql] of alterCoords) {
    try {
      if (!(await columnExists(table, col))) {
        await pool.execute(sql);
        console.log(`[obras-entregas-migrations] OK: ADD ${table}.${col}`);
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      if (!/Duplicate column|already exists/i.test(msg)) {
        console.warn(`[obras-entregas-migrations] aviso (ADD ${table}.${col}):`, msg.slice(0, 160));
      }
    }
  }
}
