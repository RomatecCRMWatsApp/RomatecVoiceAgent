// v3.54.0 — Job de lembrete D-1 das diligências confirmadas.
// Sem node-cron (não está no projeto): usa o mesmo padrão setInterval/checagem
// de hora BRT dos demais tickers do server.ts. Dispara 1x quando bate 08:00 BRT.
import { enviarLembretesDiligencias } from '../integrations/diligencias';

let ultimaExecucao = '';

/** Registra o ticker (checa a cada 60s; roda às 08:00 BRT, 1x/dia). */
export function iniciarJobLembretesDiligencias(): void {
  const tick = async () => {
    const now = new Date();
    const brtHour = (now.getUTCHours() + 21) % 24; // BRT = UTC-3
    const brtMin = now.getUTCMinutes();
    const hojeKey = now.toISOString().slice(0, 10);
    if (brtHour === 8 && brtMin === 0 && ultimaExecucao !== hojeKey) {
      ultimaExecucao = hojeKey;
      try {
        const r = await enviarLembretesDiligencias();
        console.log(`[diligencias:lembrete] ${r.enviados} enviados, ${r.falhas} falhas`);
      } catch (err) {
        console.warn('[diligencias:lembrete] erro:', (err as Error).message);
      }
    }
  };
  setInterval(() => { void tick(); }, 60_000);
  console.log('[diligencias:lembrete] ticker iniciado (08:00 BRT, D-1)');
}
