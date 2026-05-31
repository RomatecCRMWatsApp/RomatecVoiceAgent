// v3.51.0 — testes do overlayService. Funcoes puras + aplicarOverlayFoto com canvas MOCKADO.
import { describe, it, expect, vi } from 'vitest';

// Mock do node-canvas (ambiente sem lib nativa). ctx no-op + toBuffer falso.
vi.mock('canvas', () => {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set: () => true,
  });
  const createCanvas = (w: number, h: number) => ({
    getContext: () => ctx,
    width: w, height: h,
    toBuffer: () => Buffer.from('JPEGFAKE-' + w + 'x' + h),
  });
  const loadImage = async () => ({ width: 4000, height: 3000 });
  return { default: { createCanvas, loadImage }, createCanvas, loadImage };
});

import { formatarUTM, formatarDataHora, montarLinhasOverlay, aplicarOverlayFoto } from '../services/overlayService';

describe('formatarUTM', () => {
  it('formata inteiro em pt-BR com pontos', () => {
    expect(formatarUTM(229296.1)).toBe('229.296');
    expect(formatarUTM(9454477)).toBe('9.454.477');
  });
  it('null/NaN viram traco', () => {
    expect(formatarUTM(null)).toBe('-');
    expect(formatarUTM(NaN)).toBe('-');
  });
});

describe('formatarDataHora', () => {
  it('formata DD/MM/YYYY, HH:MM:SS', () => {
    expect(formatarDataHora('2026-05-31T09:58:23')).toBe('31/05/2026, 09:58:23');
  });
  it('data invalida vira traco', () => {
    expect(formatarDataHora('lixo')).toBe('-');
  });
});

describe('montarLinhasOverlay', () => {
  const base = {
    imageBuffer: Buffer.from(''), latitude: -4.930907, longitude: -47.440994, altitude_m: 240,
    utm_zona: '23S', utm_e: 229296, utm_n: 9454477, datum: 'SIRGAS 2000',
    municipio: 'Acailandia, MA', logradouro: 'Piquia da Conquista',
    horario_captura: '2026-05-31T09:58:23', colaborador: 'Fulano',
  };
  it('inclui GPS, UTM, local, data e colaborador', () => {
    const L = montarLinhasOverlay(base);
    expect(L[0]).toContain('-4.930907, -47.440994');
    expect(L[0]).toContain('alt 240m');
    expect(L[1]).toContain('E=229.296');
    expect(L[1]).toContain('N=9.454.477');
    expect(L[1]).toContain('SIRGAS 2000');
    expect(L).toContain('Piquia da Conquista, Acailandia, MA');
    expect(L[L.length - 1]).toBe('Romatec · Fulano');
  });
  it('sem GPS mostra "nao disponiveis"', () => {
    const L = montarLinhasOverlay({ ...base, latitude: null, longitude: null });
    expect(L[0]).toContain('nao disponiveis');
  });
  it('sem UTM omite a linha UTM', () => {
    const L = montarLinhasOverlay({ ...base, utm_e: null, utm_n: null });
    expect(L.some((l) => l.includes('UTM'))).toBe(false);
  });
});

describe('aplicarOverlayFoto', () => {
  it('retorna buffer + base64 jpeg com canvas mockado', async () => {
    const r = await aplicarOverlayFoto({
      imageBuffer: Buffer.from('img'), latitude: -4.9, longitude: -47.4, altitude_m: 200,
      utm_zona: '23S', utm_e: 229000, utm_n: 9454000, datum: 'SIRGAS 2000',
      municipio: 'Acailandia', logradouro: 'Rua X', horario_captura: '2026-05-31T10:00:00', colaborador: 'Beltrano',
    });
    expect(r.buffer.length).toBeGreaterThan(0);
    expect(r.base64.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(r.largura).toBe(1080);
    expect(r.altura).toBe(810); // 3000*(1080/4000)
  });
});
