// v3.62.0: protege a regra de quinzena usada pra computar vales no fechamento.
// quinzenaCodesDoRange deve cobrir TODOS os códigos 'YYYY-MM-Q' (Q=1 se dia<=15,
// senão 2) que o range [dataInicio, dataFim] toca — mesma regra de
// calcularPeriodoAtual/periodo_corrente. É a chave que casa com recibos_ajustes.periodo.

import { describe, it, expect } from 'vitest';
import { quinzenaCodesDoRange } from '../services/folhaFechamento';

describe('quinzenaCodesDoRange (v3.62.0)', () => {
  it('range dentro da 1a quinzena -> só -1', () => {
    expect(quinzenaCodesDoRange('2026-06-01', '2026-06-10')).toEqual(['2026-06-1']);
  });

  it('range dentro da 2a quinzena -> só -2', () => {
    expect(quinzenaCodesDoRange('2026-06-16', '2026-06-30')).toEqual(['2026-06-2']);
  });

  it('cruza o dia 15 no mesmo mês -> -1 e -2', () => {
    expect(quinzenaCodesDoRange('2026-06-10', '2026-06-20')).toEqual(['2026-06-1', '2026-06-2']);
  });

  it('cruza virada de mês (caso do print 25/05 a 06/06) -> 05-2 e 06-1', () => {
    expect(quinzenaCodesDoRange('2026-05-25', '2026-06-06')).toEqual(['2026-05-2', '2026-06-1']);
  });

  it('mês com zero-padding correto', () => {
    expect(quinzenaCodesDoRange('2026-01-05', '2026-01-05')).toEqual(['2026-01-1']);
  });

  it('dia 15 conta como 1a quinzena; dia 16 como 2a', () => {
    expect(quinzenaCodesDoRange('2026-03-15', '2026-03-15')).toEqual(['2026-03-1']);
    expect(quinzenaCodesDoRange('2026-03-16', '2026-03-16')).toEqual(['2026-03-2']);
  });

  it('sempre retorna pelo menos 1 código (range de 1 dia)', () => {
    expect(quinzenaCodesDoRange('2026-12-31', '2026-12-31')).toEqual(['2026-12-2']);
  });
});
