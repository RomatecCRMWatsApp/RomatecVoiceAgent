import axios from 'axios';
import pool from '../database/connection';
import { transcribeAudio } from '../agent/transcribe';
import { think } from '../agent/think';
import { ingerirPdf, detectarCategoria } from '../services/ragIngest';
import { supabaseConfigurado } from '../services/supabase';

// Z-API direto. Aceita instância dedicada da ZAYRA (vars _ZAYRA) com fallback
// pras vars antigas (compatível com CRM que pode estar em outra instância).
// CEO criou nova instância exclusiva pra ZAYRA enquanto WhatsApp do CRM está
// em manutenção (aguardando Meta Cloud API).
const ZAPI_BASE_URL     = process.env.ZAPI_BASE_URL_ZAYRA     ?? process.env.ZAPI_BASE_URL     ?? 'https://api.z-api.io';
const ZAPI_INSTANCE_ID  = process.env.ZAPI_INSTANCE_ID_ZAYRA  ?? process.env.ZAPI_INSTANCE_ID  ?? '';
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN_ZAYRA        ?? process.env.ZAPI_TOKEN        ?? '';
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN_ZAYRA ?? process.env.ZAPI_CLIENT_TOKEN ?? '';

const usandoInstanciaZayra = !!process.env.ZAPI_INSTANCE_ID_ZAYRA;
console.log(
  `[ZAPI] config: instância=${ZAPI_INSTANCE_ID.slice(0,8)}… (${usandoInstanciaZayra ? 'DEDICADA ZAYRA' : 'CRM compartilhada'}) | ` +
  `token=${ZAPI_TOKEN ? 'set('+ZAPI_TOKEN.length+'chars)' : 'VAZIO ❌'} | ` +
  `client-token=${ZAPI_CLIENT_TOKEN ? 'set('+ZAPI_CLIENT_TOKEN.length+'chars)' : 'VAZIO ❌'}`,
);

function zapiBase(): string {
  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN) {
    throw new Error('ZAPI: faltam ZAPI_INSTANCE_ID(_ZAYRA) e/ou ZAPI_TOKEN(_ZAYRA) no Railway.');
  }
  return `${ZAPI_BASE_URL}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;
}

function zapiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ZAPI_CLIENT_TOKEN) h['Client-Token'] = ZAPI_CLIENT_TOKEN;
  return h;
}

// Sanitiza número de telefone pro formato Z-API (só dígitos, com DDI 55 se faltar)
function normalizarTelefone(numero: string): string {
  const digits = numero.replace(/\D/g, '');
  // Se já tem 13 (5598999999999) ou 12 (559899999999) dígitos, ok
  if (digits.length === 13 || digits.length === 12) return digits;
  // Se tem 11 (98999999999) ou 10 (9899999999), prefixa 55
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  throw new Error(`Telefone inválido: "${numero}" — informe com DDD (ex: 5598999999999 ou 98 9 9999-9999)`);
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
export async function sendReply(to: string, message: string): Promise<{ messageId?: string; phone: string }> {
  const phone = normalizarTelefone(to);
  if (!message?.trim()) throw new Error('WhatsApp: mensagem vazia.');

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

  void logOutbound(phone, message, zApiMessageId).catch(err =>
    console.warn('[ZAPI sendReply] log falhou (ignorado):', (err as Error).message),
  );
  return { messageId: zApiMessageId, phone };
}

// ── Outbound: imagem (URL ou base64) ─────────────────────────────────────────
export async function sendImage(to: string, imageUrl: string, caption?: string): Promise<{ messageId?: string; phone: string }> {
  const phone = normalizarTelefone(to);
  if (!imageUrl) throw new Error('WhatsApp: imageUrl obrigatória.');

  // Z-API aceita: data:image/jpeg;base64,xxx OU https://url-publica/imagem.jpg
  const isBase64 = imageUrl.startsWith('data:image/');
  const isUrl    = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');
  if (!isBase64 && !isUrl) {
    throw new Error('imageUrl deve ser URL pública (https://) ou data URI base64 (data:image/...)');
  }

  const url = `${zapiBase()}/send-image`;
  try {
    const r = await axios.post<{ messageId?: string; id?: string }>(
      url,
      { phone, image: imageUrl, caption: caption ?? '' },
      { headers: zapiHeaders(), timeout: 30000 },
    );
    const messageId = r.data?.messageId ?? r.data?.id;
    void logOutbound(phone, `[IMAGEM]${caption ? ' ' + caption : ''}`, messageId).catch(() => {});
    return { messageId, phone };
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const detail = JSON.stringify(ax.response?.data ?? ax.message ?? err);
    throw new Error(`ZAPI send-image: ${detail}`);
  }
}

// ── Outbound: áudio (base64 MP3 ou OGG) ──────────────────────────────────────
export async function sendAudio(to: string, audioBase64: string, asPtt = true): Promise<{ messageId?: string; phone: string }> {
  const phone = normalizarTelefone(to);
  if (!audioBase64) throw new Error('WhatsApp: audioBase64 obrigatório.');

  // Z-API espera data:audio/mp3;base64,xxx ou data:audio/ogg;base64,xxx
  const audio = audioBase64.startsWith('data:audio/')
    ? audioBase64
    : `data:audio/mp3;base64,${audioBase64}`;

  const url = `${zapiBase()}/send-audio`;
  try {
    const r = await axios.post<{ messageId?: string; id?: string }>(
      url,
      { phone, audio, waveform: true, viewOnce: false, async: false },
      { headers: zapiHeaders(), timeout: 60000 },
    );
    const messageId = r.data?.messageId ?? r.data?.id;
    void logOutbound(phone, '[ÁUDIO]', messageId).catch(() => {});
    return { messageId, phone };
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const detail = JSON.stringify(ax.response?.data ?? ax.message ?? err);
    throw new Error(`ZAPI send-audio: ${detail}`);
  }
}

// ── Outbound: documento (DOCX/PDF/etc — base64) ──────────────────────────────
export async function sendDocument(to: string, docBase64: string, fileName: string, extension?: string): Promise<{ messageId?: string; phone: string }> {
  const phone = normalizarTelefone(to);
  if (!docBase64 || !fileName) throw new Error('WhatsApp: docBase64 e fileName obrigatórios.');

  // Detecta extensão pelo nome se não vier explícita
  const ext = (extension || fileName.split('.').pop() || '').toLowerCase().replace(/^\./, '');
  if (!ext) throw new Error('Não consegui detectar extensão do arquivo (use fileName tipo "contrato.docx")');

  // Z-API aceita: data:application/pdf;base64,xxx OU URL https
  const mimeMap: Record<string, string> = {
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:  'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:  'application/vnd.ms-excel',
    txt:  'text/plain',
    csv:  'text/csv',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const document = docBase64.startsWith('data:')
    ? docBase64
    : `data:${mime};base64,${docBase64}`;

  const url = `${zapiBase()}/send-document/${ext}`;
  try {
    const r = await axios.post<{ messageId?: string; id?: string }>(
      url,
      { phone, document, fileName },
      { headers: zapiHeaders(), timeout: 60000 },
    );
    const messageId = r.data?.messageId ?? r.data?.id;
    void logOutbound(phone, `[DOC] ${fileName}`, messageId).catch(() => {});
    return { messageId, phone };
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const detail = JSON.stringify(ax.response?.data ?? ax.message ?? err);
    throw new Error(`ZAPI send-document: ${detail}`);
  }
}

// ── Outbound: localização (lat/lng) ──────────────────────────────────────────
export async function sendLocation(to: string, latitude: number, longitude: number, title?: string, address?: string): Promise<{ messageId?: string; phone: string }> {
  const phone = normalizarTelefone(to);
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('latitude e longitude obrigatórios (números, ex: -4.946 / -47.501)');
  }

  const url = `${zapiBase()}/send-location`;
  try {
    const r = await axios.post<{ messageId?: string; id?: string }>(
      url,
      { phone, latitude, longitude, title: title ?? 'Localização', address: address ?? '' },
      { headers: zapiHeaders(), timeout: 10000 },
    );
    const messageId = r.data?.messageId ?? r.data?.id;
    void logOutbound(phone, `[LOC] ${title ?? ''} (${latitude},${longitude})`, messageId).catch(() => {});
    return { messageId, phone };
  } catch (err) {
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    const detail = JSON.stringify(ax.response?.data ?? ax.message ?? err);
    throw new Error(`ZAPI send-location: ${detail}`);
  }
}

// ── High-level: TTS (Edge) + envia áudio gravado ─────────────────────────────
export async function enviarAudioTTS(to: string, texto: string): Promise<{ messageId?: string; phone: string; segundos: number }> {
  const { speak } = await import('../agent/speak');
  if (texto.length > 800) throw new Error('Texto muito longo pra áudio (max 800 chars). Reduza ou divida em mensagens.');

  const audioBuf = await speak(texto);
  const segundos = Math.ceil(audioBuf.length / (24000 * 0.5)); // estimativa: 24kHz mono ~6KB/s
  const audioBase64 = audioBuf.toString('base64');
  const r = await sendAudio(to, audioBase64, true);
  return { ...r, segundos };
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
