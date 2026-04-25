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

export interface ChatSession extends RowDataPacket {
  id:         string;
  title:      string | null;
  channel:    'text' | 'voice' | 'whatsapp' | 'mixed';
  msg_count:  number;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationRow extends RowDataPacket {
  id:         number;
  session_id: string;
  role:       'user' | 'assistant';
  content:    string;
  created_at: Date;
}

export type Channel = 'text' | 'voice' | 'whatsapp' | 'mixed';

// ── Level 1 — in-process session history (legacy global, voice fallback) ─────
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

// ── Chat Sessions ────────────────────────────────────────────────────────────
export function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `chat_${Date.now()}_${rand}`;
}

export async function createChatSession(
  title?:   string,
  channel:  Channel = 'text',
  id?:      string,
): Promise<string> {
  const sessionId = id ?? newSessionId();
  await db().execute(
    'INSERT INTO zayra_chat_sessions (id, title, channel) VALUES (?,?,?)',
    [sessionId, title ?? null, channel],
  );
  return sessionId;
}

export async function ensureChatSession(
  sessionId: string,
  channel:   Channel = 'text',
): Promise<void> {
  await db().execute(
    `INSERT IGNORE INTO zayra_chat_sessions (id, channel) VALUES (?, ?)`,
    [sessionId, channel],
  );
}

export async function bumpSession(
  sessionId: string,
  channel?:  Channel,
): Promise<void> {
  if (channel) {
    await db().execute(
      `UPDATE zayra_chat_sessions
         SET msg_count = msg_count + 1,
             channel = CASE WHEN channel = ? OR channel = 'mixed' THEN channel ELSE 'mixed' END
       WHERE id = ?`,
      [channel, sessionId],
    );
  } else {
    await db().execute(
      'UPDATE zayra_chat_sessions SET msg_count = msg_count + 1 WHERE id = ?',
      [sessionId],
    );
  }
}

export async function setSessionTitle(sessionId: string, title: string): Promise<void> {
  await db().execute(
    'UPDATE zayra_chat_sessions SET title = ? WHERE id = ?',
    [title.slice(0, 200), sessionId],
  );
}

export async function getSessionMeta(sessionId: string): Promise<ChatSession | null> {
  const [rows] = await db().execute<ChatSession[]>(
    'SELECT * FROM zayra_chat_sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function listChatSessions(limit = 50, offset = 0): Promise<ChatSession[]> {
  const [rows] = await db().query<ChatSession[]>(
    'SELECT * FROM zayra_chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  );
  return rows;
}

export async function getSessionMessages(
  sessionId: string,
  limit = 200,
): Promise<ConversationRow[]> {
  const [rows] = await db().query<ConversationRow[]>(
    `SELECT * FROM zayra_conversations
     WHERE session_id = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [sessionId, limit],
  );
  return rows;
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await db().execute('DELETE FROM zayra_conversations WHERE session_id = ?', [sessionId]);
  await db().execute('DELETE FROM zayra_chat_sessions WHERE id = ?', [sessionId]);
}

export interface SearchHit {
  session_id:   string;
  role:         'user' | 'assistant';
  content:      string;
  created_at:   Date;
  session_title: string | null;
}

export async function searchConversations(query: string, limit = 30): Promise<SearchHit[]> {
  const like = `%${query}%`;
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT c.session_id, c.role, c.content, c.created_at, s.title AS session_title
       FROM zayra_conversations c
       LEFT JOIN zayra_chat_sessions s ON s.id = c.session_id
      WHERE c.content LIKE ?
      ORDER BY c.created_at DESC
      LIMIT ?`,
    [like, limit],
  );
  return rows as SearchHit[];
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
