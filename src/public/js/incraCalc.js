// src/public/js/incraCalc.js
//
// Espelho vanilla JS de src/services/pricing/incra.ts.
// MUDOU AQUI? Atualize lá. Teste de paridade em incra.test.ts garante que back e
// front calculam o mesmo (54 cenários: 6 faixas × 3 unidades × 3 tipos de desconto).
//
// Exposto globalmente como window.IncraCalc.

(function (global) {
  'use strict';

  const TABELA_INCRA_2025 = [
    { pontuacaoMin: 6,  pontuacaoMax: 15, rendimentoKmDia: 5.00, valorPorKm: 747.52,  valorPorHectare: 49.83,  valorPorLote: 617.79,  label: '06-15' },
    { pontuacaoMin: 16, pontuacaoMax: 25, rendimentoKmDia: 4.25, valorPorKm: 897.03,  valorPorHectare: 59.80,  valorPorLote: 741.34,  label: '16-25' },
    { pontuacaoMin: 26, pontuacaoMax: 35, rendimentoKmDia: 3.50, valorPorKm: 1571.64, valorPorHectare: 104.78, valorPorLote: 1298.88, label: '26-35' },
    { pontuacaoMin: 36, pontuacaoMax: 45, rendimentoKmDia: 2.15, valorPorKm: 2023.23, valorPorHectare: 134.88, valorPorLote: 1672.09, label: '36-45' },
    { pontuacaoMin: 46, pontuacaoMax: 55, rendimentoKmDia: 1.25, valorPorKm: 2474.20, valorPorHectare: 164.95, valorPorLote: 2044.80, label: '46-55' },
    { pontuacaoMin: 56, pontuacaoMax: 60, rendimentoKmDia: 0.80, valorPorKm: 3043.12, valorPorHectare: 202.87, valorPorLote: 2514.97, label: '56-60' },
  ];

  const CRITERIOS_INCRA = {
    vegetacao:     { label: 'Vegetação',          niveis: [{ rotulo: 'Aberta', maxPonto: 3 }, { rotulo: 'Intermediária', maxPonto: 6 }, { rotulo: 'Fechada', maxPonto: 10 }] },
    relevo:        { label: 'Relevo',             niveis: [{ rotulo: 'Plano a Suave Ondulado', maxPonto: 3 }, { rotulo: 'Moderadamente ondulado a Ondulado', maxPonto: 6 }, { rotulo: 'Forte ondulado a Escarpado', maxPonto: 10 }] },
    insalubridade: { label: 'Insalubridade',      niveis: [{ rotulo: 'Baixa', maxPonto: 3 }, { rotulo: 'Média', maxPonto: 6 }, { rotulo: 'Alta', maxPonto: 10 }] },
    acesso:        { label: 'Acesso',             niveis: [{ rotulo: 'Fácil', maxPonto: 3 }, { rotulo: 'Regular', maxPonto: 6 }, { rotulo: 'Difícil', maxPonto: 10 }] },
    clima:         { label: 'Clima',              niveis: [{ rotulo: 'Favorável', maxPonto: 3 }, { rotulo: 'Mediano', maxPonto: 6 }, { rotulo: 'Desfavorável', maxPonto: 10 }] },
    area_media:    { label: 'Área Média',         niveis: [{ rotulo: 'Favorável (>35ha)', maxPonto: 3 }, { rotulo: 'Mediano (15-35ha)', maxPonto: 6 }, { rotulo: 'Desfavorável (≤15ha)', maxPonto: 10 }] },
  };

  function rotuloDoNivel(criterio, ponto) {
    const niveis = CRITERIOS_INCRA[criterio]?.niveis;
    if (!niveis) return '';
    return niveis.find(n => ponto <= n.maxPonto)?.rotulo || '';
  }

  function validarCriterios(c) {
    const erros = [];
    for (const k of ['vegetacao','relevo','insalubridade','acesso','clima','area_media']) {
      const v = c[k];
      if (!Number.isInteger(v) || v < 1 || v > 10) {
        erros.push(`Critério ${k}: pontuação deve ser inteiro de 1 a 10 (recebido: ${v})`);
      }
    }
    return { ok: erros.length === 0, erros };
  }

  function calcularPontuacaoTotal(c) {
    return c.vegetacao + c.relevo + c.insalubridade + c.acesso + c.clima + c.area_media;
  }

  function obterFaixa(p) {
    if (p < 6)  throw new Error(`Pontuação ${p} abaixo do mínimo (6)`);
    if (p > 60) throw new Error(`Pontuação ${p} acima do máximo (60)`);
    const f = TABELA_INCRA_2025.find(x => p >= x.pontuacaoMin && p <= x.pontuacaoMax);
    if (!f) throw new Error(`Faixa não encontrada para pontuação ${p}`);
    return f;
  }

  function obterValorUnitario(faixa, unidade) {
    if (unidade === 'km')      return faixa.valorPorKm;
    if (unidade === 'hectare') return faixa.valorPorHectare;
    if (unidade === 'lote')    return faixa.valorPorLote;
    throw new Error(`Unidade desconhecida: ${unidade}`);
  }

  function calcularPrecificacao(input) {
    const v = validarCriterios(input.criterios);
    if (!v.ok) throw new Error(`Critérios inválidos: ${v.erros.join('; ')}`);
    if (input.quantidade <= 0) throw new Error('Quantidade deve ser maior que zero');

    const pontuacaoTotal = calcularPontuacaoTotal(input.criterios);
    const faixa = obterFaixa(pontuacaoTotal);
    const valorUnitario = obterValorUnitario(faixa, input.unidade);
    const valorBase = +(valorUnitario * input.quantidade).toFixed(2);

    let descontoAplicado = 0;
    const avisos = [];

    if (input.desconto.tipo === 'percentual') {
      if (input.desconto.valor < 0 || input.desconto.valor > 100) {
        throw new Error('Desconto percentual deve estar entre 0 e 100');
      }
      descontoAplicado = +(valorBase * (input.desconto.valor / 100)).toFixed(2);
    } else if (input.desconto.tipo === 'fixo') {
      if (input.desconto.valor < 0) throw new Error('Desconto fixo não pode ser negativo');
      if (input.desconto.valor > valorBase) throw new Error('Desconto fixo não pode ser maior que o valor base');
      descontoAplicado = +input.desconto.valor.toFixed(2);
    }

    const valorFinal = +(valorBase - descontoAplicado).toFixed(2);

    if (valorBase > 0) {
      const pct = (descontoAplicado / valorBase) * 100;
      if (pct > 10) {
        avisos.push(
          `Desconto aplicado (${pct.toFixed(1)}%) excede a variação admissível ` +
          `de ±10% prevista na Portaria INCRA 12/2025.`
        );
      }
    }

    const unidadeLabel = input.unidade === 'km' ? 'km lineares'
                       : input.unidade === 'hectare' ? 'hectares'
                       : 'lotes';

    return {
      pontuacaoTotal,
      faixa,
      valorUnitario,
      valorBase,
      descontoAplicado,
      valorFinal,
      detalhamento: {
        formula: `${input.quantidade} ${unidadeLabel} × R$ ${valorUnitario.toFixed(2)} = R$ ${valorBase.toFixed(2)}`,
        avisos,
      },
    };
  }

  global.IncraCalc = {
    TABELA_INCRA_2025,
    CRITERIOS_INCRA,
    rotuloDoNivel,
    validarCriterios,
    calcularPontuacaoTotal,
    obterFaixa,
    obterValorUnitario,
    calcularPrecificacao,
  };
})(typeof window !== 'undefined' ? window : globalThis);
