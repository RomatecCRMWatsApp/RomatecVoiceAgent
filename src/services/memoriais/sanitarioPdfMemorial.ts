// v3.49.4: PDF-A — Memorial Descritivo e de Calculo Sanitario (NBR 8160/10844/7229).
import type { ResultadoSanitario } from './sanitarioCalculo';
import { labelAparelho } from './sanitarioCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_ALERTA, COR_SUAVE, COR_TEXTO,
  type LinhaTabela,
} from './hidraulicoPdfShared';

const NORMAS = [
  'ABNT NBR 8160:1999 - Sistemas prediais de esgoto sanitario',
  'ABNT NBR 10844:1989 - Instalacoes prediais de aguas pluviais',
  'ABNT NBR 7229:1993 - Projeto, construcao e operacao de tanques septicos',
  'ABNT NBR 13969:1997 - Tanques septicos: unidades de tratamento complementar',
  'CREDER, H. - Instalacoes Hidraulicas e Sanitarias. 6a ed. LTC',
];
const CRITERIOS_EXECUCAO = [
  'Declividade minima dos coletores conforme DN (2% ate DN 100, 1% acima).',
  'Tubo de queda com ventilacao primaria prolongada acima da cobertura.',
  'Caixa sifonada e desconector em todos os ralos de areas molhadas.',
  'Caixa de gordura a montante da rede para pias de cozinha (NBR 8160 item 5.1.6).',
  'Teste de estanqueidade nas tubulacoes antes do fechamento (NBR 8160 item 6).',
];

export interface MemorialPdfResult { buffer: Buffer; filename: string; }

export async function gerarPdfMemorialSanitario(r: ResultadoSanitario, opts?: { data?: Date }): Promise<MemorialPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra; const u = r.dadosUso; const s = r.saida;
  const meta = {
    tipoDocCurto: 'Memorial NBR 8160',
    docNome: 'Memorial Descritivo e de Calculo - Instalacoes Sanitarias',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;

  // CAPA
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('MEMORIAL DESCRITIVO E DE CALCULO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('INSTALACOES DE ESGOTO SANITARIO E AGUAS PLUVIAIS', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Conforme ABNT NBR 8160:1999 e NBR 10844:1989', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold').text(`REVISAO 01 - Compatibilizada com a Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Destino do efluente', destinoLabel(u.destinoEfluente)] },
    { celulas: ['Responsavel Tecnico', 'Jose Romario Pinto Bezerra - CFT/MA 01209185369'] },
    { celulas: ['Data de emissao', dataCurta(data)] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // 1. IDENTIFICACAO
  doc.addPage();
  sectionTitle(h, '1. Identificacao da obra e do responsavel tecnico');
  tabela(h, [{ label: 'CAMPO', width: 170 }, { label: 'DESCRICAO', width: CONTENT_W - 170 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Uso', u.tipoUso === 'residencial' ? 'Residencial unifamiliar' : 'Comercial'] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Populacao de projeto', `${u.numPessoas} pessoas`] },
    { celulas: ['Registro', 'CFT/MA 01209185369 - CNAI 031161 - CRECI/MA 4.705'] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // 2. OBJETO
  sectionTitle(h, '2. Objeto');
  paragrafo(h, `Este memorial descreve e justifica o dimensionamento das instalacoes prediais de esgoto sanitario e de aguas pluviais da edificacao ${u.tipoUso === 'residencial' ? 'residencial' : 'comercial'} situada a ${o.endereco}, ${o.municipio}/${o.uf}, de propriedade de ${o.proprietario}, com area construida de ${fmt(o.areaM2)} m2. O dimensionamento do esgoto segue o metodo das Unidades de Hunter de Contribuicao (UHC) da ABNT NBR 8160:1999, e as aguas pluviais seguem a ABNT NBR 10844:1989. ${u.destinoEfluente !== 'rede_publica' ? 'O destino final adota tanque septico e sumidouro conforme ABNT NBR 7229:1993.' : 'O efluente e lancado na rede publica coletora.'}`);

  // 3. NORMAS
  sectionTitle(h, '3. Normas e referencias tecnicas aplicaveis');
  bullets(h, NORMAS);

  // 4. ESGOTO - UHC
  sectionTitle(h, '4. Esgoto sanitario - Unidades de Hunter de Contribuicao (UHC)');
  const linhasUhc: LinhaTabela[] = s.esgoto.detalhamento_uhc.map((d) => ({
    celulas: [labelAparelho(d.tipo), String(d.qtd), String(d.uhc_unit), String(d.uhc_total)],
  }));
  linhasUhc.push({ celulas: ['SOMA TOTAL DE UHC', '', '', String(s.esgoto.soma_uhc)], negrito: true, fundo: COR_ALERTA });
  tabela(h, [
    { label: 'APARELHO', width: 230 }, { label: 'QTD', width: 60, align: 'center' },
    { label: 'UHC UNIT.', width: 90, align: 'center' }, { label: 'UHC TOTAL', width: CONTENT_W - 380, align: 'right' },
  ], linhasUhc);

  // 5. DIMENSIONAMENTO ESGOTO
  sectionTitle(h, '5. Dimensionamento da rede de esgoto');
  tabela(h, [{ label: 'TRECHO', width: 230 }, { label: 'DIMENSIONAMENTO', width: CONTENT_W - 230 }], [
    { celulas: ['Ramal de descarga primario', `DN ${s.esgoto.dimensionamento_ramais.DN_mm} mm`], negrito: true },
    { celulas: ['Tubo de queda', `DN ${s.esgoto.dimensionamento_tubo_queda.DN_mm} mm com ventilacao`] },
    { celulas: ['Coletor predial', `DN ${s.esgoto.dimensionamento_coletor_predial.DN_mm} mm - declividade min. ${fmt(s.esgoto.dimensionamento_coletor_predial.declividade_min_pct, 1)}%`] },
  ]);
  paragrafo(h, `A soma de ${s.esgoto.soma_uhc} UHC define os diametros nominais acima, em tubo de PVC serie normal para esgoto, com declividade minima e ventilacao primaria conforme NBR 8160.`);

  // 6. AGUAS PLUVIAIS
  sectionTitle(h, '6. Aguas pluviais (NBR 10844)');
  tabela(h, [{ label: 'PARAMETRO', width: 230 }, { label: 'VALOR', width: CONTENT_W - 230 }], [
    { celulas: ['Area de cobertura contribuinte', `${fmt(s.aguas_pluviais.area_contribuinte_m2)} m2`] },
    { celulas: ['Intensidade pluviometrica', `${fmt(s.aguas_pluviais.intensidade_mmh, 0)} mm/h`] },
    { celulas: ['Vazao de projeto', `${fmt(s.aguas_pluviais.vazao_projeto_Lmin)} L/min`], negrito: true },
    { celulas: ['Calha', `DN ${s.aguas_pluviais.dimensionamento_calha.DN_mm} mm (cap. ${fmt(s.aguas_pluviais.dimensionamento_calha.capacidade_Lmin, 0)} L/min) - ${s.aguas_pluviais.dimensionamento_calha.status}`] },
    { celulas: ['Condutor vertical', `${s.aguas_pluviais.dimensionamento_condutor_vertical.quantidade} un DN ${s.aguas_pluviais.dimensionamento_condutor_vertical.DN_mm} mm - ${s.aguas_pluviais.dimensionamento_condutor_vertical.status}`] },
  ]);
  paragrafo(h, `A vazao de projeto Q = (i x A) / 60 resulta em ${fmt(s.aguas_pluviais.vazao_projeto_Lmin)} L/min, atendida ${r.statusNormativo.pluvialOK ? 'pela calha e condutor especificados' : 'com ressalva de bitola (ver secao de conclusao)'}.`);

  // 7. FOSSA / SUMIDOURO
  sectionTitle(h, '7. Tratamento e destino final do efluente');
  if (s.fossa_sumidouro) {
    tabela(h, [{ label: 'PARAMETRO', width: 230 }, { label: 'VALOR', width: CONTENT_W - 230 }], [
      { celulas: ['Sistema', 'Tanque septico + sumidouro (NBR 7229)'] },
      { celulas: ['Volume camara de decantacao', `${fmt(s.fossa_sumidouro.volume_camara_decantacao_L, 0)} L`] },
      { celulas: ['Volume camara de digestao', `${fmt(s.fossa_sumidouro.volume_camara_digestao_L, 0)} L`] },
      { celulas: ['Volume total do tanque', `${fmt(s.fossa_sumidouro.volume_total_L, 0)} L`], negrito: true },
      { celulas: ['Area de infiltracao do sumidouro', `${fmt(s.fossa_sumidouro.area_sumidouro_m2)} m2`] },
    ]);
    paragrafo(h, 'O tanque septico promove a decantacao e digestao anaerobia; o efluente clarificado e encaminhado ao sumidouro para infiltracao no solo, dimensionado pela taxa de absorcao local conforme NBR 7229/13969.');
  } else {
    paragrafo(h, 'O efluente sanitario e lancado diretamente na rede publica coletora de esgoto, dispensando solucao individual de tratamento e disposicao.');
  }

  // 8. MATERIAIS
  sectionTitle(h, '8. Especificacao de materiais');
  paragrafo(h, 'A relacao quantitativa de tubulacoes, conexoes, calhas, condutores, caixas, fossa/sumidouro e insumos consta no documento complementar "Lista de Materiais (Quantitativo Executivo) - Sanitario", emitido em conjunto e vinculado a mesma prancha.');

  // 9. EXECUCAO
  sectionTitle(h, '9. Criterios de execucao e ensaio');
  bullets(h, CRITERIOS_EXECUCAO);

  // 10. CONCLUSAO
  sectionTitle(h, '10. Conclusao');
  paragrafo(h, `As instalacoes sanitarias foram dimensionadas conforme as ABNT NBR 8160:1999 e NBR 10844:1989, resultando em ${s.esgoto.soma_uhc} UHC, coletor predial DN ${s.esgoto.dimensionamento_coletor_predial.DN_mm} mm, vazao pluvial de ${fmt(s.aguas_pluviais.vazao_projeto_Lmin)} L/min com calha DN ${s.aguas_pluviais.dimensionamento_calha.DN_mm} mm${s.fossa_sumidouro ? `, e tanque septico de ${fmt(s.fossa_sumidouro.volume_total_L, 0)} L com sumidouro de ${fmt(s.fossa_sumidouro.area_sumidouro_m2)} m2` : ' com lancamento em rede publica'}. ${r.statusNormativo.pluvialOK ? 'O sistema pluvial atende as capacidades normativas.' : 'Ha ressalva no sistema pluvial conforme secao 6.'} Conclui-se que o projeto encontra-se apto a execucao conforme a normalizacao vigente.`);
  if (r.alertas.length > 0) { subTitle(h, 'Ressalvas'); bullets(h, r.alertas); }

  // 11. RESPONSABILIDADE TECNICA
  sectionTitle(h, '11. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Memorial_NBR8160_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}

function destinoLabel(d: ResultadoSanitario['dadosUso']['destinoEfluente']): string {
  switch (d) {
    case 'rede_publica': return 'Rede publica coletora';
    case 'fossa_sumidouro': return 'Tanque septico + sumidouro';
    case 'fossa_filtro_anaerobio': return 'Tanque septico + filtro anaerobio';
    case 'eta_compacta': return 'ETE compacta';
    default: return String(d);
  }
}
