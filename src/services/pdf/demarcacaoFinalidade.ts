// v3.40.0: helper standalone (sem deps de mysql/voyageai/pdfkit) pra gerar o
// texto da FINALIDADE da proposta de Demarcacao conforme PROP-2026-0028-R1.
// Extraido de propostasConsultoria.ts pra ser testavel sem arrastar voyageai.

import type { FinalidadeDemarcacao } from '../pricing/types';

// Textos legados (fallback retrocompat). v3.40.0 promoveu finalidade
// demarcacao_inicial para um texto dinamico (rural com NBR 13133 + SIRGAS2000,
// urbano com NBR 13133).
const FINALIDADE_DEMARCACAO_TEXTOS_LEGADO: Record<FinalidadeDemarcacao, string> = {
  demarcacao_inicial: 'Levantamento topografico de campo para implantacao fisica dos vertices definidos em projeto e materializacao da poligonal do imovel no terreno.',
  redemarcacao: 'Repiqueteamento de vertices perdidos/deteriorados, restabelecendo a poligonal original conforme matricula e levantamento anterior.',
  subdivisao_lote: 'Demarcacao fisica das fracoes resultantes de desmembramento/remembramento aprovado, com implantacao de marcos nas novas divisas.',
  piqueteamento_apenas: 'Implantacao de marcos fisicos em vertices previamente calculados em escritorio (sem novo levantamento de campo).',
};

/**
 * Gera o texto da FINALIDADE da proposta de Demarcacao.
 *
 * - Rural + demarcacao_inicial: cita denominacao do imovel + "parcela de gleba rural"
 *   + NTGIR 3a Ed. (INCRA) + NBR 13133 (ABNT) + SIRGAS2000.
 * - Urbana + demarcacao_inicial: cita loteamento/quadra/lote se disponivel + NBR 13133.
 * - Outras finalidades: usa texto legado (retrocompat).
 */
export function montarFinalidadeDemarcacao(
  finalidade: FinalidadeDemarcacao,
  subtipo: 'demarcacao_urbana' | 'demarcacao_rural',
  dadosImovel: { denominacao_imovel?: string; loteamento_nome?: string; quadra?: string; lote?: string },
): string {
  const isRural = subtipo === 'demarcacao_rural';
  if (finalidade === 'demarcacao_inicial') {
    if (isRural) {
      const denom = (dadosImovel.denominacao_imovel || '').trim() || 'parte de gleba rural';
      return `Levantamento topografico georreferenciado e implantacao fisica dos vertices `
        + `da poligonal de ${denom} (parcela de gleba rural), com materializacao dos marcos no terreno `
        + `conforme NTGIR 3a Ed. (INCRA) e NBR 13133 (ABNT), em coordenadas SIRGAS2000.`;
    }
    const parts: string[] = [];
    if (dadosImovel.loteamento_nome) parts.push(`Loteamento ${dadosImovel.loteamento_nome.trim()}`);
    if (dadosImovel.quadra) parts.push(`Quadra ${dadosImovel.quadra.trim()}`);
    if (dadosImovel.lote) parts.push(`Lote ${dadosImovel.lote.trim()}`);
    const ref = parts.length > 0 ? `do lote (${parts.join(', ')})` : 'do lote';
    return `Levantamento topografico de campo para implantacao fisica dos vertices definidos `
      + `em projeto e materializacao da poligonal ${ref} no terreno, conforme NBR 13133 (ABNT).`;
  }
  return FINALIDADE_DEMARCACAO_TEXTOS_LEGADO[finalidade];
}

/** v3.40.0: formatador uniforme do perimetro — sempre 2 casas decimais (fixed).
 *  Evita o bug 2.190,78 vs 2.190,79 (renderizacoes inconsistentes em pontos
 *  diferentes do PDF / front).
 */
export function formatarPerimetroBr(perimetroM: number): string {
  return Number(perimetroM).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
