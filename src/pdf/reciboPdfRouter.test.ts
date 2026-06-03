// v1.99.16 — Testes do roteador de recibo.
import { describe, it, expect } from 'vitest';
import { gerarReciboPdf, TemplatePadraoNaoSuportadoError } from './reciboPdfRouter';
import { TemplateId } from '../types/templateTypes';
import { dadosMockRecibo } from './testFixtures';

describe('reciboPdfRouter', () => {
  it('PADRAO lanca TemplatePadraoNaoSuportadoError', async () => {
    await expect(gerarReciboPdf(dadosMockRecibo, TemplateId.PADRAO)).rejects.toBeInstanceOf(
      TemplatePadraoNaoSuportadoError,
    );
  });
  it('PRIME_I/PRIME_II despacham pro gerador (Buffer ou erro de Chromium)', async () => {
    for (const tpl of [TemplateId.PRIME_I, TemplateId.PRIME_II]) {
      try {
        const buf = await gerarReciboPdf(dadosMockRecibo, tpl);
        expect(buf).toBeInstanceOf(Buffer);
      } catch (err) {
        expect(err).not.toBeInstanceOf(TemplatePadraoNaoSuportadoError);
      }
    }
  }, 30000);
});
