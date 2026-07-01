// src/services/vtoChecklistCalc.ts
// v3.78.0 — Cálculo de avanço físico do VTO Checklist.
//
// Pesos por status (mesma régua do protótipo aprovado):
//   nao_iniciado 0.00 · iniciado 0.15 · em_andamento 0.50 · concluido 1.00
// % por disciplina = média dos pesos das atividades da disciplina.
// % geral = média dos pesos de TODAS as atividades (ponderado por nº de atividades).

import type { VtoChecklistItem, VtoStatus, PercentualResultado } from '../types/vtoChecklist';

export const PESO_STATUS: Record<VtoStatus, number> = {
  nao_iniciado: 0,
  iniciado: 0.15,
  em_andamento: 0.5,
  concluido: 1,
};

/** Arredonda para 2 casas (percentual 0..100). */
function pct2(fracao: number): number {
  return Math.round(fracao * 10000) / 100;
}

export function calcularPercentual(itens: VtoChecklistItem[]): PercentualResultado {
  const acc: Record<number, { soma: number; n: number }> = {};
  let somaGeral = 0;
  let totalGeral = 0;

  for (const it of itens) {
    const peso = PESO_STATUS[it.status] ?? 0;
    if (!acc[it.disciplina_ordem]) acc[it.disciplina_ordem] = { soma: 0, n: 0 };
    acc[it.disciplina_ordem].soma += peso;
    acc[it.disciplina_ordem].n += 1;
    somaGeral += peso;
    totalGeral += 1;
  }

  const porDisciplina: Record<number, number> = {};
  for (const [disc, v] of Object.entries(acc)) {
    porDisciplina[Number(disc)] = v.n ? pct2(v.soma / v.n) : 0;
  }

  const geral = totalGeral ? pct2(somaGeral / totalGeral) : 0;
  return { geral, porDisciplina };
}
