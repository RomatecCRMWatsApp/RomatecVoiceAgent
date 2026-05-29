// v3.48.0: testes do engine estrutural (NBR 6118 + NBR 6122).

import { describe, it, expect } from 'vitest';
import {
  calcularMemorialEstrutural,
  calcularPreDimensionamento,
  calcularCargasEstimadas,
  calcularFundacao,
  calcularConsumosConcretoAco,
} from './estruturalCalc';
import type { WizardEstrutural } from './types';

const baseInput: WizardEstrutural = {
  uso_edificacao: 'Residencial unifamiliar',
  area_construida_m2: 120,
  num_pavimentos: 2,
  vao_medio_pilares_m: 4,
  classe_concreto: 'C25',
  tipo_solo: 'arenoso_compacto',
  tem_subsolo: false,
  laje_tipo: 'macica',
};

describe('Estrutural — Pre-dimensionamento (NBR 6118)', () => {
  it('1. Pilar secao minima sempre 14×30 cm (NBR 6118 13.2.3)', () => {
    const pre = calcularPreDimensionamento(baseInput);
    expect(pre.pilar_secao_min_cm.b).toBe(14);
    expect(pre.pilar_secao_min_cm.h).toBe(30);
    expect(pre.pilar_area_concreto_cm2).toBeGreaterThanOrEqual(14 * 30);
  });

  it('2. Viga altura ≈ vao/12 (residencial)', () => {
    const pre = calcularPreDimensionamento({ ...baseInput, vao_medio_pilares_m: 6 });
    // h = 600/12 = 50 cm
    expect(pre.viga_altura_recomendada_cm).toBeGreaterThanOrEqual(50);
  });

  it('3. Laje espessura >= L/40', () => {
    const pre = calcularPreDimensionamento({ ...baseInput, vao_medio_pilares_m: 8 });
    // 800/40 = 20 cm
    expect(pre.laje_espessura_min_cm).toBeGreaterThanOrEqual(20);
  });
});

describe('Estrutural — Cargas estimadas (NBR 6120)', () => {
  it('4. Laje macica padrao 2.5 kN/m²', () => {
    const c = calcularCargasEstimadas(baseInput);
    expect(c.peso_proprio_estrutura_kn_m2).toBe(2.5);
  });

  it('5. Carga acidental residencial = 1.5 kN/m²', () => {
    const c = calcularCargasEstimadas(baseInput);
    expect(c.carga_acidental_kn_m2).toBe(1.5);
    expect(c.carga_total_pavimento_kn_m2).toBe(5.0); // 2.5 + 1.5 + 1.0 rev
  });

  it('6. User pode override carga acidental', () => {
    const c = calcularCargasEstimadas({ ...baseInput, carga_acidental_kn_m2: 3.5 });
    expect(c.carga_acidental_kn_m2).toBe(3.5);
  });
});

describe('Estrutural — Fundacao (NBR 6122)', () => {
  it('7. Solo arenoso compacto -> sapata isolada/corrida', () => {
    const f = calcularFundacao(baseInput);
    expect(f.tensao_admissivel_solo_kpa).toBe(300);
    expect(['sapata_isolada', 'sapata_corrida']).toContain(f.tipo);
  });

  it('8. Solo argiloso mole + carga alta -> estaca ou radier', () => {
    const f = calcularFundacao({ ...baseInput, tipo_solo: 'argiloso_mole', num_pavimentos: 5 });
    expect(['estaca_pre_moldada', 'radier']).toContain(f.tipo);
  });

  it('9. Rocha -> 1000 kPa', () => {
    const f = calcularFundacao({ ...baseInput, tipo_solo: 'rocha' });
    expect(f.tensao_admissivel_solo_kpa).toBe(1000);
  });

  it('10. Profundidade minima depende do tipo (>= 0.8 sapata, 1.5 estaca)', () => {
    const f = calcularFundacao(baseInput);
    expect(f.profundidade_minima_m).toBeGreaterThanOrEqual(0.8);
  });
});

describe('Estrutural — Concreto e aco (consumos)', () => {
  it('11. Concreto: 0.15 m³/m² × pavimentos', () => {
    const { concreto } = calcularConsumosConcretoAco(baseInput);
    // 120 × 0.15 × 2 = 36 m³
    expect(concreto.consumo_estimado_m3).toBeCloseTo(36, 1);
  });

  it('12. Aco: 80 kg/m³ residencial (consumo proporcional)', () => {
    const { aco, concreto } = calcularConsumosConcretoAco(baseInput);
    expect(aco.taxa_kg_m3_concreto).toBe(80);
    expect(aco.consumo_estimado_kg).toBeCloseTo(concreto.consumo_estimado_m3 * 80, 0);
  });

  it('13. Cobrimento CAA II = 30 mm pra viga/pilar', () => {
    const { concreto } = calcularConsumosConcretoAco(baseInput);
    expect(concreto.cobrimento_minimo_mm).toBe(30);
  });
});

describe('Estrutural — Validacoes', () => {
  it('14. vao < 2 m lanca', () => {
    expect(() => calcularMemorialEstrutural({ ...baseInput, vao_medio_pilares_m: 1 }))
      .toThrow(/vao_medio_pilares_m/);
  });

  it('15. num_pavimentos < 1 lanca', () => {
    expect(() => calcularMemorialEstrutural({ ...baseInput, num_pavimentos: 0 }))
      .toThrow(/num_pavimentos/);
  });

  it('16. Memorial completo retorna todas as secoes', () => {
    const r = calcularMemorialEstrutural(baseInput);
    expect(r.pre_dimensionamento).toBeDefined();
    expect(r.cargas_estimadas).toBeDefined();
    expect(r.fundacao_sugerida).toBeDefined();
    expect(r.concreto).toBeDefined();
    expect(r.aco).toBeDefined();
    expect(r.parametros_aplicados).toBeDefined();
  });
});
