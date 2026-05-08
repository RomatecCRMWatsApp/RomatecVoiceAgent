// v1.99.6: motor de calculo de PTAM (Parecer Tecnico de Avaliacao Mercadologica).
//
// Base normativa:
//   - NBR 14653 (Norma Brasileira de Avaliacao de Bens) — todas as 7 partes
//     1) Procedimentos gerais
//     2) Imoveis urbanos
//     3) Imoveis rurais
//     4) Empreendimentos
//     5) Maquinas, equipamentos, instalacoes
//     6) Recursos naturais e ambientais
//     7) Patrimonios historicos
//   - Resolucao CONFEA 218/1973 e 1.010/2005 (atribuicoes profissionais)
//   - CRECI tambem emite PTAM (Resolucao COFECI 957/2006)
//
// Niveis de precisao NBR 14653:
//   EXPEDITA — fundamentacao limitada, poucas amostras, valor estimativo
//   NORMAL   — fundamentacao padrao, 5-15 amostras, intervalos de confianca
//   RIGOROSA — fundamentacao maxima, 30+ amostras, tratamento estatistico
//              completo (geralmente exigida em pericia judicial)
//
// Honorarios CONFEA por faixa de imovel:
//   1_lote_urbano   → 1 SM (lote tipico em zona urbana ate 1000m²)
//   2_sitio_proximo → 2 SM (sitio proximo, ate 50ha)
//   3_rural_medio   → 3 SM (rural ate 500ha)
//   4_fazenda_grande→ 4 SM (fazenda grande > 500ha)
//   outro           → valor custom (cliente VIP / imovel atipico)
//
// PTAM nao envolve cartorio, prefeitura ou outros orgaos. E um laudo tecnico
// que fica em poder do cliente. Sem taxas de terceiros alem da ART/RRT.

import type {
  InputAvaliacaoPTAM,
  ResultadoCalculo,
  CustosCalculados,
  FontesConsulta,
  ItemCusto,
  DocumentoChecklist,
  CondicaoPagamento,
  BaseCalculo,
} from './types';
import { getParams, salarioMinimo, anotacaoTecnica } from './params';

const ESCOPO_PTAM_BASE = [
  'Vistoria tecnica do imovel (caracteristicas fisicas, conservacao, infraestrutura)',
  'Levantamento de dados de mercado (amostras de imoveis comparaveis na regiao)',
  'Pesquisa cadastral e documental (matricula, IPTU/ITR, restricoes)',
  'Analise das caracteristicas do imovel-alvo vs amostras (homogeneizacao)',
  'Calculo do valor de mercado pelo metodo comparativo direto',
  'Memorial descritivo do imovel + reportagem fotografica',
  'Laudo de avaliacao com base na NBR 14653',
];

const ESCOPO_RIGOROSO = [
  'Tratamento estatistico avancado (regressao linear multipla, teste F, R², t-Student)',
  'Validacao por correlacao Pearson dos coeficientes',
  'Intervalos de confianca de 80% (NBR) e 95% (judicial)',
  'Tabela completa de amostras com homogeneizacao detalhada',
];

export async function calcularAvaliacaoPTAM(
  input: InputAvaliacaoPTAM,
): Promise<ResultadoCalculo> {
  const params = getParams();
  const sm = salarioMinimo();
  const hp = params.honorarios_projeto;

  // ── Secao 1: escopo ─────────────────────────────────────────────────────
  const secao_1_projetos = [...ESCOPO_PTAM_BASE];
  if (input.nivel_precisao === 'rigorosa') {
    secao_1_projetos.push(...ESCOPO_RIGOROSO);
  }

  // Adiciona escopos especificos por tipo de imovel
  if (input.tipo_imovel === 'rural' || input.tipo_imovel === 'glebas') {
    secao_1_projetos.push('Analise de aptidao agricola/ambiental (NBR 14653-3)');
    secao_1_projetos.push('Avaliacao de benfeitorias rurais (galpoes, currais, açudes, cercas)');
  }
  if (input.tipo_imovel === 'industrial') {
    secao_1_projetos.push('Avaliacao de instalacoes industriais (NBR 14653-5)');
    secao_1_projetos.push('Verificacao de licenciamento ambiental');
  }
  if (input.finalidade === 'judicial') {
    secao_1_projetos.push('Quesitos do juiz/partes — respostas formais para fins processuais');
    secao_1_projetos.push('Apresentacao em audiencia/pericia se solicitado');
  }

  // ── Secao 2: taxas de terceiros ─────────────────────────────────────────
  const secao_2_taxas: ItemCusto[] = [];
  const fontes: FontesConsulta = {};
  let ordem = 1;

  // ART CREA (faixa varia por nivel de precisao)
  const at = anotacaoTecnica('art_crea');
  // Rigorosa exige ART de faixa mais alta — usamos faixa_2 ou faixa_3 do params
  let valorART = at.valor;
  let observacaoART = at.fonte;
  if (input.nivel_precisao === 'rigorosa') {
    valorART = params.art_crea_ma_2026.faixa_2;
    observacaoART = `${at.fonte} — Faixa 2 aplicada por nivel rigoroso`;
  }
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: at.rotulo,
    valor: valorART,
    observacao: observacaoART,
  });

  // ── Secao 3: honorarios Romatec ────────────────────────────────────────
  // Define o multiplicador SM conforme faixa
  let multiplicadorSM: number;
  let descricaoFaixa: string;
  switch (input.faixa_honorario) {
    case '1_lote_urbano':
      multiplicadorSM = hp.ptam_lote_urbano_sm;
      descricaoFaixa = 'Lote urbano (ate 1000m²)';
      break;
    case '2_sitio_proximo':
      multiplicadorSM = hp.ptam_sitio_proximo_sm;
      descricaoFaixa = 'Sitio proximo (ate 50ha)';
      break;
    case '3_rural_medio':
      multiplicadorSM = hp.ptam_rural_medio_sm;
      descricaoFaixa = 'Rural medio (ate 500ha)';
      break;
    case '4_fazenda_grande':
      multiplicadorSM = hp.ptam_fazenda_grande_sm;
      descricaoFaixa = 'Fazenda grande (>500ha)';
      break;
    case 'outro':
      if (!input.valor_outro || input.valor_outro <= 0) {
        throw new Error('Faixa outro exige valor_outro > 0');
      }
      multiplicadorSM = input.valor_outro / sm; // converte pra SM equivalente pra log
      descricaoFaixa = 'Customizado';
      break;
  }

  let honorario_projeto = input.faixa_honorario === 'outro'
    ? (input.valor_outro ?? 0)
    : sm * multiplicadorSM;

  // Multiplicador adicional por nivel de precisao (acima do default normal)
  let fatorPrecisao = 1.0;
  if (input.nivel_precisao === 'rigorosa') fatorPrecisao = 1.5;
  if (input.nivel_precisao === 'expedita') fatorPrecisao = 0.7; // expedita e mais barata

  honorario_projeto = honorario_projeto * fatorPrecisao;

  // Multiplicador adicional por finalidade judicial (~+30% pelo trabalho extra)
  let fatorFinalidade = 1.0;
  if (input.finalidade === 'judicial') fatorFinalidade = 1.3;
  honorario_projeto = honorario_projeto * fatorFinalidade;

  // Honorario de assessoria — PTAM nao tem cartorio/prefeitura, mas tem
  // entrega do laudo, eventual reuniao com cliente, e revisao
  const honorario_assessoria = sm * params.honorarios_assessoria.padrao_sm * 0.5; // metade do padrao

  const obsHonProjeto = input.faixa_honorario === 'outro'
    ? `Valor customizado R$ ${(input.valor_outro ?? 0).toFixed(2)} × ${fatorPrecisao}x precisao ${input.nivel_precisao} × ${fatorFinalidade}x finalidade ${input.finalidade}`
    : `${multiplicadorSM} SM (${descricaoFaixa}) × R$ ${sm.toFixed(2)} × ${fatorPrecisao}x precisao ${input.nivel_precisao} × ${fatorFinalidade}x finalidade ${input.finalidade}`;

  const secao_3_honorarios: ItemCusto[] = [
    {
      ordem: ordem++,
      descricao: 'Honorarios Tecnicos PTAM — vistoria, pesquisa de mercado, calculo do valor, laudo conforme NBR 14653',
      valor: honorario_projeto,
      observacao: obsHonProjeto,
    },
    {
      ordem: ordem++,
      descricao: 'Entrega e Revisao do Laudo — apresentacao do laudo ao cliente, revisao ate 1 vez se necessario, esclarecimentos por email/whatsapp',
      valor: honorario_assessoria,
      observacao: `0.5 SM × R$ ${sm.toFixed(2)}`,
    },
  ];

  // ── Secao 4: checklist documentos ──────────────────────────────────────
  const secao_4_checklist: DocumentoChecklist[] = [
    {
      texto: 'Certidao de Inteiro Teor da Matricula (max. 30 dias) — pra confirmar titularidade e onus',
      obrigatorio: true,
      imprescindivel: true,
    },
    { texto: 'IPTU/ITR atualizado — pra ver descricao oficial', obrigatorio: true },
    { texto: 'RG/CPF do solicitante (proprietario, advogado ou interessado)', obrigatorio: true },
    { texto: 'Endereco completo e ponto de referencia do imovel', obrigatorio: true },
    {
      texto: input.finalidade === 'judicial'
        ? 'Numero do processo + nome das partes + quesitos formulados pelo juiz/advogados'
        : 'Finalidade detalhada do laudo (compra, venda, garantia bancaria, partilha, etc)',
      obrigatorio: true,
    },
  ];

  if (input.tipo_imovel === 'rural' || input.tipo_imovel === 'glebas') {
    secao_4_checklist.push(
      { texto: 'CCIR + ITR em dia (Certificado de Cadastro de Imovel Rural)', obrigatorio: true },
      { texto: 'CAR (Cadastro Ambiental Rural)', obrigatorio: true },
    );
  }
  if (input.tipo_imovel === 'industrial') {
    secao_4_checklist.push(
      { texto: 'Alvara de funcionamento + licenca ambiental', obrigatorio: true },
      { texto: 'Plantas das instalacoes industriais', obrigatorio: false },
    );
  }
  if (input.finalidade === 'bancaria') {
    secao_4_checklist.push(
      { texto: 'Indicacao do banco/instituicao financeira', obrigatorio: true },
      { texto: 'Modelo/template de laudo exigido pelo banco (se houver)', obrigatorio: false },
    );
  }

  // ── Secao 5: total ──────────────────────────────────────────────────────
  const total_taxas = secao_2_taxas.reduce((s, i) => s + i.valor, 0);
  const total_honorarios = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
  const secao_5_total = total_taxas + total_honorarios;

  // ── Avisos legais ──────────────────────────────────────────────────────
  const avisos: string[] = [
    `BASE NORMATIVA: NBR 14653 (todas as partes aplicaveis), Resolucao CONFEA 1.010/2005, Resolucao COFECI 957/2006. Profissional habilitado: Engenheiro Civil/Agronomo (CREA) ou Corretor de Imoveis Avaliador (CRECI/CNAI).`,
    `NIVEL DE PRECISAO: ${input.nivel_precisao.toUpperCase()}. ${input.nivel_precisao === 'rigorosa' ? 'Inclui tratamento estatistico completo (regressao linear, intervalo de confianca 80-95%) — nivel adequado para pericia judicial.' : input.nivel_precisao === 'normal' ? 'Fundamentacao padrao com 5-15 amostras de mercado — adequado para finalidades particulares e bancarias.' : 'Fundamentacao limitada com poucas amostras — laudo estimativo, nao recomendado para pericia judicial.'}`,
    'PRAZO DE ENTREGA: vistoria em 3-5 dias uteis. Elaboracao do laudo em 7-15 dias uteis (rigorosa pode levar ate 30 dias). Total: 10-35 dias do recebimento dos documentos a entrega final.',
    'IMPORTANTE: o laudo tem validade conforme proposito. Para fins bancarios, geralmente 90 dias. Para pericia judicial, conforme determinacao do juizo. Para venda particular, recomenda-se atualizar a cada 6 meses.',
  ];

  if (input.finalidade === 'judicial') {
    avisos.push(
      'PERICIA JUDICIAL: o profissional e nomeado pelo juizo OU contratado por uma das partes como ASSISTENTE TECNICO. Em ambos os casos, o profissional pode ser convocado a comparecer em audiencia para esclarecimentos. Honorarios de comparecimento em audiencia (se solicitado) NAO estao inclusos — cobrados a parte (R$ 500-1500/comparecimento).'
    );
  }
  if (input.finalidade === 'bancaria') {
    avisos.push(
      'AVALIACAO BANCARIA: alguns bancos exigem template proprio (Caixa Sistema SIC, BB ALFA, etc). A Romatec adapta o formato conforme exigencia da instituicao. Bancos podem exigir cadastro previo do avaliador na sua plataforma.'
    );
  }

  // ── Condicoes de pagamento ──────────────────────────────────────────────
  const condicoes_pagamento: CondicaoPagamento[] = [
    {
      rotulo: '1a parcela — na assinatura',
      descricao: '50% do valor total da avaliacao',
      valor: secao_5_total * 0.5,
    },
    {
      rotulo: '2a parcela — na entrega do laudo',
      descricao: '50% restante',
      valor: secao_5_total * 0.5,
    },
  ];

  // ── Base de calculo ─────────────────────────────────────────────────────
  const base_calculo: BaseCalculo[] = [];

  if (input.faixa_honorario !== 'outro') {
    base_calculo.push({
      rotulo: `Faixa ${descricaoFaixa}`,
      formula: `${multiplicadorSM} SM × R$ ${sm.toFixed(2)}`,
      valor_resultado: sm * multiplicadorSM,
    });
  } else {
    base_calculo.push({
      rotulo: 'Honorario base customizado',
      formula: 'Valor acordado',
      valor_resultado: input.valor_outro ?? 0,
    });
  }

  if (fatorPrecisao !== 1.0) {
    base_calculo.push({
      rotulo: `Fator de precisao ${input.nivel_precisao}`,
      formula: `× ${fatorPrecisao.toFixed(2)}`,
      valor_resultado: (input.faixa_honorario !== 'outro' ? sm * multiplicadorSM : (input.valor_outro ?? 0)) * fatorPrecisao,
    });
  }

  if (fatorFinalidade !== 1.0) {
    base_calculo.push({
      rotulo: `Fator de finalidade ${input.finalidade}`,
      formula: `× ${fatorFinalidade.toFixed(2)}`,
      valor_resultado: honorario_projeto,
    });
  }

  base_calculo.push({
    rotulo: 'Honorarios Tecnicos finais',
    formula: 'Base × precisao × finalidade',
    valor_resultado: honorario_projeto,
  });

  base_calculo.push({
    rotulo: 'Entrega e Revisao',
    formula: `0.5 SM × R$ ${sm.toFixed(2)}`,
    valor_resultado: honorario_assessoria,
  });

  const custos: CustosCalculados = {
    secao_1_projetos,
    secao_2_taxas,
    secao_3_honorarios,
    condicoes_pagamento,
    base_calculo,
    secao_4_checklist,
    secao_5_total,
    avisos,
  };

  return { custos, fontes };
}
