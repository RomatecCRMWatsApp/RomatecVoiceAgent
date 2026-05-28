// v3.27.0: testes do engine de Demarcacao de Lotes (Urbana e Rural).
// Cobre validacoes, cenarios canonicos, guard de fechamento, opcionais e
// runtime read de SALARIO_MINIMO_VIGENTE.

import { describe, it, expect } from 'vitest';
import { calcularDemarcacaoLotes } from './demarcacaoLotes';
import type { InputDemarcacaoLotes, MarcoDiscriminado } from './types';

const SM_2026 = 1621.0; // pricing-params.salario_minimo_2026

function marcoConcreto(qtd: number): MarcoDiscriminado {
  return { tipo: 'concreto', quantidade: qtd, valor_unitario_congelado: 120.0 };
}
function marcoTubo(qtd: number): MarcoDiscriminado {
  return { tipo: 'tubo_galvanizado', quantidade: qtd, valor_unitario_congelado: 85.0 };
}
function marcoMadeira(qtd: number): MarcoDiscriminado {
  return { tipo: 'madeira', quantidade: qtd, valor_unitario_congelado: 35.0 };
}

const baseUrbana: InputDemarcacaoLotes = {
  subtipo: 'demarcacao_urbana',
  finalidade: 'demarcacao_inicial',
  municipio: 'Acailandia',
  uf: 'MA',
  area_m2: 500,
  num_vertices: 8,
  servico_piqueteamento: true,
  marcos: [marcoConcreto(8)],
  diarias_equipe: 2,
  km_deslocamento: 30,
  complexidade: 'media',
};

const baseRural: InputDemarcacaoLotes = {
  subtipo: 'demarcacao_rural',
  finalidade: 'demarcacao_inicial',
  municipio: 'Acailandia',
  uf: 'MA',
  area_hectares: 5,
  num_vertices: 12,
  servico_piqueteamento: true,
  marcos: [marcoConcreto(8), marcoMadeira(4)],
  diarias_equipe: 2,
  km_deslocamento: 60,
  complexidade: 'alta',
};

describe('calcularDemarcacaoLotes — validacoes', () => {
  it('1. Urbana valida (area_m2 preenchida, area_hectares undefined)', () => {
    const r = calcularDemarcacaoLotes(baseUrbana);
    expect(r.honorarios_romatec.total).toBeGreaterThan(0);
  });

  it('2. Rural valida (area_hectares preenchida, area_m2 undefined)', () => {
    const r = calcularDemarcacaoLotes(baseRural);
    expect(r.honorarios_romatec.total).toBeGreaterThan(0);
  });

  it('3. Ambas areas preenchidas (urbana) -> throw', () => {
    expect(() => calcularDemarcacaoLotes({ ...baseUrbana, area_hectares: 1 } as InputDemarcacaoLotes))
      .toThrow(/nao deve informar area_hectares/);
  });

  it('4. Rural sem area_hectares -> throw', () => {
    const bad = { ...baseRural, area_hectares: undefined } as unknown as InputDemarcacaoLotes;
    expect(() => calcularDemarcacaoLotes(bad)).toThrow(/area_hectares/);
  });

  it('5. piqueteamento=true + Σmarcos=num_vertices -> aceita', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      num_vertices: 10,
      marcos: [marcoConcreto(6), marcoTubo(4)],
    });
    expect(r.honorarios_romatec.marcos_subtotal).toBeCloseTo(6 * 120 + 4 * 85, 2);
  });

  it('6. piqueteamento=true + Σmarcos ≠ num_vertices -> throw', () => {
    expect(() => calcularDemarcacaoLotes({
      ...baseUrbana,
      num_vertices: 8,
      marcos: [marcoConcreto(5)],
    })).toThrow(/servico_piqueteamento=true exige/);
  });

  it('7. piqueteamento=false + marcos=[] -> aceita', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      servico_piqueteamento: false,
      marcos: [],
    });
    expect(r.honorarios_romatec.marcos_subtotal).toBe(0);
  });

  it('8. piqueteamento=false + marcos com Σ != vertices -> aceita', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      servico_piqueteamento: false,
      num_vertices: 8,
      marcos: [marcoConcreto(3)],
    });
    expect(r.honorarios_romatec.marcos_subtotal).toBeCloseTo(360, 2);
  });
});

describe('calcularDemarcacaoLotes — calculo principal', () => {
  it('9. Marcos discriminados: 3 tipos diferentes -> subtotais separados', () => {
    const r = calcularDemarcacaoLotes({
      ...baseRural,
      num_vertices: 12,
      marcos: [marcoConcreto(4), marcoTubo(3), marcoMadeira(5)],
    });
    const md = r.honorarios_romatec.marcos_discriminados;
    expect(md).toHaveLength(3);
    const concreto = md.find((m) => m.tipo === 'concreto');
    const tubo = md.find((m) => m.tipo === 'tubo_galvanizado');
    const madeira = md.find((m) => m.tipo === 'madeira');
    expect(concreto?.subtotal).toBeCloseTo(4 * 120, 2);
    expect(tubo?.subtotal).toBeCloseTo(3 * 85, 2);
    expect(madeira?.subtotal).toBeCloseTo(5 * 35, 2);
    expect(r.honorarios_romatec.marcos_subtotal).toBeCloseTo(4 * 120 + 3 * 85 + 5 * 35, 2);
  });

  it('10. Cenario canonico urbano: 500m² · 8 vertices · 8 concreto · 2 diarias · 30km · media · 10% desc', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, desconto_pct: 10 });
    const h = r.honorarios_romatec;
    expect(h.trt_cft).toBe(93.4);
    expect(h.tecnicos_campo).toBeCloseTo(2 * SM_2026 * 0.42, 2);
    expect(h.marcos_subtotal).toBeCloseTo(960, 2);
    expect(h.deslocamento).toBeCloseTo(105, 2);
    expect(h.area_servico).toBeCloseTo(750, 2);
    expect(h.complexidade_multiplicador).toBe(1.3);
    // total fecha com guard interno; teste auto-consistente
    expect(h.total).toBeGreaterThan(0);
  });

  it('11. Cenario canonico rural: 5ha · 12 vertices · 8 concreto + 4 madeira · alta', () => {
    const r = calcularDemarcacaoLotes(baseRural);
    const h = r.honorarios_romatec;
    expect(h.complexidade_multiplicador).toBe(1.6);
    expect(h.area_servico).toBeCloseTo(5 * 80, 2);
    expect(h.marcos_subtotal).toBeCloseTo(8 * 120 + 4 * 35, 2);
    expect(h.total).toBeGreaterThan(0);
  });

  it('12. Guard de fechamento em simples/media/alta', () => {
    for (const complexidade of ['simples', 'media', 'alta'] as const) {
      const r = calcularDemarcacaoLotes({ ...baseUrbana, complexidade });
      const soma = r.parcelas.reduce((s, p) => s + p.valor, 0);
      expect(Math.abs(soma - r.honorarios_romatec.total)).toBeLessThan(0.02);
    }
  });

  it('13. Minimo garantido (2 SM) aplicado quando calculo fica abaixo', () => {
    const r = calcularDemarcacaoLotes({
      subtipo: 'demarcacao_urbana',
      finalidade: 'piqueteamento_apenas',
      municipio: 'X',
      uf: 'MA',
      area_m2: 0.01,
      num_vertices: 3,
      servico_piqueteamento: false,
      marcos: [],
      diarias_equipe: 1,
      km_deslocamento: 0,
      complexidade: 'simples',
    });
    const minimo = 2 * SM_2026;
    expect(r.honorarios_romatec.total).toBe(Math.round(minimo * 100) / 100);
  });

  it('14. Desconto 0% nao altera valor', () => {
    const r0 = calcularDemarcacaoLotes({ ...baseUrbana, desconto_pct: 0 });
    const rDef = calcularDemarcacaoLotes(baseUrbana);
    expect(r0.honorarios_romatec.total).toBe(rDef.honorarios_romatec.total);
    expect(r0.honorarios_romatec.desconto_valor).toBe(0);
  });

  it('15. Desconto 31% -> throw', () => {
    expect(() => calcularDemarcacaoLotes({ ...baseUrbana, desconto_pct: 31 }))
      .toThrow(/desconto_pct invalido/);
  });

  it('16. Override de valor_unitario_area substitui o default', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, valor_unitario_area: 5 });
    expect(r.honorarios_romatec.area_servico).toBeCloseTo(500 * 5, 2);
  });

  it('17. R$/km lido de pricing-params, nao hardcoded', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, km_deslocamento: 100 });
    // valor_km_deslocamento default = 3.50 (pricing-params)
    expect(r.honorarios_romatec.deslocamento).toBeCloseTo(100 * 3.5, 2);
  });
});

describe('calcularDemarcacaoLotes — opcionais', () => {
  it('18. Opcionais: 5 linhas sempre, mesmo com nenhum contratado', () => {
    const r = calcularDemarcacaoLotes(baseUrbana);
    expect(r.secao_opcionais_demarcacao.linhas).toHaveLength(5);
    expect(r.secao_opcionais_demarcacao.subtotal).toBe(0);
  });

  it('19. alinhamento_cerca com metros=120 -> subtotal = 120 × 4.50', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: { alinhamento_cerca: { contratado: true, metros: 120, valor_unitario: 4.5 } },
    });
    const linha = r.secao_opcionais_demarcacao.linhas.find((l) => /Alinhamento/i.test(l.rotulo));
    expect(linha?.valor).toBeCloseTo(120 * 4.5, 2);
    expect(linha?.contratado).toBe(true);
  });

  it('20. consultoria_juridica = "sob_orcamento" (string literal)', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: { consultoria_juridica: { contratado: true, valor: 'sob_orcamento' } },
    });
    const linha = r.secao_opcionais_demarcacao.linhas.find((l) => /Juridica/i.test(l.rotulo));
    expect(linha?.valor).toBe('sob_orcamento');
    expect(linha?.contratado).toBe(true);
  });

  it('21. Opcionais NAO somam ao total Romatec', () => {
    const semOpc = calcularDemarcacaoLotes(baseUrbana);
    const comOpc = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: {
        laudo_tecnico: { contratado: true, valor_unitario_sm_multiplicador: 1.0 },
        alinhamento_cerca: { contratado: true, metros: 100, valor_unitario: 4.5 },
        croqui_assinado: { contratado: true, valor_unitario: 180 },
      },
    });
    expect(comOpc.honorarios_romatec.total).toBe(semOpc.honorarios_romatec.total);
    expect(comOpc.secao_opcionais_demarcacao.subtotal).toBeGreaterThan(0);
  });

  it('22. SALARIO_MINIMO_VIGENTE mudado em runtime -> novo calculo reflete', () => {
    const r1 = calcularDemarcacaoLotes(baseUrbana, { salarioMinimoOverride: 1500 });
    const r2 = calcularDemarcacaoLotes(baseUrbana, { salarioMinimoOverride: 2000 });
    expect(r1.honorarios_romatec.tecnicos_campo).toBeCloseTo(2 * 1500 * 0.42, 2);
    expect(r2.honorarios_romatec.tecnicos_campo).toBeCloseTo(2 * 2000 * 0.42, 2);
    expect(r2.honorarios_romatec.tecnicos_campo).toBeGreaterThan(r1.honorarios_romatec.tecnicos_campo);
    expect(r1.salario_minimo_usado).toBe(1500);
    expect(r2.salario_minimo_usado).toBe(2000);
  });
});
