// v3.62.2: regra de quais vales (adiantamentos) entram num fechamento.
// O fechamento desconta os vales ABERTOS passados DENTRO do range [dataInicio,
// dataFim], pela DATA REAL do vale (recibos_ajustes.criado_em) — NÃO pelo rótulo
// de quinzena de calendário. Isso evita o bug do print: um vale da quinzena
// anterior (passado ~23/05) vazava pro fechamento de 25/05→06/06 porque ambos
// caíam no código 'YYYY-05-2'. Este teste trava a regra com um espelho puro do
// predicado SQL (membro + tipo='adiantamento' + fechamento_id IS NULL +
// DATE(criado_em) BETWEEN dataInicio AND dataFim).

import { describe, it, expect } from 'vitest';

type Ajuste = { tipo: string; valor: number; fechamento_id: number | null; criado_em: string };

// Espelha o WHERE da subquery de soma_vales / do UPDATE de quitação.
function valeEntraNoFechamento(a: Ajuste, dataInicio: string, dataFim: string): boolean {
  if (a.tipo !== 'adiantamento') return false;
  if (a.fechamento_id != null) return false;
  const dia = a.criado_em.slice(0, 10); // DATE(criado_em) -> 'YYYY-MM-DD'
  return dia >= dataInicio && dia <= dataFim;
}

function somaVales(ajustes: Ajuste[], dataInicio: string, dataFim: string): number {
  return +ajustes
    .filter(a => valeEntraNoFechamento(a, dataInicio, dataFim))
    .reduce((s, a) => s + a.valor, 0)
    .toFixed(2);
}

describe('vales no fechamento por criado_em (v3.62.2)', () => {
  const DI = '2026-05-25';
  const DF = '2026-06-06';

  it('caso do print: 700 desta quinzena entram, 500 da anterior NÃO', () => {
    const ajustes: Ajuste[] = [
      { tipo: 'adiantamento', valor: 500, fechamento_id: null, criado_em: '2026-05-23 10:00:00' }, // quinzena passada
      { tipo: 'adiantamento', valor: 700, fechamento_id: null, criado_em: '2026-05-28 14:30:00' }, // esta quinzena
    ];
    expect(somaVales(ajustes, DI, DF)).toBe(700);
  });

  it('vale já quitado (fechamento_id setado) não é deduzido de novo', () => {
    const ajustes: Ajuste[] = [
      { tipo: 'adiantamento', valor: 300, fechamento_id: 12, criado_em: '2026-05-28 09:00:00' },
    ];
    expect(somaVales(ajustes, DI, DF)).toBe(0);
  });

  it('só conta tipo adiantamento (desconto/bonus ficam de fora)', () => {
    const ajustes: Ajuste[] = [
      { tipo: 'adiantamento', valor: 200, fechamento_id: null, criado_em: '2026-06-01 08:00:00' },
      { tipo: 'desconto',     valor: 999, fechamento_id: null, criado_em: '2026-06-01 08:00:00' },
      { tipo: 'bonus',        valor: 999, fechamento_id: null, criado_em: '2026-06-01 08:00:00' },
    ];
    expect(somaVales(ajustes, DI, DF)).toBe(200);
  });

  it('inclui os extremos do range (dataInicio e dataFim)', () => {
    const ajustes: Ajuste[] = [
      { tipo: 'adiantamento', valor: 100, fechamento_id: null, criado_em: '2026-05-25 23:59:00' },
      { tipo: 'adiantamento', valor: 150, fechamento_id: null, criado_em: '2026-06-06 00:01:00' },
    ];
    expect(somaVales(ajustes, DI, DF)).toBe(250);
  });
});
