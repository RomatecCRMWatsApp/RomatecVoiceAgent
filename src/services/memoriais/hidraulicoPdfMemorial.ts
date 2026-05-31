// v3.49.2: PDF-A — Memorial Descritivo e de Calculo (NBR 5626:2020).
// Gera o documento de 13 secoes a partir do ResultadoCalculo do motor
// hidraulicoCalculo.ts. Padrao visual Romatec (hidraulicoPdfShared.ts).

import type { ResultadoCalculo, PontoPressao, TrechoCalculo } from './hidraulicoCalculo';
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
  COR_ERRO,
  COR_SUAVE,
  COR_TEXTO,
  type DocHandle,
  type LinhaTabela,
} from './hidraulicoPdfShared';

const NORMAS = [
  'ABNT NBR 5626:2020 - Sistemas prediais de agua fria e quente',
  'ABNT NBR 5648:2018 - Tubos e conexoes de PVC-U junta soldavel',
  'ABNT NBR 8160:1999 - Sistemas prediais de esgoto sanitario',
  'ABNT NBR 10844:1989 - Instalacoes prediais de aguas pluviais',
  'ABNT NBR 15527:2019 - Aproveitamento de agua de chuva (referencia)',
  'CREDER, H. - Instalacoes Hidraulicas e Sanitarias. 6a ed. LTC',
  'MACINTYRE, A. J. - Instalacoes Hidraulicas Prediais. 4a ed. LTC',
  'Catalogos tecnicos TIGRE - Linha PVC Soldavel Marrom Classe A',
];

const CRITERIOS_EXECUCAO = [
  'Corte dos tubos esquadrado, com remocao de rebarbas internas e externas.',
  'Lixamento leve e limpeza das superficies com solucao limpadora antes da soldagem.',
  'Aplicacao uniforme de adesivo plastico em bolsa e ponta; encaixe imediato sem giro excessivo.',
  'Tempo de cura minimo de 1 h antes do teste e 12 h antes da pressurizacao definitiva.',
  'Fixacao das tubulacoes com abracadeiras em espacamento conforme o DN.',
];

function statusSimbolo(s: string): string {
  if (s === 'OK') return 'OK';
  if (s === 'ALERTA') return 'ALERTA';
  return 'REPROVADO';
}

function corLinhaStatus(s: string): string | undefined {
  if (s === 'ALERTA') return COR_ALERTA;
  if (s === 'REPROVADO') return COR_ERRO;
  return undefined;
}

export interface MemorialPdfResult {
  buffer: Buffer;
  filename: string;
}

export async function gerarPdfMemorialHidraulico(r: ResultadoCalculo, opts?: { data?: Date }): Promise<MemorialPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra;
  const u = r.dadosUso;
  const meta = {
    tipoDocCurto: 'Memorial NBR 5626',
    docNome: 'Memorial Descritivo e de Calculo - Agua Fria',
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
    .text('MEMORIAL DESCRITIVO E DE CALCULO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold')
    .text('SISTEMA PREDIAL DE AGUA FRIA', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica')
    .text('Conforme ABNT NBR 5626:2020', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold')
    .text(`REVISAO 01 - Emissao inicial compatibilizada com a Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);

  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['No de pavimentos', String(o.nPavimentos)] },
    { celulas: ['Responsavel Tecnico', 'Jose Romario Pinto Bezerra - CFT/MA 01209185369'] },
    { celulas: ['Data de emissao', dataCurta(data)] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);
  doc.moveDown(0.8);
  subTitle(h, 'Historico de revisoes');
  tabela(h, [
    { label: 'REV', width: 50, align: 'center' },
    { label: 'DATA', width: 90, align: 'center' },
    { label: 'DESCRICAO', width: CONTENT_W - 140 },
  ], [
    { celulas: ['01', dataCurta(data), 'Emissao inicial compatibilizada com o projeto hidraulico.'] },
  ]);

  // ---- 1. IDENTIFICACAO ----
  doc.addPage();
  sectionTitle(h, '1. Identificacao da obra e do responsavel tecnico');
  const taxaOcup = o.areaLoteM2 && o.areaLoteM2 > 0 ? `${fmt((o.areaM2 / o.areaLoteM2) * 100)} %` : 'n/a';
  tabela(h, [{ label: 'CAMPO', width: 170 }, { label: 'DESCRICAO', width: CONTENT_W - 170 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Uso', u.tipoUso === 'residencial' ? 'Residencial unifamiliar' : 'Comercial'] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area do lote', o.areaLoteM2 ? `${fmt(o.areaLoteM2)} m2` : 'nao informada'] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Taxa de ocupacao', taxaOcup] },
    { celulas: ['No de pavimentos', String(o.nPavimentos)] },
    { celulas: ['Responsavel Tecnico', 'Jose Romario Pinto Bezerra'] },
    { celulas: ['Registro', 'CFT/MA 01209185369 - CNAI 031161 - CRECI/MA 4.705'] },
    { celulas: ['Data', dataCurta(data)] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // ---- 2. OBJETO ----
  sectionTitle(h, '2. Objeto');
  paragrafo(h, `O presente memorial tem por objeto descrever e justificar o dimensionamento do sistema predial de agua fria da edificacao ${u.tipoUso === 'residencial' ? 'residencial' : 'comercial'} situada a ${o.endereco}, ${o.municipio}/${o.uf}, de propriedade de ${o.proprietario}, com area construida de ${fmt(o.areaM2)} m2 e ${o.nPavimentos} pavimento(s). O sistema foi concebido em conformidade com a ABNT NBR 5626:2020, contemplando a estimativa de consumo, o dimensionamento do reservatorio, a determinacao da vazao de projeto pelo metodo dos pesos relativos, o dimensionamento dos trechos da rede de distribuicao e a verificacao das pressoes dinamica e estatica nos pontos de utilizacao.`);

  // ---- 3. NORMAS ----
  sectionTitle(h, '3. Normas e referencias tecnicas aplicaveis');
  bullets(h, NORMAS);

  // ---- 4. CONSUMO ----
  sectionTitle(h, '4. Estimativa de consumo diario');
  const cdMoradores = u.nUsuarios * u.perCapita;
  const cdCompl = u.complementares.lavagemRoupa + u.complementares.limpezaExterna;
  tabela(h, [
    { label: 'FONTE', width: 200 },
    { label: 'PARAMETRO', width: 150, align: 'center' },
    { label: 'SUBTOTAL (L/dia)', width: CONTENT_W - 350, align: 'right' },
  ], [
    { celulas: ['Consumo dos usuarios', `${u.nUsuarios} x ${fmt(u.perCapita, 0)} L`, fmt(cdMoradores, 0)] },
    { celulas: ['Lavagem de roupa (maq.+tanque)', '-', fmt(u.complementares.lavagemRoupa, 0)] },
    { celulas: ['Limpeza externa / jardim', '-', fmt(u.complementares.limpezaExterna, 0)] },
    { celulas: ['Reserva tecnica', `${fmt(u.reservaTecnicaPercent, 0)} %`, fmt(Math.round((cdMoradores + cdCompl) * u.reservaTecnicaPercent / 100), 0)] },
    { celulas: ['CONSUMO TOTAL DIARIO', '', `${fmt(r.consumoDiario, 0)} L/dia`], negrito: true, fundo: COR_ALERTA },
  ]);

  // ---- 5. RESERVATORIO ----
  sectionTitle(h, '5. Dimensionamento e configuracao do reservatorio');
  const cotaFundo = u.cotaFundoM ?? 4.0;
  tabela(h, [{ label: 'PARAMETRO', width: 230 }, { label: 'VALOR / DESCRICAO', width: CONTENT_W - 230 }], [
    { celulas: ['Consumo diario (CD)', `${fmt(r.consumoDiario, 0)} L/dia`] },
    { celulas: ['Reserva minima adotada', `2 x CD = ${fmt(r.consumoDiario * 2, 0)} L`] },
    { celulas: ['Volume comercial adotado', `${fmt(r.volumeReservatorio, 0)} L`], negrito: true },
    { celulas: ['Folga sobre o consumo', `${fmt(r.volumeReservatorio - r.consumoDiario, 0)} L`] },
    { celulas: ['Tipo', 'Reservatorio elevado em polietileno'] },
    { celulas: ['Cota de fundo (NA min.)', `${fmt(cotaFundo)} m acima do piso`] },
    { celulas: ['Dispositivos obrigatorios', 'Entrada com boia, extravasor, suspiro com tela, limpeza e saida'] },
  ]);
  paragrafo(h, `O reservatorio adotado de ${fmt(r.volumeReservatorio, 0)} litros atende ao criterio da NBR 5626:2020 (item 5.5.1), por ser superior ao consumo diario estimado de ${fmt(r.consumoDiario, 0)} litros, garantindo reserva operacional e de seguranca.`);

  // ---- 6. PESOS RELATIVOS ----
  sectionTitle(h, '6. Pesos relativos dos aparelhos sanitarios');
  const linhasPesos: LinhaTabela[] = r.aparelhos.map((a) => ({
    celulas: [labelAparelho(a.tipo), fmt(a.peso_unit), String(a.qtd), fmt(a.peso_total)],
  }));
  linhasPesos.push({ celulas: ['SOMA DOS PESOS (SP)', '', '', fmt(r.somaPesos)], negrito: true, fundo: COR_ALERTA });
  tabela(h, [
    { label: 'APARELHO', width: 220 },
    { label: 'PESO (P)', width: 90, align: 'center' },
    { label: 'QTD', width: 60, align: 'center' },
    { label: 'SP', width: CONTENT_W - 370, align: 'right' },
  ], linhasPesos);
  paragrafo(h, `A vazao de projeto e determinada pela equacao probabilistica da NBR 5626:2020 (item 5.3.1.2): Q = 0,3 x raiz(SP). Com SP = ${fmt(r.somaPesos)}, obtem-se Q = ${fmt(r.vazaoTotal_ls, 3)} L/s, equivalente a aproximadamente ${fmt(r.vazaoTotal_m3h, 2)} m3/h.`);

  // ---- 7. TRECHOS ----
  sectionTitle(h, '7. Dimensionamento dos trechos da instalacao');
  tabela(h, [
    { label: 'TRECHO', width: 170 },
    { label: 'SP', width: 50, align: 'center' },
    { label: 'Q (L/s)', width: 60, align: 'center' },
    { label: 'DN (mm)', width: 60, align: 'center' },
    { label: 'D int (mm)', width: 65, align: 'center' },
    { label: 'v (m/s)', width: 55, align: 'center' },
    { label: 'STATUS', width: CONTENT_W - 460, align: 'center' },
  ], r.trechos.map((t: TrechoCalculo) => ({
    celulas: [t.descricao, fmt(t.somaPesos), fmt(t.vazao_ls, 3), String(t.dn_mm), fmt(t.dInt_mm, 1), fmt(t.velocidade_ms, 2), statusSimbolo(t.status)],
    fundo: corLinhaStatus(t.status),
  })));
  paragrafo(h, 'Os diametros foram selecionados de modo que a velocidade do escoamento nao ultrapasse 3,0 m/s, atendendo ao item 5.3.2 da NBR 5626:2020. Transicoes de diametro sao executadas com buchas de reducao soldaveis.');

  // ---- 8. PRESSAO ----
  sectionTitle(h, '8. Verificacao de pressao dinamica e estatica');
  paragrafo(h, 'Conforme o item 5.2 da NBR 5626:2020, a pressao dinamica minima nos pontos de utilizacao e de 10 kPa (1,0 m.c.a.) e a pressao estatica maxima e de 400 kPa (40 m.c.a.). As perdas de carga foram estimadas pela formula de Fair-Whipple-Hsiao para tubos de PVC liso.');
  tabela(h, [
    { label: 'PONTO', width: 200 },
    { label: 'dh estat. (m)', width: 80, align: 'center' },
    { label: 'Perda (m)', width: 70, align: 'center' },
    { label: 'P. din. (kPa)', width: 75, align: 'center' },
    { label: 'Min. NBR', width: 60, align: 'center' },
    { label: 'STATUS', width: CONTENT_W - 485, align: 'center' },
  ], r.pontosPressao.map((p: PontoPressao) => ({
    celulas: [p.descricao, fmt(p.alturaEstatica_mca), fmt(p.perdaCarga_mca), fmt(p.pressaoDinamica_kPa, 1), `${p.minNBR_kPa}`, statusSimbolo(p.status)],
    fundo: corLinhaStatus(p.status),
  })));
  const pdOk = r.statusNormativo.pressaoDinamicaOK && r.statusNormativo.pressaoEstaticaOK;
  paragrafo(h, pdOk
    ? 'Verifica-se que todos os pontos atendem aos limites normativos de pressao dinamica minima e estatica maxima.'
    : 'ATENCAO: ha ponto(s) que nao atendem aos limites normativos de pressao. Recomenda-se revisar a cota do reservatorio e/ou os diametros dos ramais.');

  // ---- 9. REGISTROS ----
  sectionTitle(h, '9. Dispositivos de manobra (registros e valvulas)');
  tabela(h, [
    { label: 'LOCALIZACAO / FUNCAO', width: 280 },
    { label: 'TIPO', width: 120 },
    { label: 'DN', width: 50, align: 'center' },
    { label: 'QTD', width: CONTENT_W - 450, align: 'center' },
  ], [
    { celulas: ['Entrada geral (apos hidrometro)', 'Registro de gaveta', '25', '1'] },
    { celulas: ['Banheiros - ramais', 'Registro de pressao', '20', '2'] },
    { celulas: ['Cozinha / area de servico', 'Registro de gaveta', '25', '2'] },
    { celulas: ['TOTAL', '', '', String(r.totalRegistros)], negrito: true, fundo: COR_ALERTA },
  ]);
  paragrafo(h, 'Os registros de manobra foram previstos por setor, conforme o item 5.4 da NBR 5626:2020, permitindo a manutencao isolada de cada ambiente sem interrupcao do abastecimento geral.');

  // ---- 10. MATERIAIS ----
  sectionTitle(h, '10. Especificacao de materiais');
  paragrafo(h, 'A relacao quantitativa completa de tubos, conexoes, registros, reservatorio, aparelhos sanitarios e insumos consta no documento complementar "Lista de Materiais (Quantitativo Executivo)", emitido em conjunto com este memorial e vinculado a mesma prancha.');

  // ---- 11. EXECUCAO E ENSAIO ----
  sectionTitle(h, '11. Criterios de execucao e ensaio');
  bullets(h, CRITERIOS_EXECUCAO);
  paragrafo(h, 'Ensaio de estanqueidade (NBR 5626:2020, item 7.2): a instalacao deve ser submetida a pressao de prova igual a 1,5 vez a pressao maxima de servico, com valor minimo de 100 kPa, mantida por no minimo 60 minutos sem queda de pressao nem vazamentos.');

  // ---- 12. CONCLUSAO ----
  sectionTitle(h, '12. Conclusao');
  paragrafo(h, `O sistema predial de agua fria foi dimensionado conforme a ABNT NBR 5626:2020, resultando em consumo diario de ${fmt(r.consumoDiario, 0)} L, reservatorio de ${fmt(r.volumeReservatorio, 0)} L, soma de pesos de ${fmt(r.somaPesos)} e vazao de projeto de ${fmt(r.vazaoTotal_ls, 3)} L/s. As velocidades nos trechos e as pressoes nos pontos de utilizacao ${pdOk && r.statusNormativo.velocidadeOK ? 'atendem integralmente aos limites normativos' : 'foram verificadas, com ressalvas registradas na secao 8'}. Conclui-se que o projeto encontra-se apto a execucao conforme as praticas da boa tecnica e a normalizacao vigente.`);
  if (r.alertas.length > 0) {
    subTitle(h, 'Ressalvas');
    bullets(h, r.alertas);
  }

  // ---- 13. RESPONSABILIDADE TECNICA ----
  sectionTitle(h, '13. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Memorial_NBR5626_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}

function labelAparelho(tipo: string): string {
  const m: Record<string, string> = {
    bacia_caixa_acoplada: 'Bacia sanitaria (caixa acoplada)',
    bacia_valvula_descarga: 'Bacia sanitaria (valvula de descarga)',
    lavatorio: 'Lavatorio',
    chuveiro: 'Chuveiro',
    ducha_higienica: 'Ducha higienica',
    pia_cozinha: 'Pia de cozinha',
    tanque: 'Tanque',
    maquina_lavar: 'Maquina de lavar',
    torneira_geral: 'Torneira de uso geral',
    mictorio_valvula: 'Mictorio com valvula',
    banheira: 'Banheira',
  };
  return m[tipo] ?? tipo;
}
