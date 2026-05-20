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

  it('rejeita valor_por_imovel ausente ou <= 0', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_imovel',
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

  it('rejeita lista vazia', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'por_lote',
      valores_por_lote: [],
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

  it('rejeita valor_total <= 0', async () => {
    await expect(calcularDesmembramento({
      ...baseValid,
      modo_precificacao: 'personalizado',
      honorarios_personalizados: { valor_total: 0, descritivo: 'x' },
    })).rejects.toThrow(/valor_total/i);
  });
});

describe('v3 — despesas_administrativas', () => {
  it('aparece em seção separada (não soma ao honorário)', async () => {
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
    const totalHonorarios = out.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0);
    expect(totalHonorarios).toBe(2000); // 1000 × 2, NÃO inclui 250
  });

  it('quando habilitada=false, custos.despesas_administrativas vem undefined', async () => {
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
    expect(out.custos.despesas_administrativas).toBeUndefined();
  });
});

describe('v3 — retrocompat: sem modo_precificacao usa SM legado', () => {
  it('cai no comportamento v3.22.0 (auto)', async () => {
    const out = await calcularDesmembramento(baseValid);
    expect(out.custos.secao_3_honorarios.length).toBeGreaterThanOrEqual(2);
    expect(out.custos.secao_3_honorarios[0].descricao).toMatch(/Honorarios de Projeto/i);
  });
});
