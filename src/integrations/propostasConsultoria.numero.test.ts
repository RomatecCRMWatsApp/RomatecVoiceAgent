// v3.23.5: testes da numeracao PROP-AAAA-NNNN-R{N} (decisao tomada com o CEO).
//
// As funcoes parseRevisao/bumpRevisao sao internas (nao exportadas), entao
// reimplemento aqui em uma copia pura pra teste. O comportamento e' contrato:
// se o codigo de producao divergir, o teste do PUT em integration test pega
// (mas la depende de MySQL). Este teste e' o pre-flight rapido sem DB.

import { describe, it, expect } from 'vitest';

// Copia das helpers (mantenha em sync com src/integrations/propostasConsultoria.ts)
function parseRevisao(numero: string): { base: string; revisao: number } {
  const m = numero.match(/^(PROP-\d{4}-\d+)-R(\d+)$/);
  if (m) return { base: m[1], revisao: Number(m[2]) };
  const legacy = numero.match(/^(PROP-\d{4}-\d+)$/);
  if (legacy) return { base: legacy[1], revisao: 1 };
  return { base: numero, revisao: 1 };
}

function bumpRevisao(numero: string): string {
  const { base, revisao } = parseRevisao(numero);
  return `${base}-R${revisao + 1}`;
}

describe('parseRevisao', () => {
  it('PROP-2026-0011-R1 -> { base, revisao: 1 }', () => {
    expect(parseRevisao('PROP-2026-0011-R1')).toEqual({ base: 'PROP-2026-0011', revisao: 1 });
  });
  it('PROP-2026-0011-R7 -> { base, revisao: 7 }', () => {
    expect(parseRevisao('PROP-2026-0011-R7')).toEqual({ base: 'PROP-2026-0011', revisao: 7 });
  });
  it('legacy PROP-2026-0011 (sem sufixo) -> revisao: 1', () => {
    expect(parseRevisao('PROP-2026-0011')).toEqual({ base: 'PROP-2026-0011', revisao: 1 });
  });
  it('formato invalido -> revisao: 1 (fallback nao crash)', () => {
    expect(parseRevisao('lixo-abc')).toEqual({ base: 'lixo-abc', revisao: 1 });
  });
  it('aceita NNNN com mais digitos (5+)', () => {
    expect(parseRevisao('PROP-2026-12345-R3')).toEqual({ base: 'PROP-2026-12345', revisao: 3 });
  });
});

describe('bumpRevisao', () => {
  it('R1 -> R2', () => {
    expect(bumpRevisao('PROP-2026-0011-R1')).toBe('PROP-2026-0011-R2');
  });
  it('R5 -> R6', () => {
    expect(bumpRevisao('PROP-2026-0011-R5')).toBe('PROP-2026-0011-R6');
  });
  it('legacy sem sufixo -> R2 (assume R1 implicito, bump pra R2)', () => {
    expect(bumpRevisao('PROP-2026-0011')).toBe('PROP-2026-0011-R2');
  });
});
