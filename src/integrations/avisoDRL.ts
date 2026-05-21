// v3.23.5: aviso DRL (Declaracao de Respeito de Limite) — texto regulamentar
// obrigatorio em TODA proposta de Georreferenciamento Rural, qualquer finalidade.
//
// Fontes legais:
//   - Lei 10.267/2001 (CNIR)
//   - NTGIR 3a Edicao (INCRA) — item 4.5.1 exige DRL com firma reconhecida
//   - Provimento CNJ no 65/2017 — averbacao de georref exige anuencia
//
// Modulo standalone (zero deps externas) pra ser testavel sem arrastar voyageai/
// pdfkit/mysql. Re-exportado por propostasConsultoria.ts e usado pelo PDF.

export type FinalidadeGeorrefDRL =
  | 'CERTIFICACAO'
  | 'DESMEMBRAMENTO'
  | 'REMEMBRAMENTO'
  | 'RETIFICACAO';

export type AvisoDRLFragmento = {
  text: string;
  bold?: boolean;
  destaque?: boolean;  // pinta em vermelho titulo (#922b21)
};

export type AvisoDRLParagrafo = {
  fragmentos: AvisoDRLFragmento[];
  // 'reforco' marca o paragrafo final de RETIFICACAO
  reforco?: boolean;
};

export type AvisoDRLBloco = {
  titulo: string;
  paragrafos: AvisoDRLParagrafo[];
};

export function montarAvisoDRL(finalidade: FinalidadeGeorrefDRL): AvisoDRLBloco {
  const paragrafos: AvisoDRLParagrafo[] = [
    {
      fragmentos: [
        { text: 'A coleta das Declaracoes de Respeito de Limite (DRLs) dos confrontantes e ' },
        { text: 'OBRIGACAO LEGAL E EXCLUSIVA DO PROPRIETARIO', bold: true, destaque: true },
        { text: ' do imovel, nos termos da Lei 10.267/2001, NTGIR 3a Edicao (INCRA) e Provimento CNJ no 65/2017.' },
      ],
    },
    {
      fragmentos: [
        { text: 'A Romatec (responsavel tecnico) ' },
        { text: 'GERA', bold: true },
        { text: ' as declaracoes em formulario proprio, mas a obtencao das assinaturas dos confrontantes e o ' },
        { text: 'RECONHECIMENTO DE FIRMA EM CARTORIO', bold: true, destaque: true },
        { text: ' sao de inteira responsabilidade do contratante.' },
      ],
    },
    {
      fragmentos: [
        { text: 'Sem as DRLs devidamente assinadas e com firma reconhecida, ' },
        { text: 'o INCRA NAO CERTIFICA', bold: true, destaque: true },
        { text: ' o memorial no SIGEF e ' },
        { text: 'o cartorio NAO AVERBA', bold: true, destaque: true },
        { text: ' o georreferenciamento na matricula. O prazo de certificacao (60-180 dias) so comeca a contar apos a entrega das DRLs completas.' },
      ],
    },
  ];

  // Paragrafo extra para DESMEMBRAMENTO / REMEMBRAMENTO
  if (finalidade === 'DESMEMBRAMENTO' || finalidade === 'REMEMBRAMENTO') {
    paragrafos.push({
      fragmentos: [
        { text: 'Em operacoes de ' },
        { text: finalidade, bold: true },
        { text: ', sao exigidas DRLs de TODOS os confrontantes da poligonal resultante, inclusive dos lotes vizinhos que serao criados ou unificados.' },
      ],
    });
  }

  // Paragrafo final — RETIFICACAO ganha reforco critico; demais ganham orientacao do item 6.4
  if (finalidade === 'RETIFICACAO') {
    paragrafos.push({
      reforco: true,
      fragmentos: [
        { text: 'ATENCAO REFORCADA PARA RETIFICACAO DE AREA:', bold: true, destaque: true },
        { text: ' a ausencia de qualquer DRL impede TOTALMENTE o procedimento, seja na via administrativa (Lei 10.931/2004) ou judicial. Recomenda-se fortemente a contratacao previa do servico de coleta de anuencias (item 6.4) para evitar atrasos.' },
      ],
    });
  } else {
    paragrafos.push({
      fragmentos: [
        { text: 'Caso o proprietario deseje contratar a coleta das anuencias como servico adicional, consultar o item 6.4 desta proposta (Coleta de anuencia dos confrontantes — R$ 150,00 por confrontante).' },
      ],
    });
  }

  return {
    titulo: 'RESPONSABILIDADE DO PROPRIETARIO — DRL (DECLARACAO DE RESPEITO DE LIMITE)',
    paragrafos,
  };
}
