// v3.156.0 — relação de associados por lote (conferência da diretoria).
import { describe, it, expect, vi } from 'vitest';

vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), registrarEvento: vi.fn() }));
vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
vi.mock('./paMapas', () => ({ buscarSubdivisao: vi.fn() }));

import { montarRelacao, htmlRelacao, cpfMascarado } from './paRelacaoLotes';

const PROJ = { codigo: 'PA-SALETE-MORENO', nome: 'Projeto de Assentamento Salete Moreno', municipio: 'Açailândia', uf: 'MA', associacao_nome: null, associacao_cnpj: null };

describe('relação por lote', () => {
  const lotes = [{ lote: '01', area_ha: 10.5 }, { lote: '10', area_ha: 9 }, { lote: '27', area_ha: 8 }];
  const as = [
    { nome: 'CÍCERO DA SILVA OLIVEIRA', cpf: '123.456.789-01', numero: 'PASM-001', parcela: '01', lote_vila: '1' },
    { nome: 'IDENILSON DA SILVA', cpf: '', numero: 'PASM-021', parcela: null, lote_vila: '17' },
  ];
  const r = montarRelacao(lotes, as);

  it('liga lote ao associado e marca o resto como a confirmar', () => {
    expect(r.linhas.map((l) => l.nome)).toEqual(['CÍCERO DA SILVA OLIVEIRA', null, null]);
    expect(r.semLote).toEqual([{ nome: 'IDENILSON DA SILVA', numero: 'PASM-021', lote_vila: '17' }]);
    expect(r.linhas[0].lote_vila).toBe('1');
  });

  it('CPF sai mascarado (LGPD) e o HTML tem pendências e assinaturas', () => {
    expect(cpfMascarado('123.456.789-01')).toBe('***.456.789-**');
    const h = htmlRelacao(PROJ as never, r);
    expect(h).not.toContain('123.456.789-01');
    expect(h).toContain('***.456.789-**');
    expect((h.match(/A CONFIRMAR/g) || []).length).toBe(2);
    expect(h).toContain('IDENILSON DA SILVA');
    expect(h).toContain('Presidente');
    expect(h).toContain('Lote na vila');
    expect(h).toContain('Lote de produção');
  });
});
