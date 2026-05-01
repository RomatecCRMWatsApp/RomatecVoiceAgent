import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { runMigrations } from '../database/migrations';
import { embed, cosine } from '../integrations/embeddings';

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

// v1.65.11: limpa o histórico de uma sessão específica (DB) + esvazia o
// buffer global em memória + invalida cache de contexto. Chamada pelos
// comandos /clear, /limpar, /reset no Telegram (e potencialmente no chat web).
export async function clearSession(sessionId: string): Promise<{ apagadas: number }> {
  let apagadas = 0;
  try {
    const [r] = await db().execute<ResultSetHeader>(
      'DELETE FROM zayra_conversations WHERE session_id = ?',
      [sessionId],
    );
    apagadas = r.affectedRows ?? 0;
  } catch (err) {
    console.warn('[Memory] clearSession DB falhou:', (err as Error).message);
  }
  sessionMsgs.length = 0;
  invalidateContextCache();
  return { apagadas };
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
  // Auto-sync do cofre Obsidian (silencioso, fire-and-forget)
  void import('../integrations/cofre').then(c => c.autoSyncCofre()).catch(() => {});
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
): Promise<number> {
  const [r] = await db().execute<ResultSetHeader>(
    'INSERT INTO zayra_conversations (session_id, role, content) VALUES (?,?,?)',
    [session_id, role, content],
  );
  return r.insertId;
}

// ── RAG semântico (v1.13) — busca vetorial em todo histórico ────────────────
export async function indexConversation(
  conversationId: number,
  role:           'user' | 'assistant',
  content:        string,
): Promise<void> {
  if (!conversationId || !content?.trim()) return;
  try {
    const v = await embed(content);
    const preview = content.slice(0, 250);
    await db().execute(
      'INSERT INTO zayra_embeddings (conversation_id, role, content_preview, vector_json) VALUES (?,?,?,?)',
      [conversationId, role, preview, JSON.stringify(v)],
    );
  } catch (err) {
    // Falha silenciosa — embedding é "nice to have", não bloqueia conversa
    console.warn('[embeddings] indexConversation falhou:', (err as Error).message);
  }
}

export interface SimilarHit {
  conversation_id: number;
  role:            'user' | 'assistant';
  content:         string;
  similarity:      number;
  created_at:      Date;
}

export async function searchSimilar(query: string, k = 5, threshold = 0.3): Promise<SimilarHit[]> {
  if (!query?.trim()) return [];
  try {
    const queryVec = await embed(query);
    // Carrega últimos 10k embeddings — escala até esse ponto sem indexação vetorial.
    // Acima disso (improvável a curto prazo) considerar pgvector ou Qdrant.
    const [rows] = await db().query<RowDataPacket[]>(`
      SELECT e.conversation_id, e.role, e.vector_json, e.created_at,
             c.content
      FROM zayra_embeddings e
      LEFT JOIN zayra_conversations c ON c.id = e.conversation_id
      ORDER BY e.id DESC
      LIMIT 10000
    `);

    const scored: SimilarHit[] = [];
    for (const r of rows) {
      try {
        const v = JSON.parse(r.vector_json) as number[];
        const sim = cosine(queryVec, v);
        if (sim < threshold) continue;
        scored.push({
          conversation_id: r.conversation_id,
          role:            r.role,
          content:         r.content ?? '',
          similarity:      sim,
          created_at:      r.created_at,
        });
      } catch { /* vector inválido, skip */ }
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  } catch (err) {
    console.warn('[embeddings] searchSimilar falhou:', (err as Error).message);
    return [];
  }
}

// ── Extração automática de memórias (v1.13) — Claude background ─────────────
// Após cada turno, Claude analisa user+assistant e decide se algo merece virar
// memória estruturada permanente (fact/preference/decision/context/reminder).
// Fire-and-forget — falha não bloqueia conversa.
// Circuit breaker: quando Claude rate-limit, pausa extração por 5min.
// Evita amplificar pressão em cima do mesmo provider que já tá saturado.
let _extractCooldownUntil = 0;

export async function extractMemoryAuto(userMsg: string, assistantMsg: string): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;
  if (!userMsg?.trim() || !assistantMsg?.trim()) return;
  // Skip mensagens muito curtas (cumprimentos, "ok", etc.)
  if (userMsg.length < 15 && assistantMsg.length < 30) return;
  // Circuit breaker — se Claude tá em rate limit, não força mais um call.
  if (Date.now() < _extractCooldownUntil) return;

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const r = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 350,
      system: `Você analisa conversas entre o CEO José Romário e a ZAYRA (assistente da Romatec) e extrai memórias estruturadas permanentes.

Tipos válidos:
- fact: fato objetivo (ex: "Cliente Maria Silva tem CPF 123.456.789-00")
- preference: preferência do CEO (ex: "CEO prefere reuniões pela manhã")
- decision: decisão tomada (ex: "Aprovado contrato com cliente Y por R$50k")
- context: contexto pessoal/relacional (ex: "Esposa do CEO se chama Giegilla, tel 5599992242732")
- reminder: lembrete futuro (ex: "Pagar IPTU dia 15/05/2026")

REGRAS:
1. Só extraia o que vale memória PERMANENTE (vai ser útil daqui meses).
2. NÃO extraia: cumprimentos, "ok", perguntas operacionais triviais, status check, comandos de sistema.
3. SEMPRE extraia: nomes, telefones, CPF/CNPJ, datas, valores, decisões, preferências, relações pessoais.
4. Cada memória deve ser AUTOCONTIDA (não exige contexto da conversa pra entender).
5. Tags: 2-4 palavras-chave separadas por vírgula (busca futura).

Retorne SOMENTE JSON válido:
{"memories": [{"type": "...", "content": "...", "tags": "..."}]}

Se nada vale, retorne {"memories": []}.`,
      messages: [{
        role: 'user',
        content: `[CEO]: ${userMsg.slice(0, 1500)}\n\n[ZAYRA]: ${assistantMsg.slice(0, 1500)}`,
      }],
    });

    const block = r.content.find((b): b is import('@anthropic-ai/sdk').default.TextBlock => b.type === 'text');
    if (!block) return;

    const match = block.text.match(/\{[\s\S]*\}/);
    if (!match) return;

    const parsed = JSON.parse(match[0]) as {
      memories: { type: string; content: string; tags?: string }[];
    };
    if (!parsed.memories?.length) return;

    const validTypes = new Set(['fact', 'preference', 'decision', 'context', 'reminder']);
    for (const mem of parsed.memories) {
      if (!validTypes.has(mem.type) || !mem.content?.trim()) continue;
      try {
        await saveMemory(
          mem.type as Memory['type'],
          mem.content.trim(),
          mem.tags?.trim() || undefined,
        );
        console.log(`[memory] ✨ extraída: [${mem.type}] ${mem.content.slice(0, 80)}`);
      } catch { /* ignora individual */ }
    }
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e?.status === 429) {
      _extractCooldownUntil = Date.now() + 5 * 60 * 1000;
      console.warn('[memory] extractMemoryAuto pausado por 5min (Claude 429)');
    } else {
      console.warn('[memory] extractMemoryAuto falhou:', e?.message);
    }
  }
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
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const [rows] = await db().query<ChatSession[]>(
    `SELECT * FROM zayra_chat_sessions ORDER BY updated_at DESC LIMIT ${lim} OFFSET ${off}`,
  );
  return rows;
}

export async function getSessionMessages(
  sessionId: string,
  limit = 200,
): Promise<ConversationRow[]> {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const [rows] = await db().query<ConversationRow[]>(
    `SELECT * FROM zayra_conversations
     WHERE session_id = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ${lim}`,
    [sessionId],
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
  const lim  = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT c.session_id, c.role, c.content, c.created_at, s.title AS session_title
       FROM zayra_conversations c
       LEFT JOIN zayra_chat_sessions s ON s.id = c.session_id
      WHERE c.content LIKE ?
      ORDER BY c.created_at DESC
      LIMIT ${lim}`,
    [like],
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
