// v3.49.4: PDF-B — Lista de Materiais Sanitario (Quantitativo Executivo).
import type { ResultadoSanitario, MaterialItem } from './sanitarioCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_ALERTA, COR_SUAVE, COR_TEXTO,
  type LinhaTabela,
} from './hidraulicoPdfShared';

export interface QuantitativoPdfResult { buffer: Buffer; filename: string; }

const CRITERIOS_ACEITACAO = [
  'Tubos e conexoes PVC com selo de conformidade INMETRO (NBR 5688 / NBR 7362).',
  'Tubo de esgoto serie normal (B) para ramais e serie reforcada onde sob trafego.',
  'Caixas de inspecao com tampa removivel e fundo conformado.',
  'Anel de borracha para juntas elasticas; vedado uso de adesivo em junta de esgoto por ponta-bolsa elastica.',
  'Teste de estanqueidade (coluna de agua ou fumaca) antes do reaterro (NBR 8160 item 6).',
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
function grupo(h: ReturnType<typeof createDoc>, item: number, titulo: string, itens: MaterialItem[], subtotalLabel: string) {
  subTitle(h, titulo);
  if (itens.length === 0) { paragrafo(h, 'Nao aplicavel para a configuracao informada.'); return 0; }
  let i = 1;
  const linhas: LinhaTabela[] = itens.map((m) => ({ celulas: [`${item}.${i++}`, m.descricao, '-', m.unidade, fmt(m.qtd, 0)] }));
  const tot = itens.reduce((s, m) => s + m.qtd, 0);
  linhas.push({ celulas: ['', subtotalLabel, '', '-', fmt(tot, 0)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhas);
  return tot;
}

export async function gerarPdfQuantitativoSanitario(r: ResultadoSanitario, opts?: { data?: Date }): Promise<QuantitativoPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra;
  const meta = {
    tipoDocCurto: 'Lista de Materiais NBR 8160',
    docNome: 'Lista de Materiais - Quantitativo Sanitario',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;
  const m = r.materiais;

  // CAPA
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('LISTA DE MATERIAIS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('QUANTITATIVO EXECUTIVO - INSTALACOES SANITARIAS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Conforme ABNT NBR 8160:1999 e NBR 10844:1989', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
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
  paragrafo(h, 'Lista de materiais das instalacoes sanitarias e de aguas pluviais, organizada em 6 grupos: tubos de esgoto, conexoes, aguas pluviais, fossa/sumidouro, caixas e ralos, e insumos. Quantitativos de tubulacao incluem margem de 10% para perdas e cortes.');

  // 2. QUANTITATIVO POR GRUPO
  sectionTitle(h, '2. Quantitativo por grupo');
  const t1 = grupo(h, 1, '2.1 Grupo 1: Tubos de esgoto', m.tubos_esgoto, 'SUBTOTAL TUBOS DE ESGOTO (m)');
  const t2 = grupo(h, 2, '2.2 Grupo 2: Conexoes de esgoto', m.conexoes_esgoto, 'SUBTOTAL CONEXOES');
  const t3 = grupo(h, 3, '2.3 Grupo 3: Aguas pluviais (calhas e condutores)', m.aguas_pluviais, 'SUBTOTAL AGUAS PLUVIAIS');
  const t4 = grupo(h, 4, '2.4 Grupo 4: Fossa septica e sumidouro', m.fossa_sumidouro, 'SUBTOTAL FOSSA/SUMIDOURO');
  const t5 = grupo(h, 5, '2.5 Grupo 5: Caixas, ralos e gordura', m.caixas_ralos, 'SUBTOTAL CAIXAS E RALOS');
  const t6 = grupo(h, 6, '2.6 Grupo 6: Insumos de assentamento', m.insumos, 'SUBTOTAL INSUMOS');

  // 3. RESUMO
  sectionTitle(h, '3. Resumo geral consolidado');
  tabela(h, [
    { label: 'GRUPO', width: 60, align: 'center' }, { label: 'DESCRICAO', width: 300 },
    { label: 'UNID.', width: 60, align: 'center' }, { label: 'QUANTIDADE', width: CONTENT_W - 420, align: 'right' },
  ], [
    { celulas: ['1', 'Tubos de esgoto', 'm', fmt(t1, 0)] },
    { celulas: ['2', 'Conexoes de esgoto', 'un', fmt(t2, 0)] },
    { celulas: ['3', 'Aguas pluviais', 'm/un', fmt(t3, 0)] },
    { celulas: ['4', 'Fossa septica e sumidouro', 'cj/m2', fmt(t4, 0)] },
    { celulas: ['5', 'Caixas, ralos e gordura', 'un', fmt(t5, 0)] },
    { celulas: ['6', 'Insumos', 'sc/m3', fmt(t6, 0)] },
    { celulas: ['', 'TOTAL GERAL DE ITENS', '', fmt(t1 + t2 + t3 + t4 + t5 + t6, 0)], negrito: true, fundo: COR_ALERTA },
  ]);

  // 4. CRITERIOS
  sectionTitle(h, '4. Criterios de aceitacao e recebimento');
  bullets(h, CRITERIOS_ACEITACAO);

  // 5. CONCLUSAO
  sectionTitle(h, '5. Conclusao');
  paragrafo(h, `O quantitativo totaliza ${fmt(t1, 0)} m de tubos de esgoto, ${fmt(t2, 0)} conexoes, ${fmt(t3, 0)} itens de aguas pluviais, ${r.statusNormativo.fossaDimensionada ? 'sistema de fossa/sumidouro,' : 'lancamento em rede publica,'} ${fmt(t5, 0)} caixas e ralos, alem dos insumos de assentamento. Os quantitativos constituem a base para aquisicao e execucao das instalacoes sanitarias, conforme as ABNT NBR 8160:1999 e NBR 10844:1989.`);

  sectionTitle(h, '6. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Lista_Materiais_Sanitario_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
