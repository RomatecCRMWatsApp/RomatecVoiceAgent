// v3.49.3: PDF-B — Lista de Materiais Eletrico (Quantitativo Executivo).
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

function grupo(h: ReturnType<typeof createDoc>, item: number, titulo: string, itens: MaterialItem[], subtotalLabel: string) {
  subTitle(h, `${titulo}`);
  let i = 1;
  const linhas: LinhaTabela[] = itens.map((m) => ({ celulas: [`${item}.${i++}`, m.descricao, '-', m.unidade, fmt(m.qtd, 0)] }));
  const tot = itens.reduce((s, m) => s + m.qtd, 0);
  linhas.push({ celulas: ['', subtotalLabel, '', 'un', fmt(tot, 0)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhas);
  return tot;
}
function colsItem() {
  return [
    { label: 'ITEM', width: 45, align: 'center' as const },
    { label: 'DESCRICAO', width: 280 },
    { label: 'ESPEC.', width: 80 },
    { label: 'UNID.', width: 45, align: 'center' as const },
    { label: 'QTD.', width: CONTENT_W - 450, align: 'right' as const },
  ];
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

  // CAPA
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

  // 1. APRESENTACAO
  doc.addPage();
  sectionTitle(h, '1. Apresentacao');
  paragrafo(h, 'Lista de materiais da instalacao eletrica de baixa tensao, organizada em 6 grupos: eletrodutos e caixas, condutores, dispositivos de protecao, pontos (luz/tomadas), quadro e aterramento, e insumos. Quantitativos incluem margem de 10% para perdas em condutores e eletrodutos.');

  // 2. QUANTITATIVO POR GRUPO
  sectionTitle(h, '2. Quantitativo por grupo');
  const t1 = grupo(h, 1, '2.1 Grupo 1: Eletrodutos e caixas', m.eletrodutos, 'SUBTOTAL ELETRODUTOS E CAIXAS');
  const t2 = grupo(h, 2, '2.2 Grupo 2: Condutores', m.condutores, 'SUBTOTAL CONDUTORES (m)');
  const t3 = grupo(h, 3, '2.3 Grupo 3: Dispositivos de protecao', m.protecao, 'SUBTOTAL PROTECAO');
  const t4 = grupo(h, 4, '2.4 Grupo 4: Pontos (luz, tomadas, interruptores)', m.pontos, 'SUBTOTAL PONTOS');
  const t5 = grupo(h, 5, '2.5 Grupo 5: Quadro de distribuicao e aterramento', m.quadros, 'SUBTOTAL QUADRO E ATERRAMENTO');
  const t6 = grupo(h, 6, '2.6 Grupo 6: Insumos de instalacao', m.insumos, 'SUBTOTAL INSUMOS');

  // 3. RESUMO
  sectionTitle(h, '3. Resumo geral consolidado');
  tabela(h, [
    { label: 'GRUPO', width: 60, align: 'center' }, { label: 'DESCRICAO', width: 300 },
    { label: 'UNID.', width: 60, align: 'center' }, { label: 'QUANTIDADE', width: CONTENT_W - 420, align: 'right' },
  ], [
    { celulas: ['1', 'Eletrodutos e caixas', 'un/m', fmt(t1, 0)] },
    { celulas: ['2', 'Condutores', 'm', fmt(t2, 0)] },
    { celulas: ['3', 'Dispositivos de protecao', 'un', fmt(t3, 0)] },
    { celulas: ['4', 'Pontos (luz/tomadas/interruptores)', 'un', fmt(t4, 0)] },
    { celulas: ['5', 'Quadro e aterramento', 'un/cj', fmt(t5, 0)] },
    { celulas: ['6', 'Insumos', 'un/vb', fmt(t6, 0)] },
    { celulas: ['', 'TOTAL GERAL DE ITENS', '', fmt(t1 + t2 + t3 + t4 + t5 + t6, 0)], negrito: true, fundo: COR_ALERTA },
  ]);

  // 4. CRITERIOS
  sectionTitle(h, '4. Criterios de aceitacao e recebimento');
  bullets(h, CRITERIOS_ACEITACAO);

  // 5. CONCLUSAO
  sectionTitle(h, '5. Conclusao');
  paragrafo(h, `O quantitativo totaliza ${fmt(t2, 0)} m de condutores, ${fmt(t1, 0)} un/m de eletrodutos e caixas, ${fmt(t3, 0)} dispositivos de protecao, ${fmt(t4, 0)} pontos, quadro de distribuicao e sistema de aterramento, alem dos insumos de instalacao. Os quantitativos constituem a base para aquisicao e execucao da instalacao eletrica, conforme a ABNT NBR 5410:2004.`);

  sectionTitle(h, '6. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Lista_Materiais_Eletrico_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
