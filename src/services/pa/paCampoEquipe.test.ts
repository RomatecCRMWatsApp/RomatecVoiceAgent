// v3.169.0 — regras do funcionário de campo, fechamento de lote, produção, dossiê e planilha de marcos.
import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), num: Number, isoDate: (v: unknown) => v, isoDateTime: (v: unknown) => v, registrarEvento: vi.fn() }));
vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
vi.mock('./paMapas', () => ({ buscarSubdivisao: vi.fn(), buscarPerimetro: vi.fn(), buscarVila: vi.fn(), vinculosParcelas: vi.fn(), dadosCabecalho: vi.fn(), pdfSubdivisao: vi.fn() }));
vi.mock('./mapasPdf', () => ({ cabecalho: vi.fn(), pdfDeHtml: vi.fn() }));
vi.mock('./paBoletoPdf', () => ({ baseUrlPublica: () => 'https://x' }));

import { apiPermitidaCampo, rotaPaPermitidaCampo, PERMISSOES_PADRAO, lerPermissoes } from './paEquipe';
import { lotesCompletos, exigidos, producaoPorDia } from './paCampo';
import { statusPeloSaldo } from './paDossie';
import { marcosDePlanilha } from './paColetora';

describe('funcionário de campo — o que ele acessa', () => {
  it('fora do PA só o login', () => {
    expect(apiPermitidaCampo('/pa/projetos/1/campo')).toBe(true);
    expect(apiPermitidaCampo('/auth/me')).toBe(true);
    expect(apiPermitidaCampo('/obras')).toBe(false);
    expect(apiPermitidaCampo('/admin/users-config')).toBe(false);
  });
  it('dentro do PA: campo, mapa (só ver) e coletora; nada de PDF, financeiro ou associados', () => {
    const ok = (m: string, c: string) => rotaPaPermitidaCampo(m, c, PERMISSOES_PADRAO);
    expect(ok('GET', '/projetos/1/campo')).toBe(true);
    expect(ok('POST', '/projetos/1/campo/pontos')).toBe(true);
    expect(ok('GET', '/projetos/1/subdivisao.geojson')).toBe(true);
    expect(ok('GET', '/projetos/1/caderneta-campo.pdf')).toBe(true);
    expect(ok('GET', '/projetos/1/subdivisao.pdf')).toBe(false);
    expect(ok('GET', '/projetos/1/mapa-geral.pdf')).toBe(false);
    expect(ok('GET', '/projetos/1/subdivisao.dxf')).toBe(false);
    expect(ok('GET', '/projetos/1/pagamentos')).toBe(false);
    expect(ok('GET', '/projetos/1/associados')).toBe(false);
    expect(ok('POST', '/projetos/1/subdivisao/vinculo')).toBe(false);
    expect(ok('GET', '/projetos/1/dossies')).toBe(false);
  });
  it('permissões desligadas fecham as rotas', () => {
    const p = lerPermissoes({ ver_mapa: false, baixar_coletora: false, marcar_campo: false });
    expect(rotaPaPermitidaCampo('GET', '/projetos/1/subdivisao.geojson', p)).toBe(false);
    expect(rotaPaPermitidaCampo('GET', '/projetos/1/coletora.csv', p)).toBe(false);
    expect(rotaPaPermitidaCampo('POST', '/projetos/1/campo/pontos', p)).toBe(false);
    expect(rotaPaPermitidaCampo('GET', '/projetos/1/campo', p)).toBe(true);
  });
});

describe('fechamento do lote e produção', () => {
  it('lote fecha com todos os marcos a cravar; o perímetro existente não conta', () => {
    const ex = new Set(['M-001']);
    expect(exigidos(['M-001', 'M-002', 'M-003'], ex)).toEqual(['M-002', 'M-003']);
    expect(exigidos(['M-001'], ex)).toEqual(['M-001']); // lote só de perímetro: confirma o existente
    expect(lotesCompletos([{ lote: '01', vertices: ['M-002', 'M-003'] }], new Set(['M-002']))).toEqual([]);
    expect(lotesCompletos([{ lote: '01', vertices: ['M-002', 'M-003'] }], new Set(['M-002', 'M-003']))).toEqual(['01']);
  });
  it('produção por dia: marcos, lotes e horas do primeiro ao último ponto', () => {
    const p = producaoPorDia([
      { marcado_em: '2026-11-17T11:00:00Z', usuario_nome: 'JOÃO' },
      { marcado_em: '2026-11-17T14:30:00Z', usuario_nome: 'JOÃO' },
    ], [{ concluido_em: '2026-11-17T14:30:00Z', usuario_nome: 'JOÃO' }]);
    expect(p).toEqual([expect.objectContaining({ dia: '2026-11-17', usuario: 'JOÃO', pontos: 2, lotes: 1, horas: 3.5 })]);
  });
});

describe('dossiê', () => {
  it('status segue o financeiro até ser enviado', () => {
    expect(statusPeloSaldo('PRONTO', 27)).toBe('AGUARDANDO_PAGAMENTO');
    expect(statusPeloSaldo('AGUARDANDO_PAGAMENTO', 0)).toBe('PRONTO');
    expect(statusPeloSaldo('ENVIADO', 27)).toBe('ENVIADO');
    expect(statusPeloSaldo('ENTREGUE', 0)).toBe('ENTREGUE');
  });
});

describe('planilha oficial de marcos', () => {
  it('lê código, coordenadas, lotes e se compra', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['', '', '', 'COORDENADAS'],
      ['MARCO', 'E (m)', 'N (m)', 'LATITUDE', 'LONGITUDE', 'TIPO', 'IMPLANTAR COM', 'LOTES QUE USAM', 'COMPRAR?'],
      ['M-001', 249871.327, 9513202.704, '', '', 'Perímetro do PA', 'LT-01', 'LT-01, LT-02', 'NÃO'],
      ['M-002', 250044.32, 9512710.734, '', '', 'Canto de lote na via', 'LT-01', 'LT-01, LT-02', 'SIM'],
      ['TOTAL', 2],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Coordenadas dos Marcos');
    const m = marcosDePlanilha(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ codigo: 'M-001', E: 249871.327, N: 9513202.704, tipo: 'Perímetro do PA', implantar_com: '01', lotes: ['01', '02'], comprar: false });
    expect(m[1].comprar).toBe(true);
  });
});
