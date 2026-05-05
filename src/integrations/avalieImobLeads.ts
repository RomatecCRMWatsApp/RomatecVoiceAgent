// @module integrations/avalieImobLeads — leads recebidos do AvalieImob via webhook.
// Captura cadastros novos + assinaturas Mercado Pago + outros eventos vindos do
// SEO/ads. Persiste no MySQL, notifica o CEO via WhatsApp + email opcional, e
// dispara auto-resposta de boas-vindas pro lead se ele tiver cadastrado telefone.
//
// Webhook recebido em POST /api/avalieimob/lead-webhook (server.ts) com header
// X-Webhook-Secret obrigatorio. Se secret nao casa, retorna 401 e descarta.

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { sendReply } from './whatsapp';

// Canais de notificacao do CEO. WhatsApp e Telegram disparam em paralelo.
// Email Resend fica opcional (only-if-key) caso queira ativar no futuro.
const CEO_PHONE         = process.env.CEO_PHONE         || '5599991811246';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '';
const RESEND_API_KEY    = process.env.RESEND_API_KEY    || '';
const RESEND_FROM       = process.env.RESEND_FROM       || 'ZAYRA <onboarding@resend.dev>';
const CEO_EMAIL         = process.env.CEO_EMAIL         || 'romateccrm@gmail.com';

// ── Tipos ────────────────────────────────────────────────────────────────────
export interface AvalieImobLeadPayload {
  external_id?:    string;       // user_id no AvalieImob (pra dedup)
  event_type:      'cadastro' | 'assinatura' | 'login' | 'outro';
  name:            string;
  email:           string;
  phone?:          string;       // sem mascara; aceitar com 55 ou nao
  role?:           string;       // ex: "Engenheiro Avaliador"
  crea?:           string;
  utm_source?:     string;
  utm_medium?:     string;
  utm_campaign?:   string;
  utm_content?:    string;
  utm_term?:       string;
  page_origin?:    string;       // ex: "/blog/como-fazer-ptam-passo-a-passo"
  referrer?:       string;
  // Especifico de assinatura:
  assinatura_plano?: 'mensal' | 'trimestral' | 'anual' | string;
  assinatura_valor?: number;
  // Tudo mais que veio
  payload_raw?:    Record<string, unknown>;
}

interface LeadRow extends RowDataPacket {
  id: number;
  email: string;
  event_type: string;
  ja_notificou_ceo: number;
  ja_respondeu_lead: number;
}

// ── Persistencia ─────────────────────────────────────────────────────────────
export async function salvarLead(p: AvalieImobLeadPayload): Promise<{ id: number; novo: boolean }> {
  // Dedup: se ja temos esse email + event_type recente (<60s), retorna o id existente
  // pra evitar duplicar notificacao em retry de webhook.
  const [existing] = await pool.execute<LeadRow[]>(
    `SELECT id, email, event_type, ja_notificou_ceo, ja_respondeu_lead
       FROM romatec_avalieimob_leads
      WHERE email = ? AND event_type = ?
        AND created_at > (NOW() - INTERVAL 60 SECOND)
      LIMIT 1`,
    [p.email, p.event_type]
  );
  if (existing.length > 0) {
    return { id: existing[0].id, novo: false };
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_avalieimob_leads
      (external_id, event_type, name, email, phone, role, crea,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term,
       page_origin, referrer, assinatura_plano, assinatura_valor, payload_raw)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p.external_id ?? null,
      p.event_type,
      p.name,
      p.email,
      p.phone ?? null,
      p.role ?? null,
      p.crea ?? null,
      p.utm_source ?? null,
      p.utm_medium ?? null,
      p.utm_campaign ?? null,
      p.utm_content ?? null,
      p.utm_term ?? null,
      p.page_origin ?? null,
      p.referrer ?? null,
      p.assinatura_plano ?? null,
      p.assinatura_valor ?? null,
      p.payload_raw ? JSON.stringify(p.payload_raw) : null,
    ]
  );
  return { id: r.insertId, novo: true };
}

async function marcarNotificado(
  id: number,
  campo: 'ja_notificou_ceo' | 'ja_notificou_telegram' | 'ja_respondeu_lead',
): Promise<void> {
  await pool.execute(
    `UPDATE romatec_avalieimob_leads SET ${campo} = TRUE WHERE id = ?`,
    [id]
  );
}

// ── Formatacao do payload pra mensagem WhatsApp ──────────────────────────────
function emojiEvento(t: AvalieImobLeadPayload['event_type']): string {
  if (t === 'cadastro') return '🎯';
  if (t === 'assinatura') return '💰';
  if (t === 'login') return '🔁';
  return '📩';
}

function tituloEvento(t: AvalieImobLeadPayload['event_type']): string {
  if (t === 'cadastro')   return 'Novo lead AvalieImob';
  if (t === 'assinatura') return 'NOVA ASSINATURA AvalieImob! 💰';
  if (t === 'login')      return 'Lead voltou (login)';
  return 'Evento AvalieImob';
}

function formatarSource(p: AvalieImobLeadPayload): string {
  const partes: string[] = [];
  if (p.utm_source)   partes.push(p.utm_source);
  if (p.utm_medium)   partes.push(p.utm_medium);
  if (p.utm_campaign) partes.push(`(${p.utm_campaign})`);
  if (partes.length === 0) return p.referrer ? `referer: ${p.referrer}` : 'direto / orgânico';
  return partes.join(' / ');
}

function mensagemCEO(p: AvalieImobLeadPayload): string {
  const linhas: string[] = [];
  linhas.push(`${emojiEvento(p.event_type)} *${tituloEvento(p.event_type)}*`);
  linhas.push('');
  linhas.push(`👤 ${p.name}`);
  linhas.push(`📧 ${p.email}`);
  if (p.phone)         linhas.push(`📱 ${p.phone}`);
  if (p.role)          linhas.push(`💼 ${p.role}${p.crea ? ` · CREA ${p.crea}` : ''}`);
  if (p.event_type === 'assinatura' && p.assinatura_plano) {
    linhas.push(`💳 Plano: *${p.assinatura_plano}*${p.assinatura_valor ? ` (R$ ${p.assinatura_valor.toFixed(2)})` : ''}`);
  }
  linhas.push('');
  linhas.push(`🌐 De: ${p.page_origin || '/'}`);
  linhas.push(`📊 Source: ${formatarSource(p)}`);
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  linhas.push(`⏰ ${agora} BRT`);
  return linhas.join('\n');
}

function mensagemLead(p: AvalieImobLeadPayload): string {
  if (p.event_type === 'assinatura') {
    return `🎉 Olá ${p.name.split(' ')[0]}!\n\nObrigado por assinar o AvalieImob! Seu acesso já está ativo.\n\nQualquer dúvida sobre PTAM, NBR 14.653 ou uso da plataforma, pode falar comigo aqui mesmo.\n\n— Equipe RomaTec / AvalieImob`;
  }
  return `Olá ${p.name.split(' ')[0]}! 👋\n\nVi que você criou sua conta no *AvalieImob*. Bem-vindo!\n\nVocê tem 7 dias grátis pra emitir PTAM, laudos e avaliações conforme NBR 14.653 — sem cartão de crédito.\n\nQualquer dúvida pra começar (cadastrar imóvel, ART/RRT, escolher método avaliatório), me chama aqui mesmo.\n\n— Equipe RomaTec / AvalieImob`;
}

// ── Notificacoes ─────────────────────────────────────────────────────────────
async function notificarCEOWhatsApp(p: AvalieImobLeadPayload): Promise<boolean> {
  try {
    await sendReply(CEO_PHONE, mensagemCEO(p));
    return true;
  } catch (err) {
    console.warn('[avalieImobLeads] notificarCEOWhatsApp falhou:', (err as Error).message);
    return false;
  }
}

async function notificarCEOTelegram(p: AvalieImobLeadPayload): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  try {
    // Telegram suporta Markdown legacy. Asteriscos em volta = bold; emoji nativos OK.
    // Escapamos caracteres reservados ('_', '*', '[', ']', '`') no nome/email do lead
    // pra evitar erro de parsing. Usamos 'Markdown' (legacy) que e mais permissivo.
    const text = mensagemCEO(p);
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) {
      // Se Markdown falhar (algum caractere especial), tenta em texto puro
      const errBody = await r.text();
      console.warn('[avalieImobLeads] Telegram (markdown) falhou, tentando plain:', r.status, errBody.slice(0, 120));
      const r2 = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      });
      if (!r2.ok) {
        console.warn('[avalieImobLeads] Telegram (plain) tambem falhou:', r2.status);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.warn('[avalieImobLeads] notificarCEOTelegram falhou:', (err as Error).message);
    return false;
  }
}

async function responderLeadAuto(p: AvalieImobLeadPayload): Promise<boolean> {
  if (!p.phone || p.phone.replace(/\D/g, '').length < 10) return false;
  try {
    await sendReply(p.phone, mensagemLead(p));
    return true;
  } catch (err) {
    console.warn('[avalieImobLeads] responderLeadAuto falhou:', (err as Error).message);
    return false;
  }
}

async function enviarEmailCEO(p: AvalieImobLeadPayload): Promise<void> {
  if (!RESEND_API_KEY) return; // No-op se chave nao configurada
  try {
    const subject = `${emojiEvento(p.event_type)} ${tituloEvento(p.event_type)}: ${p.name}`;
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#0d4f3c;margin:0 0 12px;">${tituloEvento(p.event_type)}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#888;width:120px;">Nome</td><td><strong>${escapeHtml(p.name)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#888;">Email</td><td>${escapeHtml(p.email)}</td></tr>
          ${p.phone ? `<tr><td style="padding:6px 0;color:#888;">Telefone</td><td>${escapeHtml(p.phone)}</td></tr>` : ''}
          ${p.role ? `<tr><td style="padding:6px 0;color:#888;">Categoria</td><td>${escapeHtml(p.role)}${p.crea ? ` · CREA ${escapeHtml(p.crea)}` : ''}</td></tr>` : ''}
          ${p.event_type === 'assinatura' && p.assinatura_plano ? `<tr><td style="padding:6px 0;color:#888;">Plano</td><td><strong>${escapeHtml(p.assinatura_plano)}</strong>${p.assinatura_valor ? ` (R$ ${p.assinatura_valor.toFixed(2)})` : ''}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#888;">Página</td><td>${escapeHtml(p.page_origin || '/')}</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Source</td><td>${escapeHtml(formatarSource(p))}</td></tr>
        </table>
        <p style="margin-top:24px;color:#888;font-size:12px;">Notificação automática da ZAYRA · AvalieImob</p>
      </div>
    `;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [CEO_EMAIL], subject, html }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.warn('[avalieImobLeads] Resend retornou erro:', r.status, t.slice(0, 200));
    }
  } catch (err) {
    console.warn('[avalieImobLeads] enviarEmailCEO falhou:', (err as Error).message);
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── Orquestrador principal ───────────────────────────────────────────────────
export async function processarLeadWebhook(p: AvalieImobLeadPayload): Promise<{
  ok: boolean;
  lead_id: number;
  novo: boolean;
  notificou_whatsapp: boolean;
  notificou_telegram: boolean;
  respondeu_lead: boolean;
}> {
  if (!p?.email || !p?.name) {
    throw new Error('payload invalido: email e name obrigatorios');
  }

  const { id, novo } = await salvarLead(p);
  let notificouWa = false;
  let notificouTg = false;
  let respondeu = false;

  // So notifica/responde se for lead novo (evita spam em retry de webhook)
  if (novo) {
    // Disparam em paralelo (independentes). Tudo bem se algum falhar — outros
    // canais ainda entregam a notificacao.
    const [waOk, tgOk, , leadOk] = await Promise.all([
      notificarCEOWhatsApp(p),
      notificarCEOTelegram(p),
      enviarEmailCEO(p),               // no-op se RESEND_API_KEY nao setada
      responderLeadAuto(p),
    ]);

    notificouWa = waOk;
    notificouTg = tgOk;
    respondeu   = leadOk;

    // Marca flags na tabela em background (nao bloqueia retorno)
    void Promise.all([
      waOk    ? marcarNotificado(id, 'ja_notificou_ceo')      : null,
      tgOk    ? marcarNotificado(id, 'ja_notificou_telegram') : null,
      leadOk  ? marcarNotificado(id, 'ja_respondeu_lead')     : null,
    ].filter(Boolean));
  }

  return {
    ok: true,
    lead_id: id,
    novo,
    notificou_whatsapp: notificouWa,
    notificou_telegram: notificouTg,
    respondeu_lead: respondeu,
  };
}

// ── Consulta (usado pela tool da ZAYRA + briefing semanal) ───────────────────
export async function consultarLeads(input: {
  dias?: number;
  event_type?: 'cadastro' | 'assinatura' | 'login' | 'outro';
  limit?: number;
} = {}): Promise<{
  total: number;
  por_evento: Record<string, number>;
  top_paginas: { page: string; count: number }[];
  top_sources: { source: string; count: number }[];
  ultimos: Array<{
    id: number; nome: string; email: string; phone: string | null;
    event_type: string; page_origin: string | null;
    utm_source: string | null; created_at: string;
  }>;
}> {
  const dias  = Math.max(1, Math.min(365, input.dias  ?? 7));
  const limit = Math.max(1, Math.min(100, input.limit ?? 20));

  const sqlBase = `FROM romatec_avalieimob_leads WHERE created_at > (NOW() - INTERVAL ? DAY)`;
  const params: (string | number)[] = [dias];
  let extra = '';
  if (input.event_type) {
    extra = ` AND event_type = ?`;
    params.push(input.event_type);
  }

  const [totalRow] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${sqlBase}${extra}`, params
  );
  const total = Number(totalRow[0]?.total ?? 0);

  const [porEventoRows] = await pool.execute<RowDataPacket[]>(
    `SELECT event_type, COUNT(*) AS count ${sqlBase} GROUP BY event_type`,
    [dias]
  );
  const por_evento: Record<string, number> = {};
  for (const r of porEventoRows) por_evento[r.event_type as string] = Number(r.count);

  const [topPagsRows] = await pool.execute<RowDataPacket[]>(
    `SELECT page_origin AS page, COUNT(*) AS count ${sqlBase}${extra}
       AND page_origin IS NOT NULL
     GROUP BY page_origin ORDER BY count DESC LIMIT 5`,
    params
  );
  const top_paginas = topPagsRows.map((r: RowDataPacket) => ({ page: String(r.page), count: Number(r.count) }));

  const [topSrcRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(utm_source, 'direto') AS source, COUNT(*) AS count
       ${sqlBase}${extra}
     GROUP BY COALESCE(utm_source, 'direto') ORDER BY count DESC LIMIT 5`,
    params
  );
  const top_sources = topSrcRows.map((r: RowDataPacket) => ({ source: String(r.source), count: Number(r.count) }));

  const [ultimosRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name AS nome, email, phone, event_type, page_origin, utm_source, created_at
       ${sqlBase}${extra}
     ORDER BY created_at DESC LIMIT ${limit}`,
    params
  );
  const ultimos = ultimosRows.map((r: RowDataPacket) => ({
    id: Number(r.id),
    nome: String(r.nome),
    email: String(r.email),
    phone: r.phone as string | null,
    event_type: String(r.event_type),
    page_origin: r.page_origin as string | null,
    utm_source: r.utm_source as string | null,
    created_at: String(r.created_at),
  }));

  return { total, por_evento, top_paginas, top_sources, ultimos };
}
