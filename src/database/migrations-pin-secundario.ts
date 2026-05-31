// v3.50.0: PIN secundario (4 digitos) pra confirmar acoes destrutivas/criticas.
//
// Roles `admin` e `owner` bypassam o PIN em todas as rotas — autoridade admin
// ja e' suficiente (mesma logica do requireCeoToken hibrido). Outros roles
// (gestor, engenheiro, financeiro, viewer, colaborador) precisam cadastrar
// e digitar PIN pra deletar recibos, fechar folha, cancelar NF emitida, etc.
//
// Storage: bcrypt hash (cost 12 — mesmo da senha de login). 5 tentativas
// erradas seguidas -> trava 15 min (pin_locked_until). Reset automatico ao
// acertar.

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

export async function runPinSecundarioMigrations(): Promise<void> {
  const cols: Array<[string, string]> = [
    ['pin_hash', `ALTER TABLE users ADD COLUMN pin_hash VARCHAR(255) NULL
                    COMMENT 'bcrypt do PIN 4 digitos. NULL = sem PIN cadastrado'`],
    ['pin_set_at', `ALTER TABLE users ADD COLUMN pin_set_at DATETIME NULL
                      COMMENT 'quando o PIN foi definido/trocado pela ultima vez'`],
    ['pin_failed_attempts', `ALTER TABLE users ADD COLUMN pin_failed_attempts INT UNSIGNED NOT NULL DEFAULT 0
                               COMMENT 'tentativas falhas consecutivas — reset ao acertar'`],
    ['pin_locked_until', `ALTER TABLE users ADD COLUMN pin_locked_until DATETIME NULL
                            COMMENT 'apos 5 falhas, trava ate este timestamp (15 min)'`],
  ];

  for (const [col, sql] of cols) {
    try {
      if (await columnExists('users', col)) {
        console.log(`[pin-migrations] ja existe (OK): users.${col}`);
        continue;
      }
      await pool.execute(sql);
      console.log(`[pin-migrations] OK: ADD COLUMN users.${col}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate column|already exists/i.test(msg)) {
        console.log(`[pin-migrations] ja existe (OK): users.${col}`);
      } else {
        console.error(`[pin-migrations] FALHA users.${col}:`, msg.slice(0, 200));
      }
    }
  }
}
