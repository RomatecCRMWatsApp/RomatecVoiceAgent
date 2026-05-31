// v3.49.5: PDF-A — Memorial Descritivo e de Calculo Estrutural (NBR 6118/6120/6122).
import type { ResultadoEstrutural } from './estruturalCalculo';
import { labelFundacao, labelSolo } from './estruturalCalculo';
import {
  createDoc, sectionTitle, subTitle, paragrafo, bullets, tabela,
  assinaturaRomatec, dataPorExtenso, dataCurta, sanitizarNome, fmt,
  MARGIN, CONTENT_W, COR_VERDE, COR_AZUL, COR_ALERTA, COR_SUAVE, COR_TEXTO,
} from './hidraulicoPdfShared';

const NORMAS = [
  'ABNT NBR 6118:2014 - Projeto de estruturas de concreto - Procedimento',
  'ABNT NBR 6120:2019 - Acoes para o calculo de estruturas de edificacoes',
  'ABNT NBR 6122:2019 - Projeto e execucao de fundacoes',
  'ABNT NBR 8681:2003 - Acoes e seguranca nas estruturas',
  'ABNT NBR 14931:2004 - Execucao de estruturas de concreto',
];
const CRITERIOS_EXECUCAO = [
  'Cobrimento nominal das armaduras garantido por espacadores conforme classe de agressividade.',
  'Concreto com controle de fck por ensaio de corpos de prova (NBR 5738/5739).',
  'Adensamento mecanico (vibrador) e cura minima de 7 dias.',
  'Escoramento dimensionado e retirado conforme cronograma de desforma (NBR 14931).',
  'Recebimento de aco com certificado de qualidade do fabricante (CA-50/CA-60).',
];

export interface MemorialPdfResult { buffer: Buffer; filename: string; }

export async function gerarPdfMemorialEstrutural(r: ResultadoEstrutural, opts?: { data?: Date }): Promise<MemorialPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra; const u = r.dadosUso; const s = r.saida;
  const meta = {
    tipoDocCurto: 'Memorial NBR 6118',
    docNome: 'Memorial Descritivo e de Calculo - Estrutura de Concreto Armado',
    obra: o.titulo, proprietario: o.proprietario, data: dataCurta(data), prancha: o.prancha,
  };
  const h = createDoc(meta);
  const { doc } = h;

  // CAPA
  doc.y = 150;
  doc.fontSize(18).fillColor(COR_VERDE).font('Helvetica-Bold').text('MEMORIAL DESCRITIVO E DE CALCULO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(COR_AZUL).font('Helvetica-Bold').text('ESTRUTURA DE CONCRETO ARMADO', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.fontSize(9).fillColor(COR_SUAVE).font('Helvetica').text('Conforme ABNT NBR 6118:2014, NBR 6120:2019 e NBR 6122:2019', MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(9.5).fillColor(COR_TEXTO).font('Helvetica-Bold').text(`REVISAO 01 - Compatibilizada com a Prancha ${o.prancha}`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(8).fillColor(COR_ALERTA).font('Helvetica-Oblique').text('Pre-dimensionamento parametrico para fins de quantitativo e orientacao executiva. O projeto estrutural definitivo, com calculo e detalhamento das armaduras, deve ser elaborado e assinado por Engenheiro Civil habilitado (CREA), conforme atribuicoes legais.', MARGIN + 30, doc.y, { width: CONTENT_W - 60, align: 'center' });
  doc.moveDown(1.2);
  tabela(h, [{ label: 'CAMPO', width: 160 }, { label: 'DESCRICAO', width: CONTENT_W - 160 }], [
    { celulas: ['Obra', o.titulo] },
    { celulas: ['Endereco', `${o.endereco} - ${o.municipio}/${o.uf}`] },
    { celulas: ['Proprietario', o.proprietario] },
    { celulas: ['Area construida', `${fmt(o.areaM2)} m2`] },
    { celulas: ['Classe do concreto', `${s.concreto.classe} (fck ${s.concreto.fck_mpa} MPa)`] },
    { celulas: ['Tipo de solo', labelSolo(u.tipoSolo)] },
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
    { celulas: ['Vao medio entre pilares', `${fmt(u.vaoMedioPilaresM)} m`] },
    { celulas: ['Registro Responsavel Tecnico', 'CFT/MA 01209185369 - CNAI 031161 - CRECI/MA 4.705'] },
    { celulas: ['Prancha vinculada', o.prancha] },
  ]);

  // 2. OBJETO
  sectionTitle(h, '2. Objeto');
  paragrafo(h, `Este memorial apresenta o pre-dimensionamento parametrico da estrutura de concreto armado da edificacao ${u.tipoUso === 'residencial' ? 'residencial' : 'comercial'} situada a ${o.endereco}, ${o.municipio}/${o.uf}, de propriedade de ${o.proprietario}, com area construida de ${fmt(o.areaM2)} m2 e ${o.nPavimentos} pavimento(s). O estudo segue os criterios das ABNT NBR 6118:2014 (concreto), NBR 6120:2019 (acoes) e NBR 6122:2019 (fundacoes), fornecendo as secoes minimas, as cargas estimadas, a fundacao sugerida e os consumos de concreto e aco para fins de quantitativo executivo.`);

  // 3. NORMAS
  sectionTitle(h, '3. Normas e referencias tecnicas aplicaveis');
  bullets(h, NORMAS);

  // 4. PRE-DIMENSIONAMENTO
  sectionTitle(h, '4. Pre-dimensionamento dos elementos estruturais');
  tabela(h, [{ label: 'ELEMENTO', width: 230 }, { label: 'DIMENSIONAMENTO', width: CONTENT_W - 230 }], [
    { celulas: ['Pilar - secao minima', `${s.pre_dimensionamento.pilar_secao_min_cm.b} x ${s.pre_dimensionamento.pilar_secao_min_cm.h} cm`], negrito: true },
    { celulas: ['Pilar - area de concreto', `${fmt(s.pre_dimensionamento.pilar_area_concreto_cm2, 0)} cm2`] },
    { celulas: ['Viga - secao minima', `${s.pre_dimensionamento.viga_secao_min_cm.b} x ${s.pre_dimensionamento.viga_secao_min_cm.h} cm`] },
    { celulas: ['Viga - altura recomendada', `${fmt(s.pre_dimensionamento.viga_altura_recomendada_cm, 0)} cm (~vao/12)`] },
    { celulas: ['Laje - espessura minima', `${fmt(s.pre_dimensionamento.laje_espessura_min_cm, 0)} cm (${u.lajeTipo})`] },
  ]);

  // 5. CARGAS
  sectionTitle(h, '5. Cargas estimadas (NBR 6120)');
  tabela(h, [{ label: 'CARGA', width: 280 }, { label: 'VALOR', width: CONTENT_W - 280, align: 'right' }], [
    { celulas: ['Peso proprio da estrutura', `${fmt(s.cargas_estimadas.peso_proprio_estrutura_kn_m2)} kN/m2`] },
    { celulas: ['Carga de alvenaria', `${fmt(s.cargas_estimadas.carga_alvenaria_kn_m)} kN/m`] },
    { celulas: ['Carga acidental', `${fmt(s.cargas_estimadas.carga_acidental_kn_m2)} kN/m2`] },
    { celulas: ['Carga total por pavimento', `${fmt(s.cargas_estimadas.carga_total_pavimento_kn_m2)} kN/m2`], negrito: true },
  ]);

  // 6. FUNDACAO
  sectionTitle(h, '6. Fundacao sugerida (NBR 6122)');
  tabela(h, [{ label: 'PARAMETRO', width: 230 }, { label: 'VALOR', width: CONTENT_W - 230 }], [
    { celulas: ['Tipo de solo', labelSolo(u.tipoSolo)] },
    { celulas: ['Tensao admissivel do solo', `${fmt(s.fundacao_sugerida.tensao_admissivel_solo_kpa, 0)} kPa`] },
    { celulas: ['Tipo de fundacao', labelFundacao(s.fundacao_sugerida.tipo)], negrito: true },
    { celulas: ['Area minima de sapata', `${fmt(s.fundacao_sugerida.area_minima_sapata_m2)} m2`] },
    { celulas: ['Profundidade minima', `${fmt(s.fundacao_sugerida.profundidade_minima_m)} m`] },
  ]);
  paragrafo(h, `Para o solo ${labelSolo(u.tipoSolo).toLowerCase()} com tensao admissivel de ${fmt(s.fundacao_sugerida.tensao_admissivel_solo_kpa, 0)} kPa, indica-se ${labelFundacao(s.fundacao_sugerida.tipo).toLowerCase()}. ${u.tipoSolo === 'argiloso_mole' ? 'Recomenda-se sondagem SPT para confirmacao da capacidade de carga.' : 'A confirmacao deve ser feita por sondagem do terreno.'}`);

  // 7. CONCRETO E ACO
  sectionTitle(h, '7. Concreto e aco');
  tabela(h, [{ label: 'PARAMETRO', width: 230 }, { label: 'VALOR', width: CONTENT_W - 230 }], [
    { celulas: ['Classe / fck', `${s.concreto.classe} - ${s.concreto.fck_mpa} MPa`], negrito: true },
    { celulas: ['Cobrimento minimo', `${s.concreto.cobrimento_minimo_mm} mm`] },
    { celulas: ['Consumo estimado de concreto', `${fmt(s.concreto.consumo_estimado_m3)} m3`], negrito: true },
    { celulas: ['Taxa de aco', `${fmt(s.aco.taxa_kg_m3_concreto, 0)} kg/m3 de concreto`] },
    { celulas: ['Consumo estimado de aco', `${fmt(s.aco.consumo_estimado_kg, 0)} kg`], negrito: true },
  ]);

  // 8. MATERIAIS
  sectionTitle(h, '8. Especificacao de materiais');
  paragrafo(h, 'A relacao quantitativa de concreto, aco, formas, fundacao, vedacao e insumos consta no documento complementar "Lista de Materiais (Quantitativo Executivo) - Estrutural", emitido em conjunto e vinculado a mesma prancha.');

  // 9. EXECUCAO
  sectionTitle(h, '9. Criterios de execucao e controle');
  bullets(h, CRITERIOS_EXECUCAO);

  // 10. CONCLUSAO
  sectionTitle(h, '10. Conclusao');
  paragrafo(h, `O pre-dimensionamento estrutural resultou em pilares de ${s.pre_dimensionamento.pilar_secao_min_cm.b}x${s.pre_dimensionamento.pilar_secao_min_cm.h} cm, lajes de ${fmt(s.pre_dimensionamento.laje_espessura_min_cm, 0)} cm, fundacao do tipo ${labelFundacao(s.fundacao_sugerida.tipo).toLowerCase()}, concreto ${s.concreto.classe} e consumos estimados de ${fmt(s.concreto.consumo_estimado_m3)} m3 de concreto e ${fmt(s.aco.consumo_estimado_kg, 0)} kg de aco. ${r.statusNormativo.fckAdequado ? 'A classe de concreto atende a durabilidade requerida.' : 'Ha ressalva quanto a classe de concreto (ver ressalvas).'} O projeto estrutural executivo definitivo deve ser elaborado por Engenheiro Civil habilitado conforme a NBR 6118.`);
  if (r.alertas.length > 0) { subTitle(h, 'Ressalvas'); bullets(h, r.alertas); }

  // 11. RESPONSABILIDADE TECNICA
  sectionTitle(h, '11. Responsabilidade tecnica');
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Memorial_NBR6118_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
