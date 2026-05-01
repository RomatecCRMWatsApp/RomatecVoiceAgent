// v1.55.0 — Dashboard executivo Romatec (KPIs consolidados).
//
// Lê dados de TODAS as tabelas relevantes pra montar um snapshot executivo.
// Resiliente: cada agregação tem try/catch — se a tabela não existir, retorna
// zero + indica no campo `tabelas_indisponiveis` o que faltou (vai pra
// observações pra ZAYRA reportar honestamente ao Chefe).
//
// Diferente de /api/painel/stats (que é pro dashboard web), essa tool retorna
// dados narrativos prontos pra ZAYRA contar pro CEO no Telegram.

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

interface CountRow extends RowDataPacket { c: number }
interface SumRow   extends RowDataPacket { s: number | null }
interface RankRow  extends RowDataPacket { nome: string; valor: number; quantidade: number }

export interface DashboardRomatec {
  gerado_em:               string;
  periodo:                 { inicio: string; fim: string; dias: number };

  obras: {
    total:               number;
    em_andamento:        number;
    concluidas:          number;
    paralisadas:         number;
    orcamento_total:     number;
    saldo_consolidado:   number;
    entradas_periodo:    number;
    saidas_periodo:      number;
    etapas_atrasadas:    number;
    materiais_baixos:    number;
  };

  crm: {
    total_leads:         number;
    leads_periodo:       number;
    por_status:          Record<string, number>;
    por_score:           Record<string, number>;
    erro_tabela?:        string;
  };

  contratos: {
    total_gerados:       number;
    gerados_periodo:     number;
    valor_total:         number;
    ticket_medio:        number;
    por_tipo:            Record<string, number>;
    erro_tabela?:        string;
  };

  vistorias: {
    total:               number;
    periodo:             number;
    por_status_obra:     Record<string, number>;
  };

  atas: {
    total:               number;
    periodo:             number;
  };

  alertas_proativos: {
    pendentes:           number;
    por_urgencia:        Record<string, number>;
    silenciados:         number;
  };

  equipe: {
    total_membros:       number;
    por_role:            Record<string, number>;
    membros_ativos:      number;
  };

  produtividade_zayra: {
    mensagens_inbound:   number;
    mensagens_outbound:  number;
    sessoes_ativas:      number;
  };

  rankings: {
    obras_maior_orcamento:  Array<{ nome: string; valor: number; status: string }>;
    contratos_maior_valor:  Array<{ tipo: string; valor: number; data: string }>;
  };

  observacoes:           string[];
  tabelas_indisponiveis: string[];
}

export async function dashboardRomatec(input?: { dias?: number }): Promise<DashboardRomatec> {
  const dias = input?.dias ?? 30;
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 24 * 60 * 60 * 1000);
  const inicioStr = inicio.toISOString().slice(0, 19).replace('T', ' ');

  const observacoes: string[] = [];
  const indisponiveis: string[] = [];

  // ── Obras (sempre existe) ────────────────────────────────────────────────
  const obras = {
    total: 0, em_andamento: 0, concluidas: 0, paralisadas: 0,
    orcamento_total: 0, saldo_consolidado: 0,
    entradas_periodo: 0, saidas_periodo: 0,
    etapas_atrasadas: 0, materiais_baixos: 0,
  };
  try {
    const [r1] = await pool.execute<RowDataPacket[]>(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status='em_andamento' THEN 1 ELSE 0 END),0) AS em_andamento,
        COALESCE(SUM(CASE WHEN status='concluida'    THEN 1 ELSE 0 END),0) AS concluidas,
        COALESCE(SUM(CASE WHEN status='paralisada'   THEN 1 ELSE 0 END),0) AS paralisadas,
        COALESCE(SUM(orcamento),0) AS orcamento_total
      FROM romatec_obras
    `);
    if (r1[0]) {
      obras.total           = Number(r1[0].total);
      obras.em_andamento    = Number(r1[0].em_andamento);
      obras.concluidas      = Number(r1[0].concluidas);
      obras.paralisadas     = Number(r1[0].paralisadas);
      obras.orcamento_total = Number(r1[0].orcamento_total);
    }
    const [tr] = await pool.execute<RowDataPacket[]>(`
      SELECT tipo, COALESCE(SUM(valor),0) AS s
      FROM romatec_obra_transacoes
      WHERE data >= ?
      GROUP BY tipo
    `, [inicioStr]);
    for (const r of tr as { tipo: string; s: number }[]) {
      if (r.tipo === 'entrada') obras.entradas_periodo = Number(r.s);
      if (r.tipo === 'saida')   obras.saidas_periodo   = Number(r.s);
    }
    const [tr2] = await pool.execute<RowDataPacket[]>(`
      SELECT tipo, COALESCE(SUM(valor),0) AS s
      FROM romatec_obra_transacoes GROUP BY tipo
    `);
    let entAll = 0, saiAll = 0;
    for (const r of tr2 as { tipo: string; s: number }[]) {
      if (r.tipo === 'entrada') entAll = Number(r.s);
      if (r.tipo === 'saida')   saiAll = Number(r.s);
    }
    obras.saldo_consolidado = entAll - saiAll;

    const [eta] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM romatec_obra_etapas WHERE status='atrasado'`);
    obras.etapas_atrasadas = Number(eta[0]?.c ?? 0);

    const [mat] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM romatec_obra_materiais WHERE estoque <= estoque_minimo`);
    obras.materiais_baixos = Number(mat[0]?.c ?? 0);
  } catch (err) {
    indisponiveis.push('romatec_obras (parcial): ' + (err as Error).message.slice(0, 80));
  }

  // ── CRM (leadQualifications pode não existir) ─────────────────────────────
  const crm = {
    total_leads: 0, leads_periodo: 0,
    por_status: {} as Record<string, number>,
    por_score:  {} as Record<string, number>,
    erro_tabela: undefined as string | undefined,
  };
  // leadQualifications usa camelCase (Drizzle schema do CRM): createdAt, não created_at.
  // leadQualifications NÃO tem coluna `status` — só tem `score` e `stage`. Removido a query de status.
  try {
    const [t] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM leadQualifications`);
    crm.total_leads = Number(t[0]?.c ?? 0);

    const [p] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM leadQualifications WHERE createdAt >= ?`,
      [inicioStr],
    );
    crm.leads_periodo = Number(p[0]?.c ?? 0);

    const [st] = await pool.execute<RowDataPacket[]>(`SELECT stage, COUNT(*) AS c FROM leadQualifications GROUP BY stage`);
    for (const r of st as { stage: string; c: number }[]) crm.por_status[r.stage ?? 'sem_stage'] = Number(r.c);

    const [sc] = await pool.execute<RowDataPacket[]>(`SELECT score, COUNT(*) AS c FROM leadQualifications GROUP BY score`);
    for (const r of sc as { score: string; c: number }[]) crm.por_score[r.score ?? 'sem_score'] = Number(r.c);
  } catch (err) {
    crm.erro_tabela = formatErro('leadQualifications', err);
    indisponiveis.push('leadQualifications');
  }

  // ── Contratos gerados ─────────────────────────────────────────────────────
  // ATENÇÃO: contratos_gerados vive no Supabase (PostgreSQL), não no MySQL Railway.
  // Esse dashboard só consulta MySQL, então essa seção fica como placeholder até
  // refatoração que use o cliente Supabase. Issue separada vai trackar.
  const contratos = {
    total_gerados: 0, gerados_periodo: 0,
    valor_total: 0, ticket_medio: 0,
    por_tipo: {} as Record<string, number>,
    erro_tabela: 'Tabela contratos_gerados está no Supabase (PostgreSQL), não no MySQL — leitura via dashboard pendente. Use listar_contratos_gerados pra ver dados reais.' as string | undefined,
  };
  indisponiveis.push('contratos_gerados (Supabase, não MySQL)');

  // ── Vistorias (tabela real é romatec_obra_vistorias, não romatec_vistorias) ──
  const vistorias = { total: 0, periodo: 0, por_status_obra: {} as Record<string, number> };
  try {
    const [t] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM romatec_obra_vistorias`);
    vistorias.total = Number(t[0]?.c ?? 0);
    const [p] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM romatec_obra_vistorias WHERE data >= ?`, [inicioStr],
    );
    vistorias.periodo = Number(p[0]?.c ?? 0);
    const [s] = await pool.execute<RowDataPacket[]>(`SELECT status_obra, COUNT(*) AS c FROM romatec_obra_vistorias GROUP BY status_obra`);
    for (const r of s as { status_obra: string; c: number }[]) vistorias.por_status_obra[r.status_obra ?? 'sem_status'] = Number(r.c);
  } catch (err) { indisponiveis.push(`romatec_obra_vistorias (${formatErroCurto(err)})`); }

  // ── Atas (coluna real é data_reuniao, não data) ──────────────────────────
  const atas = { total: 0, periodo: 0 };
  try {
    const [t] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM romatec_atas_reuniao`);
    atas.total = Number(t[0]?.c ?? 0);
    const [p] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM romatec_atas_reuniao WHERE data_reuniao >= ?`, [inicioStr],
    );
    atas.periodo = Number(p[0]?.c ?? 0);
  } catch (err) { indisponiveis.push(`romatec_atas_reuniao (${formatErroCurto(err)})`); }

  // ── Alertas proativos ─────────────────────────────────────────────────────
  const alertas = {
    pendentes: 0,
    por_urgencia: {} as Record<string, number>,
    silenciados: 0,
  };
  try {
    const [p] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM romatec_proactive_alerts WHERE acknowledged_at IS NULL`,
    );
    alertas.pendentes = Number(p[0]?.c ?? 0);
    const [u] = await pool.execute<RowDataPacket[]>(
      `SELECT urgency, COUNT(*) AS c FROM romatec_proactive_alerts WHERE acknowledged_at IS NULL GROUP BY urgency`,
    );
    for (const r of u as { urgency: string; c: number }[]) alertas.por_urgencia[r.urgency ?? 'medium'] = Number(r.c);
    const [s] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM romatec_proactive_alerts WHERE acknowledged_at IS NOT NULL`);
    alertas.silenciados = Number(s[0]?.c ?? 0);
  } catch (err) { indisponiveis.push(`romatec_proactive_alerts (${formatErroCurto(err)})`); }

  // ── Equipe ────────────────────────────────────────────────────────────────
  const equipe = {
    total_membros: 0, membros_ativos: 0,
    por_role: {} as Record<string, number>,
  };
  try {
    const [t] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM romatec_team_members`);
    equipe.total_membros = Number(t[0]?.c ?? 0);
    const [a] = await pool.execute<CountRow[]>(`SELECT COUNT(*) AS c FROM romatec_team_members WHERE ativo = 1`);
    equipe.membros_ativos = Number(a[0]?.c ?? 0);
    const [r] = await pool.execute<RowDataPacket[]>(`SELECT role, COUNT(*) AS c FROM romatec_team_members WHERE ativo = 1 GROUP BY role`);
    for (const row of r as { role: string; c: number }[]) equipe.por_role[row.role] = Number(row.c);
  } catch (err) { indisponiveis.push(`romatec_team_members (${formatErroCurto(err)})`); }

  // ── Produtividade ZAYRA (logs Telegram + sessões) ────────────────────────
  const prod = { mensagens_inbound: 0, mensagens_outbound: 0, sessoes_ativas: 0 };
  try {
    const [i] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM zayra_telegram_log WHERE direction='inbound' AND sent_at >= ?`,
      [inicioStr],
    );
    prod.mensagens_inbound = Number(i[0]?.c ?? 0);
    const [o] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM zayra_telegram_log WHERE direction='outbound' AND sent_at >= ?`,
      [inicioStr],
    );
    prod.mensagens_outbound = Number(o[0]?.c ?? 0);
    const [s] = await pool.execute<CountRow[]>(
      `SELECT COUNT(DISTINCT chat_id) AS c FROM zayra_telegram_log WHERE sent_at >= ?`,
      [inicioStr],
    );
    prod.sessoes_ativas = Number(s[0]?.c ?? 0);
  } catch (err) { indisponiveis.push(`zayra_telegram_log (${formatErroCurto(err)})`); }

  // ── Rankings ──────────────────────────────────────────────────────────────
  const rankings = {
    obras_maior_orcamento: [] as Array<{ nome: string; valor: number; status: string }>,
    contratos_maior_valor: [] as Array<{ tipo: string; valor: number; data: string }>,
  };
  try {
    const [r] = await pool.execute<RowDataPacket[]>(
      `SELECT nome, orcamento AS valor, status FROM romatec_obras
       WHERE orcamento > 0 ORDER BY orcamento DESC LIMIT 5`,
    );
    rankings.obras_maior_orcamento = (r as RankRow[]).map(x => ({
      nome: String(x.nome),
      valor: Number(x.valor),
      status: String((x as unknown as { status: string }).status ?? '?'),
    }));
  } catch { /* ignore */ }
  // contratos_gerados está no Supabase — ranking pendente até refatoração separada.

  // ── Observações automáticas ──────────────────────────────────────────────
  if (indisponiveis.length > 0) {
    observacoes.push(
      `${indisponiveis.length} fonte(s) de dados indisponíveis no momento (CRM possivelmente não migrado): ` +
      indisponiveis.join(', '),
    );
  }
  if (obras.etapas_atrasadas > 0) {
    observacoes.push(`⚠️ ${obras.etapas_atrasadas} etapa(s) de obra atrasada(s) — convém rodar listar_etapas_obra com filtro status=atrasado.`);
  }
  if (obras.materiais_baixos > 0) {
    observacoes.push(`📦 ${obras.materiais_baixos} material(is) abaixo do estoque mínimo — listar_materiais com apenas_baixos:true.`);
  }
  if (alertas.pendentes > 0) {
    observacoes.push(`🚨 ${alertas.pendentes} alerta(s) proativo(s) pendente(s) — listar_alertas_pendentes.`);
  }

  return {
    gerado_em: new Date().toISOString(),
    periodo:   { inicio: inicio.toISOString().slice(0,10), fim: fim.toISOString().slice(0,10), dias },
    obras,
    crm,
    contratos,
    vistorias,
    atas,
    alertas_proativos: alertas,
    equipe,
    produtividade_zayra: prod,
    rankings,
    observacoes,
    tabelas_indisponiveis: indisponiveis,
  };
}

// ── Helpers de erro ──────────────────────────────────────────────────────────
// Antes da v1.60.x, qualquer erro virava "Tabela X inacessível" — escondia o
// motivo real (coluna errada, syntax, etc) e custava tempo de diagnóstico.
// Agora extraímos sqlMessage/code do erro mysql2 pra deixar a causa exposta.

interface MysqlError {
  message?:    string;
  sqlMessage?: string;
  code?:       string;
  errno?:      number;
}

function formatErro(tabela: string, err: unknown): string {
  const e = err as MysqlError;
  const code = e.code ?? '';
  const msg  = e.sqlMessage ?? e.message ?? String(err);
  // Curtinho: se tem código, mostra; senão mostra mensagem truncada
  const detail = code ? `${code}: ${msg.slice(0, 120)}` : msg.slice(0, 150);
  return `${tabela} — ${detail}`;
}

function formatErroCurto(err: unknown): string {
  const e = err as MysqlError;
  return e.code ?? (e.sqlMessage ?? e.message ?? 'erro desconhecido').slice(0, 60);
}
