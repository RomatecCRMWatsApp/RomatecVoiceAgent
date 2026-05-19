import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseIbgeResultTxt } from './ibgeResultParser';

const fx = (n: string) => readFileSync(path.join(__dirname, '__fixtures__', n));

describe('parseIbgeResultTxt — fixture padrao', () => {
  const r = parseIbgeResultTxt(fx('sample-ibge.txt'));

  it('latitude em graus decimais (negativa no sul)', () => {
    expect(r.latitudeGraus).toBeCloseTo(-4 - 56/60 - 24.71234/3600, 7);
  });
  it('longitude em graus decimais (negativa no oeste)', () => {
    expect(r.longitudeGraus).toBeCloseTo(-47 - 30/60 - 12.34567/3600, 7);
  });
  it('altitudes geometrica e ortometrica', () => {
    expect(r.altitudeGeometricaM).toBeCloseTo(245.678, 3);
    expect(r.altitudeOrtometricaM).toBeCloseTo(232.145, 3);
    expect(r.modeloGeoidal).toBe('MAPGEO2015');
  });
  it('UTM zona, MC, N e E', () => {
    expect(r.utmZona).toBe(23);
    expect(r.utmHemisferio).toBe('S');
    expect(r.utmMc).toBe(-45);
    expect(r.utmNorteM).toBeCloseTo(9453678.456, 3);
    expect(r.utmLesteM).toBeCloseTo(654321.789, 3);
  });
  it('sigmas em metros', () => {
    expect(r.sigmaLatM).toBeCloseTo(0.003, 4);
    expect(r.sigmaLonM).toBeCloseTo(0.002, 4);
    expect(r.sigmaAltM).toBeCloseTo(0.008, 4);
  });
  it('referencial geodesico', () => {
    expect(r.refGeodesico).toBe('SIRGAS2000');
  });
});

describe('parseIbgeResultTxt — latin1 encoding', () => {
  it('decodifica conteudo latin1 (caracteres acentuados em PROJECAO)', () => {
    const latin1 = Buffer.from(
      'COORDENADAS GEOD\xC9SICAS NO REFERENCIAL SIRGAS2000\n' +
      '   LATITUDE  =  -04 56 24.71234 S   SIGMA =  0.003 m\n' +
      '   LONGITUDE = -47 30 12.34567 W   SIGMA =  0.002 m\n' +
      '   ALT GEOM. =     245.678 m       SIGMA =  0.008 m\n',
      'binary'
    );
    const r = parseIbgeResultTxt(latin1);
    expect(r.latitudeGraus).toBeCloseTo(-4.9402, 3);
  });
});

describe('parseIbgeResultTxt — latitude positiva (hemisferio N)', () => {
  it('latitude N retorna valor positivo', () => {
    const buf = Buffer.from(
      'COORDENADAS GEODESICAS NO REFERENCIAL SIRGAS2000\n' +
      '   LATITUDE  =  02 30 15.50000 N   SIGMA =  0.005 m\n' +
      '   LONGITUDE = -60 15 30.00000 W   SIGMA =  0.005 m\n',
      'utf8'
    );
    const r = parseIbgeResultTxt(buf);
    expect(r.latitudeGraus).toBeGreaterThan(0);
    expect(r.latitudeGraus).toBeCloseTo(2 + 30/60 + 15.5/3600, 6);
  });
});

// v3.20.3: formato COMPACTO (novo) do IBGE-PPP — campos abreviados, virgula
// decimal, sem N/S/E/W, sigmas em linhas separadas.
describe('parseIbgeResultTxt — formato COMPACTO (ComNav/CHC retornos 2024+)', () => {
  const txt =
    'PROCES 2026/05/18 14:05:28\n' +
    'RINEX  S61L043661371142.26O\n' +
    'MARCO  B-RCP-17\n' +
    'INICIO 2026/05/17 11:43:01,00\n' +
    'FIM    2026/05/17 16:46:23,00\n' +
    'MODO   ESTATICO\n' +
    'ANTENA NÃO DISPONÍVEL\n' +
    'ALTANT 1,800 m\n' +
    'INTERV 1,00\n' +
    'FREQ   L3\n' +
    'OBSERV CODIGO&FASE\n' +
    'ORBITA RÁPIDA\n' +
    'DATUM  SIRGAS2000, época 2000.4\n' +
    'LAT    -4 56 06,8448\n' +
    'LON    -47 30 24,9097\n' +
    'HGEO   205,22 m\n' +
    'SLAT   0,001 m\n' +
    'SLON   0,002 m\n' +
    'SHGEO  0,004 m\n' +
    'UTMN   9453971,255 m\n' +
    'UTME   221981,971 m\n' +
    'MC     -45\n' +
    'MODELO hgeoHNOR_IMBITUBA\n' +
    'FATCOR -25,07 m\n' +
    'INCERT 0,1 m\n' +
    'HNOR   230,29 m\n';

  it('extrai latitude e longitude (DMS com virgula decimal e sinal nos graus)', () => {
    const r = parseIbgeResultTxt(txt);
    expect(r.latitudeGraus).toBeCloseTo(-(4 + 56/60 + 6.8448/3600), 7);
    expect(r.longitudeGraus).toBeCloseTo(-(47 + 30/60 + 24.9097/3600), 7);
  });

  it('extrai altitudes (HGEO geometrica + HNOR ortometrica + MODELO geoidal)', () => {
    const r = parseIbgeResultTxt(txt);
    expect(r.altitudeGeometricaM).toBeCloseTo(205.22, 2);
    expect(r.altitudeOrtometricaM).toBeCloseTo(230.29, 2);
    expect(r.modeloGeoidal).toBe('hgeoHNOR_IMBITUBA');
  });

  it('extrai UTM (UTMN, UTME, MC) com virgula decimal e infere zona+hemisferio', () => {
    const r = parseIbgeResultTxt(txt);
    expect(r.utmNorteM).toBeCloseTo(9453971.255, 3);
    expect(r.utmLesteM).toBeCloseTo(221981.971, 3);
    expect(r.utmMc).toBe(-45);
    expect(r.utmZona).toBe(23); // derivado da longitude -47.5
    expect(r.utmHemisferio).toBe('S'); // derivado do sinal da latitude
  });

  it('extrai sigmas (SLAT, SLON, SHGEO)', () => {
    const r = parseIbgeResultTxt(txt);
    expect(r.sigmaLatM).toBeCloseTo(0.001, 4);
    expect(r.sigmaLonM).toBeCloseTo(0.002, 4);
    expect(r.sigmaAltM).toBeCloseTo(0.004, 4);
  });

  it('detecta datum SIRGAS2000 do campo DATUM', () => {
    const r = parseIbgeResultTxt(txt);
    expect(r.refGeodesico).toBe('SIRGAS2000');
  });
});
