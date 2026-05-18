import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseRinexHeader } from './rinexHeaderParser';

const fx = (n: string) => readFileSync(path.join(__dirname, '__fixtures__', n), 'utf8');

describe('parseRinexHeader (RINEX 2.11)', () => {
  it('extrai versao e tipo', () => {
    const h = parseRinexHeader(fx('sample.26o'));
    expect(h.version).toBe('2.11');
    expect(h.type).toBe('OBSERVATION DATA');
  });

  it('extrai receptor e antena', () => {
    const h = parseRinexHeader(fx('sample.26o'));
    expect(h.receiverModel).toContain('TOPCON HIPER V');
    expect(h.antennaModel).toContain('TPSHIPER_V');
    expect(h.antennaHeightM).toBeCloseTo(1.58, 3);
  });

  it('extrai inicio e fim do rastreio', () => {
    const h = parseRinexHeader(fx('sample.26o'));
    expect(h.timeFirstObs?.toISOString()).toBe('2026-05-18T14:30:30.000Z');
    expect(h.timeLastObs?.toISOString()).toBe('2026-05-18T15:35:00.000Z');
  });

  it('calcula duracao em segundos', () => {
    const h = parseRinexHeader(fx('sample.26o'));
    expect(h.durationSeconds).toBe(3870); // 1h05min
  });

  it('extrai intervalo de amostragem', () => {
    const h = parseRinexHeader(fx('sample.26o'));
    expect(h.intervalSeconds).toBe(15);
  });

  it('detecta sistemas GNSS (G = GPS)', () => {
    const h = parseRinexHeader(fx('sample.26o'));
    expect(h.systems).toEqual(['GPS']);
  });

  it('extrai posicao aproximada XYZ', () => {
    const h = parseRinexHeader(fx('sample.26o'));
    expect(h.approxXYZ?.x).toBeCloseTo(4196543.812, 3);
    expect(h.approxXYZ?.y).toBeCloseTo(-4250176.234, 3);
    expect(h.approxXYZ?.z).toBeCloseTo(-517823.456, 3);
  });
});

describe('parseRinexHeader (variantes)', () => {
  it('tolera espacamento variavel', () => {
    const txt = '     2.11           OBSERVATION DATA    G                   RINEX VERSION / TYPE\nLEICA GS18                                                  REC # / TYPE / VERS\nLEIAS10        NONE                                        ANT # / TYPE\n                                                            END OF HEADER\n';
    const h = parseRinexHeader(txt);
    expect(h.version).toBe('2.11');
    expect(h.receiverModel).toContain('LEICA GS18');
  });

  it('detecta RINEX 3.x via header VERSION / TYPE', () => {
    const txt = '     3.04           OBSERVATION DATA    M (MIXED)           RINEX VERSION / TYPE\n                                                            END OF HEADER\n';
    const h = parseRinexHeader(txt);
    expect(h.version).toBe('3.04');
    expect(h.type).toBe('OBSERVATION DATA');
  });
});
