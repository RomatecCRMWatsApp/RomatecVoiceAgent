// Sistema proativo de alertas (v1.39.0).
// Roda detectores periodicamente, deduplica via romatec_proactive_alerts e
// envia notificações ao CEO pelo Telegram (e SSE pra UI quando aberta).
//
// Filosofia:
//   - Não spammar: mesmo problema = não envia 2x em 24h (configurável por urgência)
//   - Resumir quando há muitos alertas (>5 simultâneos vira "X alertas pendentes")
//   - Permitir silenciar via tool 'silenciar_alerta' até X horas
//   - Mostra urgency com emoji (🟢 low / 🟡 medium / 🔴 high / 🚨 urgent)

import type { Response } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { rodarTodosDetectores, type Alert } from './proactiveDetectors';
import { sendMessage as sendTelegram } from '../integrations/telegram';

export interface Notification {
  id:        string;
  type:      'alert' | 'suggestion' | 'reminder' | 'urgent';
  title:     string;
  message:   string;
  urgency:   'low' | 'medium' | 'high' | 'urgent';
  timestamp: string;
}

interface SSEClient { id: string; res: Response; }
const clients: SSEClient[] = [];

export function addSSEClient(res: Response): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  clients.push({ id, res });
  return id;
}
export function removeSSEClient(id: string): void {
  const idx = clients.findIndex(c => c.id === id);
  if (idx !== -1) clients.splice(idx, 1);
}
function broadcastSSE(n: Notification): void {
  const chunk = `data: ${JSON.stringify(n)}\n\n`;
  for (const c of [...clients]) {
    try { c.res.write(chunk); } catch { removeSSEClient(c.id); }
  }
}
export function broadcastNotification(n: Notification): void {
  broadcastSSE(n);
}

const URGENCY_EMOJI: Record<Alert['urgency'], string> = {
  low:    '🟢',
  medium: '🟡',
  high:   '🔴',
  urgent: '🚨',
};

// Período mínimo de re-envio do mesmo alerta, baseado na urgência.
// Alertas urgentes podem ser re-enviados a cada 4h, baixos só após 48h.
const RESEND_HOURS: Record<Alert['urgency'], number> = {
  low:    48,
  medium: 24,
  high:   12,
  urgent: 4,
};

// Salva ou atualiza alerta no banco. Retorna `true` se DEVE notificar agora,
// `false` se já foi notificado recentemente (dedup).
async function shouldNotify(alert: Alert): Promise<boolean> {
  type Row = RowDataPacket & {
    id: number; last_sent: Date | null; silenced_until: Date | null;
    acknowledged_at: Date | null; send_count: number;
  };
  const [rows] = await pool.execute<Row[]>(
    'SELECT id, last_sent, silenced_until, acknowledged_at, send_count FROM romatec_proactive_alerts WHERE alert_key = ?',
    [alert.alert_key],
  );

  const resendAfter = RESEND_HOURS[alert.urgency] * 60 * 60 * 1000;
  const now = new Date();

  if (rows.length === 0) {
    // Primeira vez — insere e marca pra notificar
    await pool.execute<ResultSetHeader>(
      `INSERT INTO romatec_proactive_alerts
       (alert_key, detector, type, urgency, title, message, payload, last_sent, send_count)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [
        alert.alert_key, alert.detector, alert.type, alert.urgency,
        alert.title, alert.message, JSON.stringify(alert.payload || {}), now,
      ],
    );
    return true;
  }

  const row = rows[0];
  // Silenciado pelo CEO?
  if (row.silenced_until && new Date(row.silenced_until) > now) return false;
  // Reconhecido (acknowledged) e ainda não passou tempo de re-disparo
  if (row.acknowledged_at) {
    const since = now.getTime() - new Date(row.acknowledged_at).getTime();
    if (since < resendAfter * 2) return false; // ack dobra o intervalo
  }
  // Já enviado há pouco?
  if (row.last_sent) {
    const since = now.getTime() - new Date(row.last_sent).getTime();
    if (since < resendAfter) return false;
  }

  // Atualiza message/title (caso payload tenha mudado) e marca como pra enviar
  await pool.execute(
    `UPDATE romatec_proactive_alerts
     SET title = ?, message = ?, payload = ?, last_sent = ?, send_count = send_count + 1, urgency = ?
     WHERE id = ?`,
    [alert.title, alert.message, JSON.stringify(alert.payload || {}), now, alert.urgency, row.id],
  );
  return true;
}

// Limpa alertas que não foram detectados novamente (problema resolvido).
// Marca como acknowledged automaticamente alertas com last_sent > 30 dias.
async function limparAlertasResolvidos(currentKeys: string[]): Promise<number> {
  if (currentKeys.length === 0) return 0;
  const placeholders = currentKeys.map(() => '?').join(',');
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_proactive_alerts
     SET acknowledged_at = NOW()
     WHERE alert_key NOT IN (${placeholders})
       AND acknowledged_at IS NULL
       AND last_sent < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    currentKeys,
  );
  return r.affectedRows;
}

function formatTelegramAlerts(alerts: Alert[]): string {
  const ordenados = alerts.sort((a, b) => {
    const order = { urgent: 0, high: 1, medium: 2, low: 3 };
    return order[a.urgency] - order[b.urgency];
  });
  if (ordenados.length === 1) {
    const a = ordenados[0];
    return `${URGENCY_EMOJI[a.urgency]} *${a.title}*\n\n${a.message}`;
  }
  const linhas = ordenados.map(a => `${URGENCY_EMOJI[a.urgency]} *${a.title}*\n${a.message}`);
  return `🔔 *${ordenados.length} alertas pendentes*\n\n${linhas.join('\n\n')}`;
}

async function sendToCeoTelegram(alerts: Alert[]): Promise<void> {
  const chatIds = (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (chatIds.length === 0 || !process.env.TELEGRAM_BOT_TOKEN) return;
  const text = formatTelegramAlerts(alerts);
  for (const chatId of chatIds) {
    try {
      await sendTelegram(chatId, text);
    } catch (err) {
      console.warn(`[proactive] falha ao enviar pra Telegram chat=${chatId}:`, (err as Error).message);
    }
  }
}

async function runCheck(): Promise<void> {
  try {
    const todos = await rodarTodosDetectores();
    if (todos.length === 0) return;

    // Filtra os que devem ser notificados (passa pelo dedup)
    const aNotificar: Alert[] = [];
    for (const alert of todos) {
      if (await shouldNotify(alert)) aNotificar.push(alert);
    }

    // Limpa alertas que sumiram (problema resolvido)
    await limparAlertasResolvidos(todos.map(a => a.alert_key));

    if (aNotificar.length === 0) {
      console.log(`[proactive] ${todos.length} alertas detectados, todos já notificados recentemente (dedup)`);
      return;
    }

    console.log(`[proactive] enviando ${aNotificar.length} alerta(s) novo(s) pra Telegram`);

    // Telegram — uma mensagem só com todos os alertas
    await sendToCeoTelegram(aNotificar);

    // SSE — broadcast individual pra UI
    for (const a of aNotificar) {
      broadcastSSE({
        id:        a.alert_key,
        type:      a.type,
        title:     a.title,
        message:   a.message,
        urgency:   a.urgency === 'urgent' ? 'high' : a.urgency,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[proactive runCheck]', err instanceof Error ? err.message : err);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startProactiveNotifications(): void {
  if (timer) return;
  // Roda 30s após boot pra dar tempo de DB conectar, depois a cada 30 min
  setTimeout(() => { void runCheck(); }, 30_000);
  timer = setInterval(() => { void runCheck(); }, 30 * 60 * 1000);
  console.log('[proactive] notificações proativas iniciadas (check a cada 30 min)');
}

// Tools admin pra ZAYRA gerenciar alertas
export async function listarAlertasPendentes(input: { limite?: number } = {}): Promise<Array<{
  id: string; alert_key: string; detector: string; urgency: string; title: string;
  message: string; first_detected: string; last_sent: string | null;
  acknowledged: boolean; silenciado: boolean; send_count: number;
}>> {
  type Row = RowDataPacket & {
    id: number; alert_key: string; detector: string; urgency: string;
    title: string; message: string; first_detected: Date; last_sent: Date | null;
    acknowledged_at: Date | null; silenced_until: Date | null; send_count: number;
  };
  const limit = Math.min(Math.max(input.limite ?? 30, 1), 200);
  const [rows] = await pool.execute<Row[]>(
    `SELECT id, alert_key, detector, urgency, title, message, first_detected,
            last_sent, acknowledged_at, silenced_until, send_count
     FROM romatec_proactive_alerts
     WHERE acknowledged_at IS NULL
     ORDER BY FIELD(urgency,'urgent','high','medium','low'), first_detected DESC
     LIMIT ${limit}`,
  );
  return rows.map(r => ({
    id:             String(r.id),
    alert_key:      r.alert_key,
    detector:       r.detector,
    urgency:        r.urgency,
    title:          r.title,
    message:        r.message,
    first_detected: r.first_detected.toISOString(),
    last_sent:      r.last_sent ? r.last_sent.toISOString() : null,
    acknowledged:   !!r.acknowledged_at,
    silenciado:     !!(r.silenced_until && new Date(r.silenced_until) > new Date()),
    send_count:     r.send_count,
  }));
}

export async function silenciarAlerta(input: { alert_key: string; horas?: number }): Promise<{ ok: boolean; silenciado_ate: string }> {
  const horas = Math.min(Math.max(input.horas ?? 24, 1), 720);
  const silenciadoAte = new Date(Date.now() + horas * 60 * 60 * 1000);
  await pool.execute(
    'UPDATE romatec_proactive_alerts SET silenced_until = ? WHERE alert_key = ?',
    [silenciadoAte, input.alert_key],
  );
  return { ok: true, silenciado_ate: silenciadoAte.toISOString() };
}

export async function reconhecerAlerta(input: { alert_key: string }): Promise<{ ok: boolean }> {
  await pool.execute(
    'UPDATE romatec_proactive_alerts SET acknowledged_at = NOW() WHERE alert_key = ?',
    [input.alert_key],
  );
  return { ok: true };
}

// Roda manualmente os detectores agora (útil pra ZAYRA testar via tool)
export async function rodarDetectoresAgora(): Promise<{ alertas_detectados: number; alertas_novos: number; alertas: Alert[] }> {
  const todos = await rodarTodosDetectores();
  const novos: Alert[] = [];
  for (const a of todos) {
    if (await shouldNotify(a)) novos.push(a);
  }
  if (novos.length > 0) await sendToCeoTelegram(novos);
  return { alertas_detectados: todos.length, alertas_novos: novos.length, alertas: todos };
}
