// v3.112.0 — Combinacao de modelos (secao 10 da spec).
//
// Media ponderada de probabilidades. Simples de proposito: a spec pede "media
// ponderada simples pra comecar, pesos recalibrados via backtest".
//
// POR QUE COMBINAR AJUDA: Poisson e Elo erram de formas diferentes — um le gols,
// o outro le resultados contra a forca do adversario. Erros pouco correlacionados
// tendem a se cancelar parcialmente na media, e o ensemble costuma ficar melhor
// que qualquer um dos dois isolado.
//
// POR QUE ISSO NAO E' MAGICA: se os dois modelos erram na MESMA direcao (ambos
// alimentados pelas mesmas medias de gols enviesadas, por exemplo), a media
// preserva o vies inteiro e ainda o faz parecer mais confiavel, porque some a
// discordancia entre eles. Combinar so vale depois de medir cada modelo
// separadamente com avaliacaoModelo.ts — senao e' media de dois erros.

import type { Probabilidades1x2 } from './probabilityEngine';

export type ResultadoProbabilidade = Probabilidades1x2;

export interface PesosEnsemble {
  poisson: number;
  elo: number;
  ml: number;
}

/** Normaliza pra somar exatamente 1, preservando as proporcoes. */
function normalizar(p: ResultadoProbabilidade): ResultadoProbabilidade {
  const soma = p.probCasa + p.probEmpate + p.probVisitante;
  if (!(soma > 0)) return { probCasa: 1 / 3, probEmpate: 1 / 3, probVisitante: 1 / 3 };
  return {
    probCasa: p.probCasa / soma,
    probEmpate: p.probEmpate / soma,
    probVisitante: p.probVisitante / soma,
  };
}

/**
 * Assinatura da spec. Combina os tres modelos por media ponderada.
 *
 * Pesos nao precisam somar 1 na entrada — sao normalizados aqui, senao um erro
 * de digitacao nos pesos (0.5/0.3/0.3) sairia como probabilidade somando 1.1 e
 * contaminaria o valor esperado la na frente sem sintoma visivel.
 *
 * Passar peso 0 desliga um modelo — util enquanto o ML da fase v2 nao existe.
 */
export function combinarModelos(
  probPoisson: ResultadoProbabilidade,
  probElo: ResultadoProbabilidade,
  probML: ResultadoProbabilidade,
  pesos: PesosEnsemble,
): ResultadoProbabilidade {
  const somaPesos = pesos.poisson + pesos.elo + pesos.ml;
  if (!(somaPesos > 0)) {
    throw new Error('pesos do ensemble somam zero ou sao invalidos');
  }
  const w = {
    poisson: pesos.poisson / somaPesos,
    elo: pesos.elo / somaPesos,
    ml: pesos.ml / somaPesos,
  };
  // Cada modelo entra normalizado: um deles vir levemente fora de 1 (arredondamento
  // do truncamento da matriz de placares, por exemplo) nao pode deslocar a media.
  const a = normalizar(probPoisson);
  const b = normalizar(probElo);
  const c = normalizar(probML);
  return normalizar({
    probCasa: a.probCasa * w.poisson + b.probCasa * w.elo + c.probCasa * w.ml,
    probEmpate: a.probEmpate * w.poisson + b.probEmpate * w.elo + c.probEmpate * w.ml,
    probVisitante: a.probVisitante * w.poisson + b.probVisitante * w.elo + c.probVisitante * w.ml,
  });
}

/** Ensemble so com os dois modelos que existem hoje (ML ainda nao implementado). */
export function combinarPoissonElo(
  probPoisson: ResultadoProbabilidade,
  probElo: ResultadoProbabilidade,
  pesoPoisson = 0.6,
): ResultadoProbabilidade {
  return combinarModelos(
    probPoisson, probElo,
    { probCasa: 0, probEmpate: 0, probVisitante: 0 },
    { poisson: pesoPoisson, elo: 1 - pesoPoisson, ml: 0 },
  );
}
