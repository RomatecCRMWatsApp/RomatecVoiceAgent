import { describe, it, expect } from 'vitest';
import { calcularDesmembramento } from './desmembramento';
import type { InputDesmembramento } from './types';

const baseValid: InputDesmembramento = {
  tipo: 'remembramento',
  area_total_m2: 600,
  valor_venal_total: 200000,
  tipo_zona: 'urbana',
  iptu_em_dia: true,
  honorario_projeto_sm: 1.0, // legado — ignorado quando modo_precificacao vier
  numero_lotes_origem: 3,
};

describe('v3 — modo_precificacao=por_imovel', () => {
  it('soma valor_por_imovel × imoveis.length', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1500,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
        { ordem: 3, area_m2: 200, endereco: 'R', matricula: 'M3' },
      ],
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(4500); // 1500 × 3
    expect(out.custos.secao_3_honorarios[0].descricao).toMatch(/por im[oó]vel/i);
  });

  it.each([
    { caso: 'ausente',  valor_por_imovel: undefined },
    { caso: 'zero',     valor_por_imovel: 0 },
    { caso: 'negativo', valor_por_imovel: -100 },
  ])('rejeita valor_por_imovel $caso', async ({ valor_por_imovel }) => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      ...(valor_por_imovel !== undefined ? { valor_por_imovel } : {}),
    })).rejects.toThrow(/valor_por_imovel/i);
  });
});

describe('v3 — modo_precificacao=por_lote', () => {
  it('soma valores_por_lote', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_lote',
      valores_por_lote: [
        { ordem: 1, valor: 800 },
        { ordem: 2, valor: 1200 },
        { ordem: 3, valor: 1500 },
      ],
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(3500);
    expect(out.custos.secao_3_honorarios).toHaveLength(3);
  });

  it.each([
    { caso: 'undefined', valores_por_lote: undefined },
    { caso: 'vazia',     valores_por_lote: [] as Array<{ ordem: number; valor: number; descricao?: string }> },
  ])('rejeita valores_por_lote $caso', async ({ valores_por_lote }) => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_lote',
      ...(valores_por_lote !== undefined ? { valores_por_lote } : {}),
    })).rejects.toThrow(/valores_por_lote/i);
  });
});

describe('v3 — modo_precificacao=personalizado', () => {
  it('usa valor fechado + descritivo', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'personalizado',
      honorarios_personalizados: {
        valor_total: 4500,
        descritivo: 'Pacote técnico fechado conforme acordo entre as partes',
      },
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(4500);
    expect(out.custos.secao_3_honorarios[0].observacao).toMatch(/acordo entre as partes/i);
  });

  it.each([
    { caso: 'zero',     valor_total: 0 },
    { caso: 'negativo', valor_total: -100 },
  ])('rejeita valor_total $caso', async ({ valor_total }) => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'personalizado',
      honorarios_personalizados: { valor_total, descritivo: 'x' },
    })).rejects.toThrow(/valor_total/i);
  });

  it('rejeita descritivo vazio em honorarios_personalizados', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'personalizado',
      honorarios_personalizados: { valor_total: 1000, descritivo: '   ' },
    })).rejects.toThrow(/descritivo/i);
  });
});

describe('v3 — despesas_administrativas', () => {
  it('aparece em seção separada e NÃO entra em secao_5_total', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1000,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
      ],
      despesas_administrativas: {
        habilitada: true,
        valor: 250,
        descritivo: 'Taxa parcelamento Açailândia',
      },
    });
    expect(out.custos.despesas_administrativas?.valor).toBe(250);
    expect(out.custos.despesas_administrativas?.descritivo).toBe('Taxa parcelamento Açailândia');
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(2000); // 1000 × 2
    // v3.91.2: secao_5_total soma só as taxas FATURÁVEIS (anotação técnica);
    // emolumentos/taxa Prefeitura são informativos (fora do valor a receber).
    const totalTaxas = out.custos.secao_2_taxas.filter(i => !i.informativo).reduce((s, i) => s + i.valor, 0);
    // CRÍTICO: secao_5_total = taxas + honorarios SEM as despesas administrativas
    expect(out.custos.secao_5_total).toBe(totalTaxas + 2000);
    // Garante que o número 250 não vazou para o total
    expect(out.custos.secao_5_total).not.toBe(totalTaxas + 2000 + 250);
  });

  it('quando habilitada=false, custos.despesas_administrativas é omitido (engine respeitou flag)', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1000,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
      ],
      despesas_administrativas: { habilitada: false, valor: 250, descritivo: 'ignorar' },
    });
    // Sanity: confirma que a chamada de fato rodou e populou honorarios
    expect(out.custos.secao_3_honorarios.length).toBeGreaterThan(0);
    // Contrato: habilitada=false → campo ausente em custos
    expect(out.custos.despesas_administrativas).toBeUndefined();
    // Contrato extra: secao_5_total NÃO contém o valor 250 (não pode vazar).
    // Mesmo padrão do teste habilitada=true: comparar contra taxas+honorarios reais,
    // não contra constantes (taxas variam com valor venal e numero de matrículas).
    // v3.91.2: secao_5_total soma só as taxas FATURÁVEIS (anotação técnica);
    // emolumentos/taxa Prefeitura são informativos (fora do valor a receber).
    const totalTaxas = out.custos.secao_2_taxas.filter(i => !i.informativo).reduce((s, i) => s + i.valor, 0);
    expect(out.custos.secao_5_total).toBe(totalTaxas + 2000);
    expect(out.custos.secao_5_total).not.toBe(totalTaxas + 2000 + 250);
  });
});

describe('v3 — retrocompat: sem modo_precificacao usa SM legado', () => {
  it('cai no comportamento v3.22.0 (auto)', async () => {
    const out = await calcularDesmembramento(baseValid);
    expect(out.custos.secao_3_honorarios.length).toBeGreaterThanOrEqual(2);
    expect(out.custos.secao_3_honorarios[0].descricao).toMatch(/Honorarios de Projeto/i);
  });
});

describe('v3 — condicoes_pagamento consistente com secao_3', () => {
  it('por_imovel: soma das parcelas = valor a receber (secao_5_total = honorários + anotação)', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1500,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
        { ordem: 3, area_m2: 200, endereco: 'R', matricula: 'M3' },
      ],
    });
    const somaParcelas = (out.custos.condicoes_pagamento ?? []).reduce((s, c) => s + c.valor, 0);
    expect(somaParcelas).toBeCloseTo(out.custos.secao_5_total, 2);
  });

  it('por_lote: soma das parcelas = valor a receber (secao_5_total)', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_lote',
      valores_por_lote: [
        { ordem: 1, valor: 800 },
        { ordem: 2, valor: 1200 },
        { ordem: 3, valor: 1500 },
      ],
    });
    const somaParcelas = (out.custos.condicoes_pagamento ?? []).reduce((s, c) => s + c.valor, 0);
    expect(somaParcelas).toBeCloseTo(out.custos.secao_5_total, 2);
  });

  it('personalizado: parcela única "A combinar" com valor = valor a receber', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'personalizado',
      honorarios_personalizados: { valor_total: 5500, descritivo: 'Pacote completo' },
    });
    expect(out.custos.condicoes_pagamento).toHaveLength(1);
    expect(out.custos.condicoes_pagamento![0].rotulo).toMatch(/a combinar/i);
    expect(out.custos.condicoes_pagamento![0].valor).toBe(out.custos.secao_5_total);
  });
});

describe('v3 — base_calculo consistente com secao_3', () => {
  it('por_imovel: total em base_calculo = secao_3 total', async () => {
    const out = await calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1500,
      imoveis: [
        { ordem: 1, area_m2: 200, endereco: 'R', matricula: 'M1' },
        { ordem: 2, area_m2: 200, endereco: 'R', matricula: 'M2' },
        { ordem: 3, area_m2: 200, endereco: 'R', matricula: 'M3' },
      ],
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    const totalRomatec = out.custos.base_calculo?.find(b => /Total Romatec/i.test(b.rotulo));
    expect(totalRomatec?.valor_resultado).toBe(totalHonorarios);
    // base_calculo NÃO deve conter "Honorarios de Projeto" SM legado em modo_precificacao
    const linhaSM = out.custos.base_calculo?.find(b => /Honorarios de Projeto/i.test(b.rotulo));
    expect(linhaSM).toBeUndefined();
  });
});

describe('v3 — desmembramento usa numero_lotes_resultantes (não numero_lotes_origem)', () => {
  it('por_imovel em desmembramento sem imoveis[] usa numero_lotes_resultantes', async () => {
    const out = await calcularDesmembramento({
      tipo: 'desmembramento',
      area_total_m2: 1000,
      valor_venal_total: 200000,
      tipo_zona: 'urbana',
      iptu_em_dia: true,
      honorario_projeto_sm: 1.0,
      numero_lotes_resultantes: 4, // 1 matriz vira 4 lotes
      modo_precificacao: 'por_imovel',
      valor_por_imovel: 1000,
    });
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(4000); // 1000 × 4
  });
});

describe('v3 — modo_precificacao desconhecido rejeita', () => {
  it('valor desconhecido lança erro descritivo', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      // @ts-expect-error testando runtime guard
      modo_precificacao: 'bogus',
    })).rejects.toThrow(/modo_precificacao desconhecido/i);
  });
});
