// v3.111.0: motor Poisson/Dixon-Coles (fase 2 da spec de estatisticas esportivas).
//
// Por que testar isto com cuidado: o motor produz numeros que PARECEM certos em
// qualquer caso. Um lambda trocado de lado, um sinal invertido no rho ou uma
// normalizacao esquecida gera probabilidades plausiveis e completamente erradas,
// e ninguem percebe olhando a saida. Os testes abaixo ancoram em valores
// conhecidos da literatura e em invariantes que precisam valer sempre.

import { describe, it, expect } from 'vitest';
import {
  poissonPmf, tauDixonColes, matrizPlacares, probabilidades1x2DaMatriz,
  probabilidadeOverUnder, probabilidadeAmbasMarcam, calcularProbabilidadePartida,
  calcularProbabilidadePoisson, calcularForcaTime, probabilidadesImplicitas,
  valorEsperado, avaliarMercado, DISCLAIMER_OBRIGATORIO,
} from '../services/sportsData/probabilityEngine';

const perto = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;

describe('Poisson — base', () => {
  it('1. P(0; 1) = e^-1', () => {
    expect(perto(poissonPmf(0, 1), Math.exp(-1))).toBe(true);
  });

  it('2. P(2; 2) = 2*e^-2', () => {
    expect(perto(poissonPmf(2, 2), 2 * Math.exp(-2))).toBe(true);
  });

  it('3. soma de P(k) sobre k converge pra 1', () => {
    let s = 0;
    for (let k = 0; k <= 40; k++) s += poissonPmf(k, 2.5);
    expect(perto(s, 1, 1e-9)).toBe(true);
  });

  it('4. nao estoura com k alto (calculo em log, nao fatorial direto)', () => {
    const p = poissonPmf(60, 2);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
  });
});

describe('Dixon-Coles — correcao de placar baixo', () => {
  it('5. rho = 0 devolve tau 1 em todos os placares (desliga a correcao)', () => {
    for (const [c, v] of [[0, 0], [0, 1], [1, 0], [1, 1], [3, 2]]) {
      expect(tauDixonColes(c, v, 1.4, 1.1, 0)).toBe(1);
    }
  });

  it('6. rho negativo empurra probabilidade pra 0-0 e 1-1, e tira de 0-1 e 1-0', () => {
    const rho = -0.1;
    expect(tauDixonColes(0, 0, 1.4, 1.1, rho)).toBeGreaterThan(1);
    expect(tauDixonColes(1, 1, 1.4, 1.1, rho)).toBeGreaterThan(1);
    expect(tauDixonColes(0, 1, 1.4, 1.1, rho)).toBeLessThan(1);
    expect(tauDixonColes(1, 0, 1.4, 1.1, rho)).toBeLessThan(1);
  });

  it('7. placar alto nao e tocado pela correcao', () => {
    expect(tauDixonColes(4, 2, 1.4, 1.1, -0.1)).toBe(1);
  });

  it('8. rho negativo aumenta a probabilidade de empate no agregado', () => {
    const semCorrecao = probabilidades1x2DaMatriz(matrizPlacares(1.3, 1.1, { rho: 0 }));
    const comCorrecao = probabilidades1x2DaMatriz(matrizPlacares(1.3, 1.1, { rho: -0.1 }));
    expect(comCorrecao.probEmpate).toBeGreaterThan(semCorrecao.probEmpate);
  });
});

describe('Matriz e mercados', () => {
  it('9. matriz soma 1 (renormalizada apos truncar a cauda)', () => {
    const m = matrizPlacares(1.6, 1.2);
    const soma = m.flat().reduce((s, p) => s + p, 0);
    expect(perto(soma, 1, 1e-9)).toBe(true);
  });

  it('10. 1x2 soma 1', () => {
    const p = probabilidades1x2DaMatriz(matrizPlacares(1.6, 1.2));
    expect(perto(p.probCasa + p.probEmpate + p.probVisitante, 1, 1e-9)).toBe(true);
  });

  it('11. nenhuma probabilidade negativa, mesmo com rho extremo', () => {
    const m = matrizPlacares(0.4, 0.3, { rho: -0.9 });
    expect(m.flat().every((p) => p >= 0)).toBe(true);
  });

  it('12. over + under = 1 em linha fracionaria', () => {
    const { over, under } = probabilidadeOverUnder(matrizPlacares(1.5, 1.3), 2.5);
    expect(perto(over + under, 1, 1e-9)).toBe(true);
  });

  it('13. linha mais alta => menos over (monotonico)', () => {
    const m = matrizPlacares(1.5, 1.3);
    expect(probabilidadeOverUnder(m, 3.5).over).toBeLessThan(probabilidadeOverUnder(m, 2.5).over);
  });

  it('14. jogo de gols altos tem mais over 2.5 que jogo travado', () => {
    const alto = probabilidadeOverUnder(matrizPlacares(2.4, 2.1), 2.5).over;
    const travado = probabilidadeOverUnder(matrizPlacares(0.8, 0.7), 2.5).over;
    expect(alto).toBeGreaterThan(travado);
  });

  it('15. ambas marcam: sim + nao = 1', () => {
    const { sim, nao } = probabilidadeAmbasMarcam(matrizPlacares(1.4, 1.2));
    expect(perto(sim + nao, 1, 1e-9)).toBe(true);
  });
});

describe('Partida — forcas e mando', () => {
  it('16. times identicos SEM mando => casa e visitante praticamente iguais', () => {
    const r = calcularProbabilidadePartida({
      casa: { ataque: 1, defesa: 1 }, visitante: { ataque: 1, defesa: 1 },
      mediaGolsLiga: 1.35, fatorMando: 1.0,
    });
    expect(Math.abs(r.probCasa - r.probVisitante)).toBeLessThan(1e-9);
  });

  it('17. mando de campo aumenta a chance da casa', () => {
    const base = { casa: { ataque: 1, defesa: 1 }, visitante: { ataque: 1, defesa: 1 }, mediaGolsLiga: 1.35 };
    const sem = calcularProbabilidadePartida({ ...base, fatorMando: 1.0 });
    const com = calcularProbabilidadePartida({ ...base, fatorMando: 1.3 });
    expect(com.probCasa).toBeGreaterThan(sem.probCasa);
    expect(com.probVisitante).toBeLessThan(sem.probVisitante);
  });

  it('18. ataque melhor aumenta o proprio lambda; defesa MENOR e melhor', () => {
    const r = calcularProbabilidadePartida({
      casa: { ataque: 1.4, defesa: 0.8 }, visitante: { ataque: 0.9, defesa: 1.2 },
      mediaGolsLiga: 1.35, fatorMando: 1.0,
    });
    // casa ataca bem (1.4) contra defesa ruim (1.2) => lambda alto
    expect(r.lambdaCasa).toBeGreaterThan(r.lambdaVisitante);
    expect(r.probCasa).toBeGreaterThan(r.probVisitante);
  });

  it('19. lambda segue a formula da spec (ataque * defesa adversaria * media)', () => {
    const r = calcularProbabilidadePartida({
      casa: { ataque: 1.2, defesa: 0.9 }, visitante: { ataque: 1.1, defesa: 0.95 },
      mediaGolsLiga: 1.5, fatorMando: 1.0,
    });
    expect(perto(r.lambdaCasa, 1.2 * 0.95 * 1.5)).toBe(true);
    expect(perto(r.lambdaVisitante, 1.1 * 0.9 * 1.5)).toBe(true);
  });

  it('20. a assinatura da spec nao inverte os argumentos', () => {
    const viaSpec = calcularProbabilidadePoisson(1.3, 1.1, 0.9, 0.95, 1.4);
    const viaObjeto = calcularProbabilidadePartida({
      casa: { ataque: 1.3, defesa: 0.95 }, visitante: { ataque: 0.9, defesa: 1.1 },
      mediaGolsLiga: 1.4, fatorMando: 1.0,
    });
    expect(perto(viaSpec.probCasa, viaObjeto.probCasa)).toBe(true);
    expect(perto(viaSpec.probVisitante, viaObjeto.probVisitante)).toBe(true);
  });
});

describe('Forca a partir do historico', () => {
  it('21. time na media da liga tem ataque e defesa ~1', () => {
    const jogos = Array.from({ length: 10 }, (_, i) => ({ golsMarcados: 1.35, golsSofridos: 1.35, jogosAtras: i }));
    const f = calcularForcaTime(jogos, 1.35);
    expect(perto(f.ataque, 1, 1e-9)).toBe(true);
    expect(perto(f.defesa, 1, 1e-9)).toBe(true);
  });

  it('22. decaimento faz o jogo recente pesar mais que o antigo', () => {
    // Marcou muito ha 10 jogos, pouco agora: com decaimento o ataque cai.
    const jogos = [
      { golsMarcados: 0, golsSofridos: 1, jogosAtras: 0 },
      { golsMarcados: 4, golsSofridos: 1, jogosAtras: 10 },
    ];
    const semDecaimento = calcularForcaTime(jogos, 1.35, 0);
    const comDecaimento = calcularForcaTime(jogos, 1.35, 0.2);
    expect(comDecaimento.ataque).toBeLessThan(semDecaimento.ataque);
  });

  it('23. historico vazio devolve forca neutra em vez de NaN', () => {
    const f = calcularForcaTime([], 1.35);
    expect(f).toEqual({ ataque: 1, defesa: 1 });
  });
});

describe('Mercado — margem e valor esperado', () => {
  it('24. odds justas 2.0/2.0 viram 50/50 e overround ~0', () => {
    const { probabilidades, overround } = probabilidadesImplicitas([2.0, 2.0]);
    expect(perto(probabilidades[0], 0.5)).toBe(true);
    expect(perto(overround, 0, 1e-9)).toBe(true);
  });

  it('25. detecta a margem da casa e normaliza pra somar 1', () => {
    // 1/1.9 + 1/1.9 = 1.0526 -> 5.26% de margem
    const { probabilidades, overround } = probabilidadesImplicitas([1.9, 1.9]);
    expect(overround).toBeGreaterThan(0.05);
    expect(perto(probabilidades.reduce((s, p) => s + p, 0), 1, 1e-9)).toBe(true);
  });

  it('26. mercado 1x2 real soma 1 depois de remover a margem', () => {
    const { probabilidades } = probabilidadesImplicitas([2.10, 3.40, 3.60]);
    expect(perto(probabilidades.reduce((s, p) => s + p, 0), 1, 1e-9)).toBe(true);
  });

  it('27. EV do exemplo da spec: 54% a odd 2.10 => +0.134', () => {
    expect(perto(valorEsperado(0.54, 2.10), 0.134, 1e-9)).toBe(true);
  });

  it('28. EV negativo quando o modelo concorda com o mercado (a margem come)', () => {
    // odd 1.90 embute ~52.6% cru; modelo diz 50% => EV negativo
    expect(valorEsperado(0.50, 1.90)).toBeLessThan(0);
  });

  it('29. odd invalida nao vira EV positivo por acidente', () => {
    expect(valorEsperado(0.9, 1)).toBe(-1);
    expect(valorEsperado(0.9, NaN)).toBe(-1);
  });

  it('30. avaliarMercado ordena por valor esperado decrescente', () => {
    const r = avaliarMercado(
      ['casa', 'empate', 'visitante'],
      [0.54, 0.24, 0.22],
      [2.10, 3.40, 3.60],
    );
    expect(r[0].selecao).toBe('casa');
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].valorEsperado).toBeGreaterThanOrEqual(r[i].valorEsperado);
    }
  });

  it('31. o disclaimer da secao 7 existe e cita o risco financeiro', () => {
    expect(DISCLAIMER_OBRIGATORIO).toMatch(/estimativas estatísticas/i);
    expect(DISCLAIMER_OBRIGATORIO).toMatch(/não constituem garantia/i);
    expect(DISCLAIMER_OBRIGATORIO).toMatch(/risco de perda financeira/i);
  });
});
