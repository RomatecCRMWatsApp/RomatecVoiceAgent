// v3.35.0: testes do calculator hidraulico NBR 5626.

import { describe, it, expect } from 'vitest';
import {
  calcularConsumoDiario,
  calcularReservatorio,
  calcularVazaoProjeto,
  somarPesos,
  dimensionarBarrilete,
  calcularMemorialHidraulico,
  PESOS_NBR5626,
} from './hidraulicoCalc';

describe('hidraulicoCalc — consumo diario (NBR 5626)', () => {
  it('1. 4 pessoas, sem maq lavar, sem limpeza -> 4×150 = 600 + 10% = 660 L', () => {
    expect(calcularConsumoDiario(4, { temMaqLavar: false, temLimpezaExterna: false })).toBe(660);
  });
  it('2. 4 pessoas + maq lavar + limpeza -> 600+120+80 = 800 + 10% = 880 L', () => {
    expect(calcularConsumoDiario(4, { temMaqLavar: true, temLimpezaExterna: true })).toBe(880);
  });
  it('3. 2 pessoas + maq lavar -> 300+120 = 420 + 10% (42) = 462 L', () => {
    expect(calcularConsumoDiario(2, { temMaqLavar: true, temLimpezaExterna: false })).toBe(462);
  });
  it('4. numPessoas=0 -> throw', () => {
    expect(() => calcularConsumoDiario(0, { temMaqLavar: false, temLimpezaExterna: false })).toThrow(/numPessoas/);
  });
});

describe('hidraulicoCalc — reservatorio', () => {
  it('5. Consumo 880 L -> v_minimo=1760, v_recomendado=2000 (arredondado em 250 L)', () => {
    const r = calcularReservatorio(880);
    expect(r.volume_minimo_L).toBe(1760);
    expect(r.volume_recomendado_L).toBe(2000);
  });
  it('6. Consumo 500 L -> v_minimo=1000, v_recomendado=1000 (multiplo de 250)', () => {
    const r = calcularReservatorio(500);
    expect(r.volume_minimo_L).toBe(1000);
    expect(r.volume_recomendado_L).toBe(1000);
  });
});

describe('hidraulicoCalc — vazao de projeto (Q = 0.3 × √ΣP)', () => {
  it('7. soma_pesos=4.5 -> Q ≈ 0.636 L/s', () => {
    expect(calcularVazaoProjeto(4.5)).toBeCloseTo(0.636, 3);
  });
  it('8. soma_pesos=0 -> Q = 0', () => {
    expect(calcularVazaoProjeto(0)).toBe(0);
  });
  it('9. soma_pesos negativo -> throw', () => {
    expect(() => calcularVazaoProjeto(-1)).toThrow(/somaPesos/);
  });
});

describe('hidraulicoCalc — somarPesos (NBR 5626 Tabela 1)', () => {
  it('10. Resid tipica (1 bacia, 2 lavatorio, 1 chuveiro, 1 pia, 1 tanque, 1 maq lavar) -> peso correto', () => {
    const r = somarPesos([
      { tipo: 'bacia_caixa_acoplada', quantidade: 1 },
      { tipo: 'lavatorio',            quantidade: 2 },
      { tipo: 'chuveiro',             quantidade: 1 },
      { tipo: 'pia_cozinha',          quantidade: 1 },
      { tipo: 'tanque',               quantidade: 1 },
      { tipo: 'maquina_lavar',        quantidade: 1 },
    ]);
    // 0.3 + 0.6 + 0.4 + 0.7 + 0.7 + 1.0 = 3.7
    expect(r.soma).toBeCloseTo(3.7, 2);
    expect(r.detalhamento).toHaveLength(6);
    expect(r.detalhamento[0].peso_total).toBeCloseTo(0.3, 2);
    expect(r.detalhamento[1].peso_total).toBeCloseTo(0.6, 2);
  });
  it('11. quantidade=0 e excluida do detalhamento', () => {
    const r = somarPesos([
      { tipo: 'bacia_caixa_acoplada', quantidade: 1 },
      { tipo: 'tanque',               quantidade: 0 },
      { tipo: 'chuveiro',             quantidade: 2 },
    ]);
    expect(r.detalhamento).toHaveLength(2);
    expect(r.detalhamento.find((d) => d.tipo === 'tanque')).toBeUndefined();
    expect(r.soma).toBeCloseTo(0.3 + 0.8, 2);
  });
  it('12. ducha higienica tem peso 0.10', () => {
    expect(PESOS_NBR5626.ducha_higienica).toBe(0.10);
  });
});

describe('hidraulicoCalc — dimensionar barrilete', () => {
  it('13. Q=0 -> DN=0, v=0, status=OK', () => {
    const r = dimensionarBarrilete(0);
    expect(r.DN_mm).toBe(0);
    expect(r.velocidade_ms).toBe(0);
    expect(r.status).toBe('OK');
  });
  it('14. Q≈0.6 L/s -> DN=20 (v < 3 m/s) status OK', () => {
    const r = dimensionarBarrilete(0.6);
    expect(r.DN_mm).toBeGreaterThanOrEqual(20);
    expect(r.velocidade_ms).toBeLessThanOrEqual(3.0);
    expect(r.status).toBe('OK');
  });
  it('15. Q alto (5 L/s) -> escolhe DN maior, ainda OK', () => {
    const r = dimensionarBarrilete(5);
    expect(r.DN_mm).toBeGreaterThanOrEqual(50);
    expect(r.status).toBe('OK');
  });
});

describe('hidraulicoCalc — integracao calcularMemorialHidraulico (cenario Nayara Brito)', () => {
  it('16. Resid 4 pessoas, ap. tipicos -> consumo 880, V_recom 2000, vazao=0.3√3.7', () => {
    const r = calcularMemorialHidraulico({
      uso_edificacao: 'Residencial unifamiliar',
      num_pessoas: 4,
      num_pavimentos: 1,
      area_construida_m2: 78.69,
      fonte_alimentacao: 'rede_publica',
      tem_aquecimento: 'eletrico',
      tem_maquina_lavar: true,
      tem_limpeza_externa: true,
      aparelhos: [
        { tipo: 'bacia_caixa_acoplada', quantidade: 1 },
        { tipo: 'lavatorio',            quantidade: 2 },
        { tipo: 'chuveiro',             quantidade: 1 },
        { tipo: 'pia_cozinha',          quantidade: 1 },
        { tipo: 'tanque',               quantidade: 1 },
        { tipo: 'maquina_lavar',        quantidade: 1 },
      ],
    });
    expect(r.consumo_diario_L).toBe(880);
    expect(r.reservatorio.volume_minimo_L).toBe(1760);
    expect(r.reservatorio.volume_recomendado_L).toBe(2000);
    expect(r.pesos.soma_pesos).toBeCloseTo(3.7, 2);
    expect(r.pesos.vazao_total_Ls).toBeCloseTo(0.577, 2); // 0.3×√3.7 ≈ 0.577
    expect(r.dimensionamento_barrilete?.DN_mm).toBeGreaterThanOrEqual(20);
    expect(r.dimensionamento_barrilete?.status).toBe('OK');
    expect(r.parametros_aplicados.consumo_per_capita_L_dia).toBe(150);
  });

  it('17. volume_reservatorio_L manual sobrescreve o auto-calculado', () => {
    const r = calcularMemorialHidraulico({
      uso_edificacao: 'Residencial unifamiliar',
      num_pessoas: 4,
      num_pavimentos: 1,
      area_construida_m2: 100,
      fonte_alimentacao: 'rede_publica',
      tem_aquecimento: 'eletrico',
      tem_maquina_lavar: true,
      tem_limpeza_externa: true,
      volume_reservatorio_L: 3000,
      aparelhos: [{ tipo: 'bacia_caixa_acoplada', quantidade: 1 }],
    });
    expect(r.reservatorio.volume_recomendado_L).toBe(3000);
  });
});
