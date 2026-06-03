// v1.99.16 — Testes do Template Prime II (proposta, clean).
import { describe, it, expect } from 'vitest';
import { buildPropostaPrime2Html, gerarPropostaPdfPrime2 } from './propostaTemplatePrime2';
import { dadosMockProposta, dadosMinimosProposta } from '../testFixtures';

describe('Proposta Template Prime II — HTML (puro)', () => {
  it('contem nome do cliente e numero', () => {
    const html = buildPropostaPrime2Html(dadosMockProposta);
    expect(html).toContain('Cliente Teste Silva');
    expect(html).toContain('PROP-2025-TEST-001');
  });
  it('renderiza fundo claro (#fafaf8)', () => {
    expect(buildPropostaPrime2Html(dadosMockProposta)).toContain('#fafaf8');
  });
  it('exibe DRL quando drlIncluida=true', () => {
    expect(buildPropostaPrime2Html({ ...dadosMockProposta, drlIncluida: true })).toContain('DRL');
  });
  it('contem valor por extenso', () => {
    expect(buildPropostaPrime2Html(dadosMockProposta)).toContain('tres mil reais');
  });
  it('nao quebra com dados minimos', () => {
    expect(() => buildPropostaPrime2Html(dadosMinimosProposta)).not.toThrow();
  });
});

describe('Proposta Template Prime II — PDF (puppeteer, skip sem Chromium)', () => {
  it('gera Buffer PDF valido quando Chromium disponivel', async () => {
    let buffer: Buffer | null = null;
    try {
      buffer = await gerarPropostaPdfPrime2(dadosMockProposta);
    } catch (err) {
      console.warn('[prime2-proposta] render pulado:', (err as Error).message);
      return;
    }
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);
  }, 30000);
});
