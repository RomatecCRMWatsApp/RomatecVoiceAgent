import { describe, it, expect } from 'vitest';
import { statusAposEstorno, statusSemRecebimento } from './paFinanceiro';

describe('compensação — status da parcela que perde o recebimento', () => {
  it('boleto volta para A_VENCER; sinal/à vista para A_PAGAR', () => {
    expect(statusSemRecebimento('BOLETO')).toBe('A_VENCER');
    expect(statusSemRecebimento('SINAL')).toBe('A_PAGAR');
    expect(statusAposEstorno(350, 0, 'BOLETO', 'PAGO')).toBe('A_VENCER');
    expect(statusAposEstorno(300, 0, 'SINAL', 'PAGO')).toBe('A_PAGAR');
  });
  it('sobra parte do valor: PARCIAL; continua cheia: PAGO; cancelada não muda', () => {
    expect(statusAposEstorno(350, 100, 'BOLETO', 'PAGO')).toBe('PARCIAL');
    expect(statusAposEstorno(350, 350, 'BOLETO', 'PAGO')).toBe('PAGO');
    expect(statusAposEstorno(350, 0, 'BOLETO', 'CANCELADO')).toBe('CANCELADO');
  });
});
