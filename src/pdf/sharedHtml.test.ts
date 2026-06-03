// v1.99.16 — Testes dos helpers puros compartilhados.
import { describe, it, expect } from 'vitest';
import { fmtBRL, escapeHtml, valorPorExtenso, blocoAssinaturaHtml } from './sharedHtml';

describe('fmtBRL', () => {
  it('formata em BRL', () => {
    expect(fmtBRL(3000)).toBe('R$ 3.000,00');
    expect(fmtBRL(1234.5)).toBe('R$ 1.234,50');
  });
  it('null/undefined → travessao', () => {
    expect(fmtBRL(null)).toBe('—');
    expect(fmtBRL(undefined)).toBe('—');
  });
});

describe('escapeHtml', () => {
  it('escapa caracteres perigosos', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
});

describe('valorPorExtenso', () => {
  it('valores inteiros', () => {
    expect(valorPorExtenso(0)).toBe('zero reais');
    expect(valorPorExtenso(1)).toBe('um real');
    expect(valorPorExtenso(100)).toBe('cem reais');
    expect(valorPorExtenso(3000)).toBe('tres mil reais');
  });
  it('milhares e centenas', () => {
    expect(valorPorExtenso(1500)).toBe('mil e quinhentos reais');
    expect(valorPorExtenso(2025)).toBe('dois mil e vinte e cinco reais');
  });
  it('com centavos', () => {
    expect(valorPorExtenso(1.5)).toBe('um real e cinquenta centavos');
    expect(valorPorExtenso(0.01)).toBe('zero reais e um centavo');
  });
  it('milhoes', () => {
    expect(valorPorExtenso(1_000_000)).toContain('um milhao');
  });
});

describe('blocoAssinaturaHtml', () => {
  it('imagem quando base64 presente (sem prefixo)', () => {
    expect(blocoAssinaturaHtml('ABC', '#000')).toContain('data:image/png;base64,ABC');
  });
  it('mantem data URL quando ja prefixado', () => {
    expect(blocoAssinaturaHtml('data:image/png;base64,Z', '#000')).toContain('data:image/png;base64,Z');
  });
  it('linha pontilhada quando ausente', () => {
    const html = blocoAssinaturaHtml(undefined, '#999');
    expect(html).toContain('dashed');
    expect(html).toContain('Assinatura');
  });
});
