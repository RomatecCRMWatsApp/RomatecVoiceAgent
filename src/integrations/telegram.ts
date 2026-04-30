import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import { transcribeAudio } from '../agent/transcribe';
import pool from '../database/connection';
import { think } from '../agent/think';
import { speak } from '../agent/speak';
import { ingerirPdf, detectarCategoria } from '../services/ragIngest';
import { indexarContratoModelo } from '../services/contratosIngest';
import { supabaseConfigurado } from '../services/supabase';

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

// v1.45.0: combina env var (CEO) + tabela romatec_team_members (equipe).
// Async porque consulta DB. Usado em processTelegramIncoming antes de
// passar pra think(); o role do membro vai pro contexto da request.
export async function isAuthorizedExtended(chatId: string | number): Promise<{
  authorized: boolean;
  role?: 'admin' | 'engenheiro' | 'corretor' | 'comercial' | 'leitura';
  membro_nome?: string;
  via: 'env' | 'db' | 'none';
}> {
  // Env var primeiro (CEO + legacy)
  if (isAuthorized(chatId)) {
    return { authorized: true, role: 'admin', membro_nome: 'CEO José Romário', via: 'env' };
  }
  // Tabela da equipe
  try {
    const { isAuthorizedByDb } = await import('../services/teamMembers');
    const r = await isAuthorizedByDb(chatId);
    if (r.authorized && r.member) {
      return { authorized: true, role: r.member.role, membro_nome: r.member.nome, via: 'db' };
    }
  } catch (err) {
    console.warn('[telegram.isAuthorizedExtended] DB lookup falhou:', (err as Error).message);
  }
  return { authorized: false, via: 'none' };
}

// Escapa caracteres que ativam Markdown V1 do Telegram (_*`[).
// Sem isso, nomes de arquivo com underscore (provimento 195_2025) quebram
// o parser com erro 400 "can't parse entities".
export function escapeMd(s: string): string {
  return String(s ?? '').replace(/([_*`\[])/g, '\\$1');
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
    const ax = err as { response?: { status?: number; data?: { description?: string } }; message?: string };
    const status = ax.response?.status ?? 0;
    const desc   = ax.response?.data?.description ?? '';
    // Rede de segurança: 400 com 'parse entities' = caractere markdown solto.
    // Reenvia SEM parse_mode (texto cru) pra garantir entrega.
    if (status === 400 && /parse entit/i.test(desc)) {
      console.warn(`[Telegram sendMessage] Markdown explodiu (${desc.slice(0, 80)}), retry sem parse_mode`);
      try {
        await axios.post(botUrl('sendMessage'), {
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }, { timeout: 10000 });
        void logTelegram('outbound', String(chatId), text).catch(() => {});
        return;
      } catch (err2) {
        const ax2 = err2 as { response?: { status?: number; data?: unknown }; message?: string };
        const detail = JSON.stringify(ax2.response?.data ?? ax2.message ?? err2);
        console.error('[Telegram sendMessage retry] falhou:', detail);
        throw new Error(`Telegram retry: ${detail}`);
      }
    }
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
export interface TelegramDocument {
  file_id:   string;
  mime_type: string;
  filename:  string;
  caption?:  string;
}
export interface TelegramVoice {
  file_id:   string;
  mime_type: string;
  duration:  number;             // segundos
  file_size?: number;
}
export interface TelegramIncoming {
  chatId:    number;
  userId:    number;
  username?: string;
  firstName?: string;
  text:      string;             // vazio se for só voice/documento
  voice?:    TelegramVoice;
  document?: TelegramDocument;
  messageId: number;
}

export function parseTelegramUpdate(body: unknown): TelegramIncoming | null {
  if (!body || typeof body !== 'object') return null;
  const u = body as Record<string, unknown>;
  const msg = u.message as Record<string, unknown> | undefined;
  if (!msg) return null;

  const chat = msg.chat as Record<string, unknown> | undefined;
  const from = msg.from as Record<string, unknown> | undefined;
  if (!chat || !from) return null;

  const text    = (msg.text as string | undefined)    ?? '';
  const caption = (msg.caption as string | undefined) ?? '';

  // voice (mensagem de voz nativa) tem precedência sobre audio file
  let voice: TelegramVoice | undefined;
  const v = (msg.voice ?? msg.audio) as Record<string, unknown> | undefined;
  if (v && typeof v === 'object') {
    voice = {
      file_id:   String(v.file_id ?? ''),
      mime_type: String(v.mime_type ?? 'audio/ogg'),
      duration:  Number(v.duration ?? 0),
      file_size: v.file_size ? Number(v.file_size) : undefined,
    };
  }

  let document: TelegramDocument | undefined;
  const doc = msg.document as Record<string, unknown> | undefined;
  if (doc && typeof doc === 'object') {
    document = {
      file_id:   String(doc.file_id ?? ''),
      mime_type: String(doc.mime_type ?? 'application/octet-stream'),
      filename:  String(doc.file_name ?? 'documento'),
      caption:   caption || undefined,
    };
  }

  // Se não tem texto, voice nem documento, ignora
  if (!text.trim() && !voice && !document) return null;

  return {
    chatId:    Number(chat.id),
    userId:    Number(from.id),
    username:  (from.username as string | undefined),
    firstName: (from.first_name as string | undefined),
    text:      text.trim(),
    voice,
    document,
    messageId: Number(msg.message_id),
  };
}

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  // 1. getFile → file_path
  const meta = await axios.get<{ ok: boolean; result: { file_path: string } }>(
    botUrl('getFile'),
    { params: { file_id: fileId }, timeout: 15000 },
  );
  if (!meta.data.ok) throw new Error('Telegram getFile falhou');
  const filePath = meta.data.result.file_path;
  // 2. download via api.telegram.org/file/bot{TOKEN}/{file_path}
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const r = await axios.get<ArrayBuffer>(
    `${TELEGRAM_API}/file/bot${token}/${filePath}`,
    { responseType: 'arraybuffer', timeout: 60000, maxContentLength: 50 * 1024 * 1024 },
  );
  return Buffer.from(r.data);
}

// ── Pipeline completo: recebe → autoriza → think() → responde ──────────────
export async function processTelegramIncoming(incoming: TelegramIncoming): Promise<void> {
  // Log inbound (mesmo de não-autorizados, pra audit)
  const logText = incoming.text
    || (incoming.document ? `[PDF: ${incoming.document.filename}]`
    :   incoming.voice    ? `[voz: ${incoming.voice.duration}s]`
    :   '[vazio]');
  void logTelegram('inbound', String(incoming.chatId), logText, incoming.username).catch(() => {});

  const auth = await isAuthorizedExtended(incoming.chatId);
  if (!auth.authorized) {
    await sendMessage(
      incoming.chatId,
      `🚫 Não autorizado. Peça ao CEO José Romário para te adicionar à equipe Romatec (chat_id: \`${incoming.chatId}\`).`,
    );
    return;
  }

  // VOZ → Whisper transcreve → think → speak (TTS) → sendVoice de volta
  if (incoming.voice) {
    if (incoming.voice.duration > 600) {
      await sendMessage(incoming.chatId, '⚠️ Áudio muito longo (>10 min). Manda menor ou usa texto, Chefe.');
      return;
    }
    try {
      void sendChatAction(incoming.chatId, 'typing').catch(() => {});
      const ogg = await downloadTelegramFile(incoming.voice.file_id);
      const tx  = await transcribeAudio(ogg, incoming.voice.mime_type);
      console.log(`[telegram-voice] chat=${incoming.chatId} ${incoming.voice.duration}s → "${tx.text.slice(0, 80)}"`);
      if (!tx.text || tx.text.trim().length < 2) {
        await sendMessage(incoming.chatId, '⚠️ Não entendi seu áudio. Tenta de novo ou manda texto.');
        return;
      }

      const sessionId = `tg_${incoming.chatId}`;
      const callerOpt = auth.role && auth.membro_nome ? {
        caller: { role: auth.role, nome: auth.membro_nome, via: auth.via === 'env' ? 'env' as const : 'db' as const },
      } : {};
      const resp = await think(tx.text, { sessionId, channel: 'voice', ...callerOpt });

      // Resposta dupla: texto (pra ler) + áudio (voz da ZAYRA via OpenAI TTS)
      await sendMessage(incoming.chatId, `🎙 _você disse: ${escapeMd(tx.text.slice(0, 200))}_\n\n${resp.text}`);

      void sendChatAction(incoming.chatId, 'record_voice').catch(() => {});
      // Limita TTS a 2000 chars pra não estourar custo / tempo. Acima disso, só texto.
      const textoTTS = resp.text.length > 2000 ? resp.text.slice(0, 2000) + '...' : resp.text;
      try {
        const mp3 = await speak(textoTTS);
        await sendVoiceFromBuffer(incoming.chatId, mp3, 'zayra-resposta.mp3');
      } catch (ttsErr) {
        console.warn('[telegram-voice] TTS falhou:', (ttsErr as Error).message);
      }
    } catch (err) {
      console.error('[telegram-voice]', err instanceof Error ? err.message : err);
      await sendMessage(incoming.chatId, `⚠️ Erro processando áudio: ${escapeMd((err as Error).message ?? String(err))}`);
    }
    return;
  }

  // PDF/DOCX → ingere na memória vetorial.
  // Se caption contém "contrato" / "modelo" / "minuta", vai pra base de contratos
  // (segmentação Claude → cláusulas + embeddings em contratos_indexados).
  // Senão, vai pro RAG geral (rag_chunks).
  // Webhook Telegram é assíncrono → sem timeout 502 do gateway Railway.
  if (incoming.document) {
    if (!supabaseConfigurado()) {
      await sendMessage(incoming.chatId, '⚠️ Documento recebido, mas Supabase não está configurado no servidor.');
      return;
    }
    const mime = incoming.document.mime_type;
    const isPdf  = mime.includes('pdf');
    const isDocx = mime.includes('wordprocessingml') || mime.includes('officedocument') ||
                   incoming.document.filename.toLowerCase().endsWith('.docx');
    if (!isPdf && !isDocx) {
      await sendMessage(incoming.chatId, `⚠️ Aceito PDF ou DOCX (recebido: ${mime}).`);
      return;
    }

    const captionLower = (incoming.document.caption || '').toLowerCase();
    const ehContratoModelo = /\b(contrato|modelo|minuta|template)\b/.test(captionLower);

    // ── ROTA A: contrato modelo (Fase 1 — segmentação Claude) ──
    if (ehContratoModelo) {
      try {
        await sendMessage(incoming.chatId,
          `📥 Recebi *${escapeMd(incoming.document.filename)}*, segmentando como contrato modelo… ` +
          `_pode levar 1-3 min, te aviso quando terminar_`);
        const buf = await downloadTelegramFile(incoming.document.file_id);
        const r = await indexarContratoModelo({
          buffer:       buf,
          fonteArquivo: isDocx ? 'docx' : 'pdf',
          tituloHint:   incoming.document.caption?.replace(/\b(contrato|modelo|minuta|template)\b/gi, '').trim() || undefined,
          arquivoNome:  incoming.document.filename,
          fonte:        'telegram',
        });
        const tituloSafe = escapeMd(r.titulo);
        if (r.ja_existia) {
          await sendMessage(incoming.chatId, `📚 Já tinha *${tituloSafe}* na base de contratos, Chefe.`);
        } else {
          const secoesStr = Object.entries(r.secoes).map(([k, v]) => `${k}=${v}`).join(' | ');
          await sendMessage(incoming.chatId,
            `✅ Indexei contrato: *${tituloSafe}*\n` +
            `tipo: \`${escapeMd(r.tipo)}\`\n` +
            `cláusulas: ${r.total_clausulas}\n` +
            `seções: ${escapeMd(secoesStr)}\n\n` +
            `_resumo:_ ${escapeMd(r.resumo.slice(0, 300))}${r.resumo.length>300?'...':''}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sendMessage(incoming.chatId, `❌ Falhei indexando o contrato: ${escapeMd(msg)}`);
      }
      return;
    }

    // ── ROTA B: documento geral pro RAG ──
    if (!isPdf) {
      await sendMessage(incoming.chatId, `⚠️ Pra RAG geral aceito só PDF. Pra indexar como contrato modelo, manda com caption "contrato" ou "minuta".`);
      return;
    }
    try {
      await sendMessage(incoming.chatId, `📥 Recebi *${escapeMd(incoming.document.filename)}*, processando…`);
      const buf = await downloadTelegramFile(incoming.document.file_id);
      const titulo    = (incoming.document.caption || incoming.document.filename).replace(/\.pdf$/i, '');
      const categoria = detectarCategoria(incoming.document.filename);
      const r = await ingerirPdf({
        pdfBuffer:   buf,
        titulo,
        fonte:       'telegram',
        categoria,
        arquivoNome: incoming.document.filename,
      });
      const tituloSafe = escapeMd(r.titulo);
      const resposta = r.ja_existia
        ? `📚 Já tinha *${tituloSafe}* na memória, Chefe.`
        : `✅ Aprendi: *${tituloSafe}* (${r.chunks_inseridos} trechos, ${r.paginas} páginas, categoria: ${categoria})`;
      await sendMessage(incoming.chatId, resposta);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sendMessage(incoming.chatId, `❌ Falhei ingerindo o PDF: ${escapeMd(msg)}`);
    }
    return;
  }

  // Autorizado — passa pra ZAYRA via think()
  const sessionId = `tg_${incoming.chatId}`;
  try {
    const callerOpt = auth.role && auth.membro_nome ? {
      caller: { role: auth.role, nome: auth.membro_nome, via: auth.via === 'env' ? 'env' as const : 'db' as const },
    } : {};
    const resp = await think(incoming.text, { sessionId, channel: 'whatsapp', ...callerOpt });
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

// ── Outbound rich: chat action, voz, documento ─────────────────────────────
// chatAction: 'typing' | 'upload_document' | 'record_voice' | 'upload_voice'
export async function sendChatAction(chatId: string | number, action: string): Promise<void> {
  await axios.post(botUrl('sendChatAction'), { chat_id: chatId, action }, { timeout: 5000 });
}

// Envia áudio MP3 (do speak()) como audio attachment. Telegram aceita MP3
// nativamente — mostra player com waveform, ignora restrição de OGG/Opus
// que só vale pro 'voice message' nativo. Pra usuário final é igual.
export async function sendVoiceFromBuffer(
  chatId: string | number,
  audioBuffer: Buffer,
  filename = 'zayra.mp3',
): Promise<void> {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('audio', audioBuffer, { filename, contentType: 'audio/mpeg' });
  fd.append('title', 'ZAYRA');
  fd.append('performer', 'Romatec');
  await axios.post(botUrl('sendAudio'), fd, {
    headers:          fd.getHeaders(),
    timeout:          60000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength:    50 * 1024 * 1024,
  });
  void logTelegram('outbound', String(chatId), `[áudio: ${filename} ${(audioBuffer.length/1024).toFixed(1)}KB]`).catch(() => {});
}

// Envia documento (DOCX/PDF gerado pelo agent — usado por contratos Fase 2+).
// Aceita Buffer + filename OU path local.
export async function sendDocument(
  chatId: string | number,
  source:   Buffer | string,
  filename: string,
  caption?: string,
): Promise<void> {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  const buf = Buffer.isBuffer(source) ? source : await fs.readFile(source);
  fd.append('document', buf, { filename });
  if (caption) {
    fd.append('caption', caption);
    fd.append('parse_mode', 'Markdown');
  }
  await axios.post(botUrl('sendDocument'), fd, {
    headers:          fd.getHeaders(),
    timeout:          60000,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength:    50 * 1024 * 1024,
  });
  void logTelegram('outbound', String(chatId), `[doc: ${filename} ${(buf.length/1024).toFixed(1)}KB]`).catch(() => {});
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
