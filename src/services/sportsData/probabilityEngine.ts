// v3.111.0 — Motor estatistico de probabilidades esportivas (fase 2 da spec).
//
// Modelo Poisson bivariado com correcao de Dixon-Coles (1997) para placares
// baixos. Parametrico e auditavel de proposito: cada numero da saida da pra
// rastrear ate uma formula. Nao e machine learning.
//
// ESCOPO: matematica pura. Nenhum acesso a rede, banco ou provedor externo —
// por isso esta fase pode ser construida e testada antes de fechar contrato com
// SportRadar/API-Football. Os adapters (fases 1 e 3) alimentam estas funcoes.
//
// LIMITE DO MODELO, pra quem for ler a saida:
// Poisson assume que gols sao eventos independentes a taxa constante. Nao sabe
// de expulsao, lesao, chuva, time reserva em final de campeonato nem motivacao.
// A correcao de Dixon-Coles existe justamente porque a suposicao de
// independencia erra em placares baixos (0-0 e 1-1 acontecem mais do que o
// Poisson puro preve). O numero que sai daqui e uma estimativa com incerteza
// grande, nao uma previsao.

/** Resultado 1x2 com as tres probabilidades somando 1. */
export interface Probabilidades1x2 {
  probCasa: number;
  probEmpate: number;
  probVisitante: number;
}

/** Forca de um time, normalizada pela media da liga (1.0 = exatamente na media). */
export interface ForcaTime {
  ataque: number;
  defesa: number;
}

// ─── Poisson base ────────────────────────────────────────────────────

/**
 * P(k; lambda) = lambda^k * e^-lambda / k!
 * Calculado em log pra nao estourar o fatorial em k alto.
 */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logFat = 0;
  for (let i = 2; i <= k; i++) logFat += Math.log(i);
  return Math.exp(k * Math.log(lambda) - lambda - logFat);
}

/**
 * Correcao tau de Dixon-Coles. Ajusta os quatro placares baixos onde o Poisson
 * puro erra sistematicamente. rho = 0 desliga a correcao (volta ao Poisson).
 *
 * rho negativo (tipico entre -0.15 e -0.03) empurra probabilidade PARA 0-0 e
 * 1-1 e TIRA de 0-1 e 1-0 — ou seja, aumenta empate em jogo travado.
 */
export function tauDixonColes(
  golsCasa: number, golsVisitante: number,
  lambdaCasa: number, lambdaVisitante: number,
  rho: number,
): number {
  if (golsCasa === 0 && golsVisitante === 0) return 1 - lambdaCasa * lambdaVisitante * rho;
  if (golsCasa === 0 && golsVisitante === 1) return 1 + lambdaCasa * rho;
  if (golsCasa === 1 && golsVisitante === 0) return 1 + lambdaVisitante * rho;
  if (golsCasa === 1 && golsVisitante === 1) return 1 - rho;
  return 1;
}

// ─── Matriz de placares ──────────────────────────────────────────────

export interface OpcoesMatriz {
  /** Maior placar considerado por lado. Default 8 (cobre >99.9% dos jogos). */
  maxGols?: number;
  /** Correlacao de Dixon-Coles. Default -0.05. Use 0 pra Poisson puro. */
  rho?: number;
}

/**
 * Matriz[casa][visitante] com a probabilidade de cada placar exato.
 * Renormalizada pra somar 1, porque truncar em maxGols descarta a cauda.
 */
export function matrizPlacares(
  lambdaCasa: number, lambdaVisitante: number, opts: OpcoesMatriz = {},
): number[][] {
  const max = opts.maxGols ?? 8;
  const rho = opts.rho ?? -0.05;
  const m: number[][] = [];
  let soma = 0;
  for (let c = 0; c <= max; c++) {
    m[c] = [];
    for (let v = 0; v <= max; v++) {
      const p = poissonPmf(c, lambdaCasa) * poissonPmf(v, lambdaVisitante)
              * tauDixonColes(c, v, lambdaCasa, lambdaVisitante, rho);
      // tau pode ficar levemente negativo com rho extremo — nao existe
      // probabilidade negativa, entao trunca em 0.
      m[c][v] = Math.max(0, p);
      soma += m[c][v];
    }
  }
  if (soma > 0) {
    for (let c = 0; c <= max; c++) {
      for (let v = 0; v <= max; v++) m[c][v] /= soma;
    }
  }
  return m;
}

// ─── Mercados ────────────────────────────────────────────────────────

/** Agrega a matriz de placares em casa / empate / visitante. */
export function probabilidades1x2DaMatriz(matriz: number[][]): Probabilidades1x2 {
  let casa = 0, empate = 0, visitante = 0;
  for (let c = 0; c < matriz.length; c++) {
    for (let v = 0; v < matriz[c].length; v++) {
      if (c > v) casa += matriz[c][v];
      else if (c === v) empate += matriz[c][v];
      else visitante += matriz[c][v];
    }
  }
  return { probCasa: casa, probEmpate: empate, probVisitante: visitante };
}

/**
 * Probabilidade de over/under numa linha (2.5, 3.5...). Linha fracionaria nao
 * empata, entao over + under = 1. Linha inteira (2.0) devolveria push, que este
 * modelo nao trata — use sempre linha .5.
 */
export function probabilidadeOverUnder(
  matriz: number[][], linha: number,
): { over: number; under: number } {
  let over = 0, under = 0;
  for (let c = 0; c < matriz.length; c++) {
    for (let v = 0; v < matriz[c].length; v++) {
      if (c + v > linha) over += matriz[c][v];
      else under += matriz[c][v];
    }
  }
  return { over, under };
}

/** Probabilidade de ambas as equipes marcarem. */
export function probabilidadeAmbasMarcam(matriz: number[][]): { sim: number; nao: number } {
  let sim = 0;
  for (let c = 1; c < matriz.length; c++) {
    for (let v = 1; v < matriz[c].length; v++) sim += matriz[c][v];
  }
  return { sim, nao: 1 - sim };
}

// ─── Entrada principal ───────────────────────────────────────────────

export interface EntradaPartida {
  casa: ForcaTime;
  visitante: ForcaTime;
  /** Media de gols por time por jogo na liga. Ex.: 1.35 no Brasileirao. */
  mediaGolsLiga: number;
  /**
   * Multiplicador de mando de campo aplicado ao lambda da casa. 1.0 = sem
   * vantagem. Tipico 1.15-1.35 no futebol brasileiro.
   */
  fatorMando?: number;
  opcoes?: OpcoesMatriz;
}

export interface ResultadoPartida extends Probabilidades1x2 {
  lambdaCasa: number;
  lambdaVisitante: number;
  matriz: number[][];
  metodologia: string;
}

export const METODOLOGIA = 'poisson-dixoncoles-v1';

/**
 * Calcula as probabilidades 1x2 a partir das forcas dos times.
 *
 *   lambda_casa      = ataqueCasa * defesaVisitante * mediaGolsLiga * fatorMando
 *   lambda_visitante = ataqueVisitante * defesaCasa * mediaGolsLiga
 *
 * Forcas sao razoes contra a media da liga: ataque 1.20 = marca 20% acima da
 * media; defesa 0.90 = sofre 10% abaixo da media (defesa boa e' MENOR que 1).
 */
export function calcularProbabilidadePartida(e: EntradaPartida): ResultadoPartida {
  const mando = e.fatorMando ?? 1.0;
  const lambdaCasa = Math.max(0.01, e.casa.ataque * e.visitante.defesa * e.mediaGolsLiga * mando);
  const lambdaVisitante = Math.max(0.01, e.visitante.ataque * e.casa.defesa * e.mediaGolsLiga);
  const matriz = matrizPlacares(lambdaCasa, lambdaVisitante, e.opcoes);
  return {
    ...probabilidades1x2DaMatriz(matriz),
    lambdaCasa, lambdaVisitante, matriz,
    metodologia: METODOLOGIA,
  };
}

/**
 * Assinatura da spec, mantida pra compatibilidade com o que foi especificado.
 * Repassa pra calcularProbabilidadePartida com mando neutro.
 */
export function calcularProbabilidadePoisson(
  forcaAtaqueCasa: number,
  forcaDefesaVisitante: number,
  forcaAtaqueVisitante: number,
  forcaDefesaCasa: number,
  mediaGolsLiga: number,
): Probabilidades1x2 {
  const r = calcularProbabilidadePartida({
    casa: { ataque: forcaAtaqueCasa, defesa: forcaDefesaCasa },
    visitante: { ataque: forcaAtaqueVisitante, defesa: forcaDefesaVisitante },
    mediaGolsLiga,
  });
  return { probCasa: r.probCasa, probEmpate: r.probEmpate, probVisitante: r.probVisitante };
}

// ─── Forca a partir de resultados ────────────────────────────────────

export interface JogoHistorico {
  golsMarcados: number;
  golsSofridos: number;
  /** Quanto mais antigo, menos pesa. 0 = jogo mais recente. */
  jogosAtras: number;
}

/**
 * Deriva ataque/defesa de um historico, com decaimento exponencial (item 3 da
 * spec): peso = e^(-decaimento * jogosAtras).
 *
 * decaimento 0 trata todos os jogos igual; 0.1 faz o jogo de 10 rodadas atras
 * valer ~37% do ultimo. Default 0.08 — meia-vida de ~8-9 jogos.
 */
export function calcularForcaTime(
  jogos: JogoHistorico[],
  mediaGolsLiga: number,
  decaimento = 0.08,
): ForcaTime {
  if (!jogos.length || mediaGolsLiga <= 0) return { ataque: 1, defesa: 1 };
  let pesoTotal = 0, marcados = 0, sofridos = 0;
  for (const j of jogos) {
    const peso = Math.exp(-decaimento * Math.max(0, j.jogosAtras));
    pesoTotal += peso;
    marcados += peso * j.golsMarcados;
    sofridos += peso * j.golsSofridos;
  }
  if (pesoTotal === 0) return { ataque: 1, defesa: 1 };
  return {
    ataque: (marcados / pesoTotal) / mediaGolsLiga,
    defesa: (sofridos / pesoTotal) / mediaGolsLiga,
  };
}

// ─── Mercado: odds, margem e valor esperado ──────────────────────────

/**
 * Converte odds em probabilidades implicitas REMOVENDO a margem da casa.
 *
 * 1/odd cru soma mais que 1 — a diferenca (overround) e a comissao embutida.
 * Sem normalizar, a comparacao contra o modelo fica enviesada e todo mercado
 * pareceria ruim. Normalizacao proporcional (metodo basico; existem metodos
 * melhores como Shin, mas exigem solver e nao valem a complexidade na v1).
 */
export function probabilidadesImplicitas(odds: number[]): {
  probabilidades: number[];
  overround: number;
} {
  const validas = odds.map((o) => (Number.isFinite(o) && o > 1 ? o : NaN));
  const cruas = validas.map((o) => (Number.isNaN(o) ? 0 : 1 / o));
  const soma = cruas.reduce((s, p) => s + p, 0);
  if (soma <= 0) return { probabilidades: odds.map(() => 0), overround: 0 };
  return {
    probabilidades: cruas.map((p) => p / soma),
    // overround 0.06 = 6% de margem da casa naquele mercado.
    overround: soma - 1,
  };
}

/**
 * Valor esperado por unidade apostada: (prob * odd) - 1.
 *
 * Positivo significa que a odd esta acima do que o MODELO acha justo. Nao
 * significa que a aposta vai ganhar — se o modelo estiver errado (e ele tem
 * incerteza grande), o EV positivo e ilusorio. Serve pra ordenar candidatos,
 * nao pra decidir sozinho.
 */
export function valorEsperado(probabilidadeEstimada: number, odd: number): number {
  if (!Number.isFinite(odd) || odd <= 1) return -1;
  return probabilidadeEstimada * odd - 1;
}

/** Linha do ranking que a fase 4 vai ler pra montar a resposta em texto/voz. */
export interface AvaliacaoMercado {
  selecao: string;
  probabilidadeEstimada: number;
  odd: number;
  probabilidadeImplicita: number;
  valorEsperado: number;
}

/**
 * Junta modelo e mercado, ordenando por valor esperado decrescente.
 * `odds` deve estar na mesma ordem de `selecoes`.
 */
export function avaliarMercado(
  selecoes: string[],
  probabilidadesEstimadas: number[],
  odds: number[],
): AvaliacaoMercado[] {
  const { probabilidades: implicitas } = probabilidadesImplicitas(odds);
  return selecoes
    .map((selecao, i) => ({
      selecao,
      probabilidadeEstimada: probabilidadesEstimadas[i] ?? 0,
      odd: odds[i] ?? 0,
      probabilidadeImplicita: implicitas[i] ?? 0,
      valorEsperado: valorEsperado(probabilidadesEstimadas[i] ?? 0, odds[i] ?? 0),
    }))
    .sort((a, b) => b.valorEsperado - a.valorEsperado);
}

/**
 * Texto exigido pela secao 7 da spec. Exportado como constante pra que a fase 4
 * nao possa "esquecer" de anexar nem reescrever com outras palavras.
 */
export const DISCLAIMER_OBRIGATORIO =
  'As probabilidades exibidas são estimativas estatísticas baseadas em dados '
  + 'históricos e não constituem garantia de resultado. Apostas esportivas '
  + 'envolvem risco de perda financeira.';
