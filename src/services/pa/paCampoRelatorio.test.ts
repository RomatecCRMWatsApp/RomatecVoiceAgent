// v3.191.0 — relatório do dia de campo (fim do dia, para o grupo).
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), transacao: vi.fn(), num: Number, isoDate: (v: unknown) => String(v), isoDateTime: (v: unknown) => String(v), hojeBrasil: () => '2026-11-19', registrarEvento: vi.fn() }));
vi.mock('./paMapas', () => ({ geojsonSubdivisao: vi.fn(), dadosCabecalho: vi.fn(), buscarSubdivisao: vi.fn(), vinculosParcelas: vi.fn(), buscarPerimetro: vi.fn(), buscarVila: vi.fn() }));
vi.mock('./mapasPdf', () => ({ cabecalho: vi.fn(() => ''), pdfDeHtml: vi.fn() }));
vi.mock('./mapaTiles', () => ({ htmlMapaLotes: vi.fn() }));
vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
import { montarRelatorio, textoRelatorio, type SituacaoDossieRel } from './paCampoRelatorio';
import type { LoteBoletim } from './paCampoBoletim';

const L = (lote: string, o: Partial<LoteBoletim> & { quitado?: boolean } = {}): LoteBoletim => ({
  lote, area_ha: 30, marcados: 0, exigidos: ['a', 'b', 'c', 'd'], prioridade: null, faixa: 'P0', fechado: null,
  associado: { nome: `ASSOCIADO ${lote}`, lote_vila: lote, denominacao: `Chácara ${lote}` },
  pagamento: { parcelas: 3, pagas: o.quitado ? 3 : 1, pct: o.quitado ? 100 : 33.3, quitado: !!o.quitado, marcos_lancados: true, marcos_pago: true }, ...o,
});
const fech = (dataUtc: string) => ({ concluido_em: dataUtc, usuario_nome: 'Equipe' });
const lotes = [
  L('10', { quitado: true, fechado: fech('2026-11-18 18:28:00') }),             // ontem
  L('33', { quitado: true, fechado: fech('2026-11-19 14:00:00') }),             // hoje 11h
  L('43', { quitado: true, fechado: fech('2026-11-19 17:30:00') }),             // hoje 14h30
  L('47', { quitado: true, fechado: fech('2026-11-19 20:10:00') }),             // hoje 17h10
  L('09', { quitado: true, marcados: 2 }), L('50', { quitado: true }), L('51', { quitado: true }), L('40', { quitado: true }),
  L('20'), L('21'), L('60', { associado: null, pagamento: null }),
];
const dossies = new Map<string, { situacao: SituacaoDossieRel; em: string | null }>([['10', { situacao: 'REVISAO', em: '2026-11-18' }], ['33', { situacao: 'ENTREGUE', em: '2026-11-19' }]]);
const plano = { '2026-11-20': ['09', '50', '51'], '2026-11-23': ['40'] };

describe('relatório do dia de campo', () => {
  const r = montarRelatorio('2026-11-19', lotes, dossies, plano, false, [1, 2, 3, 4, 5]);
  it('concluídos X/total, com o dossiê entregue no topo', () => {
    expect(r.medidos_total).toBe(4); expect(r.total).toBe(11);
    expect(r.concluidos.map((x) => `${x.lote}:${x.dossie}`)).toEqual(['33:ENTREGUE', '10:REVISAO', '43:SEM_DOSSIE', '47:SEM_DOSSIE']);
  });
  it('medidos hoje pelo dia de Brasília, em medição, próximo dia e previsão', () => {
    expect(r.hoje.map((x) => x.lote)).toEqual(['33', '43', '47']);
    expect(r.em_medicao.map((x) => x.lote)).toEqual(['09']);
    expect(r.proximo).toEqual(expect.objectContaining({ dia: '2026-11-20' }));
    expect(r.proximo!.itens.map((x) => x.lote)).toEqual(['09', '50', '51']);
    expect(r.previsao.map((p) => p.dia)).toEqual(['2026-11-20', '2026-11-23']);
  });
  it('parcelas em aberto: só a contagem e o início previsto (depois dos quitados)', () => {
    expect(r.abertos).toEqual({ qtd: 2, inicio_previsto: '2026-11-24' });
    expect(r.sem_associado).toBe(1);
    const t = textoRelatorio(r, 'PA Teste');
    expect(t).toContain('LOTES CONCLUÍDOS: 4 de 11');
    expect(t).toContain('PARCIAL');
    expect(t).toContain('Programação de 20/11/2026');
    expect(t).toContain('2 lote(s) com parcelas em aberto');
    expect(t).not.toContain('ASSOCIADO 20'); // quem está com parcela aberta não é exposto no grupo
    expect(t).not.toMatch(/R\$/);
  });
});
