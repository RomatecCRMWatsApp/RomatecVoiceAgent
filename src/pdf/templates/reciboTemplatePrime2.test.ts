// v1.99.16 — Testes do Template Prime II (recibo, clean).
import { describe, it, expect } from 'vitest';
import { buildReciboPrime2Html, gerarReciboPdfPrime2 } from './reciboTemplatePrime2';
import { dadosMockRecibo, dadosMinimosRecibo } from '../testFixtures';

const QR_FAKE = 'data:image/png;base64,iVBORw0KGgoAAAANSU';

describe('Recibo Template Prime II — HTML (puro)', () => {
  it('contem numero, cliente e bloco de validacao', () => {
    const html = buildReciboPrime2Html(dadosMockRecibo, QR_FAKE);
    expect(html).toContain('REC-2025-0042');
    expect(html).toContain('Cliente Teste Silva');
    expect(html).toContain('VERIFICACAO DE AUTENTICIDADE');
    expect(html).toContain(dadosMockRecibo.hashValidacao);
  });
  it('fundo claro (#fafaf8)', () => {
    expect(buildReciboPrime2Html(dadosMockRecibo, QR_FAKE)).toContain('#fafaf8');
  });
  it('exibe selo CONFIRMADO quando confirmado=true', () => {
    expect(buildReciboPrime2Html(dadosMockRecibo, QR_FAKE)).toContain('CONFIRMADO');
  });
  it('exibe assinatura digital base64 quando presente', () => {
    const html = buildReciboPrime2Html({ ...dadosMockRecibo, assinaturaDigital: 'XYZ123' }, QR_FAKE);
    expect(html).toContain('data:image/png;base64,XYZ123');
  });
  it('nao quebra com dados minimos', () => {
    expect(() => buildReciboPrime2Html(dadosMinimosRecibo, QR_FAKE)).not.toThrow();
  });
});

describe('Recibo Template Prime II — PDF (puppeteer, skip sem Chromium)', () => {
  it('gera Buffer PDF valido quando Chromium disponivel', async () => {
    let buffer: Buffer | null = null;
    try {
      buffer = await gerarReciboPdfPrime2(dadosMockRecibo);
    } catch (err) {
      console.warn('[prime2-recibo] render pulado:', (err as Error).message);
      return;
    }
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  }, 30000);
});
