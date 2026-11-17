import { describe, it, expect } from 'vitest';
import { enquadrar, htmlMapaLotes, baseValida, mundo } from './mapaTiles';

const lote = (l: string, x: number, y: number) => ({ geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 0.005, y], [x + 0.005, y + 0.005], [x, y + 0.005], [x, y]]] }, properties: { tipo: 'LOTE', lote: l } });

describe('v3.172.0 — mapa dos lotes com imagem de fundo (PDF)', () => {
  it('Web Mercator e enquadramento cabem os lotes no quadro', () => {
    expect(mundo([0, 0])).toEqual([128, 128]);
    const g = enquadrar([[-47.5, -4.9], [-47.4, -4.8]], 700, 500, 0.05);
    const [a, b] = [g.px([-47.5, -4.9]), g.px([-47.4, -4.8])];
    for (const [x, y] of [a, b]) { expect(x).toBeGreaterThanOrEqual(34); expect(x).toBeLessThanOrEqual(666); expect(y).toBeGreaterThanOrEqual(24); expect(y).toBeLessThanOrEqual(476); }
    expect(b[0]).toBeGreaterThan(a[0]); expect(b[1]).toBeLessThan(a[1]); // norte para cima
    expect(g.mPorPx).toBeGreaterThan(5); expect(g.mPorPx).toBeLessThan(40);
  });

  it('embute as imagens baixadas e desenha lotes com cor e rótulo', async () => {
    const urls: string[] = [];
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const r = await htmlMapaLotes({ features: [lote('01', -47.5, -4.9), lote('02', -47.495, -4.9)] }, { '01': { cor: '#1E7B34', rotulo: '★ LT-01 ✓', sub: 'medido' } }, { base: 'satelite', buscar: async (u) => { urls.push(u); return png; } });
    expect(r.imagem).toBe(true);
    expect(urls[0]).toMatch(/^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/);
    expect(r.html).toContain('data:image/png;base64,');
    expect(r.html).toContain('fill="#1E7B34"');
    expect(r.html).toContain('★ LT-01 ✓');
    expect(r.html).toContain('LT-02');
    expect(r.html).toContain('Esri');
  });

  it('sem internet: não trava, sai sobre fundo neutro', async () => {
    let n = 0;
    const r = await htmlMapaLotes({ features: [lote('01', -47.5, -4.9)] }, {}, { buscar: async () => { n++; return null; } });
    expect(r.imagem).toBe(false);
    expect(n).toBeLessThanOrEqual(8);
    expect(r.html).not.toContain('base64');
  });

  it('base inválida vira satélite', () => {
    expect(baseValida('relevo')).toBe('relevo');
    expect(baseValida('x')).toBe('satelite');
  });
});
