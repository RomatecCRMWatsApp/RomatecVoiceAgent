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
    // v3.176.0: boletim do grupo fica fora do perfil de campo (inclusive com ?base=)
    expect(ok('GET', '/projetos/1/campo/boletim.pdf')).toBe(false);
    expect(ok('GET', '/projetos/1/campo/boletim.pdf?base=satelite')).toBe(false);
    expect(ok('GET', '/projetos/1/campo/boletim')).toBe(false);
    expect(ok('GET', '/projetos/1/coletora.dxf')).toBe(true);
    // v3.177.0: o operador vê a programação do dia, mas não gera PDF/texto do grupo nem altera
    expect(ok('GET', '/projetos/1/campo/programacao')).toBe(true);
    expect(ok('GET', '/projetos/1/campo/programacao.pdf')).toBe(false);
    expect(ok('GET', '/projetos/1/campo/programacao/texto')).toBe(false);
  });
  it('permissões desligadas fecham as rotas', () => {
    const p = lerPermissoes({ ver_mapa: false, baixar_coletora: false, marcar_campo: false });
    expect(rotaPaPermitidaCampo('GET', '/projetos/1/subdivisao.geojson', p)).toBe(false);
    expect(rotaPaPermitidaCampo('GET', '/projetos/1/coletora.csv', p)).toBe(false);
    expect(rotaPaPermitidaCampo('GET', '/projetos/1/coletora.kml', PERMISSOES_PADRAO)).toBe(true);
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

describe('envio para outro número (v3.175.4)', () => {
  it('aceita DDD + número e põe o 55; recusa número curto', async () => {
    const { numeroDestino } = await import('./paWhatsapp');
    expect(numeroDestino('(99) 9 9181-1246')).toBe('5599991811246');
    expect(numeroDestino('5599991811246')).toBe('5599991811246');
    expect(numeroDestino('9918112')).toBeNull();
  });
});

// v3.176.2: horário gravado em UTC (NOW()) → dia de Brasília
import { diaBrasilia } from './paCampo';
describe('dia em Brasília', () => {
  it('converte UTC para o dia local (UTC-3)', () => {
    expect(diaBrasilia('2026-11-18 12:29:00')).toBe('2026-11-18');
    expect(diaBrasilia('2026-11-18 01:30:00')).toBe('2026-11-17'); // 22h30 do dia 17 em Brasília
    expect(diaBrasilia('2026-11-18T02:59:59Z')).toBe('2026-11-17');
  });
});

// v3.180.0: permissões por função para todos os perfis
import { permissaoDaRota, rotaPaPermitida, PADRAO_POR_PERFIL, dispositivo, CATALOGO_PERMISSOES } from './paEquipe';
describe('permissões por função', () => {
  it('cada rota exige a permissão certa', () => {
    const casos: Array<[string, string, string | null]> = [
      ['GET', '/projetos/1/painel', 'ver_painel'], ['GET', '/projetos/1/subdivisao.geojson', 'ver_mapa'], ['GET', '/projetos/1/mapa-geral.pdf', 'baixar_mapas'],
      ['POST', '/projetos/1/subdivisao/vinculo', 'editar_mapas'], ['GET', '/projetos/1/associados/7', 'ver_associados'], ['PATCH', '/projetos/1/associados/7', 'editar_associados'],
      ['GET', '/projetos/1/pagamentos', 'ver_financeiro'], ['POST', '/projetos/1/pagamentos', 'operar_financeiro'], ['POST', '/projetos/1/marcos/9/enviar', 'operar_financeiro'],
      ['GET', '/projetos/1/carteirinhas.pdf', 'carteirinhas'], ['POST', '/projetos/1/concessao.pdf', 'documentos_oficiais'], ['POST', '/projetos/1/campo/pontos', 'marcar_campo'],
      ['PUT', '/projetos/1/campo/programacao', 'programar_campo'], ['GET', '/projetos/1/campo/boletim.pdf', 'programar_campo'], ['GET', '/projetos/1/coletora.kml', 'baixar_coletora'],
      ['POST', '/projetos/1/dossies/05/enviar', 'dossies'], ['POST', '/projetos/1/whatsapp/grupo', 'whatsapp'], ['GET', '/projetos/1/campo', '*'], ['GET', '/eu', '*'],
      ['POST', '/importar', null], ['GET', '/equipe', null],
    ];
    for (const [m, c, k] of casos) expect([m, c, permissaoDaRota(m, c)]).toEqual([m, c, k]);
  });
  it('perfis: padrões e o que bloqueia', () => {
    expect(Object.values(PADRAO_POR_PERFIL.OPERADOR).every(Boolean)).toBe(true);
    expect(PADRAO_POR_PERFIL.AGRIMENSOR).toMatchObject({ ver_mapa: true, baixar_mapas: true, programar_campo: true, ver_financeiro: false, operar_financeiro: false });
    expect(Object.keys(PADRAO_POR_PERFIL.CAMPO)).toHaveLength(CATALOGO_PERMISSOES.length);
    const op = { ...PADRAO_POR_PERFIL.OPERADOR, operar_financeiro: false };
    expect(rotaPaPermitida('OPERADOR', 'POST', '/projetos/1/pagamentos', op)).toBe(false);
    expect(rotaPaPermitida('OPERADOR', 'GET', '/projetos/1/pagamentos', op)).toBe(true);
    expect(rotaPaPermitida('OPERADOR', 'POST', '/importar', op)).toBe(true); // rota sem regra: a trava ADMIN fica na própria rota
    expect(rotaPaPermitida('AGRIMENSOR', 'POST', '/importar', PADRAO_POR_PERFIL.AGRIMENSOR)).toBe(false);
    expect(rotaPaPermitida('ADMIN', 'GET', '/qualquer', PADRAO_POR_PERFIL.CAMPO)).toBe(true);
  });
  it('aparelho pelo user-agent', () => {
    expect(dispositivo('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Android (tablet) · Chrome');
    expect(dispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
  });
});
