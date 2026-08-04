// v1.99.6: motor de calculo de Retificacao de Area.
//
// Base normativa:
//   - Lei 10.931/2004 art. 213 — Retificacao ADMINISTRATIVA (mais comum,
//     quando ha anuencia de TODOS os confrontantes)
//   - Lei 6.015/1973 art. 213 e seguintes — Retificacao JUDICIAL (quando
//     algum confrontante recusa anuencia ou ha litigio sobre divisas)
//   - NBR 13133 (Execucao de Levantamento Topografico)
//
// Diferencas chave:
//   ADMINISTRATIVA — ~30-90 dias, custo menor, exige anuencia 100% confrontantes
//   JUDICIAL       — ~6-24 meses, custas processuais + advogado, sem anuencia
//
// Honorarios (regra confirmada CEO):
//   Projeto      = 1 SM (padrao) ou customizavel
//   Assessoria   = 1 SM (universal)
//
// Taxas de terceiros:
//   ART CREA-MA = R$ 93,40
//   Emolumentos cartorio (averbacao da retificacao na matricula)
//   Custas judiciais (somente quando tipo=judicial; valor estimado, depende
//   do estado e do valor venal do imovel — cliente paga direto pelo TJMA/ad'co)

import type {
  InputRetificacao,
  ResultadoCalculo,
  CustosCalculados,
  FontesConsulta,
  ItemCusto,
  DocumentoChecklist,
  CondicaoPagamento,
  BaseCalculo,
} from './types';
import { calcularEmolumentos } from '../tjma';
import { getParams, salarioMinimo, anotacaoTecnica } from './params';

const ESCOPO_ADMINISTRATIVA = [
  'Levantamento topografico do imovel',
  'Calculo da area real (poligonal fechada)',
  'Memorial descritivo retificador',
  'Planta com a poligonal correta',
  'Coleta de anuencia de todos os confrontantes',
  'Protocolo do procedimento administrativo no cartorio',
  'Acompanhamento ate decisao do oficial registrador',
  'Averbacao da retificacao na matricula',
];

const ESCOPO_JUDICIAL = [
  'Levantamento topografico do imovel',
  'Calculo da area real (poligonal fechada)',
  'Memorial descritivo retificador',
  'Planta com a poligonal correta',
  'Tentativa de obtencao de anuencia dos confrontantes (etapa premissa)',
  'Petição inicial de retificacao judicial (parceria com advogado)',
  'Acompanhamento processual ate sentenca transitada em julgado',
  'Cumprimento de sentenca e averbacao na matricula',
];

export async function calcularRetificacao(
  input: InputRetificacao,
): Promise<ResultadoCalculo> {
  const params = getParams();
  const sm = salarioMinimo();
  const hp = params.honorarios_projeto;
  const isJudicial = input.tipo_retificacao === 'judicial';

  // Validacoes
  if (!Number.isFinite(input.area_atual_matricula) || input.area_atual_matricula <= 0) {
    throw new Error('area_atual_matricula deve ser > 0');
  }
  // v3.133.0: quando a area real so' sera' conhecida apos o levantamento geo,
  // nao exige area_real_levantada nem calcula divergencia (a apurar pos-aprovacao).
  const aApurar = !!input.area_real_a_apurar;
  if (!aApurar && (!Number.isFinite(input.area_real_levantada) || input.area_real_levantada <= 0)) {
    throw new Error('area_real_levantada deve ser > 0 (ou marque "área real a apurar após levantamento")');
  }

  const divergencia = aApurar ? 0 : Math.abs(input.area_real_levantada - input.area_atual_matricula);
  const percentualDivergencia = aApurar ? 0 : (divergencia / input.area_atual_matricula) * 100;

  // ── Secao 1: escopo ─────────────────────────────────────────────────────
  const secao_1_projetos = isJudicial ? [...ESCOPO_JUDICIAL] : [...ESCOPO_ADMINISTRATIVA];

  // ── Secao 2: taxas e emolumentos ───────────────────────────────────────
  const secao_2_taxas: ItemCusto[] = [];
  const fontes: FontesConsulta = {};
  let ordem = 1;

  // 1. Anotacao tecnica selecionavel (ART CREA / RRT CAU / TRT CFT)
  // v3.133.0: antes travado em 'art_crea'; agora respeita a escolha do usuario.
  const at = anotacaoTecnica(input.anotacao_tecnica || 'art_crea');
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: at.rotulo,
    valor: at.valor,
    observacao: at.fonte,
  });

  // 2. Emolumentos cartorarios
  try {
    const emol = await calcularEmolumentos('averbacao_construcao', input.valor_venal);
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios (averbacao da retificacao de area na matricula)',
      valor: emol.valor,
      observacao: emol.base_calculo,
    });
    fontes.tjma = { fonte: emol.fonte, consultadoEm: emol.consultadoEm.toISOString() };
  } catch (err) {
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios (averbacao da retificacao)',
      valor: 0,
      pendente: true,
      observacao: `A confirmar em cartorio. ${(err as Error).message}`,
    });
  }

  // 3. Custas judiciais (somente quando judicial)
  if (isJudicial) {
    // Estimativa: ~1.5% do valor venal pra TJMA + advogado contratado a parte
    // Esta linha e APENAS o estimado de custas processuais (taxa judiciaria)
    const custasEstimadas = input.valor_venal * 0.015;
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Custas judiciais TJMA (taxa judiciaria) — ESTIMATIVA',
      valor: custasEstimadas,
      observacao: 'Estimado em 1,5% do valor venal. Valor exato apurado no protocolo da inicial. Pode haver isencao se cliente comprovar hipossuficiencia.',
    });
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Honorarios advocaticios (contratacao a parte)',
      valor: 0,
      pendente: true,
      observacao: 'A Romatec NAO inclui honorarios advocaticios. Cliente contrata advogado de confianca diretamente. Tipico: 10-20% do valor venal ou valor fixo.',
    });
  }

  // ── Secao 3: honorarios Romatec ────────────────────────────────────────
  const fatorSM = input.honorario_projeto_sm ?? hp.retificacao_area_sm_default;
  const honorario_projeto = sm * fatorSM;
  const honorario_assessoria = sm * params.honorarios_assessoria.padrao_sm;

  // Judicial dobra o trabalho de assessoria (acompanhamento processual longo)
  const fatorAssessoriaJudicial = isJudicial ? 2.0 : 1.0;
  const honorario_assessoria_total = honorario_assessoria * fatorAssessoriaJudicial;

  const obsHonProjeto = `${fatorSM} SM × R$ ${sm.toFixed(2)} = R$ ${honorario_projeto.toFixed(2)} (Tipo ${isJudicial ? 'JUDICIAL' : 'ADMINISTRATIVA'} — divergencia ${aApurar ? 'a apurar apos levantamento' : percentualDivergencia.toFixed(2) + '%'})`;
  const obsHonAssessoria = isJudicial
    ? `1 SM × 2.0 (acompanhamento processual estendido — judicial) = R$ ${honorario_assessoria_total.toFixed(2)}`
    : `1 SM × R$ ${sm.toFixed(2)}`;

  const secao_3_honorarios: ItemCusto[] = [
    {
      ordem: ordem++,
      descricao: 'Honorarios Tecnicos de Retificacao — levantamento topografico, calculo de area real, memorial retificador, planta, ART e responsabilidade tecnica',
      valor: honorario_projeto,
      observacao: obsHonProjeto,
    },
    {
      ordem: ordem++,
      descricao: isJudicial
        ? 'Honorarios de Assessoria Tecnica Processual — acompanhamento ao longo do processo, eventuais pericias, complementos solicitados pelo juizo, ate cumprimento da sentenca'
        : 'Honorarios de Assessoria Administrativa — coleta de anuencias, diligencias junto a confrontantes, protocolo cartorio, acompanhamento ate averbacao final',
      valor: honorario_assessoria_total,
      observacao: obsHonAssessoria,
    },
  ];

  // ── Secao 4: checklist documentos ──────────────────────────────────────
  const secao_4_checklist: DocumentoChecklist[] = [
    {
      texto: 'Certidao de Inteiro Teor da Matricula — ATUALIZADA (max. 30 dias)',
      obrigatorio: true,
      imprescindivel: true,
    },
    { texto: 'IPTU em dia (todos exercicios) — comprovantes', obrigatorio: true },
    { texto: 'RG/CPF do proprietario (e conjuge se for o caso)', obrigatorio: true },
    { texto: 'Comprovante de residencia atualizado', obrigatorio: true },
    {
      texto: isJudicial
        ? 'Documentos comprobatorios da impossibilidade de obter anuencia administrativa (ex: notificacoes recusadas)'
        : 'Anuencia escrita e assinada de TODOS os confrontantes (essencial pra via administrativa)',
      obrigatorio: true,
      imprescindivel: !isJudicial,
    },
    { texto: 'Plantas, medicoes ou levantamentos anteriores (se houver)', obrigatorio: false },
  ];

  if (isJudicial) {
    secao_4_checklist.push(
      { texto: 'Procuracao ad judicia ao advogado contratado', obrigatorio: true },
      { texto: 'Documentos pessoais dos confrontantes (RG/CPF/endereco) pra citacao', obrigatorio: true },
    );
  }

  // ── Secao 5: total ──────────────────────────────────────────────────────
  const total_taxas = secao_2_taxas.reduce((s, i) => s + i.valor, 0);
  const total_honorarios = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
  const secao_5_total = total_taxas + total_honorarios;

  // ── Avisos legais ──────────────────────────────────────────────────────
  const avisos: string[] = [];

  if (isJudicial) {
    avisos.push(
      'BASE LEGAL JUDICIAL: Lei 6.015/1973 art. 213 e seguintes (Codigo de Processo Civil). Retificacao judicial e o caminho quando ha discordancia de confrontantes ou litigio sobre divisas.'
    );
    avisos.push(
      'PRAZO ESTIMADO: 6 a 24 meses, dependendo da Vara de Registros Publicos do TJMA, da contestacao dos confrontantes e da producao probatoria. A Romatec nao tem controle sobre o prazo do Judiciario.'
    );
    avisos.push(
      'IMPORTANTE: a Romatec atua APENAS como ASSISTENTE TECNICO do processo (laudo, pericia, esclarecimentos). O advogado que conduz a acao e contratado a parte pelo cliente. Honorarios advocaticios NAO estao inclusos nesta proposta.'
    );
  } else {
    avisos.push(
      'BASE LEGAL ADMINISTRATIVA: Lei 10.931/2004 (alterou a Lei 6.015/1973). Permite retificacao perante o oficial do registro de imoveis, sem necessidade de processo judicial, desde que com anuencia de TODOS os confrontantes.'
    );
    avisos.push(
      'PRAZO ESTIMADO: 30 a 90 dias, dependendo do tempo de coleta de anuencias e da analise do registrador.'
    );
    avisos.push(
      'ATENCAO: caso 1 ou mais confrontantes RECUSEM a assinatura da anuencia, o procedimento administrativo e EXTINTO e a unica via passa a ser a JUDICIAL — caso para o qual sera elaborado novo orcamento.'
    );
  }

  if (aApurar) {
    avisos.push(
      'AREA REAL A APURAR: a area real definitiva sera obtida no levantamento geo/topografico apos a aprovacao desta proposta. A divergencia frente a matricula e os emolumentos de averbacao poderao ser recalculados quando a medicao estiver concluida.'
    );
  } else if (percentualDivergencia > 5) {
    avisos.push(
      `DIVERGENCIA CONSIDERAVEL: ${percentualDivergencia.toFixed(2)}% entre area da matricula e area real. Confrontantes podem questionar — recomenda-se reuniao previa de conciliacao antes de protocolar.`
    );
  }

  if (!input.tem_anuencia_confrontantes && !isJudicial) {
    avisos.push(
      'ANUENCIA DOS CONFRONTANTES PENDENTE: voce indicou que ainda nao tem as anuencias. A Romatec presta apoio na elaboracao das notificacoes e visita aos confrontantes, mas a coleta efetiva e responsabilidade do cliente. Sem 100% das anuencias, a via administrativa nao prospera.'
    );
  }

  avisos.push(
    'IMPORTANTE: os valores de cartorio sao aproximados. Custas judiciais (se aplicavel) sao fixadas pelo TJMA no momento do protocolo da inicial.'
  );

  // ── Condicoes de pagamento ──────────────────────────────────────────────
  let condicoes_pagamento: CondicaoPagamento[];
  if (isJudicial) {
    condicoes_pagamento = [
      {
        rotulo: '1a parcela — na assinatura',
        descricao: '100% Honorarios Tecnicos + 50% Honorarios de Assessoria',
        valor: honorario_projeto + honorario_assessoria_total * 0.5,
      },
      {
        rotulo: '2a parcela — na sentenca de procedencia',
        descricao: '50% restante dos Honorarios de Assessoria',
        valor: honorario_assessoria_total * 0.5,
      },
    ];
  } else {
    condicoes_pagamento = [
      {
        rotulo: '1a parcela — na assinatura',
        descricao: '50% Honorarios Tecnicos + 50% Honorarios de Assessoria',
        valor: honorario_projeto * 0.5 + honorario_assessoria_total * 0.5,
      },
      {
        rotulo: '2a parcela — na coleta das anuencias',
        descricao: '50% restante dos Honorarios Tecnicos',
        valor: honorario_projeto * 0.5,
      },
      {
        rotulo: '3a parcela — na averbacao final no cartorio',
        descricao: '50% restante dos Honorarios de Assessoria',
        valor: honorario_assessoria_total * 0.5,
      },
    ];
  }

  // ── Base de calculo ─────────────────────────────────────────────────────
  const base_calculo: BaseCalculo[] = [
    {
      rotulo: 'Area atual (matricula)',
      formula: `${input.area_atual_matricula.toFixed(2)} m² ou hectares conforme matricula`,
      valor_resultado: input.area_atual_matricula,
    },
    {
      rotulo: 'Area real (levantada GPS/Estacao)',
      formula: aApurar ? 'A apurar no levantamento geo/topografico apos aprovacao' : `${input.area_real_levantada.toFixed(2)} m² ou hectares medidos`,
      valor_resultado: aApurar ? 0 : input.area_real_levantada,
    },
    {
      rotulo: 'Divergencia',
      formula: aApurar ? 'A apurar apos o levantamento' : `${divergencia.toFixed(2)} (${percentualDivergencia.toFixed(2)}%)`,
      valor_resultado: divergencia,
    },
    {
      rotulo: 'Honorarios Tecnicos',
      formula: `${fatorSM} SM × R$ ${sm.toFixed(2)}`,
      valor_resultado: honorario_projeto,
    },
    {
      rotulo: 'Honorarios de Assessoria',
      formula: isJudicial ? `2 × 1 SM × R$ ${sm.toFixed(2)} (judicial estendido)` : `1 SM × R$ ${sm.toFixed(2)}`,
      valor_resultado: honorario_assessoria_total,
    },
  ];

  // v3.133.0: diligencias e tributos (taxa de retificacao, IPTU, CND) — estimativa
  // editavel, secao separada no PDF, NAO soma ao secao_5_total (mesmo mecanismo do
  // desmembramento).
  const despesasAdm = (input.despesas_administrativas?.habilitada)
    ? (() => {
        const da = input.despesas_administrativas!;
        // v3.134.0: itens[] (diligências) — filtra válidos; total = soma dos itens
        // (ou o valor manual, se não vierem itens).
        const itens = (da.itens ?? [])
          .filter(i => i && i.rotulo?.trim() && Number.isFinite(i.valor) && i.valor >= 0)
          .map(i => ({ rotulo: i.rotulo.trim(), valor: Number(i.valor) }));
        const valor = itens.length
          ? +itens.reduce((s, i) => s + i.valor, 0).toFixed(2)
          : Number(da.valor ?? 0);
        const descritivo = (da.descritivo ?? '').trim();
        if (!Number.isFinite(valor) || valor < 0) {
          throw new Error('despesas_administrativas.valor inválido');
        }
        if (!descritivo && itens.length === 0) {
          throw new Error('despesas_administrativas: informe descritivo ou ao menos 1 item');
        }
        return { valor, descritivo, ...(itens.length ? { itens } : {}) };
      })()
    : undefined;

  const custos: CustosCalculados = {
    secao_1_projetos,
    secao_2_taxas,
    secao_3_honorarios,
    condicoes_pagamento,
    base_calculo,
    secao_4_checklist,
    secao_5_total,
    avisos,
    ...(despesasAdm ? { despesas_administrativas: despesasAdm } : {}),
  };

  return { custos, fontes };
}
