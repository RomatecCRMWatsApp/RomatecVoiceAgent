// src/database/migrations-assinatura-chat.ts
// v3.152.0 — Assinatura iniciada pelo chat do Claude com aprovação por link.
// Incremento sobre o módulo /api/assinatura (v3.151.0). Só acrescenta:
//   - assinatura_lotes: agrupa docs de um mesmo envio sob um token de aprovação
//     (sha256 no banco; o token puro só vai no link do Telegram, uso único, 30 min).
//   - assinatura_documentos.lote_id: liga cada doc ao lote.
//
// v3.152.1 — âncoras: assinatura_documentos.ancoras (JSON) com os retângulos onde
//     o selo visual do RT deve ser desenhado (vários pontos num mesmo PDF).
//
// Idempotente (CREATE TABLE IF NOT EXISTS + checagem de coluna antes do ALTER).
// Roda standalone no boot, padrão das demais *-migrations.
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
    console.log(`[assinatura-chat-migrations] OK: ${tag}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException & { code?: string }).code;
    if (code === 'ER_TABLE_EXISTS_ERROR' || code === 'ER_DUP_FIELDNAME' || code === 'ER_DUP_KEYNAME') {
      console.log(`[assinatura-chat-migrations] ja existe (OK): ${tag}`);
    } else {
      console.warn(`[assinatura-chat-migrations] aviso (${tag}):`, (err as Error).message.slice(0, 160));
    }
  }
}

export async function runAssinaturaChatMigrations(): Promise<void> {
  await exec(`
    CREATE TABLE IF NOT EXISTS assinatura_lotes (
      id          CHAR(16)     NOT NULL,
      titulo      VARCHAR(255) NOT NULL,
      token_hash  CHAR(64)     NOT NULL,
      origem      VARCHAR(60)  NOT NULL DEFAULT 'claude-chat',
      expira_em   DATETIME     NOT NULL,
      status      ENUM('aguardando','assinado','rejeitado','expirado','erro') NOT NULL DEFAULT 'aguardando',
      usado_em    DATETIME     NULL,
      criado_em   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_lote_token (token_hash),
      KEY idx_lote_status (status, expira_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, 'CREATE assinatura_lotes');

  // assinatura_documentos.lote_id — liga o doc ao lote (NULL p/ docs antigos).
  if (!(await columnExists('assinatura_documentos', 'lote_id'))) {
    await exec(
      `ALTER TABLE assinatura_documentos
         ADD COLUMN lote_id CHAR(16) NULL,
         ADD KEY idx_doc_lote (lote_id)`,
      'ADD assinatura_documentos.lote_id',
    );
  }

  // v3.152.1 — âncoras: retângulos (pontos PDF) onde o selo do RT é desenhado.
  if (!(await columnExists('assinatura_documentos', 'ancoras'))) {
    await exec(
      `ALTER TABLE assinatura_documentos ADD COLUMN ancoras JSON NULL`,
      'ADD assinatura_documentos.ancoras',
    );
  }

  // Estende o ENUM de auditoria com os eventos de lote (idempotente: MODIFY com a
  // mesma definição é no-op). Sem isso, auditar('lote_criado'/'lote_aprovado')
  // dá "Data truncated for column 'acao'".
  await exec(
    `ALTER TABLE assinatura_auditoria MODIFY acao
       ENUM('enfileirado','visualizado','aprovado','assinado','rejeitado','erro',
            'senha_invalida','bloqueio','certificado_importado','lote_criado','lote_aprovado') NOT NULL`,
    'MODIFY assinatura_auditoria.acao (+lote_criado,lote_aprovado)',
  );
}
