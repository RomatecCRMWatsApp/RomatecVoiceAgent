// v3.129.0 — Testes do cálculo de divisão de capital (Dutching / Arbitragem).
// Cobre os 8 casos obrigatórios do item 7 da spec.
import { describe, it, expect } from 'vitest';
import {
  calcularDivisao,
  calcularPorLucro,
  ArbitragemError,
  type ResultadoEntrada,
} from './arbitragemService';

const JOGO_MARGEM: ResultadoEntrada[] = [
  { rotulo: "Casa - Newell's", odd: 2.6, casa: 'bet365' },
  { rotulo: 'Empate', odd: 2.9, casa: 'bet365' },
  { rotulo: 'Fora - Talleres', odd: 3.1, casa: 'bet365' },
];

describe('arbitragemService — calcularDivisao', () => {
  // Caso 1 — margem da casa (S > 1), sem arbitragem.
  it('1) odds 2,60/2,90/3,10 capital 100 → margem ~5,20%, stakes 36,56/32,78/30,66', () => {
    const r = calcularDivisao({ evento: 'Newell x Talleres', capital: 100, resultados: JOGO_MARGEM });
    expect(r.somaImplicita).toBeCloseTo(1.052024, 5);
    expect(r.margemPercentual).toBeCloseTo(5.2, 2);
    expect(r.arbitragem).toBe(false);
    expect(r.alocacoes.map((a) => a.stake)).toEqual([36.56, 32.78, 30.66]);
    for (const a of r.alocacoes) expect(a.retornoBruto).toBeCloseTo(95.06, 1);
    expect(r.lucroMinimo).toBeCloseTo(-4.95, 1);
    expect(r.aviso).toContain('Prejuízo garantido');
  });

  // Caso 3 — arbitragem real (S < 1), lucro positivo e igual.
  it('3) odds 2,10/3,60/4,20 → arbitragem, lucro positivo e igual nos três', () => {
    const r = calcularDivisao({
      capital: 100,
      resultados: [
        { rotulo: 'Casa', odd: 2.1, casa: 'casaA' },
        { rotulo: 'Empate', odd: 3.6, casa: 'casaB' },
        { rotulo: 'Fora', odd: 4.2, casa: 'casaC' },
      ],
    });
    expect(r.somaImplicita).toBeLessThan(1);
    expect(r.arbitragem).toBe(true);
    for (const a of r.alocacoes) expect(a.lucroLiquido).toBeGreaterThan(0);
    const lucros = r.alocacoes.map((a) => a.lucroLiquido);
    for (const l of lucros) expect(l).toBeCloseTo(lucros[0], 1);
    expect(r.aviso).toContain('Arbitragem real');
  });

  // Caso 4 — Σ stakes === capital EXATO (em várias combinações).
  it('4) soma dos stakes bate exatamente com o capital (centavo)', () => {
    const casos = [
      { capital: 100, resultados: JOGO_MARGEM },
      { capital: 250.55, resultados: JOGO_MARGEM },
      {
        capital: 1000,
        resultados: [
          { rotulo: 'A', odd: 1.85 },
          { rotulo: 'B', odd: 3.4 },
          { rotulo: 'C', odd: 5.5 },
          { rotulo: 'D', odd: 9.0 },
        ],
      },
    ];
    for (const c of casos) {
      const r = calcularDivisao(c);
      const soma = r.alocacoes.reduce((acc, a) => acc + a.stake, 0);
      expect(Math.round(soma * 100)).toBe(Math.round(c.capital * 100));
    }
  });

  // Caso 5 — odds inválidas / fora de faixa.
  it('5) odd 1.00 / 0 / negativa → ODD_FORA_DE_FAIXA; "abc" → ODD_INVALIDA', () => {
    const base = { rotulo: 'Empate', odd: 2.9 };
    const tenta = (odd: number | string) =>
      calcularDivisao({ capital: 100, resultados: [{ rotulo: 'Casa', odd }, base] });

    for (const odd of [1.0, 0, -2.5]) {
      expect(() => tenta(odd)).toThrow(ArbitragemError);
      try {
        tenta(odd);
      } catch (e) {
        expect((e as ArbitragemError).codigo).toBe('ODD_FORA_DE_FAIXA');
      }
    }
    try {
      tenta('abc');
    } catch (e) {
      expect((e as ArbitragemError).codigo).toBe('ODD_INVALIDA');
    }
  });

  // Caso 6 — um único resultado.
  it('6) um único resultado → RESULTADOS_INSUFICIENTES', () => {
    try {
      calcularDivisao({ capital: 100, resultados: [{ rotulo: 'Casa', odd: 2.0 }] });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ArbitragemError);
      expect((e as ArbitragemError).codigo).toBe('RESULTADOS_INSUFICIENTES');
    }
  });

  // Caso 7 — rótulos duplicados.
  it('7) dois rótulos iguais → ROTULO_DUPLICADO', () => {
    try {
      calcularDivisao({
        capital: 100,
        resultados: [
          { rotulo: 'Casa', odd: 2.0 },
          { rotulo: 'casa', odd: 3.0 },
        ],
      });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ArbitragemError);
      expect((e as ArbitragemError).codigo).toBe('ROTULO_DUPLICADO');
    }
  });
});

describe('arbitragemService — calcularPorLucro', () => {
  // Caso 2 — lucro alvo com S ≥ 1 → SEM_ARBITRAGEM + odds mínimas 3,01/3,42/3,70.
  it('2) mesmas odds, lucroAlvo 100 → SEM_ARBITRAGEM com odds mínimas 3,01/3,42/3,70', () => {
    try {
      calcularPorLucro({ lucroAlvo: 100, resultados: JOGO_MARGEM });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ArbitragemError);
      const err = e as ArbitragemError;
      expect(err.codigo).toBe('SEM_ARBITRAGEM');
      const odds = err.extra?.oddsMinimasParaArbitragem as number[];
      expect(odds).toEqual([3.01, 3.42, 3.7]);
    }
  });

  // Sanidade — por-lucro COM arbitragem devolve capital coerente.
  it('por-lucro com S < 1 devolve divisão com lucro ≈ alvo', () => {
    const r = calcularPorLucro({
      lucroAlvo: 50,
      resultados: [
        { rotulo: 'Casa', odd: 2.1 },
        { rotulo: 'Empate', odd: 3.6 },
        { rotulo: 'Fora', odd: 4.2 },
      ],
    });
    expect(r.arbitragem).toBe(true);
    expect(r.lucroMinimo).toBeCloseTo(50, 0);
  });
});
