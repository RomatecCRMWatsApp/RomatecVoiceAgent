// src/database/migrations-clonagem-laudo.ts
//
// v3.1.0: clonagem de laudo. Adiciona 2 colunas (clonado_de_id, clonado_em)
// e 1 indice. Sem FK formal — segue o padrao das migrations existentes.
// Idempotente: re-execucao ignora "already exists".

import pool from './connection';

export async function runClonagemLaudoMigrations(): Promise<void> {
  const ops: Array<{ label: string; sql: string }> = [
    { label: 'ALTER clonado_de_id',
      sql: "ALTER TABLE laudos_demarcacao ADD COLUMN clonado_de_id INT NULL COMMENT 'ID do laudo origem da clonagem'" },
    { label: 'ALTER clonado_em',
      sql: "ALTER TABLE laudos_demarcacao ADD COLUMN clonado_em DATETIME NULL COMMENT 'Quando este laudo foi criado por clonagem'" },
    { label: 'CREATE idx_clonado_de',
      sql: 'CREATE INDEX idx_laudos_clonado_de ON laudos_demarcacao(clonado_de_id)' },
  ];

  for (const { label, sql } of ops) {
    try {
      await pool.execute(sql);
      console.log(`[clonagem-laudo-migrations] OK: ${label}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/already exists|Duplicate|Duplicate key name/i.test(msg)) {
        console.log(`[clonagem-laudo-migrations] ja existe (OK): ${label}`);
      } else {
        console.error(`[clonagem-laudo-migrations] FALHA ${label}:`, msg.slice(0, 200));
      }
    }
  }
}
