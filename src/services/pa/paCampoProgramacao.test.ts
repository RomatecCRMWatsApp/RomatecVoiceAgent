import { describe, it, expect } from 'vitest';
import { montarProgramacao, textoProgramacao, temaProgramacao, COR_PROG } from './paCampoProgramacao';
import type { LoteBoletim } from './paCampoBoletim';

const lote = (l: string, o: Partial<LoteBoletim> = {}): LoteBoletim => ({
  lote: l, area_ha: 30, marcados: 0, exigidos: ['a', 'b', 'c', 'd'], prioridade: null, faixa: 'P0', fechado: null,
  associado: { nome: `ASSOCIADO ${l}`, lote_vila: l, denominacao: `Chácara ${l}` }, pagamento: null, ...o,
});
const lotes = [
  lote('26', { fechado: { concluido_em: '2026-11-18 20:00:00', usuario_nome: 'Equipe' }, marcados: 4 }), // 17h em Brasília
  lote('43', { marcados: 2 }),
  lote('48'),
  lote('05', { fechado: { concluido_em: '2026-11-10 15:00:00', usuario_nome: 'Equipe' }, marcados: 4 }),
];

describe('v3.177.0 — programação diária de campo', () => {
  const itens = montarProgramacao(lotes, ['43', '26', '48']);
  it('situação de cada programado, na ordem escolhida', () => {
    expect(itens.map((x) => [x.ordem, x.lote, x.situacao])).toEqual([[1, '43', 'EM_MEDICAO'], [2, '26', 'MEDIDO'], [3, '48', 'PENDENTE']]);
    expect(itens[1]).toMatchObject({ associado: 'ASSOCIADO 26', chacara: 'Chácara 26', medido_em: '2026-11-18' });
  });

  it('texto da manhã: lotes do dia com associado e chácara', () => {
    const t = textoProgramacao('programacao', '2026-11-18', itens, 'PA Salete Moreno', { medidos: 2, lotes: 4 });
    expect(t).toContain('*PROGRAMAÇÃO DE CAMPO — PA SALETE MORENO*');
    expect(t).toContain('18/11/2026 (quarta-feira)');
    expect(t).toContain('🚜 *Lotes que a equipe vai medir hoje (3):*');
    expect(t).toContain('1. LT-43 — ASSOCIADO 43 (Chácara 43)');
    expect(t).not.toMatch(/R\$|quitad/i);
  });

  it('texto do fim do dia: medidos OK, em medição e pendentes para o próximo dia', () => {
    const t = textoProgramacao('confirmacao', '2026-11-18', itens, 'PA Salete Moreno', { medidos: 2, lotes: 4 });
    expect(t).toContain('📋 Programados: 3 · ✅ Medidos: 1 · 🚧 Em medição: 1 · ⏳ Pendentes: 1');
    expect(t).toContain('• LT-26 — ASSOCIADO 26 (Chácara 26) ✅');
    expect(t).toContain('• LT-43 — ASSOCIADO 43 (Chácara 43) — 2/4 marcos');
    expect(t).toContain('⏳ *Pendentes (ficam para o próximo dia):*');
    expect(t).toContain('Total do PA: 2 de 4 lotes medidos (50%)');
  });

  it('mapa: manhã em azul com a ordem; fim do dia verde/azul/laranja; outros medidos em verde-claro', () => {
    const m = temaProgramacao('programacao', itens, lotes);
    expect(m['43']).toMatchObject({ cor: COR_PROG.programado, rotulo: '1. LT-43' });
    expect(m['05']).toMatchObject({ cor: COR_PROG.ja_medido });
    const c = temaProgramacao('confirmacao', itens, lotes);
    expect(c['26']).toMatchObject({ cor: COR_PROG.medido, rotulo: 'LT-26 ✓', sub: 'ASSOCIADO 26 — OK' });
    expect(c['43']).toMatchObject({ cor: COR_PROG.em_medicao, sub: 'em medição 2/4' });
    expect(c['48']).toMatchObject({ cor: COR_PROG.pendente, sub: 'pendente' });
  });
});
