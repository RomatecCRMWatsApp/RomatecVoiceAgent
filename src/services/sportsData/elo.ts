// v3.112.0 — Rating Elo dinamico (item 2 do ensemble, secao 10 da spec).
//
// Complementa o Poisson/Dixon-Coles do probabilityEngine, e os dois erram de
// formas diferentes — que e' exatamente o motivo de combinar os dois num ensemble:
//
//   Poisson  parte de MEDIAS DE GOLS. Bom pra placar exato e over/under, mas
//            confunde "ganhou de 4 a 0 de um time reserva" com forca real.
//   Elo      parte de RESULTADOS e da forca do adversario. Nao sabe estimar
//            quantidade de gols, mas capta bem quem vem batendo quem.
//
// Elo nao tem empate embutido (nasceu no xadrez, onde empate e' meio ponto).
// A conversao pra 1x2 aqui usa um modelo explicito de empate — ver
// eloParaProbabilidades1x2, que documenta a simplificacao.

export interface RatingsPartida {
  ratingCasa: number;
  ratingVisitante: number;
  /** Bonus de pontos de rating pro mandante. Tipico 50-100 no futebol. */
  vantagemCasa?: number;
}

/**
 * Pontuacao esperada do mandante (0 a 1), no sentido do xadrez: vitoria = 1,
 * empate = 0.5, derrota = 0. NAO e' probabilidade de vitoria — inclui metade
 * da probabilidade de empate.
 *
 * E = 1 / (1 + 10^((Rb - Ra - vantagem) / 400))
 */
export function pontuacaoEsperada(p: RatingsPartida): number {
  const vantagem = p.vantagemCasa ?? 70;
  const delta = p.ratingVisitante - p.ratingCasa - vantagem;
  return 1 / (1 + Math.pow(10, delta / 400));
}

/** Resultado de uma partida na escala do Elo. */
export type PontuacaoReal = 0 | 0.5 | 1;

/**
 * Atualiza os ratings depois do jogo.
 * K controla a velocidade de adaptacao: alto reage rapido e oscila demais, baixo
 * e' estavel e lento. 20-30 e' a faixa usual em futebol de clubes.
 */
export function atualizarElo(
  p: RatingsPartida, pontuacaoCasa: PontuacaoReal, k = 24,
): { ratingCasa: number; ratingVisitante: number } {
  const esperado = pontuacaoEsperada(p);
  const ajuste = k * (pontuacaoCasa - esperado);
  return {
    // Jogo de soma zero: o que um ganha, o outro perde.
    ratingCasa: p.ratingCasa + ajuste,
    ratingVisitante: p.ratingVisitante - ajuste,
  };
}

export interface OpcoesEmpate {
  /**
   * Probabilidade de empate quando os times sao equivalentes. ~0.27 no futebol
   * brasileiro; menor em ligas mais desiguais.
   */
  empateBase?: number;
  /**
   * Quao rapido o empate perde forca conforme cresce a diferenca de rating.
   * Maior = empate cai mais devagar.
   */
  escalaEmpate?: number;
}

/**
 * Converte Elo em probabilidades 1x2.
 *
 * SIMPLIFICACAO ASSUMIDA: o Elo classico so produz pontuacao esperada, sem
 * separar empate. Modelamos o empate decaindo com a diferenca de rating
 * (jogo equilibrado empata mais; goleada anunciada empata menos):
 *
 *   pEmpate = empateBase * exp(-(delta / escala)^2)
 *
 * e distribuimos o resto preservando a pontuacao esperada:
 *
 *   pCasa = E - pEmpate/2      pVisitante = 1 - pCasa - pEmpate
 *
 * A identidade E = pCasa + pEmpate/2 e' o que mantem o Elo coerente com ele
 * mesmo — o teste 8 tranca isso.
 */
export function eloParaProbabilidades1x2(
  p: RatingsPartida, opts: OpcoesEmpate = {},
): { probCasa: number; probEmpate: number; probVisitante: number } {
  const base = opts.empateBase ?? 0.27;
  const escala = opts.escalaEmpate ?? 300;
  const vantagem = p.vantagemCasa ?? 70;
  const delta = p.ratingCasa + vantagem - p.ratingVisitante;

  const esperado = pontuacaoEsperada(p);
  let pEmpate = base * Math.exp(-((delta / escala) ** 2));

  // Nao pode sobrar probabilidade negativa em nenhum lado quando E e' extremo.
  const tetoEmpate = 2 * Math.min(esperado, 1 - esperado);
  pEmpate = Math.max(0, Math.min(pEmpate, tetoEmpate));

  const probCasa = esperado - pEmpate / 2;
  const probVisitante = 1 - probCasa - pEmpate;
  return {
    probCasa: Math.max(0, probCasa),
    probEmpate: pEmpate,
    probVisitante: Math.max(0, probVisitante),
  };
}

export const RATING_INICIAL = 1500;
