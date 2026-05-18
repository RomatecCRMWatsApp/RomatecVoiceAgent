import { describe, it, expect } from 'vitest';
import { latLonToUtm, utmToLatLon, isWithinBrazil, decimalToDms } from './coordTransform';

describe('coordTransform — SIRGAS2000', () => {
  it('Acailandia/MA: -4.940198, -47.503429 -> zona 23 S', () => {
    const u = latLonToUtm(-4.940198, -47.503429);
    expect(u.zona).toBe(23);
    expect(u.hemisferio).toBe('S');
    expect(u.utmLeste).toBeCloseTo(222_371, -2);   // tolerancia ~100m
    expect(u.utmNorte).toBeCloseTo(9_453_424, -2);
  });

  it('round-trip: lat/lon -> UTM -> lat/lon (erro < 1mm)', () => {
    const lat = -4.940198, lon = -47.503429;
    const u = latLonToUtm(lat, lon);
    const back = utmToLatLon(u.utmLeste, u.utmNorte, u.zona, u.hemisferio);
    expect(back.latitude).toBeCloseTo(lat, 8);
    expect(back.longitude).toBeCloseTo(lon, 8);
  });

  it('isWithinBrazil aceita coordenadas brasileiras', () => {
    expect(isWithinBrazil(-4.94, -47.5)).toBe(true);
    expect(isWithinBrazil(-25, -45)).toBe(true);
  });
  it('isWithinBrazil rejeita coordenadas fora', () => {
    expect(isWithinBrazil(40, -74)).toBe(false); // NYC
    expect(isWithinBrazil(-33, 18)).toBe(false); // Cape Town
  });
});

describe('decimalToDms (v3.19.0)', () => {
  it('latitude negativa -> hemisferio S', () => {
    expect(decimalToDms(-4.940197872, 'N', 'S')).toBe(`4° 56' 24.71234" S`);
  });
  it('longitude negativa -> hemisferio W', () => {
    expect(decimalToDms(-47.503429353, 'E', 'W')).toBe(`47° 30' 12.34567" W`);
  });
  it('latitude positiva -> hemisferio N', () => {
    expect(decimalToDms(2.5043083333, 'N', 'S')).toMatch(/^2° 30' 15\.5\d{4}" N$/);
  });
  it('zero -> hemPos sem sinal', () => {
    expect(decimalToDms(0, 'N', 'S')).toBe(`0° 00' 00.00000" N`);
  });
});
