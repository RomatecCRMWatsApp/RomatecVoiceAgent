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

// v3.18.2: fallback body scan — alguns receptores (ComNav, CHC) nao escrevem
// TIME OF LAST OBS no cabecalho. O parser precisa cair pro body e extrair o
// ultimo epoch + sistemas pelos sat IDs.
describe('parseRinexHeader — fallback body scan (RINEX 2.x MIXED sem TIME OF LAST OBS)', () => {
  const txt =
    '     2.10           OBSERVATION DATA    M (MIXED)           RINEX VERSION / TYPE\n' +
    'S61L04366           ComNav              55.0                REC # / TYPE / VERS \n' +
    '                    S6 PLUS                                 ANT # / TYPE        \n' +
    '        1.8000        0.0000        0.0000                  ANTENNA: DELTA H/E/N\n' +
    '     1.000                                                  INTERVAL            \n' +
    '  2026     5    17    11    43    1.000000      GPS         TIME OF FIRST OBS   \n' +
    '                                                            END OF HEADER       \n' +
    ' 26  5 17 11 43  1.0000000  0 17G03G07G01G04G09G30G16G02G08G06R09R16\n' +
    '                                R15R05R20R19R04\n' +
    '  20592141.367   108212432.86708        51.000\n' +
    ' 26  5 17 11 43  2.0000000  0 17G03G07G01G04G09G30G16G02G08G06R09R16\n' +
    '                                R15R05R20R19R04\n' +
    '  20591999.547   108211687.71908        51.000\n' +
    ' 26  5 17 13 30  0.0000000  0 17G03G07G01G04G09G30G16G02G08G06R09R16\n' +
    '                                R15R05R20R19R04\n' +
    '  20580000.000   108200000.00000        51.000\n';

  it('extrai TIME OF LAST OBS do ultimo epoch do body', () => {
    const h = parseRinexHeader(txt);
    expect(h.timeFirstObs?.toISOString()).toBe('2026-05-17T11:43:01.000Z');
    expect(h.timeLastObs?.toISOString()).toBe('2026-05-17T13:30:00.000Z');
  });

  it('calcula duracao via header + body fallback', () => {
    const h = parseRinexHeader(txt);
    // 11:43:01 -> 13:30:00 = 1h 46min 59s = 6419s
    expect(h.durationSeconds).toBe(6419);
  });

  it('detecta sistemas via sat IDs dos epoch records (GPS + GLO)', () => {
    const h = parseRinexHeader(txt);
    expect(h.systems.sort()).toEqual(['GLO', 'GPS']);
  });

  it('pega sat IDs tambem em continuation lines (R15 R05 R20 etc.)', () => {
    // Garantia explicita de que linhas de continuacao tambem alimentam systems
    const h = parseRinexHeader(txt);
    expect(h.systems).toContain('GLO');
  });
});
