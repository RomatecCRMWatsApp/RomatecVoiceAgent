// v3.147.0 — Extrato por associado e fluxo de caixa: regras puras.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), num: Number, isoDate: (v: unknown) => v, hojeBrasil: () => '2026-10-14', registrarEvento: vi.fn() }));

import { situacaoAssociado, montarFluxo, lerMovimento } from './paCaixa';

describe('situação do associado', () => {
  it('classifica quitado, em atraso, em dia e sem plano', () => {
    expect(situacaoAssociado({ contratado: 1000, em_aberto: 0, vencido: 0 })).toBe('QUITADO');
    expect(situacaoAssociado({ contratado: 1000, em_aberto: 500, vencido: 200 })).toBe('EM_ATRASO');
    expect(situacaoAssociado({ contratado: 1000, em_aberto: 500, vencido: 0 })).toBe('EM_DIA');
    expect(situacaoAssociado({ contratado: 0, em_aberto: 0, vencido: 0 })).toBe('SEM_PLANO');
  });
});

describe('fluxo de caixa', () => {
  const movs = [
    { data: '2026-09-10', tipo: 'ENTRADA' as const, origem: 'ASSOCIADO' as const, valor: 500 },
    { data: '2026-09-20', tipo: 'SAIDA' as const, origem: 'MANUAL' as const, valor: 120.5 },
    { data: '2026-10-01', tipo: 'ENTRADA' as const, origem: 'ASSOCIADO' as const, valor: 300 },
    { data: '2026-10-02', tipo: 'ENTRADA' as const, origem: 'MANUAL' as const, valor: 50 },
    { data: '2026-10-02', tipo: 'SAIDA' as const, origem: 'MANUAL' as const, valor: 80 },
  ];
  it('agrupa por mês com saldo acumulado a partir do saldo inicial', () => {
    const f = montarFluxo(movs, 100, 'mes');
    expect(f).toEqual([
      { periodo: '2026-09', entradas_associados: 500, entradas_avulsas: 0, saidas: 120.5, saldo_periodo: 379.5, saldo_acumulado: 479.5 },
      { periodo: '2026-10', entradas_associados: 300, entradas_avulsas: 50, saidas: 80, saldo_periodo: 270, saldo_acumulado: 749.5 },
    ]);
  });
  it('agrupa por dia em ordem cronológica', () => {
    const f = montarFluxo([...movs].reverse(), 0, 'dia');
    expect(f.map((p) => p.periodo)).toEqual(['2026-09-10', '2026-09-20', '2026-10-01', '2026-10-02']);
    expect(f[3].saldo_periodo).toBe(-30);
    expect(f[3].saldo_acumulado).toBe(649.5);
  });
});

describe('lançamento manual', () => {
  it('lê valor em formato brasileiro, número ou ponto decimal', () => {
    expect(lerMovimento({ tipo: 'SAIDA', data: '2026-10-14', descricao: 'Cartório', valor: '1.234,56' }).valor).toBe(1234.56);
    expect(lerMovimento({ tipo: 'SAIDA', data: '2026-10-14', descricao: 'Cartório', valor: 99.9 }).valor).toBe(99.9);
    expect(lerMovimento({ tipo: 'ENTRADA', data: '2026-10-14', descricao: 'Doação', valor: '45.50' }).valor).toBe(45.5);
  });
  it('recusa valor zero, data inválida, tipo errado e descrição vazia', () => {
    expect(() => lerMovimento({ tipo: 'SAIDA', data: '2026-10-14', descricao: 'x', valor: '0' })).toThrow(/maior que zero/);
    expect(() => lerMovimento({ tipo: 'SAIDA', data: '14/10/2026', descricao: 'x', valor: '10' })).toThrow(/data/);
    expect(() => lerMovimento({ tipo: 'OUTRO', data: '2026-10-14', descricao: 'x', valor: '10' })).toThrow(/tipo/);
    expect(() => lerMovimento({ tipo: 'SAIDA', data: '2026-10-14', descricao: ' ', valor: '10' })).toThrow(/descrição/);
  });
  it('categoria padrão conforme o tipo', () => {
    expect(lerMovimento({ tipo: 'SAIDA', data: '2026-10-14', descricao: 'x', valor: '10' }).categoria).toBe('Outras despesas');
    expect(lerMovimento({ tipo: 'ENTRADA', data: '2026-10-14', descricao: 'x', valor: '10' }).categoria).toBe('Outras entradas');
  });
});

import { resumoParcelas } from './paCaixa';
describe('resumo das parcelas (v3.147.1)', () => {
  const p = (tipo: string, parcela: number, valor: number, recebido: number, venc: string | null, status = 'A_VENCER') =>
    ({ lancamento_id: parcela + 1, tipo, parcela, rotulo: tipo, valor, recebido, saldo: Math.round((valor - recebido) * 100) / 100, vencimento: venc, status });
  it('sinal pago + 2 boletos iguais, um pago parcial faltando 50', () => {
    const r = resumoParcelas([p('SINAL', 0, 300, 300, null, 'PAGO'), p('BOLETO', 2, 350, 0, '2026-12-15'), p('BOLETO', 1, 350, 300, '2026-11-15', 'PARCIAL')]);
    expect(r.sinal).toMatchObject({ estado: 'PAGO', falta: 0 });
    expect(r.divisao).toBe('2× R$\u00a0350,00');
    expect(r.qtd_boletos).toBe(2);
    expect(r.parciais).toBe(1);
    expect(r.boletos.map((b) => [b.parcela, b.vencimento, b.falta])).toEqual([[1, '2026-11-15', 50], [2, '2026-12-15', 350]]);
  });
  it('sinal parcial, valores diferentes e à vista', () => {
    const r = resumoParcelas([p('SINAL', 0, 500, 200, null, 'PARCIAL'), p('BOLETO', 1, 400, 0, '2026-11-10'), p('BOLETO', 2, 300, 0, '2026-12-10')]);
    expect(r.sinal).toMatchObject({ estado: 'PARCIAL', falta: 300 });
    expect(r.divisao).toBe('R$\u00a0400,00 + R$\u00a0300,00');
    expect(resumoParcelas([p('AVISTA', 0, 1000, 1000, null, 'PAGO')]).divisao).toBe('À vista');
  });
});
