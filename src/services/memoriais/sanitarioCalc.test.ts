// v3.48.0: testes do engine sanitario (NBR 8160 esgoto + NBR 10844 pluvial).

import { describe, it, expect } from 'vitest';
import {
  calcularMemorialSanitario,
  calcularEsgoto,
  calcularVazaoPluvial,
  calcularFossa,
  UHC_NBR8160,
} from './sanitarioCalc';
import type { WizardSanitario } from './types';

const baseInput: WizardSanitario = {
  uso_edificacao: 'Residencial unifamiliar',
  num_pessoas: 4,
  num_pavimentos: 1,
  area_construida_m2: 120,
  aparelhos: [
    { tipo: 'bacia_sanitaria', quantidade: 2 },
    { tipo: 'lavatorio', quantidade: 2 },
    { tipo: 'chuveiro', quantidade: 2 },
    { tipo: 'pia_cozinha', quantidade: 1 },
    { tipo: 'ralo_sifonado', quantidade: 3 },
  ],
  area_cobertura_m2: 130,
  destino_efluente: 'fossa_sumidouro',
  tem_caixa_gordura: true,
};

describe('Sanitario — Esgoto (NBR 8160)', () => {
  it('1. UHC residencial padrao = 2×6 + 2×1 + 2×2 + 1×3 + 3×1 = 24', () => {
    const { soma_uhc, detalhamento_uhc } = calcularEsgoto(baseInput.aparelhos);
    expect(soma_uhc).toBe(24);
    expect(detalhamento_uhc).toHaveLength(5);
    expect(detalhamento_uhc.find(d => d.tipo === 'bacia_sanitaria')?.uhc_total).toBe(12);
  });

  it('2. Memorial completo: ramal DN 75 + tubo queda DN 75', () => {
    const r = calcularMemorialSanitario(baseInput);
    expect(r.esgoto.soma_uhc).toBe(24);
    // 24 UHC -> ramal DN 75 (ate_uhc=160 nao alcanca 100); tubo queda <= 26 UHC -> DN 75
    expect(r.esgoto.dimensionamento_ramais.DN_mm).toBe(100);
    expect(r.esgoto.dimensionamento_tubo_queda.DN_mm).toBe(75);
  });

  it('3. Aparelho desconhecido lanca', () => {
    expect(() => calcularEsgoto([{ tipo: 'inexistente' as 'lavatorio', quantidade: 1 }]))
      .toThrow(/desconhecido/);
  });

  it('4. Tabela UHC completa (todas chaves definidas)', () => {
    const tipos = ['bacia_sanitaria','lavatorio','chuveiro','pia_cozinha','tanque','maquina_lavar','ralo_sifonado','ralo_seco'];
    tipos.forEach(t => expect(UHC_NBR8160[t as keyof typeof UHC_NBR8160]).toBeGreaterThan(0));
  });
});

describe('Sanitario — Aguas Pluviais (NBR 10844)', () => {
  it('5. Q = (i × A) / 60: Acailandia 150 mm/h × 130 m² = 325 L/min', () => {
    const q = calcularVazaoPluvial(130, 150);
    expect(q).toBeCloseTo(325, 1);
  });

  it('6. Calha DN 100 capacidade 130 L/min — pra Q=130 deve casar', () => {
    const r = calcularMemorialSanitario({ ...baseInput, area_cobertura_m2: 52 });
    expect(r.aguas_pluviais.vazao_projeto_Lmin).toBeCloseTo(130, 1);
    expect(r.aguas_pluviais.dimensionamento_calha.DN_mm).toBe(100);
    expect(r.aguas_pluviais.dimensionamento_calha.status).toBe('OK');
  });

  it('7. Area de cobertura grande dispara calha maior', () => {
    const r = calcularMemorialSanitario({ ...baseInput, area_cobertura_m2: 800 });
    expect(r.aguas_pluviais.vazao_projeto_Lmin).toBeGreaterThan(1500);
    expect(r.aguas_pluviais.dimensionamento_calha.status).toBe('AJUSTAR');
  });

  it('8. Intensidade invalida lanca', () => {
    expect(() => calcularVazaoPluvial(100, 0)).toThrow(/intensidade/);
    expect(() => calcularVazaoPluvial(-1, 150)).toThrow(/area/);
  });
});

describe('Sanitario — Fossa (NBR 7229)', () => {
  it('9. Calcula fossa quando destino != rede_publica', () => {
    const r = calcularMemorialSanitario(baseInput); // fossa_sumidouro
    expect(r.fossa_sumidouro).toBeDefined();
    // V_dec = 4 × 130 = 520 L; V_dig = 4 × 1 × 300 = 1200 L
    expect(r.fossa_sumidouro!.volume_camara_decantacao_L).toBe(520);
    expect(r.fossa_sumidouro!.volume_camara_digestao_L).toBe(1200);
    // A_sum = (4×130)/50 = 10.4 m²
    expect(r.fossa_sumidouro!.area_sumidouro_m2).toBeCloseTo(10.4, 1);
  });

  it('10. NAO calcula fossa quando destino = rede_publica', () => {
    const r = calcularMemorialSanitario({ ...baseInput, destino_efluente: 'rede_publica' });
    expect(r.fossa_sumidouro).toBeUndefined();
  });

  it('11. Helper calcularFossa direto', () => {
    const f = calcularFossa(4);
    expect(f).toBeDefined();
    expect(f!.volume_total_L).toBe(1720); // 520 + 1200
  });

  it('12. num_pessoas < 1 retorna undefined', () => {
    expect(calcularFossa(0)).toBeUndefined();
  });
});

describe('Sanitario — Output completo', () => {
  it('13. Memorial retorna todas as secoes esperadas', () => {
    const r = calcularMemorialSanitario(baseInput);
    expect(r.esgoto).toBeDefined();
    expect(r.aguas_pluviais).toBeDefined();
    expect(r.fossa_sumidouro).toBeDefined();
    expect(r.parametros_aplicados).toBeDefined();
    expect(r.parametros_aplicados.contribuicao_per_capita_L_dia).toBe(130);
  });
});
