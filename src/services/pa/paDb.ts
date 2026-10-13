// v3.142.0 — Helpers de banco do módulo PA (conversão de tipos do mysql2,
// transação, auditoria). DECIMAL volta como string e DATE como Date local.
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import pool from '../../database/connection';

export type Db = Pool | PoolConnection;
export { pool };

export type Row = RowDataPacket & Record<string, unknown>;

export async function rows<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await db.query<RowDataPacket[]>(sql, params);
  return r as unknown as T[];
}
export async function one<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await rows<T>(db, sql, params);
  return r[0] ?? null;
}
export async function exec(db: Db, sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [r] = await db.query<ResultSetHeader>(sql, params);
  return r;
}

export async function transacao<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const out = await fn(c);
    await c.commit();
    return out;
  } catch (err) {
    try { await c.rollback(); } catch { /* conexão já caiu */ }
    throw err;
  } finally {
    c.release();
  }
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
/** DATE do mysql2 (Date em horário local) → 'aaaa-mm-dd'. */
export function isoDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).slice(0, 10);
}
/** DATETIME do mysql2 → 'aaaa-mm-dd hh:mm:ss'. */
export function isoDateTime(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${isoDate(v)} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  return String(v).replace('T', ' ').slice(0, 19);
}

/** Data de hoje em Brasília (UTC-3). */
export function hojeBrasil(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
export function agoraBrasilSql(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

export async function registrarEvento(
  db: Db,
  ev: { projeto_id: number | null; associado_id?: number | null; usuario?: string | null; tipo: string; dados?: unknown },
): Promise<void> {
  try {
    await exec(db, 'INSERT INTO pa_eventos (projeto_id, associado_id, usuario_id, tipo, dados) VALUES (?, ?, ?, ?, ?)', [
      ev.projeto_id, ev.associado_id ?? null, ev.usuario ?? null, ev.tipo.slice(0, 40),
      ev.dados === undefined ? null : JSON.stringify(ev.dados),
    ]);
  } catch (err) {
    // Auditoria não pode derrubar a operação de negócio — mas fica no log.
    console.error('[pa] falha ao registrar evento', ev.tipo, (err as Error).message);
  }
}
