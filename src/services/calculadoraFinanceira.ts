// Calculadora financeira pra Romatec — v1.41.0 (Frente C)
//
// Tools usadas em conversas com clientes (avaliação, simulação financiamento,
// correção de contratos antigos, análise de fluxo de caixa em obras).
//
// Tudo em PT-BR e formatos brasileiros.

const fmt = (n: number, dec = 2) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtBRL = (n: number) => 'R$ ' + fmt(n);

// ── 1. SIMULAÇÃO DE FINANCIAMENTO (Tabela Price ou SAC) ──────────────────────
export interface FinanciamentoInput {
  valor_financiado: number;     // R$
  taxa_juros_mensal: number;    // % a.m. (ex: 1.0 para 1% a.m.)
  prazo_meses: number;
  sistema?: 'price' | 'sac';    // default 'price' (parcela fixa)
}

export interface ParcelaFinanciamento {
  n:           number;
  amortizacao: number;
  juros:       number;
  parcela:     number;
  saldo:       number;
}

export interface FinanciamentoResultado {
  sistema:           'price' | 'sac';
  valor_financiado:  number;
  taxa_mensal_pct:   number;
  taxa_anual_pct:    number;
  prazo_meses:       number;
  primeira_parcela:  number;
  ultima_parcela:    number;
  parcela_media:     number;
  total_pago:        number;
  total_juros:       number;
  cet_aprox_anual:   number;          // Custo efetivo aproximado a.a.
  resumo_amortizacao: ParcelaFinanciamento[];  // primeiros 6 + últimos 3
}

export function simularFinanciamento(input: FinanciamentoInput): FinanciamentoResultado {
  const { valor_financiado: PV, taxa_juros_mensal: jPct, prazo_meses: n } = input;
  const sistema = input.sistema || 'price';
  if (PV <= 0) throw new Error('valor_financiado deve ser > 0');
  if (jPct < 0) throw new Error('taxa_juros_mensal não pode ser negativa');
  if (n <= 0 || !Number.isInteger(n)) throw new Error('prazo_meses deve ser inteiro positivo');

  const j = jPct / 100;
  const todas: ParcelaFinanciamento[] = [];

  if (sistema === 'price') {
    // Parcela fixa: PMT = PV * (j*(1+j)^n) / ((1+j)^n - 1)
    const fator = j === 0 ? 0 : (j * Math.pow(1 + j, n)) / (Math.pow(1 + j, n) - 1);
    const pmt = j === 0 ? PV / n : PV * fator;
    let saldo = PV;
    for (let i = 1; i <= n; i++) {
      const juros       = saldo * j;
      const amortizacao = pmt - juros;
      saldo            -= amortizacao;
      todas.push({ n: i, amortizacao, juros, parcela: pmt, saldo: Math.max(0, saldo) });
    }
  } else {
    // SAC: amortização constante = PV/n. Juros decrescentes. Parcela decrescente.
    const amort = PV / n;
    let saldo = PV;
    for (let i = 1; i <= n; i++) {
      const juros = saldo * j;
      const parcela = amort + juros;
      saldo -= amort;
      todas.push({ n: i, amortizacao: amort, juros, parcela, saldo: Math.max(0, saldo) });
    }
  }

  const totalPago  = todas.reduce((s, p) => s + p.parcela, 0);
  const totalJuros = todas.reduce((s, p) => s + p.juros, 0);
  const taxaAnual  = (Math.pow(1 + j, 12) - 1) * 100;
  // CET aproximado: taxa que iguala valor presente das parcelas ao valor financiado.
  // Como não temos custos extras (TC, IOF, seguro), CET ≈ taxa_anual
  const cetAnual = taxaAnual;

  // Resumo: primeiras 6 + últimas 3
  const resumo = todas.length <= 12
    ? todas
    : [...todas.slice(0, 6), ...todas.slice(-3)];

  return {
    sistema,
    valor_financiado:  PV,
    taxa_mensal_pct:   jPct,
    taxa_anual_pct:    Math.round(taxaAnual * 100) / 100,
    prazo_meses:       n,
    primeira_parcela:  todas[0].parcela,
    ultima_parcela:    todas[todas.length - 1].parcela,
    parcela_media:     totalPago / n,
    total_pago:        totalPago,
    total_juros:       totalJuros,
    cet_aprox_anual:   Math.round(cetAnual * 100) / 100,
    resumo_amortizacao: resumo,
  };
}

// ── 2. CORREÇÃO MONETÁRIA (IPCA / IGP-M / INCC custom) ────────────────────────
export interface CorrecaoMonetariaInput {
  valor_inicial:     number;
  data_inicial:      string;       // YYYY-MM-DD
  data_final?:       string;       // default: hoje
  indice_anual_pct:  number;       // ex: 4.5 pra IPCA 4.5% anual
}

export interface CorrecaoMonetariaResultado {
  valor_inicial:        number;
  data_inicial:         string;
  data_final:           string;
  meses_decorridos:     number;
  anos_decorridos:      number;
  indice_anual_pct:     number;
  fator_correcao:       number;     // ex: 1.0935
  valor_corrigido:      number;
  variacao_total_pct:   number;
  observacao:           string;
}

export function calcularCorrecaoMonetaria(input: CorrecaoMonetariaInput): CorrecaoMonetariaResultado {
  const dataIni = new Date(input.data_inicial + 'T00:00:00');
  const dataFim = input.data_final ? new Date(input.data_final + 'T00:00:00') : new Date();
  if (isNaN(dataIni.getTime())) throw new Error(`data_inicial inválida: ${input.data_inicial}`);
  if (isNaN(dataFim.getTime())) throw new Error(`data_final inválida: ${input.data_final}`);
  if (dataFim < dataIni) throw new Error('data_final precisa ser >= data_inicial');

  const ms      = dataFim.getTime() - dataIni.getTime();
  const meses   = ms / (1000 * 60 * 60 * 24 * 30.4375);
  const anos    = meses / 12;
  const taxaMensal = Math.pow(1 + input.indice_anual_pct / 100, 1 / 12) - 1;
  const fator   = Math.pow(1 + taxaMensal, meses);
  const corrig  = input.valor_inicial * fator;
  const variacao = (fator - 1) * 100;

  return {
    valor_inicial:      input.valor_inicial,
    data_inicial:       input.data_inicial,
    data_final:         dataFim.toISOString().slice(0, 10),
    meses_decorridos:   Math.round(meses * 10) / 10,
    anos_decorridos:    Math.round(anos * 100) / 100,
    indice_anual_pct:   input.indice_anual_pct,
    fator_correcao:     Math.round(fator * 100000) / 100000,
    valor_corrigido:    Math.round(corrig * 100) / 100,
    variacao_total_pct: Math.round(variacao * 100) / 100,
    observacao:         `Correção pelo índice anual de ${input.indice_anual_pct}% a.a. (taxa equivalente mensal ${(taxaMensal * 100).toFixed(4)}%). Para precisão fiscal use os índices acumulados oficiais do IBGE/FGV.`,
  };
}

// ── 3. VPL — Valor Presente Líquido (análise de fluxo de caixa) ──────────────
export interface VplInput {
  taxa_desconto_anual_pct: number;        // ex: 12 pra 12% a.a.
  fluxos_mensais:          number[];      // primeiro item = mês 0 (entrada/saída inicial)
}

export interface VplResultado {
  vpl:                  number;
  total_fluxos:         number;
  taxa_anual_pct:       number;
  taxa_mensal_pct:      number;
  meses:                number;
  decisao:              'investir' | 'nao_investir' | 'neutro';
  observacao:           string;
}

export function calcularVPL(input: VplInput): VplResultado {
  if (!Array.isArray(input.fluxos_mensais) || input.fluxos_mensais.length === 0) {
    throw new Error('fluxos_mensais deve ser array com ao menos 1 valor');
  }
  const taxaMensal = Math.pow(1 + input.taxa_desconto_anual_pct / 100, 1 / 12) - 1;
  let vpl = 0;
  for (let t = 0; t < input.fluxos_mensais.length; t++) {
    vpl += input.fluxos_mensais[t] / Math.pow(1 + taxaMensal, t);
  }
  const total = input.fluxos_mensais.reduce((a, b) => a + b, 0);
  const decisao: 'investir' | 'nao_investir' | 'neutro' =
    vpl > 0 ? 'investir' : vpl < 0 ? 'nao_investir' : 'neutro';

  return {
    vpl:              Math.round(vpl * 100) / 100,
    total_fluxos:     Math.round(total * 100) / 100,
    taxa_anual_pct:   input.taxa_desconto_anual_pct,
    taxa_mensal_pct:  Math.round(taxaMensal * 1000000) / 10000,
    meses:            input.fluxos_mensais.length - 1,
    decisao,
    observacao:       vpl > 0
      ? `VPL positivo (${fmtBRL(vpl)}) — projeto agrega valor à taxa de ${input.taxa_desconto_anual_pct}% a.a.`
      : vpl < 0
        ? `VPL negativo (${fmtBRL(vpl)}) — projeto destrói valor à taxa de ${input.taxa_desconto_anual_pct}% a.a.`
        : `VPL = 0 — projeto neutro à taxa de ${input.taxa_desconto_anual_pct}% a.a.`,
  };
}

// ── 4. CONVERSÃO DE TAXAS (mensal ↔ anual) ───────────────────────────────────
export function converterTaxa(input: { taxa_pct: number; de: 'mensal' | 'anual'; para: 'mensal' | 'anual' }): {
  taxa_origem_pct: number; periodo_origem: string; taxa_destino_pct: number; periodo_destino: string;
} {
  const t = input.taxa_pct / 100;
  let nova: number;
  if (input.de === input.para) nova = t;
  else if (input.de === 'mensal' && input.para === 'anual') nova = Math.pow(1 + t, 12) - 1;
  else nova = Math.pow(1 + t, 1 / 12) - 1;  // anual → mensal
  return {
    taxa_origem_pct:  input.taxa_pct,
    periodo_origem:   input.de,
    taxa_destino_pct: Math.round(nova * 1000000) / 10000,  // 4 casas decimais
    periodo_destino:  input.para,
  };
}

// ── 5. PARCELAMENTO simples (sem juros) ──────────────────────────────────────
export function calcularParcelamento(input: { valor: number; entrada?: number; n_parcelas: number; juros_mes_pct?: number }): {
  valor_total:    number;
  entrada:        number;
  valor_a_parcelar: number;
  n_parcelas:     number;
  parcela:        number;
  total_pago:     number;
  juros_mes_pct:  number;
} {
  if (input.valor <= 0) throw new Error('valor deve ser > 0');
  if (input.n_parcelas <= 0) throw new Error('n_parcelas deve ser > 0');
  const entrada = Math.max(0, Math.min(input.entrada ?? 0, input.valor));
  const aParcelar = input.valor - entrada;
  const j = (input.juros_mes_pct ?? 0) / 100;
  let parcela: number;
  if (j === 0) parcela = aParcelar / input.n_parcelas;
  else parcela = aParcelar * (j * Math.pow(1 + j, input.n_parcelas)) / (Math.pow(1 + j, input.n_parcelas) - 1);
  const total = entrada + parcela * input.n_parcelas;
  return {
    valor_total:      input.valor,
    entrada,
    valor_a_parcelar: Math.round(aParcelar * 100) / 100,
    n_parcelas:       input.n_parcelas,
    parcela:          Math.round(parcela * 100) / 100,
    total_pago:       Math.round(total * 100) / 100,
    juros_mes_pct:    input.juros_mes_pct ?? 0,
  };
}
