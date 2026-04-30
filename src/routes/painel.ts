// v1.47.0 — Dashboard /painel.
// Endpoint REST + HTML que mostra stats consolidadas Romatec em tempo real.
// Sem framework: HTML + Chart.js via CDN. Auto-refresh 60s.
//
// /painel              → HTML
// /api/painel/stats    → JSON consolidado (cache 30s pra não martelar o DB)

import path from 'path';
import { Router, type Request, type Response } from 'express';
import * as obras from '../integrations/obras';
import * as crm from '../integrations/crm';
import * as vistorias from '../integrations/vistorias';
import { listarAlertasPendentes } from '../agent/proactive';
import { listarMembros } from '../services/teamMembers';
import pool from '../database/connection';
import type { RowDataPacket } from 'mysql2';

const router: Router = Router();

interface StatsPayload {
  generated_at: string;
  obras: {
    total: number;
    em_andamento: number;
    concluidas: number;
    paralisadas: number;
    orcamento_total: number;
    saldo: number;
    entradas: number;
    saidas: number;
    etapas_atrasadas: number;
    materiais_baixos: number;
    ativas: Array<{ id: string; nome: string; orcamento: number }>;
  };
  crm: {
    total_leads: number;
    leads_novos_30d: number;
    por_status: Record<string, number>;
    erro?: string;
  };
  vistorias: {
    total: number;
    ultimas: Array<{ id: string; titulo: string; data: string; obra: string }>;
  };
  equipe: {
    total: number;
    por_role: Record<string, number>;
  };
  alertas: {
    pendentes: number;
    por_urgencia: Record<string, number>;
  };
  memoria: {
    total_facts: number;
    rag_docs: number;
  };
}

let _cache: { data: StatsPayload; ts: number } | null = null;
const CACHE_MS = 30 * 1000;

async function coletarStats(): Promise<StatsPayload> {
  const [resumoObras, alertas, membros] = await Promise.all([
    obras.resumoObras().catch(() => null),
    listarAlertasPendentes({ limite: 200 }).catch(() => [] as Array<{ urgency: string }>),
    listarMembros({ ativos_apenas: true }).catch(() => []),
  ]);

  // CRM (pode falhar se tabela ausente)
  let crmStats: StatsPayload['crm'] = {
    total_leads: 0, leads_novos_30d: 0, por_status: {},
  };
  try {
    const leads = await crm.listarLeads({ limite: 1000 });
    const porStatus: Record<string, number> = {};
    let novos30d = 0;
    const trintaDiasAtras = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const l of leads as Array<{ status?: string; criadoEm?: string | Date }>) {
      const s = l.status ?? 'sem_status';
      porStatus[s] = (porStatus[s] ?? 0) + 1;
      const ts = l.criadoEm ? new Date(l.criadoEm).getTime() : 0;
      if (ts > trintaDiasAtras) novos30d++;
    }
    crmStats = { total_leads: leads.length, leads_novos_30d: novos30d, por_status: porStatus };
  } catch (err) {
    crmStats.erro = (err as Error).message;
  }

  // Vistorias
  let vistoriasStats: StatsPayload['vistorias'] = { total: 0, ultimas: [] };
  try {
    const lista = await vistorias.listarVistorias({ limite: 8 });
    vistoriasStats = {
      total: lista.length,
      ultimas: lista.map(v => ({
        id:     String((v as { id: number | string }).id),
        titulo: String((v as { titulo?: string }).titulo ?? '(sem título)'),
        data:   String((v as { data?: string }).data ?? ''),
        obra:   String((v as { obra_nome?: string }).obra_nome ?? ''),
      })),
    };
  } catch { /* tabela pode não existir */ }

  // Equipe por role
  const porRole: Record<string, number> = {};
  for (const m of membros) porRole[m.role] = (porRole[m.role] ?? 0) + 1;

  // Alertas por urgência
  const porUrgencia: Record<string, number> = {};
  for (const a of alertas) porUrgencia[a.urgency] = (porUrgencia[a.urgency] ?? 0) + 1;

  // Memória
  let totalFacts = 0;
  let ragDocs = 0;
  try {
    const [r1] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS c FROM zayra_memory');
    totalFacts = Number((r1[0] as { c: number }).c);
  } catch { /* ignore */ }
  try {
    const [r2] = await pool.execute<RowDataPacket[]>('SELECT COUNT(DISTINCT documento_id) AS c FROM rag_chunks');
    ragDocs = Number((r2[0] as { c: number }).c);
  } catch { /* tabela pgvector pode estar no Supabase, não MySQL */ }

  return {
    generated_at: new Date().toISOString(),
    obras: resumoObras ? {
      total:            resumoObras.total_obras,
      em_andamento:     resumoObras.em_andamento,
      concluidas:       resumoObras.concluidas,
      paralisadas:      resumoObras.paralisadas,
      orcamento_total:  resumoObras.orcamento_total,
      saldo:            resumoObras.saldo,
      entradas:         resumoObras.entradas,
      saidas:           resumoObras.saidas,
      etapas_atrasadas: resumoObras.etapas_atrasadas,
      materiais_baixos: resumoObras.materiais_baixos,
      ativas:           resumoObras.obras_ativas,
    } : {
      total: 0, em_andamento: 0, concluidas: 0, paralisadas: 0,
      orcamento_total: 0, saldo: 0, entradas: 0, saidas: 0,
      etapas_atrasadas: 0, materiais_baixos: 0, ativas: [],
    },
    crm:        crmStats,
    vistorias:  vistoriasStats,
    equipe:     { total: membros.length, por_role: porRole },
    alertas:    { pendentes: alertas.length, por_urgencia: porUrgencia },
    memoria:    { total_facts: totalFacts, rag_docs: ragDocs },
  };
}

router.get('/api/painel/stats', async (_req: Request, res: Response) => {
  if (_cache && Date.now() - _cache.ts < CACHE_MS) {
    res.json({ ...(_cache.data), cached: true, age_ms: Date.now() - _cache.ts });
    return;
  }
  try {
    const data = await coletarStats();
    _cache = { data, ts: Date.now() };
    res.json({ ...data, cached: false });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/painel', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'painel.html'));
});

export default router;
