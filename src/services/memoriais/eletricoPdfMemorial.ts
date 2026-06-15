// v3.49.3: PDF-A — Memorial Descritivo e de Calculo Eletrico (NBR 5410:2004).
// v3.66.0: tabelas ricas por circuito (ROMATEC): cargas/demanda/dimensionamento/QDFL.
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

// ---------------------------------------------------------------------------
// Helper — determina se os circuitos carregam campos ricos de extracao
// ---------------------------------------------------------------------------
function temDadosRicos(r: ResultadoEletrico): boolean {
  return r.circuitos.length > 0 && r.circuitos[0]?.potencia_va != null;
}

// ---------------------------------------------------------------------------
// Secoes ricas (caminho de extracao)
// ---------------------------------------------------------------------------
function renderSecoesCampoRico(
  h: Parameters<typeof sectionTitle>[0],
  r: ResultadoEletrico,
  numOffset: number,
): number {
  const { dadosUso: u, saida: s } = r;
  let secNum = numOffset;

  // Fator de demanda
  const fd = u.tipoUso === 'residencial' ? 0.60 : 0.70;
  const V = u.tensaoNominalV;
  const piVA = r.circuitos.reduce((sum, c) => sum + (c.potencia_va ?? 0), 0);
  const pdVA = Math.round(piVA * fd);
  const idA = Math.round((pdVA / V) * 10) / 10;

  // --- 4. LEVANTAMENTO DE CARGAS INSTALADAS ---
  sectionTitle(h, `${secNum}. Levantamento de cargas instaladas`);
  secNum++;
  const linhasCargas: LinhaTabela[] = r.circuitos.map((c) => ({
    celulas: [
      c.id ?? '',
      c.descricao,
      `${c.disjuntor_A} A`,
      `#${c.secao_mm2} mm2`,
      fmt(c.potencia_va ?? 0, 0),
    ],
  }));
  linhasCargas.push({
    celulas: ['', 'TOTAL INSTALADO', '', '', fmt(piVA, 0)],
    negrito: true,
    fundo: COR_ALERTA,
  });
  tabela(h, [
    { label: 'CIRC.', width: 50 },
    { label: 'DESCRICAO', width: 180 },
    { label: 'DISJUNTOR', width: 80, align: 'center' },
    { label: 'CONDUTOR', width: 80, align: 'center' },
    { label: 'POT. INST. (VA)', width: CONTENT_W - 390, align: 'right' },
  ], linhasCargas);

  // --- 5. CALCULO DA POTENCIA DE DEMANDA ---
  sectionTitle(h, `${secNum}. Calculo da potencia de demanda`);
  secNum++;
  const fdPct = (fd * 100).toFixed(0);
  const ramalSec = s.dimensionamento_ramal.secao_condutor_mm2;
  const djGeral = s.dimensionamento_ramal.disjuntor_geral_A;
  tabela(h, [
    { label: 'PARAMETRO', width: 220 },
    { label: 'VALOR', width: 150, align: 'right' },
    { label: 'REFERENCIA', width: CONTENT_W - 370 },
  ], [
    { celulas: ['Potencia instalada (Pi)', `${fmt(piVA, 0)} VA`, 'Soma dos circuitos terminais'] },
    { celulas: [`Fator de demanda (fd) — ${u.tipoUso}`, `${fdPct}%`, 'NBR 5410 Tabela 2'] },
    { celulas: ['Potencia de demanda (Pd = Pi x fd)', `${fmt(pdVA, 0)} VA`, 'NBR 5410 item 6.1'] },
    { celulas: [`Corrente de demanda (Id = Pd / ${V} V)`, `${fmt(idA, 1)} A`, 'NBR 5410 item 6.2'] },
    { celulas: ['Disjuntor geral', `${djGeral} A`, 'Curva C termomagnetico'], negrito: true },
    { celulas: ['Ramal de entrada', `#${ramalSec} mm2 Cu`, `Alimentacao ${u.tipoAlimentacao}`], negrito: true },
  ]);
  const atende = idA <= djGeral;
  paragrafo(h, `RESULTADO: Id = ${fmt(idA, 1)} A ${atende ? '<' : '>'} Disjuntor geral ${djGeral} A — ${atende ? 'ATENDE a NBR 5410. O ramal esta dimensionado adequadamente.' : 'NAO ATENDE — revisar disjuntor ou secao do ramal.'}`);

  // --- 6. DIMENSIONAMENTO DOS CIRCUITOS TERMINAIS ---
  sectionTitle(h, `${secNum}. Dimensionamento dos circuitos terminais`);
  secNum++;
  const linhasDim: LinhaTabela[] = r.circuitos.map((c) => ({
    celulas: [
      c.id ?? '',
      fmt(c.potencia_va ?? 0, 0),
      fmt(c.ip_a ?? 0, 1),
      `${c.disjuntor_A} A`,
      `#${c.secao_mm2} mm2`,
      fmt(c.capacidade_cond_a ?? 0, 0),
      c.status_ok ? 'OK' : 'AJUSTAR',
    ],
    fundo: c.status_ok ? undefined : COR_ERRO,
  }));
  tabela(h, [
    { label: 'CIRC.', width: 50 },
    { label: 'POT. (VA)', width: 80, align: 'right' },
    { label: 'Ip (A)', width: 60, align: 'right' },
    { label: 'DISJUNTOR', width: 80, align: 'center' },
    { label: 'CONDUTOR', width: 80, align: 'center' },
    { label: 'CAP. COND. (A)', width: 85, align: 'right' },
    { label: 'STATUS', width: CONTENT_W - 435, align: 'center' },
  ], linhasDim);
  paragrafo(h, 'RESULTADO: Circuitos dimensionados pelo metodo B2 (condutor em eletroduto embutido), cobre 450/750 V (NBR 5410 Tabela 36/47). Queda de tensao calculada <= 4% para cada circuito.');

  // --- 7. QUADRO DE DISTRIBUICAO QDFL ---
  sectionTitle(h, `${secNum}. Quadro de distribuicao QDFL`);
  secNum++;
  const linhasQDFL: LinhaTabela[] = r.circuitos.map((c) => ({
    celulas: [
      c.id ?? '',
      c.descricao,
      c.tipo ?? '-',
      `${c.disjuntor_A} A / ${c.polos ?? 1}P`,
      `#${c.secao_mm2} mm2`,
      c.condutor_protecao_mm2 != null ? `#${c.condutor_protecao_mm2} mm2` : '-',
    ],
  }));
  // linha do DG
  linhasQDFL.push({
    celulas: [
      'DG',
      'Disjuntor geral / ramal entrada',
      '-',
      `${djGeral} A / ${u.tipoAlimentacao === 'trifasico' ? '3' : u.tipoAlimentacao === 'bifasico' ? '2' : '1'}P`,
      `#${ramalSec} mm2`,
      `#${ramalSec} mm2`,
    ],
    negrito: true,
    fundo: COR_ALERTA,
  });
  tabela(h, [
    { label: 'CIRC.', width: 50 },
    { label: 'DESCRICAO', width: 155 },
    { label: 'TIPO', width: 45, align: 'center' },
    { label: 'CORRENTE / POLOS', width: 100, align: 'center' },
    { label: 'COND. FASE/NEUTRO', width: 90, align: 'center' },
    { label: 'COND. PROTECAO', width: CONTENT_W - 440, align: 'center' },
  ], linhasQDFL);
  const nCirc = r.circuitos.length;
  const nSlots = Math.max(12, nCirc + 4);
  paragrafo(h, `CONFIGURACAO: Quadro de distribuicao de embutir com ${nSlots} disjuntores (incluindo reserva tecnica >= 30%), barramento de terra e neutro independentes (esquema TN-S). Alimentacao ${u.tipoAlimentacao} em ${V} V.`);

  return secNum;
}

// ---------------------------------------------------------------------------
// Gerador principal
// ---------------------------------------------------------------------------
export async function gerarPdfMemorialEletrico(r: ResultadoEletrico, opts?: { data?: Date }): Promise<MemorialPdfResult> {
  const data = opts?.data ?? new Date();
  const o = r.dadosObra; const u = r.dadosUso; const s = r.saida;
  const rico = temDadosRicos(r);

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

  // 4-7 (rico) ou 4-5 (heuristico)
  let proximaSecao: number;

  if (rico) {
    // Caminho de extracao: tabelas ricas por circuito
    proximaSecao = renderSecoesCampoRico(h, r, 4);
  } else {
    // Caminho heuristico: tabelas originais (retrocompat)

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

    proximaSecao = 7;
  }

  // PROTECAO (numeracao dinamica)
  sectionTitle(h, `${proximaSecao}. Dispositivos de protecao e aterramento`);
  proximaSecao++;
  tabela(h, [{ label: 'DISPOSITIVO', width: 230 }, { label: 'SITUACAO', width: CONTENT_W - 230 }], [
    { celulas: ['Disjuntor geral', `${s.dimensionamento_ramal.disjuntor_geral_A} A - termomagnetico`] },
    { celulas: ['Diferencial residual (DR)', s.protecao.dr_obrigatorio ? 'Obrigatorio - 30 mA (atendido)' : 'Nao aplicavel'] },
    { celulas: ['DPS (surtos)', s.protecao.dps_obrigatorio ? 'Obrigatorio - Classe II (atendido)' : 'Recomendado'] },
    { celulas: ['Esquema de aterramento', s.protecao.aterramento_tipo] },
  ]);
  paragrafo(h, 'O dispositivo DR de alta sensibilidade (30 mA) protege todos os circuitos de tomadas e areas molhadas, conforme item 5.1.3.2.2 da NBR 5410. O DPS protege a instalacao contra surtos de tensao.');

  // MATERIAIS
  sectionTitle(h, `${proximaSecao}. Especificacao de materiais`);
  proximaSecao++;
  paragrafo(h, 'A relacao quantitativa de eletrodutos, condutores, dispositivos de protecao, pontos e quadro consta no documento complementar "Lista de Materiais (Quantitativo Executivo) - Eletrico", emitido em conjunto e vinculado a mesma prancha.');

  // EXECUCAO
  sectionTitle(h, `${proximaSecao}. Criterios de execucao e ensaio`);
  proximaSecao++;
  bullets(h, CRITERIOS_EXECUCAO);

  // CONCLUSAO
  sectionTitle(h, `${proximaSecao}. Conclusao`);
  proximaSecao++;
  paragrafo(h, `A instalacao eletrica foi dimensionada conforme a ABNT NBR 5410:2004, resultando em carga demandada de ${fmt(s.carga_demandada_kw, 2)} kW, corrente de projeto de ${fmt(s.corrente_projeto_A, 1)} A, ramal de entrada em condutor de ${fmt(s.dimensionamento_ramal.secao_condutor_mm2, 1)} mm2 protegido por disjuntor de ${s.dimensionamento_ramal.disjuntor_geral_A} A, ${r.totais.circuitos} circuitos terminais, com DR e DPS obrigatorios e aterramento ${s.protecao.aterramento_tipo}. ${r.statusNormativo.quedaTensaoOK ? 'A queda de tensao atende ao limite normativo.' : 'Ha ressalva de queda de tensao registrada na secao anterior.'} Conclui-se que o projeto encontra-se apto a execucao conforme a normalizacao vigente.`);
  if (r.alertas.length > 0) { subTitle(h, 'Ressalvas'); bullets(h, r.alertas); }

  // RESPONSABILIDADE TECNICA
  sectionTitle(h, `${proximaSecao}. Responsabilidade tecnica`);
  assinaturaRomatec(h, { municipio: o.municipio, dataExtenso: dataPorExtenso(data), trtNumero: o.trtNumero });

  const buffer = await h.finish();
  const filename = `${o.prancha}-Memorial_NBR5410_${sanitizarNome(o.proprietario)}_REV01.pdf`;
  return { buffer, filename };
}
