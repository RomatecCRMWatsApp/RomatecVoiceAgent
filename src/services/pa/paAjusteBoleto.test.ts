import { describe, it, expect } from 'vitest';
import { planejarAjuste, lerAjuste } from './paAjusteBoleto';

describe('v3.185.0 — ajustar boleto', () => {
  it('pagou R$ 20 de R$ 30 por fora → boleto novo de R$ 10', () => {
    expect(planejarAjuste({ valor: 30, recebido: 0 }, { modo: 'PAGO_POR_FORA', valor: 20 })).toEqual({ saldo_novo: 10, valor_parcela: 30 });
    expect(planejarAjuste({ valor: 30, recebido: 0 }, { modo: 'PAGO_POR_FORA', valor: 30 }).saldo_novo).toBe(0); // quitou: só cancela
    expect(() => planejarAjuste({ valor: 30, recebido: 0 }, { modo: 'PAGO_POR_FORA', valor: 31 })).toThrow(/maior que o saldo/);
  });
  it('novo valor da taxa', () => {
    expect(planejarAjuste({ valor: 30, recebido: 0 }, { modo: 'NOVO_VALOR', valor: 10 })).toEqual({ saldo_novo: 10, valor_parcela: 10 });
    expect(planejarAjuste({ valor: 30, recebido: 20 }, { modo: 'NOVO_VALOR', valor: 25 })).toEqual({ saldo_novo: 5, valor_parcela: 25 });
    expect(() => planejarAjuste({ valor: 30, recebido: 20 }, { modo: 'NOVO_VALOR', valor: 15 })).toThrow(/menor que o que já foi recebido/);
    expect(() => planejarAjuste({ valor: 30, recebido: 0 }, { modo: 'NOVO_VALOR', valor: 30 })).toThrow(/mesmo/);
  });
  it('lê valores em reais (vírgula, ponto de milhar, número)', () => {
    expect(lerAjuste({ valor: '20,00' }).valor).toBe(20);
    expect(lerAjuste({ valor: '1.234,50' }).valor).toBe(1234.5);
    expect(lerAjuste({ valor: 10.5 }).valor).toBe(10.5);
    expect(lerAjuste({ valor: '10.5' }).valor).toBe(10.5);
    expect(() => lerAjuste({ valor: '' })).toThrow();
    expect(lerAjuste({ valor: 10, modo: 'NOVO_VALOR', pago_em: '2026-11-18' })).toMatchObject({ modo: 'NOVO_VALOR', pago_em: '2026-11-18 12:00:00' });
  });
});
