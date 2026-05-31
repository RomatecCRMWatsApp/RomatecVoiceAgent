// v3.49.6: PDF-B — Lista de Materiais Arquitetonico (Quantitativo Executivo SINAPI).
import type { ResultadoArquitetonico, MaterialItem } from './arquitetonicoCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_ALERTA, COR_SUAVE, COR_TEXTO,
  type LinhaTabela,
} from './hidraulicoPdfShared';

export interface QuantitativoPdfResult { buffer: Buffer; filename: string; }

const CRITERIOS_ACEITACAO = [
  'Revestimentos ceramicos/porcelanato com PEI e classe de absorcao conforme uso (NBR 13818).',
  'Tintas com selo de qualidade e rendimento declarado; demaos conforme fabricante.',
  'Esquadrias com ensaio de estanqueidade e desempenho (NBR 10821).',
  'Loucas e metais com certificacao INMETRO.',
  'Quantitativos referenciados na tabela SINAPI vigente, com perdas incorporadas.',
];

function colsItem() {
  return [
    { label: 'ITEM', width: 45, align: 'center' as const },
    { label: 'DESCRICAO', width: 295 },
    { label: 'UNID.', width: 50, align: 'center' as const },
    { label: 'QTD.', width: CONTENT_W - 390, align: 'right' as const },
  ];
}
function grupo(h: ReturnType<typeof createDoc>, item: number, titulo: string, itens: MaterialItem[], subtotalLabel: string) {
  subTitle(h, titulo);
  if (itens.length === 0) { paragrafo(h, 'Nao aplicavel para a configuracao informada.'); return 0; }
  let i = 1;
  const linhas: LinhaTabela[] = itens.map((m) => ({ celulas: [`${item}.${i++}`, m.descricao, m.unidade, fmt(m.qtd, 0)] }));
  const tot = itens.reduce((s, m) => s + m.qtd, 0);
  linhas.push({ celulas: ['', subtotalLabel, '-', fmt(tot, 0)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhas);
  return tot;
}

export async function gerarPdfQuantitativoArquitetonico(r: ResultadoArquitetonico, opts?: { data?: Date }): Promise<QuantitativoPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra;
  const meta = {
    tipoDocCurto: 'Lista de Materiais Arquitetonico',
    docNome: 'Lista de Materiais - Quantitativo Arquitetonico',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;
  const m = r.materiais;

  // CAPA
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('LISTA DE MATERIAIS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('QUANTITATIVO EXECUTIVO - ACABAMENTOS / ARQUITETURA', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Referencia tabela SINAPI - perdas incorporadas', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold').text(`REVISAO 01 - Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Padrao', r.dadosUso.padraoAcabamento] },
    { celulas: ['Data de emissao', dataCurta(data)] },
  ]);

  // 1. APRESENTACAO
  doc.addPage();
  sectionTitle(h, '1. Apresentacao');
  paragrafo(h, 'Lista de materiais de acabamento e arquitetura, organizada em 6 grupos: pisos, revestimentos de parede, forro e pintura, esquadrias, cobertura, e loucas e metais. Quantitativos referenciados na tabela SINAPI, com coeficientes de perda por padrao de acabamento incorporados.');

  // 2. QUANTITATIVO POR GRUPO
  sectionTitle(h, '2. Quantitativo por grupo');
  const t1 = grupo(h, 1, '2.1 Grupo 1: Pisos e contrapiso', m.pisos, 'SUBTOTAL PISOS');
  const t2 = grupo(h, 2, '2.2 Grupo 2: Revestimentos de parede', m.paredes_revestimento, 'SUBTOTAL PAREDES (m2)');
  const t3 = grupo(h, 3, '2.3 Grupo 3: Forro e pintura', m.forro_pintura, 'SUBTOTAL FORRO E PINTURA');
  const t4 = grupo(h, 4, '2.4 Grupo 4: Esquadrias', m.esquadrias, 'SUBTOTAL ESQUADRIAS');
  const t5 = grupo(h, 5, '2.5 Grupo 5: Cobertura', m.cobertura, 'SUBTOTAL COBERTURA');
  const t6 = grupo(h, 6, '2.6 Grupo 6: Loucas e metais', m.loucas_metais, 'SUBTOTAL LOUCAS E METAIS');

  // 3. RESUMO
  sectionTitle(h, '3. Resumo geral consolidado');
  tabela(h, [
    { label: 'GRUPO', width: 60, align: 'center' }, { label: 'DESCRICAO', width: 300 },
    { label: 'UNID.', width: 60, align: 'center' }, { label: 'QUANTIDADE', width: CONTENT_W - 420, align: 'right' },
  ], [
    { celulas: ['1', 'Pisos e contrapiso', 'm2/m', fmt(t1, 0)] },
    { celulas: ['2', 'Revestimentos de parede', 'm2', fmt(t2, 0)] },
    { celulas: ['3', 'Forro e pintura', 'm2/L', fmt(t3, 0)] },
    { celulas: ['4', 'Esquadrias', 'un/cj', fmt(t4, 0)] },
    { celulas: ['5', 'Cobertura', 'm2/m', fmt(t5, 0)] },
    { celulas: ['6', 'Loucas e metais', 'un/cj', fmt(t6, 0)] },
  ]);

  // 4. CRITERIOS
  sectionTitle(h, '4. Criterios de aceitacao e recebimento');
  bullets(h, CRITERIOS_ACEITACAO);

  // 5. CONCLUSAO
  sectionTitle(h, '5. Conclusao');
  paragrafo(h, `O quantitativo totaliza ${fmt(r.totais.areaPisoM2, 0)} m2 de piso, ${fmt(r.totais.areaPinturaM2, 0)} m2 de area pintada, ${r.totais.nEsquadrias} esquadrias e o conjunto de loucas e metais, alem da cobertura. Os quantitativos, referenciados na tabela SINAPI, constituem base para orcamento e aquisicao dos servicos de acabamento.`);

  sectionTitle(h, '6. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Lista_Materiais_Arquitetonico_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
