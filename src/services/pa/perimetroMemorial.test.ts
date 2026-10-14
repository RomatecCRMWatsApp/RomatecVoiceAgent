// v3.146.0 — Perímetro geral (TXT/CSV/DXF, UTM e geográficas) e memorial da vila.
import { describe, it, expect } from 'vitest';
import { perimetroDeArquivo, grausDms, textoMemorialPerimetro, lerDxfPerimetro, fusoDaLongitude } from './perimetro';
import { memorialVila, textoMemorialLote } from './memorialVila';
import { desenhoDoProjeto } from './layoutDesenho';
import { htmlMapaGeral, htmlMapaVila } from './mapasPdf';

const QUADRADO_UTM = 'V1 230000 9480000\nV2 230100 9480000\nV3 230100 9480100\nV4 230000 9480100\n';

describe('perímetro', () => {
  it('TXT UTM sem cabeçalho: área, perímetro, sentido horário e azimutes', () => {
    const p = perimetroDeArquivo('perimetro.txt', QUADRADO_UTM);
    expect(p.area_m2).toBe(10000);
    expect(p.area_ha).toBe(1);
    expect(p.perimetro_m).toBe(400);
    expect(p.fuso).toBe(23);
    expect(p.origem.sistema_entrada).toBe('UTM');
    // entrada anti-horária → memorial em sentido horário (V1 → V4 → V3 → V2)
    expect(p.vertices.map((v) => v.nome)).toEqual(['V4', 'V3', 'V2', 'V1']);
    expect(p.segmentos.map((s) => Math.round(s.azimute))).toEqual([90, 180, 270, 0]);
    expect(p.vertices[0].lat).toBeLessThan(0); // hemisfério sul
    expect(p.vertices[0].lon).toBeGreaterThan(-50);
  });
  it('CSV com cabeçalho, ponto-e-vírgula e decimal com vírgula; polígono repetindo o 1º vértice', () => {
    const csv = 'Ponto;E;N;Altitude\nP1;230000,50;9480000,00;210,3\nP2;230100,50;9480000,00;211\nP3;230100,50;9480100,00;212\nP4;230000,50;9480100,00;213\nP1;230000,50;9480000,00;210,3\n';
    const p = perimetroDeArquivo('perimetro.csv', csv);
    expect(p.vertices).toHaveLength(4);
    expect(p.area_m2).toBe(10000);
    expect(p.vertices.find((v) => v.nome === 'P1')!.h).toBe(210.3);
  });
  it('N,E invertidos são detectados', () => {
    const p = perimetroDeArquivo('ne.txt', '9480000 230000\n9480000 230100\n9480100 230100\n9480100 230000\n');
    expect(p.area_m2).toBe(10000);
  });
  it('lat/lon (graus decimais) → UTM fuso 23 Sul, área coerente', () => {
    const txt = 'lat;lon\n-4.9500;-47.5000\n-4.9500;-47.4991\n-4.9509;-47.4991\n-4.9509;-47.5000\n';
    const p = perimetroDeArquivo('geo.txt', txt);
    expect(p.origem.sistema_entrada).toBe('GEOGRAFICA');
    expect(p.fuso).toBe(23);
    expect(p.area_m2).toBeGreaterThan(9500);
    expect(p.area_m2).toBeLessThan(10500);
    expect(fusoDaLongitude(-47.5)).toBe(23);
  });
  it('DXF: maior polilinha fechada', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '8', 'LIXO', '90', '3', '70', '1', '10', '230010', '20', '9480010', '10', '230020', '20', '9480010', '10', '230020', '20', '9480020',
      '0', 'LWPOLYLINE', '8', 'PERIMETRO', '90', '4', '70', '1', '10', '230000', '20', '9480000', '10', '230100', '20', '9480000', '10', '230100', '20', '9480100', '10', '230000', '20', '9480100',
      '0', 'ENDSEC', '0', 'EOF'].join('\n');
    expect(lerDxfPerimetro(dxf)).toHaveLength(4);
    expect(perimetroDeArquivo('mapa.dxf', dxf).area_m2).toBe(10000);
  });
  it('erros claros: poucos vértices / coordenada estranha', () => {
    expect(() => perimetroDeArquivo('a.txt', '1 2\n3 4\n')).toThrow(/3 vértices/);
    expect(() => perimetroDeArquivo('a.txt', '5000 5000\n6000 5000\n6000 6000\n')).toThrow(/não reconhecidas/);
  });
  it('memorial do perímetro e DMS', () => {
    expect(grausDms(90)).toBe('90°00\'00"');
    expect(grausDms(45.5)).toBe('45°30\'00"');
    const t = textoMemorialPerimetro(perimetroDeArquivo('p.txt', QUADRADO_UTM), 'PA Teste', 'Açailândia/MA').join(' ');
    expect(t).toContain('Inicia-se a descrição deste perímetro no vértice V4');
    expect(t).toContain('azimute de 90°00\'00" e distância de 100,00 m até o vértice V3');
    expect(t).toContain('SIRGAS 2000');
  });
});

describe('memorial da vila', () => {
  const des = desenhoDoProjeto('PA-SALETE-MORENO', null);
  const lotes = [
    { numero: '27', xy: [[0, 0], [40, 0], [40, 20], [0, 20]] },
    { numero: '28', xy: [[0, 20], [40, 20], [40, 40], [0, 40]] },
    { numero: '03', xy: [[220, 0], [240, 0], [240, 40], [220, 40]], institucional: true },
    { numero: '02', xy: [[200, 0], [220, 0], [220, 40], [200, 40]] },
  ];
  const m = memorialVila(lotes, des);
  it('frente pela via (avenida), laterais com vizinhos e perimetral; área/perímetro', () => {
    const l27 = m.find((x) => x.numero === '27')!;
    expect(l27.frente).toEqual({ medida: 20, confrontante: 'Avenida Principal' });
    expect(l27.fundos.confrontante).toBe('Rua Perimetral');
    expect(l27.esquerda.confrontante).toBe('Lote 28');
    expect(l27.area_m2).toBe(800);
    expect(l27.perimetro_m).toBe(120);
    const l02 = m.find((x) => x.numero === '02')!;
    expect(l02.frente.confrontante).toBe('Rua 09');
    expect(l02.direita.confrontante).toBe('Lote 03 (área institucional)');
    expect(textoMemorialLote(l02, 'PA Teste')).toContain('frente com 20,00 m para Rua 09');
  });
  it('PDF HTML: mapa + memorial (vila) e perímetro + memorial (geral)', () => {
    const dados = { projeto: { nome: 'PA Teste', municipio: 'Açailândia', uf: 'MA', associacao: null }, rt: { nome: 'RT', registro: 'CFT 1' }, marca: { brasao: null, emblema: null }, data: '13/10/2026' };
    const hv = htmlMapaVila(dados, lotes, des, m);
    expect(hv).toContain('MEMORIAL DESCRITIVO DOS LOTES');
    expect(hv).toContain('Avenida Principal');
    const hg = htmlMapaGeral(dados, perimetroDeArquivo('p.txt', QUADRADO_UTM));
    expect(hg).toContain('MEMORIAL DESCRITIVO DO PERÍMETRO');
    expect(hg).toContain('1,0000 ha');
  });
});
