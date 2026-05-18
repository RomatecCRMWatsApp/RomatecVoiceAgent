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
