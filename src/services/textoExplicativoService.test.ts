import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../database/connection', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}));

import pool from '../database/connection';
import {
  gerarTextoExplicativo,
  calcularBaseLegal,
} from './textoExplicativoService';

const TEMPLATE_REM =
  'Cliente {{cliente_nome}} - {{quantidade_imoveis}} imóveis em {{municipio}}/{{uf}}. Base: {{base_legal}}.';
const TEMPLATE_DES =
  'Cliente {{cliente_nome}} - {{area_total}} {{unidade_area}} dividida em {{quantidade_fracoes}} frações em {{municipio}}/{{uf}}.';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('calcularBaseLegal', () => {
  it('urbano → Lei 6.766/79', () => {
    expect(calcularBaseLegal('urbano')).toBe(
      'Lei Federal nº 6.766/79 e legislação municipal de parcelamento do solo',
    );
  });
  it('rural → Lei 5.868/72', () => {
    expect(calcularBaseLegal('rural')).toBe(
      'Lei nº 5.868/72 e normas do INCRA aplicáveis ao parcelamento rural',
    );
  });
  it('undefined → fallback', () => {
    expect(calcularBaseLegal(undefined)).toBe('legislação aplicável');
  });
});

describe('gerarTextoExplicativo — remembramento', () => {
  it('substitui todas as variáveis quando preenchidas', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ template_texto: TEMPLATE_REM }],
    ]);
    const out = await gerarTextoExplicativo({
      tipoServico: 'remembramento',
      clienteNome: 'Maria',
      quantidadeImoveis: 4,
      municipio: 'Açailândia',
      uf: 'MA',
      tipoImovel: 'urbano',
    });
    expect(out).toContain('Cliente Maria');
    expect(out).toContain('4 imóveis');
    expect(out).toContain('em Açailândia/MA');
    expect(out).toContain('Lei Federal nº 6.766/79');
    expect(out).not.toContain('{{');
  });

  it('aplica fallbacks quando variáveis vazias', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ template_texto: TEMPLATE_REM }],
    ]);
    const out = await gerarTextoExplicativo({
      tipoServico: 'remembramento',
      clienteNome: '',
    });
    expect(out).toContain('Cliente Cliente');
    expect(out).toContain('X imóveis');
    expect(out).toContain('Açailândia/MA');
    expect(out).toContain('legislação aplicável');
  });

  it('lança quando template não existe', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[]]);
    await expect(
      gerarTextoExplicativo({
        tipoServico: 'remembramento',
        clienteNome: 'X',
      }),
    ).rejects.toThrow(/Template não encontrado/);
  });
});

describe('gerarTextoExplicativo — desmembramento', () => {
  it('formata área em pt-BR e usa unidade padrão', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ template_texto: TEMPLATE_DES }],
    ]);
    const out = await gerarTextoExplicativo({
      tipoServico: 'desmembramento',
      clienteNome: 'João',
      areaTotal: 12500.5,
      unidadeArea: 'm²',
      quantidadeFracoes: 3,
      municipio: 'Imperatriz',
      uf: 'MA',
    });
    expect(out).toContain('12.500,5 m²');
    expect(out).toContain('em 3 frações');
    expect(out).toContain('Imperatriz/MA');
  });
});

describe('gerarTextoExplicativo — segurança de substituição', () => {
  it('não re-substitui tokens injetados por valores de usuário', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      [{ template_texto: 'Olá {{cliente_nome}}, base: {{base_legal}}.' }],
    ]);
    const out = await gerarTextoExplicativo({
      tipoServico: 'remembramento',
      clienteNome: '{{base_legal}}',
      tipoImovel: 'urbano',
    });
    expect(out).toBe('Olá {{base_legal}}, base: Lei Federal nº 6.766/79 e legislação municipal de parcelamento do solo.');
  });
});
