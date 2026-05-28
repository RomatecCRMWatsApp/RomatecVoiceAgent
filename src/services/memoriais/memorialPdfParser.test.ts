// v3.35.0: testes do PDF parser heuristico — fixtures sinteticas que espelham
// padrao real dos PDFs Revit do José Romário.

import { describe, it, expect } from 'vitest';
import {
  extrairMetadados,
  extrairTabelas,
  detectarProdutoInexistente,
  calcularConfianca,
  parsePlantaPdf,
} from './memorialPdfParser';

// Fixture sintetica espelhando PH-03 (Residencia Nayara Brito)
const FIXTURE_PH03 = `
PROJETO HIDRAULICO RESIDENCIAL
PROPRIETARIO: Nayara Brito da Silva
CPF: 123.456.789-00
ENDERECO: Loteamento Colina Park, Quadra 12, Lote 7
Acailandia - MA

AREA DO LOTE:     250,00 m²
AREA DA CONSTRUCAO:  78,69 m²
TAXA DE OCUPACAO:    31,48 %
N° PAVIMENTOS:       1
N° FOLHA:            PH-03

Tabela 1.1 - Tubos de Agua Fria
DESCRICAO TUBO            DIAMETRO            COMPRIMENTO
Tubo PVC Soldavel Marrom  DN 20                12 m
Tubo PVC Soldavel Marrom  DN 25                 8 m
Tubo PVC Soldavel Marrom  DN 32                 3 m

Tabela 2.1 - Conexoes
Joelho 90 DN 25            TIGRE               15 un
Te DN 25                   TIGRE                7 un
Produto Inexistente        ?                     4 un

Conforme NBR 5626:2020.
`;

describe('memorialPdfParser — metadados', () => {
  it('1. extrai proprietario, CPF e area de PDF padrao Revit', () => {
    const m = extrairMetadados(FIXTURE_PH03);
    expect(m.proprietario).toMatch(/Nayara Brito/);
    expect(m.cpf_cnpj).toBe('123.456.789-00');
    expect(m.area_construida_m2).toBe(78.69);
    expect(m.area_lote_m2).toBe(250);
    expect(m.taxa_ocupacao_pct).toBe(31.48);
    expect(m.num_pavimentos).toBe(1);
    expect(m.prancha_codigo).toBe('PH-03');
  });

  it('2. detecta Quadra e Lote', () => {
    const m = extrairMetadados(FIXTURE_PH03);
    expect(m.quadra).toBe('12');
    expect(m.lote).toBe('7');
  });

  it('3. detecta municipio + UF', () => {
    const m = extrairMetadados(FIXTURE_PH03);
    expect(m.uf).toBe('MA');
    expect(m.municipio).toMatch(/Acailandia/);
  });

  it('4. PDF sem padrao Revit -> metadados quase vazios', () => {
    const m = extrairMetadados('Este nao e um PDF da Romatec');
    expect(m.proprietario).toBeUndefined();
    expect(m.cpf_cnpj).toBeUndefined();
    expect(m.area_construida_m2).toBeUndefined();
    expect(m.prancha_codigo).toBeUndefined();
  });
});

describe('memorialPdfParser — tabelas', () => {
  it('5. detecta multiplas tabelas tecnicas (Tabela 1.1, Tabela 2.1)', () => {
    const ts = extrairTabelas(FIXTURE_PH03);
    expect(ts.length).toBeGreaterThanOrEqual(2);
    expect(ts[0].titulo).toMatch(/Tubos de Agua Fria/);
    expect(ts[1].titulo).toMatch(/Conexoes/);
  });

  it('6. captura cabecalho e linhas das tabelas', () => {
    const ts = extrairTabelas(FIXTURE_PH03);
    const tubos = ts[0];
    expect(tubos.cabecalho).toContain('DESCRICAO TUBO');
    expect(tubos.cabecalho).toContain('DIAMETRO');
    expect(tubos.linhas.length).toBeGreaterThanOrEqual(2);
  });
});

describe('memorialPdfParser — Produto Inexistente', () => {
  it('7. detecta "Produto Inexistente" com quantidade', () => {
    const ps = detectarProdutoInexistente(FIXTURE_PH03);
    expect(ps).toHaveLength(1);
    expect(ps[0].quantidade).toBe(4);
    expect(ps[0].contexto).toMatch(/Produto Inexistente/);
  });

  it('8. PDF sem Produto Inexistente -> array vazio', () => {
    const ps = detectarProdutoInexistente('texto qualquer sem padrao');
    expect(ps).toEqual([]);
  });
});

describe('memorialPdfParser — confianca', () => {
  it('9. PDF Revit completo tem confianca >= 0.7', () => {
    expect(calcularConfianca(FIXTURE_PH03)).toBeGreaterThanOrEqual(0.7);
  });

  it('10. PDF aleatorio tem confianca < 0.3', () => {
    const conf = calcularConfianca('texto qualquer sem padrao');
    expect(conf).toBeLessThan(0.3);
  });
});

describe('memorialPdfParser — parsePlantaPdf (integracao)', () => {
  it('11. retorna PdfExtractionResult completo com texto + metadados + tabelas + confianca', async () => {
    const r = await parsePlantaPdf(FIXTURE_PH03);
    expect(r.rawText).toContain('Nayara Brito');
    expect(r.metadados.area_construida_m2).toBe(78.69);
    expect(r.tabelas.length).toBeGreaterThanOrEqual(2);
    expect(r.produtos_inexistentes).toHaveLength(1);
    expect(r.confianca).toBeGreaterThanOrEqual(0.7);
  });
});
