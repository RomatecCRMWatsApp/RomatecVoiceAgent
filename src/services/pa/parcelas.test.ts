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
    expect(memo).toContain('área útil (descontadas APP e estradas): 0,9500 ha');
  });
  it('rótulo de lote repetido é recusado', () => {
    expect(() => subdivisaoDeDxf(dxf.replace('LT-02', 'LT-01'))).toThrow(/repetido/);
  });
});

import { htmlSubdivisao } from './mapasPdf';
describe('beneficiário do lote (v3.152.0)', () => {
  const sub = subdivisaoDeDxf(dxf);
  const d = { projeto: { nome: 'PA Teste', municipio: 'Açailândia', uf: 'MA', associacao: null }, rt: { nome: 'RT', registro: 'CFT' }, marca: { brasao: null, emblema: null }, data: '06/11/2026' };
  it('com vínculo, o PDF sai com nome e CPF; sem vínculo, linha em branco', () => {
    const html = htmlSubdivisao(d, sub, { lotes: ['01', '02'], geral: true, perimetro: null, beneficiarios: { '01': { nome: 'MARIA TESTE', cpf: '000.000.000-00' } } });
    expect(html).toContain('Beneficiário(a): MARIA TESTE, CPF 000.000.000-00');
    expect((html.match(/______________________________<\/b>CPF/g) || []).length).toBe(1);
  });
});

import { vilaDeDxf } from './parcelas';
import { plantaSigef, memorialSigef } from './sigefPdf';
describe('perímetro da vila e modelo SIGEF (v3.154.0)', () => {
  const quad = (camada: string, s: number, pre: string) => [
    ...pl(camada, [[0, 0], [s, 0], [s, s], [0, s]]),
    ...[[0, 0], [s, 0], [s, s], [0, s]].flatMap(([x, y], i) => [...pt(`${camada}_VERTICES`, x, y), ...tx(`${camada}_TEXTO`, x + 4, y + 4, `${pre}-0${i + 1}`)]),
    ...tx(`${camada}_TEXTO`, s / 2, -10, `${s},00 m`),
  ];
  const dxfVila = ['0', 'SECTION', '2', 'ENTITIES', ...quad('VILA_AC01_AREA_TOTAL', 300, 'VL'), ...quad('VILA_NUCLEO_LEVANTADO', 280, 'VN'), '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const v = vilaDeDxf(dxfVila);
  it('separa área total e núcleo e nomeia os vértices pelos rótulos', () => {
    expect(v.total.area_m2).toBe(90000);
    expect(v.nucleo?.area_m2).toBe(78400);
    expect(v.total.vertices.map((x) => x.nome).sort()).toEqual(['VL-01', 'VL-02', 'VL-03', 'VL-04']);
    expect(v.nucleo?.vertices.map((x) => x.nome).sort()).toEqual(['VN-01', 'VN-02', 'VN-03', 'VN-04']);
  });
  it('planta e memorial SIGEF trazem a identificação e o aviso de não certificado', () => {
    const d = { projeto: { nome: 'PA Teste', municipio: 'Açailândia', uf: 'MA', associacao: 'Associação Teste' }, rt: { nome: 'RT Teste', registro: 'CFT 1', cft: '1', incra: 'FQNS' }, marca: { brasao: null, emblema: null }, data: '07/11/2026' };
    const peca = { denominacao: 'Área da vila', titular: null, natureza: 'Área comunitária', perimetro: v.total, confrontantes: null, mapaSvg: '<svg></svg>' };
    const html = plantaSigef(d, peca) + memorialSigef(d, peca);
    expect(html).toContain('PLANTA');
    expect(html).toContain('DESCRIÇÃO DA PARCELA');
    expect(html).toContain('NÃO certificado no SIGEF');
    expect(html).toContain('Cód. Credenciado(a) INCRA:</b> FQNS');
    expect((html.match(/<tr><td class="c"><b>VL-0/g) || []).length).toBe(4);
  });
});
