// src/services/croquiHelpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  calcularCentroide,
  formatarAreaParaCentro,
  calcularMC,
} from './croquiHelpers';

describe('calcularCentroide', () => {
  it('média aritmética de 4 pontos quadrados', () => {
    const pts = [
      { utm_e: 0, utm_n: 0 },
      { utm_e: 100, utm_n: 0 },
      { utm_e: 100, utm_n: 100 },
      { utm_e: 0, utm_n: 100 },
    ];
    expect(calcularCentroide(pts)).toEqual({ x: 50, y: 50 });
  });

  it('triangulo com vertice em (60, 60)', () => {
    const pts = [
      { utm_e: 0, utm_n: 0 },
      { utm_e: 120, utm_n: 0 },
      { utm_e: 60, utm_n: 180 },
    ];
    expect(calcularCentroide(pts)).toEqual({ x: 60, y: 60 });
  });

  it('vetor vazio → (0, 0)', () => {
    expect(calcularCentroide([])).toEqual({ x: 0, y: 0 });
  });
});

describe('formatarAreaParaCentro', () => {
  it('rural 195300 m² = 19,5300 ha', () => {
    expect(formatarAreaParaCentro(195300, 'RURAL')).toBe('19,5300 ha');
  });

  it('urbano 1500 m² = 1.500,00 m²', () => {
    expect(formatarAreaParaCentro(1500, 'URBANO')).toBe('1.500,00 m²');
  });

  it('urbano 234.5 m² = 234,50 m²', () => {
    expect(formatarAreaParaCentro(234.5, 'URBANO')).toBe('234,50 m²');
  });

  it('rural pequeno 5000 m² = 0,5000 ha', () => {
    expect(formatarAreaParaCentro(5000, 'RURAL')).toBe('0,5000 ha');
  });

  it('zero retorna formato adequado', () => {
    expect(formatarAreaParaCentro(0, 'URBANO')).toBe('0,00 m²');
    expect(formatarAreaParaCentro(0, 'RURAL')).toBe('0,0000 ha');
  });
});

describe('calcularMC', () => {
  it('zona 23 → -45° (Açailândia/MA)', () => {
    expect(calcularMC(23)).toBe(-45);
  });

  it('zona 22 → -51°', () => {
    expect(calcularMC(22)).toBe(-51);
  });

  it('zona 24 → -39°', () => {
    expect(calcularMC(24)).toBe(-39);
  });

  it('zona 25 (Fernando de Noronha) → -33°', () => {
    expect(calcularMC(25)).toBe(-33);
  });
});
