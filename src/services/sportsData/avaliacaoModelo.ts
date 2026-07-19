// v3.112.0 — Avaliacao e calibracao de modelos de probabilidade esportiva.
//
// A spec (secao 10) diz: "disciplina estatistica — sem isso o resto e decoracao".
// Concordo, e este arquivo e' essa disciplina.
//
// POR QUE ISTO IMPORTA MAIS QUE QUALQUER FEATURE NOVA:
// um modelo de probabilidade nunca "erra" de forma visivel. Ele cospe 54% e o jogo
// acontece — 54% nao e' certo nem errado num jogo so. Da pra rodar um modelo
// completamente quebrado por uma temporada inteira sem perceber, porque a saida
// sempre parece razoavel. So metrica agregada sobre muitos eventos separa modelo
// bom de gerador de numero bonito.
//
// Tres perguntas que este modulo responde:
//   1. O modelo erra pouco?          -> Brier score / log-loss
//   2. Os 60% dele sao 60% de verdade? -> calibracao por faixa
//   3. Ele bate o mercado?            -> Brier do modelo vs Brier da linha de fechamento
//
// A pergunta 3 e' a unica que importa de verdade pra decidir se o modelo tem valor.
// Um modelo pode ter Brier otimo e mesmo assim ser inutil, se o mercado for melhor
// que ele — e o mercado costuma ser muito bom.

/** Resultado observado de um evento 1x2. */
export type ResultadoObservado = 'casa' | 'empate' | 'visitante';

/** Previsao de um evento + o que de fato aconteceu. */
export interface PrevisaoAvaliada {
  probCasa: number;
  probEmpate: number;
  probVisitante: number;
  observado: ResultadoObservado;
}

const ORDEM: ResultadoObservado[] = ['casa', 'empate', 'visitante'];

function vetorPrevisto(p: PrevisaoAvaliada): number[] {
  return [p.probCasa, p.probEmpate, p.probVisitante];
}

function vetorObservado(p: PrevisaoAvaliada): number[] {
  return ORDEM.map((r) => (r === p.observado ? 1 : 0));
}

// ─── Brier score ─────────────────────────────────────────────────────

/**
 * Brier multiclasse: media de sum((p_i - o_i)^2) sobre as 3 selecoes.
 *
 * Faixa 0 a 2. MENOR e' melhor. Referencias uteis pra futebol 1x2:
 *   0.00  previsao perfeita (impossivel na pratica)
 *   ~0.56 chute uniforme (1/3, 1/3, 1/3)
 *   ~0.20 modelos bons de mercado
 *   2.00  errado com certeza absoluta em todos os jogos
 *
 * Diferente de "taxa de acerto", o Brier pune confianca mal colocada: dizer 95%
 * e errar custa muito mais que dizer 40% e errar. E' por isso que ele e' a metrica
 * certa aqui — taxa de acerto premiaria um modelo que so aponta o favorito.
 */
export function brierScore(previsoes: PrevisaoAvaliada[]): number {
  if (!previsoes.length) return NaN;
  let soma = 0;
  for (const p of previsoes) {
    const prev = vetorPrevisto(p);
    const obs = vetorObservado(p);
    for (let i = 0; i < 3; i++) soma += (prev[i] - obs[i]) ** 2;
  }
  return soma / previsoes.length;
}

/**
 * Log-loss (entropia cruzada): -media(log(p_do_resultado_correto)).
 *
 * MENOR e' melhor. Pune com muito mais severidade que o Brier a previsao confiante
 * e errada — dizer 1% pro que aconteceu tende a infinito. Por isso o clamp: sem
 * ele, um unico evento com probabilidade 0 destruiria a metrica inteira.
 */
export function logLoss(previsoes: PrevisaoAvaliada[], epsilon = 1e-15): number {
  if (!previsoes.length) return NaN;
  let soma = 0;
  for (const p of previsoes) {
    const prev = vetorPrevisto(p);
    const idx = ORDEM.indexOf(p.observado);
    const pc = Math.min(1 - epsilon, Math.max(epsilon, prev[idx]));
    soma += -Math.log(pc);
  }
  return soma / previsoes.length;
}

// ─── Calibracao ──────────────────────────────────────────────────────

export interface FaixaCalibracao {
  /** Limite inferior da faixa, ex.: 0.5 pra faixa 50-60%. */
  de: number;
  ate: number;
  /** Quantas previsoes cairam nesta faixa. */
  n: number;
  /** Media das probabilidades previstas dentro da faixa. */
  probabilidadeMedia: number;
  /** Frequencia com que o evento REALMENTE aconteceu na faixa. */
  frequenciaObservada: number;
  /** probabilidadeMedia - frequenciaObservada. Positivo = otimista demais. */
  desvio: number;
}

/**
 * Agrupa TODAS as previsoes (as 3 selecoes de cada evento) por faixa de
 * probabilidade e compara previsto contra observado.
 *
 * E' o teste que a spec descreve: "quando o modelo diz 60%, isso precisa se
 * confirmar ~60% das vezes". Um modelo pode ter Brier aceitavel e ainda ser
 * sistematicamente otimista — a calibracao mostra isso, o Brier sozinho nao.
 */
export function calibracao(previsoes: PrevisaoAvaliada[], nFaixas = 10): FaixaCalibracao[] {
  const faixas: Array<{ soma: number; acertos: number; n: number }> = Array.from(
    { length: nFaixas }, () => ({ soma: 0, acertos: 0, n: 0 }),
  );
  for (const p of previsoes) {
    const prev = vetorPrevisto(p);
    const obs = vetorObservado(p);
    for (let i = 0; i < 3; i++) {
      const prob = Math.min(0.999999, Math.max(0, prev[i]));
      const idx = Math.min(nFaixas - 1, Math.floor(prob * nFaixas));
      faixas[idx].soma += prob;
      faixas[idx].acertos += obs[i];
      faixas[idx].n += 1;
    }
  }
  return faixas.map((f, i) => {
    const probabilidadeMedia = f.n ? f.soma / f.n : 0;
    const frequenciaObservada = f.n ? f.acertos / f.n : 0;
    return {
      de: i / nFaixas,
      ate: (i + 1) / nFaixas,
      n: f.n,
      probabilidadeMedia,
      frequenciaObservada,
      desvio: probabilidadeMedia - frequenciaObservada,
    };
  });
}

/**
 * Erro de calibracao esperado (ECE): media dos desvios absolutos ponderada pelo
 * numero de previsoes em cada faixa. Um numero so pra acompanhar ao longo do tempo.
 * 0 = perfeitamente calibrado. Acima de ~0.05 ja e' desvio relevante.
 */
export function erroCalibracao(previsoes: PrevisaoAvaliada[], nFaixas = 10): number {
  const faixas = calibracao(previsoes, nFaixas);
  const total = faixas.reduce((s, f) => s + f.n, 0);
  if (!total) return NaN;
  return faixas.reduce((s, f) => s + (f.n / total) * Math.abs(f.desvio), 0);
}

// ─── Modelo contra mercado ───────────────────────────────────────────

export interface ComparacaoMercado {
  brierModelo: number;
  brierMercado: number;
  logLossModelo: number;
  logLossMercado: number;
  /** brierMercado - brierModelo. Positivo = modelo melhor que o mercado. */
  vantagemBrier: number;
  /** true so se o modelo for melhor nas DUAS metricas. */
  modeloBateuMercado: boolean;
  amostra: number;
}

/**
 * O teste que decide se este projeto vale a pena.
 *
 * Compara o modelo contra a probabilidade implicita da linha de FECHAMENTO (a odd
 * logo antes do jogo, ja sem a margem). A closing line e' notoriamente eficiente:
 * bater ela de forma consistente e' dificil, e nao bater significa que o modelo
 * nao esta agregando informacao — por mais bonito que seja o numero que ele produz.
 *
 * Cuidado com amostra pequena: com 20 jogos, qualquer resultado aqui e' ruido.
 * O campo `amostra` existe pra isso ser levado em conta antes de comemorar.
 */
export function compararComMercado(
  previsoesModelo: PrevisaoAvaliada[],
  previsoesMercado: PrevisaoAvaliada[],
): ComparacaoMercado {
  if (previsoesModelo.length !== previsoesMercado.length) {
    throw new Error('modelo e mercado precisam ter o mesmo numero de eventos, na mesma ordem');
  }
  const brierModelo = brierScore(previsoesModelo);
  const brierMercado = brierScore(previsoesMercado);
  const logLossModelo = logLoss(previsoesModelo);
  const logLossMercado = logLoss(previsoesMercado);
  return {
    brierModelo, brierMercado, logLossModelo, logLossMercado,
    vantagemBrier: brierMercado - brierModelo,
    // Exige vantagem nas duas metricas: ganhar em uma so costuma ser artefato.
    modeloBateuMercado: brierModelo < brierMercado && logLossModelo < logLossMercado,
    amostra: previsoesModelo.length,
  };
}

// ─── Kelly (referencia estatistica) ──────────────────────────────────

/**
 * Fracao de Kelly: f* = (p*(o-1) - (1-p)) / (o-1), com o em odd decimal.
 *
 * IMPORTANTE — LEIA ANTES DE USAR:
 * isto e' a matematica de quanto uma vantagem ESTIMADA vale proporcionalmente,
 * documentada como referencia conforme a secao 10 da spec. NAO e' orientacao de
 * quanto apostar, e a propria spec pede que seja tratada assim.
 *
 * Duas armadilhas conhecidas do Kelly pleno:
 *  - ele assume que `p` esta CERTO. Se o modelo superestima a vantagem (o caso
 *    comum), Kelly pleno leva a ruina mesmo com vantagem real;
 *  - a variancia e' brutal. Por isso o uso academico e' sempre fracionario
 *    (fracao 0.25 ou menos), e por isso o default aqui e' 0.25.
 *
 * Retorna 0 quando nao ha vantagem — nunca sugere valor negativo.
 */
export function kellyFracionario(
  probabilidadeEstimada: number,
  odd: number,
  fracao = 0.25,
): number {
  if (!Number.isFinite(odd) || odd <= 1) return 0;
  if (!Number.isFinite(probabilidadeEstimada) || probabilidadeEstimada <= 0) return 0;
  const b = odd - 1;
  const kelly = (probabilidadeEstimada * b - (1 - probabilidadeEstimada)) / b;
  if (kelly <= 0) return 0;
  return kelly * fracao;
}
