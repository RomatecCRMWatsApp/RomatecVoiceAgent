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

// v3.190.0: agenda automática — só quitados, na ordem em que quitaram; 6 por dia útil
import { planejarAgenda, filaQuitados, proximoDiaUtil } from './paCampoProgramacao';
describe('agenda automática de campo', () => {
  const L = (lote: string, quitado_em: string | null, o: { fechado?: boolean; marcados?: number } = {}) => ({ lote, fechado: false, marcados: 0, quitado: quitado_em !== null, quitado_em, ...o });
  // quitados em datas diferentes (o nº do lote NÃO define a ordem)
  const lotes = [
    L('51', '2026-10-01 10:00:00'), L('09', '2026-10-20 09:00:00', { marcados: 2 }), L('40', '2026-10-05 08:00:00'), L('43', '2026-10-02 08:00:00'),
    L('47', '2026-10-03 08:00:00'), L('48', '2026-10-10 08:00:00'), L('49', '2026-10-11 08:00:00'), L('33', '2026-10-04 08:00:00'),
    L('50', '2026-10-06 08:00:00'), L('10', '2026-09-30 08:00:00', { fechado: true }), L('32', null), L('20', null),
  ];
  it('fila dos quitados pela data da quitação (medidos e não quitados fora)', () => {
    expect(filaQuitados(lotes)).toEqual(['51', '43', '47', '33', '40', '50', '48', '49', '09']);
  });
  it('fechamento das 21 h (qua 18/11): não medidos na frente, em medição primeiro, 6 por dia, não quitado sai', () => {
    const p = planejarAgenda('2026-11-18', lotes, ['10', '33', '43', '47', '50', '51', '32'], [], {}, 6, [1, 2, 3, 4, 5]);
    expect(p['2026-11-19']).toEqual(['09', '33', '43', '47', '50', '51']);
    expect(p['2026-11-20']).toEqual(['40', '48', '49']);
    expect(Object.values(p).flat()).not.toContain('32'); // não quitado programado à mão não é relocado
    expect(Object.values(p).flat()).not.toContain('10'); // medido
  });
  it('quem quitar durante o dia entra no FINAL; o dia de hoje não muda', () => {
    const novo = [...lotes, L('20', '2026-11-18 15:00:00')].filter((l, i, a) => a.findIndex((x) => x.lote === l.lote) === i || l.quitado);
    const hoje = ['09', '33', '43', '47', '50', '51'];
    const p = planejarAgenda('2026-11-19', novo.filter((l) => !(l.lote === '20' && !l.quitado)), [], hoje, {}, 6, [1, 2, 3, 4, 5]);
    expect(p).toEqual({ '2026-11-20': ['40', '48', '49', '20'] });
  });
  it('sexta → segunda; excedente cascateia', () => {
    expect(proximoDiaUtil('2026-11-20', [1, 2, 3, 4, 5])).toBe('2026-11-23');
    const p = planejarAgenda('2026-11-20', lotes, [], [], {}, 4, [1, 2, 3, 4, 5]);
    expect(Object.keys(p)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
    expect(p['2026-11-23']).toEqual(['09', '51', '43', '47']);
  });
  it('sábado programado à mão é mantido', () => {
    const p = planejarAgenda('2026-11-20', lotes, [], [], { '2026-11-21': ['48', '32'] }, 6, [1, 2, 3, 4, 5]);
    expect(p['2026-11-21']).toEqual(['48']);
    expect(p['2026-11-23']).not.toContain('48');
  });
});
