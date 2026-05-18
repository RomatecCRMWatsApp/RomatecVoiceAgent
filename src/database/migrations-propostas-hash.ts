// v1.99.17: adiciona hash_validacao (SHA-256, 64 hex) à tabela propostas para
// validação pública permanente via /v/:hash. Migração idempotente: se a coluna
// já existir, ignora.

import type { RowDataPacket } from 'mysql2';
import pool from './connection';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(table: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

export async function runPropostasHashMigrations(): Promise<void> {
  try {
    if (!(await columnExists('propostas', 'hash_validacao'))) {
      await pool.execute(
        `ALTER TABLE propostas
           ADD COLUMN hash_validacao VARCHAR(64) NULL
           COMMENT 'SHA-256 para validação pública via /v/:hash'`
      );
      console.log('[propostas-hash-migrations] OK: ADD COLUMN hash_validacao');
    } else {
      console.log('[propostas-hash-migrations] ja existe (OK): hash_validacao');
    }

    if (!(await indexExists('propostas', 'uk_propostas_hash'))) {
      await pool.execute(
        `ALTER TABLE propostas ADD UNIQUE KEY uk_propostas_hash (hash_validacao)`
      );
      console.log('[propostas-hash-migrations] OK: UNIQUE KEY uk_propostas_hash');
    } else {
      console.log('[propostas-hash-migrations] ja existe (OK): uk_propostas_hash');
    }
  } catch (err) {
    console.error('[propostas-hash-migrations] FALHA:', (err as Error).message);
  }
}
