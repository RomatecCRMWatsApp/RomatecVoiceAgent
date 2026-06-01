// v3.52.0 — testes do helper vtaVinculo (puro, sem DOM real; URLSearchParams
// existe no node). require do JS UMD via module.exports.
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const V = require('../public/js/vtaVinculo.js') as {
  intPos: (v: unknown) => number | null;
  lerVinculo: (s: unknown) => { laudo_id: number | null; proposta_id: number | null };
  aplicarVinculo: (p: Record<string, unknown>, c: { laudo_id?: number | null; proposta_id?: number | null }) => Record<string, unknown>;
  urlComVinculo: (base: string, c: { laudo_id?: number | null; proposta_id?: number | null }) => string;
  temVinculo: (c: unknown) => boolean;
  textoBadge: (c: { laudo_id?: number | null; proposta_id?: number | null }) => string;
};

describe('intPos', () => {
  it('aceita inteiro positivo', () => {
    expect(V.intPos('123')).toBe(123);
    expect(V.intPos(45)).toBe(45);
  });
  it('rejeita 0, negativo, lixo, null', () => {
    expect(V.intPos('0')).toBeNull();
    expect(V.intPos('-5')).toBeNull();
    expect(V.intPos('12a')).toBeNull();
    expect(V.intPos(null)).toBeNull();
    expect(V.intPos('')).toBeNull();
  });
});

describe('lerVinculo', () => {
  it('le laudo_id da query string', () => {
    expect(V.lerVinculo('?laudo_id=999')).toEqual({ laudo_id: 999, proposta_id: null });
  });
  it('le proposta_id e ignora laudo invalido', () => {
    expect(V.lerVinculo('?laudo_id=abc&proposta_id=45')).toEqual({ laudo_id: null, proposta_id: 45 });
  });
  it('aceita objeto direto', () => {
    expect(V.lerVinculo({ laudo_id: '7' })).toEqual({ laudo_id: 7, proposta_id: null });
  });
  it('sem params -> tudo null', () => {
    expect(V.lerVinculo('')).toEqual({ laudo_id: null, proposta_id: null });
  });
});

describe('aplicarVinculo', () => {
  it('injeta laudo_id sem mutar o original', () => {
    const base = { tipo: 'croqui', titulo: 'X' };
    const out = V.aplicarVinculo(base, { laudo_id: 12, proposta_id: null });
    expect(out).toEqual({ tipo: 'croqui', titulo: 'X', laudo_id: 12 });
    expect(base).not.toHaveProperty('laudo_id'); // imutavel
  });
  it('nao injeta chave quando vinculo ausente', () => {
    const out = V.aplicarVinculo({ a: 1 }, {});
    expect(out).toEqual({ a: 1 });
  });
  it('injeta proposta_id quando presente', () => {
    expect(V.aplicarVinculo({}, { proposta_id: 8 })).toEqual({ proposta_id: 8 });
  });
});

describe('urlComVinculo', () => {
  it('anexa query quando ha vinculo', () => {
    expect(V.urlComVinculo('/vta-canvas.html', { laudo_id: 5 })).toBe('/vta-canvas.html?laudo_id=5');
  });
  it('usa & quando base ja tem query', () => {
    expect(V.urlComVinculo('/x?a=1', { laudo_id: 5 })).toBe('/x?a=1&laudo_id=5');
  });
  it('retorna base intacta sem vinculo', () => {
    expect(V.urlComVinculo('/x', {})).toBe('/x');
  });
});

describe('temVinculo / textoBadge', () => {
  it('temVinculo reflete presenca', () => {
    expect(V.temVinculo({ laudo_id: 1 })).toBe(true);
    expect(V.temVinculo({})).toBe(false);
  });
  it('textoBadge formata laudo/proposta/avulso', () => {
    expect(V.textoBadge({ laudo_id: 9 })).toBe('Vinculado ao Laudo #9');
    expect(V.textoBadge({ proposta_id: 3 })).toBe('Vinculado à Proposta #3');
    expect(V.textoBadge({})).toBe('Sem vínculo (avulso)');
  });
});
