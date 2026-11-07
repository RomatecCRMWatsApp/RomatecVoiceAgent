import { describe, it, expect } from 'vitest';
import { limparPoligonais, areaAssinada, type Pt } from './limpezaLotes';

const q = (x0: number, y0: number, w = 100, h = 100): Pt[] => [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
const area = (r: { anel: Pt[] } | undefined) => Math.abs(areaAssinada(r!.anel));
const E = 500000, N = 9450000;

describe('limparPoligonais', () => {
  it('lotes corretos ficam iguais (sem alteração)', () => {
    const r = limparPoligonais([{ lote: '01', anel: q(E, N) }, { lote: '02', anel: q(E + 100, N) }]);
    expect(r.relatorio.every((x) => !x.alterado)).toBe(true);
    expect(area(r.lotes[0])).toBeCloseTo(10000, 3);
    expect(r.lotes[0].anel[0]).toEqual({ x: E, y: N });
  });

  it('polilinha que fecha no canto errado (invade o vizinho) volta à região correta', () => {
    // LT-02 vai até o canto de cima do LT-01 e fecha de volta no início: cunha dentro do LT-01
    const errado = [{ x: E + 100, y: N }, { x: E + 200, y: N }, { x: E + 200, y: N + 100 }, { x: E + 100, y: N + 100 }, { x: E, y: N + 100 }];
    const r = limparPoligonais([{ lote: '01', anel: q(E, N) }, { lote: '02', anel: errado }, { lote: '03', anel: q(E + 200, N) }]);
    const l = Object.fromEntries(r.lotes.map((x) => [x.lote, x]));
    expect(area(l['01'])).toBeCloseTo(10000, 3);
    expect(area(l['02'])).toBeCloseTo(10000, 3);
    expect(l['02'].anel).toHaveLength(4);
    expect(r.relatorio.find((x) => x.lote === '02')!.acoes.join(' ')).toMatch(/sobreposição com LT-01/);
  });

  it('ponto repetido, ida e volta e vértice do vizinho a 12 cm', () => {
    const a = [...q(E, N)];
    const b = [{ x: E + 100.12, y: N + 0.05 }, { x: E + 200, y: N }, { x: E + 200, y: N }, { x: E + 200, y: N + 100 }, { x: E + 250, y: N + 100 }, { x: E + 200, y: N + 100 }, { x: E + 100, y: N + 100 }];
    const r = limparPoligonais([{ lote: '01', anel: a }, { lote: '02', anel: b }]);
    const l2 = r.lotes.find((x) => x.lote === '02')!;
    expect(l2.anel).toHaveLength(4);
    expect(area(l2)).toBeCloseTo(10000, 0);
    expect(r.relatorio.find((x) => x.lote === '02')!.acoes.join(' ')).toMatch(/repetido.*ida e volta|ida e volta.*repetido|repetido/);
  });

  it('lote com polilinha aberta é fechado pelas linhas vizinhas + rótulo', () => {
    const aberta = [{ x: E + 100, y: N }, { x: E + 200, y: N }, { x: E + 200, y: N + 100 }, { x: E + 100, y: N + 100 }];
    const r = limparPoligonais([{ lote: '01', anel: q(E, N) }, { lote: '02', anel: null, rotulo: { x: E + 150, y: N + 50 } }], [aberta]);
    const l2 = r.lotes.find((x) => x.lote === '02')!;
    expect(area(l2)).toBeCloseTo(10000, 3);
  });

  it('traço solto é removido e parte fora do perímetro é cortada', () => {
    const perim = [{ x: E, y: N }, { x: E + 200, y: N }, { x: E + 200, y: N + 100 }, { x: E, y: N + 100 }];
    const vaza = [{ x: E + 100, y: N }, { x: E + 200, y: N }, { x: E + 230, y: N + 50 }, { x: E + 200, y: N + 100 }, { x: E + 100, y: N + 100 }];
    const r = limparPoligonais([{ lote: '01', anel: q(E, N) }, { lote: '02', anel: vaza }], [[{ x: E + 50, y: N + 50 }, { x: E + 60, y: N + 60 }]], { perimetro: perim });
    expect(area(r.lotes.find((x) => x.lote === '02'))).toBeCloseTo(10000, 3);
    expect(r.avisos.join(' ')).toMatch(/traço\(s\) solto/);
  });

  it('fresta fina entre dois lotes é incorporada', () => {
    const r = limparPoligonais([{ lote: '01', anel: q(E, N) }, { lote: '02', anel: q(E + 100.8, N, 99.2, 100) }],
      [[{ x: E + 100, y: N }, { x: E + 100.8, y: N }], [{ x: E + 100, y: N + 100 }, { x: E + 100.8, y: N + 100 }]]);
    const tot = r.lotes.reduce((s, x) => s + area(x), 0);
    expect(tot).toBeCloseTo(20000, 1);
  });
});

import { subdivisaoDeDxf, limparSubdivisao, dxfSubdivisao } from './parcelas';

const lw = (layer: string, pts: Array<[number, number]>, fechada = true) =>
  ['0', 'LWPOLYLINE', '8', layer, '90', String(pts.length), '70', fechada ? '1' : '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
const tx = (layer: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', layer, '10', String(x), '20', String(y), '40', '5', '1', t];
const pt = (layer: string, x: number, y: number) => ['0', 'POINT', '8', layer, '10', String(x), '20', String(y)];
const dxfDe = (ents: string[][]) => ['0', 'SECTION', '2', 'ENTITIES', ...ents.flat(), '0', 'ENDSEC', '0', 'EOF'].join('\n');

describe('subdivisão: DXF com defeito → limpo → DXF limpo → reimporta igual', () => {
  const ents = [
    lw('LOTES', [[E, N], [E + 100, N], [E + 100, N + 100], [E, N + 100]]),
    // LT-02 fecha no canto errado (vai até o canto do LT-01)
    lw('LOTES', [[E + 100, N], [E + 200, N], [E + 200, N + 100], [E + 100, N + 100], [E, N + 100]]),
    lw('LOTES', [[E + 200, N], [E + 300, N], [E + 300, N + 100], [E + 200, N + 100], [E + 200, N + 100]]),
    tx('LOTES_TEXTO', E + 50, N + 50, 'LT-01'), tx('LOTES_TEXTO', E + 150, N + 50, 'LT-02'), tx('LOTES_TEXTO', E + 250, N + 50, 'LT-03'),
    tx('LOTES_TEXTO', E + 150, N + 40, 'útil 0,9500 ha'),
    pt('MARCO_CONCRETO', E + 100, N), tx('MARCO_CONCRETO', E + 105, N + 5, 'M-001'),
    pt('MARCO_CONCRETO', E + 200, N), tx('MARCO_CONCRETO', E + 205, N + 5, 'M-002'),
  ];
  it('corrige o LT-02, mantém marcos e reimporta o DXF limpo igual', () => {
    const sub = subdivisaoDeDxf(dxfDe(ents), { arquivo: 'teste.dxf' });
    const a = Object.fromEntries(sub.parcelas.map((p) => [p.lote, p.perimetro.area_m2]));
    expect(a).toEqual({ '01': 10000, '02': 10000, '03': 10000 });
    expect(sub.limpeza!.lotes_corrigidos).toBeGreaterThanOrEqual(1);
    const lt2 = sub.parcelas.find((p) => p.lote === '02')!;
    expect(lt2.perimetro.vertices.map((v) => v.nome)).toEqual(expect.arrayContaining(['M-001', 'M-002']));
    expect(lt2.area_util_ha).toBe(0.95);
    const dxf = dxfSubdivisao(sub);
    expect(dxf).toContain('POLYLINE');
    const de2 = subdivisaoDeDxf(dxf, { arquivo: 'teste-LIMPO.dxf' });
    expect(Object.fromEntries(de2.parcelas.map((p) => [p.lote, p.perimetro.area_m2]))).toEqual(a);
    expect(de2.limpeza!.lotes_corrigidos).toBe(0);
    expect(de2.parcelas.find((p) => p.lote === '02')!.perimetro.vertices.map((v) => v.nome)).toEqual(lt2.perimetro.vertices.map((v) => v.nome));
    expect(de2.parcelas.find((p) => p.lote === '02')!.area_util_ha).toBe(0.95);
  });
  it('limpa subdivisão já salva (sem o DXF) e guarda a geometria original', () => {
    // simula o que está no banco: subdivisão antiga (sem limpeza) com o LT-02 errado
    const sub = subdivisaoDeDxf(dxfDe(ents));
    const ruim = { ...sub, limpeza: undefined, geometria_original: undefined, rotulos: undefined };
    const lt2 = ruim.parcelas.find((p) => p.lote === '02')!;
    const errado = subdivisaoDeDxf(dxfDe([lw('LOTES', [[E + 100, N], [E + 200, N], [E + 200, N + 100], [E + 100, N + 100], [E, N + 100]]), tx('L', E + 150, N + 50, 'LT-02')])).parcelas[0];
    // força a geometria errada (sem o vizinho, a limpeza do upload não teria como corrigir)
    ruim.parcelas = ruim.parcelas.map((p) => (p.lote === '02' ? { ...lt2, perimetro: errado.perimetro, tipos_vertice: errado.tipos_vertice } : p));
    expect(ruim.parcelas.find((p) => p.lote === '02')!.perimetro.area_m2).toBe(15000);
    const limpa = limparSubdivisao(ruim);
    expect(limpa.parcelas.find((p) => p.lote === '02')!.perimetro.area_m2).toBe(10000);
    expect(limpa.parcelas.find((p) => p.lote === '01')!.perimetro.area_m2).toBe(10000);
    expect(limpa.geometria_original!.find((g) => g.lote === '02')!.pts).toHaveLength(5);
    expect(limpa.limpeza!.relatorio.find((r) => r.lote === '02')!.acoes.join(' ')).toMatch(/LT-01/);
  });
});

describe('limparPoligonais — loteamento 8×8 com ruído de CAD', () => {
  it('64 lotes irregulares, vértices com ±4 cm, 3 fechamentos errados: áreas e total preservados', () => {
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
    const W = 600, nx = 8;
    // grade irregular (divisas tortas), igual para os dois lados de cada divisa
    const g: Pt[][] = [];
    for (let i = 0; i <= nx; i++) { g[i] = []; for (let j = 0; j <= nx; j++) g[i][j] = { x: E + i * W + (i % nx ? rnd() * 120 : 0), y: N + j * W + (j % nx ? rnd() * 120 : 0) }; }
    const ruido = (p: Pt) => ({ x: p.x + rnd() * 0.08, y: p.y + rnd() * 0.08 });
    const certos = new Map<string, Pt[]>();
    const ent: Array<{ lote: string; anel: Pt[]; rotulo: Pt }> = [];
    let n = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nx; j++) {
      const lote = String(++n).padStart(2, '0');
      const r = [g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]];
      certos.set(lote, r);
      let anel = r.map(ruido);
      // 3 lotes fecham no canto errado: depois do último vértice vão até o canto de cima do vizinho da esquerda
      if (i > 0 && [10, 27, 45].includes(n)) anel = [...anel, ruido(g[i - 1][j + 1])];
      ent.push({ lote, anel, rotulo: { x: (r[0].x + r[2].x) / 2, y: (r[0].y + r[2].y) / 2 } });
    }
    const t0 = Date.now();
    const res = limparPoligonais(ent);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(res.lotes).toHaveLength(64);
    for (const l of res.lotes) expect(Math.abs(Math.abs(areaAssinada(l.anel)) - Math.abs(areaAssinada(certos.get(l.lote)!)))).toBeLessThan(100); // < 0,03% (ruído de ±4 cm nos vértices)
    const tot = res.lotes.reduce((a, l) => a + Math.abs(areaAssinada(l.anel)), 0);
    const totCerto = [...certos.values()].reduce((a, r) => a + Math.abs(areaAssinada(r)), 0);
    expect(Math.abs(tot - totCerto)).toBeLessThan(200);
    expect(res.lotes.every((l) => l.anel.length === 4)).toBe(true);
    for (const lote of ['10', '27', '45']) expect(res.relatorio.find((r) => r.lote === lote)!.acoes.join(' ')).toMatch(/sobreposição|refeito/);
  });
});
