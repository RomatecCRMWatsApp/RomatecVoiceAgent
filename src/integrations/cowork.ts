// Cowork — modo de tarefas em background (v1.22).
// CEO solicita tarefa longa, ZAYRA mete em fila, executa via think() em
// paralelo (com acesso a todas as tools), notifica quando termina via
// push web (SSE) + Telegram.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { broadcastNotification } from '../agent/proactive';
import * as telegram from './telegram';
import { think } from '../agent/think';
import { newSessionId } from '../agent/memory';

type TarefaRow = RowDataPacket & {
  id: number;
  descricao: string;
  prompt: string;
  status: 'pendente' | 'executando' | 'concluida' | 'falhou' | 'cancelada';
  resultado: string | null;
  tools_usadas: string | null;
  erro: string | null;
  session_id: string | null;
  criada_em: Date;
  iniciada_em: Date | null;
  concluida_em: Date | null;
};

export interface MutationResult {
  preview?: boolean;
  ok?:      true;
  affected?: number;
  insertId?: number;
  message:  string;
}

export async function criarTarefaCowork(input: {
  descricao: string;  // resumo curto do que ela vai fazer ("Analisar leads quentes do mês")
  prompt: string;     // instrução completa que será passada pra think()
  confirm?: boolean;
}): Promise<MutationResult> {
  if (!input.descricao || !input.prompt) throw new Error('descricao e prompt obrigatórios');
  if (!input.confirm) {
    return {
      preview: true,
      message: `[PREVIEW] Criar tarefa em background: "${input.descricao}" (vai executar em paralelo, te aviso quando terminar). Reenvie com confirm:true.`,
    };
  }
  const sid = newSessionId();
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO zayra_tarefas (descricao, prompt, session_id) VALUES (?,?,?)`,
    [input.descricao, input.prompt, sid],
  );
  return {
    ok: true,
    insertId: r.insertId,
    message: `Tarefa #${r.insertId} criada e enfileirada. Vou te avisar quando terminar (push web + Telegram).`,
  };
}

export async function listarTarefasCowork(input: {
  status?: TarefaRow['status']; limite?: number;
} = {}) {
  const limit = Math.min(Math.max(Number(input.limite) || 50, 1), 200);
  const params: (string | number)[] = [];
  let sql = 'SELECT * FROM zayra_tarefas';
  if (input.status) { sql += ' WHERE status = ?'; params.push(input.status); }
  sql += ' ORDER BY criada_em DESC LIMIT ?';
  params.push(limit);
  const [rows] = await pool.execute<TarefaRow[]>(sql, params);
  return rows.map(r => ({
    id:           String(r.id),
    descricao:    r.descricao,
    status:       r.status,
    resultado:    r.resultado ? r.resultado.slice(0, 800) : null,  // resumo
    tools_usadas: r.tools_usadas,
    erro:         r.erro,
    criada_em:    r.criada_em.toISOString(),
    iniciada_em:  r.iniciada_em ? r.iniciada_em.toISOString() : null,
    concluida_em: r.concluida_em ? r.concluida_em.toISOString() : null,
    duracao_seg:  r.iniciada_em && r.concluida_em
      ? Math.round((r.concluida_em.getTime() - r.iniciada_em.getTime()) / 1000)
      : null,
  }));
}

export async function buscarTarefaCowork(id: string) {
  const [rows] = await pool.execute<TarefaRow[]>('SELECT * FROM zayra_tarefas WHERE id = ?', [id]);
  if (rows.length === 0) throw new Error(`Tarefa ${id} não encontrada`);
  const r = rows[0];
  return {
    id: String(r.id),
    descricao: r.descricao,
    prompt: r.prompt,
    status: r.status,
    resultado: r.resultado,
    tools_usadas: r.tools_usadas,
    erro: r.erro,
    criada_em:    r.criada_em.toISOString(),
    iniciada_em:  r.iniciada_em ? r.iniciada_em.toISOString() : null,
    concluida_em: r.concluida_em ? r.concluida_em.toISOString() : null,
  };
}

export async function cancelarTarefaCowork(input: { id: string; confirm?: boolean }): Promise<MutationResult> {
  if (!input.confirm) {
    return { preview: true, message: `[PREVIEW] Cancelar tarefa ${input.id}. Reenvie com confirm:true.` };
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE zayra_tarefas SET status = 'cancelada' WHERE id = ? AND status IN ('pendente','executando')`,
    [input.id],
  );
  return { ok: true, affected: r.affectedRows, message: `Tarefa ${input.id} cancelada.` };
}

// ── Worker ──────────────────────────────────────────────────────────────────
async function notificarConclusao(t: TarefaRow): Promise<void> {
  const titulo = t.status === 'concluida' ? `✅ Tarefa concluída: ${t.descricao}`
                : t.status === 'falhou'    ? `⚠️ Tarefa falhou: ${t.descricao}`
                :                            `Tarefa atualizada: ${t.descricao}`;
  const corpo  = t.status === 'concluida'
               ? (t.resultado ?? 'Tarefa terminou sem resultado textual.').slice(0, 600)
               : (t.erro ?? 'Sem detalhes do erro.').slice(0, 400);

  // Push web
  try {
    broadcastNotification({
      id: `cowork_${t.id}_${Date.now()}`,
      type: t.status === 'falhou' ? 'urgent' : 'reminder',
      title: titulo,
      message: corpo,
      urgency: t.status === 'falhou' ? 'high' : 'medium',
      timestamp: new Date().toISOString(),
    });
  } catch (e) { console.warn('[cowork] SSE notif falhou:', (e as Error).message); }

  // Telegram
  if (process.env.TELEGRAM_AUTHORIZED_USER_IDS) {
    const ids = process.env.TELEGRAM_AUTHORIZED_USER_IDS.split(',').map(s => s.trim()).filter(Boolean);
    const msg = `*${titulo}*\n\n${corpo}\n\n_Tarefa #${t.id} · ZAYRA Cowork_`;
    for (const id of ids) {
      try { await telegram.sendMessage(id, msg); }
      catch (e) { console.warn('[cowork] Telegram falhou:', (e as Error).message); }
    }
  }
}

async function executarTarefa(t: TarefaRow): Promise<void> {
  await pool.execute(
    `UPDATE zayra_tarefas SET status = 'executando', iniciada_em = NOW() WHERE id = ?`,
    [t.id],
  );
  try {
    const promptCowork = `[MODO COWORK — TAREFA EM BACKGROUND #${t.id}]\n\n` +
      `Descrição da tarefa: ${t.descricao}\n\n` +
      `Instrução do CEO:\n${t.prompt}\n\n` +
      `Execute usando as tools que tiver disponíveis. Quando terminar, responda com um resumo claro e direto do que foi feito (será enviado pro CEO via push e Telegram).`;

    const r = await think(promptCowork, {
      sessionId: t.session_id ?? undefined,
      channel: 'text',
    });

    await pool.execute(
      `UPDATE zayra_tarefas
         SET status = 'concluida', resultado = ?, tools_usadas = ?, concluida_em = NOW()
       WHERE id = ?`,
      [r.text, (r.toolsUsed ?? []).join(','), t.id],
    );
    const [updated] = await pool.execute<TarefaRow[]>('SELECT * FROM zayra_tarefas WHERE id = ?', [t.id]);
    await notificarConclusao(updated[0]);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await pool.execute(
      `UPDATE zayra_tarefas SET status = 'falhou', erro = ?, concluida_em = NOW() WHERE id = ?`,
      [msg, t.id],
    );
    const [updated] = await pool.execute<TarefaRow[]>('SELECT * FROM zayra_tarefas WHERE id = ?', [t.id]);
    await notificarConclusao(updated[0]);
  }
}

let _runningCount = 0;
const MAX_PARALELO = 2;

async function tickWorker(): Promise<void> {
  if (_runningCount >= MAX_PARALELO) return;
  const [rows] = await pool.execute<TarefaRow[]>(
    `SELECT * FROM zayra_tarefas WHERE status = 'pendente' ORDER BY criada_em ASC LIMIT ?`,
    [MAX_PARALELO - _runningCount],
  );
  for (const t of rows) {
    _runningCount++;
    void executarTarefa(t).finally(() => { _runningCount--; });
  }
}

let _workerHandle: NodeJS.Timeout | null = null;
export function startCoworkWorker(intervalMs = 5_000): void {
  if (_workerHandle) return;
  _workerHandle = setInterval(() => {
    tickWorker().catch(err => console.warn('[cowork] tick falhou:', err));
  }, intervalMs);
  console.log('[cowork] worker iniciado (poll', intervalMs / 1000, 's, max paralelo', MAX_PARALELO + ')');
}
