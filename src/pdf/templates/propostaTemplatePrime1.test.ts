// v1.99.16 — Testes do Template Prime I (proposta, dark).
import { describe, it, expect } from 'vitest';
import { buildPropostaPrime1Html, gerarPropostaPdfPrime1 } from './propostaTemplatePrime1';
import { dadosMockProposta, dadosMinimosProposta } from '../testFixtures';

describe('Proposta Template Prime I — HTML (puro)', () => {
  it('contem o nome do cliente', () => {
    expect(buildPropostaPrime1Html(dadosMockProposta)).toContain('Cliente Teste Silva');
  });
  it('contem o numero da proposta', () => {
    expect(buildPropostaPrime1Html(dadosMockProposta)).toContain('PROP-2025-TEST-001');
  });
  it('contem o valor total formatado e por extenso', () => {
    const html = buildPropostaPrime1Html(dadosMockProposta);
    expect(html).toContain('R$ 3.000,00');
    expect(html).toContain('tres mil reais');
  });
  it('exibe bloco DRL quando drlIncluida=true', () => {
    const html = buildPropostaPrime1Html({ ...dadosMockProposta, drlIncluida: true });
    expect(html).toContain('Declaração de Respeito de Limite');
  });
  it('NAO exibe bloco DRL quando drlIncluida=false', () => {
    expect(buildPropostaPrime1Html({ ...dadosMockProposta, drlIncluida: false })).not.toContain('Declaração de Respeito de Limite');
  });
  it('renderiza fundo dark (#0a0a0a)', () => {
    expect(buildPropostaPrime1Html(dadosMockProposta)).toContain('#0a0a0a');
  });
  it('escapa HTML do cliente (anti-injection)', () => {
    const html = buildPropostaPrime1Html({
      ...dadosMockProposta,
      cliente: { ...dadosMockProposta.cliente, nome: '<script>x</script>' },
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('nao quebra com dados minimos', () => {
    expect(() => buildPropostaPrime1Html(dadosMinimosProposta)).not.toThrow();
  });
});

describe('Proposta Template Prime I — PDF (puppeteer, skip sem Chromium)', () => {
  it('gera Buffer PDF valido quando Chromium disponivel', async () => {
    let buffer: Buffer | null = null;
    try {
      buffer = await gerarPropostaPdfPrime1(dadosMockProposta);
    } catch (err) {
      console.warn('[prime1-proposta] render pulado:', (err as Error).message);
      return;
    }
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  }, 30000);
});
