import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { runMigrations } from '../database/migrations';

function db() { return pool; }

export async function initDb(): Promise<void> {
  await runMigrations();
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface Memory extends RowDataPacket {
  id:             number;
  type:           'fact' | 'preference' | 'decision' | 'context' | 'reminder';
  content:        string;
  relevance_tags: string | null;
  created_at:     Date;
  updated_at:     Date;
  expires_at:     Date | null;
}

// ── Level 1 — in-process session history ─────────────────────────────────────
interface SessionMsg { role: 'user' | 'assistant'; content: string; }
const sessionMsgs: SessionMsg[] = [];
const MAX_SESSION = 20;

export function addToSession(role: 'user' | 'assistant', content: string): void {
  sessionMsgs.push({ role, content });
  if (sessionMsgs.length > MAX_SESSION) sessionMsgs.shift();
}

export function getSessionHistory(): SessionMsg[] {
  return [...sessionMsgs];
}

// Load last 50 conversations from DB to prime in-memory session on boot
export async function loadSessionFromDb(): Promise<void> {
  try {
    const [rows] = await db().execute<RowDataPacket[]>(
      `SELECT role, content FROM zayra_conversations
       ORDER BY created_at DESC LIMIT 50`,
    );
    const msgs = (rows as Array<{ role: 'user' | 'assistant'; content: string }>).reverse();
    for (const m of msgs) sessionMsgs.push({ role: m.role, content: m.content });
    while (sessionMsgs.length > MAX_SESSION) sessionMsgs.shift();
    console.log(`[Memory] Loaded ${sessionMsgs.length} messages from DB`);
  } catch (err) {
    console.warn('[Memory] Could not load session from DB:', err);
  }
}

// ── Level 2 — persistent memory operations ───────────────────────────────────
export async function saveMemory(
  type:            Memory['type'],
  content:         string,
  relevance_tags?: string,
  expires_at?:     string,
): Promise<number> {
  const [result] = await db().execute<ResultSetHeader>(
    'INSERT INTO zayra_memory (type, content, relevance_tags, expires_at) VALUES (?,?,?,?)',
    [type, content, relevance_tags ?? null, expires_at ?? null],
  );
  invalidateContextCache();
  return result.insertId;
}

export async function searchMemory(query: string, type?: string): Promise<Memory[]> {
  const like = `%${query}%`;
  let sql = `SELECT * FROM zayra_memory
             WHERE (content LIKE ? OR relevance_tags LIKE ?)
               AND (expires_at IS NULL OR expires_at > NOW())`;
  const params: string[] = [like, like];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY updated_at DESC LIMIT 20';
  const [rows] = await db().execute<Memory[]>(sql, params);
  return rows;
}

export async function listMemories(): Promise<Memory[]> {
  const [rows] = await db().execute<Memory[]>(
    `SELECT * FROM zayra_memory
     WHERE expires_at IS NULL OR expires_at > NOW()
     ORDER BY type, updated_at DESC`,
  );
  return rows;
}

export async function deleteMemory(id: number): Promise<void> {
  await db().execute('DELETE FROM zayra_memory WHERE id = ?', [id]);
  invalidateContextCache();
}

export async function saveConversation(
  session_id: string,
  role:       'user' | 'assistant',
  content:    string,
): Promise<void> {
  await db().execute(
    'INSERT INTO zayra_conversations (session_id, role, content) VALUES (?,?,?)',
    [session_id, role, content],
  );
}

// ── Context cache (refreshed every 5 min) ─────────────────────────────────────
let _cache = '';
let _cacheAt = 0;

export function invalidateContextCache(): void { _cacheAt = 0; }

export async function getMemoryContext(): Promise<string> {
  if (Date.now() - _cacheAt < 5 * 60 * 1000) return _cache;
  try {
    const mems = await listMemories();
    if (!mems.length) { _cache = ''; _cacheAt = Date.now(); return ''; }

    const lines = mems.map(m => {
      const exp = m.expires_at
        ? ` [expira: ${new Date(m.expires_at).toLocaleDateString('pt-BR')}]`
        : '';
      return `[${m.type}] ${m.content}${exp}`;
    });
    _cache = `\n\nMemórias persistentes ativas:\n${lines.join('\n')}`;
    _cacheAt = Date.now();
  } catch {
    _cache = '';
  }
  return _cache;
}
