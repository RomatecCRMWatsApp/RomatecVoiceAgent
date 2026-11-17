import { describe, it, expect } from 'vitest';
import { faixaPagamento, ordemServico, type PagamentoLote } from './paCampo';

const pg = (pagas: number, parcelas: number, marcos = false): PagamentoLote => ({ parcelas, pagas, pct: parcelas ? Math.round((pagas / parcelas) * 1000) / 10 : 0, quitado: parcelas > 0 && pagas >= parcelas, marcos_lancados: true, marcos_pago: marcos });

describe('campo — ordem de serviço pelo pagamento (v3.171.0)', () => {
  it('cor pela proporção de parcelas pagas', () => {
    expect(faixaPagamento(pg(3, 3)).id).toBe('QUITADO');
    expect(faixaPagamento(pg(2, 3)).id).toBe('P50');   // 66,7%
    expect(faixaPagamento(pg(3, 4)).id).toBe('P75');   // 75%
    expect(faixaPagamento(pg(1, 3)).id).toBe('P25');   // 33,3%
    expect(faixaPagamento(pg(1, 5)).id).toBe('P1');    // 20%
    expect(faixaPagamento(pg(0, 3)).id).toBe('P0');
    expect(faixaPagamento(null).id).toBe('SEM');
  });
  it('quitados primeiro (com marcos pagos antes), depois maior % pago; medidos no fim; sem associado por último dos a medir', () => {
    const l = (lote: string, p: PagamentoLote | null, fechado = false) => ({ lote, pagamento: p, fechado: fechado ? {} : null });
    const ord = ordemServico([
      l('01', pg(1, 3)), l('02', pg(3, 3)), l('03', null), l('04', pg(3, 3, true)), l('05', pg(2, 3)), l('06', pg(3, 3, true), true), l('07', pg(0, 3)),
    ]).map((x) => x.lote);
    expect(ord).toEqual(['04', '02', '05', '01', '07', '03', '06']);
  });
});
