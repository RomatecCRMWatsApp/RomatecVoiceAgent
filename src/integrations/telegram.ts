import axios from 'axios';
import pool from '../database/connection';
import { think } from '../agent/think';

// Telegram Bot API direto. Bot dedicado pra ZAYRA — separado do bot do CRM.
// Setup do bot: @BotFather → /newbot → copiar TELEGRAM_BOT_TOKEN pro Railway.
// Whitelist: TELEGRAM_AUTHORIZED_USER_IDS=12345,67890 — só esses chat_ids são respondidos.
// Como descobrir seu chat_id: mande /start pro @userinfobot.

const TELEGRAM_API = 'https://api.telegram.org';

function botUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram: TELEGRAM_BOT_TOKEN não configurado no Railway.');
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

// ── Whitelist (anti-spam / anti-leak de tools) ──────────────────────────────
function authorizedIds(): Set<string> {
  const raw = process.env.TELEGRAM_AUTHORIZED_USER_IDS ?? '';
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

export function isAuthorized(chatId: string | number): boolean {
  const ids = authorizedIds();
  if (ids.size === 0) return false; // vazio = bloqueia tudo (default seguro)
  return ids.has(String(chatId));
}

// ── Outbound: envia mensagem ────────────────────────────────────────────────
export async function sendMessage(chatId: string | number, text: string): Promise<void> {
  try {
    await axios.post(botUrl('sendMessage'), {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }, { timeout: 10000 });
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = ax.response?.status ?? '?';
    const detail = JSON.stringify(ax.response?.data ?? ax.message ?? err);
    console.error('[Telegram sendMessage error]', JSON.stringify({ status, chatId, detail }));
    throw new Error(`Telegram (${status}): falha ao enviar para ${chatId} — ${detail}`);
  }

  void logTelegram('outbound', String(chatId), text).catch(err =>
    console.warn('[Telegram] log falhou (ignorado):', (err as Error).message),
  );
}

// ── Status / saúde do bot ───────────────────────────────────────────────────
export async function getBotInfo(): Promise<{
  online: boolean;
  username?: string;
  id?: number;
  webhook_url?: string;
  pending_updates?: number;
}> {
  try {
    const me = await axios.get<{ ok: boolean; result: { id: number; username: string; first_name: string } }>(
      botUrl('getMe'), { timeout: 10000 },
    );
    if (!me.data.ok) return { online: false };

    let webhookUrl: string | undefined;
    let pending: number | undefined;
    try {
      const wh = await axios.get<{ ok: boolean; result: { url: string; pending_update_count: number } }>(
        botUrl('getWebhookInfo'), { timeout: 10000 },
      );
      if (wh.data.ok) {
        webhookUrl = wh.data.result.url;
        pending = wh.data.result.pending_update_count;
      }
    } catch { /* não crítico */ }

    return {
      online: true,
      id: me.data.result.id,
      username: me.data.result.username,
      webhook_url: webhookUrl,
      pending_updates: pending,
    };
  } catch (err) {
    return { online: false };
  }
}

// ── Setup helper: registra webhook ZAYRA na API do Telegram ────────────────
export async function setWebhook(url: string): Promise<{ ok: boolean; description?: string }> {
  const r = await axios.post<{ ok: boolean; description: string }>(
    botUrl('setWebhook'),
    { url, allowed_updates: ['message'], drop_pending_updates: false },
    { timeout: 10000 },
  );
  return r.data;
}

// ── Inbound: parse Update do Telegram ───────────────────────────────────────
export interface TelegramIncoming {
  chatId:    number;
  userId:    number;
  username?: string;
  firstName?: string;
  text:      string;
  messageId: number;
}

export function parseTelegramUpdate(body: unknown): TelegramIncoming | null {
  if (!body || typeof body !== 'object') return null;
  const u = body as Record<string, unknown>;
  const msg = u.message as Record<string, unknown> | undefined;
  if (!msg) return null; // só tratamos messages, não edited_messages/channel_post/etc

  const chat = msg.chat as Record<string, unknown> | undefined;
  const from = msg.from as Record<string, unknown> | undefined;
  const text = msg.text as string | undefined;
  if (!chat || !from || typeof text !== 'string' || !text.trim()) return null;

  return {
    chatId:    Number(chat.id),
    userId:    Number(from.id),
    username:  (from.username as string | undefined),
    firstName: (from.first_name as string | undefined),
    text:      text.trim(),
    messageId: Number(msg.message_id),
  };
}

// ── Pipeline completo: recebe → autoriza → think() → responde ──────────────
export async function processTelegramIncoming(incoming: TelegramIncoming): Promise<void> {
  // Log inbound (mesmo de não-autorizados, pra audit)
  void logTelegram('inbound', String(incoming.chatId), incoming.text, incoming.username).catch(() => {});

  if (!isAuthorized(incoming.chatId)) {
    await sendMessage(
      incoming.chatId,
      `🚫 Não autorizado. Para liberar acesso, peça ao CEO José Romário para adicionar seu chat_id (\`${incoming.chatId}\`) à variável TELEGRAM_AUTHORIZED_USER_IDS no Railway.`,
    );
    return;
  }

  // Autorizado — passa pra ZAYRA via think()
  const sessionId = `tg_${incoming.chatId}`;
  try {
    const resp = await think(incoming.text, { sessionId, channel: 'whatsapp' });
    // 'whatsapp' como channel mais próximo até v1.9.0 — schema da memory.ts
    // só tem 'text'/'voice'/'whatsapp'/'mixed'. Pra um valor 'telegram' precisamos
    // alterar o ENUM da migration; fica pra v1.9.x.
    await sendMessage(incoming.chatId, resp.text);
  } catch (err) {
    console.error('[Telegram processIncoming]', err instanceof Error ? err.message : err);
    await sendMessage(
      incoming.chatId,
      `⚠️ Erro ao processar sua mensagem: ${err instanceof Error ? err.message : 'desconhecido'}`,
    );
  }
}

// ── Log próprio (mesmo padrão de zayra_whatsapp_log) ────────────────────────
async function ensureLogTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_telegram_log (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      direction   ENUM('outbound','inbound') NOT NULL,
      chat_id     VARCHAR(40) NOT NULL,
      message     TEXT NOT NULL,
      username    VARCHAR(100),
      sent_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_chat (chat_id),
      INDEX idx_sent (sent_at)
    )
  `);
}
let _logTableReady = false;

async function logTelegram(direction: 'outbound' | 'inbound', chatId: string, message: string, username?: string): Promise<void> {
  if (!_logTableReady) { await ensureLogTable(); _logTableReady = true; }
  await pool.execute(
    'INSERT INTO zayra_telegram_log (direction, chat_id, message, username) VALUES (?,?,?,?)',
    [direction, chatId, message, username ?? null],
  );
}
