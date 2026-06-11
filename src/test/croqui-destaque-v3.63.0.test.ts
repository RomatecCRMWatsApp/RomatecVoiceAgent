// v3.63.0 — Croqui na Proposta de Demarcação (Fase 1a).
// Testa o MOTOR compartilhado reutilizado da proposta:
//   - geometria.ts: calcularLados / areaGauss / perimetro (casos §9.1 e §9.2)
//   - croquiSvg.ts: gerarCroquiSvg com destaque dourado (§9.4) + regressão (§9.8)
// Tudo puro (sem DOM, sem DB) — roda no Vitest sem harness.

import { describe, it, expect } from 'vitest';
import { calcularLados, areaGauss, perimetro } from '../services/geometria';
import { gerarCroquiSvg, type PontoSvg } from '../services/croquiSvg';
import { tarifaAlinhamento } from '../services/propostaCroqui';

// Retângulo 9 × 22 m (cantos), ordem anti-horária fechando no 1º.
const RET = [
  { e: 0, n: 0 },
  { e: 9, n: 0 },
  { e: 9, n: 22 },
  { e: 0, n: 22 },
];

const RET_PONTOS: PontoSvg[] = [
  { rotulo: 'M-ZAZU-01', e: 0, n: 0 },
  { rotulo: 'M-ZAZU-02', e: 9, n: 0 },
  { rotulo: 'M-ZAZU-03', e: 9, n: 22 },
  { rotulo: 'M-ZAZU-04', e: 0, n: 22 },
];

describe('geometria — lados / área / perímetro (§9.1, §9.2)', () => {
  it('calcularLados: 4 lados com distâncias 9/22/9/22 fechando no ponto 1', () => {
    const lados = calcularLados(RET);
    expect(lados).toHaveLength(4);
    expect(lados.map(l => Math.round(l.distancia_m))).toEqual([9, 22, 9, 22]);
    // último lado fecha no ponto inicial
    expect(lados[3].f_idx).toBe(0);
  });

  it('areaGauss: retângulo 9×22 → 198,00 m²', () => {
    expect(areaGauss(RET)).toBeCloseTo(198, 6);
  });

  it('perimetro: retângulo 9×22 → 62,00 m', () => {
    expect(perimetro(RET)).toBeCloseTo(62, 6);
  });

  it('polígono irregular (5 vértices, UTM ~Açailândia 23S) → shoelace coerente', () => {
    // Vértices fictícios coerentes (zona 23S). Área de referência pelo shoelace manual.
    const poly = [
      { e: 211400, n: 9456100 },
      { e: 211450, n: 9456090 },
      { e: 211470, n: 9456140 },
      { e: 211430, n: 9456170 },
      { e: 211390, n: 9456150 },
    ];
    // shoelace manual
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      s += a.e * b.n - b.e * a.n;
    }
    const ref = Math.abs(s) / 2;
    expect(areaGauss(poly)).toBeCloseTo(ref, 2);
  });
});

describe('gerarCroquiSvg — SEM destaque (regressão §9.8 — laudo intacto)', () => {
  const lados = calcularLados(RET);
  const svg = gerarCroquiSvg(RET_PONTOS, lados, { mostrarNorte: true });

  it('contém todos os rótulos de vértice', () => {
    for (const p of RET_PONTOS) expect(svg).toContain(p.rotulo);
  });

  it('contém as cotas dos lados (9.00m e 22.00m)', () => {
    expect(svg).toContain('9.00m');
    expect(svg).toContain('22.00m');
  });

  it('poligonal base em verde Romatec (#10b981), sem cinza de destaque', () => {
    expect(svg).toContain('stroke="#10b981"');
    expect(svg).not.toContain('#6e7681');
  });

  it('NÃO tem nada de destaque (dourado, ALINHAR, legenda)', () => {
    expect(svg).not.toContain('#C9A84C');
    expect(svg).not.toContain('(ALINHAR)');
    expect(svg).not.toContain('Cerca a ser alinhada');
  });
});

describe('gerarCroquiSvg — COM destaque (§9.4 — croqui de alinhamento)', () => {
  const lados = calcularLados(RET);
  const svg = gerarCroquiSvg(RET_PONTOS, lados, {
    destacarLados: [2], // lado 2 = 22m (M-02→M-03)
    tituloDestaque: 'CERCA A SER ALINHADA',
  });

  it('lado destacado em dourado tracejado', () => {
    expect(svg).toContain('stroke="#C9A84C"');
    expect(svg).toContain('stroke-dasharray="8 4"');
  });

  it('cota do lado destacado com sufixo (ALINHAR)', () => {
    expect(svg).toContain('(ALINHAR)');
  });

  it('título e legenda com extensão total no padrão BR', () => {
    expect(svg).toContain('CERCA A SER ALINHADA');
    expect(svg).toContain('Cerca a ser alinhada — total:');
    expect(svg).toContain('22,00 m'); // só o lado 2 (22m)
  });

  it('poligonal base fica cinza quando há destaque', () => {
    expect(svg).toContain('stroke="#6e7681"');
  });
});

describe('tarifaAlinhamento — lê de params (não hardcoda)', () => {
  it('retorna número positivo (tarifa R$/m do alinhamento de cerca)', () => {
    const t = tarifaAlinhamento();
    expect(typeof t).toBe('number');
    expect(t).toBeGreaterThan(0);
  });
});
