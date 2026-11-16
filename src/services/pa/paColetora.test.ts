// v3.168.0 — pontos para a coletora: deduplicação e formatos.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
vi.mock('./paMapas', () => ({ buscarSubdivisao: vi.fn(), buscarPerimetro: vi.fn(), buscarVila: vi.fn(), vinculosParcelas: vi.fn(), dadosCabecalho: vi.fn() }));
vi.mock('./mapasPdf', () => ({ cabecalho: vi.fn(), pdfDeHtml: vi.fn() }));

import { juntarPontos, csvColetora, txtColetora, dxfColetora } from './paColetora';

const v = (nome: string, E: number, N: number) => ({ nome, E, N, h: null, lat: -4.4, lon: -47.2 });

describe('pontos da coletora', () => {
  const pts = juntarPontos([
    { origem: 'LOTE', lote: '01', vertices: [v('L01-P01', 1000, 2000), v('L01-P02', 1100, 2000)], tipos: [null, null] },
    { origem: 'LOTE', lote: '02', vertices: [v('M-007', 1100.005, 2000.004), v('L02-P02', 1200, 2000)], tipos: ['MARCO', null] },
    { origem: 'PERIMETRO', vertices: [v('V01', 1000, 2000)] },
  ]);

  it('vértice comum sai uma vez, com o nome do marco e os dois lotes', () => {
    expect(pts).toHaveLength(3);
    const comum = pts.find((p) => p.E === 1100)!;
    expect(comum.nome).toBe('M-007');
    expect(comum.tipo).toBe('MARCO');
    expect(comum.lotes).toEqual(['01', '02']);
    expect(pts.find((p) => p.E === 1000)!.nome).toBe('V01'); // nome real do perímetro vence o provisório L01-P01
  });

  it('CSV/TXT/DXF no formato da coletora', () => {
    const d = { pontos: pts, fuso: 23, hemisferio: 'S' as const, lotes: [] };
    const csv = csvColetora(d).split('\r\n');
    expect(csv[0]).toBe('Name,Easting,Northing,Elevation,Code');
    expect(csv[1]).toBe('V01,1000.000,2000.000,0.000,PERIMETRO LT-01');
    expect(txtColetora(d).split('\r\n')[1]).toBe('M-007,1100.000,2000.000,0.000,MARCO LT-01/02');
    const dxf = dxfColetora(d, [{ lote: '01', pts: [[1000, 2000], [1100, 2000], [1050, 2100]] }]);
    expect((dxf.match(/\r\nPOINT\r\n/g) || []).length).toBe(3);
    expect(dxf).toContain('M-007');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });
});
