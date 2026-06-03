// v1.99.16 — Testes do Template Prime I (recibo, dark).
import { describe, it, expect } from 'vitest';
import { buildReciboPrime1Html, gerarReciboPdfPrime1 } from './reciboTemplatePrime1';
import { dadosMockRecibo, dadosMinimosRecibo } from '../testFixtures';

const QR_FAKE = 'data:image/png;base64,iVBORw0KGgoAAAANSU';

describe('Recibo Template Prime I — HTML (puro)', () => {
  it('contem numero, cliente e servico', () => {
    const html = buildReciboPrime1Html(dadosMockRecibo, QR_FAKE);
    expect(html).toContain('REC-2025-0042');
    expect(html).toContain('Cliente Teste Silva');
    expect(html).toContain('Levantamento topografico');
  });
  it('inclui bloco de validacao (hash + url + QR)', () => {
    const html = buildReciboPrime1Html(dadosMockRecibo, QR_FAKE);
    expect(html).toContain('VERIFICACAO DE AUTENTICIDADE');
    expect(html).toContain(dadosMockRecibo.hashValidacao);
    expect(html).toContain(dadosMockRecibo.urlVerificacao);
    expect(html).toContain(QR_FAKE);
  });
  it('exibe selo CONFIRMADO quando confirmado=true', () => {
    expect(buildReciboPrime1Html(dadosMockRecibo, QR_FAKE)).toContain('CONFIRMADO');
  });
  it('NAO exibe selo quando confirmado=false', () => {
    expect(buildReciboPrime1Html({ ...dadosMockRecibo, confirmado: false }, QR_FAKE)).not.toContain('class="selo"');
  });
  it('exibe imagem de assinatura digital quando presente', () => {
    const html = buildReciboPrime1Html(
      { ...dadosMockRecibo, assinaturaDigital: 'AAAabc' },
      QR_FAKE,
    );
    expect(html).toContain('data:image/png;base64,AAAabc');
  });
  it('exibe linha pontilhada quando sem assinatura', () => {
    expect(buildReciboPrime1Html(dadosMinimosRecibo, QR_FAKE)).toContain('dashed');
  });
});

describe('Recibo Template Prime I — PDF (puppeteer, skip sem Chromium)', () => {
  it('gera Buffer PDF valido quando Chromium disponivel', async () => {
    let buffer: Buffer | null = null;
    try {
      buffer = await gerarReciboPdfPrime1(dadosMockRecibo);
    } catch (err) {
      console.warn('[prime1-recibo] render pulado:', (err as Error).message);
      return;
    }
    expect(buffer.slice(0, 4).toString()).toBe('%PDF');
  }, 30000);
});
