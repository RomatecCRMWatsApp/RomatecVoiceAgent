// v3.151.0 — Subdivisão do PA a partir do DXF: lotes, rótulos, marcos e confrontantes.
import { describe, it, expect } from 'vitest';
import { subdivisaoDeDxf, textoMemorialParcela } from './parcelas';

const E0 = 250000, N0 = 9513000;
const pl = (camada: string, pts: number[][]) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(E0 + x), '20', String(N0 + y)])];
const tx = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(E0 + x), '20', String(N0 + y), '1', t];
const pt = (camada: string, x: number, y: number) => ['0', 'POINT', '8', camada, '10', String(E0 + x), '20', String(N0 + y)];
// Dois lotes de 100 × 100 m lado a lado; marcos com rótulo deslocado +5,+5 (como no CAD).
const marcos: Array<[number, number, string]> = [[0, 0, 'M-001'], [100, 0, 'M-002'], [100, 100, 'M-003'], [0, 100, 'M-004'], [200, 0, 'M-005'], [200, 100, 'M-006']];
const dxf = ['0', 'SECTION', '2', 'ENTITIES',
  ...pl('LOTES', [[0, 0], [100, 0], [100, 100], [0, 100]]), ...tx('LOTES_TEXTO', 50, 50, 'LT-01'), ...tx('LOTES_TEXTO', 50, 40, 'útil 0,9500 ha'),
  ...pl('LOTES', [[100, 0], [200, 0], [200, 100], [100, 100]]), ...tx('LOTES_TEXTO', 150, 50, 'LT-02'),
  ...marcos.flatMap(([x, y, c]) => [...pt('MARCOS_DIVISA_INTERNA', x, y), ...tx('MARCOS_TEXTO', x + 5, y + 5, c)]),
  '0', 'ENDSEC', '0', 'EOF'].join('\n');

describe('subdivisão do PA (DXF)', () => {
  const sub = subdivisaoDeDxf(dxf, { arquivo: 'teste.dxf' });
  it('lê os lotes pelo rótulo, com área e área útil', () => {
    expect(sub.parcelas.map((p) => p.lote)).toEqual(['01', '02']);
    expect(sub.parcelas[0].perimetro.area_m2).toBe(10000);
    expect(sub.parcelas[0].area_util_ha).toBe(0.95);
    expect(sub.marcos).toBe(6);
  });
  it('vértices recebem o código do marco (rótulo deslocado casa com o ponto certo)', () => {
    expect(sub.parcelas[0].perimetro.vertices.map((v) => v.nome).sort()).toEqual(['M-001', 'M-002', 'M-003', 'M-004']);
    expect(sub.parcelas[1].perimetro.vertices.map((v) => v.nome).sort()).toEqual(['M-002', 'M-003', 'M-005', 'M-006']);
    expect(sub.parcelas[0].tipos_vertice.every((t) => t === 'divisa interna')).toBe(true);
  });
  it('confrontante do lado comum é o lote vizinho; os demais são o limite do PA', () => {
    const conf1 = sub.parcelas[0].lados.map((l) => l.confrontante);
    expect(conf1.filter((c) => c === 'Lote 02')).toHaveLength(1);
    expect(conf1.filter((c) => c === 'Limite do Projeto de Assentamento')).toHaveLength(3);
    const memo = textoMemorialParcela(sub.parcelas[0], 'PA Teste', 'Açailândia/MA', null).join(' ');
    expect(memo).toContain('confrontando com Lote 02');
    expect(memo).toContain('área útil indicada no projeto: 0,9500 ha');
  });
  it('rótulo de lote repetido é recusado', () => {
    expect(() => subdivisaoDeDxf(dxf.replace('LT-02', 'LT-01'))).toThrow(/repetido/);
  });
});
