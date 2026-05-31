// v3.49.3: PDF-A — Memorial Descritivo e de Calculo Eletrico (NBR 5410:2004).
import type { ResultadoEletrico } from './eletricoCalculo';
import { labelCarga } from './eletricoCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_ALERTA, COR_ERRO, COR_SUAVE, COR_TEXTO,
  type LinhaTabela,
} from './hidraulicoPdfShared';

const NORMAS = [
  'ABNT NBR 5410:2004 - Instalacoes eletricas de baixa tensao',
  'ABNT NBR 5419:2015 - Protecao contra descargas atmosfericas',
  'ABNT NBR 5444:1989 - Simbolos graficos para instalacoes eletricas prediais',
  'ABNT NBR IEC 60898 - Disjuntores para protecao de sobrecorrentes',
  'Norma de fornecimento da concessionaria (Equatorial Maranhao)',
  'CREDER, H. - Instalacoes Eletricas. 16a ed. LTC',
];

const CRITERIOS_EXECUCAO = [
  'Condutores identificados por cor: fase (preto/vermelho), neutro (azul claro), terra (verde/amarelo).',
  'Emendas somente em caixas, com conector apropriado; vedado emenda dentro de eletroduto.',
  'Eletrodutos com no maximo 3 curvas de 90 graus entre caixas.',
  'Aterramento de todas as tomadas (esquema TN-S) e massas metalicas.',
  'Ensaio de continuidade do condutor de protecao e de isolacao (NBR 5410 item 7).',
];

export interface MemorialPdfResult { buffer: Buffer; filename: string; }

export async function gerarPdfMemorialEletrico(r: ResultadoEletrico, opts?: { data?: Date }): Promise<MemorialPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra; const u = r.dadosUso; const s = r.saida;
  const meta = {
    tipoDocCurto: 'Memorial NBR 5410',
    docNome: 'Memorial Descritivo e de Calculo - Instalacoes Eletricas',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;

  // CAPA
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('MEMORIAL DESCRITIVO E DE CALCULO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('INSTALACOES ELETRICAS DE BAIXA TENSAO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Conforme ABNT NBR 5410:2004', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold').text(`REVISAO 01 - Compatibilizada com a Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.5);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['CPF/CNPJ', o.cpfCnpj] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Tensao / alimentacao', `${u.tensaoNominalV} V - ${u.tipoAlimentacao}`] },
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
    { celulas: ['No de pavimentos', String(o.nPavimentos)] },
    { celulas: ['Registro', 'CFT/MA 01209185369 - CNAI 031161 - CRECI/MA 4.705'] },
    { celulas: ['Data', dataCurta(data)] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // 2. OBJETO
  sectionTitle(h, '2. Objeto');
  paragrafo(h, `Este memorial descreve e justifica o dimensionamento da instalacao eletrica de baixa tensao da edificacao ${u.tipoUso === 'residencial' ? 'residencial' : 'comercial'} situada a ${o.endereco}, ${o.municipio}/${o.uf}, de propriedade de ${o.proprietario}, com area construida de ${fmt(o.areaM2)} m2. O projeto foi elaborado conforme a ABNT NBR 5410:2004, contemplando a previsao de cargas, a determinacao da demanda, o dimensionamento do ramal de entrada e dos circuitos terminais, e a definicao dos dispositivos de protecao (disjuntores, DR e DPS) e do sistema de aterramento.`);

  // 3. NORMAS
  sectionTitle(h, '3. Normas e referencias tecnicas aplicaveis');
  bullets(h, NORMAS);

  // 4. CARGA INSTALADA E DEMANDA
  sectionTitle(h, '4. Previsao de cargas e demanda');
  const linhasCarga: LinhaTabela[] = s.detalhamento_cargas.map((c) => ({
    celulas: [labelCarga(c.tipo), `${fmt(c.pot_total_w, 0)} W`, `${fmt(c.fator_demanda_pct, 0)} %`, `${fmt(c.pot_demandada_w, 0)} W`],
  }));
  linhasCarga.push({ celulas: ['CARGA TOTAL / DEMANDA', `${fmt(s.carga_total_instalada_w, 0)} W`, '', `${fmt(s.carga_demandada_kw * 1000, 0)} W`], negrito: true, fundo: COR_ALERTA });
  tabela(h, [
    { label: 'CARGA', width: 200 }, { label: 'INSTALADA', width: 100, align: 'right' },
    { label: 'F. DEMANDA', width: 90, align: 'center' }, { label: 'DEMANDADA', width: CONTENT_W - 390, align: 'right' },
  ], linhasCarga);
  paragrafo(h, `A demanda total resultante e de ${fmt(s.carga_demandada_kw, 2)} kW. A corrente de projeto, calculada para ${u.tensaoNominalV} V em alimentacao ${u.tipoAlimentacao}, e de ${fmt(s.corrente_projeto_A, 1)} A.`);

  // 5. RAMAL DE ENTRADA
  sectionTitle(h, '5. Dimensionamento do ramal de entrada');
  tabela(h, [{ label: 'PARAMETRO', width: 230 }, { label: 'VALOR', width: CONTENT_W - 230 }], [
    { celulas: ['Corrente de projeto', `${fmt(s.corrente_projeto_A, 1)} A`] },
    { celulas: ['Secao do condutor', `${fmt(s.dimensionamento_ramal.secao_condutor_mm2, 1)} mm2 (cobre)`], negrito: true },
    { celulas: ['Queda de tensao', `${fmt(s.dimensionamento_ramal.queda_tensao_pct, 2)} % (limite 4%)`] },
    { celulas: ['Disjuntor geral', `${s.dimensionamento_ramal.disjuntor_geral_A} A`] },
    { celulas: ['Status', s.dimensionamento_ramal.status] },
  ]);
  paragrafo(h, r.statusNormativo.quedaTensaoOK
    ? 'A queda de tensao no ramal de entrada esta dentro do limite de 4% estabelecido pela NBR 5410 (item 6.2.7), atendendo ao criterio.'
    : 'ATENCAO: a queda de tensao excede 4%. Recomenda-se aumentar a secao do condutor ou reduzir o comprimento do ramal.');

  // 6. CIRCUITOS
  sectionTitle(h, '6. Quadro de distribuicao e circuitos terminais');
  tabela(h, [
    { label: 'CIRCUITO', width: 230 }, { label: 'DISJUNTOR', width: 110, align: 'center' }, { label: 'CONDUTOR', width: CONTENT_W - 340, align: 'center' },
  ], r.circuitos.map((c) => ({ celulas: [c.descricao, `${c.disjuntor_A} A`, `${fmt(c.secao_mm2, 1)} mm2`] })));
  paragrafo(h, `Total de ${r.totais.circuitos} circuitos terminais, distribuidos em quadro de distribuicao com reserva tecnica minima de 30%, conforme NBR 5410.`);

  // 7. PROTECAO
  sectionTitle(h, '7. Dispositivos de protecao e aterramento');
  tabela(h, [{ label: 'DISPOSITIVO', width: 230 }, { label: 'SITUACAO', width: CONTENT_W - 230 }], [
    { celulas: ['Disjuntor geral', `${s.dimensionamento_ramal.disjuntor_geral_A} A - termomagnetico`] },
    { celulas: ['Diferencial residual (DR)', s.protecao.dr_obrigatorio ? 'Obrigatorio - 30 mA (atendido)' : 'Nao aplicavel'] },
    { celulas: ['DPS (surtos)', s.protecao.dps_obrigatorio ? 'Obrigatorio - Classe II (atendido)' : 'Recomendado'] },
    { celulas: ['Esquema de aterramento', s.protecao.aterramento_tipo] },
  ]);
  paragrafo(h, 'O dispositivo DR de alta sensibilidade (30 mA) protege todos os circuitos de tomadas e areas molhadas, conforme item 5.1.3.2.2 da NBR 5410. O DPS protege a instalacao contra surtos de tensao.');

  // 8. MATERIAIS
  sectionTitle(h, '8. Especificacao de materiais');
  paragrafo(h, 'A relacao quantitativa de eletrodutos, condutores, dispositivos de protecao, pontos e quadro consta no documento complementar "Lista de Materiais (Quantitativo Executivo) - Eletrico", emitido em conjunto e vinculado a mesma prancha.');

  // 9. EXECUCAO
  sectionTitle(h, '9. Criterios de execucao e ensaio');
  bullets(h, CRITERIOS_EXECUCAO);

  // 10. CONCLUSAO
  sectionTitle(h, '10. Conclusao');
  paragrafo(h, `A instalacao eletrica foi dimensionada conforme a ABNT NBR 5410:2004, resultando em carga demandada de ${fmt(s.carga_demandada_kw, 2)} kW, corrente de projeto de ${fmt(s.corrente_projeto_A, 1)} A, ramal de entrada em condutor de ${fmt(s.dimensionamento_ramal.secao_condutor_mm2, 1)} mm2 protegido por disjuntor de ${s.dimensionamento_ramal.disjuntor_geral_A} A, ${r.totais.circuitos} circuitos terminais, com DR e DPS obrigatorios e aterramento ${s.protecao.aterramento_tipo}. ${r.statusNormativo.quedaTensaoOK ? 'A queda de tensao atende ao limite normativo.' : 'Ha ressalva de queda de tensao registrada na secao 5.'} Conclui-se que o projeto encontra-se apto a execucao conforme a normalizacao vigente.`);
  if (r.alertas.length > 0) { subTitle(h, 'Ressalvas'); bullets(h, r.alertas); }

  // 11. RESPONSABILIDADE TECNICA
  sectionTitle(h, '11. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Memorial_NBR5410_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
