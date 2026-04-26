import axios from 'axios';
import pool from '../database/connection';
import { transcribeAudio } from '../agent/transcribe';
import { think } from '../agent/think';

// Z-API direto (sem passar pelo CRM). Mesmas credenciais que o CRM usa.
const ZAPI_BASE_URL     = process.env.ZAPI_BASE_URL ?? 'https://api.z-api.io';
const ZAPI_INSTANCE_ID  = process.env.ZAPI_INSTANCE_ID ?? '';
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN ?? '';
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN ?? '';

function zapiBase(): string {
  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN) {
    throw new Error('ZAPI: faltam ZAPI_INSTANCE_ID e/ou ZAPI_TOKEN no Railway.');
  }
  return `${ZAPI_BASE_URL}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;
}

function zapiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ZAPI_CLIENT_TOKEN) h['Client-Token'] = ZAPI_CLIENT_TOKEN;
  return h;
}

// ── Schema unificado de mensagem inbound (do webhook ZAPI) ───────────────────
// ZAPI manda payloads em formatos diferentes (text/audio/image). Normalizamos.
export interface WaTextMessage  { type: 'text';  from: string; id: string; text:  { body: string }; }
export interface WaAudioMessage { type: 'audio'; from: string; id: string; audio: { id: string; mime_type: string; url?: string }; }
export type WaMessage = WaTextMessage | WaAudioMessage;

// ── Normaliza payload ZAPI (ReceivedCallback) → WaMessage ────────────────────
export function parseZapiWebhook(body: unknown): WaMessage[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;

  // Ignora mensagens enviadas pela própria conta (loop)
  if (b.fromMe === true) return [];

  const phone = (b.phone ?? b.from ?? '') as string;
  const id    = (b.messageId ?? b.id ?? `wa_${Date.now()}`) as string;

  // Texto
  const text = (b.text as Record<string, unknown> | undefined);
  if (text && typeof text === 'object' && typeof text.message === 'string') {
    return [{ type: 'text', from: phone, id, text: { body: text.message } }];
  }
  if (typeof b.body === 'string')    return [{ type: 'text', from: phone, id, text: { body: b.body    } }];
  if (typeof b.message === 'string') return [{ type: 'text', from: phone, id, text: { body: b.message } }];

  // Áudio
  const audio = (b.audio as Record<string, unknown> | undefined);
  if (audio && typeof audio === 'object' && typeof audio.audioUrl === 'string') {
    return [{
      type:  'audio',
      from:  phone,
      id,
      audio: { id, mime_type: (audio.mimeType as string) ?? 'audio/ogg', url: audio.audioUrl as string },
    }];
  }

  return []; // tipo não suportado (imagem/video/sticker etc) — silencioso
}

// ── Outbound: envia texto via ZAPI direto ────────────────────────────────────
export async function sendReply(to: string, message: string): Promise<void> {
  const phone = String(to).replace(/\D/g, ''); // só dígitos
  if (!phone) throw new Error('WhatsApp: número de destino vazio.');

  const url = `${zapiBase()}/send-text`;
  let zApiMessageId: string | undefined;
  try {
    const r = await axios.post<{ messageId?: string; id?: string; zaapId?: string }>(
      url,
      { phone, message },
      { headers: zapiHeaders(), timeout: 10000 },
    );
    zApiMessageId = r.data?.messageId ?? r.data?.id ?? r.data?.zaapId;
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = ax.response?.status ?? '?';
    const detail = JSON.stringify(ax.response?.data ?? ax.message ?? err);
    console.error('[ZAPI sendReply error]', JSON.stringify({ status, phone, detail }));
    throw new Error(`ZAPI (${status}): falha ao enviar para ${phone} — ${detail}`);
  }

  // Log fire-and-forget no MySQL compartilhado (zayra_whatsapp_log)
  void logOutbound(phone, message, zApiMessageId).catch(err =>
    console.warn('[ZAPI sendReply] log falhou (ignorado):', (err as Error).message),
  );
}

// ── Inbound: baixa áudio via ZAPI ────────────────────────────────────────────
async function downloadAudio(msg: WaAudioMessage): Promise<Buffer> {
  // ZAPI normalmente já entrega URL pública direta no webhook
  if (msg.audio.url) {
    const r = await axios.get<ArrayBuffer>(msg.audio.url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(r.data);
  }
  // Fallback: GET /audio/{messageId}
  const url = `${zapiBase()}/audio/${msg.audio.id}`;
  const r = await axios.get<ArrayBuffer>(url, {
    headers: zapiHeaders(),
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  return Buffer.from(r.data);
}

// ── Processa mensagem inbound: transcreve áudio se preciso, chama think() ───
export async function processMessage(msg: WaMessage): Promise<string> {
  let userText: string;
  if (msg.type === 'audio') {
    const buf = await downloadAudio(msg);
    const tx  = await transcribeAudio(buf, msg.audio.mime_type);
    userText  = tx.text;
  } else {
    userText = msg.text.body;
  }
  // sessionId estável por contato — agrupa conversas inbound
  const sessionId = `wa_${msg.from}`;
  const resp = await think(userText, { sessionId, channel: 'whatsapp' });
  return resp.text;
}

// ── Schema próprio: zayra_whatsapp_log (não conflita com `messages` do CRM) ──
async function ensureLogTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS zayra_whatsapp_log (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      direction       ENUM('outbound','inbound') NOT NULL,
      phone           VARCHAR(20) NOT NULL,
      message         TEXT NOT NULL,
      z_api_id        VARCHAR(255),
      sent_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_phone (phone),
      INDEX idx_sent  (sent_at)
    )
  `);
}
let _logTableReady = false;

async function logOutbound(phone: string, message: string, zApiId?: string): Promise<void> {
  if (!_logTableReady) { await ensureLogTable(); _logTableReady = true; }
  await pool.execute(
    'INSERT INTO zayra_whatsapp_log (direction, phone, message, z_api_id) VALUES (?,?,?,?)',
    ['outbound', phone, message, zApiId ?? null],
  );
}

export async function logInbound(phone: string, message: string, zApiId?: string): Promise<void> {
  if (!_logTableReady) { await ensureLogTable(); _logTableReady = true; }
  await pool.execute(
    'INSERT INTO zayra_whatsapp_log (direction, phone, message, z_api_id) VALUES (?,?,?,?)',
    ['inbound', phone, message, zApiId ?? null],
  );
}
