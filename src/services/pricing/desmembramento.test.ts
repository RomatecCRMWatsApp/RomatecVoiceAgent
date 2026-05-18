// v1.99.16: testes do motor de Remembramento/Desmembramento com novos campos opcionais.
// Cobre:
//  - modo 'auto' default (sem mudancas — legado preservado)
//  - modo 'manual': lista de mapas + assessoria juridica
//  - validacao ART ∨ TRT em pecas_tecnicas
//  - lista de imoveis[] minimo 2, deriva area_total e numero_lotes_origem
//  - rejeita imovel sem endereco/matricula/area invalida
//  - rejeita modo manual sem mapas
//  - rejeita assessoria_juridica.incluir=true sem valor

import { describe, it, expect } from 'vitest';
import { calcularDesmembramento } from './desmembramento';
import type { InputDesmembramento } from './types';

const baseRem: InputDesmembramento = {
  tipo: 'remembramento',
  area_total_m2: 1500,
  numero_lotes_origem: 3,
  valor_venal_total: 300000,
  tipo_zona: 'urbana',
  iptu_em_dia: true,
  honorario_projeto_sm: 1.0,
};

describe('Remembramento — modo auto (legado)', () => {
  it('preserva fluxo paramétrico: 2 itens em secao_3, base_calculo SM × matrículas', async () => {
    const r = await calcularDesmembramento(baseRem);
    expect(r.custos.secao_3_honorarios).toHaveLength(2);
    expect(r.custos.secao_3_honorarios[0].descricao).toContain('Projeto de Remembramento');
    expect(r.custos.secao_3_honorarios[1].descricao).toContain('Assessoria e Acompanhamento');
    expect(r.custos.condicoes_pagamento?.length).toBeGreaterThanOrEqual(2);
    const baseProjeto = r.custos.base_calculo?.find(b => b.rotulo.includes('Projeto'));
    expect(baseProjeto?.formula).toContain('SM');
  });
});

describe('Remembramento — modo manual', () => {
  it('aceita lista de mapas e assessoria jurídica, total = soma + assessoria', async () => {
    const r = await calcularDesmembramento({
      ...baseRem,
      modo_calculo: 'manual',
      mapas: [
        { numero: 1, descricao: 'Mapa de situação', valor: 1500 },
        { numero: 2, descricao: 'Mapa de localização', valor: 1200 },
      ],
      assessoria_juridica: { incluir: true, valor: 800 },
    });
    expect(r.custos.secao_3_honorarios).toHaveLength(3);
    expect(r.custos.secao_3_honorarios[0].descricao).toBe('Mapa 01 — Mapa de situação');
    expect(r.custos.secao_3_honorarios[0].valor).toBe(1500);
    expect(r.custos.secao_3_honorarios[2].descricao).toBe('Assessoria Técnica Jurídica');
    expect(r.custos.secao_3_honorarios[2].valor).toBe(800);
    expect(r.custos.condicoes_pagamento).toHaveLength(1);
    expect(r.custos.condicoes_pagamento?.[0].rotulo).toBe('A combinar entre as partes');
    expect(r.custos.condicoes_pagamento?.[0].valor).toBe(3500);
  });

  it('modo manual sem mapas → erro', async () => {
    await expect(
      calcularDesmembramento({ ...baseRem, modo_calculo: 'manual', mapas: [] })
    ).rejects.toThrow(/pelo menos 1 mapa/);
  });

  it('assessoria_juridica.incluir=true sem valor → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseRem,
        modo_calculo: 'manual',
        mapas: [{ numero: 1, valor: 1000 }],
        assessoria_juridica: { incluir: true },
      })
    ).rejects.toThrow(/Assessoria.*valor/);
  });

  it('mapa com valor <= 0 → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseRem,
        modo_calculo: 'manual',
        mapas: [{ numero: 1, valor: 0 }],
      })
    ).rejects.toThrow(/Mapa 1.*valor/);
  });
});

describe('Remembramento — lista de imóveis', () => {
  it('imoveis com 3 entradas: deriva area_total e numero_lotes_origem se ausentes', async () => {
    const r = await calcularDesmembramento({
      ...baseRem,
      area_total_m2: 0,         // força derivação
      numero_lotes_origem: undefined as unknown as number, // força derivação
      imoveis: [
        { ordem: 1, area_m2: 500, endereco: 'Rua A, 10', matricula: 'M-001' },
        { ordem: 2, area_m2: 600, endereco: 'Rua A, 12', matricula: 'M-002' },
        { ordem: 3, area_m2: 400, endereco: 'Rua A, 14', matricula: 'M-003', cri: 'CRI Açailândia' },
      ],
    });
    // Deve calcular sem lançar — área total derivada = 1500, lotes origem = 3
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
  });

  it('imoveis com 1 entrada → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseRem,
        imoveis: [{ ordem: 1, area_m2: 500, endereco: 'Rua A', matricula: 'M-001' }],
      })
    ).rejects.toThrow(/pelo menos 2 entradas/);
  });

  it('imóvel sem endereço → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseRem,
        imoveis: [
          { ordem: 1, area_m2: 500, endereco: '', matricula: 'M-001' },
          { ordem: 2, area_m2: 600, endereco: 'Rua A', matricula: 'M-002' },
        ],
      })
    ).rejects.toThrow(/Imóvel #1: endereço obrigatório/);
  });

  it('imóvel com área <= 0 → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseRem,
        imoveis: [
          { ordem: 1, area_m2: 0, endereco: 'Rua A', matricula: 'M-001' },
          { ordem: 2, area_m2: 600, endereco: 'Rua A', matricula: 'M-002' },
        ],
      })
    ).rejects.toThrow(/Imóvel #1: área deve ser > 0/);
  });
});

describe('Desmembramento/Desdobro — modalidade e unidade', () => {
  const baseDesm: InputDesmembramento = {
    tipo: 'desmembramento',
    area_total_m2: 2000,
    numero_lotes_resultantes: 4,
    valor_venal_total: 400000,
    tipo_zona: 'urbana',
    iptu_em_dia: true,
    honorario_projeto_sm: 1.0,
  };

  it('modalidade=urbana exige unidade m² (rejeita ha)', async () => {
    await expect(
      calcularDesmembramento({ ...baseDesm, modalidade: 'urbana', unidade_area: 'ha' })
    ).rejects.toThrow(/Modalidade 'urbana' exige unidade 'm2'/);
  });

  it('modalidade=rural exige unidade ha (rejeita m²)', async () => {
    await expect(
      calcularDesmembramento({ ...baseDesm, modalidade: 'rural', unidade_area: 'm2' })
    ).rejects.toThrow(/Modalidade 'rural' exige unidade 'ha'/);
  });

  it('modalidade=rural + unidade=ha → ok', async () => {
    const r = await calcularDesmembramento({
      ...baseDesm,
      area_total_m2: 50, // 50 hectares
      modalidade: 'rural',
      unidade_area: 'ha',
    });
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
  });
});

describe('Desmembramento/Desdobro — frações resultantes', () => {
  const baseDesdobro: InputDesmembramento = {
    tipo: 'desmembramento',
    area_total_m2: 1000,
    numero_lotes_resultantes: 3,
    valor_venal_total: 300000,
    tipo_zona: 'urbana',
    iptu_em_dia: true,
    honorario_projeto_sm: 1.0,
    modalidade: 'urbana',
    unidade_area: 'm2',
  };

  it('modo manual com frações: secao_3 vira lista de frações', async () => {
    const r = await calcularDesmembramento({
      ...baseDesdobro,
      modo_calculo: 'manual',
      fracoes: [
        { numero: 1, area: 300, valor: 450, descricao: 'Lote frente Rua A' },
        { numero: 2, area: 350, valor: 500 },
        { numero: 3, area: 350, valor: 450 },
      ],
    });
    expect(r.custos.secao_3_honorarios).toHaveLength(3);
    expect(r.custos.secao_3_honorarios[0].descricao).toContain('Fração 01');
    expect(r.custos.secao_3_honorarios[0].descricao).toContain('300');
    expect(r.custos.secao_3_honorarios[0].descricao).toContain('Lote frente Rua A');
    expect(r.custos.secao_3_honorarios.reduce((s, i) => s + i.valor, 0)).toBe(1400);
    expect(r.custos.condicoes_pagamento?.[0].valor).toBe(1400);
  });

  it('soma das frações ≤ matriz (tolerância 1 m²): aceita 1001 vs 1000', async () => {
    const r = await calcularDesmembramento({
      ...baseDesdobro,
      modo_calculo: 'manual',
      fracoes: [
        { numero: 1, area: 500.5, valor: 450 },
        { numero: 2, area: 500.5, valor: 450 },
      ],
    });
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
  });

  it('soma das frações excede matriz acima da tolerância → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseDesdobro,
        modo_calculo: 'manual',
        fracoes: [
          { numero: 1, area: 600, valor: 450 },
          { numero: 2, area: 500, valor: 450 },
        ],
      })
    ).rejects.toThrow(/excede a área da matriz/);
  });

  it('rural com tolerância 0.01 ha', async () => {
    const r = await calcularDesmembramento({
      tipo: 'desmembramento',
      area_total_m2: 10, // 10 hectares
      numero_lotes_resultantes: 2,
      valor_venal_total: 100000,
      tipo_zona: 'rural',
      iptu_em_dia: true,
      honorario_projeto_sm: 1.0,
      modalidade: 'rural',
      unidade_area: 'ha',
      modo_calculo: 'manual',
      fracoes: [
        { numero: 1, area: 5.005, valor: 450 },
        { numero: 2, area: 5.005, valor: 450 },
      ],
    });
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
  });

  it('fração com valor <= 0 → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseDesdobro,
        modo_calculo: 'manual',
        fracoes: [
          { numero: 1, area: 500, valor: 0 },
          { numero: 2, area: 500, valor: 450 },
        ],
      })
    ).rejects.toThrow(/Fração 1.*valor/);
  });

  it('fração com área <= 0 → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseDesdobro,
        fracoes: [
          { numero: 1, area: 0, valor: 450 },
          { numero: 2, area: 500, valor: 450 },
        ],
      })
    ).rejects.toThrow(/Fração 1.*área/);
  });

  it('apenas 1 fração → erro (mínimo 2)', async () => {
    await expect(
      calcularDesmembramento({
        ...baseDesdobro,
        modo_calculo: 'manual',
        fracoes: [{ numero: 1, area: 500, valor: 450 }],
      })
    ).rejects.toThrow(/Mínimo de 2 frações/);
  });

  it('fracoes sem modo_calculo manual: deriva numero_lotes_resultantes', async () => {
    // Sem modo_calculo='manual' a engine usa o caminho paramétrico, mas ainda valida fracoes
    const r = await calcularDesmembramento({
      ...baseDesdobro,
      numero_lotes_resultantes: undefined as unknown as number,
      fracoes: [
        { numero: 1, area: 400, valor: 450 },
        { numero: 2, area: 400, valor: 450 },
        { numero: 3, area: 200, valor: 450 },
      ],
    });
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
  });
});

describe('Remembramento — peças técnicas', () => {
  it('art=true | trt=false → ok', async () => {
    const r = await calcularDesmembramento({
      ...baseRem,
      pecas_tecnicas: { mapa: true, memorial: true, art: true, trt: false, requerimentos: true },
    });
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
  });

  it('art=false | trt=true → ok (apenas TRT)', async () => {
    const r = await calcularDesmembramento({
      ...baseRem,
      pecas_tecnicas: { mapa: true, memorial: true, art: false, trt: true, requerimentos: true },
    });
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
  });

  it('art=false E trt=false → erro', async () => {
    await expect(
      calcularDesmembramento({
        ...baseRem,
        pecas_tecnicas: { mapa: true, memorial: true, art: false, trt: false, requerimentos: true },
      })
    ).rejects.toThrow(/ART.*TRT/);
  });
});
