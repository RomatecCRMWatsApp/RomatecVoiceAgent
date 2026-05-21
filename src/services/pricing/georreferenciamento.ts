// v1.99.4: motor de calculo de Georreferenciamento Rural (INCRA/SIGEF).
// v3.23.5: alinhado ao modelo aprovado PROP-2026-0011-R1.
//
// Mudancas v3.23.5 vs v1.99.4:
//   - Anotacao tecnica trocada de ART CREA -> TRT CFT (CFT/MA, valor R$ 93,40)
//   - TRT agora vai em secao_3_honorarios (linha 1, Romatec) — NAO mais em secao_2_taxas (terceiros)
//   - secao_5_total = TRT + Tecnicos + Assessoria (so Romatec). Emolumentos
//     cartorio e SIGEF permanecem em secao_2_taxas mas como INFORMATIVO (a cargo
//     do cliente, fora do total). Isso bate com box "VALOR TOTAL (Romatec)" + box
//     "Custos de Terceiros nao inclusos" do PDF aprovado.
//   - Novos inputs opcionais: finalidade, matricula, cri, perimetro_m, opcionais
//   - Linha condicional em secao_2_taxas: "Emolumentos — encerramento/abertura
//     de matricula" quando finalidade in {DESMEMBRAMENTO, REMEMBRAMENTO}
//   - Guard round2(p1+p2+p3) === round2(total_romatec) — falha em fechamento
//     significa bug no calc, melhor crashar cedo do que mandar PDF errado
//   - secao_opcionais_georref (CCIR, CAR, ITR, anuencia, retif) — sempre renderiza
//     5 linhas, contratado ou nao. Subtotal proprio, NAO entra em secao_5_total
//
// Base normativa:
//   - Lei 10.267/2001 (Cadastro Nacional Imoveis Rurais — CNIR)
//   - NTGIR 3a Edicao (Norma Tecnica Georreferenciamento INCRA)
//   - Resolucao CONFEA 1.108/2020 (servicos de Engenharia Cartografica)
//   - Lei 6.015/1973 (Registro Publico — averbacao do memorial certificado)

import type {
  InputGeorreferenciamento,
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

// Pacote de servicos do GEO Rural (Secao 1 — 8 itens fixos do modelo aprovado)
const ESCOPO_GEO_RURAL = [
  'Levantamento topografico georreferenciado (GNSS RTK / Estacao Total)',
  'Marcacao fisica e coleta de coordenadas WGS84/SIRGAS2000 nos vertices da poligonal',
  'Calculo analitico de area e perimetro com fechamento dentro da tolerancia NBR 13133',
  'Memorial Descritivo conforme NTGIR 3a Edicao (INCRA)',
  'Planta georreferenciada com poligonal, confrontantes e quadro de coordenadas',
  'Submissao ao SIGEF/INCRA com certificado digital',
  'Acompanhamento de exigencias ate a certificacao final pelo INCRA',
  'Apoio ao protocolo de averbacao do memorial certificado no Cartorio',
];

// HALF_UP em 2 casas — JS arredondamento padrao usa banker's; aqui forcamos
// pra garantir que 0.005 sobe (importante pra fechar p1+p2+p3 === total).
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function calcularGeorreferenciamento(
  input: InputGeorreferenciamento,
): Promise<ResultadoCalculo> {
  const params = getParams();
  const sm = salarioMinimo();
  const hp = params.honorarios_projeto;

  // Validacoes minimas
  if (!Number.isFinite(input.area_hectares) || input.area_hectares <= 0) {
    throw new Error('area_hectares deve ser > 0');
  }
  if (!Number.isFinite(input.numero_vertices) || input.numero_vertices < 3) {
    throw new Error('numero_vertices deve ser >= 3 (poligonal minima)');
  }
  if (input.complexidade !== 'simples' &&
      input.complexidade !== 'media' &&
      input.complexidade !== 'alta') {
    throw new Error(`complexidade invalida: ${input.complexidade} (esperado: simples | media | alta)`);
  }

  // ── Secao 1: escopo do servico ──────────────────────────────────────────
  const secao_1_projetos = [...ESCOPO_GEO_RURAL];

  // ── Secao 2: taxas e emolumentos de terceiros (INFORMATIVO — pago pelo cliente)
  // v3.23.5: TRT saiu daqui (foi pra secao_3 — Romatec). Aqui ficam SO emolumentos
  // de cartorio, SIGEF (gratuito) e linha condicional pra DESM/REM.
  const secao_2_taxas: ItemCusto[] = [];
  const fontes: FontesConsulta = {};
  let ordem = 1;

  // 1. Emolumentos cartorio — averbacao do memorial certificado
  const valorEstimadoImovel = Math.max(input.area_hectares * 5000, 50000);
  try {
    const emol = await calcularEmolumentos('averbacao_construcao', valorEstimadoImovel);
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios — averbacao do memorial certificado',
      valor: emol.valor,
      observacao: `Tabela TJMA Res. 143/2025 | Estimativa baseada em area x R$ 5.000/ha`,
    });
    fontes.tjma = { fonte: emol.fonte, consultadoEm: emol.consultadoEm.toISOString() };
  } catch (err) {
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios — averbacao do memorial certificado',
      valor: 0,
      pendente: true,
      observacao: `A confirmar em cartorio competente. Erro consulta: ${(err as Error).message}`,
    });
  }

  // 1b. Linha condicional: finalidade DESM/REM adiciona emolumentos extras de
  // encerramento/abertura de matricula. Valor "A apurar" (varia caso a caso).
  if (input.finalidade === 'DESMEMBRAMENTO' || input.finalidade === 'REMEMBRAMENTO') {
    secao_2_taxas.push({
      ordem: ordem++,
      descricao:
        input.finalidade === 'DESMEMBRAMENTO'
          ? 'Emolumentos cartorarios — encerramento da matricula atual + abertura de nova matricula'
          : 'Emolumentos cartorarios — unificacao das matriculas em matricula unica',
      valor: 0,
      pendente: true,
      observacao: 'A apurar no Cartorio competente conforme tabela TJMA vigente',
    });
  }

  // 2. Certificacao SIGEF/INCRA — gratuita oficialmente
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: 'Certificacao SIGEF/INCRA',
    valor: 0,
    observacao: 'Gratuita por lei (Lei 10.267/2001). Tempo medio analise INCRA: 60-180 dias.',
  });

  // 3. Outros servicos opcionais informados pelo cliente (legado v1.99.4)
  if (input.valor_outros_servicos > 0) {
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Outros servicos / despesas especificas do projeto',
      valor: input.valor_outros_servicos,
      observacao: 'Conforme acordado com o cliente (taxas extras, certidoes, deslocamentos especiais)',
    });
  }

  // ── Secao 3: honorarios Romatec — TRT + Tecnicos + Assessoria (3 linhas)
  // v3.23.5: TRT entrou aqui (linha 1). Antes estava em secao_2_taxas.

  // Permite override pelos valores do input
  const valorPorHectare = input.valor_por_hectare > 0 ? input.valor_por_hectare : hp.geo_rural_por_hectare;
  const valorPorVertice = input.valor_por_vertice > 0 ? input.valor_por_vertice : hp.geo_rural_por_vertice;
  const valorDiaria     = input.valor_diaria_campo > 0 ? input.valor_diaria_campo : hp.geo_rural_diaria_campo;
  const valorPorKm      = input.valor_km_deslocamento > 0 ? input.valor_km_deslocamento : hp.geo_rural_por_km_deslocamento;

  const subtotal_area     = round2(input.area_hectares * valorPorHectare);
  const subtotal_vertices = round2(input.numero_vertices * valorPorVertice);
  const subtotal_diarias  = round2((input.numero_diarias || 0) * valorDiaria);
  const subtotal_km       = round2((input.distancia_km || 0) * valorPorKm);
  const subtotal_campo    = round2(subtotal_area + subtotal_vertices + subtotal_diarias + subtotal_km);

  const multiplicador =
    input.complexidade === 'alta'  ? hp.geo_rural_complexidade_alta  :
    input.complexidade === 'media' ? hp.geo_rural_complexidade_media :
                                     hp.geo_rural_complexidade_simples;

  let honorario_tecnico = round2(subtotal_campo * multiplicador);

  const minimoGarantido = round2(sm * hp.geo_rural_minimo_sm);
  let aplicouMinimo = false;
  if (honorario_tecnico < minimoGarantido) {
    honorario_tecnico = minimoGarantido;
    aplicouMinimo = true;
  }

  const honorario_assessoria = round2(sm * params.honorarios_assessoria.padrao_sm);

  // v3.23.5: TRT — opção (B) da resposta do CEO. Agora usa trt_cft (R$ 93,40)
  // em vez de art_crea — semanticamente correto pra Tec. Agrimensura registrado
  // no CFT (Conselho Federal dos Tecnicos Industriais), nao no CREA.
  const at = anotacaoTecnica('trt_cft');
  const trt = round2(at.valor);

  // Memoria de calculo compacta (vai como subobservacao da linha "Honorarios Tecnicos" no PDF)
  const memoriaTecnico = aplicouMinimo
    ? `Minimo garantido aplicado (${hp.geo_rural_minimo_sm} SM = R$ ${minimoGarantido.toFixed(2)}). Calculo de campo: ${input.area_hectares}ha x R$ ${valorPorHectare.toFixed(2)} + ${input.numero_vertices}v x R$ ${valorPorVertice.toFixed(2)} + ${input.numero_diarias || 0}d x R$ ${valorDiaria.toFixed(2)} + ${input.distancia_km || 0}km x R$ ${valorPorKm.toFixed(2)} = R$ ${subtotal_campo.toFixed(2)} x ${multiplicador}x = R$ ${(subtotal_campo * multiplicador).toFixed(2)} (abaixo do minimo).`
    : `Area: ${input.area_hectares} ha x R$ ${valorPorHectare.toFixed(2)}/ha = R$ ${subtotal_area.toFixed(2)} | Vertices: ${input.numero_vertices} x R$ ${valorPorVertice.toFixed(2)} = R$ ${subtotal_vertices.toFixed(2)} | Diarias de campo: ${input.numero_diarias || 0} x R$ ${valorDiaria.toFixed(2)} = R$ ${subtotal_diarias.toFixed(2)} | Deslocamento: ${input.distancia_km || 0} km x R$ ${valorPorKm.toFixed(2)}/km = R$ ${subtotal_km.toFixed(2)} | Subtotal R$ ${subtotal_campo.toFixed(2)} x ${multiplicador}x (complexidade ${input.complexidade}) = R$ ${honorario_tecnico.toFixed(2)}`;

  const secao_3_honorarios: ItemCusto[] = [
    {
      ordem: ordem++,
      descricao: `${at.rotulo} — Tec. em Agrimensura CFT/MA n. 01209185369. Anotacao obrigatoria do responsavel tecnico.`,
      valor: trt,
      observacao: at.fonte,
    },
    {
      ordem: ordem++,
      descricao: 'Honorarios Tecnicos de Georreferenciamento — levantamento topografico, marcacao de vertices, memorial descritivo, planta georreferenciada e submissao ao SIGEF/INCRA',
      valor: honorario_tecnico,
      observacao: memoriaTecnico,
    },
    {
      ordem: ordem++,
      descricao: 'Honorarios de Assessoria e Acompanhamento — submissao SIGEF, diligencias junto ao INCRA, atendimento exigencias, emissao certificacao final, averbacao no cartorio',
      valor: honorario_assessoria,
      observacao: `Referencia: 1 salario minimo 2026 (R$ ${sm.toFixed(2)})`,
    },
  ];

  // ── Total Romatec — SO os 3 itens acima (TRT + Tec + Assess) ────────────
  const total_romatec = round2(trt + honorario_tecnico + honorario_assessoria);

  // ── Condicoes de pagamento (3 parcelas) ─────────────────────────────────
  const p1 = round2(trt + honorario_tecnico * 0.5 + honorario_assessoria * 0.5);
  const p2 = round2(honorario_tecnico * 0.5);
  const p3 = round2(honorario_assessoria * 0.5);

  // Guard de fechamento — se nao bater dentro de 1 centavo, e' bug
  const somaParcelas = round2(p1 + p2 + p3);
  if (Math.abs(somaParcelas - total_romatec) > 0.01) {
    throw new Error(
      `Erro de fechamento das parcelas: p1+p2+p3 = R$ ${somaParcelas.toFixed(2)} != total R$ ${total_romatec.toFixed(2)} (diff R$ ${(somaParcelas - total_romatec).toFixed(4)})`,
    );
  }

  const condicoes_pagamento: CondicaoPagamento[] = [
    {
      rotulo: '1a parcela — na assinatura',
      descricao: 'TRT integral + 50% Honorarios Tecnicos + 50% Honorarios de Assessoria',
      valor: p1,
    },
    {
      rotulo: '2a parcela — entrega do memorial e submissao SIGEF',
      descricao: '50% restante dos Honorarios Tecnicos',
      valor: p2,
    },
    {
      rotulo: '3a parcela — certificacao final INCRA',
      descricao: '50% restante dos Honorarios de Assessoria',
      valor: p3,
    },
  ];

  // ── Secao 4: checklist documentos do cliente ────────────────────────────
  const secao_4_checklist: DocumentoChecklist[] = [
    {
      texto: 'Certidao de Inteiro Teor da Matricula — ATUALIZADA (max. 30 dias)',
      obrigatorio: true,
      imprescindivel: !input.tem_matricula,
    },
    { texto: 'CCIR (Certificado de Cadastro de Imovel Rural — INCRA) atualizado', obrigatorio: true },
    { texto: 'ITR pago (5 ultimos exercicios)', obrigatorio: true },
    { texto: 'CAR (Cadastro Ambiental Rural) emitido', obrigatorio: true },
    { texto: 'RG/CPF do proprietario', obrigatorio: true },
    { texto: 'Comprovante de residencia do proprietario', obrigatorio: true },
    {
      texto: 'Anuencia dos confrontantes (planta com assinatura dos vizinhos confrontantes da poligonal)',
      obrigatorio: true,
      imprescindivel: true,
    },
    { texto: 'Senha gov.br (nivel prata ou ouro) do proprietario — necessaria para acesso ao Portal SIGEF/INCRA', obrigatorio: true },
    { texto: 'Documentos de eventuais usufrutuarios, hipotecas ou onus reais averbados (se houver)', obrigatorio: false },
    { texto: 'Plantas, medicoes ou levantamentos anteriores do imovel (se houver)', obrigatorio: false },
  ];

  // ── Secao opcional: SERVICOS ADICIONAIS OPCIONAIS (5 linhas, sempre renderiza)
  // v3.23.5: nao soma ao total Romatec — tabela informativa propria do PDF.
  const opcionaisParam = params.opcionais_georref;
  const opc = input.opcionais;

  const opcItens: NonNullable<CustosCalculados['secao_opcionais_georref']>['itens'] = [];
  let subtotalOpcionais = 0;

  // CCIR
  {
    const valorUnit = opc?.ccir.valor_unitario ?? opcionaisParam?.ccir.valor_unitario ?? 350.0;
    const contratado = !!opc?.ccir.contratado;
    const subtotal = contratado ? round2(valorUnit) : 0;
    if (contratado) subtotalOpcionais = round2(subtotalOpcionais + subtotal);
    opcItens.push({
      chave: 'ccir',
      rotulo: opcionaisParam?.ccir.rotulo ?? 'Atualizacao do CCIR (INCRA)',
      contratado,
      valor_unitario: valorUnit,
      subtotal,
    });
  }
  // CAR
  {
    const valorUnit = opc?.car.valor_unitario ?? opcionaisParam?.car.valor_unitario ?? 800.0;
    const contratado = !!opc?.car.contratado;
    const subtotal = contratado ? round2(valorUnit) : 0;
    if (contratado) subtotalOpcionais = round2(subtotalOpcionais + subtotal);
    opcItens.push({
      chave: 'car',
      rotulo: opcionaisParam?.car.rotulo ?? 'Atualizacao / emissao do CAR (SICAR)',
      contratado,
      valor_unitario: valorUnit,
      subtotal,
    });
  }
  // ITR (por exercicio)
  {
    const valorUnit = opc?.itr.valor_unitario ?? opcionaisParam?.itr.valor_unitario ?? 250.0;
    const qtd = opc?.itr.quantidade ?? 0;
    const contratado = !!opc?.itr.contratado;
    const subtotal = contratado ? round2(valorUnit * qtd) : 0;
    if (contratado) subtotalOpcionais = round2(subtotalOpcionais + subtotal);
    opcItens.push({
      chave: 'itr',
      rotulo: opcionaisParam?.itr.rotulo ?? 'Regularizacao de ITR em atraso',
      contratado,
      quantidade: qtd,
      valor_unitario: valorUnit,
      subtotal,
    });
  }
  // Anuencia (por confrontante)
  {
    const valorUnit = opc?.anuencia.valor_unitario ?? opcionaisParam?.anuencia.valor_unitario ?? 150.0;
    const qtd = opc?.anuencia.quantidade ?? 0;
    const contratado = !!opc?.anuencia.contratado;
    const subtotal = contratado ? round2(valorUnit * qtd) : 0;
    if (contratado) subtotalOpcionais = round2(subtotalOpcionais + subtotal);
    opcItens.push({
      chave: 'anuencia',
      rotulo: opcionaisParam?.anuencia.rotulo ?? 'Coleta de anuencia dos confrontantes',
      contratado,
      quantidade: qtd,
      valor_unitario: valorUnit,
      subtotal,
    });
  }
  // Retificacao (sob orcamento — nao soma)
  {
    const contratado = !!opc?.retificacao.contratado;
    opcItens.push({
      chave: 'retificacao',
      rotulo: opcionaisParam?.retificacao.rotulo ?? 'Retificacao de area (Lei 10.931/2004)',
      contratado,
      valor_unitario: 'sob_orcamento',
      subtotal: 'sob_orcamento',
    });
  }

  const secao_opcionais_georref: NonNullable<CustosCalculados['secao_opcionais_georref']> = {
    itens: opcItens,
    subtotal: subtotalOpcionais,
  };

  // ── Avisos e condicoes tecnicas ─────────────────────────────────────────
  const avisos: string[] = [
    'IMPORTANTE: Esta proposta esta em conformidade com a Lei 10.267/2001 (CNIR), NTGIR 3a Edicao (INCRA) e Resolucao CONFEA 1.108/2020. O servico exige profissional habilitado em Engenharia Cartografica/Agrimensura/Agronomia com habilitacao especifica no CREA ou CFT.',
    'TEMPO DE EXECUCAO: levantamento de campo (3-15 dias conforme acessibilidade), gabinete e memorial (5-10 dias), submissao SIGEF (2-5 dias), analise INCRA (60-180 dias). Total tipico: 90-210 dias do contrato a certificacao.',
    'ANUENCIA DOS CONFRONTANTES E IMPRESCINDIVEL. Sem a assinatura dos vizinhos confrontantes na planta, o INCRA rejeita a certificacao. A Romatec orienta o proprietario sobre a coleta das anuencias.',
    'EVENTUAIS DIVERGENCIAS DE AREA: se a area certificada (real, GPS) divergir significativamente da area registrada na matricula, sera necessaria RETIFICACAO DE AREA em paralelo (Lei 10.931/2004 administrativa OU judicial). Isso e cobrado a parte como servico adicional.',
  ];

  if (input.finalidade) {
    const finalidadeAviso = {
      CERTIFICACAO:    'FINALIDADE: Certificacao no SIGEF/INCRA e averbacao do memorial certificado na matricula vigente.',
      DESMEMBRAMENTO:  'FINALIDADE: Certificacao no SIGEF/INCRA, encerramento da matricula atual e abertura de nova matricula para a area desmembrada.',
      REMEMBRAMENTO:   'FINALIDADE: Certificacao no SIGEF/INCRA e unificacao de matriculas confrontantes em matricula unica.',
      RETIFICACAO:     'FINALIDADE: Certificacao no SIGEF/INCRA e averbacao da nova area na matricula.',
    }[input.finalidade];
    avisos.push(finalidadeAviso);
  }

  if (!input.tem_matricula) {
    avisos.push('ATENCAO: Imovel sem matricula registrada. Sera necessario USUCAPIAO ou abertura de matricula previa antes do georreferenciamento. Esses procedimentos sao cobrados a parte.');
  }

  if (input.complexidade === 'alta') {
    avisos.push('COMPLEXIDADE ALTA: terreno acidentado, vegetacao densa, litigios de divisas ou inumeros confrontantes. Multiplicador 1.6x sobre o calculo de campo. Diarias podem aumentar conforme necessidade real.');
  }

  // ── Base de calculo explicita (transparencia) ───────────────────────────
  const base_calculo: BaseCalculo[] = [
    {
      rotulo: 'Area (R$/hectare)',
      formula: `${input.area_hectares} ha x R$ ${valorPorHectare.toFixed(2)}/ha`,
      valor_resultado: subtotal_area,
    },
    {
      rotulo: 'Vertices (R$/vertice GPS RTK)',
      formula: `${input.numero_vertices} vertices x R$ ${valorPorVertice.toFixed(2)}`,
      valor_resultado: subtotal_vertices,
    },
  ];
  if (input.numero_diarias > 0) {
    base_calculo.push({
      rotulo: 'Diarias de campo',
      formula: `${input.numero_diarias} dia(s) x R$ ${valorDiaria.toFixed(2)}/dia`,
      valor_resultado: subtotal_diarias,
    });
  }
  if (input.distancia_km > 0) {
    base_calculo.push({
      rotulo: 'Deslocamento',
      formula: `${input.distancia_km} km x R$ ${valorPorKm.toFixed(2)}/km`,
      valor_resultado: subtotal_km,
    });
  }
  base_calculo.push({
    rotulo: `Subtotal de campo x complexidade ${input.complexidade}`,
    formula: `R$ ${subtotal_campo.toFixed(2)} x ${multiplicador}x`,
    valor_resultado: round2(subtotal_campo * multiplicador),
  });
  if (aplicouMinimo) {
    base_calculo.push({
      rotulo: 'Minimo garantido aplicado',
      formula: `${hp.geo_rural_minimo_sm} SM x R$ ${sm.toFixed(2)}`,
      valor_resultado: minimoGarantido,
    });
  }
  base_calculo.push({
    rotulo: 'Honorarios Tecnicos finais',
    formula: aplicouMinimo ? 'Maior entre calculado e minimo' : 'Subtotal x complexidade',
    valor_resultado: honorario_tecnico,
  });

  const custos: CustosCalculados = {
    secao_1_projetos,
    secao_2_taxas,
    secao_3_honorarios,
    condicoes_pagamento,
    base_calculo,
    secao_4_checklist,
    // v3.23.5: total agora e' so Romatec (antes incluia emolumentos cartorio)
    secao_5_total: total_romatec,
    avisos,
    honorarios_romatec: {
      trt,
      tecnicos: honorario_tecnico,
      assessoria: honorario_assessoria,
      total: total_romatec,
    },
    secao_opcionais_georref,
  };

  return { custos, fontes };
}
