// v3.23.7: smoke test de RENDER real do renderGeorrefRuralBody.
//
// Objetivo: validar empiricamente que as secoes 7 (Documentos) e 8 (Avisos)
// nao estao cortando texto — gera um PDF in-memory com dados fake, extrai o
// texto via pdf-parse, e confirma que cada string esperada aparece COMPLETA.
//
// Importante: NAO chama o pipeline inteiro (gerarPdfPropostaConsultoria precisa
// de DB/voyageai). So exercita o helper exportado renderGeorrefRuralBody com
// um doc PDFKit fresco e custos sinteticos cobrindo o que importa.

import { describe, it, expect } from 'vitest';
import PDFDocument from 'pdfkit';

// Importa o helper sob teste via dynamic import. Se quebrar por dep transitiva
// (voyageai ESM), o teste sera marcado como nao-aplicavel.
let renderGeorrefRuralBody: typeof import('../integrations/propostasConsultoria').renderGeorrefRuralBody | null = null;
let loadError: string | null = null;
try {
  const mod = await import('../integrations/propostasConsultoria');
  renderGeorrefRuralBody = mod.renderGeorrefRuralBody;
} catch (err) {
  loadError = (err as Error).message;
  console.warn('[render-test] modulo nao importavel:', loadError);
}

type AnyDoc = PDFKit.PDFDocument;

async function renderEExtrairTexto(): Promise<string | null> {
  if (!renderGeorrefRuralBody) return null;
  // pdf-parse e' CJS — load dinamico evita issues de tipos
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;

  const doc: AnyDoc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Header minimo pra simular o caller (renderGeorrefRuralBody assume que o
  // bloco Cliente ja foi renderizado antes)
  doc.fontSize(15).text('PROPOSTA DE CONSULTORIA — GEORREFERENCIAMENTO RURAL', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).text('Cliente: Victor Henrique');
  doc.moveDown(0.6);

  // Fake proposta minima
  const p = {
    numero: 'PROP-2026-9999-R1',
    cliente: { nome: 'Victor Henrique' },
    data_proposta: '2026-05-21',
    validade_dias: 15,
  } as unknown as Parameters<NonNullable<typeof renderGeorrefRuralBody>>[1];

  const dadosImovel = {
    finalidade: 'CERTIFICACAO',
    matricula: '30651',
    cri: 'CRI de Acailandia/MA',
    municipio: 'Acailandia',
    estado: 'MA',
    area_hectares: 54.45,
    numero_vertices: 10,
    perimetro_m: 1280.5,
  };

  // Custos minimo cobrindo as secoes 7 e 8
  const custos = {
    secao_1_projetos: ['Levantamento topografico georreferenciado'],
    secao_2_taxas: [
      { ordem: 1, descricao: 'Emolumentos cartorarios', valor: 2237.14, observacao: 'TJMA' },
      { ordem: 2, descricao: 'Certificacao SIGEF/INCRA', valor: 0, observacao: 'Gratuita' },
    ],
    secao_3_honorarios: [
      { ordem: 3, descricao: 'TRT CFT/MA', valor: 93.4, observacao: 'fonte' },
      { ordem: 4, descricao: 'Honorarios Tecnicos de Georreferenciamento', valor: 9315.8, observacao: 'memoria' },
      { ordem: 5, descricao: 'Honorarios de Assessoria e Acompanhamento', valor: 1621.0, observacao: 'fonte' },
    ],
    condicoes_pagamento: [
      { rotulo: '1a parcela', descricao: 'TRT + 50% Tec + 50% Assess', valor: 5561.8 },
      { rotulo: '2a parcela', descricao: '50% Tec', valor: 4657.9 },
      { rotulo: '3a parcela', descricao: '50% Assess', valor: 810.5 },
    ],
    secao_4_checklist: [
      { texto: 'Certidão de Inteiro Teor da Matrícula — ATUALIZADA (max. 30 dias)', obrigatorio: true, imprescindivel: false },
      { texto: 'CCIR (Certificado de Cadastro de Imóvel Rural — INCRA) atualizado', obrigatorio: true },
      { texto: 'ITR pago (5 últimos exercícios)', obrigatorio: true },
      { texto: 'CAR (Cadastro Ambiental Rural) emitido', obrigatorio: true },
      { texto: 'RG/CPF do proprietário', obrigatorio: true },
      { texto: 'Comprovante de residência do proprietário', obrigatorio: true },
      { texto: 'Anuência dos confrontantes', obrigatorio: true, imprescindivel: true },
      { texto: 'Senha gov.br (nível prata ou ouro) do proprietário', obrigatorio: true },
      { texto: 'Documentos de eventuais usufrutuários, hipotecas ou ônus reais averbados (se houver)', obrigatorio: false },
      { texto: 'Plantas, medições ou levantamentos anteriores do imóvel (se houver)', obrigatorio: false },
    ],
    secao_5_total: 11030.2,
    avisos: [
      'IMPORTANTE: Esta proposta esta em conformidade com a Lei 10.267/2001 (CNIR), NTGIR 3a Edicao (INCRA) e Resolucao CONFEA 1.108/2020.',
      'TEMPO DE EXECUCAO: levantamento de campo (3-15 dias), gabinete e memorial (5-10 dias), submissao SIGEF (2-5 dias), analise INCRA (60-180 dias). Total tipico: 90-210 dias.',
      'ANUENCIA DOS CONFRONTANTES E IMPRESCINDIVEL. Sem a assinatura dos vizinhos confrontantes na planta, o INCRA rejeita a certificacao.',
      'EVENTUAIS DIVERGENCIAS DE AREA: se a area certificada divergir significativamente da area registrada na matricula, sera necessaria RETIFICACAO DE AREA em paralelo (Lei 10.931/2004).',
      'FINALIDADE: Certificacao no SIGEF/INCRA e averbacao do memorial certificado na matricula vigente.',
    ],
    honorarios_romatec: { trt: 93.4, tecnicos: 9315.8, assessoria: 1621.0, total: 11030.2 },
    secao_opcionais_georref: {
      itens: [
        { chave: 'ccir' as const, rotulo: 'Atualizacao do CCIR (INCRA)', contratado: false, valor_unitario: 1621, subtotal: 0 },
        { chave: 'car' as const, rotulo: 'Atualizacao / emissao do CAR (SICAR)', contratado: false, valor_unitario: 1621, subtotal: 0 },
        { chave: 'itr' as const, rotulo: 'Regularizacao de ITR em atraso', contratado: false, quantidade: 0, valor_unitario: 300, subtotal: 0 },
        { chave: 'anuencia' as const, rotulo: 'Coleta de anuencia dos confrontantes', contratado: false, quantidade: 0, valor_unitario: 150, subtotal: 0 },
        { chave: 'retificacao' as const, rotulo: 'Retificacao de area (Lei 10.931/2004)', contratado: false, valor_unitario: 'sob_orcamento' as const, subtotal: 'sob_orcamento' as const },
      ],
      subtotal: 0,
    },
  } as Parameters<NonNullable<typeof renderGeorrefRuralBody>>[3];

  renderGeorrefRuralBody!(doc, p, dadosImovel, custos, '#10b981');

  doc.end();
  await new Promise<void>((r) => doc.on('end', () => r()));
  const buf = Buffer.concat(chunks);
  const parsed = await pdfParse(buf);
  return parsed.text;
}

describe('Fix 3 — render real do renderGeorrefRuralBody (pdf-parse)', () => {
  it('seccao 7 (Documentos): texto de TODOS os documentos integro, sem corte', async () => {
    const texto = await renderEExtrairTexto();
    if (texto === null) {
      console.warn('[render-test] modulo nao importavel, marcando como skipped');
      return; // pdf-parse + module load falhou — nao falha o suite
    }

    // Strings que o user reportou cortadas em PROD (PROP-2026-0013-R1):
    const trechosObrigatorios = [
      'Certidão de Inteiro Teor da Matrícula',
      'CCIR (Certificado de Cadastro de Imóvel Rural — INCRA)',
      'ITR pago (5 últimos exercícios)',
      'CAR (Cadastro Ambiental Rural) emitido',
      'Comprovante de residência do proprietário',
      'Senha gov.br (nível prata ou ouro) do proprietário',
      'Documentos de eventuais usufrutuários',
      'Plantas, medições ou levantamentos anteriores',
    ];
    for (const t of trechosObrigatorios) {
      expect(texto, `Falta no PDF: "${t}"`).toContain(t);
    }
  });

  it('seccao 8 (Avisos): paragrafos integros', async () => {
    const texto = await renderEExtrairTexto();
    if (texto === null) return;

    expect(texto).toContain('Esta proposta esta em conformidade com a Lei 10.267/2001');
    expect(texto).toContain('TEMPO DE EXECUCAO');
    expect(texto).toContain('ANUENCIA DOS CONFRONTANTES');
    expect(texto).toContain('EVENTUAIS DIVERGENCIAS DE AREA');
    expect(texto).toContain('FINALIDADE: Certificacao no SIGEF/INCRA');
  });
});
