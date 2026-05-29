// v3.48.0: testes do engine eletrico (NBR 5410).

import { describe, it, expect } from 'vitest';
import {
  calcularMemorialEletrico,
  calcularCargaInstalada,
  calcularDemanda,
  calcularCorrente,
  calcularQuedaTensao,
} from './eletricoCalc';
import type { WizardEletrico } from './types';

const baseInput: WizardEletrico = {
  uso_edificacao: 'Residencial unifamiliar',
  area_construida_m2: 120,
  num_pavimentos: 1,
  cargas: [
    { tipo: 'tue_chuveiro', potencia_w: 5500, quantidade: 2 },
    { tipo: 'tue_ar_condicionado', potencia_w: 1400, quantidade: 2 },
    { tipo: 'tue_maquina_lavar', potencia_w: 2000, quantidade: 1 },
  ],
  fator_demanda: 'residencial',
  tensao_nominal_v: 220,
  tipo_alimentacao: 'bifasico',
  comprimento_ramal_m: 30,
};

describe('Eletrico — Carga instalada', () => {
  it('1. Iluminacao+TUG: 120 m² × 12 VA/m² × cosfi 0,92 ≈ 1325 W', () => {
    const { detalhamento } = calcularCargaInstalada(120, []);
    const ilum = detalhamento.find(d => d.tipo === 'iluminacao_tug');
    expect(ilum?.pot_total_w).toBeCloseTo(1324.8, 1);
  });

  it('2. Carga total inclui ilum + cargas explicitas', () => {
    const { total_w, detalhamento } = calcularCargaInstalada(120, baseInput.cargas);
    // ilum ~1325 + 2×5500 + 2×1400 + 2000 = 1325 + 15800 = 17125
    expect(total_w).toBeCloseTo(17125, 0);
    expect(detalhamento).toHaveLength(4); // ilum + 3 cargas
  });
});

describe('Eletrico — Demanda', () => {
  it('3. Aplica fator demanda por tipo (NBR 5410 Tabela 47)', () => {
    const det = [
      { tipo: 'iluminacao_tug' as const, pot_total_w: 1000 },
      { tipo: 'tue_chuveiro' as const, pot_total_w: 5000 },
    ];
    const { demandada_w, detalhamento_demanda } = calcularDemanda(det);
    // ilum 0.66 × 1000 = 660 + chuveiro 1.00 × 5000 = 5000 -> 5660
    expect(demandada_w).toBeCloseTo(5660, 0);
    expect(detalhamento_demanda[0].fator_demanda_pct).toBeCloseTo(66, 0);
    expect(detalhamento_demanda[1].fator_demanda_pct).toBe(100);
  });
});

describe('Eletrico — Corrente e queda de tensao', () => {
  it('4. I bifasico = P / (V × cosfi)', () => {
    const I = calcularCorrente(5500, 220, 'bifasico');
    expect(I).toBeCloseTo(27.17, 1); // 5500 / (220 × 0.92)
  });

  it('5. I trifasico inclui √3', () => {
    const I = calcularCorrente(10000, 380, 'trifasico');
    expect(I).toBeCloseTo(16.51, 1); // 10000 / (1.732 × 380 × 0.92)
  });

  it('6. Queda de tensao depende de L, I, S, V', () => {
    const dv = calcularQuedaTensao(30, 30, 16, 220);
    // ΔV = (2 × 30 × 30 × 0.0172) / 16 = 1.935 V -> 1.935/220 × 100 ≈ 0.88%
    expect(dv).toBeCloseTo(0.88, 1);
  });
});

describe('Eletrico — Memorial completo', () => {
  it('7. Memorial residencial 120 m² tipico', () => {
    const r = calcularMemorialEletrico(baseInput);
    expect(r.carga_total_instalada_w).toBeGreaterThan(15000);
    expect(r.carga_demandada_kw).toBeGreaterThan(0);
    expect(r.corrente_projeto_A).toBeGreaterThan(0);
    expect(r.dimensionamento_ramal.secao_condutor_mm2).toBeGreaterThanOrEqual(10);
    expect(r.dimensionamento_ramal.queda_tensao_pct).toBeLessThanOrEqual(4);
  });

  it('8. Protecao: DR obrigatorio em residencial', () => {
    const r = calcularMemorialEletrico(baseInput);
    expect(r.protecao.dr_obrigatorio).toBe(true);
    expect(r.protecao.dps_obrigatorio).toBe(true);
    expect(r.protecao.aterramento_tipo).toBe('TN-S');
  });

  it('9. Ramal longo aumenta secao (queda de tensao)', () => {
    const r = calcularMemorialEletrico({ ...baseInput, comprimento_ramal_m: 200 });
    expect(r.dimensionamento_ramal.secao_condutor_mm2).toBeGreaterThanOrEqual(16);
  });

  it('10. Disjuntor escolhido > corrente projeto (sobre dim 10%)', () => {
    const r = calcularMemorialEletrico(baseInput);
    expect(r.dimensionamento_ramal.disjuntor_geral_A).toBeGreaterThanOrEqual(r.corrente_projeto_A);
  });
});
