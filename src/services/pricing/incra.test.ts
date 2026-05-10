// src/services/pricing/incra.test.ts
import { describe, it, expect } from 'vitest';
import { validarCriterios, type CriteriosPontuacao } from './incra';

const valido: CriteriosPontuacao = {
  vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5,
};

describe('validarCriterios', () => {
  it('retorna ok=true para entrada válida', () => {
    const r = validarCriterios(valido);
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
  });

  it('rejeita pontuação 0', () => {
    const r = validarCriterios({ ...valido, vegetacao: 0 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/vegetacao/);
  });

  it('rejeita pontuação 11', () => {
    const r = validarCriterios({ ...valido, relevo: 11 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/relevo/);
  });

  it('rejeita não-inteiro', () => {
    const r = validarCriterios({ ...valido, clima: 5.5 });
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toMatch(/clima/);
  });

  it('acumula múltiplos erros', () => {
    const r = validarCriterios({ ...valido, vegetacao: 0, relevo: 11 });
    expect(r.erros.length).toBe(2);
  });
});

import { calcularPontuacaoTotal } from './incra';

describe('calcularPontuacaoTotal', () => {
  it('soma 6 critérios = 30', () => {
    expect(calcularPontuacaoTotal({
      vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5,
    })).toBe(30);
  });

  it('mínimo possível é 6', () => {
    expect(calcularPontuacaoTotal({
      vegetacao: 1, relevo: 1, insalubridade: 1, acesso: 1, clima: 1, area_media: 1,
    })).toBe(6);
  });

  it('máximo possível é 60', () => {
    expect(calcularPontuacaoTotal({
      vegetacao: 10, relevo: 10, insalubridade: 10, acesso: 10, clima: 10, area_media: 10,
    })).toBe(60);
  });
});

import { obterFaixa } from './incra';

describe('obterFaixa', () => {
  it('pontuação 6 → faixa 06-15', () => {
    expect(obterFaixa(6).label).toBe('06-15');
  });
  it('pontuação 15 → faixa 06-15 (limite alto)', () => {
    expect(obterFaixa(15).label).toBe('06-15');
  });
  it('pontuação 16 → faixa 16-25', () => {
    expect(obterFaixa(16).label).toBe('16-25');
  });
  it('pontuação 35 → faixa 26-35', () => {
    expect(obterFaixa(35).label).toBe('26-35');
  });
  it('pontuação 60 → faixa 56-60', () => {
    expect(obterFaixa(60).label).toBe('56-60');
  });
  it('pontuação 5 → throw', () => {
    expect(() => obterFaixa(5)).toThrow(/abaixo do mínimo/);
  });
  it('pontuação 61 → throw', () => {
    expect(() => obterFaixa(61)).toThrow(/acima do máximo/);
  });
});

import { obterValorUnitario, calcularPrecificacao, type InputPrecificacao } from './incra';

describe('obterValorUnitario', () => {
  it('faixa 26-35 km → R$ 1.571,64', () => {
    const f = obterFaixa(30);
    expect(obterValorUnitario(f, 'km')).toBe(1571.64);
  });
  it('faixa 26-35 hectare → R$ 104,78', () => {
    expect(obterValorUnitario(obterFaixa(30), 'hectare')).toBe(104.78);
  });
  it('faixa 26-35 lote → R$ 1.298,88', () => {
    expect(obterValorUnitario(obterFaixa(30), 'lote')).toBe(1298.88);
  });
});

describe('calcularPrecificacao — sem desconto', () => {
  const baseInput: InputPrecificacao = {
    criterios: { vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5 },
    unidade: 'km',
    quantidade: 100,
    desconto: { tipo: 'nenhum', valor: 0 },
  };

  it('100 km × faixa 26-35 = R$ 157.164,00', () => {
    const r = calcularPrecificacao(baseInput);
    expect(r.pontuacaoTotal).toBe(30);
    expect(r.faixa.label).toBe('26-35');
    expect(r.valorUnitario).toBe(1571.64);
    expect(r.valorBase).toBe(157164.00);
    expect(r.descontoAplicado).toBe(0);
    expect(r.valorFinal).toBe(157164.00);
    expect(r.detalhamento.avisos).toEqual([]);
  });

  it('quantidade 0 → throw', () => {
    expect(() => calcularPrecificacao({ ...baseInput, quantidade: 0 })).toThrow(/maior que zero/);
  });

  it('quantidade negativa → throw', () => {
    expect(() => calcularPrecificacao({ ...baseInput, quantidade: -1 })).toThrow(/maior que zero/);
  });

  it('critérios inválidos → throw', () => {
    expect(() => calcularPrecificacao({
      ...baseInput,
      criterios: { ...baseInput.criterios, vegetacao: 11 },
    })).toThrow(/Critérios inválidos/);
  });
});

describe('calcularPrecificacao — descontos', () => {
  const base: InputPrecificacao = {
    criterios: { vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5 },
    unidade: 'hectare',
    quantidade: 10,
    desconto: { tipo: 'nenhum', valor: 0 },
  };

  it('desconto percentual 10% sobre R$ 1.047,80 = R$ 104,78', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 10 } });
    expect(r.valorBase).toBe(1047.80);
    expect(r.descontoAplicado).toBe(104.78);
    expect(r.valorFinal).toBe(943.02);
  });

  it('desconto fixo R$ 47,80 sobre R$ 1.047,80 = R$ 1.000,00', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'fixo', valor: 47.80 } });
    expect(r.valorFinal).toBe(1000.00);
  });

  it('desconto percentual > 100 → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 110 } })).toThrow(/entre 0 e 100/);
  });

  it('desconto percentual < 0 → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: -5 } })).toThrow(/entre 0 e 100/);
  });

  it('desconto fixo > valor base → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'fixo', valor: 9999 } })).toThrow(/maior que o valor base/);
  });

  it('desconto fixo negativo → throw', () => {
    expect(() => calcularPrecificacao({ ...base, desconto: { tipo: 'fixo', valor: -1 } })).toThrow(/não pode ser negativo/);
  });
});

describe('calcularPrecificacao — aviso de variação', () => {
  const base: InputPrecificacao = {
    criterios: { vegetacao: 5, relevo: 5, insalubridade: 5, acesso: 5, clima: 5, area_media: 5 },
    unidade: 'hectare',
    quantidade: 10,
    desconto: { tipo: 'nenhum', valor: 0 },
  };

  it('desconto 10% — sem aviso', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 10 } });
    expect(r.detalhamento.avisos).toEqual([]);
  });

  it('desconto 11% — emite aviso', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 11 } });
    expect(r.detalhamento.avisos.length).toBe(1);
    expect(r.detalhamento.avisos[0]).toMatch(/Portaria INCRA 12\/2025/);
    expect(r.detalhamento.avisos[0]).toMatch(/±10%/);
  });

  it('desconto 25% — emite aviso', () => {
    const r = calcularPrecificacao({ ...base, desconto: { tipo: 'percentual', valor: 25 } });
    expect(r.detalhamento.avisos.length).toBe(1);
  });
});
