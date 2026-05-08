// v1.99.5: motor de calculo de Desmembramento e Remembramento.
//
// Base normativa:
//   - Lei 6.766/1979 (Parcelamento do Solo Urbano) — desmembramento urbano
//   - Lei 4.504/1964 (Estatuto da Terra) — desmembramento rural
//   - Lei 6.015/1973 (Registros Publicos) — averbacao em matricula
//   - Codigo Civil arts. 1.297/1.298 — divisas e confrontantes
//
// Desmembramento: 1 matricula -> N lotes resultantes
//   Exige aprovacao da Prefeitura (zoneamento, lotes minimos, infraestrutura)
//   Cada lote vira nova matricula
//
// Remembramento: N matriculas -> 1 unica
//   Simplificado, geralmente nao exige aprovacao Prefeitura
//   Memorial unificado, cancela matriculas origem e abre uma so
//
// Honorarios (regra confirmada CEO):
//   Projeto      = 0.5 ou 1.0 SM (escolha do cliente — pacote basico vs completo)
//   Assessoria   = 1 SM (universal)
//
// Taxas de terceiros:
//   ART CREA-MA = R$ 93,40
//   Emolumentos cartorio (TJMA — averbacao por matricula afetada)
//   Aprovacao Prefeitura — so desmembramento, valor null = a confirmar

import type {
  InputDesmembramento,
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

// ── Pacote de servicos por subtipo (Secao 1) ────────────────────────────────
const ESCOPO_DESMEMBRAMENTO = [
  'Levantamento topografico do imovel matriz',
  'Projeto urbanistico do desmembramento (memorial + planta de cada lote resultante)',
  'Memoriais descritivos individualizados (um por lote)',
  'Coordenadas de cada vertice da poligonal de cada lote',
  'Submissao do projeto a Prefeitura para aprovacao (zoneamento, infraestrutura, lotes minimos)',
  'Acompanhamento da analise municipal ate o despacho aprovatorio',
  'Protocolo no cartorio competente para cancelamento da matricula matriz e abertura das novas matriculas',
  'Acompanhamento ate emissao das novas matriculas individualizadas',
];

const ESCOPO_REMEMBRAMENTO = [
  'Levantamento topografico das matriculas a serem unificadas',
  'Memorial descritivo unificado (poligonal resultante)',
  'Planta georreferenciada da nova area unificada',
  'Verificacao de divisas e confrontantes da area resultante',
  'Protocolo em cartorio para cancelamento das matriculas origem',
  'Abertura da nova matricula unica unificada',
  'Acompanhamento ate registro final',
];

export async function calcularDesmembramento(
  input: InputDesmembramento,
): Promise<ResultadoCalculo> {
  const params = getParams();
  const sm = salarioMinimo();
  const hp = params.honorarios_projeto;
  const isDesm = input.tipo === 'desmembramento';

  // Validacoes
  if (!Number.isFinite(input.area_total_m2) || input.area_total_m2 <= 0) {
    throw new Error('area_total_m2 deve ser > 0');
  }
  if (!Number.isFinite(input.valor_venal_total) || input.valor_venal_total < 0) {
    throw new Error('valor_venal_total invalido');
  }
  if (isDesm && (!input.numero_lotes_resultantes || input.numero_lotes_resultantes < 2)) {
    throw new Error('Desmembramento exige numero_lotes_resultantes >= 2');
  }
  if (!isDesm && (!input.numero_lotes_origem || input.numero_lotes_origem < 2)) {
    throw new Error('Remembramento exige numero_lotes_origem >= 2');
  }

  const numeroMatriculasAfetadas = isDesm
    ? (input.numero_lotes_resultantes ?? 0) + 1 // matriz + N novas
    : (input.numero_lotes_origem ?? 0) + 1;     // N origem + 1 nova

  // ── Secao 1: escopo ──────────────────────────────────────────────────────
  const secao_1_projetos = isDesm ? [...ESCOPO_DESMEMBRAMENTO] : [...ESCOPO_REMEMBRAMENTO];

  // ── Secao 2: taxas e emolumentos de terceiros ───────────────────────────
  const secao_2_taxas: ItemCusto[] = [];
  const fontes: FontesConsulta = {};
  let ordem = 1;

  // 1. Anotacao tecnica
  const at = anotacaoTecnica('art_crea');
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: at.rotulo,
    valor: at.valor,
    observacao: at.fonte,
  });

  // 2. Emolumentos cartorarios — averbacao em cada matricula afetada
  // Estima por matricula afetada usando faixa proporcional ao valor venal
  try {
    const valorPorMatricula = Math.max(input.valor_venal_total / numeroMatriculasAfetadas, 30000);
    const emol = await calcularEmolumentos('averbacao_construcao', valorPorMatricula);
    const totalEmol = emol.valor * numeroMatriculasAfetadas;
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: `Emolumentos cartorarios — ${numeroMatriculasAfetadas} matricula(s) afetada(s)${isDesm ? ' (cancelamento da matriz + abertura das novas)' : ' (cancelamento das origem + abertura da unificada)'}`,
      valor: totalEmol,
      observacao: `R$ ${emol.valor.toFixed(2)} × ${numeroMatriculasAfetadas} matriculas | ${emol.base_calculo}`,
    });
    fontes.tjma = { fonte: emol.fonte, consultadoEm: emol.consultadoEm.toISOString() };
  } catch (err) {
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios (cancelamento e abertura de matriculas)',
      valor: 0,
      pendente: true,
      observacao: `A confirmar em cartorio. ${(err as Error).message}`,
    });
  }

  // 3. Aprovacao Prefeitura — so desmembramento e em zona urbana
  if (isDesm && input.tipo_zona === 'urbana') {
    const taxaPref = params.prefeitura_acailandia.aprovacao_desmembramento;
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Taxa de Aprovacao do Desmembramento — Prefeitura de Acailandia',
      valor: taxaPref ?? 0,
      pendente: taxaPref === null,
      observacao: taxaPref === null
        ? 'A confirmar com a Secretaria de Obras/Planejamento da Prefeitura. Costuma ser proporcional ao numero de lotes ou area total.'
        : `Conforme taxa vigente em Acailandia/MA`,
    });
  }

  // ── Secao 3: honorarios Romatec ─────────────────────────────────────────
  // Pacote basico (0.5 SM) ou completo (1.0 SM) — escolha do cliente.
  // Multiplica pelo numero de lotes (desmembramento) ou matriculas origem (remembramento)
  const fatorSM = input.honorario_projeto_sm; // 0.5 ou 1.0
  const numeroLotes = isDesm ? (input.numero_lotes_resultantes ?? 0) : (input.numero_lotes_origem ?? 0);
  const honorario_projeto = sm * fatorSM * numeroLotes;
  const honorario_assessoria = sm * params.honorarios_assessoria.padrao_sm;

  const obsHonProjeto = `${fatorSM} SM × ${numeroLotes} lote(s) ${isDesm ? 'resultante(s)' : 'origem'} = R$ ${honorario_projeto.toFixed(2)} (1 SM = R$ ${sm.toFixed(2)})`;

  const secao_3_honorarios: ItemCusto[] = [
    {
      ordem: ordem++,
      descricao: isDesm
        ? 'Honorarios de Projeto Urbanistico de Desmembramento — levantamento topografico, projeto, memorial descritivo de cada lote, planta, ARTs e responsabilidade tecnica'
        : 'Honorarios de Projeto de Remembramento — levantamento topografico das matriculas, memorial unificado, planta resultante, ARTs e responsabilidade tecnica',
      valor: honorario_projeto,
      observacao: obsHonProjeto,
    },
    {
      ordem: ordem++,
      descricao: 'Honorarios de Assessoria e Acompanhamento — diligencias na Prefeitura (se aplicavel), protocolo em cartorio, acompanhamento ate emissao das matriculas finais',
      valor: honorario_assessoria,
      observacao: `1 salario minimo 2026 (R$ ${sm.toFixed(2)})`,
    },
  ];

  // ── Secao 4: checklist documentos ───────────────────────────────────────
  const secao_4_checklist: DocumentoChecklist[] = [
    {
      texto: isDesm
        ? 'Certidao de Inteiro Teor da Matricula MATRIZ — ATUALIZADA (max. 30 dias)'
        : `Certidoes de Inteiro Teor das ${input.numero_lotes_origem ?? 'todas as'} matriculas a unificar — ATUALIZADAS (max. 30 dias)`,
      obrigatorio: true,
    },
    {
      texto: 'IPTU em dia (todos os exercicios) — comprovantes',
      obrigatorio: true,
      imprescindivel: true, // destaque vermelho — Prefeitura recusa sem isso
    },
    { texto: 'RG/CPF de todos os proprietarios (e conjuges, se for o caso)', obrigatorio: true },
    { texto: 'Comprovante de residencia atualizado dos proprietarios', obrigatorio: true },
    { texto: 'Anuencia de confrontantes (assinaturas dos vizinhos na planta da nova divisao)', obrigatorio: true, imprescindivel: isDesm },
  ];

  if (isDesm) {
    secao_4_checklist.push(
      { texto: 'Certidao de zoneamento da Prefeitura (constando ZONA permitida pra parcelamento)', obrigatorio: true },
      { texto: 'Certidao de viabilidade urbanistica (se exigido pelo municipio)', obrigatorio: false },
    );
  }

  secao_4_checklist.push(
    { texto: 'CCIR + ITR em dia (se imovel rural)', obrigatorio: input.tipo_zona === 'rural' },
    { texto: 'CAR (Cadastro Ambiental Rural) — se imovel rural', obrigatorio: input.tipo_zona === 'rural' },
    { texto: 'Eventuais onus, hipotecas ou usufrutos averbados (declaracao)', obrigatorio: false },
  );

  // ── Secao 5: total ──────────────────────────────────────────────────────
  const total_taxas = secao_2_taxas.reduce((s, i) => s + i.valor, 0);
  const total_honorarios = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
  const secao_5_total = total_taxas + total_honorarios;

  // ── Avisos legais ───────────────────────────────────────────────────────
  const avisos: string[] = [];

  if (isDesm) {
    avisos.push(
      'BASE LEGAL DESMEMBRAMENTO: Lei 6.766/1979 (Parcelamento do Solo Urbano) — exige aprovacao previa da Prefeitura, lotes minimos conforme zoneamento (geralmente 125m² em zona urbana de Acailandia), e infraestrutura compativel. Cada lote resultante vira matricula propria no cartorio.'
    );
    avisos.push(
      'PRAZO ESTIMADO: levantamento (5-10 dias), projeto e memoriais (5-10 dias), analise Prefeitura (30-90 dias), protocolo cartorio (15-30 dias). Total tipico: 60-150 dias.'
    );
  } else {
    avisos.push(
      'BASE LEGAL REMEMBRAMENTO: Lei 6.015/1973 (Registros Publicos) art. 234 — unificacao de matriculas contiguas pertencentes ao mesmo proprietario. Mais simples que desmembramento, geralmente sem analise municipal.'
    );
    avisos.push(
      'IMPORTANTE: as matriculas a unificar devem (1) ser CONTIGUAS, (2) pertencer ao MESMO proprietario, (3) estar livres de onus reais ou ter anuencia dos credores. Verificacao previa obrigatoria.'
    );
    avisos.push(
      'PRAZO ESTIMADO: levantamento (3-7 dias), memorial unificado (3-5 dias), protocolo cartorio (15-30 dias). Total tipico: 30-60 dias.'
    );
  }

  if (!input.iptu_em_dia) {
    avisos.push(
      'ATENCAO IPTU: o IPTU em dia e PRE-REQUISITO ABSOLUTO. Sem comprovacao de quitacao do exercicio atual e dos 5 anteriores, a Prefeitura e o cartorio recusam a operacao. Regularize antes do protocolo.'
    );
  }

  avisos.push(
    'IMPORTANTE: Os valores das taxas de Cartorio e Prefeitura sao APROXIMADOS, baseados em estimativas. Os valores definitivos podem variar conforme apuracao no momento do protocolo.'
  );

  if (input.tipo_zona === 'urbana') {
    avisos.push(
      'SENHA GOV.BR: o sistema da Receita Federal pode exigir consultas tributarias durante o tramite. A Romatec orienta o cliente a manter conta gov.br nivel prata/ouro ativa pra eventual emissao de certidoes negativas.'
    );
  }

  const itensPendentes = secao_2_taxas.filter(i => i.pendente).map(i => i.descricao);
  if (itensPendentes.length > 0) {
    avisos.push(`Itens pendentes de confirmacao: ${itensPendentes.join(', ')}.`);
    fontes.prefeitura = { itens_pendentes: itensPendentes };
  }

  // ── Condicoes de pagamento ──────────────────────────────────────────────
  // Desm: 50% Projeto + 50% Assessoria na assinatura | restante na aprovacao Prefeitura
  // Rem: 100% Projeto + 50% Assessoria na assinatura | 50% Assessoria no protocolo cartorio
  let condicoes_pagamento: CondicaoPagamento[];
  if (isDesm) {
    condicoes_pagamento = [
      {
        rotulo: '1a parcela — na assinatura da proposta',
        descricao: '50% dos Honorarios de Projeto + 50% dos Honorarios de Assessoria',
        valor: honorario_projeto * 0.5 + honorario_assessoria * 0.5,
      },
      {
        rotulo: '2a parcela — na aprovacao do desmembramento pela Prefeitura',
        descricao: '50% restante dos Honorarios de Projeto',
        valor: honorario_projeto * 0.5,
      },
      {
        rotulo: '3a parcela — no protocolo final em cartorio',
        descricao: '50% restante dos Honorarios de Assessoria',
        valor: honorario_assessoria * 0.5,
      },
    ];
  } else {
    condicoes_pagamento = [
      {
        rotulo: '1a parcela — na assinatura da proposta',
        descricao: '100% dos Honorarios de Projeto + 50% dos Honorarios de Assessoria',
        valor: honorario_projeto + honorario_assessoria * 0.5,
      },
      {
        rotulo: '2a parcela — no protocolo em cartorio',
        descricao: '50% restante dos Honorarios de Assessoria',
        valor: honorario_assessoria * 0.5,
      },
    ];
  }

  // ── Base de calculo ─────────────────────────────────────────────────────
  const base_calculo: BaseCalculo[] = [
    {
      rotulo: 'Honorarios de Projeto',
      formula: `${fatorSM} SM × ${numeroLotes} ${isDesm ? 'lote(s) resultante(s)' : 'matricula(s) origem'} × R$ ${sm.toFixed(2)}`,
      valor_resultado: honorario_projeto,
    },
    {
      rotulo: 'Honorarios de Assessoria',
      formula: `1 SM × R$ ${sm.toFixed(2)}`,
      valor_resultado: honorario_assessoria,
    },
    {
      rotulo: 'Total Romatec',
      formula: 'Projeto + Assessoria',
      valor_resultado: honorario_projeto + honorario_assessoria,
    },
  ];

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
