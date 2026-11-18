// v3.188.0 — capa do dossiê do lote: textos do quadro, nome do arquivo e código do lote.
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), transacao: vi.fn(), num: Number, registrarEvento: vi.fn() }));
import { linhasCapa, nomeArquivoCapa, dataExtensoCurta, htmlCapaDossie, ASSOCIACAO_PADRAO } from './paCapaDossie';
import { normalizarCodigo } from './paLotesProducao';

const LT05 = { lote: 'LT-05', associado: 'SILVANA DA SILVA GOMES', numero: 'PASM-014', lote_vila: '14', denominacao: 'Chácara Nosso Lar', area_ha: 36.0, municipio: 'Açailândia/MA', associacao: 'Associação dos Produtores Rurais do PA Salete Moreno', emissao: '2026-11-18' };

describe('capa do dossiê do lote (modelo LT-05)', () => {
  it('quadro de identificação igual à referência', () => {
    expect(linhasCapa(LT05)).toEqual([
      ['Associado(a)', 'SILVANA DA SILVA GOMES'],
      ['Nº do associado', 'PASM-014 · lote da vila 14'],
      ['Denominação', '“Chácara Nosso Lar”'],
      ['Área', '36,0000 ha · 7,4380 alqueires'],
      ['Município', 'Açailândia/MA'],
      ['Associação', 'Associação dos Produtores Rurais do PA Salete Moreno'],
      ['Emissão', '18 de novembro de 2026'],
    ]);
  });
  it('sem área / denominação / associação → textos padrão', () => {
    const l = linhasCapa({ lote: 'LT-07', associado: 'Fulano', numero: 'PASM-001' });
    expect(l[1][1]).toBe('PASM-001');
    expect(l[2][1]).toBe('—');
    expect(l[3][1]).toBe('a definir após o georreferenciamento');
    expect(l[5][1]).toBe(ASSOCIACAO_PADRAO);
  });
  it('nome do arquivo no padrão do gerador', () => {
    expect(nomeArquivoCapa(LT05)).toBe('Capa_Dossie_LT-05_Silvana_Da_Silva_Gomes_Salete_Moreno_Romatec.pdf');
    expect(nomeArquivoCapa({ lote: 'LT-12', associado: 'JOÃO DE SOUSA' })).toBe('Capa_Dossie_LT-12_Joao_De_Sousa_Salete_Moreno_Romatec.pdf');
  });
  it('data por extenso', () => {
    expect(dataExtensoCurta('2026-01-05')).toBe('5 de janeiro de 2026');
  });
  it('HTML escapa texto e traz o título do lote', () => {
    const h = htmlCapaDossie({ ...LT05, associado: 'A <b>X</b>' });
    expect(h).toContain('LOTE LT-05');
    expect(h).toContain('A &lt;B&gt;X&lt;/B&gt;');
    expect(h).toContain('DOSSIÊ TÉCNICO DO LOTE DE PRODUÇÃO');
  });
  it('código do lote normalizado', () => {
    expect(normalizarCodigo('5')).toEqual({ codigo: 'LT-05', parcela: '05' });
    expect(normalizarCodigo('LT-05')).toEqual({ codigo: 'LT-05', parcela: '05' });
    expect(normalizarCodigo('lt 112')).toEqual({ codigo: 'LT-112', parcela: '112' });
    expect(() => normalizarCodigo('abc')).toThrow();
  });
});
