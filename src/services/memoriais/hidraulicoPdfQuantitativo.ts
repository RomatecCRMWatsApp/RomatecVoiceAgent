// v3.49.2: PDF-B — Lista de Materiais (Quantitativo Executivo).
// 6 grupos de materiais + resumo consolidado + tabela de aquisicao de tubos.
// Padrao visual Romatec (hidraulicoPdfShared.ts).

import type { ResultadoCalculo } from './hidraulicoCalculo';
import { calcularInsumos } from './hidraulicoCalculo';
import {
  createDoc,
  sectionTitle,
  subTitle,
  paragrafo,
  bullets,
  tabela,
  assinaturaRomatec,
  dataPorExtenso,
  dataCurta,
  sanitizarNome,
  fmt,
  MARGIN,
  CONTENT_W,
  COR_VERDE,
  COR_AZUL,
  COR_ALERTA,
  COR_SUAVE,
  COR_TEXTO,
  type LinhaTabela,
} from './hidraulicoPdfShared';

export interface ConexaoItem {
  descricao: string;
  dn_mm?: number;
  qtd: number;
}

export interface QuantitativoPdfResult {
  buffer: Buffer;
  filename: string;
}

const CRITERIOS_ACEITACAO = [
  'Nota fiscal de origem com discriminacao por item e DN.',
  'Certificado de conformidade ABNT do fabricante (NBR 5648 para PVC soldavel).',
  'Prazo de validade vigente para adesivos e solucoes limpadoras.',
  'Inspecao visual: ausencia de trincas, rebarbas, ovalizacao ou deformacoes.',
  'Amostragem conforme ABNT NBR 5426 para lotes de conexoes.',
];

const FABRICANTES_APARELHO: Record<string, string> = {
  bacia_caixa_acoplada: 'Bacia c/ caixa acoplada - DECA / CELITE',
  bacia_valvula_descarga: 'Bacia c/ valvula - DECA / DOCOL',
  lavatorio: 'Lavatorio louca - DECA / CELITE',
  chuveiro: 'Chuveiro/ducha - LORENZETTI / FAME',
  ducha_higienica: 'Ducha higienica - DOCOL / DECA',
  pia_cozinha: 'Pia inox + torneira - TRAMONTINA / DOCOL',
  tanque: 'Tanque + torneira - DECA / MONTSERRAT',
  maquina_lavar: 'Ponto p/ maquina de lavar - torneira DOCOL',
  torneira_geral: 'Torneira de jardim/uso geral - DOCOL',
  mictorio_valvula: 'Mictorio + valvula - DECA',
  banheira: 'Banheira - JACUZZI / DECA',
};

function labelAparelho(tipo: string): string {
  return FABRICANTES_APARELHO[tipo] ?? tipo;
}

export async function gerarPdfQuantitativoHidraulico(
  r: ResultadoCalculo,
  opts?: { data?: Date; conexoes?: ConexaoItem[] },
): Promise<QuantitativoPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra;
  const meta = {
    tipoDocCurto: 'Lista de Materiais NBR 5626',
    docNome: 'Lista de Materiais - Quantitativo Executivo',
    obra: o.titulo,
    proprietario: o.proprietario,
    data: dataCurta(data),
    prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;

  // ---- CAPA ----
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold')
    .text('LISTA DE MATERIAIS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold')
    .text('QUANTITATIVO EXECUTIVO - SISTEMA DE AGUA FRIA', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica')
    .text('Conforme ABNT NBR 5626:2020 e NBR 5648:2018', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold')
    .text(`REVISAO 01 - Compatibilizada com a Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Data de emissao', dataCurta(data)] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // ---- 1. APRESENTACAO ----
  doc.addPage();
  sectionTitle(h, '1. Apresentacao');
  const temConexoes = (opts?.conexoes?.length ?? 0) > 0;
  paragrafo(h, `Esta lista de materiais foi elaborada a partir do projeto hidraulico ${temConexoes ? '(dados extraidos do modelo BIM/Revit e validados manualmente)' : '(quantitativos derivados do dimensionamento NBR 5626)'}, organizando os insumos em 6 grupos:`);
  bullets(h, [
    'Grupo 1 - Tubulacoes',
    'Grupo 2 - Conexoes',
    'Grupo 3 - Registros e valvulas',
    'Grupo 4 - Reservatorio e acessorios',
    'Grupo 5 - Aparelhos sanitarios',
    'Grupo 6 - Insumos de instalacao',
  ]);

  // ---- 2. OBSERVACOES PRELIMINARES ----
  sectionTitle(h, '2. Observacoes tecnicas preliminares');
  paragrafo(h, 'As quantidades de tubos incluem margem de 10% para perdas de corte e ajuste; as conexoes consideram margem de 5%. Todos os tubos e conexoes sao em PVC rigido soldavel, conforme NBR 5648:2018, e o conjunto atende aos requisitos da NBR 5626:2020.');

  // ---- 3. QUANTITATIVO POR GRUPO ----
  sectionTitle(h, '3. Quantitativo por grupo');

  // Grupo 1 - Tubulacoes
  subTitle(h, '3.1 Grupo 1: Tubulacoes (PVC Soldavel Marrom Classe A - TIGRE)');
  let item = 1;
  const linhasTubo: LinhaTabela[] = r.aquisicaoTubos.map((t) => ({
    celulas: [`1.${item++}`, `Tubo PVC Soldavel Marrom DN ${t.dn_mm}`, 'NBR 5648', 'm', fmt(t.total_adquirir_m, 0)],
  }));
  const totalTuboAdq = r.aquisicaoTubos.reduce((s, t) => s + t.total_adquirir_m, 0);
  linhasTubo.push({ celulas: ['', 'SUBTOTAL TUBULACOES', '', 'm', fmt(totalTuboAdq, 0)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhasTubo);

  // Grupo 2 - Conexoes
  subTitle(h, '3.2 Grupo 2: Conexoes');
  const conexoes = opts?.conexoes ?? conexoesPadrao(r);
  item = 1;
  const linhasConex: LinhaTabela[] = conexoes.map((c) => ({
    celulas: [`2.${item++}`, c.descricao, c.dn_mm ? `DN ${c.dn_mm}` : '-', 'un', fmt(c.qtd, 0)],
  }));
  const totalConex = conexoes.reduce((s, c) => s + c.qtd, 0);
  linhasConex.push({ celulas: ['', 'SUBTOTAL CONEXOES', '', 'un', fmt(totalConex, 0)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhasConex);

  // Grupo 3 - Registros e valvulas
  subTitle(h, '3.3 Grupo 3: Registros e valvulas');
  tabela(h, colsItem(), [
    { celulas: ['3.1', 'Registro de gaveta bruto (entrada geral)', 'DN 25', 'un', '1'] },
    { celulas: ['3.2', 'Registro de pressao acabamento (banheiros)', 'DN 20', 'un', '2'] },
    { celulas: ['3.3', 'Registro de gaveta (cozinha/area)', 'DN 25', 'un', '2'] },
    { celulas: ['', 'SUBTOTAL REGISTROS E VALVULAS', '', 'un', String(r.totalRegistros)], negrito: true, fundo: COR_ALERTA },
  ]);
  paragrafo(h, 'Disposicao tecnica: registros distribuidos por setor conforme item 5.4 da NBR 5626:2020, permitindo manutencao isolada de cada ambiente molhado.');

  // Grupo 4 - Reservatorio e acessorios
  subTitle(h, '3.4 Grupo 4: Reservatorio e acessorios');
  tabela(h, colsItem(), [
    { celulas: ['4.1', `Reservatorio polietileno ${fmt(r.volumeReservatorio, 0)} L`, 'FORTLEV/ACQUALIMP', 'un', '1'] },
    { celulas: ['4.2', 'Adaptador soldavel c/ flange 20x3/4" (entrada)', 'TIGRE', 'un', '1'] },
    { celulas: ['4.3', 'Adaptador soldavel c/ flange 50x1.1/2" (saida/extravasor/suspiro/limpeza)', 'TIGRE', 'un', '4'] },
    { celulas: ['4.4', 'Tubo PVC DN 50 mm (suspiro)', 'TIGRE', 'm', '1'] },
    { celulas: ['4.5', 'Tela de protecao p/ suspiro DN 50 mm', '-', 'un', '1'] },
    { celulas: ['4.6', 'Cap soldavel 50 mm (extravasor)', 'TIGRE', 'un', '1'] },
    { celulas: ['4.7', 'Base nivelada p/ reservatorio', '-', 'vb', '1'] },
    { celulas: ['', 'SUBTOTAL RESERVATORIO E ACESSORIOS', '', 'un', '9'], negrito: true, fundo: COR_ALERTA },
  ]);
  paragrafo(h, `Configuracao do reservatorio: alimentacao com torneira de boia, extravasor e limpeza independentes, suspiro com tela anti-inseto e registro de saida, atendendo aos dispositivos obrigatorios da NBR 5626:2020.`);

  // Grupo 5 - Aparelhos sanitarios
  subTitle(h, '3.5 Grupo 5: Aparelhos sanitarios');
  item = 1;
  const linhasAp: LinhaTabela[] = r.aparelhos.map((a) => ({
    celulas: [`5.${item++}`, labelAparelho(a.tipo), '-', 'un', String(a.qtd)],
  }));
  linhasAp.push({ celulas: ['', 'SUBTOTAL APARELHOS SANITARIOS', '', 'un', String(r.totalAparelhos)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhasAp);

  // Grupo 6 - Insumos
  subTitle(h, '3.6 Grupo 6: Insumos de instalacao');
  const insumos = calcularInsumos({ totalConexoes: totalConex, totalTubos_m: r.totalTubos_m, totalRegistros: r.totalRegistros });
  item = 1;
  const linhasIns: LinhaTabela[] = insumos.map((i) => ({
    celulas: [`6.${item++}`, i.descricao, '-', i.unidade, String(i.qtd)],
  }));
  const totalIns = insumos.reduce((s, i) => s + i.qtd, 0);
  linhasIns.push({ celulas: ['', 'SUBTOTAL INSUMOS', '', 'un', String(totalIns)], negrito: true, fundo: COR_ALERTA });
  tabela(h, colsItem(), linhasIns);

  // ---- 4. RESUMO GERAL ----
  sectionTitle(h, '4. Resumo geral consolidado');
  tabela(h, [
    { label: 'GRUPO', width: 60, align: 'center' },
    { label: 'DESCRICAO', width: 300 },
    { label: 'UNID.', width: 60, align: 'center' },
    { label: 'QUANTIDADE', width: CONTENT_W - 420, align: 'right' },
  ], [
    { celulas: ['1', 'Tubulacoes', 'm', fmt(totalTuboAdq, 0)] },
    { celulas: ['2', 'Conexoes', 'un', String(totalConex)] },
    { celulas: ['3', 'Registros e valvulas', 'un', String(r.totalRegistros)] },
    { celulas: ['4', 'Reservatorio e acessorios', 'un', '9'] },
    { celulas: ['5', 'Aparelhos sanitarios', 'un', String(r.totalAparelhos)] },
    { celulas: ['6', 'Insumos de instalacao', 'un', String(totalIns)] },
    { celulas: ['', 'TOTAL GERAL DE ITENS (un + m)', '', fmt(totalConex + r.totalRegistros + 9 + r.totalAparelhos + totalIns + totalTuboAdq, 0)], negrito: true, fundo: COR_ALERTA },
  ]);

  // ---- 5. MARGEM DE PERDAS + AQUISICAO ----
  sectionTitle(h, '5. Margem de perdas e tabela de aquisicao de tubos');
  bullets(h, [
    'Tubos: +10% sobre o comprimento liquido (corte e ajuste).',
    'Conexoes: +5% sobre a quantidade de projeto.',
    'Insumos: dimensionados proporcionalmente ao volume de tubos e conexoes.',
  ]);
  subTitle(h, 'Aquisicao de tubos (barras de 6 m)');
  tabela(h, [
    { label: 'TUBO', width: 90, align: 'center' },
    { label: 'QTD. LIQ. (m)', width: 100, align: 'right' },
    { label: 'QTD. +10% (m)', width: 100, align: 'right' },
    { label: 'BARRAS 6m (un)', width: 110, align: 'center' },
    { label: 'ADQUIRIR (m)', width: CONTENT_W - 400, align: 'right' },
  ], r.aquisicaoTubos.map((t) => ({
    celulas: [`DN ${t.dn_mm}`, fmt(t.qtd_liquida_m), fmt(t.qtd_com_perda_m), String(t.barras_6m), fmt(t.total_adquirir_m, 0)],
  })));

  // ---- 6. CRITERIOS DE ACEITACAO ----
  sectionTitle(h, '6. Criterios de aceitacao e recebimento');
  bullets(h, CRITERIOS_ACEITACAO);

  // ---- 7. CONCLUSAO ----
  sectionTitle(h, '7. Conclusao');
  paragrafo(h, `O presente quantitativo executivo totaliza ${fmt(totalTuboAdq, 0)} m de tubulacoes, ${totalConex} conexoes, ${r.totalRegistros} registros/valvulas, reservatorio de ${fmt(r.volumeReservatorio, 0)} L com acessorios, ${r.totalAparelhos} aparelhos sanitarios e ${totalIns} insumos de instalacao. Os quantitativos constituem a base para aquisicao e execucao do sistema predial de agua fria, em conformidade com a ABNT NBR 5626:2020.`);

  // ---- 8. RESPONSABILIDADE TECNICA ----
  sectionTitle(h, '8. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Lista_Materiais_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}

function colsItem() {
  return [
    { label: 'ITEM', width: 45, align: 'center' as const },
    { label: 'DESCRICAO', width: 250 },
    { label: 'ESPEC.', width: 110 },
    { label: 'UNID.', width: 45, align: 'center' as const },
    { label: 'QTD.', width: CONTENT_W - 450, align: 'right' as const },
  ];
}

// Conexoes representativas derivadas do projeto quando nao ha extracao do Revit.
function conexoesPadrao(r: ResultadoCalculo): ConexaoItem[] {
  const dns = r.aquisicaoTubos.map((t) => t.dn_mm);
  const base: ConexaoItem[] = [];
  for (const dn of dns) {
    base.push({ descricao: `Joelho 90 soldavel ${dn} mm`, dn_mm: dn, qtd: 6 });
    base.push({ descricao: `Te soldavel ${dn} mm`, dn_mm: dn, qtd: 4 });
    base.push({ descricao: `Luva soldavel ${dn} mm`, dn_mm: dn, qtd: 3 });
  }
  return base;
}
