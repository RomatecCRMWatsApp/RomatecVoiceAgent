import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseIbgePos } from './posParser';

const fx = (n: string) => readFileSync(path.join(__dirname, '__fixtures__', n), 'utf8');

describe('parseIbgePos', () => {
  const r = parseIbgePos(fx('sample-ibge.pos'));

  it('parsea 3 epocas', () => expect(r.epochs).toHaveLength(3));
  it('primeira epoca tem timestamp UTC', () => {
    expect(r.epochs[0].timestamp.toISOString()).toBe('2026-05-18T14:30:30.000Z');
  });
  it('media de coordenadas calculada', () => {
    expect(r.mean.latitude).toBeCloseTo(-4.940197833, 8);
    expect(r.mean.longitude).toBeCloseTo(-47.503429430, 8);
    expect(r.mean.altitude).toBeCloseTo(245.681, 3);
  });
  it('numEpocas reflete o total', () => expect(r.numEpocas).toBe(3));
});
