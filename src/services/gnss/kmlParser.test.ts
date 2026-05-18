import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseKmlPoint } from './kmlParser';

const fx = (n: string) => readFileSync(path.join(__dirname, '__fixtures__', n), 'utf8');

describe('parseKmlPoint', () => {
  it('extrai lon,lat,alt do primeiro Placemark/Point', () => {
    const p = parseKmlPoint(fx('sample-ibge.kml'));
    expect(p?.longitude).toBeCloseTo(-47.503429353, 7);
    expect(p?.latitude).toBeCloseTo(-4.940197872, 7);
    expect(p?.altitude).toBeCloseTo(245.678, 3);
  });

  it('retorna null se nao houver Point', () => {
    expect(parseKmlPoint('<kml></kml>')).toBeNull();
  });

  it('aceita espacos e quebras de linha dentro de <coordinates>', () => {
    const xml = '<kml><Placemark><Point><coordinates>\n  -47.5,-4.9,250.0\n</coordinates></Point></Placemark></kml>';
    const p = parseKmlPoint(xml);
    expect(p?.longitude).toBeCloseTo(-47.5, 3);
  });
});
