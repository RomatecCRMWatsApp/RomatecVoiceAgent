// v3.133.0: cobre as mudanças da retificação — seletor ART/TRT/RRT,
// área real a apurar (pós-levantamento) e diligências/tributos editáveis.
import { describe, it, expect } from 'vitest';
import { calcularRetificacao } from './retificacao';
import { anotacaoTecnica } from './params';
import type { InputRetificacao } from './types';

const BASE: InputRetificacao = {
  area_atual_matricula: 1273.24,
  area_real_levantada: 1280,
  valor_venal: 25464.8,
  tipo_retificacao: 'administrativa',
  tem_anuencia_confrontantes: true,
  honorario_projeto_sm: 1.0,
};

function acharAnotacao(r: Awaited<ReturnType<typeof calcularRetificacao>>) {
  return r.custos.secao_2_taxas.find(t =>
    /ART|TRT|RRT|Responsabilidade Tecnica/i.test(t.descricao),
  );
}

describe('retificação — anotação técnica selecionável', () => {
  it('default usa ART CREA quando não informado', async () => {
    const r = await calcularRetificacao(BASE);
    const at = acharAnotacao(r)!;
    expect(at.valor).toBe(anotacaoTecnica('art_crea').valor); // 93,40
  });

  it('respeita TRT CFT quando escolhido (valor mais barato)', async () => {
    const r = await calcularRetificacao({ ...BASE, anotacao_tecnica: 'trt_cft' });
    const at = acharAnotacao(r)!;
    expect(at.valor).toBe(anotacaoTecnica('trt_cft').valor); // 68,17
    expect(at.descricao).toMatch(/TRT/);
  });

  it('respeita RRT CAU quando escolhido', async () => {
    const r = await calcularRetificacao({ ...BASE, anotacao_tecnica: 'rrt_cau' });
    expect(acharAnotacao(r)!.valor).toBe(anotacaoTecnica('rrt_cau').valor); // 95,45
  });
});

describe('retificação — área real a apurar após levantamento', () => {
  it('não exige área real quando marcado a apurar', async () => {
    const r = await calcularRetificacao({
      ...BASE,
      area_real_levantada: 0,
      area_real_a_apurar: true,
    });
    expect(r.custos.secao_5_total).toBeGreaterThan(0);
    const divergencia = r.custos.base_calculo?.find(b => /Divergencia/i.test(b.rotulo));
    expect(divergencia?.formula).toMatch(/apurar/i);
    expect(r.custos.avisos.some(a => /AREA REAL A APURAR/i.test(a))).toBe(true);
  });

  it('sem o flag, área real 0 continua sendo erro', async () => {
    await expect(
      calcularRetificacao({ ...BASE, area_real_levantada: 0 }),
    ).rejects.toThrow(/area_real_levantada/);
  });
});

describe('retificação — diligências e tributos (estimativa)', () => {
  it('inclui despesas quando habilitada e NÃO soma ao total de honorários', async () => {
    const semDesp = await calcularRetificacao(BASE);
    const comDesp = await calcularRetificacao({
      ...BASE,
      despesas_administrativas: {
        habilitada: true,
        valor: 500,
        descritivo: 'Taxa de retificação, IPTU e CND',
      },
    });
    expect(comDesp.custos.despesas_administrativas).toEqual({
      valor: 500,
      descritivo: 'Taxa de retificação, IPTU e CND',
    });
    // Estimativa separada — não entra no secao_5_total.
    expect(comDesp.custos.secao_5_total).toBe(semDesp.custos.secao_5_total);
  });

  it('rejeita habilitada sem descritivo nem itens', async () => {
    await expect(
      calcularRetificacao({
        ...BASE,
        despesas_administrativas: { habilitada: true, valor: 100, descritivo: '' },
      }),
    ).rejects.toThrow(/descritivo/);
  });

  it('itemizado: total = soma dos itens marcados e preserva os itens', async () => {
    const r = await calcularRetificacao({
      ...BASE,
      despesas_administrativas: {
        habilitada: true,
        valor: 0, // ignorado quando há itens
        descritivo: 'Diligências da retificação',
        itens: [
          { rotulo: 'Diligência — Secretaria de Habitação e Reg. Fundiária', valor: 150 },
          { rotulo: 'Diligência — Cartório de Registro de Imóveis', valor: 150 },
          { rotulo: 'Diligência — Recolhimento de anuência dos confrontantes', valor: 300 },
        ],
      },
    });
    expect(r.custos.despesas_administrativas?.valor).toBe(600);
    expect(r.custos.despesas_administrativas?.itens).toHaveLength(3);
    // continua sendo estimativa separada (não soma aos honorários)
    const semDesp = await calcularRetificacao(BASE);
    expect(r.custos.secao_5_total).toBe(semDesp.custos.secao_5_total);
  });

  it('itemizado descarta itens inválidos (valor negativo / sem rótulo)', async () => {
    const r = await calcularRetificacao({
      ...BASE,
      despesas_administrativas: {
        habilitada: true,
        valor: 0,
        descritivo: '',
        itens: [
          { rotulo: 'Cartório', valor: 150 },
          { rotulo: '', valor: 999 },
          { rotulo: 'Negativo', valor: -5 },
        ],
      },
    });
    expect(r.custos.despesas_administrativas?.valor).toBe(150);
    expect(r.custos.despesas_administrativas?.itens).toHaveLength(1);
  });
});
