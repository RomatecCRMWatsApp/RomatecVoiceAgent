/**
 * Queries SQL do Live Feed Universal
 * ZAYRA v1.99.15 — Romatec
 *
 * Adaptadas ao schema real (prefixo romatec_*, contratantes p/ laudos,
 * recibos.tipo='funcionario' p/ vales).
 *
 * Nota mysql2: pool.execute() nao aceita LIMIT como placeholder (TypeError).
 * Pra LIMIT, sanitizamos o numero e interpolamos direto na string.
 */

import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { LiveFeedCard, LiveFeedHighlight } from './liveFeedTypes';

// ── HELPERS ──────────────────────────────────────────────────────────────────

function safeLimit(n: number | undefined, fallback: number, max = 500): number {
  const v = Math.floor(Number(n ?? fallback));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(v, max);
}

function getInitials(nome: string | null | undefined): string {
  if (!nome) return '??';
  const parts = String(nome).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatBRL(valor: number | string | null | undefined): string {
  const n = typeof valor === 'string' ? parseFloat(valor) : Number(valor ?? 0);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

function pctConsumo(consumo: number, orcamento: number): string {
  const c = Number(consumo) || 0;
  const o = Number(orcamento) || 0;
  if (o <= 0) return '0%';
  return `${Math.round((c / o) * 100)}%`;
}

/**
 * v3.116.0: SQL reutilizavel do total ja PAGO em mao de obra por obra.
 * Duas fontes, ambas com obra_id:
 *  - folha_fechamento_itens (status_pagamento='paga') via folha_fechamentos.obra_id
 *  - mao_obra_avulsa.valor_pago (prestador informal)
 * Subquery correlacionada de proposito: evita o produto cartesiano que
 * inflava o SUM quando havia varios LEFT JOIN no mesmo GROUP BY.
 */
const SQL_FOLHA_PAGA = `COALESCE((
    SELECT SUM(fi.valor_liquido)
    FROM folha_fechamento_itens fi
    JOIN folha_fechamentos ff ON ff.id = fi.fechamento_id
    WHERE ff.obra_id = o.id AND fi.status_pagamento = 'paga'
  ), 0)`;

const SQL_AVULSA_PAGA = `COALESCE((
    SELECT SUM(ma.valor_pago)
    FROM mao_obra_avulsa ma
    WHERE ma.obra_id = o.id
  ), 0)`;

/**
 * v3.116.0: em producao a tabela mao_obra_avulsa pode nao existir — a migration
 * dela roda encadeada depois da signing (server.ts) e nao rodou no banco atual.
 * Referenciar a tabela direto derrubava o Live Feed inteiro com ER_NO_SUCH_TABLE,
 * entao checamos uma vez (cache em memoria) e so somamos a avulsa se ela existir.
 */
let avulsaExiste: boolean | null = null;

async function sqlMaoObraPaga(pool: Pool): Promise<string> {
  if (avulsaExiste === null) {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT 1 AS ok FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'mao_obra_avulsa' LIMIT 1`,
      );
      avulsaExiste = rows.length > 0;
    } catch {
      avulsaExiste = false;
    }
  }
  return avulsaExiste ? `(${SQL_FOLHA_PAGA} + ${SQL_AVULSA_PAGA})` : `(${SQL_FOLHA_PAGA})`;
}

function emojiCategoria(cat: string | null | undefined): string {
  const map: Record<string, string> = {
    ferramenta: '🔧',
    aluguel: '🏠',
    material: '🧱',
    outros: '📌',
  };
  return map[(cat || '').toLowerCase()] || '📌';
}

function corStatusRecibo(status: string): LiveFeedHighlight {
  if (status === 'confirmado' || status === 'entregue' || status === 'lido') return 'green';
  if (status === 'cancelado' || status === 'expirado' || status === 'contestado') return 'red';
  return 'orange';
}

function labelStatusRecibo(status: string): string {
  const map: Record<string, string> = {
    rascunho: 'Rascunho',
    aguardando_envio: 'Aguardando',
    enviado: 'Enviado',
    entregue: '✓ Entregue',
    lido: '👁 Lido',
    respondido: 'Respondido',
    confirmado: '✓ Confirmado',
    contestado: 'Contestado',
    expirado: 'Expirado',
    cancelado: 'Cancelado',
  };
  return map[status] || status;
}

function fmtDataBR(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

// ── QUERIES POR ABA ──────────────────────────────────────────────────────────

/**
 * PAINEL (dashboard inicial) · obras em andamento com saúde geral
 */
export async function queryPainel(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      o.id,
      o.nome,
      o.cliente,
      o.cidade,
      o.orcamento,
      o.valor_contrato,
      COALESCE(SUM(CASE WHEN t.tipo = 'saida' THEN t.valor ELSE 0 END), 0) AS consumo,
      COUNT(DISTINCT e.id) AS qtd_etapas_atrasadas
    FROM romatec_obras o
    LEFT JOIN romatec_obra_transacoes t ON t.obra_id = o.id
    LEFT JOIN romatec_obra_etapas e ON e.obra_id = o.id AND e.status = 'atrasado'
    WHERE o.status = 'em_andamento'
    GROUP BY o.id, o.nome, o.cliente, o.cidade, o.orcamento, o.valor_contrato
    ORDER BY o.orcamento DESC
  `);

  return rows.map((r) => {
    const orcamento = Number(r.orcamento ?? r.valor_contrato ?? 0);
    const consumo = Number(r.consumo ?? 0);
    const atrasadas = Number(r.qtd_etapas_atrasadas ?? 0);
    return {
      avatar: getInitials(r.nome),
      title: String(r.nome),
      subtitle: `${r.cliente ?? 'Sem cliente'} · ${r.cidade ?? '—'}`,
      theme: atrasadas > 0 ? 'orange' : 'green',
      id: Number(r.id),
      href: `/painel#obra-${r.id}`,
      metrics: [
        { label: 'Orçamento', value: formatBRL(orcamento), highlight: 'gold' },
        { label: 'Consumo', value: pctConsumo(consumo, orcamento), highlight: 'orange' },
        {
          label: 'Atrasadas',
          value: String(atrasadas),
          highlight: atrasadas > 0 ? 'red' : 'green',
        },
      ],
    };
  });
}

/**
 * OBRAS · todas as obras com status e orçamento
 */
export async function queryObras(pool: Pool): Promise<LiveFeedCard[]> {
  const sqlPago = await sqlMaoObraPaga(pool);
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      o.id,
      o.nome,
      o.cliente,
      o.endereco,
      o.cidade,
      o.orcamento,
      o.valor_contrato,
      o.status,
      ${sqlPago} AS mao_obra_paga,
      (
        SELECT COUNT(DISTINCT d.funcionario_id)
        FROM romatec_obra_funcionario_dias d
        WHERE d.obra_id = o.id
      ) AS qtd_colaboradores
    FROM romatec_obras o
    WHERE o.status IN ('em_andamento', 'paralisada', 'planejamento')
    ORDER BY o.orcamento DESC
  `);

  return rows.map((r) => {
    const orcamento = Number(r.orcamento ?? r.valor_contrato ?? 0);
    // v3.116.0: card mostra o que ja saiu pra equipe e o que sobra da obra
    const maoObra = Number(r.mao_obra_paga ?? 0);
    const saldo = orcamento - maoObra;
    const theme: LiveFeedCard['theme'] =
      r.status === 'paralisada' ? 'red' : r.status === 'planejamento' ? 'blue' : 'gold';
    return {
      avatar: getInitials(r.nome),
      title: String(r.nome),
      subtitle: `${r.cliente ?? 'Sem cliente'} · ${String(r.endereco ?? '').split(',')[0] || r.cidade || '—'}`,
      theme,
      id: Number(r.id),
      href: `/painel#obra-${r.id}`,
      metrics: [
        { label: 'Orçamento', value: formatBRL(orcamento), highlight: 'gold' },
        { label: 'Mão de Obra', value: formatBRL(maoObra), highlight: 'orange' },
        { label: 'Saldo', value: formatBRL(saldo), highlight: saldo < 0 ? 'red' : 'green' },
        { label: 'Equipe', value: String(r.qtd_colaboradores ?? 0), highlight: 'white' },
      ],
    };
  });
}

/**
 * FOLHA MENSAL · funcionários com diárias no mês (todas marcadas)
 * Não há status aberta/paga em romatec_obra_funcionario_dias — todas contam.
 */
export async function queryFolhaMensal(
  pool: Pool,
  obraId: number,
  ano: number,
  mes: number,
): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      e.id,
      e.nome,
      e.funcao,
      e.valor_dia,
      o.nome AS obra_nome,
      COALESCE(SUM(
        CASE d.periodo
          WHEN 'integral' THEN 1.0
          WHEN 'manha'    THEN 0.5
          WHEN 'tarde'    THEN 0.5
          ELSE 0
        END
      ), 0) AS dias_equivalentes,
      COALESCE(SUM(
        COALESCE(d.valor, CASE d.periodo
          WHEN 'integral' THEN e.valor_dia
          WHEN 'manha'    THEN e.valor_dia * 0.5
          WHEN 'tarde'    THEN e.valor_dia * 0.5
          ELSE 0
        END)
      ), 0) AS total_a_receber
    FROM romatec_obra_equipe e
    INNER JOIN romatec_obra_funcionario_dias d ON d.funcionario_id = e.id
    INNER JOIN romatec_obras o ON o.id = d.obra_id
    WHERE d.obra_id = ?
      AND YEAR(d.data) = ?
      AND MONTH(d.data) = ?
      AND e.ativo = 1
    GROUP BY e.id, e.nome, e.funcao, e.valor_dia, o.nome
    HAVING dias_equivalentes > 0
    ORDER BY total_a_receber DESC
  `,
    [obraId, ano, mes],
  );

  return rows.map((r) => ({
    avatar: getInitials(r.nome),
    title: String(r.nome),
    subtitle: `${r.funcao ?? 'Função n/d'} · ${r.obra_nome}`,
    theme: 'orange',
    id: Number(r.id),
    metrics: [
      { label: 'Diária', value: formatBRL(r.valor_dia) },
      { label: 'Dias', value: String(r.dias_equivalentes), highlight: 'green' },
      { label: 'A Receber', value: formatBRL(r.total_a_receber), highlight: 'orange' },
    ],
  }));
}

/**
 * MATERIAIS · catálogo (sem obra_id na tabela; obraId é ignorado)
 */
export async function queryMateriais(pool: Pool, _obraId?: number): Promise<LiveFeedCard[]> {
  const limite = safeLimit(50, 50, 200);
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      m.id,
      m.nome,
      m.categoria,
      m.fornecedor_principal,
      m.unidade,
      m.estoque,
      m.estoque_minimo,
      m.valor_unitario,
      (COALESCE(m.estoque, 0) * COALESCE(m.valor_unitario, 0)) AS valor_total
    FROM romatec_obra_materiais m
    ORDER BY valor_total DESC
    LIMIT ${limite}
  `);

  return rows.map((r) => {
    const estoque = Number(r.estoque ?? 0);
    const minimo = Number(r.estoque_minimo ?? 0);
    const lowStock = minimo > 0 && estoque < minimo;
    return {
      avatar: '📦',
      title: String(r.nome),
      subtitle: `${r.fornecedor_principal ?? 'Sem fornecedor'} · ${r.categoria ?? 'Sem categoria'}`,
      theme: lowStock ? 'red' : 'gold',
      id: Number(r.id),
      metrics: [
        {
          label: 'Estoque',
          value: `${estoque} ${r.unidade ?? 'un'}`,
          highlight: lowStock ? 'red' : 'green',
        },
        { label: 'Unitário', value: formatBRL(r.valor_unitario) },
        { label: 'Total', value: formatBRL(r.valor_total), highlight: 'gold' },
      ],
    };
  });
}

/**
 * COLABORADORES · equipe ativa
 */
export async function queryColaboradores(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      e.id,
      e.nome,
      e.funcao,
      e.valor_dia,
      e.telefone,
      e.tipo_contrato,
      COUNT(DISTINCT d.obra_id) AS qtd_obras,
      COALESCE(SUM(
        CASE d.periodo
          WHEN 'integral' THEN 1.0
          WHEN 'manha'    THEN 0.5
          WHEN 'tarde'    THEN 0.5
          ELSE 0
        END
      ), 0) AS dias_30d
    FROM romatec_obra_equipe e
    LEFT JOIN romatec_obra_funcionario_dias d
      ON d.funcionario_id = e.id
     AND d.data >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    WHERE e.ativo = 1
    GROUP BY e.id, e.nome, e.funcao, e.valor_dia, e.telefone, e.tipo_contrato
    ORDER BY e.nome ASC
  `);

  return rows.map((r) => ({
    avatar: getInitials(r.nome),
    title: String(r.nome),
    subtitle: `${r.funcao ?? r.tipo_contrato ?? '—'} · ${r.telefone ?? 's/ telefone'}`,
    theme: 'green',
    id: Number(r.id),
    metrics: [
      { label: 'Diária', value: formatBRL(r.valor_dia) },
      { label: 'Obras (30d)', value: String(r.qtd_obras ?? 0), highlight: 'gold' },
      { label: 'Dias (30d)', value: String(r.dias_30d ?? 0), highlight: 'orange' },
    ],
  }));
}

/**
 * CLIENTES · cadastrados em propostas_clientes
 */
export async function queryClientes(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      c.id,
      c.nome,
      c.cpf_cnpj,
      c.telefone,
      c.cidade,
      c.estado,
      COUNT(DISTINCT p.id) AS qtd_propostas,
      COALESCE(SUM(p.valor_total), 0) AS valor_total
    FROM propostas_clientes c
    LEFT JOIN propostas p ON p.cliente_id = c.id AND p.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
    GROUP BY c.id, c.nome, c.cpf_cnpj, c.telefone, c.cidade, c.estado
    ORDER BY valor_total DESC, c.nome ASC
  `);

  return rows.map((r) => ({
    avatar: getInitials(r.nome),
    title: String(r.nome),
    subtitle: `${r.cpf_cnpj ?? 's/ documento'} · ${r.cidade ?? '—'}${r.estado ? '/' + r.estado : ''}`,
    theme: 'green',
    id: Number(r.id),
    metrics: [
      { label: 'Propostas', value: String(r.qtd_propostas ?? 0), highlight: 'gold' },
      { label: 'Valor Total', value: formatBRL(r.valor_total), highlight: 'green' },
      { label: 'Telefone', value: r.telefone ?? '—' },
    ],
  }));
}

/**
 * VALES (recibos do tipo funcionario) · últimos 60 dias
 */
export async function queryVales(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      r.id,
      r.numero,
      r.destinatario_nome,
      r.destinatario_doc,
      r.valor,
      r.status,
      r.created_at,
      r.tipo
    FROM recibos r
    WHERE r.tipo IN ('funcionario', 'parcela')
      AND r.created_at >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 100
  `);

  return rows.map((r) => {
    const status = String(r.status);
    return {
      avatar: getInitials(r.destinatario_nome),
      title: String(r.destinatario_nome),
      subtitle: `Recibo #${r.numero} · ${fmtDataBR(r.created_at)}`,
      theme: status === 'confirmado' || status === 'entregue' ? 'green' : 'orange',
      id: Number(r.id),
      metrics: [
        { label: 'Valor', value: formatBRL(r.valor), highlight: 'gold' },
        { label: 'Status', value: labelStatusRecibo(status), highlight: corStatusRecibo(status) },
        { label: 'Data', value: fmtDataBR(r.created_at) },
      ],
    };
  });
}

/**
 * LAUDOS · demarcação (única tabela de laudos no MySQL)
 */
export async function queryLaudos(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      l.id,
      l.numero_laudo,
      l.tipo_imovel,
      l.quadra,
      l.numero_lote,
      l.loteamento,
      l.area_total_m2,
      l.valor_servico,
      l.status,
      l.created_at,
      c.nome AS contratante_nome
    FROM laudos_demarcacao l
    LEFT JOIN contratantes c ON c.id = l.contratante_id
    WHERE l.ativo = TRUE
    ORDER BY l.created_at DESC
    LIMIT 100
  `);

  return rows.map((r) => {
    const status = String(r.status ?? 'RASCUNHO');
    const concluido = status === 'CONFIRMADO' || status === 'ASSINADO' || status === 'ENVIADO';
    return {
      avatar: r.tipo_imovel === 'RURAL' ? '🌾' : '📐',
      title: String(r.contratante_nome ?? 'Sem contratante'),
      subtitle: `Laudo #${r.numero_laudo} · ${r.tipo_imovel}`,
      theme: 'gold',
      id: Number(r.id),
      metrics: [
        { label: 'Área', value: `${Number(r.area_total_m2 ?? 0).toFixed(2)} m²` },
        { label: 'Valor', value: formatBRL(r.valor_servico), highlight: 'gold' },
        { label: 'Status', value: status, highlight: concluido ? 'green' : 'orange' },
      ],
    };
  });
}

/**
 * DESPESAS EXTRAS · com filtro opcional por obra
 */
export async function queryDespesas(pool: Pool, obraId?: number): Promise<LiveFeedCard[]> {
  const filter = obraId ? 'AND d.obra_id = ?' : '';
  const params: number[] = obraId ? [obraId] : [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      d.id,
      d.data,
      d.loja,
      d.destinatario,
      d.categoria,
      d.valor_total,
      d.forma_pagamento,
      o.nome AS obra_nome
    FROM despesas_extras d
    LEFT JOIN romatec_obras o ON o.id = d.obra_id
    WHERE d.deleted_at IS NULL ${filter}
    ORDER BY d.data DESC, d.id DESC
    LIMIT 100
  `,
    params,
  );

  return rows.map((r) => ({
    avatar: emojiCategoria(r.categoria),
    title: String(r.destinatario ?? r.loja ?? 'Despesa'),
    subtitle: `${r.loja} · ${r.obra_nome ?? 'Geral'}`,
    theme: 'red',
    id: Number(r.id),
    metrics: [
      { label: 'Categoria', value: String(r.categoria) },
      { label: 'Data', value: fmtDataBR(r.data) },
      { label: 'Valor', value: formatBRL(r.valor_total), highlight: 'red' },
    ],
  }));
}

/**
 * FINANCEIRO · lançamentos (romatec_obra_transacoes)
 */
export async function queryFinanceiro(pool: Pool, obraId?: number): Promise<LiveFeedCard[]> {
  const filter = obraId ? 'WHERE t.obra_id = ?' : '';
  const params: number[] = obraId ? [obraId] : [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      t.id,
      t.tipo,
      t.descricao,
      t.categoria,
      t.fornecedor,
      t.valor,
      t.data,
      t.forma_pagamento,
      o.nome AS obra_nome
    FROM romatec_obra_transacoes t
    LEFT JOIN romatec_obras o ON o.id = t.obra_id
    ${filter}
    ORDER BY t.data DESC, t.id DESC
    LIMIT 100
  `,
    params,
  );

  return rows.map((r) => {
    const entrada = r.tipo === 'entrada';
    return {
      avatar: entrada ? '⬆️' : '⬇️',
      title: String(r.descricao),
      subtitle: `${r.fornecedor ?? r.categoria ?? 'Manual'} · ${r.obra_nome ?? 'Geral'}`,
      theme: entrada ? 'green' : 'red',
      id: Number(r.id),
      metrics: [
        { label: 'Tipo', value: entrada ? 'ENTRADA' : 'SAÍDA' },
        { label: 'Data', value: fmtDataBR(r.data) },
        { label: 'Valor', value: formatBRL(r.valor), highlight: entrada ? 'green' : 'red' },
      ],
    };
  });
}

/**
 * CONTRATOS · sem tabela MySQL no projeto (contratos_gerados é Supabase).
 * Fallback: propostas aceitas servem como contrato firmado.
 */
export async function queryContratos(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      p.id,
      p.numero,
      p.endereco_obra,
      p.data_proposta,
      p.valor_total,
      p.status,
      c.nome AS cliente_nome,
      c.cidade
    FROM propostas p
    LEFT JOIN propostas_clientes c ON c.id = p.cliente_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.data_proposta DESC, p.id DESC
    LIMIT 100
  `);

  return rows.map((r) => {
    const status = String(r.status);
    const aceita = status === 'aceita';
    return {
      avatar: '📄',
      title: String(r.cliente_nome ?? 'Sem cliente'),
      subtitle: `Proposta #${r.numero} · ${fmtDataBR(r.data_proposta)}`,
      theme: 'gold',
      id: Number(r.id),
      metrics: [
        { label: 'Valor', value: formatBRL(r.valor_total), highlight: 'gold' },
        {
          label: 'Status',
          value: status.toUpperCase(),
          highlight: aceita ? 'green' : status === 'recusada' ? 'red' : 'orange',
        },
        { label: 'Cidade', value: r.cidade ?? '—' },
      ],
    };
  });
}

/**
 * DEMARCAÇÕES · alias de laudos com filtro mais estrito
 */
export async function queryDemarcacoes(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      l.id,
      l.numero_laudo,
      l.tipo_imovel,
      l.tipo_lote_urbano,
      l.quadra,
      l.numero_lote,
      l.loteamento,
      l.denominacao_imovel,
      l.area_total_m2,
      l.valor_servico,
      l.status,
      c.nome AS contratante_nome
    FROM laudos_demarcacao l
    LEFT JOIN contratantes c ON c.id = l.contratante_id
    WHERE l.ativo = TRUE
    ORDER BY l.created_at DESC
    LIMIT 100
  `);

  return rows.map((r) => {
    const status = String(r.status ?? 'RASCUNHO');
    const concluido = status === 'CONFIRMADO' || status === 'ASSINADO';
    const lugar =
      r.tipo_imovel === 'RURAL'
        ? r.denominacao_imovel ?? 'Imóvel rural'
        : `Lote ${r.numero_lote ?? '—'} Qd ${r.quadra ?? '—'}`;
    return {
      avatar: '📐',
      title: String(r.contratante_nome ?? 'Sem contratante'),
      subtitle: `${lugar} · ${r.loteamento ?? ''}`.trim(),
      theme: 'gold',
      id: Number(r.id),
      metrics: [
        { label: 'Área', value: `${Number(r.area_total_m2 ?? 0).toFixed(2)} m²` },
        { label: 'Valor', value: formatBRL(r.valor_servico), highlight: 'gold' },
        { label: 'Status', value: status, highlight: concluido ? 'green' : 'orange' },
      ],
    };
  });
}

/**
 * DIÁRIAS · lançamentos recentes (últimos 15 dias)
 */
export async function queryDiarias(pool: Pool, obraId?: number): Promise<LiveFeedCard[]> {
  const filter = obraId ? 'AND d.obra_id = ?' : '';
  const params: number[] = obraId ? [obraId] : [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      d.id,
      d.data,
      d.periodo,
      d.valor,
      e.nome AS colaborador_nome,
      e.funcao,
      e.valor_dia,
      o.nome AS obra_nome
    FROM romatec_obra_funcionario_dias d
    INNER JOIN romatec_obra_equipe e ON e.id = d.funcionario_id
    LEFT JOIN romatec_obras o ON o.id = d.obra_id
    WHERE d.data >= DATE_SUB(CURDATE(), INTERVAL 15 DAY) ${filter}
    ORDER BY d.data DESC, d.id DESC
    LIMIT 100
  `,
    params,
  );

  return rows.map((r) => {
    const valorBase =
      r.valor != null
        ? Number(r.valor)
        : r.periodo === 'integral'
          ? Number(r.valor_dia ?? 0)
          : Number(r.valor_dia ?? 0) * 0.5;
    return {
      avatar: getInitials(r.colaborador_nome),
      title: String(r.colaborador_nome),
      subtitle: `${r.funcao ?? '—'} · ${r.obra_nome ?? 'Sem obra'}`,
      theme: 'green',
      id: Number(r.id),
      metrics: [
        { label: 'Período', value: String(r.periodo).toUpperCase() },
        { label: 'Data', value: fmtDataBR(r.data) },
        { label: 'Valor', value: formatBRL(valorBase), highlight: 'gold' },
      ],
    };
  });
}

/**
 * CERTIFICAÇÕES · usa registros dos executantes (CREA/CFT/INCRA).
 * Sem tabela dedicada de certificacoes neste projeto.
 */
export async function queryCerts(pool: Pool): Promise<LiveFeedCard[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      id,
      nome,
      qualificacao,
      registro_crea,
      registro_cft,
      cadastro_incra
    FROM executantes
    WHERE ativo = TRUE
    ORDER BY nome ASC
  `);

  return rows.map((r) => {
    const registros = [
      r.registro_crea && `CREA ${r.registro_crea}`,
      r.registro_cft && `CFT ${r.registro_cft}`,
      r.cadastro_incra && `INCRA ${r.cadastro_incra}`,
    ].filter(Boolean);

    return {
      avatar: '📜',
      title: String(r.nome),
      subtitle: String(r.qualificacao ?? 'Responsável técnico'),
      theme: 'green',
      id: Number(r.id),
      metrics: [
        { label: 'CREA', value: r.registro_crea ?? '—' },
        { label: 'CFT', value: r.registro_cft ?? '—' },
        { label: 'Registros', value: String(registros.length), highlight: 'gold' },
      ],
    };
  });
}
