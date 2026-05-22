// v3.24.5: motor de calculo de Projeto Executivo (arquitetonico + complementares).
// v3.24.6: REESTRUTURADO em DOIS BLOCOS FINANCEIROS:
//   🅰 HONORARIOS TECNICOS (Romatec)  → entra em parcelas 50/50
//   🅱 DESPESAS ADMINISTRATIVAS (cliente paga a parte) → fora das parcelas
// Forma de pagamento agora vem por TAG (sinal_mais_1 default = 50/50).
// Taxa esboco R$ 750 continua INFORMATIVA (fora do total geral).

import type {
  InputProjetoExecutivo,
  ProjetoSelecionado,
  FormaPagamentoTag,
  CustosCalculados,
  ResultadoCalculo,
  ItemCusto,
  DocumentoChecklist,
  CondicaoPagamento,
  BaseCalculo,
} from './types';

// HALF_UP em 2 casas
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// v3.24.8: helper de Taxa de Ocupacao (TO%) — usado pela engine e exposto
// pra testes. Quando area_terreno ausente/0/negativa, retorna undefined.
export function calcularTaxaOcupacao(
  areaConstruir: number,
  areaTerreno?: number,
): number | undefined {
  if (!areaTerreno || areaTerreno <= 0) return undefined;
  return round2((areaConstruir / areaTerreno) * 100);
}

export const DEFAULTS_PROJETO_EXECUTIVO = {
  VALOR_M2: 25.00,
  TAXA_ESBOCO: 750.00,
  ART_VALOR: 233.94,
  TRT_VALOR: 93.40,
  AREA_LIMITE_TRT: 80.00,
} as const;

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

const AVISO_DESPESAS =
  'Os valores das Despesas Administrativas NAO compoem os Honorarios Tecnicos e NAO estao ' +
  'sujeitos ao parcelamento 50/50. Sao pagos pelo CONTRATANTE diretamente aos orgaos competentes ' +
  'ou reembolsados a CONTRATADA mediante apresentacao dos comprovantes.';

const AVISO_ART =
  'A ART (Anotacao de Responsabilidade Tecnica) junto ao CREA-MA exige profissional Engenheiro ' +
  'ou Arquiteto registrado. A Romatec subcontrata o profissional habilitado mediante aditivo ' +
  'contratual quando esta opcao for selecionada.';

const AVISO_TRT =
  'O TRT (Termo de Responsabilidade Tecnica) junto ao CFT/MA e emitido diretamente pelo ' +
  'profissional Jose Romario Pinto Bezerra — Tecnico em Edificacoes (CFT/MA 01209185369). ' +
  'Aplicavel a obras de ate 80m² conforme Lei 13.639/2018.';

const CHECKLIST_PROJETO_EXECUTIVO: DocumentoChecklist[] = [
  { texto: 'RG e CPF do proprietario (copia simples)', obrigatorio: true },
  { texto: 'Comprovante de residencia atualizado (max. 90 dias)', obrigatorio: true },
  { texto: 'Escritura ou matricula atualizada do imovel (max. 90 dias)', obrigatorio: true, imprescindivel: true },
  { texto: 'IPTU do exercicio atual (com situacao em dia)', obrigatorio: true },
  { texto: 'Croqui ou levantamento topografico do terreno (se disponivel)', obrigatorio: false },
  { texto: 'Programa de necessidades — descricao dos ambientes desejados', obrigatorio: true },
  { texto: 'Referencias visuais / inspiracao (opcional)', obrigatorio: false },
];

// v3.24.6: helper exportado pra rendering de Forma de Pagamento por TAG
export function renderizarFormaPagamento(
  tag: FormaPagamentoTag,
  totalHonorarios: number,
  custom?: string,
): { tag: FormaPagamentoTag; texto_renderizado: string; detalhes_custom?: string } {
  const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  switch (tag) {
    case 'integral':
      return {
        tag,
        texto_renderizado:
          `Pagamento a vista no valor de R$ ${fmt(totalHonorarios)} ` +
          `na assinatura do contrato.`,
      };

    case 'sinal_mais_1': {
      const metade = round2(totalHonorarios * 0.5);
      const resto = round2(totalHonorarios - metade);
      return {
        tag,
        texto_renderizado:
          `Pagamento em 2 (duas) parcelas: ` +
          `R$ ${fmt(metade)} como SINAL no inicio (assinatura do contrato / ` +
          `aprovacao do anteprojeto) e R$ ${fmt(resto)} na ENTREGA FINAL ` +
          `dos projetos executivos em PDF via WhatsApp e e-mail.`,
      };
    }

    case 'sinal_mais_2': {
      const sinal = round2(totalHonorarios * 0.5);
      const restante = round2(totalHonorarios - sinal);
      const parc = round2(restante / 2);
      const ultima = round2(restante - parc);
      return {
        tag,
        texto_renderizado:
          `Pagamento em 3 (tres) parcelas: ` +
          `R$ ${fmt(sinal)} como SINAL no inicio; ` +
          `R$ ${fmt(parc)} na entrega do anteprojeto aprovado; ` +
          `e R$ ${fmt(ultima)} na ENTREGA FINAL dos projetos executivos ` +
          `em PDF via WhatsApp e e-mail.`,
      };
    }

    case 'duas_vezes': {
      const p1 = round2(totalHonorarios * 0.5);
      const p2 = round2(totalHonorarios - p1);
      return {
        tag,
        texto_renderizado:
          `Pagamento em 2 (duas) parcelas: ` +
          `R$ ${fmt(p1)} na assinatura do contrato e R$ ${fmt(p2)} ` +
          `na ENTREGA FINAL dos projetos executivos em PDF via WhatsApp e e-mail.`,
      };
    }

    case 'personalizada':
      return {
        tag,
        texto_renderizado: (custom && custom.trim()) || 'A combinar entre as partes.',
        detalhes_custom: custom,
      };
  }
}

// v3.24.6: estrutura completa de retorno (extends ResultadoCalculo via custos)
export interface CustosProjetoExecutivoV2 {
  honorarios: {
    area_construir: number;
    area_terreno?: number;                 // v3.24.8
    taxa_ocupacao_percentual?: number;     // v3.24.8 (0-100)
    valor_m2: number;
    valor_projetos: number;
    responsabilidade_tipo: 'ART' | 'TRT';
    responsabilidade_auto: boolean;
    responsabilidade_valor: number;
    subtotal_honorarios: number;
    desconto_honorarios: number;
    total_honorarios: number;
    parcela_inicial: number;
    parcela_final: number;
  };
  despesas_administrativas: {
    diligencia_secretaria: { incluir: boolean; valor: number };
    taxa_alvara_municipio: { incluir: boolean; valor: number };
    placa_obra: { incluir: boolean; valor: number };
    subtotal_despesas: number;
  };
  taxa_esboco: {
    valor: number;
    cobranca_condicional: boolean;
    nota: string;
  };
  forma_pagamento: {
    tag: FormaPagamentoTag;
    texto_renderizado: string;
    detalhes_custom?: string;
  };
  resumo: {
    total_honorarios: number;
    total_despesas: number;
    total_geral: number;
  };
  projetos_selecionados: ProjetoSelecionado[];
  cno_observacao: string;
}

export async function calcularProjetoExecutivo(
  input: InputProjetoExecutivo,
): Promise<ResultadoCalculo & { projeto_executivo: CustosProjetoExecutivoV2 }> {
  if (!input.area_construir || input.area_construir <= 0) {
    throw new Error('area_construir deve ser maior que zero');
  }
  if (!input.valor_m2 || input.valor_m2 <= 0) {
    throw new Error('valor_m2 deve ser maior que zero');
  }
  // v3.24.8: valida area_terreno quando informada
  if (input.area_terreno !== undefined && input.area_terreno > 0) {
    if (input.area_construir > input.area_terreno) {
      throw new Error('Area a construir nao pode ser maior que a area do terreno.');
    }
  }
  const taxa_ocupacao_percentual = calcularTaxaOcupacao(input.area_construir, input.area_terreno);

  const valorM2 = input.valor_m2;
  const valor_projetos = round2(input.area_construir * valorM2);

  // ART/TRT — auto por area
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

  // 🅰 HONORARIOS
  const subtotal_honorarios = round2(valor_projetos + responsabilidade_valor);
  const desconto_honorarios = round2(input.desconto_honorarios ?? input.desconto ?? 0);
  const total_honorarios = round2(subtotal_honorarios - desconto_honorarios);
  const parcela_inicial = round2(total_honorarios * 0.5);
  const parcela_final = round2(total_honorarios - parcela_inicial);

  // 🅱 DESPESAS ADMIN — usa forma nova (DespesaAdmItem) com fallback retro
  // pra alvara_incluir/alvara_valor/placa_incluir/placa_valor (v3.24.5).
  const diligenciaIn = input.diligencia_secretaria ?? { incluir: false, valor: 0 };
  const alvaraIn = input.taxa_alvara_municipio
    ?? (input.alvara_incluir != null
      ? { incluir: !!input.alvara_incluir, valor: input.alvara_valor || 0 }
      : { incluir: false, valor: 0 });
  const placaIn = input.placa_obra
    ?? (input.placa_incluir != null
      ? { incluir: !!input.placa_incluir, valor: input.placa_valor || 0 }
      : { incluir: false, valor: 0 });

  const vDilig = diligenciaIn.incluir ? round2(diligenciaIn.valor) : 0;
  const vAlvara = alvaraIn.incluir ? round2(alvaraIn.valor) : 0;
  const vPlaca = placaIn.incluir ? round2(placaIn.valor) : 0;
  const subtotal_despesas = round2(vDilig + vAlvara + vPlaca);

  // Taxa esboco
  const taxa_esboco_valor = round2(input.taxa_esboco ?? DEFAULTS_PROJETO_EXECUTIVO.TAXA_ESBOCO);

  // Forma de pagamento por TAG
  const formaTag: FormaPagamentoTag = input.forma_pagamento_tag ?? 'sinal_mais_1';
  const forma_pagamento = renderizarFormaPagamento(formaTag, total_honorarios, input.forma_pagamento_custom);

  // Resumo (total_geral = honorarios + despesas; taxa esboco FORA)
  const total_geral = round2(total_honorarios + subtotal_despesas);

  // Projetos selecionados
  const projetos = (input.projetos_selecionados && input.projetos_selecionados.length > 0)
    ? input.projetos_selecionados
    : PROJETOS_DEFAULT_PROJETO_EXECUTIVO;
  const projetosAtivos = projetos.filter(p => p.selecionado);
  const secao_1_projetos = projetosAtivos.map(p => `${p.nome}: ${p.detalhamento_entrega}`);

  // ── Estrutura CustosCalculados padrao (compat retro com renderers genericos)
  // Mapeamento:
  //   secao_3_honorarios = projetos + ART/TRT (HONORARIOS)
  //   secao_2_taxas = despesas administrativas (alvara + placa + diligencia)
  //   secao_5_total = total_geral (honorarios + despesas)
  //   condicoes_pagamento = baseado na TAG (so 2 parcelas no sinal_mais_1)
  const secao_3_honorarios: ItemCusto[] = [
    {
      ordem: 1,
      descricao: `Projetos Executivos (${projetosAtivos.length} projeto${projetosAtivos.length === 1 ? '' : 's'}) — ` +
                 `${input.area_construir.toFixed(2)}m² × R$ ${valorM2.toFixed(2)}/m²`,
      valor: valor_projetos,
    },
    {
      ordem: 2,
      descricao: responsabilidade_tipo === 'ART'
        ? 'ART — Anotacao de Responsabilidade Tecnica (CREA-MA)'
        : 'TRT — Termo de Responsabilidade Tecnica (CFT/MA)',
      valor: responsabilidade_valor,
      observacao: responsabilidade_tipo === 'ART' ? AVISO_ART : AVISO_TRT,
    },
  ];

  const secao_2_taxas: ItemCusto[] = [];
  if (diligenciaIn.incluir) {
    secao_2_taxas.push({
      ordem: 1,
      descricao: 'Diligencia de Protocolo na Secretaria de Habitacao e Regularizacao Fundiaria',
      valor: vDilig,
      observacao: 'Inclui impressao 2 vias, certidoes, protocolo, acompanhamento, retirada do Alvara.',
    });
  }
  if (alvaraIn.incluir) {
    secao_2_taxas.push({
      ordem: 2,
      descricao: 'Taxa de Expedicao de Alvara de Construcao',
      valor: vAlvara,
      observacao: 'Valor da Prefeitura Municipal pago direto pelo cliente OU reembolsado.',
    });
  }
  if (placaIn.incluir) {
    secao_2_taxas.push({
      ordem: 3,
      descricao: 'Confeccao e Instalacao da Placa de Obra',
      valor: vPlaca,
      observacao: 'Padrao CREA/CFT + legislacao municipal.',
    });
  }

  // Condicoes de pagamento — baseadas na TAG. Para tag != personalizada,
  // expomos as parcelas estruturadas (front pode usar). Pra integral, 1 linha.
  const condicoes_pagamento: CondicaoPagamento[] = [];
  if (formaTag === 'integral') {
    condicoes_pagamento.push({
      rotulo: '1a parcela — a vista',
      descricao: '100% na assinatura',
      valor: total_honorarios,
    });
  } else if (formaTag === 'sinal_mais_1' || formaTag === 'duas_vezes') {
    condicoes_pagamento.push(
      { rotulo: '1a parcela — sinal', descricao: '50% na assinatura/aprovacao do anteprojeto', valor: parcela_inicial },
      { rotulo: '2a parcela — entrega final', descricao: '50% na entrega via WhatsApp + e-mail', valor: parcela_final },
    );
  } else if (formaTag === 'sinal_mais_2') {
    const restante = round2(total_honorarios - parcela_inicial);
    const meio = round2(restante / 2);
    const final = round2(restante - meio);
    condicoes_pagamento.push(
      { rotulo: '1a parcela — sinal', descricao: '50% na assinatura', valor: parcela_inicial },
      { rotulo: '2a parcela — anteprojeto aprovado', descricao: '25%', valor: meio },
      { rotulo: '3a parcela — entrega final', descricao: '25%', valor: final },
    );
  }
  // 'personalizada' deixa condicoes_pagamento vazio — texto vai em forma_pagamento.texto_renderizado

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
    {
      rotulo: 'Parcelamento 50/50',
      formula: `total_honorarios / 2`,
      valor_resultado: parcela_inicial,
    },
  ];

  const avisos = [
    AVISO_TAXA_ESBOCO,
    AVISO_CNO_EXECUTIVO,
    AVISO_DESPESAS,
    responsabilidade_tipo === 'ART' ? AVISO_ART : AVISO_TRT,
  ];

  const custos: CustosCalculados = {
    secao_1_projetos,
    secao_2_taxas,
    secao_3_honorarios,
    condicoes_pagamento,
    base_calculo,
    secao_4_checklist: CHECKLIST_PROJETO_EXECUTIVO,
    secao_5_total: total_geral,
    avisos,
  };

  return {
    custos,
    fontes: {},
    projeto_executivo: {
      honorarios: {
        area_construir: input.area_construir,
        area_terreno: input.area_terreno,                  // v3.24.8
        taxa_ocupacao_percentual,                          // v3.24.8
        valor_m2: valorM2,
        valor_projetos,
        responsabilidade_tipo,
        responsabilidade_auto: auto,
        responsabilidade_valor,
        subtotal_honorarios,
        desconto_honorarios,
        total_honorarios,
        parcela_inicial,
        parcela_final,
      },
      despesas_administrativas: {
        diligencia_secretaria: { incluir: diligenciaIn.incluir, valor: vDilig },
        taxa_alvara_municipio: { incluir: alvaraIn.incluir, valor: vAlvara },
        placa_obra: { incluir: placaIn.incluir, valor: vPlaca },
        subtotal_despesas,
      },
      taxa_esboco: {
        valor: taxa_esboco_valor,
        cobranca_condicional: true,
        nota: 'Cobrada apenas se o CONTRATANTE nao prosseguir com a fase executiva.',
      },
      forma_pagamento,
      resumo: {
        total_honorarios,
        total_despesas: subtotal_despesas,
        total_geral,
      },
      projetos_selecionados: projetos,
      cno_observacao: CNO_OBSERVACAO,
    },
  };
}
