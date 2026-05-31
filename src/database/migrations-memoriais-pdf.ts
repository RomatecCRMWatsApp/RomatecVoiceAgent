// v3.49.2: colunas de artefatos do Memorial Hidraulico (PDFs + dados de calculo).
// Idempotente: so adiciona colunas que ainda nao existem em memoriais_calculo.
// Padrao do repo: migrations TS rodando no boot (nao SQL standalone).

import pool from './connection';
import type { RowDataPacket } from 'mysql2';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

const COLUNAS: Array<{ nome: string; ddl: string }> = [
  { nome: 'memorial_pdf_blob', ddl: 'ADD COLUMN memorial_pdf_blob LONGBLOB NULL' },
  { nome: 'memorial_pdf_filename', ddl: 'ADD COLUMN memorial_pdf_filename VARCHAR(255) NULL' },
  { nome: 'lista_materiais_pdf_blob', ddl: 'ADD COLUMN lista_materiais_pdf_blob LONGBLOB NULL' },
  { nome: 'lista_materiais_pdf_filename', ddl: 'ADD COLUMN lista_materiais_pdf_filename VARCHAR(255) NULL' },
  { nome: 'lista_materiais_hash', ddl: 'ADD COLUMN lista_materiais_hash CHAR(64) NULL' },
  { nome: 'dados_calculo', ddl: 'ADD COLUMN dados_calculo JSON NULL' },
];

export async function runMigrationsMemoriaisPdf(): Promise<void> {
  for (const c of COLUNAS) {
    try {
      if (await columnExists('memoriais_calculo', c.nome)) continue;
      await pool.execute(`ALTER TABLE memoriais_calculo ${c.ddl}`);
      console.log(`[memoriais-pdf-migrations] OK: coluna ${c.nome}`);
    } catch (err) {
      console.warn(`[memoriais-pdf-migrations] coluna ${c.nome} falhou: ${(err as Error).message}`);
    }
  }
}
