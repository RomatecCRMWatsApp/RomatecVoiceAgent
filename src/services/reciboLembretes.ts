// v1.72.0 — Cron de lembretes e expiração automática de recibos.
//
// Roda em setInterval (intervalo configuravel via env RECIBO_CRON_HOURS,
// default 6h). Sem fila externa pra simplicidade — em volume alto trocar
// por BullMQ na fase SaaS.
//
// 2 trabalhos:
//   1) Lembrar: recibo enviado ha +24h e ainda sem resposta -> reenvia
//      (mensagem mais curta) + atualiza last_reminder_at. So 1 lembrete
//      por dia (nao spamma se cron rodar varias vezes).
//   2) Expirar: recibo com expires_at < NOW() e nao terminal -> marca
//      como 'expirado'.

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { reenviarRecibo } from '../integrations/recibos';

const HOURS = Number(process.env.RECIBO_CRON_HOURS) || 6;
const REENVIO_APOS_HORAS = Number(process.env.RECIBO_REENVIO_APOS_HORAS) || 24;
let timer: NodeJS.Timeout | null = null;

async function lembrarPendentes(): Promise<{ tentativas: number; sucesso: number }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, numero FROM recibos
      WHERE status IN ('enviado','entregue','lido')
        AND enviado_em IS NOT NULL
        AND enviado_em < NOW() - INTERVAL ? HOUR
        AND (last_reminder_at IS NULL OR last_reminder_at < NOW() - INTERVAL 24 HOUR)
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 50`,
    [REENVIO_APOS_HORAS]
  );
  let sucesso = 0;
  for (const r of rows) {
    try {
      await reenviarRecibo(Number(r.id));
      sucesso++;
      console.log(`[recibos:cron] lembrete enviado: ${r.numero}`);
    } catch (err) {
      console.warn(`[recibos:cron] falha lembrete ${r.numero}:`, (err as Error).message);
    }
  }
  return { tentativas: rows.length, sucesso };
}

async function marcarExpirados(): Promise<number> {
  const [r] = await pool.execute(
    `UPDATE recibos SET status = 'expirado'
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW()
        AND status NOT IN ('confirmado','contestado','cancelado','expirado')`,
    []
  );
  const affected = (r as { affectedRows?: number }).affectedRows || 0;
  if (affected > 0) {
    console.log(`[recibos:cron] ${affected} recibo(s) marcado(s) como expirado`);
  }
  return affected;
}

async function rodar(): Promise<void> {
  console.log('[recibos:cron] iniciando ciclo...');
  try {
    const expirados = await marcarExpirados();
    const { tentativas, sucesso } = await lembrarPendentes();
    console.log(`[recibos:cron] ciclo OK — expirados:${expirados} lembretes:${sucesso}/${tentativas}`);
  } catch (err) {
    console.error('[recibos:cron] erro no ciclo:', (err as Error).message);
  }
}

export function iniciarLembretesCron(): void {
  if (timer) return; // ja rodando
  console.log(`[recibos:cron] iniciando — intervalo ${HOURS}h, lembrar apos ${REENVIO_APOS_HORAS}h`);
  // Primeira execucao em 5min apos boot (deixa o servidor estabilizar)
  setTimeout(() => { void rodar(); }, 5 * 60 * 1000);
  // Depois a cada N horas
  timer = setInterval(() => { void rodar(); }, HOURS * 60 * 60 * 1000);
}

export function pararLembretesCron(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

// Exporta pra teste/admin manual
export { rodar as rodarCronManual };
