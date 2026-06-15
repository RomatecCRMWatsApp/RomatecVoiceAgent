// v3.49.3: PDF-B — Lista de Materiais Eletrico (Quantitativo Executivo).
// v3.66.0: 6 grupos ROMATEC + margem de perdas + grupo caixas separado.
import type { ResultadoEletrico, MaterialItem } from './eletricoCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_ALERTA, COR_SUAVE, COR_TEXTO,
  type LinhaTabela,
} from './hidraulicoPdfShared';

export interface QuantitativoPdfResult { buffer: Buffer; filename: string; }

const CRITERIOS_ACEITACAO = [
  'Nota fiscal com discriminacao por item, bitola e classe de isolacao.',
  'Condutores com selo de conformidade INMETRO e classe 750V (NBR NM 247).',
  'Disjuntores e DR com certificacao IEC/INMETRO.',
  'Eletrodutos antichamas conforme NBR 15465.',
  'Inspecao visual e ensaio de continuidade/isolacao conforme NBR 5410 item 7.',
];

const MARGEM_PERDAS = [
  'Eletrodutos: acrescer 10% sobre o quantitativo calculado.',
  'Caixas de embutir: acrescer 5% (arredondando para cima).',
  'Disjuntores, QD e IDR/DR: sem margem adicional (quantidades exatas de projeto).',
  'Interruptores e tomadas (pontos): acrescer 5% por quebra em obra.',
  'Condutores: acrescer 10% (ja incluso nos quantitativos desta lista).',
];

function colsItem() {
  return [
    { label: 'ITEM', width: 45, align: 'center' as const },
    { label: 'DESCRICAO', width: 280 },
    { label: 'ESPEC.', width: 80 },
    { label: 'UNID.', width: 45, align: 'center' as const },
    { label: 'QTD.', width: CONTENT_W - 450, align: 'right' as const },
  ];
}

/**
 * Renders one material group as a subTitle + tabela.
 * Safe with empty `itens` — renders a single "sem itens" row without crashing.
 * Returns the numeric subtotal (0 for empty groups).
 */
function grupo(
  h: ReturnType<typeof createDoc>,
  item: number,
  titulo: string,
  itens: MaterialItem[],
  subtotalLabel: string,
  subtotalUnidade: string = 'un',
): number {
  subTitle(h, titulo);
  let i = 1;
  const linhas: LinhaTabela[] = itens.length > 0
    ? itens.map((m) => ({ celulas: [`${item}.${i++}`, m.descricao, '-', m.unidade, fmt(m.qtd, 0)] }))
    : [{ celulas: [`${item}.1`, '(sem itens neste grupo)', '-', '-', '0'] }];

  const tot = itens.reduce((s, m) => s + m.qtd, 0);
  linhas.push({ celulas: ['', subtotalLabel, '', subtotalUnidade, fmt(tot, 0)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhas);
  return tot;
}

export async function gerarPdfQuantitativoEletrico(r: ResultadoEletrico, opts?: { data?: Date }): Promise<QuantitativoPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra;
  const meta = {
    tipoDocCurto: 'Lista de Materiais NBR 5410',
    docNome: 'Lista de Materiais - Quantitativo Eletrico',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;
  const m = r.materiais;

  // ── CAPA ──────────────────────────────────────────────────────────────────
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('LISTA DE MATERIAIS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('QUANTITATIVO EXECUTIVO - INSTALACOES ELETRICAS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Conforme ABNT NBR 5410:2004 e NBR 15465', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold').text(`REVISAO 01 - Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Data de emissao', dataCurta(data)] },
  ]);

  // ── 1. APRESENTACAO ───────────────────────────────────────────────────────
  doc.addPage();
  sectionTitle(h, '1. Apresentacao');
  paragrafo(h, 'Lista de materiais da instalacao eletrica de baixa tensao, organizada em 6 grupos segundo o modelo de referencia ROMATEC: (1) Eletrodutos, (2) Caixas de embutir, (3) Disjuntores e protecao, (4) Quadro de distribuicao e aterramento, (5) Interruptores e tomadas / pontos, (6) Condutores por secao. Os quantitativos de condutores e eletrodutos ja incluem margem de 10% para perdas em obra; ver secao de margem de perdas para os demais itens.');

  // ── 2. QUANTITATIVO POR GRUPO (6 grupos ROMATEC) ─────────────────────────
  sectionTitle(h, '2. Quantitativo por grupo');

  // Grupo 1: Eletrodutos (m)
  const t1 = grupo(h, 1, '2.1 Grupo 1: Eletrodutos (m)', m.eletrodutos, 'SUBTOTAL ELETRODUTOS', 'm');

  // Grupo 2: Caixas de embutir (un)
  const t2 = grupo(h, 2, '2.2 Grupo 2: Caixas de embutir (un)', m.caixas, 'SUBTOTAL CAIXAS', 'un');

  // Grupo 3: Disjuntores e protecao (un)
  const t3 = grupo(h, 3, '2.3 Grupo 3: Disjuntores e protecao (un)', m.protecao, 'SUBTOTAL PROTECAO', 'un');

  // Grupo 4: Quadro de distribuicao e aterramento (un/cj)
  const t4 = grupo(h, 4, '2.4 Grupo 4: Quadro de distribuicao e aterramento (un/cj)', m.quadros, 'SUBTOTAL QUADRO E ATERRAMENTO', 'un/cj');

  // Grupo 5: Interruptores e tomadas / pontos (un)
  const t5 = grupo(h, 5, '2.5 Grupo 5: Interruptores e tomadas / pontos (un)', m.pontos, 'SUBTOTAL PONTOS', 'un');

  // Grupo 6: Condutores por secao (m)
  const t6 = grupo(h, 6, '2.6 Grupo 6: Condutores por secao (m)', m.condutores, 'SUBTOTAL CONDUTORES', 'm');

  // ── 3. RESUMO GERAL CONSOLIDADO ───────────────────────────────────────────
  sectionTitle(h, '3. Resumo geral consolidado');
  tabela(h, [
    { label: 'GRUPO', width: 60, align: 'center' as const },
    { label: 'DESCRICAO', width: 300 },
    { label: 'UNID.', width: 60, align: 'center' as const },
    { label: 'QUANTIDADE', width: CONTENT_W - 420, align: 'right' as const },
  ], [
    { celulas: ['1', 'Eletrodutos', 'm', fmt(t1, 0)] },
    { celulas: ['2', 'Caixas de embutir', 'un', fmt(t2, 0)] },
    { celulas: ['3', 'Disjuntores e protecao', 'un', fmt(t3, 0)] },
    { celulas: ['4', 'Quadro de distribuicao e aterramento', 'un/cj', fmt(t4, 0)] },
    { celulas: ['5', 'Interruptores e tomadas / pontos', 'un', fmt(t5, 0)] },
    { celulas: ['6', 'Condutores por secao', 'm', fmt(t6, 0)] },
    { celulas: ['', 'TOTAL GERAL DE ITENS', '', fmt(t1 + t2 + t3 + t4 + t5 + t6, 0)], negrito: true, fundo: COR_ALERTA },
  ]);

  // ── 4. MARGEM DE PERDAS ───────────────────────────────────────────────────
  sectionTitle(h, '4. Margem de perdas recomendada');
  bullets(h, MARGEM_PERDAS);

  // ── 5. CRITERIOS ──────────────────────────────────────────────────────────
  sectionTitle(h, '5. Criterios de aceitacao e recebimento');
  bullets(h, CRITERIOS_ACEITACAO);

  // ── 6. CONCLUSAO ──────────────────────────────────────────────────────────
  sectionTitle(h, '6. Conclusao');
  paragrafo(h, `O quantitativo totaliza ${fmt(t6, 0)} m de condutores (grupo 6), ${fmt(t1, 0)} m de eletrodutos (grupo 1), ${fmt(t2, 0)} caixas de embutir (grupo 2), ${fmt(t3, 0)} dispositivos de protecao (grupo 3), ${fmt(t4, 0)} itens de quadro e aterramento (grupo 4) e ${fmt(t5, 0)} pontos de interruptores/tomadas (grupo 5). Os quantitativos constituem a base para aquisicao e execucao da instalacao eletrica, conforme a ABNT NBR 5410:2004.`);

  sectionTitle(h, '7. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Lista_Materiais_Eletrico_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
