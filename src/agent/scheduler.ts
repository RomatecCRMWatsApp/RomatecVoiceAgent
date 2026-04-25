import { think } from './think';
import { sendReply } from '../integrations/whatsapp';

const CEO_PHONE = process.env.CEO_WHATSAPP_PHONE ?? '';

// Calcula ms até o próximo HH:MM no fuso de Fortaleza (BRT = UTC-3)
function msUntilNext(hour: number, minute = 0): number {
  const now = new Date();
  const bsb = new Date(now.toLocaleString('en-CA', { timeZone: 'America/Fortaleza', hour12: false }));
  const [h, m, s] = (bsb.toTimeString().split(' ')[0]).split(':').map(Number);

  const nowSecs = h * 3600 + m * 60 + s;
  const targetSecs = hour * 3600 + minute * 60;
  const diffSecs = targetSecs > nowSecs
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
      'Gere o resumo executivo diário completo para o CEO José Romário: ' +
      'leads do CRM (total, novos, em atendimento), contratos pendentes no AvalieImob, ' +
      'campanhas ativas, e agenda de hoje no Google Calendar. ' +
      'Seja conciso, executivo e use emojis para facilitar a leitura no WhatsApp.',
    );
    await sendReply(CEO_PHONE, resp.text);
    console.log('[Scheduler] ✅ Briefing diário enviado ao CEO via WhatsApp');
  } catch (err) {
    console.error('[Scheduler] ❌ Erro ao enviar briefing diário:', err);
  }
}

export function startDailyScheduler(): void {
  const BRIEFING_HOUR = parseInt(process.env.BRIEFING_HOUR ?? '8', 10);
  const BRIEFING_MINUTE = parseInt(process.env.BRIEFING_MINUTE ?? '0', 10);

  const schedule = () => {
    const delay = msUntilNext(BRIEFING_HOUR, BRIEFING_MINUTE);
    const horas = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[Scheduler] Próximo briefing diário em ${horas}h (${BRIEFING_HOUR}:${String(BRIEFING_MINUTE).padStart(2, '0')} BRT)`);

    setTimeout(async () => {
      await sendDailyBriefing();
      schedule(); // Agenda o próximo
    }, delay);
  };

  schedule();
}
