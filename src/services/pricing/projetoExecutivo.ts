// v3.24.5: motor de calculo de Projeto Executivo (arquitetonico + complementares).
//
// Regra de negocio:
//   Valor projetos = area_construir × valor_m2 (default R$ 25/m²)
//   ART/TRT auto por area: > 80m² -> ART | <= 80m² -> TRT
//   ART exige profissional CREA (Romatec subcontrata por aditivo);
//   TRT pode ser emitida diretamente pelo Jose Romario (Tec. Edificacoes).
//   Alvara e Placa: opcionais, valores informados ou 0 se desmarcados.
//   Taxa esboco (R$750): INFORMATIVA — nao soma ao subtotal/total.
//     Cobrada apenas se cliente desistir apos entrega do anteprojeto.
//   Desconto: subtrai do subtotal.

import type {
  InputProjetoExecutivo,
  ProjetoSelecionado,
  CustosCalculados,
  ResultadoCalculo,
  ItemCusto,
  DocumentoChecklist,
  CondicaoPagamento,
  BaseCalculo,
} from './types';

// HALF_UP em 2 casas (mesma logica das outras engines)
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Defaults pra ART/TRT e config — sem dependencia de DB pra simplificar.
// CEO pediu defaults conservadores e ajustaveis via input.
export const DEFAULTS_PROJETO_EXECUTIVO = {
  VALOR_M2: 25.00,
  TAXA_ESBOCO: 750.00,
  ART_VALOR: 233.94,     // CREA-MA referencia (subcontratacao)
  TRT_VALOR: 93.40,      // CFT/MA referencia (mesma das outras propostas)
  AREA_LIMITE_TRT: 80.00,
} as const;

// Lista padrao de projetos executivos com detalhamentos completos.
// CEO pode customizar por proposta — o que vier no input substitui o default.
export const PROJETOS_DEFAULT_PROJETO_EXECUTIVO: ProjetoSelecionado[] = [
  {
    codigo: 'mapa_situacao',
    nome: 'Mapa de Situacao e Localizacao',
    ordem: 1,
    selecionado: true,
    detalhamento_entrega:
      'Prancha contendo planta de situacao (quadra/lote), planta de localizacao do imovel, ' +
      'orientacao magnetica (Norte), coordenadas de referencia (SIRGAS2000), confrontantes, ' +
      'vias de acesso, recuos, taxa de ocupacao e coeficiente de aproveitamento conforme ' +
      'legislacao municipal.',
  },
  {
    codigo: 'arquitetonico',
    nome: 'Projeto Arquitetonico',
    ordem: 2,
    selecionado: true,
    detalhamento_entrega:
      'Plantas baixas de todos os pavimentos com cotas e areas, planta de cobertura, planta ' +
      'de implantacao, cortes longitudinal e transversal (minimo 2), fachadas (minimo 2), ' +
      'planta de layout, memorial descritivo e quadro de areas, em conformidade com as ' +
      'NBR 13531 e NBR 13532.',
  },
  {
    codigo: 'hidraulico',
    nome: 'Projeto Hidraulico (Agua Fria)',
    ordem: 3,
    selecionado: true,
    detalhamento_entrega:
      'Planta baixa hidraulica por pavimento, vistas isometricas dos pontos de consumo, ' +
      'detalhes de barrilete e reservatorio, dimensionamento de tubulacoes, quantitativo de ' +
      'materiais e memorial de calculo conforme NBR 5626.',
  },
  {
    codigo: 'sanitario',
    nome: 'Projeto Sanitario (Esgoto e Aguas Pluviais)',
    ordem: 4,
    selecionado: true,
    detalhamento_entrega:
      'Planta baixa de esgoto sanitario, planta baixa de aguas pluviais, vistas isometricas, ' +
      'detalhes de caixa de inspecao, fossa septica e sumidouro (quando aplicavel), ' +
      'dimensionamento conforme NBR 8160 e NBR 10844, e quantitativo de materiais.',
  },
  {
    codigo: 'eletrico',
    nome: 'Projeto Eletrico',
    ordem: 5,
    selecionado: true,
    detalhamento_entrega:
      'Planta baixa de pontos eletricos por pavimento, diagrama unifilar, quadro de cargas, ' +
      'dimensionamento de condutores e protecoes, detalhe de entrada de energia conforme padrao ' +
      'da concessionaria (Equatorial Maranhao), memorial descritivo conforme NBR 5410 e ' +
      'quantitativo de materiais.',
  },
  {
    codigo: 'estrutural',
    nome: 'Projeto Estrutural',
    ordem: 6,
    selecionado: true,
    detalhamento_entrega:
      'Planta de locacao de pilares, planta de formas por pavimento, detalhamento de vigas, ' +
      'lajes, pilares e fundacoes, memorial de calculo, especificacao de materiais (concreto ' +
      'e aco), em conformidade com NBR 6118 e NBR 6122.',
  },
  {
    codigo: 'pci',
    nome: 'Projeto de Prevencao e Combate a Incendio (PCI)',
    ordem: 7,
    selecionado: false,
    detalhamento_entrega:
      'Planta baixa de PCI com rotas de fuga, localizacao de extintores, hidrantes, ' +
      'iluminacao de emergencia e sinalizacao, memorial descritivo conforme Normas Tecnicas ' +
      'do CBMMA e NBR 9077, para protocolo junto ao Corpo de Bombeiros Militar do Maranhao.',
  },
];

const CNO_OBSERVACAO =
  'O Cadastro Nacional de Obras (CNO) junto a Receita Federal do Brasil sera gerado e ' +
  'vinculado a esta obra APOS a expedicao do Alvara de Construcao pelo municipio de ' +
  'Acailandia/MA, em conformidade com a IN RFB n° 2.021/2021. A CONTRATADA se responsabilizara ' +
  'pelo cadastramento mediante apresentacao previa do Alvara pelo CONTRATANTE.';

const AVISO_TAXA_ESBOCO =
  'A Hora Tecnica de Anteprojeto e Croqui (R$ 750,00 — item informativo) NAO esta incluida no ' +
  'VALOR TOTAL desta proposta. Sera cobrada APENAS se o CONTRATANTE optar por nao prosseguir ' +
  'com a fase executiva apos a entrega do esboco arquitetonico aprovado. Caso prossiga, este ' +
  'valor e absorvido pelo contrato.';

const AVISO_CNO_EXECUTIVO =
  'O CADASTRO NACIONAL DE OBRAS (CNO) na Receita Federal sera vinculado a obra apenas APOS a ' +
  'expedicao do Alvara de Construcao pela Prefeitura. A CONTRATADA executa o cadastramento ' +
  'quando o CONTRATANTE apresentar o Alvara.';

const AVISO_ALVARA =
  'O Alvara de Construcao e expedido pela Prefeitura Municipal de Acailandia mediante pagamento ' +
  'das taxas municipais (TLE, ISS de aprovacao, etc) diretamente pelo CONTRATANTE. A CONTRATADA ' +
  'acompanha o protocolo e exigencias ate a expedicao.';

const AVISO_ART =
  'A ART (Anotacao de Responsabilidade Tecnica) junto ao CREA-MA exige profissional Engenheiro ' +
  'ou Arquiteto registrado. A Romatec subcontrata o profissional habilitado mediante aditivo ' +
  'contratual quando esta opcao for selecionada.';

const AVISO_TRT =
  'O TRT (Termo de Responsabilidade Tecnica) junto ao CFT/MA e emitido diretamente pelo ' +
  'profissional Jose Romario Pinto Bezerra — Tecnico em Edificacoes (CFT/MA 01209185369). ' +
  'Aplicavel a obras de ate 80m² conforme Lei 13.639/2018.';

// Documentos obrigatorios do cliente pra dar inicio aos projetos
const CHECKLIST_PROJETO_EXECUTIVO: DocumentoChecklist[] = [
  { texto: 'RG e CPF do proprietario (copia simples)', obrigatorio: true },
  { texto: 'Comprovante de residencia atualizado (max. 90 dias)', obrigatorio: true },
  { texto: 'Escritura ou matricula atualizada do imovel (max. 90 dias)', obrigatorio: true, imprescindivel: true },
  { texto: 'IPTU do exercicio atual (com situacao em dia)', obrigatorio: true },
  { texto: 'Croqui ou levantamento topografico do terreno (se disponivel)', obrigatorio: false },
  { texto: 'Programa de necessidades — descricao dos ambientes desejados', obrigatorio: true },
  { texto: 'Referencias visuais / inspiracao (opcional)', obrigatorio: false },
];

export interface ResultadoProjetoExecutivoExtra {
  area_construir: number;
  valor_m2: number;
  valor_projetos: number;
  responsabilidade_tipo: 'ART' | 'TRT';
  responsabilidade_valor: number;
  responsabilidade_auto: boolean;
  taxa_esboco: number;
  alvara: { incluir: boolean; valor: number };
  placa: { incluir: boolean; valor: number };
  subtotal: number;
  desconto: number;
  valor_total: number;
  projetos_selecionados: ProjetoSelecionado[];
  cno_observacao: string;
}

export async function calcularProjetoExecutivo(
  input: InputProjetoExecutivo,
): Promise<ResultadoCalculo & { projeto_executivo: ResultadoProjetoExecutivoExtra }> {
  if (!input.area_construir || input.area_construir <= 0) {
    throw new Error('area_construir deve ser maior que zero');
  }
  if (!input.valor_m2 || input.valor_m2 <= 0) {
    throw new Error('valor_m2 deve ser maior que zero');
  }

  const valorM2 = input.valor_m2;
  const valor_projetos = round2(input.area_construir * valorM2);
  const taxa_esboco = round2(input.taxa_esboco ?? DEFAULTS_PROJETO_EXECUTIVO.TAXA_ESBOCO);

  // ART/TRT — default auto por area (>80m² ART). Override manual respeita escolha.
  const auto = input.responsabilidade_auto !== false;
  let responsabilidade_tipo: 'ART' | 'TRT';
  if (!auto && input.responsabilidade_tipo) {
    responsabilidade_tipo = input.responsabilidade_tipo;
  } else {
    responsabilidade_tipo =
      input.area_construir > DEFAULTS_PROJETO_EXECUTIVO.AREA_LIMITE_TRT ? 'ART' : 'TRT';
  }

  const responsabilidade_valor = round2(
    input.responsabilidade_valor != null
      ? input.responsabilidade_valor
      : (responsabilidade_tipo === 'ART'
        ? DEFAULTS_PROJETO_EXECUTIVO.ART_VALOR
        : DEFAULTS_PROJETO_EXECUTIVO.TRT_VALOR),
  );

  const alvara_valor = input.alvara_incluir ? round2(input.alvara_valor) : 0;
  const placa_valor  = input.placa_incluir  ? round2(input.placa_valor)  : 0;

  // Subtotal NAO inclui taxa_esboco
  const subtotal = round2(valor_projetos + responsabilidade_valor + alvara_valor + placa_valor);
  const desconto = round2(input.desconto ?? 0);
  const valor_total = round2(subtotal - desconto);

  // Projetos: aplica defaults SE input nao trouxe lista
  const projetos = (input.projetos_selecionados && input.projetos_selecionados.length > 0)
    ? input.projetos_selecionados
    : PROJETOS_DEFAULT_PROJETO_EXECUTIVO;
  // Filtra so os selecionados pra montar a lista do escopo (Secao 1)
  const projetosAtivos = projetos.filter(p => p.selecionado);

  const secao_1_projetos = projetosAtivos.map(p => `${p.nome}: ${p.detalhamento_entrega}`);

  // Tabela financeira:
  // Secao 2 (taxas) = ART/TRT + alvara + placa (sem taxas terceiros nesse subtipo)
  // Secao 3 (honorarios) = valor_projetos (item unico, ja inclui o pacote completo)
  const secao_2_taxas: ItemCusto[] = [];
  secao_2_taxas.push({
    ordem: 1,
    descricao: responsabilidade_tipo === 'ART'
      ? 'ART — Anotacao de Responsabilidade Tecnica (CREA-MA)'
      : 'TRT — Termo de Responsabilidade Tecnica (CFT/MA)',
    valor: responsabilidade_valor,
    observacao: responsabilidade_tipo === 'ART' ? AVISO_ART : AVISO_TRT,
  });
  if (input.alvara_incluir) {
    secao_2_taxas.push({
      ordem: 2,
      descricao: 'Alvara de Construcao (Prefeitura de Acailandia/MA)',
      valor: alvara_valor,
      observacao: AVISO_ALVARA,
    });
  }
  if (input.placa_incluir) {
    secao_2_taxas.push({
      ordem: 3,
      descricao: 'Placa de Obra (confeccao e instalacao)',
      valor: placa_valor,
      observacao: 'Placa padrao com identificacao do responsavel tecnico e numero da ART/TRT.',
    });
  }

  const secao_3_honorarios: ItemCusto[] = [{
    ordem: 1,
    descricao: `Projetos Executivos (${projetosAtivos.length} projeto${projetosAtivos.length === 1 ? '' : 's'}) — ` +
               `${input.area_construir.toFixed(2)}m² × R$ ${valorM2.toFixed(2)}/m²`,
    valor: valor_projetos,
  }];

  // Condicoes de pagamento sugeridas — 3 parcelas:
  //   1a (40% subtotal) na assinatura
  //   2a (40%) na entrega do anteprojeto aprovado
  //   3a (20%) na entrega final dos projetos executivos
  const p1 = round2(valor_total * 0.40);
  const p2 = round2(valor_total * 0.40);
  const p3 = round2(valor_total - p1 - p2);
  const condicoes_pagamento: CondicaoPagamento[] = [
    { rotulo: '1a parcela — na assinatura', descricao: '40% do valor total', valor: p1 },
    { rotulo: '2a parcela — anteprojeto aprovado', descricao: '40% do valor total', valor: p2 },
    { rotulo: '3a parcela — entrega final', descricao: '20% do valor total', valor: p3 },
  ];

  const base_calculo: BaseCalculo[] = [
    {
      rotulo: `Projetos Executivos (${projetosAtivos.length} projeto${projetosAtivos.length === 1 ? '' : 's'})`,
      formula: `area (${input.area_construir.toFixed(2)} m²) × valor_m2 (R$ ${valorM2.toFixed(2)})`,
      valor_resultado: valor_projetos,
    },
    {
      rotulo: `${responsabilidade_tipo} ${auto ? 'auto' : 'manual'}`,
      formula: auto
        ? `area ${input.area_construir > 80 ? '> 80m² -> ART' : '<= 80m² -> TRT'}`
        : `override manual = ${responsabilidade_tipo}`,
      valor_resultado: responsabilidade_valor,
    },
  ];
  if (input.alvara_incluir) {
    base_calculo.push({
      rotulo: 'Alvara',
      formula: 'incluido pelo CONTRATANTE',
      valor_resultado: alvara_valor,
    });
  }
  if (input.placa_incluir) {
    base_calculo.push({
      rotulo: 'Placa',
      formula: 'incluida pelo CONTRATANTE',
      valor_resultado: placa_valor,
    });
  }

  const avisos = [
    AVISO_TAXA_ESBOCO,
    AVISO_CNO_EXECUTIVO,
    responsabilidade_tipo === 'ART' ? AVISO_ART : AVISO_TRT,
  ];

  const custos: CustosCalculados = {
    secao_1_projetos,
    secao_2_taxas,
    secao_3_honorarios,
    condicoes_pagamento,
    base_calculo,
    secao_4_checklist: CHECKLIST_PROJETO_EXECUTIVO,
    secao_5_total: valor_total,
    avisos,
  };

  return {
    custos,
    fontes: {},
    projeto_executivo: {
      area_construir: input.area_construir,
      valor_m2: valorM2,
      valor_projetos,
      responsabilidade_tipo,
      responsabilidade_valor,
      responsabilidade_auto: auto,
      taxa_esboco,
      alvara: { incluir: !!input.alvara_incluir, valor: alvara_valor },
      placa:  { incluir: !!input.placa_incluir,  valor: placa_valor  },
      subtotal,
      desconto,
      valor_total,
      projetos_selecionados: projetos,
      cno_observacao: CNO_OBSERVACAO,
    },
  };
}
