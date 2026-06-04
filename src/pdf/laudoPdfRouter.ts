// v3.x — Roteador de template para LAUDOS DE DEMARCACAO.
//
// Recebe LaudoDados (mapeado em mappers.laudoToLaudoDados) + TemplateId e
// despacha pro gerador Prime correto. O template PADRAO continua sendo gerado
// pelo pipeline pdfkit existente (services/laudoPdf.gerarPdfLaudo) — INTOCADO.
// Por isso o roteador lanca TemplatePadraoNaoSuportadoError no PADRAO.

import { TemplateId, type LaudoDados } from '../types/templateTypes';
import { gerarLaudoPdfPrime1 } from './templates/laudoTemplatePrime1';
import { gerarLaudoPdfPrime2 } from './templates/laudoTemplatePrime2';

/** Lancado quando o roteador Prime recebe PADRAO — sinaliza usar o pipeline legado. */
export class TemplatePadraoNaoSuportadoError extends Error {
  constructor() {
    super(
      'Template PADRAO nao e gerado pelo roteador Prime. ' +
        'Use o pipeline pdfkit existente (gerarPdfLaudo).',
    );
    this.name = 'TemplatePadraoNaoSuportadoError';
  }
}

/**
 * Gera o PDF do laudo no template Prime indicado.
 * @throws TemplatePadraoNaoSuportadoError quando templateId === PADRAO.
 */
export async function gerarLaudoPdf(
  dados: LaudoDados,
  templateId: TemplateId = TemplateId.PADRAO,
): Promise<Buffer> {
  switch (templateId) {
    case TemplateId.PRIME_I:
      return gerarLaudoPdfPrime1(dados);
    case TemplateId.PRIME_II:
      return gerarLaudoPdfPrime2(dados);
    default:
      throw new TemplatePadraoNaoSuportadoError();
  }
}
