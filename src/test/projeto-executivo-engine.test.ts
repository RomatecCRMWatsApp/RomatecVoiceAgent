// v3.24.5: tests da engine de Projeto Executivo.
//
// Cobre:
// 1. Cálculo: area × R$/m² = valor_projetos
// 2. ART/TRT auto por área (toggle em 80m²)
// 3. Override manual respeita escolha
// 4. Taxa esboço fica FORA do subtotal/valor_total
// 5. Alvará/placa opcionais zeram quando desmarcados
// 6. Desconto subtrai corretamente
// 7. round2 HALF_UP consistente

import { describe, it, expect } from 'vitest';
import {
  calcularProjetoExecutivo,
  round2,
  DEFAULTS_PROJETO_EXECUTIVO,
  PROJETOS_DEFAULT_PROJETO_EXECUTIVO,
} from '../services/pricing/projetoExecutivo';
import type { InputProjetoExecutivo } from '../services/pricing/types';

function inputBase(over: Partial<InputProjetoExecutivo> = {}): InputProjetoExecutivo {
  return {
    endereco_obra: 'Rua Teste, 123',
    cidade_obra: 'Acailandia',
    uf_obra: 'MA',
    tipo_edificacao: 'residencial',
    area_construir: 100,
    valor_m2: 25,
    alvara_incluir: true,
    alvara_valor: 500,
    placa_incluir: true,
    placa_valor: 350,
    ...over,
  };
}

describe('round2 (HALF_UP)', () => {
  it('arredonda 2.005 pra 2.01 (HALF_UP, nao banker)', () => {
    expect(round2(2.005)).toBe(2.01);
  });
  it('arredonda 1.005 pra 1.01', () => {
    expect(round2(1.005)).toBe(1.01);
  });
  it('mantem 100 inteiro', () => {
    expect(round2(100)).toBe(100);
  });
});

describe('1. calculo area × R$/m²', () => {
  it('100m² × R$ 25 = R$ 2.500 no item projetos', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 100, valor_m2: 25 }));
    expect(r.projeto_executivo.valor_projetos).toBe(2500);
    expect(r.custos.secao_3_honorarios[0].valor).toBe(2500);
  });

  it('250.5m² × R$ 30,50 = R$ 7.640,25', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 250.5, valor_m2: 30.50 }));
    expect(r.projeto_executivo.valor_projetos).toBe(7640.25);
  });

  it('rejeita area_construir <= 0', async () => {
    await expect(calcularProjetoExecutivo(inputBase({ area_construir: 0 }))).rejects.toThrow();
    await expect(calcularProjetoExecutivo(inputBase({ area_construir: -10 }))).rejects.toThrow();
  });

  it('rejeita valor_m2 <= 0', async () => {
    await expect(calcularProjetoExecutivo(inputBase({ valor_m2: 0 }))).rejects.toThrow();
  });
});

describe('2. ART/TRT auto por area (toggle em 80m²)', () => {
  it('area 79m² -> TRT auto', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 79 }));
    expect(r.projeto_executivo.responsabilidade_tipo).toBe('TRT');
    expect(r.projeto_executivo.responsabilidade_auto).toBe(true);
    expect(r.projeto_executivo.responsabilidade_valor).toBe(DEFAULTS_PROJETO_EXECUTIVO.TRT_VALOR);
  });

  it('area 80m² (limite EXATO) -> TRT (regra <=80)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 80 }));
    expect(r.projeto_executivo.responsabilidade_tipo).toBe('TRT');
  });

  it('area 80.01m² -> ART (regra >80)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 80.01 }));
    expect(r.projeto_executivo.responsabilidade_tipo).toBe('ART');
    expect(r.projeto_executivo.responsabilidade_valor).toBe(DEFAULTS_PROJETO_EXECUTIVO.ART_VALOR);
  });

  it('area 200m² -> ART auto com valor default R$ 233,94', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ area_construir: 200 }));
    expect(r.projeto_executivo.responsabilidade_tipo).toBe('ART');
    expect(r.projeto_executivo.responsabilidade_valor).toBe(233.94);
  });
});

describe('3. Override manual respeita escolha', () => {
  it('responsabilidade_auto=false + tipo=ART na area 50m² mantem ART', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 50,
      responsabilidade_auto: false,
      responsabilidade_tipo: 'ART',
    }));
    expect(r.projeto_executivo.responsabilidade_tipo).toBe('ART');
    expect(r.projeto_executivo.responsabilidade_auto).toBe(false);
  });

  it('responsabilidade_auto=false + tipo=TRT na area 200m² mantem TRT (CEO assume risco)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 200,
      responsabilidade_auto: false,
      responsabilidade_tipo: 'TRT',
    }));
    expect(r.projeto_executivo.responsabilidade_tipo).toBe('TRT');
  });

  it('responsabilidade_valor override usa valor informado nao default', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 100,
      responsabilidade_valor: 150,
    }));
    expect(r.projeto_executivo.responsabilidade_valor).toBe(150);
  });
});

describe('4. Taxa esboço NAO entra no subtotal/valor_total', () => {
  it('taxa default 750 nao soma ao subtotal', async () => {
    // Area 50 -> TRT auto (<=80). Projects 50*25=1250 + TRT 93.40 = 1343.40
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 50,
      valor_m2: 25,
      alvara_incluir: false,
      placa_incluir: false,
    }));
    expect(r.projeto_executivo.subtotal).toBe(1343.40);
    expect(r.projeto_executivo.valor_total).toBe(1343.40);
    // Taxa esboco esta exposta mas fora do total
    expect(r.projeto_executivo.taxa_esboco).toBe(750);
  });

  it('aviso da taxa aparece em custos.avisos', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    expect(r.custos.avisos.some(a => /R\$ 750,00.*NAO esta incluida/i.test(a))).toBe(true);
  });

  it('taxa customizada respeita input', async () => {
    const r = await calcularProjetoExecutivo(inputBase({ taxa_esboco: 1200 }));
    expect(r.projeto_executivo.taxa_esboco).toBe(1200);
  });
});

describe('5. Alvará/placa opcionais zeram quando desmarcados', () => {
  it('alvara_incluir=false zera alvara_valor no total', async () => {
    // Area 50 -> TRT. Projects 1250 + TRT 93.40 = 1343.40
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 50,
      valor_m2: 25,
      alvara_incluir: false,
      alvara_valor: 9999,    // ignorado
      placa_incluir: false,
      placa_valor: 0,
    }));
    expect(r.projeto_executivo.subtotal).toBe(1343.40);
    expect(r.projeto_executivo.alvara.incluir).toBe(false);
    expect(r.projeto_executivo.alvara.valor).toBe(0);
  });

  it('placa_incluir=false idem', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      alvara_incluir: false,
      placa_incluir: false,
      placa_valor: 999,
    }));
    expect(r.projeto_executivo.placa.valor).toBe(0);
  });

  it('ambos incluidos somam ao total', async () => {
    // Area 50 -> TRT. Projects 1250 + TRT 93.40 + 500 + 350 = 2193.40
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 50, valor_m2: 25,
      alvara_incluir: true,  alvara_valor: 500,
      placa_incluir: true,   placa_valor: 350,
    }));
    expect(r.projeto_executivo.subtotal).toBe(2193.40);
  });
});

describe('6. Desconto subtrai do subtotal', () => {
  it('desconto R$ 200 do subtotal 2193.40 = 1993.40 (area 50, TRT)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 50, valor_m2: 25,
      alvara_incluir: true, alvara_valor: 500,
      placa_incluir: true,  placa_valor: 350,
      desconto: 200,
    }));
    expect(r.projeto_executivo.subtotal).toBe(2193.40);
    expect(r.projeto_executivo.desconto).toBe(200);
    expect(r.projeto_executivo.valor_total).toBe(1993.40);
  });

  it('desconto zero (sem desconto)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 100, valor_m2: 25,
      alvara_incluir: false, placa_incluir: false,
    }));
    expect(r.projeto_executivo.desconto).toBe(0);
    expect(r.projeto_executivo.valor_total).toBe(r.projeto_executivo.subtotal);
  });
});

describe('7. Projetos selecionados', () => {
  it('quando input nao traz lista, aplica defaults (6 selecionados de 7, PCI=false)', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    expect(r.projeto_executivo.projetos_selecionados).toHaveLength(7);
    const selecionados = r.projeto_executivo.projetos_selecionados.filter(p => p.selecionado);
    expect(selecionados).toHaveLength(6);
    // PCI vem desmarcado por default
    const pci = r.projeto_executivo.projetos_selecionados.find(p => p.codigo === 'pci');
    expect(pci?.selecionado).toBe(false);
  });

  it('input com lista customizada respeita', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      projetos_selecionados: [
        { codigo: 'arquitetonico', nome: 'Arquitetonico', ordem: 1, selecionado: true, detalhamento_entrega: 'Custom' },
      ],
    }));
    expect(r.projeto_executivo.projetos_selecionados).toHaveLength(1);
    expect(r.custos.secao_1_projetos[0]).toContain('Arquitetonico');
    expect(r.custos.secao_1_projetos[0]).toContain('Custom');
  });
});

describe('8. Estrutura do retorno (interface ResultadoCalculo + extra)', () => {
  it('retorna custos completos + projeto_executivo extra', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    expect(r.custos.secao_1_projetos).toBeInstanceOf(Array);
    expect(r.custos.secao_2_taxas).toBeInstanceOf(Array);
    expect(r.custos.secao_3_honorarios).toBeInstanceOf(Array);
    expect(r.custos.condicoes_pagamento).toBeInstanceOf(Array);
    expect(r.custos.secao_4_checklist).toBeInstanceOf(Array);
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
    expect(r.custos.avisos).toBeInstanceOf(Array);
    expect(r.projeto_executivo).toBeDefined();
    expect(r.projeto_executivo.cno_observacao).toMatch(/CNO/);
    expect(r.projeto_executivo.cno_observacao).toMatch(/Alvara/i);
  });

  it('condicoes_pagamento somam ao valor_total (40/40/20)', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    const soma = r.custos.condicoes_pagamento!.reduce((s, c) => s + c.valor, 0);
    expect(round2(soma)).toBe(r.projeto_executivo.valor_total);
  });
});

describe('9. Defaults exportados estaveis', () => {
  it('valores default conhecidos', () => {
    expect(DEFAULTS_PROJETO_EXECUTIVO.VALOR_M2).toBe(25.00);
    expect(DEFAULTS_PROJETO_EXECUTIVO.TAXA_ESBOCO).toBe(750.00);
    expect(DEFAULTS_PROJETO_EXECUTIVO.ART_VALOR).toBe(233.94);
    expect(DEFAULTS_PROJETO_EXECUTIVO.TRT_VALOR).toBe(93.40);
    expect(DEFAULTS_PROJETO_EXECUTIVO.AREA_LIMITE_TRT).toBe(80.00);
  });

  it('PROJETOS_DEFAULT tem 7 itens com NBRs', () => {
    expect(PROJETOS_DEFAULT_PROJETO_EXECUTIVO).toHaveLength(7);
    expect(PROJETOS_DEFAULT_PROJETO_EXECUTIVO.find(p => p.codigo === 'arquitetonico')?.detalhamento_entrega)
      .toMatch(/NBR 13531/);
    expect(PROJETOS_DEFAULT_PROJETO_EXECUTIVO.find(p => p.codigo === 'hidraulico')?.detalhamento_entrega)
      .toMatch(/NBR 5626/);
    expect(PROJETOS_DEFAULT_PROJETO_EXECUTIVO.find(p => p.codigo === 'eletrico')?.detalhamento_entrega)
      .toMatch(/NBR 5410/);
    expect(PROJETOS_DEFAULT_PROJETO_EXECUTIVO.find(p => p.codigo === 'estrutural')?.detalhamento_entrega)
      .toMatch(/NBR 6118/);
  });
});
