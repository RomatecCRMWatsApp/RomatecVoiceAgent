// v3.49.5: PDF-B — Lista de Materiais Estrutural (Quantitativo Executivo).
import type { ResultadoEstrutural, MaterialItem } from './estruturalCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_ALERTA, COR_SUAVE, COR_TEXTO,
  type LinhaTabela,
} from './hidraulicoPdfShared';

export interface QuantitativoPdfResult { buffer: Buffer; filename: string; }

const CRITERIOS_ACEITACAO = [
  'Concreto usinado com nota de entrega indicando fck, slump e volume (NBR 7212).',
  'Corpos de prova moldados e rompidos conforme NBR 5738/5739.',
  'Aco CA-50/CA-60 com certificado do fabricante e ensaio de dobramento.',
  'Formas niveladas, estanques e tratadas com desmoldante antes da concretagem.',
  'Espacadores garantindo o cobrimento nominal de projeto.',
];

function colsItem() {
  return [
    { label: 'ITEM', width: 45, align: 'center' as const },
    { label: 'DESCRICAO', width: 290 },
    { label: 'UNID.', width: 50, align: 'center' as const },
    { label: 'QTD.', width: CONTENT_W - 385, align: 'right' as const },
  ];
}
function grupo(h: ReturnType<typeof createDoc>, item: number, titulo: string, itens: MaterialItem[], subtotalLabel: string) {
  subTitle(h, titulo);
  if (itens.length === 0) { paragrafo(h, 'Nao aplicavel para a configuracao informada.'); return 0; }
  let i = 1;
  const linhas: LinhaTabela[] = itens.map((m) => ({ celulas: [`${item}.${i++}`, m.descricao, m.unidade, fmt(m.qtd, m.unidade === 'm3' ? 2 : 0)] }));
  const tot = itens.reduce((s, m) => s + m.qtd, 0);
  linhas.push({ celulas: ['', subtotalLabel, '-', fmt(tot, 0)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhas);
  return tot;
}

export async function gerarPdfQuantitativoEstrutural(r: ResultadoEstrutural, opts?: { data?: Date }): Promise<QuantitativoPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra;
  const meta = {
    tipoDocCurto: 'Lista de Materiais NBR 6118',
    docNome: 'Lista de Materiais - Quantitativo Estrutural',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;
  const m = r.materiais;

  // CAPA
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('LISTA DE MATERIAIS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('QUANTITATIVO EXECUTIVO - ESTRUTURA DE CONCRETO ARMADO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Conforme ABNT NBR 6118:2014 e NBR 14931:2004', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold').text(`REVISAO 01 - Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Concreto', `${r.saida.concreto.classe} (fck ${r.saida.concreto.fck_mpa} MPa)`] },
    { celulas: ['Data de emissao', dataCurta(data)] },
  ]);

  // 1. APRESENTACAO
  doc.addPage();
  sectionTitle(h, '1. Apresentacao');
  paragrafo(h, 'Lista de materiais da estrutura de concreto armado, organizada em 6 grupos: concreto, aco, formas e escoramento, fundacao, vedacao e insumos. Quantitativos derivados do pre-dimensionamento parametrico (NBR 6118), com margem para perdas. Os volumes devem ser confirmados pelo projeto estrutural executivo.');

  // 2. QUANTITATIVO POR GRUPO
  sectionTitle(h, '2. Quantitativo por grupo');
  const t1 = grupo(h, 1, '2.1 Grupo 1: Concreto', m.concreto, 'SUBTOTAL CONCRETO (m3)');
  const t2 = grupo(h, 2, '2.2 Grupo 2: Aco', m.aco, 'SUBTOTAL ACO (kg)');
  const t3 = grupo(h, 3, '2.3 Grupo 3: Formas e escoramento', m.formas, 'SUBTOTAL FORMAS');
  const t4 = grupo(h, 4, '2.4 Grupo 4: Fundacao', m.fundacao, 'SUBTOTAL FUNDACAO');
  const t5 = grupo(h, 5, '2.5 Grupo 5: Vedacao', m.vedacao, 'SUBTOTAL VEDACAO');
  const t6 = grupo(h, 6, '2.6 Grupo 6: Insumos', m.insumos, 'SUBTOTAL INSUMOS');

  // 3. RESUMO
  sectionTitle(h, '3. Resumo geral consolidado');
  tabela(h, [
    { label: 'GRUPO', width: 60, align: 'center' }, { label: 'DESCRICAO', width: 300 },
    { label: 'UNID.', width: 60, align: 'center' }, { label: 'QUANTIDADE', width: CONTENT_W - 420, align: 'right' },
  ], [
    { celulas: ['1', 'Concreto', 'm3', fmt(r.totais.volumeConcretoM3, 2)] },
    { celulas: ['2', 'Aco CA-50/CA-60', 'kg', fmt(r.totais.pesoAcoKg, 0)] },
    { celulas: ['3', 'Formas e escoramento', 'm2', fmt(r.totais.areaFormasM2, 0)] },
    { celulas: ['4', 'Fundacao', 'un/m3', fmt(t4, 0)] },
    { celulas: ['5', 'Vedacao', 'un/m', fmt(t5, 0)] },
    { celulas: ['6', 'Insumos', 'sc/un', fmt(t6, 0)] },
  ]);

  // 4. CRITERIOS
  sectionTitle(h, '4. Criterios de aceitacao e recebimento');
  bullets(h, CRITERIOS_ACEITACAO);

  // 5. CONCLUSAO
  sectionTitle(h, '5. Conclusao');
  paragrafo(h, `O quantitativo totaliza ${fmt(r.totais.volumeConcretoM3, 2)} m3 de concreto ${r.saida.concreto.classe}, ${fmt(r.totais.pesoAcoKg, 0)} kg de aco, ${fmt(r.totais.areaFormasM2, 0)} m2 de formas, alem da fundacao, vedacao e insumos. Os quantitativos constituem base para orcamento e aquisicao, devendo ser confirmados pelo projeto estrutural executivo (NBR 6118).`);

  sectionTitle(h, '6. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Lista_Materiais_Estrutural_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
