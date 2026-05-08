// v1.99.4: motor de calculo de Georreferenciamento Rural (INCRA/SIGEF).
//
// Base normativa:
//   - Lei 10.267/2001 (Cadastro Nacional Imoveis Rurais — CNIR)
//   - NTGIR 3a Edicao (Norma Tecnica Georreferenciamento INCRA)
//   - Resolucao CONFEA 1.108/2020 (servicos de Engenharia Cartografica)
//   - Lei 6.015/1973 (Registro Publico — averbacao do memorial certificado)
//
// Fluxo do servico:
//   1) Levantamento topografico (GPS RTK ou Estacao Total)
//   2) Vertices marcados em campo + coleta de coordenadas WGS84
//   3) Memorial descritivo + planta georreferenciada
//   4) Submissao ao SIGEF/INCRA via certificado digital
//   5) Certificacao INCRA + averbacao em cartorio
//
// Honorarios (referencial CONFEA/CREA-MA 2026):
//   Honorario base = (area_ha × R$/ha) + (vertices × R$/vertice)
//                  + (diarias × R$/dia) + (km × R$/km) + outros
//   Multiplicado por complexidade (simples 1.0x, media 1.3x, alta 1.6x)
//   Minimo garantido = 2 SM por matricula
//
// Taxas de terceiros:
//   ART CREA = R$ 93,40 (Decisao Plenaria 0450/2025)
//   Certificacao SIGEF/INCRA = gratuita oficial (custo zero, mas tempo de analise)
//   Emolumentos cartorio (averbacao memorial certificado) — TJMA

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

// ── Pacote de servicos do GEO Rural (Secao 1) ───────────────────────────────
const ESCOPO_GEO_RURAL = [
  'Levantamento topografico (GPS RTK / Estacao Total)',
  'Marcacao e coleta de coordenadas WGS84 nos vertices da poligonal',
  'Calculo de area e perimetro georreferenciado',
  'Memorial Descritivo (NTGIR 3a Edicao)',
  'Planta georreferenciada com poligonal e confrontantes',
  'Submissao ao SIGEF/INCRA com certificado digital',
  'Acompanhamento ate certificacao final pelo INCRA',
  'Averbacao do memorial certificado na matricula em cartorio',
];

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

  // ── Secao 1: escopo do servico ──────────────────────────────────────────
  const secao_1_projetos = [...ESCOPO_GEO_RURAL];

  // ── Secao 2: taxas e emolumentos de terceiros ───────────────────────────
  const secao_2_taxas: ItemCusto[] = [];
  const fontes: FontesConsulta = {};
  let ordem = 1;

  // 1. Anotacao tecnica (ART/RRT/TRT — geo geralmente exige ART CREA)
  const at = anotacaoTecnica('art_crea');
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: at.rotulo,
    valor: at.valor,
    observacao: at.fonte,
  });

  // 2. Emolumentos cartorio — averbacao do memorial certificado.
  // TJMA: usa 'averbacao_construcao' como proxy (mesma faixa). Se nao tiver
  // valor venal informado, usa estimativa conservadora baseada na area.
  const valorEstimadoImovel = Math.max(input.area_hectares * 5000, 50000); // R$ 5k/ha minimo
  try {
    const emol = await calcularEmolumentos('averbacao_construcao', valorEstimadoImovel);
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios (averbacao do memorial certificado INCRA)',
      valor: emol.valor,
      observacao: `${emol.base_calculo} | Estimativa baseada em area × R$ 5.000/ha`,
    });
    fontes.tjma = { fonte: emol.fonte, consultadoEm: emol.consultadoEm.toISOString() };
  } catch (err) {
    // Fallback se tabela TJMA falhar
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Emolumentos cartorarios (averbacao do memorial certificado INCRA)',
      valor: 0,
      pendente: true,
      observacao: `A confirmar em cartorio competente. Erro consulta: ${(err as Error).message}`,
    });
  }

  // 3. Certificacao SIGEF/INCRA — gratuita oficialmente
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: 'Certificacao SIGEF/INCRA (Sistema de Gestao Fundiaria)',
    valor: 0,
    observacao: 'Gratuita por lei (Lei 10.267/2001). Tempo medio analise INCRA: 60-180 dias.',
  });

  // 4. Outros servicos opcionais informados pelo cliente
  if (input.valor_outros_servicos > 0) {
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: 'Outros servicos / despesas especificas do projeto',
      valor: input.valor_outros_servicos,
      observacao: 'Conforme acordado com o cliente (taxas extras, certidoes, deslocamentos especiais)',
    });
  }

  // ── Secao 3: honorarios Romatec ─────────────────────────────────────────
  // Calculo do honorario tecnico em 4 parcelas + multiplicador complexidade

  // Permite override pelos valores do input (cliente pode propor valores diferentes)
  const valorPorHectare = input.valor_por_hectare > 0 ? input.valor_por_hectare : hp.geo_rural_por_hectare;
  const valorPorVertice = input.valor_por_vertice > 0 ? input.valor_por_vertice : hp.geo_rural_por_vertice;
  const valorDiaria     = input.valor_diaria_campo > 0 ? input.valor_diaria_campo : hp.geo_rural_diaria_campo;
  const valorPorKm      = input.valor_km_deslocamento > 0 ? input.valor_km_deslocamento : hp.geo_rural_por_km_deslocamento;

  const subtotal_area     = input.area_hectares * valorPorHectare;
  const subtotal_vertices = input.numero_vertices * valorPorVertice;
  const subtotal_diarias  = (input.numero_diarias || 0) * valorDiaria;
  const subtotal_km       = (input.distancia_km || 0) * valorPorKm;

  const subtotal_campo = subtotal_area + subtotal_vertices + subtotal_diarias + subtotal_km;

  // Multiplicador de complexidade
  const multiplicador =
    input.complexidade === 'alta' ? hp.geo_rural_complexidade_alta :
    input.complexidade === 'media' ? hp.geo_rural_complexidade_media :
    hp.geo_rural_complexidade_simples;

  let honorario_tecnico = subtotal_campo * multiplicador;

  // Minimo garantido: 2 SM por matricula
  const minimoGarantido = sm * hp.geo_rural_minimo_sm;
  let aplicouMinimo = false;
  if (honorario_tecnico < minimoGarantido) {
    honorario_tecnico = minimoGarantido;
    aplicouMinimo = true;
  }

  const honorario_assessoria = sm * params.honorarios_assessoria.padrao_sm;

  const obsTecnico = aplicouMinimo
    ? `Honorario minimo aplicado (${hp.geo_rural_minimo_sm} SM = R$ ${minimoGarantido.toFixed(2)}). Calculo de campo: R$ ${subtotal_campo.toFixed(2)} × ${multiplicador}x complexidade ${input.complexidade} = R$ ${(subtotal_campo * multiplicador).toFixed(2)} (abaixo do minimo).`
    : `Area: ${input.area_hectares}ha × R$ ${valorPorHectare}/ha = R$ ${subtotal_area.toFixed(2)} | Vertices: ${input.numero_vertices} × R$ ${valorPorVertice} = R$ ${subtotal_vertices.toFixed(2)}${input.numero_diarias ? ` | Diarias: ${input.numero_diarias} × R$ ${valorDiaria} = R$ ${subtotal_diarias.toFixed(2)}` : ''}${input.distancia_km ? ` | Deslocamento: ${input.distancia_km}km × R$ ${valorPorKm} = R$ ${subtotal_km.toFixed(2)}` : ''} | Subtotal R$ ${subtotal_campo.toFixed(2)} × ${multiplicador}x (${input.complexidade}) = R$ ${honorario_tecnico.toFixed(2)}`;

  const secao_3_honorarios: ItemCusto[] = [
    {
      ordem: ordem++,
      descricao: 'Honorarios Tecnicos de Georreferenciamento — levantamento topografico, marcacao de vertices, memorial descritivo, planta georreferenciada e submissao ao SIGEF/INCRA',
      valor: honorario_tecnico,
      observacao: obsTecnico,
    },
    {
      ordem: ordem++,
      descricao: 'Honorarios de Assessoria e Acompanhamento — submissao SIGEF, diligencias junto ao INCRA, atendimento exigencias, emissao certificacao final, averbacao no cartorio',
      valor: honorario_assessoria,
      observacao: `1 salario minimo 2026 (R$ ${sm.toFixed(2)})`,
    },
  ];

  // ── Secao 4: checklist documentos ───────────────────────────────────────
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

  // ── Secao 5: total ──────────────────────────────────────────────────────
  const total_taxas = secao_2_taxas.reduce((s, i) => s + i.valor, 0);
  const total_honorarios = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
  const secao_5_total = total_taxas + total_honorarios;

  // ── Avisos legais ───────────────────────────────────────────────────────
  const avisos: string[] = [
    'IMPORTANTE: Esta proposta esta em conformidade com a Lei 10.267/2001 (CNIR), NTGIR 3a Edicao (INCRA) e Resolucao CONFEA 1.108/2020. O servico exige profissional habilitado em Engenharia Cartografica/Agrimensura/Agronomia com habilitacao especifica no CREA.',
    'TEMPO DE EXECUCAO: levantamento de campo (3-15 dias conforme acessibilidade), gabinete e memorial (5-10 dias), submissao SIGEF (2-5 dias), analise INCRA (60-180 dias). Total tipico: 90-210 dias do contrato a certificacao.',
    'ANUENCIA DOS CONFRONTANTES E IMPRESCINDIVEL. Sem a assinatura dos vizinhos confrontantes na planta, o INCRA rejeita a certificacao. A Romatec orienta o proprietario sobre a coleta das anuencias.',
    'EVENTUAIS DIVERGENCIAS DE AREA: se a area certificada (real, GPS) divergir significativamente da area registrada na matricula, sera necessaria RETIFICACAO DE AREA em paralelo (Lei 10.931/2004 administrativa OU judicial). Isso e cobrado a parte como servico adicional.',
  ];

  if (!input.tem_matricula) {
    avisos.push('ATENCAO: Imovel sem matricula registrada. Sera necessario USUCAPIAO ou abertura de matricula previa antes do georreferenciamento. Esses procedimentos sao cobrados a parte.');
  }

  if (input.complexidade === 'alta') {
    avisos.push('COMPLEXIDADE ALTA: terreno acidentado, vegetacao densa, litigios de divisas ou inumeros confrontantes. Multiplicador 1.6x sobre o calculo de campo. Diarias podem aumentar conforme necessidade real.');
  }

  // ── Condicoes de pagamento ──────────────────────────────────────────────
  const primeira_parcela = honorario_tecnico * 0.5 + honorario_assessoria * 0.5;
  const segunda_parcela  = honorario_tecnico * 0.5;
  const terceira_parcela = honorario_assessoria * 0.5;
  const condicoes_pagamento: CondicaoPagamento[] = [
    {
      rotulo: '1a parcela — na assinatura',
      descricao: '50% Honorarios Tecnicos + 50% Honorarios de Assessoria',
      valor: primeira_parcela,
    },
    {
      rotulo: '2a parcela — na entrega do memorial e submissao ao SIGEF',
      descricao: '50% restante dos Honorarios Tecnicos',
      valor: segunda_parcela,
    },
    {
      rotulo: '3a parcela — na certificacao final pelo INCRA',
      descricao: '50% restante dos Honorarios de Assessoria',
      valor: terceira_parcela,
    },
  ];

  // ── Base de calculo explicita (transparencia) ───────────────────────────
  const base_calculo: BaseCalculo[] = [
    {
      rotulo: 'Area (R$/hectare)',
      formula: `${input.area_hectares} ha × R$ ${valorPorHectare.toFixed(2)}/ha`,
      valor_resultado: subtotal_area,
    },
    {
      rotulo: 'Vertices (R$/vertice GPS RTK)',
      formula: `${input.numero_vertices} vertices × R$ ${valorPorVertice.toFixed(2)}`,
      valor_resultado: subtotal_vertices,
    },
  ];
  if (input.numero_diarias > 0) {
    base_calculo.push({
      rotulo: 'Diarias de campo',
      formula: `${input.numero_diarias} dia(s) × R$ ${valorDiaria.toFixed(2)}/dia`,
      valor_resultado: subtotal_diarias,
    });
  }
  if (input.distancia_km > 0) {
    base_calculo.push({
      rotulo: 'Deslocamento',
      formula: `${input.distancia_km} km × R$ ${valorPorKm.toFixed(2)}/km`,
      valor_resultado: subtotal_km,
    });
  }
  base_calculo.push({
    rotulo: `Subtotal de campo × complexidade ${input.complexidade}`,
    formula: `R$ ${subtotal_campo.toFixed(2)} × ${multiplicador}x`,
    valor_resultado: subtotal_campo * multiplicador,
  });
  if (aplicouMinimo) {
    base_calculo.push({
      rotulo: 'Minimo garantido aplicado',
      formula: `${hp.geo_rural_minimo_sm} SM × R$ ${sm.toFixed(2)}`,
      valor_resultado: minimoGarantido,
    });
  }
  base_calculo.push({
    rotulo: 'Honorarios Tecnicos finais',
    formula: aplicouMinimo ? 'Maior entre calculado e minimo' : 'Subtotal × complexidade',
    valor_resultado: honorario_tecnico,
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
