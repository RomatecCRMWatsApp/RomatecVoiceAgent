import axios from 'axios';
import pool from '../database/connection';
import { transcribeAudio } from '../agent/transcribe';
import { think } from '../agent/think';
import { ingerirPdf, detectarCategoria } from '../services/ragIngest';
import { supabaseConfigurado } from '../services/supabase';

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
export interface WaTextMessage     { type: 'text';     from: string; id: string; text:     { body: string }; }
export interface WaAudioMessage    { type: 'audio';    from: string; id: string; audio:    { id: string; mime_type: string; url?: string }; }
export interface WaDocumentMessage { type: 'document'; from: string; id: string; document: { id: string; mime_type: string; url: string; filename: string; caption?: string }; }
export type WaMessage = WaTextMessage | WaAudioMessage | WaDocumentMessage;

// ── Normaliza payload ZAPI (ReceivedCallback) → WaMessage ────────────────────
// Z-API envia payloads com formatos variados (raiz vs data.*, message string vs
// objeto, audio.audioUrl vs audioUrl vs mediaUrl). Lógica espelha o CRM.
function pickStr(obj: Record<string, unknown>, ...paths: string[]): string {
  for (const p of paths) {
    const parts = p.split('.');
    let cur: unknown = obj;
    for (const k of parts) {
      if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[k];
      } else { cur = undefined; break; }
    }
    if (typeof cur === 'string' && cur) return cur;
  }
  return '';
}

function pickFlag(obj: Record<string, unknown>, ...paths: string[]): boolean {
  for (const p of paths) {
    const parts = p.split('.');
    let cur: unknown = obj;
    for (const k of parts) {
      if (cur && typeof cur === 'object' && k in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[k];
      } else { cur = undefined; break; }
    }
    if (cur === true) return true;
  }
  return false;
}

const STATUS_EVENTS = new Set(['sent', 'delivered', 'read', 'failed', 'error', 'message_status', 'message.status']);

export function parseZapiWebhook(body: unknown): WaMessage[] {
  if (!body || typeof body !== 'object') return [];
  const b = body as Record<string, unknown>;

  // 1. Ignora mensagens enviadas pela própria conta (loop)
  if (pickFlag(b, 'fromMe', 'data.fromMe')) return [];

  // 2. Ignora grupos
  if (pickFlag(b, 'isGroup', 'isGroupMsg', 'data.isGroup')) return [];

  // 3. Ignora status callbacks (sent/delivered/read etc.)
  const eventType = pickStr(b, 'event', 'type', 'data.event', 'status').toLowerCase();
  if (STATUS_EVENTS.has(eventType)) return [];

  const phone = pickStr(b, 'phone', 'from', 'data.phone').replace(/\D/g, '');
  if (!phone) return [];

  const id = pickStr(b, 'messageId', 'id', 'data.messageId') || `wa_${Date.now()}`;

  // 4. Áudio (precedência, pra não cair no fallback de texto vazio)
  const audioUrl = pickStr(b, 'audio.audioUrl', 'audioUrl', 'mediaUrl', 'data.audioUrl', 'media.url');
  const isAudio = pickFlag(b, 'isAudio', 'data.isAudio') ||
                  ['audio', 'ptt', 'voice'].includes(pickStr(b, 'type').toLowerCase()) ||
                  !!audioUrl;
  if (isAudio && audioUrl) {
    return [{
      type:  'audio',
      from:  phone,
      id,
      audio: { id, mime_type: pickStr(b, 'audio.mimeType', 'mimeType') || 'audio/ogg', url: audioUrl },
    }];
  }

  // 4b. Documento (PDF) — Z-API entrega via document.documentUrl ou similar
  const docUrl = pickStr(
    b,
    'document.documentUrl', 'document.url', 'documentUrl',
    'data.documentUrl', 'media.url',
  );
  const docMime = pickStr(b, 'document.mimeType', 'document.mime_type', 'mimeType', 'data.mimeType');
  const isDocType = ['document', 'file', 'pdf'].includes(pickStr(b, 'type').toLowerCase());
  if ((isDocType || docMime.includes('pdf')) && docUrl) {
    return [{
      type:     'document',
      from:     phone,
      id,
      document: {
        id,
        mime_type: docMime || 'application/pdf',
        url:       docUrl,
        filename:  pickStr(b, 'document.fileName', 'document.filename', 'fileName') || 'documento.pdf',
        caption:   pickStr(b, 'document.caption', 'caption') || undefined,
      },
    }];
  }

  // 5. Texto — múltiplos formatos
  let messageText = pickStr(b, 'text.message', 'text.body', 'message', 'body', 'data.message', 'data.text', 'content');

  // Se message é objeto, tenta extrair string
  if (!messageText) {
    const m = b.message;
    if (m && typeof m === 'object') {
      const mo = m as Record<string, unknown>;
      messageText = pickStr(mo, 'message', 'body', 'text', 'caption');
    }
  }
  messageText = (messageText || '').trim();
  if (!messageText) return []; // payload sem conteúdo útil

  return [{ type: 'text', from: phone, id, text: { body: messageText } }];
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

// ── Processa mensagem inbound: transcreve áudio, ingere PDF, ou chama think() ──
export async function processMessage(msg: WaMessage): Promise<string> {
  // PDF → ingere na memória vetorial (RAG)
  if (msg.type === 'document') {
    if (!supabaseConfigurado()) {
      return '⚠️ Recebi seu PDF, Chefe, mas a memória vetorial (Supabase) não está configurada no servidor ainda.';
    }
    if (!msg.document.mime_type.includes('pdf')) {
      return `⚠️ Aceito só PDF por enquanto (você mandou: ${msg.document.mime_type}).`;
    }
    try {
      const buf = await downloadDocument(msg);
      const titulo    = (msg.document.caption || msg.document.filename).replace(/\.pdf$/i, '');
      const categoria = detectarCategoria(msg.document.filename);
      const r = await ingerirPdf({
        pdfBuffer:   buf,
        titulo,
        fonte:       'whatsapp',
        categoria,
        arquivoNome: msg.document.filename,
      });
      if (r.ja_existia) return `📚 Já tinha "${r.titulo}" na memória, Chefe.`;
      return `✅ Aprendi: *${r.titulo}* (${r.chunks_inseridos} trechos, ${r.paginas} páginas, categoria: ${categoria})`;
    } catch (err) {
      return `❌ Falhei ingerindo o PDF: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

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

async function downloadDocument(msg: WaDocumentMessage): Promise<Buffer> {
  const r = await axios.get<ArrayBuffer>(msg.document.url, {
    responseType: 'arraybuffer',
    timeout:      60000,
    maxContentLength: 50 * 1024 * 1024,
  });
  return Buffer.from(r.data);
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
