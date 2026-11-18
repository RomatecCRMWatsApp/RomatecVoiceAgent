// v3.168.0 — pontos para a coletora: deduplicação e formatos.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
vi.mock('./paMapas', () => ({ buscarSubdivisao: vi.fn(), buscarPerimetro: vi.fn(), buscarVila: vi.fn(), vinculosParcelas: vi.fn(), dadosCabecalho: vi.fn() }));
vi.mock('./mapasPdf', () => ({ cabecalho: vi.fn(), pdfDeHtml: vi.fn() }));

import { juntarPontos, csvColetora, txtColetora, dxfColetora, kmlColetora } from './paColetora';

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
    // v3.169.3: KML com todos os marcos e o contorno dos lotes (anel fechado, lon,lat)
    const kml = kmlColetora(d, 'PA Teste & cia', [{ lote: '01', area_ha: 1.5, anel: [[-47.2, -4.4], [-47.1, -4.4], [-47.1, -4.3]], info: 'FULANO · vila 01' }]);
    expect((kml.match(/<Point>/g) || []).length).toBe(3);
    expect(kml).toContain('<name>LT-01</name>');
    expect(kml).toContain('-47.20000000,-4.40000000,0 -47.10000000,-4.40000000,0 -47.10000000,-4.30000000,0 -47.20000000,-4.40000000,0');
    expect(kml).toContain('PA Teste &amp; cia');
  });
});

// v3.188.1: LT-10 tem 5 vértices; a planilha listava também marcos vizinhos fora do perímetro dele.
import { ligarMarcosAosLotes } from './paColetora';
describe('marcos ligados ao lote pela geometria', () => {
  const mk = (codigo: string, E: number, N: number, lotes: string[], comprar = true) => ({ codigo, E, N, tipo: 'Marco', implantar_com: null, lotes, comprar });
  const lt10 = [{ E: 1000, N: 1000 }, { E: 1300, N: 1250 }, { E: 1500, N: 1000 }, { E: 1520, N: 960 }, { E: 1200, N: 700 }];
  const marcos = [
    mk('M-036', 1000.4, 1000.2, ['10', '06']), mk('M-037', 1300, 1250, ['10', '09']), mk('M-040', 1500.8, 999.6, ['10'], false),
    mk('M-044', 1520, 960, ['10']), mk('M-045', 1200, 700, ['10', '11']),
    mk('M-043', 850, 900, ['10', '06', '11']), mk('M-046', 1100, 560, ['10', '11', '27']), // fora do LT-10
  ];
  it('só os 5 cantos do polígono contam como vértices do LT-10', () => {
    const { porLote, lotesDoMarco } = ligarMarcosAosLotes(marcos, [{ lote: '10', vertices: lt10 }]);
    expect(porLote.get('10')).toEqual(['M-036', 'M-037', 'M-040', 'M-044', 'M-045']);
    expect(lotesDoMarco.get('M-036')).toEqual(['10']);
    expect(lotesDoMarco.get('M-043')).toEqual(['06', '11']); // não é canto do LT-10 → sai do LT-10
  });
  it('lote sem nenhum canto casado mantém a lista da planilha', () => {
    const { porLote } = ligarMarcosAosLotes(marcos, [{ lote: '10', vertices: [{ E: 0, N: 0 }, { E: 5, N: 5 }, { E: 9, N: 0 }] }]);
    expect(porLote.get('10')).toHaveLength(7);
  });
});
