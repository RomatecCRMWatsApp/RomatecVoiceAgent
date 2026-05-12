import { describe, it, expect } from 'vitest';
import { mapearDxfQuadras, normalizarLabelQuadra } from './mapearDxfQuadras';
import type { DxfReport } from './parserDxfPython';

const baseReport: DxfReport = {
  formato: 'DXF', unidade: 'metros',
  quadras: [
    { dxf_id: 'Q-1', label: 'Q-01', layer: 'QUADRAS', coords: [[0,0],[30,0],[30,20],[0,20]], area_m2: 600, centroide: { x: 15, y: 10 } },
    { dxf_id: 'Q-2', label: 'Q-99', layer: 'QUADRAS', coords: [[100,0],[130,0],[130,20],[100,20]], area_m2: 600, centroide: { x: 115, y: 10 } },
  ],
  lotes: [
    { dxf_id: 'L-1', label: '1', layer: 'LOTES', coords: [[0,0],[10,0],[10,20],[0,20]], area_m2: 200, centroide: { x: 5, y: 10 }, quadra_label: 'Q-01' },
    { dxf_id: 'L-2', label: '2', layer: 'LOTES', coords: [[10,0],[20,0],[20,20],[10,20]], area_m2: 200, centroide: { x: 15, y: 10 }, quadra_label: 'Q-01' },
  ],
  avisos: [],
};

const quadrasCad = [{ id: 100, nome: 'Q. 01' }, { id: 101, nome: 'Q. 02' }];
const lotesCad = [
  { id: 200, quadra_id: 100, numero_lote: '1' },
  { id: 201, quadra_id: 100, numero_lote: '2' },
];

describe('normalizarLabelQuadra', () => {
  it('Q-01 e Q. 01 e QUADRA 01 produzem mesma normalizacao', () => {
    expect(normalizarLabelQuadra('Q-01')).toBe('Q01');
    expect(normalizarLabelQuadra('Q. 01')).toBe('Q01');
    expect(normalizarLabelQuadra('QUADRA 01')).toBe('Q01');
    expect(normalizarLabelQuadra('  q1  ')).toBe('Q1');
  });
});

describe('mapearDxfQuadras', () => {
  it('casa quadra Q-01 (DXF) com Q. 01 (cadastro)', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    const q1 = r.quadras.find(q => q.dxf.dxf_id === 'Q-1');
    expect(q1?.match?.id).toBe(100);
  });

  it('Q-99 fica unmapped pq nao tem correspondencia', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    const q99 = r.quadras.find(q => q.dxf.dxf_id === 'Q-2');
    expect(q99?.match).toBeNull();
  });

  it('lotes 1 e 2 da Q-01 mapeiam aos lotes_cad 200 e 201', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    const matches = r.lotes.filter(l => l.match !== null).map(l => l.match!.id).sort();
    expect(matches).toEqual([200, 201]);
  });

  it('lote sem quadra_label fica unmapped', () => {
    const reportSemQuadra: DxfReport = {
      ...baseReport,
      lotes: [{ ...baseReport.lotes[0], quadra_label: '' }],
    };
    const r = mapearDxfQuadras(reportSemQuadra, quadrasCad, lotesCad);
    expect(r.lotes[0].match).toBeNull();
    expect(r.lotes[0].motivo_unmapped).toContain('quadra');
  });

  it('lote com quadra cadastrada mas numero_lote nao encontrado fica unmapped', () => {
    const lotesIncompleto = [{ id: 200, quadra_id: 100, numero_lote: '5' }];
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesIncompleto);
    expect(r.lotes.every(l => l.match === null)).toBe(true);
  });

  it('relatorio agrega contagem', () => {
    const r = mapearDxfQuadras(baseReport, quadrasCad, lotesCad);
    expect(r.relatorio.quadras_matched).toBe(1);
    expect(r.relatorio.quadras_unmapped).toBe(1);
    expect(r.relatorio.lotes_matched).toBe(2);
    expect(r.relatorio.lotes_unmapped).toBe(0);
  });
});
