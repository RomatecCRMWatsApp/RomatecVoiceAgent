// v3.28.0: repositorio de preferencias por usuario (chave-valor JSON livre).

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

export type Preferences = Record<string, unknown>;

async function get(userId: number): Promise<Preferences | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT preferences FROM user_preferences WHERE user_id = ?`,
    [userId],
  );
  if (!rows.length) return null;
  const raw = rows[0].preferences;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Preferences; } catch { return null; }
  }
  return raw as Preferences;
}

async function upsert(userId: number, prefs: Preferences): Promise<void> {
  await pool.execute(
    `INSERT INTO user_preferences (user_id, preferences)
       VALUES (?, ?)
     ON DUPLICATE KEY UPDATE preferences = VALUES(preferences)`,
    [userId, JSON.stringify(prefs)],
  );
}

export const userPreferencesRepo = { get, upsert };
