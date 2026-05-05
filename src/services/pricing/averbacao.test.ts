// v1.66.0: smoke test do motor de Averbacao. Valida:
// - residencial 120m² R$ 180k -> totais plausiveis
// - comercial 250m² R$ 400k -> pacote 7 projetos + R$25/m²
// - PJ_com_contabilidade -> SERO = 0
// - tem_alvara_construcao=true -> nao soma alvara

import { describe, it, expect } from 'vitest';
import { calcularAverbacao } from './averbacao';
import type { InputAverbacao } from './types';

const baseResidencial: InputAverbacao = {
  modalidade: 'residencial',
  area_construida: 120,
  valor_venal_imovel: 180000,
  padrao_construtivo: 'normal',
  responsavel: 'PF',
  municipio: 'Acailandia-MA',
  tem_alvara_construcao: false,
  tem_habite_se: false,
  iptu_em_dia: true,
  cnd_receita_emitida: false,
  certidao_inteiro_teor_atualizada: true,
};

describe('Averbacao Residencial', () => {
  it('120m² R$ 180k normal: 2 projetos basicos, 5 itens taxas, honorarios = 1.800 + 1.621', async () => {
    const r = await calcularAverbacao(baseResidencial);
    expect(r.custos.secao_1_projetos).toEqual(['Mapa de Situacao', 'Projeto Arquitetonico']);
    expect(r.custos.secao_3_honorarios).toHaveLength(2);
    expect(r.custos.secao_3_honorarios[0].valor).toBe(1800);    // 120 * 15
    expect(r.custos.secao_3_honorarios[1].valor).toBe(1621);    // 1 SM
    // SERO: 1814.39 * 120 * 0.14 * 0.28 = 8.534,89
    const sero = r.custos.secao_2_taxas.find(t => t.descricao.includes('INSS'));
    expect(sero?.valor).toBeCloseTo(8534.89, 1);
    // ART = 93.40
    const art = r.custos.secao_2_taxas.find(t => t.descricao.includes('ART'));
    expect(art?.valor).toBe(93.40);
    expect(r.custos.secao_5_total).toBeGreaterThan(12000);
    expect(r.custos.secao_5_total).toBeLessThan(15000);
  });

  it('com complementares -> pacote 7 projetos', async () => {
    const r = await calcularAverbacao({ ...baseResidencial, apresentar_projetos_complementares: true });
    expect(r.custos.secao_1_projetos).toHaveLength(7);
    expect(r.custos.secao_1_projetos).toContain('Projeto Eletrico');
  });

  it('PJ com contabilidade -> SERO = 0', async () => {
    const r = await calcularAverbacao({ ...baseResidencial, responsavel: 'PJ_com_contabilidade' });
    const sero = r.custos.secao_2_taxas.find(t => t.descricao.includes('INSS'));
    expect(sero?.valor).toBe(0);
  });

  it('tem_alvara_construcao=true -> nao soma alvara', async () => {
    const r = await calcularAverbacao({ ...baseResidencial, tem_alvara_construcao: true });
    const alvara = r.custos.secao_2_taxas.find(t => t.descricao.includes('Alvara'));
    expect(alvara).toBeUndefined();
  });
});

describe('Averbacao Comercial', () => {
  it('250m² R$ 400k: pacote completo 7 projetos, R$25/m²', async () => {
    const r = await calcularAverbacao({
      ...baseResidencial,
      modalidade: 'comercial',
      area_construida: 250,
      valor_venal_imovel: 400000,
    });
    expect(r.custos.secao_1_projetos).toHaveLength(7);
    expect(r.custos.secao_3_honorarios[0].valor).toBe(6250);  // 250 * 25
    expect(r.custos.secao_3_honorarios[1].valor).toBe(1621);
    expect(r.custos.secao_5_total).toBeGreaterThan(20000);
  });
});

describe('Checklist universal', () => {
  it('Certidao de Inteiro Teor SEMPRE no checklist', async () => {
    const r = await calcularAverbacao(baseResidencial);
    const ck = r.custos.secao_4_checklist.find(d => d.texto.includes('Inteiro Teor'));
    expect(ck).toBeTruthy();
    expect(ck?.obrigatorio).toBe(true);
  });

  it('Comercial inclui CNPJ + Contrato Social', async () => {
    const r = await calcularAverbacao({ ...baseResidencial, modalidade: 'comercial' });
    expect(r.custos.secao_4_checklist.some(d => d.texto.includes('CNPJ'))).toBe(true);
  });
});
