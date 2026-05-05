import { think } from './think';
import { sendReply } from '../integrations/whatsapp';

const CEO_PHONE = process.env.CEO_WHATSAPP_PHONE ?? '';

// Fallback contra loop infinito: se o cálculo der NaN/inválido/<60s, usa 1h.
const FALLBACK_DELAY_MS = 60 * 60 * 1000;
const MIN_VALID_DELAY_MS = 60 * 1000;

/**
 * Calcula ms até o próximo HH:MM no fuso de Fortaleza (BRT = UTC-3, sem DST).
 *
 * Bug histórico (corrigido em fix/scheduler-briefing-nan-loop):
 *   `new Date(date.toLocaleString('en-CA', { timeZone: 'America/Fortaleza' }))`
 *   produzia "2026-05-01, 00:35:04" (com vírgula), que `new Date()` parseia como
 *   Invalid Date no Node 20. A cadeia subsequente propagava NaN até o setTimeout,
 *   que o Node trata como 1ms — resultando em loop infinito disparando o briefing
 *   centenas de vezes por hora (incidente 2026-05-01).
 *
 * Fix: usa Intl.DateTimeFormat.formatToParts() — única forma robusta de extrair
 * componentes de hora em timezone específica sem parsear strings.
 */
function msUntilNext(hour: number, minute = 0): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? NaN);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? NaN);
  const s = Number(parts.find(p => p.type === 'second')?.value ?? NaN);

  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) {
    console.warn(`[Scheduler] ⚠️ Intl.formatToParts retornou valores inválidos (h=${h} m=${m} s=${s}) — fallback 1h`);
    return FALLBACK_DELAY_MS;
  }

  // Em algumas versões do ICU, "24" aparece em vez de "00" à meia-noite.
  const hourNorm = h === 24 ? 0 : h;

  const nowSecs    = hourNorm * 3600 + m * 60 + s;
  const targetSecs = hour     * 3600 + minute * 60;
  const diffSecs   = targetSecs > nowSecs
    ? targetSecs - nowSecs
    : 24 * 3600 - nowSecs + targetSecs;

  return diffSecs * 1000;
}

async function sendDailyBriefing(): Promise<void> {
  if (!CEO_PHONE) {
    console.warn('[Scheduler] CEO_WHATSAPP_PHONE não configurado — briefing diário desabilitado');
    return;
  }
  try {
    console.log('[Scheduler] Gerando briefing diário das 8h...');
    const resp = await think(
      'Gere o resumo executivo diário completo para o CEO José Romário com estas seções: ' +
      '1) leads do CRM Romatec (total, novos, em atendimento); ' +
      '2) leads do AvalieImob das últimas 24h via consultar_leads_avalieimob (total, top fontes utm_source, top páginas de origem, novas assinaturas). Se não houver leads, mencione "sem leads novos no AvalieImob"; ' +
      '3) contratos pendentes no AvalieImob; ' +
      '4) campanhas ativas; ' +
      '5) agenda de hoje no Google Calendar. ' +
      'Seja conciso, executivo e use emojis para facilitar a leitura no WhatsApp.',
    );
    await sendReply(CEO_PHONE, resp.text);
    console.log('[Scheduler] ✅ Briefing diário enviado ao CEO via WhatsApp');
  } catch (err) {
    console.error('[Scheduler] ❌ Erro ao enviar briefing diário:', err);
  }
}

export function startDailyScheduler(): void {
  const BRIEFING_HOUR   = parseInt(process.env.BRIEFING_HOUR   ?? '8', 10);
  const BRIEFING_MINUTE = parseInt(process.env.BRIEFING_MINUTE ?? '0', 10);

  // Se as env vars vierem com lixo (NaN do parseInt), usa default e avisa.
  const safeHour   = Number.isFinite(BRIEFING_HOUR)   && BRIEFING_HOUR   >= 0 && BRIEFING_HOUR   < 24 ? BRIEFING_HOUR   : 8;
  const safeMinute = Number.isFinite(BRIEFING_MINUTE) && BRIEFING_MINUTE >= 0 && BRIEFING_MINUTE < 60 ? BRIEFING_MINUTE : 0;
  if (safeHour !== BRIEFING_HOUR || safeMinute !== BRIEFING_MINUTE) {
    console.warn(`[Scheduler] env BRIEFING_HOUR/MINUTE inválido — usando ${safeHour}:${safeMinute}`);
  }

  const schedule = () => {
    let delay = msUntilNext(safeHour, safeMinute);

    // GUARD ANTI-LOOP: defesa em profundidade caso msUntilNext um dia falhe.
    // setTimeout(NaN) ou setTimeout(<1ms) executa imediatamente em loop.
    if (!Number.isFinite(delay) || delay < MIN_VALID_DELAY_MS) {
      console.error(
        `[Scheduler] 🚨 GUARD ANTI-LOOP: delay=${delay}ms é inválido ou muito curto. ` +
        `Aplicando fallback de 1h pra evitar disparo em loop. ` +
        `Investigar msUntilNext(${safeHour}, ${safeMinute}).`,
      );
      delay = FALLBACK_DELAY_MS;
    }

    const horas = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[Scheduler] Próximo briefing diário em ${horas}h (${safeHour}:${String(safeMinute).padStart(2, '0')} BRT)`);

    setTimeout(async () => {
      await sendDailyBriefing();
      schedule(); // Agenda o próximo
    }, delay);
  };

  schedule();
}
