// v3.24.1: PR B — Colaborador self-service.
//
// Endpoints exclusivos pro colaborador ver SOMENTE os proprios dados:
//   GET /api/minha-quinzena             → quinzena/mes corrente
//   GET /api/minha-quinzena/historico   → fechamentos anteriores (pagos/cancelados)
//
// Auth: requireAuth + requireColaboradorOwnership (definidos em middleware/auth.ts).
// Admin/gestor podem usar a mesma rota com ?funcionario_id=X pra ver de outros —
// requireColaboradorOwnership deixa passar se role != 'colaborador'.
//
// Pra colaborador, o funcionario_id e' SEMPRE req.user.equipe_id (do JWT).
// Nao da pra colaborador passar ?funcionario_id=outro — middleware bloqueia 403.

import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { requireAuth, requireColaboradorOwnership, type AuthedRequest } from '../middleware/auth';
import * as obras from '../integrations/obras';

const router = Router();

router.use(requireAuth);
router.use(requireColaboradorOwnership);

function getFuncionarioId(req: Request): number {
  const user = (req as AuthedRequest).user!;
  if (user.role === 'colaborador') {
    return user.equipe_id!;
  }
  // Admin/gestor pode passar ?funcionario_id=X
  const q = req.query.funcionario_id;
  if (!q) throw new Error('funcionario_id obrigatorio (use ?funcionario_id=X) pra admin/gestor');
  const n = Number(q);
  if (!Number.isFinite(n) || n <= 0) throw new Error('funcionario_id invalido');
  return n;
}

// ─── GET /api/minha-quinzena ─────────────────────────────────────────
// Resumo do mes corrente do colaborador logado.
// Retorna funcionario + dias + vales + total + saldo.
router.get('/', async (req: Request, res: Response) => {
  try {
    const funcId = getFuncionarioId(req);
    const hoje = new Date();
    const ano = Number(req.query.ano) || hoje.getFullYear();
    const mes = Number(req.query.mes) || (hoje.getMonth() + 1);

    const relatorio = await obras.relatorioMensalFuncionario({
      funcionario_id: String(funcId), ano, mes,
    });

    // Vales (adiantamentos) recebidos no periodo
    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    const [valesRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, valor, descricao, criado_em
         FROM recibos_ajustes
        WHERE membro_id = ? AND tipo = 'adiantamento'
          AND criado_em >= ? AND criado_em <= DATE_ADD(?, INTERVAL 1 DAY)
        ORDER BY criado_em DESC`,
      [funcId, dataInicio, dataFim],
    );
    const vales = valesRows.map(v => ({
      id: Number(v.id),
      valor: Number(v.valor),
      descricao: (v.descricao as string | null) ?? null,
      criado_em: v.criado_em instanceof Date ? v.criado_em.toISOString() : String(v.criado_em),
    }));
    const total_vales = vales.reduce((s, v) => s + v.valor, 0);
    const saldo_liquido = (relatorio.total_pagar || 0) - total_vales;

    res.json({
      ...relatorio,
      vales,
      total_vales,
      saldo_liquido,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── GET /api/minha-quinzena/historico ───────────────────────────────
// Lista fechamentos anteriores do colaborador (pagos/cancelados/abertos).
// Retorna itens com periodo + valor + status + data_pagamento + forma_pagamento.
router.get('/historico', async (req: Request, res: Response) => {
  try {
    const funcId = getFuncionarioId(req);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT fi.id, fi.fechamento_id, fi.funcionario_nome, fi.diaria,
              fi.dias_integral, fi.dias_manha, fi.dias_tarde, fi.dias_equivalente,
              fi.valor_total, fi.valor_vales, fi.valor_liquido,
              fi.status_pagamento, fi.data_pagamento, fi.forma_pagamento,
              ff.periodo_inicio, ff.periodo_fim, ff.created_at AS fechado_em
         FROM folha_fechamento_itens fi
         JOIN folha_fechamentos ff ON ff.id = fi.fechamento_id
        WHERE fi.funcionario_id = ?
        ORDER BY ff.periodo_fim DESC, fi.id DESC
        LIMIT 50`,
      [funcId],
    );
    res.json({
      funcionario_id: funcId,
      total: rows.length,
      itens: rows.map(r => ({
        id: Number(r.id),
        fechamento_id: Number(r.fechamento_id),
        funcionario_nome: r.funcionario_nome,
        diaria: Number(r.diaria),
        dias_integral: Number(r.dias_integral),
        dias_manha: Number(r.dias_manha),
        dias_tarde: Number(r.dias_tarde),
        dias_equivalente: Number(r.dias_equivalente),
        valor_total: Number(r.valor_total),
        valor_vales: Number(r.valor_vales),
        valor_liquido: Number(r.valor_liquido),
        status_pagamento: r.status_pagamento,
        data_pagamento: r.data_pagamento
          ? (r.data_pagamento instanceof Date ? r.data_pagamento.toISOString() : String(r.data_pagamento))
          : null,
        forma_pagamento: r.forma_pagamento,
        periodo_inicio: r.periodo_inicio instanceof Date
          ? r.periodo_inicio.toISOString().slice(0, 10) : String(r.periodo_inicio),
        periodo_fim: r.periodo_fim instanceof Date
          ? r.periodo_fim.toISOString().slice(0, 10) : String(r.periodo_fim),
      })),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
