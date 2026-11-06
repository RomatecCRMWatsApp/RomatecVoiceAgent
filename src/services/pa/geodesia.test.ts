// v3.154.0 — Geodésia no padrão SIGEF: conferido contra o memorial SIGEF real da Fazendinha – Parte 02.
import { describe, it, expect } from 'vitest';
import { inversoGeodesico, areaGeodesicaLocal, dmsSigef, azimuteSigef } from './geodesia';

const g = (d: number, m: number, s: number) => -(d + m / 60 + s / 3600);

describe('geodésia SIGEF', () => {
  it('azimute e distância geodésicos batem com o SIGEF (FQNS-M-6801 → BKR-M-P331: 104°48\', 1135,36 m)', () => {
    const r = inversoGeodesico(g(4, 54, 26.035), g(47, 30, 19.62), g(4, 54, 35.481), g(47, 29, 43.994));
    expect(azimuteSigef(r.azimute)).toBe("104°48'");
    expect(r.distancia).toBeCloseTo(1135.36, 0);
  });
  it('formata coordenada e azimute como o SIGEF', () => {
    expect(dmsSigef(g(47, 30, 19.62))).toBe('-47°30\'19,620"');
    expect(azimuteSigef(359.999)).toBe("000°00'");
    expect(azimuteSigef(57.0426)).toBe("057°03'");
  });
  it('área local de um quadrado de ~1 km no equador ≈ 1 km²', () => {
    const d = 1000 / 110574; // 1 km em graus de latitude (aprox.)
    const a = areaGeodesicaLocal([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.008983 }, { lat: d, lon: 0.008983 }, { lat: d, lon: 0 }]);
    expect(a / 1e6).toBeCloseTo(1, 2);
  });
});
