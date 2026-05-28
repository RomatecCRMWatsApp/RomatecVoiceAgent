// v3.28.0: tabela de preferencias por usuario (JSON livre por escopo).
// Idempotente — espelha o padrao das demais migrations do repo.

import pool from './connection';

export async function runMigrationsUserPreferences(): Promise<void> {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INT PRIMARY KEY,
        preferences JSON NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[user-preferences-migrations] OK: user_preferences');
  } catch (err) {
    console.error('[user-preferences-migrations] FALHA:', (err as Error).message);
  }
}
