// v1.66.0: motor de calculo de Averbacao (residencial + comercial).
// Residencial: pacote 2 projetos (Mapa + Arquitetonico) padrao,
//              ou pacote completo 7 projetos se complementares.
// Comercial:   pacote completo 7 projetos OBRIGATORIO.
//
// Honorarios (regra confirmada CEO):
//   Projeto      = R$ 15/m2 (residencial) ou R$ 25/m2 (comercial)
//   Assessoria   = 1 SM (universal — R$ 1.621,00 em 2026)
//
// Taxas terceiros:
//   Emolumentos cartorio (TJMA 16.9 averbacao com valor)
//   INSS/SERO da obra (afericao indireta IN RFB 2021/2021)
//   Taxa Habite-se (Prefeitura — null = a confirmar)
//   Alvara Construcao (cobra so se !tem_alvara_construcao)
//   ART CREA-MA = R$ 93,40

import type { InputAverbacao, ResultadoCalculo, CustosCalculados, FontesConsulta, ItemCusto, DocumentoChecklist, CondicaoPagamento, BaseCalculo } from './types';
import { calcularEmolumentos } from '../tjma';
import { calcularSERO } from '../receita-federal/sero-calculator';
import { taxaHabiteSe, taxaAlvaraConstrucao } from '../prefeitura-acailandia';
import { getParams, salarioMinimo, anotacaoTecnica, cubPorPadrao } from './params';

const PROJETOS_RESIDENCIAL_BASICO = [
  'Mapa de Situacao',
  'Projeto Arquitetonico',
];

const PROJETOS_COMPLETO = [
  'Mapa de Situacao',
  'Projeto Arquitetonico',
  'Projeto Eletrico',
  'Projeto Hidrossanitario',
  'Projeto Estrutural',
  'Projeto de Combate a Incendio (PPCI)',
  'Memorial Descritivo da Obra',
];

export async function calcularAverbacao(input: InputAverbacao): Promise<ResultadoCalculo> {
  const params = getParams();
  const sm = salarioMinimo();

  // ── Secao 1: projetos a confeccionar ────────────────────────────────────
  const usaPacoteCompleto =
    input.modalidade === 'comercial' || !!input.apresentar_projetos_complementares;
  const secao_1_projetos = usaPacoteCompleto ? PROJETOS_COMPLETO : PROJETOS_RESIDENCIAL_BASICO;

  // ── Secao 2: taxas e emolumentos de terceiros ───────────────────────────
  const secao_2_taxas: ItemCusto[] = [];
  const fontes: FontesConsulta = {};
  let ordem = 1;

  // 1. Emolumentos cartorio
  const emol = await calcularEmolumentos('averbacao_construcao', input.valor_venal_imovel);
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: 'Emolumentos cartorarios (averbacao de construcao) — Tabela TJMA 2026',
    valor: emol.valor,
    observacao: emol.base_calculo,
  });
  fontes.tjma = { fonte: emol.fonte, consultadoEm: emol.consultadoEm.toISOString() };

  // 2. INSS/SERO da obra
  const sero = calcularSERO({
    area_construida: input.area_construida,
    padrao_construtivo: input.padrao_construtivo,
    modalidade: input.modalidade,
    responsavel: input.responsavel,
    com_premoldados: false,
  });
  // v1.66.6: opcao de parcelamento direto com a RECEITA FEDERAL (nao com a
  // Romatec). Cliente pode parcelar em ate 60x diretamente no portal e-CAC,
  // e a Romatec presta a ASSESSORIA DO PARCELAMENTO (orientacao, calculo,
  // protocolo). A CND fica liberada para averbacao apos pagamento da 1a parcela.
  let observacaoSero = sero.observacao_pj
    ?? `RMT R$ ${sero.rmt.toFixed(2)} (CUB R$ ${sero.cub_usado.toFixed(2)}/m2 x ${input.area_construida}m2 x ${(sero.percentual_mao_obra * 100).toFixed(0)}%) -> INSS 20% + Sistema S 8% = 28%`;
  if (input.parcelar_inss && sero.total > 0 && (input.numero_parcelas_inss || 0) >= 2) {
    const n = Math.min(60, Math.max(2, input.numero_parcelas_inss || 0));
    const parcela = sero.total / n;
    observacaoSero += ` | Opcao de parcelamento direto com a Receita Federal: ${n}x de aprox. R$ ${parcela.toFixed(2)} (a Romatec presta assessoria; CND liberada para averbacao apos 1a parcela).`;
  }
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: 'INSS da obra (CND/SERO — Receita Federal, afericao indireta)',
    valor: sero.total,
    observacao: observacaoSero,
  });
  fontes.sero = { fonte: sero.fonte, aviso: sero.aviso };
  fontes.cub = {
    valor: sero.cub_usado,
    padrao: input.padrao_construtivo,
    mes_referencia: params.cub_ma.ultima_atualizacao,
  };

  // 3. Taxa Habite-se (Prefeitura — pode ser null)
  const habiteSe = taxaHabiteSe();
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: habiteSe.rotulo,
    valor: habiteSe.valor ?? 0,
    pendente: habiteSe.pendente,
    observacao: habiteSe.observacao_pdf,
  });

  // 4. Alvara de Construcao (so se nao tiver)
  if (!input.tem_alvara_construcao) {
    const alvara = taxaAlvaraConstrucao();
    secao_2_taxas.push({
      ordem: ordem++,
      descricao: alvara.rotulo,
      valor: alvara.valor ?? 0,
      pendente: alvara.pendente,
      observacao: alvara.observacao_pdf || 'Cobrado por nao haver Alvara emitido previamente.',
    });
  }

  // 5. Anotacao Tecnica (ART CREA / RRT CAU / TRT CFT — selecionavel)
  const tipoAnotacao = input.anotacao_tecnica || 'art_crea';
  const at = anotacaoTecnica(tipoAnotacao);
  secao_2_taxas.push({
    ordem: ordem++,
    descricao: at.rotulo,
    valor: at.valor,
    observacao: at.fonte,
  });

  // ── Secao 3: honorarios Romatec (sempre 2 linhas) ────────────────────────
  const valor_por_m2 = input.modalidade === 'residencial'
    ? params.honorarios_projeto.averbacao_residencial_por_m2
    : params.honorarios_projeto.averbacao_comercial_por_m2;
  const honorario_projeto = input.area_construida * valor_por_m2;
  const honorario_assessoria = sm * params.honorarios_assessoria.padrao_sm;

  const secao_3_honorarios: ItemCusto[] = [
    {
      ordem: 6,
      descricao: 'Honorarios de Projeto e Diligencia Tecnica — confeccao dos projetos da Secao 1, vistoria, levantamento, ARTs, responsabilidade tecnica',
      valor: honorario_projeto,
      observacao: `R$ ${valor_por_m2.toFixed(2)}/m2 x ${input.area_construida} m2`,
    },
    {
      ordem: 7,
      descricao: 'Honorarios de Assessoria e Acompanhamento — emissao de Alvara, retirada de Habite-se, emissao de CND Receita Federal, diligencias em cartorio, acompanhamento integral ate averbacao final na matricula',
      valor: honorario_assessoria,
      observacao: `1 salario minimo 2026 (R$ ${sm.toFixed(2)})`,
    },
  ];

  // ── Secao 4: checklist documentos do cliente ─────────────────────────────
  const secao_4_checklist: DocumentoChecklist[] = [
    { texto: 'Certidao de Inteiro Teor da Matricula — ATUALIZADA (max. 30 dias)', obrigatorio: true },
    { texto: 'IPTU em dia (comprovante do exercicio atual)', obrigatorio: true },
  ];
  if (input.modalidade === 'comercial') {
    secao_4_checklist.push({ texto: 'CNPJ + Contrato Social', obrigatorio: true });
    secao_4_checklist.push({ texto: 'RG/CPF dos socios', obrigatorio: true });
  } else {
    secao_4_checklist.push({ texto: 'RG/CPF do proprietario', obrigatorio: true });
  }
  secao_4_checklist.push(
    { texto: 'Alvara de Construcao (se ja possuir)', obrigatorio: false },
    { texto: 'Habite-se (se ja possuir)', obrigatorio: false },
    { texto: 'CND da Receita Federal — Imovel (se ja possuir)', obrigatorio: false },
  );

  // ── Secao 5: total ──────────────────────────────────────────────────────
  const total_taxas = secao_2_taxas.reduce((s, i) => s + i.valor, 0);
  const total_honorarios = secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
  const secao_5_total = total_taxas + total_honorarios;

  // ── Avisos legais ───────────────────────────────────────────────────────
  const avisos: string[] = [];
  // v1.66.5: aviso universal de aproximacao Receita/Cartorio
  avisos.push('IMPORTANTE: Os valores das taxas de Cartorio e da Receita Federal informados nesta proposta sao APROXIMADOS, calculados com base nas tabelas oficiais vigentes (TJMA Resolucao GP 143/2025 e IN RFB 2021/2021). Os valores definitivos podem variar conforme apuracao real do cartorio competente e do portal SERO/e-CAC no momento do pagamento.');
  if (sero.total > 0) avisos.push(sero.aviso);
  // v1.66.6: aviso explicito sobre parcelamento INSS com a Receita Federal
  if (input.parcelar_inss && sero.total > 0 && (input.numero_parcelas_inss || 0) >= 2) {
    const n = Math.min(60, Math.max(2, input.numero_parcelas_inss || 0));
    avisos.push(`PARCELAMENTO INSS/SERO: o cliente pode parcelar o debito diretamente com a Receita Federal (portal e-CAC) em ate ${n} parcelas. A Romatec presta assessoria completa nesse processo (orientacao, calculo de juros/multa, protocolo). A CND da obra fica liberada para averbacao apos o pagamento da 1a parcela e regularidade fiscal mantida.`);
  } else if (sero.total > 0) {
    avisos.push('PARCELAMENTO OPCIONAL: caso o cliente prefira nao pagar o INSS/SERO a vista, e possivel parcelar o debito diretamente com a Receita Federal (portal e-CAC) em ate 60x. A Romatec presta assessoria nesse parcelamento. A CND da obra fica liberada para averbacao apos pagamento da 1a parcela.');
  }
  const itensPendentes = secao_2_taxas.filter(i => i.pendente).map(i => i.descricao);
  if (itensPendentes.length > 0) {
    avisos.push(`Itens pendentes de confirmacao com a Prefeitura: ${itensPendentes.join(', ')}.`);
    fontes.prefeitura = { itens_pendentes: itensPendentes };
  }

  // v1.66.11: Condicoes de Pagamento (regra confirmada CEO):
  //   1a parcela (assinatura):  100% Honorario Projeto + 50% Honorario Assessoria
  //   2a parcela (protocolo):   50% restante do Honorario Assessoria
  // Taxas de Terceiros (Secao 2) sao pagas conforme cada orgao demanda
  // (cliente paga DARF, boleto cartorio, etc). Nao entram nas condicoes.
  const primeira_parcela = honorario_projeto + (honorario_assessoria * 0.5);
  const segunda_parcela  = honorario_assessoria * 0.5;
  const condicoes_pagamento: CondicaoPagamento[] = [
    {
      rotulo: '1a parcela — na assinatura da proposta',
      descricao: '100% dos Honorarios de Projeto e Diligencia Tecnica + 50% dos Honorarios de Assessoria',
      valor: primeira_parcela,
    },
    {
      rotulo: '2a parcela — no protocolo em cartorio',
      descricao: '50% restante dos Honorarios de Assessoria e Acompanhamento',
      valor: segunda_parcela,
    },
  ];

  // Base de Calculo explicita (Receita Federal — INSS/SERO):
  const base_calculo: BaseCalculo[] = [];
  if (sero.total > 0) {
    const fatorPadrao = params.cub_ma.multiplicadores_padrao[input.padrao_construtivo];
    base_calculo.push({
      rotulo: 'Custo da Obra (CUB regional)',
      formula: `${input.area_construida} m² × R$ ${sero.cub_usado.toFixed(2)}/m² (CUB-MA R8N R$ ${params.cub_ma.base_r8n.toFixed(2)} × ${fatorPadrao.toFixed(2)} padrão ${input.padrao_construtivo})`,
      valor_resultado: sero.custo_global,
    });
    base_calculo.push({
      rotulo: 'RMT (Remuneracao Mao de Obra)',
      formula: `R$ ${sero.custo_global.toFixed(2)} × ${(sero.percentual_mao_obra * 100).toFixed(0)}% (IN RFB 2021/2021)`,
      valor_resultado: sero.rmt,
    });
    base_calculo.push({
      rotulo: 'INSS (20% sobre RMT)',
      formula: `R$ ${sero.rmt.toFixed(2)} × 20%`,
      valor_resultado: sero.inss,
    });
    base_calculo.push({
      rotulo: 'Sistema S (8% sobre RMT)',
      formula: `R$ ${sero.rmt.toFixed(2)} × 8%`,
      valor_resultado: sero.sistema_s,
    });
    base_calculo.push({
      rotulo: 'TOTAL CND/SERO (INSS + Sistema S)',
      formula: 'INSS + Sistema S',
      valor_resultado: sero.total,
    });
  }

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
