// v3.112.0: avaliacao de modelo (Brier/log-loss/calibracao), Elo e ensemble.
//
// Estes testes cobrem a parte da spec (secao 10) que diz "sem isso o resto e
// decoracao". A ideia central: um modelo de probabilidade nunca erra de forma
// visivel — ele diz 54% e o jogo acontece. So metrica agregada distingue modelo
// util de gerador de numero bonito, e se a METRICA estiver errada perde-se ate
// essa distincao. Por isso ancoramos em casos onde o valor correto e' conhecido
// no papel.

import { describe, it, expect } from 'vitest';
import {
  brierScore, logLoss, calibracao, erroCalibracao, compararComMercado,
  kellyFracionario, type PrevisaoAvaliada,
} from '../services/sportsData/avaliacaoModelo';
import {
  pontuacaoEsperada, atualizarElo, eloParaProbabilidades1x2, RATING_INICIAL,
} from '../services/sportsData/elo';
import { combinarModelos, combinarPoissonElo } from '../services/sportsData/ensemble';

const perto = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

const prev = (c: number, e: number, v: number, obs: PrevisaoAvaliada['observado']): PrevisaoAvaliada =>
  ({ probCasa: c, probEmpate: e, probVisitante: v, observado: obs });

describe('Brier score', () => {
  it('1. previsao perfeita da Brier 0', () => {
    expect(brierScore([prev(1, 0, 0, 'casa')])).toBe(0);
  });

  it('2. previsao totalmente errada da Brier 2 (o maximo)', () => {
    expect(brierScore([prev(1, 0, 0, 'visitante')])).toBe(2);
  });

  it('3. chute uniforme da ~0.667', () => {
    const t = 1 / 3;
    expect(perto(brierScore([prev(t, t, t, 'casa')]), 2 / 3, 1e-9)).toBe(true);
  });

  it('4. pune confianca mal colocada mais que incerteza honesta', () => {
    const confianteErrado = brierScore([prev(0.95, 0.03, 0.02, 'visitante')]);
    const incertoErrado = brierScore([prev(0.40, 0.30, 0.30, 'visitante')]);
    expect(confianteErrado).toBeGreaterThan(incertoErrado);
  });

  it('5. lista vazia devolve NaN em vez de 0 (0 seria "perfeito")', () => {
    expect(Number.isNaN(brierScore([]))).toBe(true);
  });
});

describe('Log-loss', () => {
  it('6. acerto com certeza absoluta da ~0', () => {
    expect(logLoss([prev(1, 0, 0, 'casa')])).toBeLessThan(1e-9);
  });

  it('7. probabilidade 0 no resultado real nao vira Infinity (clamp)', () => {
    const l = logLoss([prev(0, 0, 1, 'casa')]);
    expect(Number.isFinite(l)).toBe(true);
    expect(l).toBeGreaterThan(10);
  });

  it('8. chute uniforme da ln(3)', () => {
    const t = 1 / 3;
    expect(perto(logLoss([prev(t, t, t, 'empate')]), Math.log(3), 1e-9)).toBe(true);
  });
});

describe('Calibracao', () => {
  it('9. modelo perfeitamente calibrado tem desvio ~0', () => {
    // 10 eventos a 50% no mandante: exatamente 5 vitorias em casa.
    const previsoes: PrevisaoAvaliada[] = [];
    for (let i = 0; i < 10; i++) {
      previsoes.push(prev(0.5, 0.0, 0.5, i < 5 ? 'casa' : 'visitante'));
    }
    const faixa = calibracao(previsoes).find(f => f.n > 0 && f.de === 0.5);
    expect(faixa).toBeDefined();
    expect(Math.abs(faixa!.desvio)).toBeLessThan(1e-9);
  });

  it('10. modelo otimista demais aparece com desvio POSITIVO', () => {
    // Diz 80% no mandante mas so acontece 30% das vezes.
    const previsoes: PrevisaoAvaliada[] = [];
    for (let i = 0; i < 10; i++) {
      previsoes.push(prev(0.8, 0.1, 0.1, i < 3 ? 'casa' : 'visitante'));
    }
    const faixa = calibracao(previsoes).find(f => f.de === 0.8);
    expect(faixa!.desvio).toBeGreaterThan(0.4);
  });

  it('11. erroCalibracao resume tudo num numero, 0 quando calibrado', () => {
    const previsoes: PrevisaoAvaliada[] = [];
    for (let i = 0; i < 10; i++) previsoes.push(prev(0.5, 0, 0.5, i < 5 ? 'casa' : 'visitante'));
    expect(erroCalibracao(previsoes)).toBeLessThan(1e-9);
  });

  it('12. as faixas cobrem todas as previsoes (3 por evento)', () => {
    const previsoes = [prev(0.5, 0.25, 0.25, 'casa'), prev(0.2, 0.3, 0.5, 'visitante')];
    const total = calibracao(previsoes).reduce((s, f) => s + f.n, 0);
    expect(total).toBe(6);
  });
});

describe('Modelo contra mercado — o teste que decide o projeto', () => {
  it('13. modelo melhor que o mercado e reconhecido', () => {
    const modelo = [prev(0.9, 0.05, 0.05, 'casa'), prev(0.05, 0.05, 0.9, 'visitante')];
    const mercado = [prev(0.5, 0.25, 0.25, 'casa'), prev(0.25, 0.25, 0.5, 'visitante')];
    const r = compararComMercado(modelo, mercado);
    expect(r.modeloBateuMercado).toBe(true);
    expect(r.vantagemBrier).toBeGreaterThan(0);
  });

  it('14. modelo pior que o mercado NAO passa (o caso comum na vida real)', () => {
    const modelo = [prev(0.5, 0.25, 0.25, 'casa'), prev(0.25, 0.25, 0.5, 'visitante')];
    const mercado = [prev(0.9, 0.05, 0.05, 'casa'), prev(0.05, 0.05, 0.9, 'visitante')];
    const r = compararComMercado(modelo, mercado);
    expect(r.modeloBateuMercado).toBe(false);
    expect(r.vantagemBrier).toBeLessThan(0);
  });

  it('15. exige vantagem nas DUAS metricas, nao so no Brier', () => {
    // Iguais nas duas: nao ha vantagem, entao nao "bateu".
    const iguais = [prev(0.5, 0.25, 0.25, 'casa')];
    expect(compararComMercado(iguais, iguais).modeloBateuMercado).toBe(false);
  });

  it('16. reporta o tamanho da amostra (20 jogos e ruido, nao evidencia)', () => {
    const p = [prev(0.5, 0.25, 0.25, 'casa')];
    expect(compararComMercado(p, p).amostra).toBe(1);
  });

  it('17. recusa listas de tamanhos diferentes em vez de comparar errado', () => {
    expect(() => compararComMercado(
      [prev(0.5, 0.25, 0.25, 'casa')],
      [prev(0.5, 0.25, 0.25, 'casa'), prev(0.4, 0.3, 0.3, 'empate')],
    )).toThrow();
  });
});

describe('Kelly fracionario', () => {
  it('18. sem vantagem, devolve 0 (nunca sugere valor negativo)', () => {
    expect(kellyFracionario(0.5, 1.9)).toBe(0);
    expect(kellyFracionario(0.3, 2.0)).toBe(0);
  });

  it('19. com vantagem, e proporcional e ja vem fracionado', () => {
    // p=0.6, odd=2.0 -> b=1, kelly pleno = (0.6*1 - 0.4)/1 = 0.2
    expect(perto(kellyFracionario(0.6, 2.0, 1), 0.2, 1e-9)).toBe(true);
    expect(perto(kellyFracionario(0.6, 2.0, 0.25), 0.05, 1e-9)).toBe(true);
  });

  it('20. odd invalida devolve 0', () => {
    expect(kellyFracionario(0.9, 1)).toBe(0);
    expect(kellyFracionario(0.9, NaN)).toBe(0);
  });
});

describe('Elo', () => {
  it('21. ratings iguais sem vantagem de casa dao pontuacao esperada 0.5', () => {
    const e = pontuacaoEsperada({ ratingCasa: 1500, ratingVisitante: 1500, vantagemCasa: 0 });
    expect(perto(e, 0.5, 1e-12)).toBe(true);
  });

  it('22. 400 pontos de vantagem dao 10:1 (definicao da escala Elo)', () => {
    const e = pontuacaoEsperada({ ratingCasa: 1900, ratingVisitante: 1500, vantagemCasa: 0 });
    expect(perto(e, 10 / 11, 1e-12)).toBe(true);
  });

  it('23. vantagem de casa aumenta a pontuacao esperada do mandante', () => {
    const sem = pontuacaoEsperada({ ratingCasa: 1500, ratingVisitante: 1500, vantagemCasa: 0 });
    const com = pontuacaoEsperada({ ratingCasa: 1500, ratingVisitante: 1500, vantagemCasa: 100 });
    expect(com).toBeGreaterThan(sem);
  });

  it('24. vitoria inesperada move mais o rating que vitoria esperada', () => {
    const zebra = atualizarElo({ ratingCasa: 1300, ratingVisitante: 1700, vantagemCasa: 0 }, 1);
    const favorito = atualizarElo({ ratingCasa: 1700, ratingVisitante: 1300, vantagemCasa: 0 }, 1);
    expect(zebra.ratingCasa - 1300).toBeGreaterThan(favorito.ratingCasa - 1700);
  });

  it('25. atualizacao e soma zero (o que um ganha o outro perde)', () => {
    const antes = { ratingCasa: 1520, ratingVisitante: 1480, vantagemCasa: 70 };
    const d = atualizarElo(antes, 1);
    const somaAntes = antes.ratingCasa + antes.ratingVisitante;
    const somaDepois = d.ratingCasa + d.ratingVisitante;
    expect(perto(somaAntes, somaDepois, 1e-9)).toBe(true);
  });

  it('26. empate contra favorito faz o azarao SUBIR', () => {
    const d = atualizarElo({ ratingCasa: 1300, ratingVisitante: 1700, vantagemCasa: 0 }, 0.5);
    expect(d.ratingCasa).toBeGreaterThan(1300);
  });

  it('27. probabilidades 1x2 do Elo somam 1', () => {
    for (const rc of [1200, 1500, 1900]) {
      const p = eloParaProbabilidades1x2({ ratingCasa: rc, ratingVisitante: 1500 });
      expect(perto(p.probCasa + p.probEmpate + p.probVisitante, 1, 1e-9)).toBe(true);
    }
  });

  it('28. preserva a identidade do Elo: E = pCasa + pEmpate/2', () => {
    const r = { ratingCasa: 1620, ratingVisitante: 1450, vantagemCasa: 70 };
    const p = eloParaProbabilidades1x2(r);
    expect(perto(p.probCasa + p.probEmpate / 2, pontuacaoEsperada(r), 1e-9)).toBe(true);
  });

  it('29. jogo equilibrado empata mais que goleada anunciada', () => {
    const equilibrado = eloParaProbabilidades1x2({ ratingCasa: 1500, ratingVisitante: 1500, vantagemCasa: 0 });
    const desigual = eloParaProbabilidades1x2({ ratingCasa: 2100, ratingVisitante: 1300, vantagemCasa: 0 });
    expect(equilibrado.probEmpate).toBeGreaterThan(desigual.probEmpate);
  });

  it('30. nenhuma probabilidade negativa mesmo em disparidade extrema', () => {
    const p = eloParaProbabilidades1x2({ ratingCasa: 2600, ratingVisitante: 1000, vantagemCasa: 200 });
    expect(p.probCasa).toBeGreaterThanOrEqual(0);
    expect(p.probEmpate).toBeGreaterThanOrEqual(0);
    expect(p.probVisitante).toBeGreaterThanOrEqual(0);
  });

  it('31. RATING_INICIAL e o 1500 convencional', () => {
    expect(RATING_INICIAL).toBe(1500);
  });
});

describe('Ensemble', () => {
  const A = { probCasa: 0.6, probEmpate: 0.2, probVisitante: 0.2 };
  const B = { probCasa: 0.4, probEmpate: 0.3, probVisitante: 0.3 };
  const Z = { probCasa: 0, probEmpate: 0, probVisitante: 0 };

  it('32. saida sempre soma 1', () => {
    const r = combinarModelos(A, B, Z, { poisson: 0.5, elo: 0.5, ml: 0 });
    expect(perto(r.probCasa + r.probEmpate + r.probVisitante, 1, 1e-9)).toBe(true);
  });

  it('33. peso total num modelo devolve o proprio modelo', () => {
    const r = combinarModelos(A, B, Z, { poisson: 1, elo: 0, ml: 0 });
    expect(perto(r.probCasa, A.probCasa, 1e-9)).toBe(true);
  });

  it('34. pesos iguais dao a media dos dois', () => {
    const r = combinarModelos(A, B, Z, { poisson: 0.5, elo: 0.5, ml: 0 });
    expect(perto(r.probCasa, 0.5, 1e-9)).toBe(true);
  });

  it('35. pesos que nao somam 1 sao normalizados (erro de digitacao nao vaza)', () => {
    const errado = combinarModelos(A, B, Z, { poisson: 5, elo: 5, ml: 0 });
    const certo = combinarModelos(A, B, Z, { poisson: 0.5, elo: 0.5, ml: 0 });
    expect(perto(errado.probCasa, certo.probCasa, 1e-9)).toBe(true);
  });

  it('36. modelo de entrada fora de escala nao desloca a media', () => {
    const foraDeEscala = { probCasa: 1.2, probEmpate: 0.4, probVisitante: 0.4 }; // soma 2
    const r = combinarModelos(foraDeEscala, foraDeEscala, Z, { poisson: 1, elo: 1, ml: 0 });
    expect(perto(r.probCasa, 0.6, 1e-9)).toBe(true);
  });

  it('37. pesos zerados falham alto em vez de devolver lixo', () => {
    expect(() => combinarModelos(A, B, Z, { poisson: 0, elo: 0, ml: 0 })).toThrow();
  });

  it('38. combinarPoissonElo respeita o peso informado', () => {
    const r = combinarPoissonElo(A, B, 1);
    expect(perto(r.probCasa, A.probCasa, 1e-9)).toBe(true);
  });
});
