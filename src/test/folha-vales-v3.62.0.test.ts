// v3.62.3: vales no fechamento.
//
// Regra final:
//  - Matching por `periodo` ('YYYY-MM-Q'): o CEO escolhe o periodo ao passar o
//    vale; é o vínculo autoritativo. quinzenaCodesDoRange deriva os códigos que
//    o range [dataInicio, dataFim] toca.
//  - Gate `fechamento_id IS NULL`: só conta vale ainda aberto. Ao fechar, os
//    vales descontados recebem o fechamento_id (não deduz 2x).
//  - Backfill conciliarValesLegado(): marca como quitados (fechamento_id=0) os
//    vales antigos (criado_em <= último fechamento da obra), pré-feature, que
//    nunca foram amarrados — assim quinzenas passadas param de vazar.

import { describe, it, expect } from 'vitest';
import { quinzenaCodesDoRange } from '../services/folhaFechamento';

describe('quinzenaCodesDoRange (v3.62.3)', () => {
  it('range dentro da 1a quinzena -> só -1', () => {
    expect(quinzenaCodesDoRange('2026-06-01', '2026-06-10')).toEqual(['2026-06-1']);
  });

  it('range dentro da 2a quinzena -> só -2', () => {
    expect(quinzenaCodesDoRange('2026-06-16', '2026-06-30')).toEqual(['2026-06-2']);
  });

  it('cruza o dia 15 no mesmo mês -> -1 e -2', () => {
    expect(quinzenaCodesDoRange('2026-06-10', '2026-06-20')).toEqual(['2026-06-1', '2026-06-2']);
  });

  it('caso do print (25/05 a 06/06) -> 05-2 e 06-1', () => {
    expect(quinzenaCodesDoRange('2026-05-25', '2026-06-06')).toEqual(['2026-05-2', '2026-06-1']);
  });

  it('dia 15 = 1a quinzena; dia 16 = 2a', () => {
    expect(quinzenaCodesDoRange('2026-03-15', '2026-03-15')).toEqual(['2026-03-1']);
    expect(quinzenaCodesDoRange('2026-03-16', '2026-03-16')).toEqual(['2026-03-2']);
  });

  it('mês com zero-padding e range de 1 dia', () => {
    expect(quinzenaCodesDoRange('2026-01-05', '2026-01-05')).toEqual(['2026-01-1']);
    expect(quinzenaCodesDoRange('2026-12-31', '2026-12-31')).toEqual(['2026-12-2']);
  });
});
