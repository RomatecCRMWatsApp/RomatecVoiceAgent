// Sistema de alarmes/despertadores (v1.19).
// Disparo via SSE (browser/PWA push) + Telegram (chega no celular mesmo offline).
// Scheduler tick a cada 60s checa proximos alarmes.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { broadcastNotification } from '../agent/proactive';
import * as telegram from './telegram';
import { formatBR } from '../util/format';

type AlarmeRow = RowDataPacket & {
  id: number;
  titulo: string;
  descricao: string | null;
  trigger_at: Date;
  repeticao: 'uma_vez' | 'diario' | 'semanal' | 'dias_uteis';
  canais: string;
  status: 'ativo' | 'disparado' | 'cancelado';
  ultimo_disparo: Date | null;
  proximo_disparo: Date | null;
};

export interface MutationResult {
  preview?: boolean;
  ok?:      true;
  affected?: number;
  insertId?: number;
  message:  string;
}

// Aceita formatos: "2026-04-26 14:30", "2026-04-26T14:30:00", "14:30 hoje", "14:30 amanha"
function parseDataHora(input: string): Date {
  const s = input.trim().toLowerCase();
  const now = new Date();

  // "HH:MM hoje" ou "HH:MM amanha" ou "HH:MM" (assume hoje, ou amanhã se já passou)
  const mHora = s.match(/^(\d{1,2}):(\d{2})(\s*(hoje|amanha|amanhã))?$/);
  if (mHora) {
    const h = Number(mHora[1]); const min = Number(mHora[2]);
    const target = new Date(now);
    target.setHours(h, min, 0, 0);
    if (mHora[4] === 'amanha' || mHora[4] === 'amanhã') {
      target.setDate(target.getDate() + 1);
    } else if (!mHora[4] && target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);  // já passou hoje, joga pra amanhã
    }
    return target;
  }

  // ISO ou "YYYY-MM-DD HH:MM"
  const iso = s.replace(' ', 'T').replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/, '$1:00');
  const d = new Date(iso);
  if (!isNaN(d.getTime())) return d;

  throw new Error(`Não consegui interpretar a data/hora: "${input}". Use "HH:MM", "HH:MM amanhã", ou "YYYY-MM-DD HH:MM".`);
}

function calcularProximoDisparo(trigger: Date, repeticao: string, fromBase: Date): Date | null {
  if (repeticao === 'uma_vez') return null;
  const next = new Date(fromBase);
  if (repeticao === 'diario') {
    next.setDate(next.getDate() + 1);
  } else if (repeticao === 'semanal') {
    next.setDate(next.getDate() + 7);
  } else if (repeticao === 'dias_uteis') {
    do { next.setDate(next.getDate() + 1); }
    while (next.getDay() === 0 || next.getDay() === 6); // pula sáb/dom
  } else {
    return null;
  }
  // Mantém hora original do trigger
  next.setHours(trigger.getHours(), trigger.getMinutes(), 0, 0);
  return next;
}

export async function criarAlarme(input: {
  titulo: string;
  quando: string;        // "14:30 hoje", "2026-04-27 09:00", etc.
  descricao?: string;
  repeticao?: 'uma_vez' | 'diario' | 'semanal' | 'dias_uteis';
  canais?: string;       // "sse", "telegram", "sse,telegram"
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.titulo) throw new Error('titulo obrigatório');
  if (!input.quando)  throw new Error('quando obrigatório');
  const triggerAt = parseDataHora(input.quando);
  if (triggerAt.getTime() < Date.now()) {
    throw new Error(`Data/hora "${input.quando}" já passou (interpretei como ${triggerAt.toLocaleString('pt-BR')}).`);
  }
  const rep    = input.repeticao ?? 'uma_vez';
  const canais = input.canais ?? 'sse,telegram';

  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Criar alarme "${input.titulo}" em ${formatBR(triggerAt)} (${rep}, canais: ${canais}). Reenvie com confirm:true.`,
    };
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO zayra_alarmes (titulo, descricao, trigger_at, repeticao, canais, proximo_disparo)
     VALUES (?,?,?,?,?,?)`,
    [
      input.titulo, input.descricao ?? null,
      triggerAt, rep, canais, triggerAt,
    ],
  );
  return { ok: true, insertId: r.insertId, message: `Alarme "${input.titulo}" criado pra ${formatBR(triggerAt)}.` };
}

export async function listarAlarmes(input: { status?: 'ativo' | 'disparado' | 'cancelado'; limite?: number } = {}) {
  const params: (string | number)[] = [];
  let sql = 'SELECT * FROM zayra_alarmes';
  if (input.status) { sql += ' WHERE status = ?'; params.push(input.status); }
  else { sql += ' WHERE status != \'cancelado\''; }
  const limit = Math.min(Math.max(Number(input.limite) || 50, 1), 200);
  sql += ` ORDER BY proximo_disparo ASC LIMIT ${limit}`;
  const [rows] = await pool.execute<AlarmeRow[]>(sql, params);
  return rows.map(r => ({
    id:              String(r.id),
    titulo:          r.titulo,
    descricao:       r.descricao,
    repeticao:       r.repeticao,
    canais:          r.canais,
    status:          r.status,
    proximo_disparo: r.proximo_disparo ? formatBR(r.proximo_disparo) : null,
    ultimo_disparo:  r.ultimo_disparo  ? formatBR(r.ultimo_disparo)  : null,
  }));
}

export async function cancelarAlarme(input: { id: string; confirm?: boolean }): Promise<MutationResult> {
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Cancelar alarme ${input.id}. Reenvie com confirm:true.` };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    'UPDATE zayra_alarmes SET status = \'cancelado\' WHERE id = ?', [input.id],
  );
  return { ok: true, affected: r.affectedRows, message: `Alarme ${input.id} cancelado.` };
}

export async function atualizarAlarme(input: {
  id: string; titulo?: string; descricao?: string; quando?: string;
  repeticao?: 'uma_vez' | 'diario' | 'semanal' | 'dias_uteis';
  canais?: string; confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.id) throw new Error('id obrigatório');
  const fields: string[] = []; const params: (string | number | Date | null)[] = [];
  if (input.titulo    !== undefined) { fields.push('titulo = ?');    params.push(input.titulo); }
  if (input.descricao !== undefined) { fields.push('descricao = ?'); params.push(input.descricao); }
  if (input.repeticao !== undefined) { fields.push('repeticao = ?'); params.push(input.repeticao); }
  if (input.canais    !== undefined) { fields.push('canais = ?');    params.push(input.canais); }
  if (input.quando) {
    const t = parseDataHora(input.quando);
    fields.push('trigger_at = ?', 'proximo_disparo = ?', 'status = \'ativo\'');
    params.push(t, t);
  }
  if (fields.length === 0) throw new Error('nada pra atualizar');
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Atualizar alarme ${input.id}: ${fields.join(', ')}. Reenvie com confirm:true.` };
  }
  params.push(input.id);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE zayra_alarmes SET ${fields.join(', ')} WHERE id = ?`, params,
  );
  return { ok: true, affected: r.affectedRows, message: `Alarme ${input.id} atualizado.` };
}

// ── Tick do scheduler ────────────────────────────────────────────────────────
async function dispararAlarme(a: AlarmeRow): Promise<void> {
  const canais = (a.canais ?? 'sse,telegram').split(',').map(c => c.trim());
  const titulo = `⏰ ${a.titulo}`;
  const corpo  = a.descricao ?? '';

  if (canais.includes('sse')) {
    try {
      broadcastNotification({
        id:        `alarm_${a.id}_${Date.now()}`,
        type:      'reminder',
        title:     titulo,
        message:   corpo || 'Alarme programado por você.',
        urgency:   'high',
        timestamp: new Date().toISOString(),
      });
    } catch (e) { console.warn('[alarme] SSE falhou:', (e as Error).message); }
  }

  if (canais.includes('telegram') && process.env.TELEGRAM_AUTHORIZED_USER_IDS) {
    const ids = process.env.TELEGRAM_AUTHORIZED_USER_IDS.split(',').map(s => s.trim()).filter(Boolean);
    const msg = `⏰ *${a.titulo}*${corpo ? '\n\n' + corpo : ''}\n\n_Alarme programado pela ZAYRA._`;
    for (const id of ids) {
      try { await telegram.sendMessage(id, msg); }
      catch (e) { console.warn('[alarme] Telegram', id, 'falhou:', (e as Error).message); }
    }
  }
}

export async function checkAlarmes(): Promise<number> {
  const [rows] = await pool.execute<AlarmeRow[]>(
    `SELECT * FROM zayra_alarmes
     WHERE status = 'ativo' AND proximo_disparo IS NOT NULL AND proximo_disparo <= NOW()
     ORDER BY proximo_disparo ASC LIMIT 50`,
  );
  if (rows.length === 0) return 0;

  for (const a of rows) {
    try {
      await dispararAlarme(a);

      const next = calcularProximoDisparo(a.trigger_at, a.repeticao, new Date());
      if (next) {
        await pool.execute(
          'UPDATE zayra_alarmes SET ultimo_disparo = NOW(), proximo_disparo = ? WHERE id = ?',
          [next, a.id],
        );
      } else {
        await pool.execute(
          'UPDATE zayra_alarmes SET ultimo_disparo = NOW(), status = \'disparado\', proximo_disparo = NULL WHERE id = ?',
          [a.id],
        );
      }
    } catch (e) {
      console.warn('[alarme] dispararAlarme falhou pro alarme', a.id, ':', (e as Error).message);
    }
  }
  return rows.length;
}

let _tickHandle: NodeJS.Timeout | null = null;
export function startAlarmesTicker(intervalMs = 60_000): void {
  if (_tickHandle) return;
  _tickHandle = setInterval(() => {
    checkAlarmes().catch(err => console.warn('[alarmes] tick falhou:', err));
  }, intervalMs);
  // Tick imediato pra pegar atrasados após restart
  void checkAlarmes().catch(() => {});
  console.log('[alarmes] ticker iniciado (a cada', intervalMs / 1000, 's)');
}
