import { describe, it, expect } from 'vitest';
import { plantaQuadraSvg } from './plantaQuadraSvg';

const quadraGeojson = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[0,0],[30,0],[30,20],[0,20],[0,0]]],
});

function loteGj(x0: number): string {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [[[x0,0],[x0+10,0],[x0+10,20],[x0,20],[x0,0]]],
  });
}

const lotes = [
  { id: 1, numero_lote: '1', geojson: loteGj(0), isObjeto: false },
  { id: 2, numero_lote: '2', geojson: loteGj(10), isObjeto: true },
  { id: 3, numero_lote: '3', geojson: loteGj(20), isObjeto: false },
];

describe('plantaQuadraSvg', () => {
  it('produz string SVG comecando com <svg', () => {
    const svg = plantaQuadraSvg({
      quadraNome: 'Q-01',
      quadraGeojson,
      lotes,
    });
    expect(svg).toMatch(/^<svg/);
    expect(svg).toMatch(/<\/svg>\s*$/);
  });

  it('lote-objeto recebe fill destacado e os outros sao stroke-only', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    const fillObjeto = svg.match(/data-lote="2"[^>]*fill="([^"]+)"/);
    const fillVizinho = svg.match(/data-lote="1"[^>]*fill="([^"]+)"/);
    expect(fillObjeto?.[1]).not.toBe('none');
    expect(fillVizinho?.[1]).toBe('none');
  });

  it('contem o nome da quadra como titulo', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    expect(svg).toContain('Q-01');
  });

  it('contem label de cada lote', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    expect(svg).toMatch(/>1<\/text>/);
    expect(svg).toMatch(/>2<\/text>/);
    expect(svg).toMatch(/>3<\/text>/);
  });

  it('viewBox abrange bbox da quadra com margem', () => {
    const svg = plantaQuadraSvg({ quadraNome: 'Q-01', quadraGeojson, lotes });
    const m = svg.match(/viewBox="([^"]+)"/);
    expect(m).toBeTruthy();
    const [minX, minY, w, h] = m![1].split(/\s+/).map(Number);
    expect(minX).toBeLessThan(0);
    expect(minY).toBeLessThan(0);
    expect(w).toBeGreaterThan(30);
    expect(h).toBeGreaterThan(20);
  });
});
