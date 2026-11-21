// v3.195.0 — prancha A1: quadro dos lotes (sem áreas) e montagem do HTML.
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn() }));
vi.mock('./paMapas', () => ({ buscarSubdivisao: vi.fn(), buscarPerimetro: vi.fn(), vinculosParcelas: vi.fn(), dadosCabecalho: vi.fn(), geojsonSubdivisao: vi.fn() }));
vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
import { quadroLotes, htmlPrancha } from './paPrancha';
import { permissaoDaRota } from './paEquipe';

describe('prancha A1', () => {
  const q = quadroLotes(['10', '02', '11', '09'], { '02': { nome: 'MARIA', lote_vila: '14' }, '10': { nome: 'TATIANE', lote_vila: '51' } });
  it('quadro ordenado pelo lote de produção, com associado e lote da vila (sem associado = —)', () => {
    expect(q.map((x) => x.lote)).toEqual(['02', '09', '10', '11']);
    expect(q[0]).toEqual({ lote: '02', associado: 'MARIA', lote_vila: '14', situacao: 'A_MEDIR' });
    expect(q[1].associado).toBeNull();
  });
  it('HTML A1 com quadro sem áreas e área total só na legenda', () => {
    const h = htmlPrancha({ projeto: 'PA Teste', municipio: 'Açailândia/MA', associacao: null, rt: { nome: 'RT', registro: 'CFT' }, data: '21/11/2026', geral: '<div></div>', vila: '', divisa: '', quadro: q, area_ha: 2000, perimetro_m: 18000, lotes: 4, fuso: 23, hem: 'S' });
    expect(h).toContain('size:841mm 594mm');
    expect(h).toContain('<th>Lote prod.</th><th>Associado(a)</th><th>Lote vila</th><th>Dossiê</th>');
    expect(h).toContain('Área total do PA');
    expect(h).toContain('LT-11');
    expect((h.match(/ ha/g) || []).length).toBe(1); // só na legenda
  });
  it('rota exige a permissão de baixar mapas', () => { expect(permissaoDaRota('GET', '/projetos/7/prancha-a1.pdf')).toBe('baixar_mapas'); });
});
