// Detectores proativos de alerta (v1.39.0).
// Cada detector roda periodicamente e gera 0 ou mais Alert objects pra serem
// enviados ao CEO via Telegram (com dedup por alert_key, evita spam).
//
// Padrões:
//   - alert_key = identificador único do problema. Mesmo problema = mesmo key.
//                 Sistema deduplica por X horas (default 24h) baseado em last_sent.
//   - detector  = nome do detector (ex: 'material_baixo')
//   - urgency   = low/medium/high/urgent — afeta como ZAYRA notifica

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import * as crm from '../integrations/crm';

export interface Alert {
  alert_key: string;
  detector:  string;
  type:      'alert' | 'reminder' | 'suggestion' | 'urgent';
  urgency:   'low' | 'medium' | 'high' | 'urgent';
  title:     string;
  message:   string;
  payload?:  Record<string, unknown>;
}

// ── Detector 1: material em estoque baixo ────────────────────────────────────
async function detectarMaterialBaixo(): Promise<Alert[]> {
  type Row = RowDataPacket & {
    id: number; nome: string; estoque: string; estoque_minimo: string;
    unidade: string; obra_id: number | null;
  };
  const [rows] = await pool.execute<Row[]>(`
    SELECT m.id, m.nome, m.estoque, m.estoque_minimo, m.unidade, m.obra_id
    FROM romatec_obra_materiais m
    WHERE CAST(m.estoque AS DECIMAL(10,2)) <= CAST(m.estoque_minimo AS DECIMAL(10,2))
      AND CAST(m.estoque_minimo AS DECIMAL(10,2)) > 0
  `);
  return rows.map(r => ({
    alert_key: `material_baixo:${r.id}`,  // mesmo material = mesmo key
    detector:  'material_baixo',
    type:      'alert',
    urgency:   Number(r.estoque) === 0 ? 'high' : 'medium',
    title:     `📦 Estoque baixo: ${r.nome}`,
    message:   `Material "${r.nome}" com ${r.estoque} ${r.unidade} (mínimo: ${r.estoque_minimo}${r.unidade ? ' '+r.unidade : ''}). ${r.obra_id ? `Obra ID ${r.obra_id}` : 'Estoque geral'}.`,
    payload:   { material_id: String(r.id), estoque: r.estoque, minimo: r.estoque_minimo, obra_id: r.obra_id },
  }));
}

// ── Detector 2: etapa de obra atrasada ───────────────────────────────────────
async function detectarEtapaAtrasada(): Promise<Alert[]> {
  type Row = RowDataPacket & {
    id: number; obra_id: number; obra_nome: string; nome: string;
    data_fim: Date | null; status: string;
  };
  const [rows] = await pool.execute<Row[]>(`
    SELECT e.id, e.obra_id, o.nome AS obra_nome, e.nome, e.data_fim, e.status
    FROM romatec_obra_etapas e
    JOIN romatec_obras o ON o.id = e.obra_id
    WHERE e.status NOT IN ('concluido')
      AND e.data_fim IS NOT NULL
      AND e.data_fim < CURDATE()
  `);
  return rows.map(r => {
    const diasAtraso = r.data_fim ? Math.floor((Date.now() - new Date(r.data_fim).getTime()) / (1000 * 60 * 60 * 24)) : 0;
    return {
      alert_key: `etapa_atrasada:${r.id}`,
      detector:  'etapa_atrasada',
      type:      'alert',
      urgency:   diasAtraso > 14 ? 'urgent' : diasAtraso > 7 ? 'high' : 'medium',
      title:     `⏰ Etapa atrasada: ${r.nome}`,
      message:   `Etapa "${r.nome}" da obra "${r.obra_nome}" está atrasada ${diasAtraso} dia(s). Status atual: ${r.status}.`,
      payload:   { etapa_id: String(r.id), obra_id: String(r.obra_id), dias_atraso: diasAtraso },
    };
  });
}

// ── Detector 3: lead sem resposta há 7+ dias ─────────────────────────────────
async function detectarLeadEsquecido(): Promise<Alert[]> {
  try {
    const leads = await crm.listarLeads({ limite: 200 });
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const filtrados = leads.filter(l =>
      l.score === 'morno' || l.score === 'quente'
        ? new Date(l.created_at) < seteDiasAtras
        : false,
    );
    return filtrados.slice(0, 10).map(l => ({  // limita a 10 pra não estourar Telegram
      alert_key: `lead_esquecido:${l.id}`,
      detector:  'lead_esquecido',
      type:      'reminder',
      urgency:   (l.score === 'quente' ? 'high' : 'medium') as Alert['urgency'],
      title:     `💬 Lead sem follow-up: ${l.nome || 'sem nome'}`,
      message:   `Lead ${l.score === 'quente' ? '🔥 QUENTE' : 'morno'} (${l.nome || l.telefone || 'sem nome'}) sem contato há mais de 7 dias. Sugiro follow-up.`,
      payload:   { lead_id: String(l.id), score: l.score, telefone: l.telefone },
    }));
  } catch (e) {
    console.warn('[detectarLeadEsquecido] CRM indisponível:', (e as Error).message);
    return [];
  }
}

// ── Detector 4: aniversário de cliente nos próximos 3 dias ───────────────────
// Olha clientes da romatec_obras que tem campo cliente preenchido
// Como não temos data_nascimento ainda, esse detector fica como STUB pra
// ser ativado quando tabela de clientes ganhar data_nascimento.
async function detectarAniversarioCliente(): Promise<Alert[]> {
  // STUB — vai ser ativado quando schema tiver data_nascimento de clientes
  return [];
}

// ── Detector 5: funcionário ativo SEM nenhum dia marcado nos últimos 7 dias ──
async function detectarFuncionarioInativo(): Promise<Alert[]> {
  type Row = RowDataPacket & {
    id: number; nome: string; obra_nome: string | null; ultimo_dia: Date | null;
  };
  const [rows] = await pool.execute<Row[]>(`
    SELECT
      e.id, e.nome,
      o.nome AS obra_nome,
      MAX(d.data) AS ultimo_dia
    FROM romatec_obra_equipe e
    LEFT JOIN romatec_obras o ON o.id = e.obra_id
    LEFT JOIN romatec_obra_funcionario_dias d ON d.funcionario_id = e.id
    WHERE e.ativo = 1
    GROUP BY e.id, e.nome, o.nome
    HAVING (ultimo_dia IS NULL OR ultimo_dia < DATE_SUB(CURDATE(), INTERVAL 7 DAY))
  `);
  return rows.map(r => ({
    alert_key: `func_inativo:${r.id}`,
    detector:  'func_inativo',
    type:      'reminder',
    urgency:   'low',
    title:     `🧑‍🔧 Funcionário sem dias marcados`,
    message:   `${r.nome} (${r.obra_nome || 'sem obra'}) sem nenhum dia marcado nos últimos 7 dias. Esqueceu de registrar ou está afastado?`,
    payload:   { funcionario_id: String(r.id), ultimo_dia: r.ultimo_dia ? new Date(r.ultimo_dia).toISOString().slice(0, 10) : null },
  }));
}

// ── Detector 6: obra com gastos > orçamento (saldo negativo) ─────────────────
async function detectarObraEstourandoOrcamento(): Promise<Alert[]> {
  type Row = RowDataPacket & {
    id: number; nome: string; orcamento: string | null; total_saidas: string | null;
  };
  const [rows] = await pool.execute<Row[]>(`
    SELECT
      o.id, o.nome, o.orcamento,
      COALESCE(SUM(CASE WHEN t.tipo='saida' THEN t.valor ELSE 0 END), 0) AS total_saidas
    FROM romatec_obras o
    LEFT JOIN romatec_obra_transacoes t ON t.obra_id = o.id
    WHERE o.status = 'em_andamento'
      AND o.orcamento IS NOT NULL
      AND CAST(o.orcamento AS DECIMAL(15,2)) > 0
    GROUP BY o.id, o.nome, o.orcamento
    HAVING total_saidas > CAST(o.orcamento AS DECIMAL(15,2)) * 0.85
  `);
  return rows.map(r => {
    const saidas = Number(r.total_saidas);
    const orc    = Number(r.orcamento);
    const pct    = Math.round((saidas / orc) * 100);
    return {
      alert_key: `obra_orcamento:${r.id}:${pct >= 100 ? 'estourado' : 'risco'}`,
      detector:  'obra_orcamento',
      type:      'alert',
      urgency:   pct >= 100 ? 'urgent' : pct >= 95 ? 'high' : 'medium',
      title:     `💰 Obra ${pct >= 100 ? 'ESTOUROU' : 'perto de estourar'}: ${r.nome}`,
      message:   `Obra "${r.nome}" já gastou R$ ${saidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${pct}% do orçamento de R$ ${orc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`,
      payload:   { obra_id: String(r.id), orcamento: orc, gastos: saidas, percentual: pct },
    };
  });
}

// ── Orquestrador: roda todos os detectores ───────────────────────────────────
export async function rodarTodosDetectores(): Promise<Alert[]> {
  const results = await Promise.allSettled([
    detectarMaterialBaixo(),
    detectarEtapaAtrasada(),
    detectarLeadEsquecido(),
    detectarAniversarioCliente(),
    detectarFuncionarioInativo(),
    detectarObraEstourandoOrcamento(),
  ]);
  const alerts: Alert[] = [];
  const detectorNames = ['material_baixo', 'etapa_atrasada', 'lead_esquecido', 'aniversario', 'func_inativo', 'obra_orcamento'];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      alerts.push(...r.value);
    } else {
      console.warn(`[detector] ${detectorNames[i]} falhou:`, (r.reason as Error)?.message ?? r.reason);
    }
  });
  return alerts;
}
