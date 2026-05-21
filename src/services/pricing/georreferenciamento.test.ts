// v3.23.5: testes do engine de Georreferenciamento Rural alinhado ao modelo
// aprovado PROP-2026-0011-R1. Cobre:
//   - reproducao EXATA dos numeros do modelo aprovado
//   - guard de fechamento p1+p2+p3 === total_romatec
//   - validacoes de input (complexidade, area, vertices)
//   - finalidade DESMEMBRAMENTO adiciona linha de emolumentos extras em secao_2_taxas
//   - opcionais com quantidade nao somam ao total Romatec mas vao em secao propria
//   - defaults quando campos opcionais omitidos

import { describe, it, expect } from 'vitest';
import { calcularGeorreferenciamento, round2 } from './georreferenciamento';
import type { InputGeorreferenciamento } from './types';

// Input base do modelo aprovado PROP-2026-0011-R1
const inputBase: InputGeorreferenciamento = {
  area_hectares: 54.45,
  numero_vertices: 10,
  distancia_km: 60,
  valor_por_hectare: 0,            // 0 = usa default 80.00
  valor_por_vertice: 0,            // 0 = usa default 200.00
  valor_diaria_campo: 0,           // 0 = usa default 600.00
  numero_diarias: 1,
  valor_km_deslocamento: 0,        // 0 = usa default 3.50
  valor_outros_servicos: 0,
  municipio: 'Acailandia',
  estado: 'MA',
  tem_matricula: true,
  complexidade: 'media',           // 1.30x
};

describe('round2 — arredondamento HALF_UP 2 casas', () => {
  it('arredonda 2.345 -> 2.35 (regra HALF_UP)', () => {
    expect(round2(2.345)).toBe(2.35);
  });
  it('preserva 4356.00', () => {
    expect(round2(4356)).toBe(4356.0);
  });
  it('arredonda 9315.799999... -> 9315.80', () => {
    expect(round2(54.45 * 80 + 10 * 200 + 1 * 600 + 60 * 3.5) * 1.3).toBeCloseTo(9315.8);
  });
});

describe('calcularGeorreferenciamento — PROP-2026-0011-R1', () => {
  it('reproduz exatamente os valores do modelo aprovado', async () => {
    const r = await calcularGeorreferenciamento(inputBase);
    const c = r.custos;
    const hr = c.honorarios_romatec!;

    // Honorarios Romatec
    expect(hr.trt).toBe(93.4);
    expect(hr.tecnicos).toBe(9315.8);
    expect(hr.assessoria).toBe(1621.0);
    expect(hr.total).toBe(11030.2);

    // Total na proposta (secao_5_total) = total Romatec
    expect(c.secao_5_total).toBe(11030.2);

    // Condicoes de pagamento
    const [p1, p2, p3] = (c.condicoes_pagamento || []).map((p) => p.valor);
    expect(p1).toBe(5561.8);
    expect(p2).toBe(4657.9);
    expect(p3).toBe(810.5);

    // Fechamento — guard ja validou no calc, aqui confirmamos
    expect(round2(p1 + p2 + p3)).toBe(11030.2);
  });

  it('secao_3_honorarios tem 3 linhas (TRT + Tecnicos + Assessoria) na ordem certa', async () => {
    const r = await calcularGeorreferenciamento(inputBase);
    const h = r.custos.secao_3_honorarios;
    expect(h.length).toBe(3);
    expect(h[0].descricao).toContain('TRT');
    expect(h[0].valor).toBe(93.4);
    expect(h[1].descricao).toContain('Honorarios Tecnicos');
    expect(h[1].valor).toBe(9315.8);
    expect(h[2].descricao).toContain('Assessoria');
    expect(h[2].valor).toBe(1621.0);
  });

  it('memoria de calculo em observacao da linha Tecnicos tem os 4 subtotais', async () => {
    const r = await calcularGeorreferenciamento(inputBase);
    const mem = r.custos.secao_3_honorarios[1].observacao || '';
    expect(mem).toContain('4356.00');   // area
    expect(mem).toContain('2000.00');   // vertices
    expect(mem).toContain('600.00');    // diarias
    expect(mem).toContain('210.00');    // km
    expect(mem).toContain('7166.00');   // subtotal_campo
    expect(mem).toContain('1.3');       // multiplicador (rendered as "1.3x" without trailing zero)
  });

  it('secao_5_total NAO inclui emolumentos cartorio (so Romatec)', async () => {
    const r = await calcularGeorreferenciamento(inputBase);
    // Emolumentos cartorio aparecem em secao_2_taxas mas nao somam ao total
    const totalSecao2 = r.custos.secao_2_taxas.reduce((s, i) => s + (i.valor || 0), 0);
    expect(r.custos.secao_5_total).toBe(11030.2);
    // Mesmo que emolumentos sejam > 0, o total Romatec se mantem
    if (totalSecao2 > 0) {
      expect(r.custos.secao_5_total).not.toBe(11030.2 + totalSecao2);
    }
  });
});

describe('Guard de fechamento', () => {
  it('p1 + p2 + p3 === total_romatec (dentro de 1 centavo)', async () => {
    const r = await calcularGeorreferenciamento(inputBase);
    const c = r.custos;
    const soma = round2((c.condicoes_pagamento || []).reduce((s, p) => s + p.valor, 0));
    expect(soma).toBe(c.honorarios_romatec!.total);
  });

  it('fechamento OK em complexidade simples (1.0x)', async () => {
    const r = await calcularGeorreferenciamento({ ...inputBase, complexidade: 'simples' });
    const c = r.custos;
    const soma = round2((c.condicoes_pagamento || []).reduce((s, p) => s + p.valor, 0));
    expect(soma).toBe(c.honorarios_romatec!.total);
  });

  it('fechamento OK em complexidade alta (1.6x)', async () => {
    const r = await calcularGeorreferenciamento({ ...inputBase, complexidade: 'alta' });
    const c = r.custos;
    const soma = round2((c.condicoes_pagamento || []).reduce((s, p) => s + p.valor, 0));
    expect(soma).toBe(c.honorarios_romatec!.total);
  });
});

describe('Validacoes de input', () => {
  it('lanca erro em complexidade invalida', async () => {
    await expect(
      calcularGeorreferenciamento({ ...inputBase, complexidade: 'xpto' as 'simples' }),
    ).rejects.toThrow(/complexidade invalida/);
  });

  it('lanca erro em area zero', async () => {
    await expect(
      calcularGeorreferenciamento({ ...inputBase, area_hectares: 0 }),
    ).rejects.toThrow(/area_hectares/);
  });

  it('lanca erro em vertices < 3 (poligonal minima)', async () => {
    await expect(
      calcularGeorreferenciamento({ ...inputBase, numero_vertices: 2 }),
    ).rejects.toThrow(/poligonal minima/);
  });
});

describe('Finalidade — linha condicional em secao_2_taxas', () => {
  it('DESMEMBRAMENTO adiciona linha "encerramento + abertura de matricula"', async () => {
    const r = await calcularGeorreferenciamento({ ...inputBase, finalidade: 'DESMEMBRAMENTO' });
    const linha = r.custos.secao_2_taxas.find((i) =>
      i.descricao.includes('encerramento da matricula atual'),
    );
    expect(linha).toBeDefined();
    expect(linha?.pendente).toBe(true);
  });

  it('REMEMBRAMENTO adiciona linha "unificacao de matriculas"', async () => {
    const r = await calcularGeorreferenciamento({ ...inputBase, finalidade: 'REMEMBRAMENTO' });
    const linha = r.custos.secao_2_taxas.find((i) =>
      i.descricao.includes('unificacao'),
    );
    expect(linha).toBeDefined();
  });

  it('CERTIFICACAO NAO adiciona linha extra (so emolumentos basicos)', async () => {
    const r = await calcularGeorreferenciamento({ ...inputBase, finalidade: 'CERTIFICACAO' });
    const linha = r.custos.secao_2_taxas.find((i) =>
      i.descricao.includes('encerramento') || i.descricao.includes('unificacao'),
    );
    expect(linha).toBeUndefined();
  });

  it('aviso da finalidade aparece em avisos[]', async () => {
    const r = await calcularGeorreferenciamento({ ...inputBase, finalidade: 'CERTIFICACAO' });
    expect(r.custos.avisos.some((a) => a.startsWith('FINALIDADE:'))).toBe(true);
  });
});

describe('Opcionais (secao_opcionais_georref)', () => {
  it('renderiza sempre as 5 linhas, mesmo sem nada contratado', async () => {
    const r = await calcularGeorreferenciamento(inputBase);
    const op = r.custos.secao_opcionais_georref!;
    expect(op.itens.length).toBe(5);
    expect(op.itens.map((i) => i.chave)).toEqual(['ccir', 'car', 'itr', 'anuencia', 'retificacao']);
    expect(op.subtotal).toBe(0);
    expect(op.itens.every((i) => i.contratado === false || i.contratado === undefined)).toBe(true);
  });

  it('calcula ITR com quantidade (2 exercicios x R$ 250 = R$ 500)', async () => {
    const r = await calcularGeorreferenciamento({
      ...inputBase,
      opcionais: {
        ccir: { contratado: false, valor_unitario: 350 },
        car:  { contratado: false, valor_unitario: 800 },
        itr:  { contratado: true,  quantidade: 2, valor_unitario: 250 },
        anuencia: { contratado: false, quantidade: 0, valor_unitario: 150 },
        retificacao: { contratado: false, valor: 'sob_orcamento' },
      },
    });
    const itr = r.custos.secao_opcionais_georref!.itens.find((i) => i.chave === 'itr')!;
    expect(itr.subtotal).toBe(500);
    expect(r.custos.secao_opcionais_georref!.subtotal).toBe(500);
  });

  it('Anuencia 3x R$ 150 + CCIR R$ 350 = R$ 800 subtotal opcionais', async () => {
    const r = await calcularGeorreferenciamento({
      ...inputBase,
      opcionais: {
        ccir: { contratado: true,  valor_unitario: 350 },
        car:  { contratado: false, valor_unitario: 800 },
        itr:  { contratado: false, quantidade: 0, valor_unitario: 250 },
        anuencia: { contratado: true, quantidade: 3, valor_unitario: 150 },
        retificacao: { contratado: false, valor: 'sob_orcamento' },
      },
    });
    expect(r.custos.secao_opcionais_georref!.subtotal).toBe(800);
  });

  it('Opcionais NAO somam ao total Romatec (secao_5_total inalterado)', async () => {
    const r = await calcularGeorreferenciamento({
      ...inputBase,
      opcionais: {
        ccir: { contratado: true,  valor_unitario: 350 },
        car:  { contratado: true,  valor_unitario: 800 },
        itr:  { contratado: true,  quantidade: 5, valor_unitario: 250 },
        anuencia: { contratado: true, quantidade: 10, valor_unitario: 150 },
        retificacao: { contratado: true, valor: 'sob_orcamento' },
      },
    });
    // Total Romatec continua em 11030.20 mesmo com R$ 4400 em opcionais contratados
    expect(r.custos.secao_5_total).toBe(11030.2);
    expect(r.custos.honorarios_romatec!.total).toBe(11030.2);
  });

  it('Retificacao sempre fica como "sob_orcamento" mesmo contratada', async () => {
    const r = await calcularGeorreferenciamento({
      ...inputBase,
      opcionais: {
        ccir: { contratado: false, valor_unitario: 350 },
        car:  { contratado: false, valor_unitario: 800 },
        itr:  { contratado: false, quantidade: 0, valor_unitario: 250 },
        anuencia: { contratado: false, quantidade: 0, valor_unitario: 150 },
        retificacao: { contratado: true, valor: 'sob_orcamento' },
      },
    });
    const retif = r.custos.secao_opcionais_georref!.itens.find((i) => i.chave === 'retificacao')!;
    expect(retif.contratado).toBe(true);
    expect(retif.subtotal).toBe('sob_orcamento');
  });
});

describe('Defaults quando opcionais omitidos', () => {
  it('roda sem finalidade nem opcionais (retrocompat com inputs antigos)', async () => {
    const r = await calcularGeorreferenciamento(inputBase);
    expect(r.custos.secao_5_total).toBe(11030.2);
    // sem finalidade -> sem aviso de finalidade
    expect(r.custos.avisos.some((a) => a.startsWith('FINALIDADE:'))).toBe(false);
    // opcionais sempre populados (5 linhas, todos nao contratados)
    expect(r.custos.secao_opcionais_georref!.itens.length).toBe(5);
  });
});

describe('Minimo garantido (2 SM)', () => {
  it('aplica minimo quando calculo de campo fica abaixo de 2 SM', async () => {
    // Inputs minusculos: 1 ha, 3 vertices, 0 diarias, 0 km, simples (1.0x)
    // -> 1*80 + 3*200 + 0 + 0 = 680 * 1.0 = 680 < 2*1621 = 3242
    const r = await calcularGeorreferenciamento({
      ...inputBase,
      area_hectares: 1,
      numero_vertices: 3,
      numero_diarias: 0,
      distancia_km: 0,
      complexidade: 'simples',
    });
    expect(r.custos.honorarios_romatec!.tecnicos).toBe(3242);
    // Fechamento continua valido
    const soma = round2((r.custos.condicoes_pagamento || []).reduce((s, p) => s + p.valor, 0));
    expect(soma).toBe(r.custos.honorarios_romatec!.total);
  });
});
