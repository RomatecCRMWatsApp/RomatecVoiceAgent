// v3.129.0 — Calculadora de Divisão de Capital entre Resultados (Dutching / Arbitragem).
//
// Capacidade PESSOAL da ZAYRA (chat/voz) — NÃO é módulo da Gestão de Obras.
// Este arquivo é cálculo PURO, sem I/O: dado um capital (ou lucro alvo) e as
// odds decimais de N resultados mutuamente exclusivos, divide o capital de forma
// que o retorno bruto seja IDÊNTICO em qualquer cenário, e diz objetivamente se
// aquela combinação de odds dá lucro garantido (arbitragem real, S < 1) ou
// prejuízo garantido (margem da casa, S ≥ 1).
//
// Fundamento (odds decimais o_i):
//   p_i   = 1 / o_i                     (probabilidade implícita)
//   S     = Σ p_i                       (book percentage / soma implícita)
//   stake_i   = capital × (p_i / S)
//   retorno_i = stake_i × o_i = capital / S   → igual pra todo i
//   S < 1 → lucro garantido = capital × (1/S − 1)
//   S ≥ 1 → prejuízo garantido = capital × (1 − 1/S)  ← NUNCA apresentar como lucro
//   Capital p/ lucro alvo L (só existe se S < 1): capital = L × S / (1 − S)
//   odd mínima_i = 1 / (1 − Σ_{j≠i} p_j)   (null se Σ_{j≠i} p_j ≥ 1)

// ─── Contratos ──────────────────────────────────────────────────────────
export type Arredondamento = 'centavo' | 'real' | 'nenhum';

export interface ResultadoEntrada {
  rotulo: string;
  odd: number | string;
  casa?: string | null;
}

export interface AlocacaoResultado {
  rotulo: string;
  odd: number;
  casa: string | null;
  stake: number;
  retornoBruto: number;
  lucroLiquido: number;
  percentualCapital: number;
}

export interface ResultadoArbitragem {
  evento: string | null;
  capital: number;
  arredondamento: Arredondamento;
  somaImplicita: number;
  margemPercentual: number;
  arbitragem: boolean;
  alocacoes: AlocacaoResultado[];
  lucroMinimo: number;
  lucroMaximo: number;
  roiPercentual: number;
  oddsMinimasParaArbitragem: Array<number | null>;
  aviso: string;
}

// Códigos de erro do contrato (item 5.5 da spec).
export type CodigoErroArbitragem =
  | 'RESULTADOS_INSUFICIENTES'
  | 'RESULTADOS_EXCEDIDOS'
  | 'ROTULO_VAZIO'
  | 'ROTULO_DUPLICADO'
  | 'ODD_INVALIDA'
  | 'ODD_FORA_DE_FAIXA'
  | 'CAPITAL_INVALIDO'
  | 'LUCRO_ALVO_INVALIDO'
  | 'SEM_ARBITRAGEM'
  | 'PAYLOAD_INVALIDO';

export class ArbitragemError extends Error {
  constructor(
    public readonly codigo: CodigoErroArbitragem,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ArbitragemError';
  }
}

// Limites — 2 a 20 resultados. Odd decimal estritamente > 1 e <= 1000.
const MIN_RESULTADOS = 2;
const MAX_RESULTADOS = 20;
const ODD_MIN_EXCL = 1; // odd tem que ser > 1 (1.00 não gera retorno)
const ODD_MAX = 1000;

// ─── Helpers numéricos ──────────────────────────────────────────────────
function arred2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
// odd mínima "necessária" arredonda PRA CIMA (precisa de ao menos aquilo).
function ceil2(x: number): number {
  return Math.ceil((x - Number.EPSILON) * 100) / 100;
}

// ─── Validação ──────────────────────────────────────────────────────────
function normalizarOdd(valor: number | string): number {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      throw new ArbitragemError('ODD_INVALIDA', `Odd inválida: ${String(valor)}.`);
    }
    return valor;
  }
  const s = String(valor).trim().replace(',', '.');
  const n = Number(s);
  if (s === '' || !Number.isFinite(n)) {
    throw new ArbitragemError('ODD_INVALIDA', `Odd inválida: "${String(valor)}".`);
  }
  return n;
}

interface ResultadoValidado {
  rotulo: string;
  odd: number;
  casa: string | null;
  p: number;
}

function validarResultados(resultados: unknown): ResultadoValidado[] {
  if (!Array.isArray(resultados)) {
    throw new ArbitragemError('PAYLOAD_INVALIDO', 'Campo "resultados" deve ser uma lista.');
  }
  if (resultados.length < MIN_RESULTADOS) {
    throw new ArbitragemError(
      'RESULTADOS_INSUFICIENTES',
      `Informe ao menos ${MIN_RESULTADOS} resultados (ex.: Casa / Empate / Fora).`,
    );
  }
  if (resultados.length > MAX_RESULTADOS) {
    throw new ArbitragemError(
      'RESULTADOS_EXCEDIDOS',
      `No máximo ${MAX_RESULTADOS} resultados por evento.`,
    );
  }

  const vistos = new Set<string>();
  const out: ResultadoValidado[] = [];
  for (const r of resultados as ResultadoEntrada[]) {
    const rotulo = String(r?.rotulo ?? '').trim();
    if (!rotulo) {
      throw new ArbitragemError('ROTULO_VAZIO', 'Todo resultado precisa de um rótulo.');
    }
    const chave = rotulo.toLowerCase();
    if (vistos.has(chave)) {
      throw new ArbitragemError('ROTULO_DUPLICADO', `Rótulo duplicado: "${rotulo}".`);
    }
    vistos.add(chave);

    const odd = normalizarOdd(r?.odd);
    if (odd <= ODD_MIN_EXCL || odd > ODD_MAX) {
      throw new ArbitragemError(
        'ODD_FORA_DE_FAIXA',
        `Odd fora da faixa (${ODD_MIN_EXCL} < odd ≤ ${ODD_MAX}): ${odd} em "${rotulo}".`,
      );
    }

    const casa = r?.casa != null && String(r.casa).trim() !== '' ? String(r.casa).trim() : null;
    out.push({ rotulo, odd, casa, p: 1 / odd });
  }
  return out;
}

// ─── Distribuição do capital (método de Hamilton / maior resto) ─────────
// Garante Σ stakes === capital EXATO após arredondamento. Trabalha em unidades
// inteiras (centavos ou reais) e distribui o resto pelos maiores restos.
function distribuirStakes(
  capital: number,
  pesos: number[], // p_i/S, soma 1
  arredondamento: Arredondamento,
): number[] {
  if (arredondamento === 'nenhum') {
    return pesos.map((peso) => capital * peso);
  }
  const unidade = arredondamento === 'real' ? 1 : 0.01;
  const totalUnidades = Math.round(capital / unidade);

  const bruto = pesos.map((peso) => totalUnidades * peso);
  const base = bruto.map((x) => Math.floor(x));
  let resto = totalUnidades - base.reduce((a, b) => a + b, 0);

  // Índices ordenados por maior parte fracionária (desempate: maior peso, depois ordem).
  const ordem = bruto
    .map((x, i) => ({ i, frac: x - Math.floor(x), peso: pesos[i] }))
    .sort((a, b) => b.frac - a.frac || b.peso - a.peso || a.i - b.i);

  const unidades = base.slice();
  for (let k = 0; k < ordem.length && resto > 0; k++) {
    unidades[ordem[k].i] += 1;
    resto -= 1;
  }
  return unidades.map((u) => arred2(u * unidade));
}

// ─── Odds mínimas p/ virar arbitragem ───────────────────────────────────
function oddsMinimas(resultados: ResultadoValidado[]): Array<number | null> {
  const somaTotal = resultados.reduce((acc, r) => acc + r.p, 0);
  return resultados.map((r) => {
    const somaOutros = somaTotal - r.p;
    if (somaOutros >= 1) return null;
    return ceil2(1 / (1 - somaOutros));
  });
}

// ─── Núcleo ─────────────────────────────────────────────────────────────
export interface EntradaCalculo {
  evento?: string | null;
  capital: number;
  arredondamento?: Arredondamento;
  resultados: ResultadoEntrada[];
}

export function calcularDivisao(entrada: EntradaCalculo): ResultadoArbitragem {
  const arredondamento: Arredondamento = entrada.arredondamento ?? 'centavo';
  const capital = Number(entrada.capital);
  if (!Number.isFinite(capital) || capital <= 0) {
    throw new ArbitragemError('CAPITAL_INVALIDO', 'Capital deve ser um número maior que zero.');
  }

  const resultados = validarResultados(entrada.resultados);
  const S = resultados.reduce((acc, r) => acc + r.p, 0);
  const arbitragem = S < 1;
  const pesos = resultados.map((r) => r.p / S);

  const stakes = distribuirStakes(capital, pesos, arredondamento);

  const alocacoes: AlocacaoResultado[] = resultados.map((r, i) => {
    const stake = stakes[i];
    const retornoBruto = arred2(stake * r.odd);
    return {
      rotulo: r.rotulo,
      odd: r.odd,
      casa: r.casa,
      stake,
      retornoBruto,
      lucroLiquido: arred2(retornoBruto - capital),
      percentualCapital: arred2((stake / capital) * 100),
    };
  });

  const retornos = alocacoes.map((a) => a.retornoBruto);
  const lucroMinimo = arred2(Math.min(...retornos) - capital);
  const lucroMaximo = arred2(Math.max(...retornos) - capital);
  const roiPercentual = arred2((lucroMinimo / capital) * 100);
  const oddsMin = oddsMinimas(resultados);

  const margemPercentual = arred2((S - 1) * 100);
  const aviso = montarAviso({ arbitragem, S, capital, lucroMinimo, roiPercentual, oddsMin, resultados });

  return {
    evento: entrada.evento?.trim() || null,
    capital,
    arredondamento,
    somaImplicita: S,
    margemPercentual,
    arbitragem,
    alocacoes,
    lucroMinimo,
    lucroMaximo,
    roiPercentual,
    oddsMinimasParaArbitragem: oddsMin,
    aviso,
  };
}

export interface EntradaPorLucro {
  evento?: string | null;
  lucroAlvo: number;
  arredondamento?: Arredondamento;
  resultados: ResultadoEntrada[];
}

// Capital necessário pra um lucro alvo — só existe se S < 1. Se S ≥ 1, joga
// SEM_ARBITRAGEM com as odds mínimas (a rota mapeia pra HTTP 422).
export function calcularPorLucro(entrada: EntradaPorLucro): ResultadoArbitragem {
  const lucroAlvo = Number(entrada.lucroAlvo);
  if (!Number.isFinite(lucroAlvo) || lucroAlvo <= 0) {
    throw new ArbitragemError('LUCRO_ALVO_INVALIDO', 'Lucro alvo deve ser um número maior que zero.');
  }

  const resultados = validarResultados(entrada.resultados);
  const S = resultados.reduce((acc, r) => acc + r.p, 0);
  if (S >= 1) {
    const oddsMin = oddsMinimas(resultados);
    throw new ArbitragemError(
      'SEM_ARBITRAGEM',
      `Sem arbitragem: a soma implícita é ${arred2(S * 100)}% (≥ 100%). Com estas odds só há ` +
        `prejuízo garantido — não existe capital que gere lucro. Odds mínimas necessárias: ` +
        resultados.map((r, i) => `${r.rotulo} ≥ ${oddsMin[i] ?? '—'}`).join(' · ') + '.',
      { somaImplicita: S, oddsMinimasParaArbitragem: oddsMin },
    );
  }

  const capital = arred2((lucroAlvo * S) / (1 - S));
  return calcularDivisao({
    evento: entrada.evento,
    capital,
    arredondamento: entrada.arredondamento,
    resultados: entrada.resultados,
  });
}

function montarAviso(ctx: {
  arbitragem: boolean;
  S: number;
  capital: number;
  lucroMinimo: number;
  roiPercentual: number;
  oddsMin: Array<number | null>;
  resultados: ResultadoValidado[];
}): string {
  if (ctx.arbitragem) {
    return (
      `✅ Arbitragem real: lucro garantido de R$ ${ctx.lucroMinimo.toFixed(2)} ` +
      `(ROI ${ctx.roiPercentual.toFixed(2)}%) em QUALQUER resultado.`
    );
  }
  const prejuizo = arred2(ctx.capital * (1 - 1 / ctx.S));
  const margem = arred2((ctx.S - 1) * 100);
  const minimas = ctx.resultados
    .map((r, i) => `${r.rotulo} ≥ ${ctx.oddsMin[i] ?? '—'}`)
    .join(' · ');
  return (
    `⚠️ Prejuízo garantido de R$ ${prejuizo.toFixed(2)} (margem da casa ${margem.toFixed(2)}%). ` +
    `NÃO é arbitragem: com estas odds todo cenário devolve menos que o capital. ` +
    `Pra virar lucro, precisaria de: ${minimas}.`
  );
}
