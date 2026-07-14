// v3.96.0 — Mapa grafico da nuvem de pontos: gerarNuvemPontos devolve as
// coordenadas (contorno + interior) e o croqui as plota. Garante que a contagem
// cobrada (contarNuvemPontos) bate com o desenho (mesma fonte).
import { describe, it, expect } from 'vitest';
import { gerarNuvemPontos, contarNuvemPontos } from '../services/geometria';
import { gerarSvgNuvemProposta } from '../services/propostaCroqui';

const QUADRADO = [
  { ordem: 1, vertice: 'P1', utmE: 0, utmN: 0 },
  { ordem: 2, vertice: 'P2', utmE: 60, utmN: 0 },
  { ordem: 3, vertice: 'P3', utmE: 60, utmN: 60 },
  { ordem: 4, vertice: 'P4', utmE: 0, utmN: 60 },
];

describe('gerarNuvemPontos (coordenadas) — v3.96.0', () => {
  it('devolve contorno + interior e bate com a contagem cobrada', () => {
    const en = QUADRADO.map((p) => ({ e: p.utmE, n: p.utmN }));
    const g = gerarNuvemPontos(en, 20);
    const c = contarNuvemPontos(en, 20);
    expect(g).not.toBeNull();
    expect(c).not.toBeNull();
    expect(g!.contorno.length).toBe(c!.perimetro);
    expect(g!.interno.length).toBe(c!.interno);
    expect(g!.contorno.length + g!.interno.length).toBe(c!.total);
    // todo ponto interno cai dentro do bounding box
    for (const p of g!.interno) {
      expect(p.e).toBeGreaterThanOrEqual(0);
      expect(p.e).toBeLessThanOrEqual(60);
      expect(p.n).toBeGreaterThanOrEqual(0);
      expect(p.n).toBeLessThanOrEqual(60);
    }
  });

  it('poligono invalido → null', () => {
    expect(gerarNuvemPontos([{ e: 0, n: 0 }], 20)).toBeNull();
  });
});

describe('gerarSvgNuvemProposta (mapa) — v3.96.0', () => {
  it('SVG plota os pontos (circulos) + legenda da nuvem', () => {
    const svg = gerarSvgNuvemProposta(QUADRADO, 20, { tipoImovel: 'URBANO', areaTotalM2: 3600 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('#2563eb');            // cor dos pontos da nuvem
    expect(svg).toMatch(/Nuvem de pontos — \d+ pontos/);
    // deve ter varios circulos (pontos) alem dos vertices
    const circles = (svg.match(/<circle/g) || []).length;
    expect(circles).toBeGreaterThan(QUADRADO.length);
  });

  it('sem poligono valido → cai no croqui normal (sem quebrar)', () => {
    const svg = gerarSvgNuvemProposta([{ ordem: 1, vertice: 'P1', utmE: 0, utmN: 0 }], 20, {});
    expect(svg).toContain('<svg');
  });
});
