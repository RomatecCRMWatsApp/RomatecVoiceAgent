// v1.99.16 — Roteador de template para RECIBOS / VALES.
//
// Recebe ReciboDados (mapeado em mappers.ts) + TemplateId e despacha pro gerador
// Prime correto. PADRAO continua sendo gerado pelo pipeline pdfkit existente
// (services/reciboPdf.gerarPdfRecibo / services/valePdf.gerarPdfVale) — INTOCADO.

import { TemplateId, type ReciboDados } from '../types/templateTypes';
import { gerarReciboPdfPrime1 } from './templates/reciboTemplatePrime1';
import { gerarReciboPdfPrime2 } from './templates/reciboTemplatePrime2';

/** Lancado quando o roteador Prime recebe PADRAO — sinaliza usar o pipeline legado. */
export class TemplatePadraoNaoSuportadoError extends Error {
  constructor() {
    super(
      'Template PADRAO nao e gerado pelo roteador Prime. ' +
        'Use o pipeline pdfkit existente (gerarPdfRecibo / gerarPdfVale).',
    );
    this.name = 'TemplatePadraoNaoSuportadoError';
  }
}

/**
 * Gera o PDF do recibo/vale no template Prime indicado.
 * @throws TemplatePadraoNaoSuportadoError quando templateId === PADRAO.
 */
export async function gerarReciboPdf(
  dados: ReciboDados,
  templateId: TemplateId = TemplateId.PADRAO,
): Promise<Buffer> {
  switch (templateId) {
    case TemplateId.PRIME_I:
      return gerarReciboPdfPrime1(dados);
    case TemplateId.PRIME_II:
      return gerarReciboPdfPrime2(dados);
    default:
      throw new TemplatePadraoNaoSuportadoError();
  }
}
