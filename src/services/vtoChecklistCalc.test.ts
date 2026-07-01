// v3.78.0 — Testes do cálculo de avanço físico do VTO Checklist.
import { describe, it, expect } from 'vitest';
import { calcularPercentual, PESO_STATUS } from './vtoChecklistCalc';
import type { VtoChecklistItem, VtoStatus } from '../types/vtoChecklist';

const item = (d: number, status: VtoStatus): VtoChecklistItem => ({
  disciplina_ordem: d,
  disciplina_nome: `D${d}`,
  atividade: 'x',
  atividade_ordem: 1,
  status,
});

describe('calcularPercentual', () => {
  it('retorna 0 para lista vazia', () => {
    expect(calcularPercentual([]).geral).toBe(0);
  });

  it('concluido em tudo => 100%', () => {
    const r = calcularPercentual([item(1, 'concluido'), item(1, 'concluido')]);
    expect(r.geral).toBe(100);
    expect(r.porDisciplina[1]).toBe(100);
  });

  it('mistura de status respeita pesos', () => {
    const r = calcularPercentual([item(1, 'concluido'), item(1, 'iniciado')]); // (1+0.15)/2 = 0.575
    expect(r.porDisciplina[1]).toBe(57.5);
  });

  it('% geral pondera por nº de atividades entre disciplinas', () => {
    const r = calcularPercentual([
      item(1, 'concluido'),
      item(2, 'nao_iniciado'), item(2, 'nao_iniciado'),
    ]); // (1+0+0)/3 = 33.33
    expect(r.geral).toBe(33.33);
    expect(r.porDisciplina[1]).toBe(100);
    expect(r.porDisciplina[2]).toBe(0);
  });

  it('em_andamento pondera 0.5', () => {
    const r = calcularPercentual([item(1, 'em_andamento'), item(1, 'nao_iniciado')]); // 0.5/2
    expect(r.porDisciplina[1]).toBe(25);
  });

  it('pesos oficiais', () => {
    expect(PESO_STATUS.nao_iniciado).toBe(0);
    expect(PESO_STATUS.iniciado).toBe(0.15);
    expect(PESO_STATUS.em_andamento).toBe(0.5);
    expect(PESO_STATUS.concluido).toBe(1);
  });
});
