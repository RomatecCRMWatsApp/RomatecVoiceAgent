// v1.57.0 — Geração de proposta comercial Romatec (DOCX).
//
// Diferente de gerar_contrato (que precisa de modelo indexado da Fase 1),
// proposta comercial usa template programático interno — não tem implicação
// jurídica (é APRESENTAÇÃO de oferta antes de fechar negócio). Sai pronta
// pra mandar pro cliente por e-mail/WhatsApp/PDF.
//
// Estrutura:
//   1. Cabeçalho institucional Romatec (logo no futuro)
//   2. Identificação do cliente
//   3. Apresentação curta da empresa
//   4. Objeto da proposta
//   5. Escopo dos serviços (lista numerada)
//   6. Investimento (valor)
//   7. Forma de pagamento
//   8. Prazo de execução
//   9. Validade da proposta
//  10. Aceite (assinatura cliente + Romatec)

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, BorderStyle,
} from 'docx';

export interface PropostaInput {
  // Cliente
  cliente_nome:        string;
  cliente_cpf_cnpj?:   string;
  cliente_endereco?:   string;
  cliente_telefone?:   string;
  cliente_email?:      string;

  // Negócio
  objeto:              string;          // 1 frase: "Avaliação de imóvel residencial em Açailândia/MA"
  escopo:              string[];        // lista de itens entregáveis
  valor_total:         number;          // BRL
  forma_pagamento?:    string;          // ex: "50% no aceite + 50% na entrega"
  prazo_execucao?:     string;          // ex: "10 dias úteis após assinatura"
  validade_dias?:      number;          // default 15
  observacoes?:        string;

  // Romatec (defaults)
  responsavel?:        string;          // ex: "José Romário — CRECI 12345-MA"
  cidade_emissao?:     string;          // default Açailândia
  uf_emissao?:         string;          // default MA
}

export interface PropostaOutput {
  arquivo_base64:      string;
  filename:            string;
  numero_proposta:     string;
  cliente:             string;
  valor_total:         number;
  validade:            string;
  preview_texto:       string;
}

const ROMATEC_INSTITUCIONAL = `A Romatec Consultoria Imobiliária atua há mais de uma década no mercado imobiliário do Maranhão, oferecendo serviços de avaliação, intermediação, gestão de obras, regularização fundiária e assessoria técnica para clientes pessoa física e jurídica. Nossa atuação principal cobre Açailândia, Imperatriz e região, com expertise reconhecida em laudos NBR 14653, georreferenciamento INCRA, contratos imobiliários e gestão executiva de projetos.`;

const COR_AMARELO_ROMATEC = 'D4A946';
const COR_TEXTO          = '1F2937';

function gerarNumeroProposta(): string {
  const d = new Date();
  const ano = d.getFullYear();
  const ms  = String(d.getMonth() + 1).padStart(2, '0');
  const ds  = String(d.getDate()).padStart(2, '0');
  const seq = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  return `PROP-${ano}${ms}${ds}-${seq}`;
}

function paragrafo(texto: string, opts?: { negrito?: boolean; tamanho?: number; alinhamento?: 'left' | 'center' | 'right' | 'justify' }): Paragraph {
  return new Paragraph({
    alignment: opts?.alinhamento === 'center' ? AlignmentType.CENTER
      : opts?.alinhamento === 'right' ? AlignmentType.RIGHT
      : opts?.alinhamento === 'justify' ? AlignmentType.JUSTIFIED
      : AlignmentType.LEFT,
    spacing:  { after: 120 },
    children: [
      new TextRun({
        text: texto,
        bold: opts?.negrito ?? false,
        size: opts?.tamanho ?? 22,
        color: COR_TEXTO,
        font:  'Calibri',
      }),
    ],
  });
}

function titulo(texto: string, nivel: HeadingLevel = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({
    heading:  nivel,
    spacing:  { before: 200, after: 100 },
    children: [
      new TextRun({
        text:  texto,
        bold:  true,
        size:  nivel === HeadingLevel.HEADING_1 ? 32 : 26,
        color: COR_AMARELO_ROMATEC,
        font:  'Calibri',
      }),
    ],
  });
}

function linhaSeparadora(): Paragraph {
  return new Paragraph({
    border: { bottom: { color: COR_AMARELO_ROMATEC, space: 1, style: BorderStyle.SINGLE, size: 6 } },
    spacing: { after: 200 },
    children: [],
  });
}

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function gerarProposta(input: PropostaInput): Promise<PropostaOutput> {
  if (!input.cliente_nome?.trim()) throw new Error('cliente_nome é obrigatório.');
  if (!input.objeto?.trim())       throw new Error('objeto é obrigatório.');
  if (!input.escopo || input.escopo.length === 0) throw new Error('escopo (lista de itens) é obrigatório.');
  if (!(input.valor_total > 0))    throw new Error('valor_total deve ser > 0.');

  const numeroProposta = gerarNumeroProposta();
  const validadeDias   = input.validade_dias ?? 15;
  const dataEmissao    = new Date();
  const dataValidade   = new Date(dataEmissao.getTime() + validadeDias * 24 * 60 * 60 * 1000);
  const dataEmissaoStr  = dataEmissao.toLocaleDateString('pt-BR');
  const dataValidadeStr = dataValidade.toLocaleDateString('pt-BR');

  const cidade = input.cidade_emissao ?? 'Açailândia';
  const uf     = input.uf_emissao ?? 'MA';

  const escopoItems = input.escopo.map((item, i) => paragrafo(`${i + 1}. ${item}`, { tamanho: 22 }));

  const doc = new Document({
    creator:  'ZAYRA — Romatec Consultoria Imobiliária',
    title:    `Proposta Comercial ${numeroProposta}`,
    subject:  input.objeto,
    sections: [{
      properties: {},
      children: [
        // Cabeçalho
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing:  { after: 0 },
          children: [
            new TextRun({
              text: 'ROMATEC',
              bold: true, size: 44, color: COR_AMARELO_ROMATEC, font: 'Calibri',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing:  { after: 100 },
          children: [
            new TextRun({
              text: 'Consultoria Imobiliária',
              size: 22, color: COR_TEXTO, font: 'Calibri',
            }),
          ],
        }),
        linhaSeparadora(),

        // Número e data
        paragrafo(`Proposta nº ${numeroProposta}`, { negrito: true, alinhamento: 'right' }),
        paragrafo(`${cidade}/${uf}, ${dataEmissaoStr}`, { alinhamento: 'right' }),

        // Destinatário
        titulo('Destinatário'),
        paragrafo(`A: ${input.cliente_nome}`, { negrito: true }),
        ...(input.cliente_cpf_cnpj ? [paragrafo(`CPF/CNPJ: ${input.cliente_cpf_cnpj}`)] : []),
        ...(input.cliente_endereco ? [paragrafo(`Endereço: ${input.cliente_endereco}`)] : []),
        ...(input.cliente_telefone ? [paragrafo(`Telefone: ${input.cliente_telefone}`)] : []),
        ...(input.cliente_email    ? [paragrafo(`E-mail: ${input.cliente_email}`)]     : []),

        // Apresentação
        titulo('Apresentação'),
        paragrafo(ROMATEC_INSTITUCIONAL, { alinhamento: 'justify' }),

        // Objeto
        titulo('Objeto da Proposta'),
        paragrafo(input.objeto, { alinhamento: 'justify' }),

        // Escopo
        titulo('Escopo dos Serviços'),
        ...escopoItems,

        // Investimento
        titulo('Investimento'),
        paragrafo(`Valor total dos serviços: ${formatBRL(input.valor_total)}`, { negrito: true, tamanho: 26 }),
        ...(input.forma_pagamento
          ? [paragrafo(''), paragrafo('Forma de pagamento:', { negrito: true }), paragrafo(input.forma_pagamento)]
          : []),

        // Prazos
        ...(input.prazo_execucao ? [
          titulo('Prazo de Execução'),
          paragrafo(input.prazo_execucao),
        ] : []),

        // Observações
        ...(input.observacoes ? [
          titulo('Observações'),
          paragrafo(input.observacoes, { alinhamento: 'justify' }),
        ] : []),

        // Validade
        titulo('Validade da Proposta'),
        paragrafo(`Esta proposta tem validade de ${validadeDias} dias, expirando em ${dataValidadeStr}. Após esta data, valores e condições estão sujeitos a recotação.`, { alinhamento: 'justify' }),

        linhaSeparadora(),

        // Aceite
        titulo('Aceite'),
        paragrafo(`Estando de acordo com os termos acima, o cliente manifesta aceite da proposta assinando abaixo. A assinatura desta proposta autoriza o início dos trabalhos conforme escopo e prazos definidos.`, { alinhamento: 'justify' }),

        new Paragraph({ spacing: { before: 400, after: 200 }, children: [] }),

        // Assinaturas
        paragrafo('_______________________________________________', { alinhamento: 'center' }),
        paragrafo(input.cliente_nome, { negrito: true, alinhamento: 'center' }),
        paragrafo('Cliente', { alinhamento: 'center' }),

        new Paragraph({ spacing: { before: 300, after: 200 }, children: [] }),

        paragrafo('_______________________________________________', { alinhamento: 'center' }),
        paragrafo(input.responsavel ?? 'José Romário — CEO Romatec', { negrito: true, alinhamento: 'center' }),
        paragrafo('Romatec Consultoria Imobiliária', { alinhamento: 'center' }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const safeNomeCliente = input.cliente_nome.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const filename = `Proposta_${numeroProposta}_${safeNomeCliente}.docx`;

  const previewLinhas = [
    `Proposta ${numeroProposta}`,
    `Cliente: ${input.cliente_nome}`,
    `Objeto: ${input.objeto}`,
    `Valor: ${formatBRL(input.valor_total)}`,
    `Validade: ${dataValidadeStr} (${validadeDias} dias)`,
    `Escopo (${input.escopo.length} itens): ${input.escopo.slice(0, 3).join('; ')}${input.escopo.length > 3 ? '...' : ''}`,
  ];

  return {
    arquivo_base64:  buffer.toString('base64'),
    filename,
    numero_proposta: numeroProposta,
    cliente:         input.cliente_nome,
    valor_total:     input.valor_total,
    validade:        dataValidadeStr,
    preview_texto:   previewLinhas.join('\n'),
  };
}
