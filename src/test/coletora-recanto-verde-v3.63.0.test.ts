// v3.63.0 — Valida que o sistema LÊ o formato real da coletora do CEO.
// Dados reais: "Relatorio_LatLong_Demarcação_Recanto Verde.txt" (Açailândia/MA,
// zona 23S). Layout: 12 colunas SEM cabeçalho, separadas por vírgula:
//   vertice, UTM_E, UTM_N, alt, Lat_DMS, Lng_DMS, alt, Lat_dec, Lng_dec, σE, σN, σh
// O parser posicional (importarRTK) infere E/N por magnitude (N>1M, E 10k–1M),
// ignora DMS/decimais/sigmas, e o pipeline geométrico fecha a poligonal.

import { describe, it, expect } from 'vitest';
import { importarRTK, calcularLados, areaGauss, perimetro } from '../services/geometria';
import { parseColetora, gerarSvgProposta } from '../services/propostaCroqui';

// 13 vértices reais (vertice, UTM_E, UTM_N) — Recanto Verde.
const VERTICES: Array<[string, number, number]> = [
  ['FQNS-P-6004', 225196.3300, 9450011.5100],
  ['AVEX-M-0124', 225207.7900, 9450003.0900],
  ['FQNS-P-6005', 225213.7330, 9449999.0677],
  ['AVEX-M-0123', 225372.3800, 9449891.6800],
  ['APG30105',    225414.5300, 9449863.0000],
  ['FQNS-M-4036', 225354.6600, 9449757.5800],
  ['FQNS-M-4033', 225251.2600, 9449575.0300],
  ['FQNS-M-6300', 225103.6700, 9449314.4700],
  ['AVEX-P-0012', 225088.2300, 9449287.2100],
  ['FQNS-03',     225023.2600, 9449172.7400],
  ['FQNS-P-6000', 224964.3600, 9449068.7800],
  ['FQNS-P-6001', 224753.7300, 9449187.9500],
  ['FQNS-P-6002', 224735.2100, 9449198.4300],
];

// Reconstrói o arquivo no MESMO layout de 12 colunas da coletora real.
const TXT = VERTICES.map(([v, e, n]) =>
  `${v},${e.toFixed(4)},${n.toFixed(4)},242.748,04°58'16"S,47°28'41"W,242.748,-4.9711,-47.4781,0.004,0.003,0.002`
).join('\n');

describe('coletora Recanto Verde — formato real é lido pelo importarRTK', () => {
  const { pontos } = importarRTK(TXT);

  it('extrai os 13 vértices com rótulo + UTM E/N', () => {
    expect(pontos).toHaveLength(13);
    expect(pontos[0].rotulo).toBe('FQNS-P-6004');
    expect(pontos[0].e).toBeCloseTo(225196.33, 2);
    expect(pontos[0].n).toBeCloseTo(9450011.51, 2);
    expect(pontos[12].rotulo).toBe('FQNS-P-6002');
    expect(pontos[12].e).toBeCloseTo(224735.21, 2);
  });

  it('todos os pontos têm E e N (não nulos)', () => {
    expect(pontos.every(p => p.e != null && p.n != null)).toBe(true);
  });

  it('pipeline geométrico fecha: 13 lados, área e perímetro plausíveis', () => {
    const utm = pontos.map(p => ({ e: p.e as number, n: p.n as number }));
    const lados = calcularLados(utm);
    expect(lados).toHaveLength(13);

    const areaM2 = areaGauss(utm);
    const areaHa = areaM2 / 10000;
    expect(areaM2).toBeGreaterThan(0);
    expect(areaHa).toBeGreaterThan(1);    // fazenda → vários hectares
    expect(areaHa).toBeLessThan(500);

    const perim = perimetro(utm);
    expect(perim).toBeGreaterThan(1000);  // perímetro na casa dos km
    expect(perim).toBeLessThan(6000);
  });
});

describe('parseColetora + gerarSvgProposta (helpers do front)', () => {
  it('parseColetora extrai 13 pontos no formato PontoPropostaIn', () => {
    const pontos = parseColetora(TXT);
    expect(pontos).toHaveLength(13);
    expect(pontos[0].ordem).toBe(1);
    expect(pontos[0].vertice).toBe('FQNS-P-6004');
    expect(pontos[0].utmE).toBeCloseTo(225196.33, 2);
    expect(pontos[0].utmN).toBeCloseTo(9450011.51, 2);
  });

  it('gerarSvgProposta produz SVG com a poligonal e os rótulos', () => {
    const pontos = parseColetora(TXT);
    const svg = gerarSvgProposta(pontos, { tipoImovel: 'RURAL' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('FQNS-P-6004');
    expect(svg).toContain('</svg>');
  });

  it('gerarSvgProposta com destacarLados marca a cerca em dourado', () => {
    const pontos = parseColetora(TXT);
    const svg = gerarSvgProposta(pontos, { destacarLados: [1, 2], tituloDestaque: 'CERCA A SER ALINHADA' });
    expect(svg).toContain('#C9A84C');
    expect(svg).toContain('CERCA A SER ALINHADA');
  });
});
