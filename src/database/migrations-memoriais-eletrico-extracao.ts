// v3.66.0: coluna extracao_json no memorial elétrico (auditoria + re-edição).
// Idempotente: verifica existência da coluna antes de executar o ALTER.
// Padrão do repo: migrations TS rodando no boot (nao SQL standalone).

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
  { nome: 'extracao_json', ddl: 'ADD COLUMN extracao_json LONGTEXT NULL' },
];

export async function runMemoriaisEletricoExtracaoMigrations(): Promise<void> {
  for (const c of COLUNAS) {
    try {
      if (await columnExists('memoriais_calculo', c.nome)) {
        console.log(`[mem-ele-extracao] ja existe: ${c.nome}`);
        continue;
      }
      await pool.execute(`ALTER TABLE memoriais_calculo ${c.ddl}`);
      console.log(`[mem-ele-extracao] OK: coluna ${c.nome}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate column|already exists/i.test(msg)) {
        console.log(`[mem-ele-extracao] ja existe: ${c.nome}`);
      } else {
        console.error(`[mem-ele-extracao] FALHA ${c.nome}:`, msg.slice(0, 160));
      }
    }
  }
}
