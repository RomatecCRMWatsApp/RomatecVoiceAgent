import pool from './connection';

export async function runMigrations(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_memory (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      type           ENUM('fact','preference','decision','context','reminder') NOT NULL,
      content        TEXT NOT NULL,
      relevance_tags VARCHAR(500),
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      expires_at     TIMESTAMP NULL
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_conversations (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(100) NOT NULL,
      role       ENUM('user','assistant') NOT NULL,
      content    TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('[DB] Migrations complete');
}
