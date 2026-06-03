// v1.99.16 — Roteador de template para PROPOSTAS.
//
// Recebe PropostaDados (shape limpo, mapeado em mappers.ts) + um TemplateId e
// despacha pro gerador Prime correto. O template PADRAO NAO e' regenerado aqui:
// ele continua sendo produzido pelo pipeline pdfkit existente
// (integrations/propostasConsultoria.gerarPdfPropostaConsultoria), que e'
// INTOCADO. Por isso a rota deve tratar PADRAO no caminho legado e so chamar
// este roteador para Prime I / Prime II.

import { TemplateId, type PropostaDados } from '../types/templateTypes';
import { gerarPropostaPdfPrime1 } from './templates/propostaTemplatePrime1';
import { gerarPropostaPdfPrime2 } from './templates/propostaTemplatePrime2';

/** Lancado quando o roteador Prime recebe PADRAO — sinaliza usar o pipeline legado. */
export class TemplatePadraoNaoSuportadoError extends Error {
  constructor() {
    super(
      'Template PADRAO nao e gerado pelo roteador Prime. ' +
        'Use o pipeline pdfkit existente (gerarPdfPropostaConsultoria).',
    );
    this.name = 'TemplatePadraoNaoSuportadoError';
  }
}

/**
 * Gera o PDF da proposta no template Prime indicado.
 * @throws TemplatePadraoNaoSuportadoError quando templateId === PADRAO.
 */
export async function gerarPropostaPdf(
  dados: PropostaDados,
  templateId: TemplateId = TemplateId.PADRAO,
): Promise<Buffer> {
  switch (templateId) {
    case TemplateId.PRIME_I:
      return gerarPropostaPdfPrime1(dados);
    case TemplateId.PRIME_II:
      return gerarPropostaPdfPrime2(dados);
    default:
      throw new TemplatePadraoNaoSuportadoError();
  }
}
