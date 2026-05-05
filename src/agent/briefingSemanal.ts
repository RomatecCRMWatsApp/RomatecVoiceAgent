// Briefing semanal automático (v1.40.0 - Frente B).
// Roda sexta às 17h BRT. Coleta dados de obras, equipe, CRM, financeiro,
// vistorias da SEMANA QUE PASSOU. Envia pelo Telegram do CEO (canal mais
// confiável que WhatsApp atualmente em shadow-ban).

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import * as crm from '../integrations/crm';
import { sendMessage as sendTelegram } from '../integrations/telegram';

interface DadosBriefingSemanal {
  periodo:        { inicio: string; fim: string };
  obras: {
    total_em_andamento:  number;
    progresso_por_obra:  Array<{
      nome: string; progresso_pct: number; etapas_atrasadas: number; orcamento_consumido_pct: number;
    }>;
    etapas_concluidas_semana: number;
    etapas_atrasadas_total:   number;
  };
  equipe: {
    funcionarios_ativos:     number;
    dias_trabalhados_semana: number;
    custo_folha_semana:      number;
    funcionario_top:         { nome: string; dias: number } | null;
  };
  financeiro: {
    entradas_semana:     number;
    saidas_semana:       number;
    saldo_semana:        number;
    saidas_por_categoria: Array<{ categoria: string; total: number }>;
  };
  crm: {
    leads_novos_semana:    number;
    leads_quentes_total:   number;
    leads_mornos_total:    number;
  };
  vistorias: {
    novas_semana:    number;
    pendentes_total: number;
  };
  // v1.65.60: leads do AvalieImob (cadastros/assinaturas vindos do SEO/ads)
  avalieimob?: {
    cadastros_semana:   number;
    assinaturas_semana: number;
    top_paginas:        Array<{ page: string; count: number }>;
    top_sources:        Array<{ source: string; count: number }>;
  };
}

async function coletarDadosSemana(): Promise<DadosBriefingSemanal> {
  const fim    = new Date();
  const inicio = new Date(fim.getTime() - 7 * 24 * 60 * 60 * 1000);
  const inicioIso = inicio.toISOString().slice(0, 10);
  const fimIso    = fim.toISOString().slice(0, 10);

  const dados: DadosBriefingSemanal = {
    periodo: {
      inicio: inicio.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }),
      fim:    fim.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' }),
    },
    obras:      { total_em_andamento: 0, progresso_por_obra: [], etapas_concluidas_semana: 0, etapas_atrasadas_total: 0 },
    equipe:     { funcionarios_ativos: 0, dias_trabalhados_semana: 0, custo_folha_semana: 0, funcionario_top: null },
    financeiro: { entradas_semana: 0, saidas_semana: 0, saldo_semana: 0, saidas_por_categoria: [] },
    crm:        { leads_novos_semana: 0, leads_quentes_total: 0, leads_mornos_total: 0 },
    vistorias:  { novas_semana: 0, pendentes_total: 0 },
    avalieimob: { cadastros_semana: 0, assinaturas_semana: 0, top_paginas: [], top_sources: [] },
  };

  // ── Obras ───────────────────────────────────────────────────────────────
  try {
    type ObraRow = RowDataPacket & {
      id: number; nome: string; orcamento: string | null;
      etapas_total: number; etapas_concluidas: number;
      etapas_atrasadas: number; total_saidas: string;
    };
    const [obras] = await pool.execute<ObraRow[]>(`
      SELECT
        o.id, o.nome, o.orcamento,
        COUNT(DISTINCT e.id) AS etapas_total,
        SUM(CASE WHEN e.status='concluido' THEN 1 ELSE 0 END) AS etapas_concluidas,
        SUM(CASE WHEN e.status='atrasado' OR (e.status<>'concluido' AND e.data_fim < CURDATE()) THEN 1 ELSE 0 END) AS etapas_atrasadas,
        COALESCE((SELECT SUM(t.valor) FROM romatec_obra_transacoes t
                  WHERE t.obra_id = o.id AND t.tipo='saida'), 0) AS total_saidas
      FROM romatec_obras o
      LEFT JOIN romatec_obra_etapas e ON e.obra_id = o.id
      WHERE o.status = 'em_andamento'
      GROUP BY o.id, o.nome, o.orcamento
    `);
    dados.obras.total_em_andamento = obras.length;
    dados.obras.progresso_por_obra = obras.map(o => {
      const total       = Number(o.etapas_total);
      const concluidas  = Number(o.etapas_concluidas);
      const atrasadas   = Number(o.etapas_atrasadas);
      const orcamento   = Number(o.orcamento || 0);
      const saidas      = Number(o.total_saidas || 0);
      return {
        nome: o.nome,
        progresso_pct: total > 0 ? Math.round((concluidas / total) * 100) : 0,
        etapas_atrasadas: atrasadas,
        orcamento_consumido_pct: orcamento > 0 ? Math.round((saidas / orcamento) * 100) : 0,
      };
    });
    dados.obras.etapas_atrasadas_total = obras.reduce((s, o) => s + Number(o.etapas_atrasadas), 0);

    // Etapas concluídas na semana (data_fim atualizada nos últimos 7 dias)
    type EtapaCount = RowDataPacket & { n: number };
    const [etapasSem] = await pool.execute<EtapaCount[]>(
      `SELECT COUNT(*) AS n FROM romatec_obra_etapas
       WHERE status = 'concluido' AND data_fim BETWEEN ? AND ?`,
      [inicioIso, fimIso],
    );
    dados.obras.etapas_concluidas_semana = Number(etapasSem[0]?.n || 0);
  } catch (err) {
    console.warn('[briefingSemanal] obras:', (err as Error).message);
  }

  // ── Equipe + Diárias ────────────────────────────────────────────────────
  try {
    type EquipeRow = RowDataPacket & { ativos: number };
    const [eq] = await pool.execute<EquipeRow[]>(
      'SELECT COUNT(*) AS ativos FROM romatec_obra_equipe WHERE ativo = 1',
    );
    dados.equipe.funcionarios_ativos = Number(eq[0]?.ativos || 0);

    type DiasRow = RowDataPacket & { dias: number; total_pagar: string };
    const [dias] = await pool.execute<DiasRow[]>(
      `SELECT COUNT(*) AS dias, COALESCE(SUM(valor), 0) AS total_pagar
       FROM romatec_obra_funcionario_dias WHERE data BETWEEN ? AND ?`,
      [inicioIso, fimIso],
    );
    dados.equipe.dias_trabalhados_semana = Number(dias[0]?.dias || 0);
    dados.equipe.custo_folha_semana     = Number(dias[0]?.total_pagar || 0);

    type TopRow = RowDataPacket & { nome: string; dias: number };
    const [top] = await pool.execute<TopRow[]>(
      `SELECT e.nome, COUNT(*) AS dias
       FROM romatec_obra_funcionario_dias d
       JOIN romatec_obra_equipe e ON e.id = d.funcionario_id
       WHERE d.data BETWEEN ? AND ?
       GROUP BY e.id, e.nome ORDER BY dias DESC LIMIT 1`,
      [inicioIso, fimIso],
    );
    if (top.length > 0) dados.equipe.funcionario_top = { nome: top[0].nome, dias: Number(top[0].dias) };
  } catch (err) {
    console.warn('[briefingSemanal] equipe:', (err as Error).message);
  }

  // ── Financeiro ──────────────────────────────────────────────────────────
  try {
    type FinRow = RowDataPacket & { tipo: string; total: string };
    const [fin] = await pool.execute<FinRow[]>(
      `SELECT tipo, COALESCE(SUM(valor), 0) AS total
       FROM romatec_obra_transacoes WHERE data BETWEEN ? AND ?
       GROUP BY tipo`,
      [inicioIso, fimIso],
    );
    for (const f of fin) {
      const total = Number(f.total);
      if (f.tipo === 'entrada') dados.financeiro.entradas_semana = total;
      if (f.tipo === 'saida')   dados.financeiro.saidas_semana = total;
    }
    dados.financeiro.saldo_semana = dados.financeiro.entradas_semana - dados.financeiro.saidas_semana;

    type CatRow = RowDataPacket & { categoria: string; total: string };
    const [cats] = await pool.execute<CatRow[]>(
      `SELECT COALESCE(categoria,'Sem categoria') AS categoria, COALESCE(SUM(valor),0) AS total
       FROM romatec_obra_transacoes
       WHERE tipo='saida' AND data BETWEEN ? AND ?
       GROUP BY categoria ORDER BY total DESC LIMIT 5`,
      [inicioIso, fimIso],
    );
    dados.financeiro.saidas_por_categoria = cats.map(c => ({
      categoria: c.categoria, total: Number(c.total),
    }));
  } catch (err) {
    console.warn('[briefingSemanal] financeiro:', (err as Error).message);
  }

  // ── CRM ─────────────────────────────────────────────────────────────────
  try {
    const leads = await crm.listarLeads({ limite: 1000 });
    dados.crm.leads_quentes_total = leads.filter(l => l.score === 'quente').length;
    dados.crm.leads_mornos_total  = leads.filter(l => l.score === 'morno').length;
    dados.crm.leads_novos_semana  = leads.filter(l => {
      const created = new Date(l.created_at);
      return created >= inicio && created <= fim;
    }).length;
  } catch (err) {
    console.warn('[briefingSemanal] CRM:', (err as Error).message);
  }

  // ── AvalieImob (leads do SEO/ads via webhook) ──────────────────────────
  try {
    const { consultarLeads } = await import('../integrations/avalieImobLeads');
    const r = await consultarLeads({ dias: 7, limit: 1 });
    dados.avalieimob = {
      cadastros_semana:   r.por_evento.cadastro   || 0,
      assinaturas_semana: r.por_evento.assinatura || 0,
      top_paginas:        r.top_paginas,
      top_sources:        r.top_sources,
    };
  } catch (err) {
    console.warn('[briefingSemanal] AvalieImob leads:', (err as Error).message);
  }

  // ── Vistorias ───────────────────────────────────────────────────────────
  try {
    type VtoRow = RowDataPacket & { n: number };
    const [novas] = await pool.execute<VtoRow[]>(
      `SELECT COUNT(*) AS n FROM romatec_obra_vistorias WHERE data BETWEEN ? AND ?`,
      [inicioIso, fimIso],
    );
    dados.vistorias.novas_semana = Number(novas[0]?.n || 0);
    const [pend] = await pool.execute<VtoRow[]>(
      `SELECT COUNT(*) AS n FROM romatec_obra_vistorias WHERE status_obra IN ('atencao','critica')`,
    );
    dados.vistorias.pendentes_total = Number(pend[0]?.n || 0);
  } catch (err) {
    console.warn('[briefingSemanal] vistorias:', (err as Error).message);
  }

  return dados;
}

const fmt = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatBriefing(d: DadosBriefingSemanal): string {
  const linhas: string[] = [];
  linhas.push(`📊 *BRIEFING SEMANAL ROMATEC*`);
  linhas.push(`📅 ${d.periodo.inicio} → ${d.periodo.fim}\n`);

  // OBRAS
  linhas.push(`🏗 *OBRAS* (${d.obras.total_em_andamento} em andamento)`);
  if (d.obras.progresso_por_obra.length === 0) {
    linhas.push(`   _Nenhuma obra em andamento_`);
  } else {
    for (const o of d.obras.progresso_por_obra) {
      const status = o.orcamento_consumido_pct > 100 ? '🔴'
                    : o.orcamento_consumido_pct > 85 ? '🟡' : '🟢';
      linhas.push(`   ${status} ${o.nome} — ${o.progresso_pct}% concluída · orçamento ${o.orcamento_consumido_pct}%${o.etapas_atrasadas > 0 ? ` · ⏰ ${o.etapas_atrasadas} atrasada(s)` : ''}`);
    }
  }
  linhas.push(`   ✅ ${d.obras.etapas_concluidas_semana} etapa(s) concluída(s) na semana`);
  if (d.obras.etapas_atrasadas_total > 0) linhas.push(`   ⚠️ ${d.obras.etapas_atrasadas_total} etapa(s) atrasada(s) no total\n`);
  else linhas.push('');

  // EQUIPE
  linhas.push(`👷 *EQUIPE*`);
  linhas.push(`   ${d.equipe.funcionarios_ativos} funcionário(s) ativo(s)`);
  linhas.push(`   ${d.equipe.dias_trabalhados_semana} dia(s) trabalhado(s) na semana`);
  linhas.push(`   💰 Folha estimada: ${fmt(d.equipe.custo_folha_semana)}`);
  if (d.equipe.funcionario_top) linhas.push(`   🏆 Top: ${d.equipe.funcionario_top.nome} (${d.equipe.funcionario_top.dias} dias)\n`);
  else linhas.push('');

  // FINANCEIRO
  const saldoEmoji = d.financeiro.saldo_semana >= 0 ? '📈' : '📉';
  linhas.push(`💵 *FINANCEIRO DA SEMANA*`);
  linhas.push(`   ⬆️ Entradas: ${fmt(d.financeiro.entradas_semana)}`);
  linhas.push(`   ⬇️ Saídas: ${fmt(d.financeiro.saidas_semana)}`);
  linhas.push(`   ${saldoEmoji} Saldo: ${fmt(d.financeiro.saldo_semana)}`);
  if (d.financeiro.saidas_por_categoria.length > 0) {
    linhas.push(`   _Top categorias de gasto:_`);
    for (const c of d.financeiro.saidas_por_categoria) {
      linhas.push(`     • ${c.categoria}: ${fmt(c.total)}`);
    }
  }
  linhas.push('');

  // CRM
  linhas.push(`📞 *CRM*`);
  linhas.push(`   🔥 ${d.crm.leads_quentes_total} leads quentes (total)`);
  linhas.push(`   🌡 ${d.crm.leads_mornos_total} leads mornos (total)`);
  linhas.push(`   🆕 ${d.crm.leads_novos_semana} lead(s) novo(s) na semana\n`);

  // AvalieImob (v1.65.60: leads vindos do SEO/ads)
  if (d.avalieimob && (d.avalieimob.cadastros_semana > 0 || d.avalieimob.assinaturas_semana > 0)) {
    linhas.push(`🎯 *AvalieImob (orgânico/ads)*`);
    linhas.push(`   📥 ${d.avalieimob.cadastros_semana} cadastro(s) novo(s) na semana`);
    if (d.avalieimob.assinaturas_semana > 0) {
      linhas.push(`   💰 ${d.avalieimob.assinaturas_semana} nova(s) assinatura(s) 🚀`);
    }
    if (d.avalieimob.top_paginas.length > 0) {
      linhas.push(`   _Top páginas de origem:_`);
      for (const p of d.avalieimob.top_paginas.slice(0, 3)) {
        linhas.push(`     • ${p.page}: ${p.count}`);
      }
    }
    if (d.avalieimob.top_sources.length > 0) {
      linhas.push(`   _Top fontes:_ ${d.avalieimob.top_sources.slice(0, 3).map(s => `${s.source} (${s.count})`).join(', ')}`);
    }
    linhas.push('');
  }

  // VISTORIAS
  if (d.vistorias.novas_semana > 0 || d.vistorias.pendentes_total > 0) {
    linhas.push(`🔍 *VISTORIAS (VTO)*`);
    linhas.push(`   ${d.vistorias.novas_semana} nova(s) na semana`);
    if (d.vistorias.pendentes_total > 0) linhas.push(`   ⚠️ ${d.vistorias.pendentes_total} obra(s) em atenção/crítica\n`);
    else linhas.push('');
  }

  linhas.push(`📌 *Bom fim de semana, Chefe!* 🚀`);
  return linhas.join('\n');
}

export async function gerarBriefingSemanal(): Promise<{ texto: string; dados: DadosBriefingSemanal }> {
  const dados = await coletarDadosSemana();
  const texto = formatBriefing(dados);
  return { texto, dados };
}

export async function enviarBriefingSemanal(): Promise<{ ok: boolean; chats_enviados: number; texto: string }> {
  const { texto } = await gerarBriefingSemanal();
  const chatIds = (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (chatIds.length === 0 || !process.env.TELEGRAM_BOT_TOKEN) {
    return { ok: false, chats_enviados: 0, texto };
  }
  let enviados = 0;
  for (const chatId of chatIds) {
    try {
      await sendTelegram(chatId, texto);
      enviados++;
    } catch (err) {
      console.warn(`[briefingSemanal] falha chat=${chatId}:`, (err as Error).message);
    }
  }
  return { ok: enviados > 0, chats_enviados: enviados, texto };
}

// Schedule: sexta-feira às 17h BRT (= 20h UTC)
function msUntilSextaAs17(): number {
  const now      = new Date();
  const nowUtc   = now.getTime();
  // BRT = UTC-3, então 17h BRT = 20h UTC
  const target   = new Date(now);
  target.setUTCHours(20, 0, 0, 0);
  // Encontra próxima sexta (dayOfWeek 5 em UTC)
  while (target.getUTCDay() !== 5 || target.getTime() <= nowUtc) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - nowUtc;
}

export function startWeeklyBriefingScheduler(): void {
  const schedule = () => {
    const delay = msUntilSextaAs17();
    const horas = Math.round(delay / 3600000 * 10) / 10;
    console.log(`[Scheduler] Próximo briefing semanal em ${horas}h (sexta 17:00 BRT)`);
    setTimeout(async () => {
      try {
        const r = await enviarBriefingSemanal();
        console.log(`[Scheduler] ✅ Briefing semanal enviado pra ${r.chats_enviados} chat(s) Telegram`);
      } catch (err) {
        console.error('[Scheduler] ❌ Briefing semanal falhou:', (err as Error).message);
      }
      schedule();
    }, delay);
  };
  schedule();
}
