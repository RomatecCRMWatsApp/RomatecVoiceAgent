// v1.99.16 — Testes do roteador de proposta.
import { describe, it, expect } from 'vitest';
import { gerarPropostaPdf, TemplatePadraoNaoSuportadoError } from './propostaPdfRouter';
import { TemplateId } from '../types/templateTypes';
import { dadosMockProposta } from './testFixtures';

describe('propostaPdfRouter', () => {
  it('PADRAO lanca TemplatePadraoNaoSuportadoError (usar pipeline legado)', async () => {
    await expect(gerarPropostaPdf(dadosMockProposta, TemplateId.PADRAO)).rejects.toBeInstanceOf(
      TemplatePadraoNaoSuportadoError,
    );
  });
  it('default (sem templateId) tambem cai em PADRAO', async () => {
    await expect(gerarPropostaPdf(dadosMockProposta)).rejects.toBeInstanceOf(
      TemplatePadraoNaoSuportadoError,
    );
  });
  it('PRIME_I/PRIME_II despacham pro gerador (Buffer ou erro de Chromium)', async () => {
    for (const tpl of [TemplateId.PRIME_I, TemplateId.PRIME_II]) {
      try {
        const buf = await gerarPropostaPdf(dadosMockProposta, tpl);
        expect(buf).toBeInstanceOf(Buffer);
      } catch (err) {
        // Sem Chromium: aceitavel — mas NUNCA o erro de PADRAO.
        expect(err).not.toBeInstanceOf(TemplatePadraoNaoSuportadoError);
      }
    }
  }, 30000);
});
