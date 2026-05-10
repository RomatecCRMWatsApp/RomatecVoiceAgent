// src/services/cartoriosImporter.test.ts
//
// Testa as funcoes puras do importer (parse, filtro, normalizacao). O UPSERT
// em batch toca o banco e fica fora — vamos validar via Railway logs apos o
// deploy do v3.2.0 quando o endpoint admin for invocado.

import { describe, it, expect } from 'vitest';
import {
  parseCsvToCartorios,
  normalizarCidade,
  temAtribuicaoRegistroImoveis,
} from './cartoriosImporter';

describe('normalizarCidade', () => {
  it('remove acentos e baixa caixa', () => {
    expect(normalizarCidade('BONITO DE SANTA FÉ')).toBe('bonito de santa fe');
    expect(normalizarCidade('São José dos Pinhais')).toBe('sao jose dos pinhais');
  });
  it('colapsa espacos', () => {
    expect(normalizarCidade('  Açailândia   ')).toBe('acailandia');
  });
});

describe('temAtribuicaoRegistroImoveis', () => {
  it('detecta atribuicao mesmo combinada com outras', () => {
    expect(temAtribuicaoRegistroImoveis('Notas / Registro de Imóveis')).toBe(true);
    expect(temAtribuicaoRegistroImoveis('Registro de Imóveis')).toBe(true);
  });
  it('rejeita quando ausente', () => {
    expect(temAtribuicaoRegistroImoveis('Notas / Protesto de Títulos')).toBe(false);
  });
  it('tolera variacoes de acento', () => {
    expect(temAtribuicaoRegistroImoveis('Registro de Imoveis')).toBe(true);
  });
});

describe('parseCsvToCartorios', () => {
  const csvBase =
    'CNS,Dat. Instalação,Denominação,Tipo,Atribuições,Status,Situação jurídica da serventia,Data decisão,UF,Cidade,E-mail contato,Dat. ingresso responsável,Responsável,Substituto\n';

  it('parseia linha valida com Registro de Imoveis', () => {
    const csv = csvBase +
      '00.007-5,05/09/1968,7º Serviço de Registro de Imóveis,Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,PR,CURITIBA,cartorio7@example.com,2024-07-09,IRANI SALGADO DE SOUZA VILLEN,-\n';
    const { rows, totalCsv, invalidos } = parseCsvToCartorios(csv);
    expect(totalCsv).toBe(1);
    expect(invalidos).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].cns).toBe('000075');
    expect(rows[0].cns_formatado).toBe('00.007-5');
    expect(rows[0].uf).toBe('PR');
    expect(rows[0].cidade).toBe('CURITIBA');
    expect(rows[0].cidade_normalizada).toBe('curitiba');
    expect(rows[0].denominacao).toContain('Registro de Imóveis');
    expect(rows[0].responsavel).toBe('IRANI SALGADO DE SOUZA VILLEN');
    expect(rows[0].email).toBe('cartorio7@example.com');
    expect(rows[0].status).toBe('Ativo');
    expect(rows[0].situacao_juridica).toBe('PROVIDO');
  });

  it('filtra linhas sem atribuicao Registro de Imoveis', () => {
    const csv = csvBase +
      '00.001-2,01/01/2000,Cartório de Notas,Privatizada,Notas / Protesto de Títulos,Ativo,PROVIDO,12/07/2010,SP,SAO PAULO,a@a.com,2020-01-01,FULANO,-\n' +
      '00.002-3,01/01/2000,Registro de Imoveis Y,Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,SP,SAO PAULO,b@b.com,2020-01-01,BELTRANO,-\n';
    const { rows, totalCsv } = parseCsvToCartorios(csv);
    expect(totalCsv).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].cns).toBe('000023');
  });

  it('marca como invalido quando falta campo obrigatorio', () => {
    const csv = csvBase +
      ',01/01/2000,Sem CNS,Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,SP,SAO PAULO,a@a.com,2020-01-01,FULANO,-\n' +
      '00.003-4,01/01/2000,Sem UF,Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,,SAO PAULO,a@a.com,2020-01-01,FULANO,-\n' +
      '00.004-5,01/01/2000,Sem Cidade,Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,SP,,a@a.com,2020-01-01,FULANO,-\n';
    const { rows, invalidos } = parseCsvToCartorios(csv);
    expect(rows).toHaveLength(0);
    expect(invalidos).toBe(3);
  });

  it('trata campos opcionais ausentes como null', () => {
    const csv = csvBase +
      '00.010-9,01/01/2000,Cartório X,Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,SP,SAO PAULO,,,,\n';
    const { rows } = parseCsvToCartorios(csv);
    expect(rows[0].responsavel).toBeNull();
    expect(rows[0].email).toBeNull();
  });

  it('trunca campos que excedem o limite do schema', () => {
    const denomLonga = 'X'.repeat(600);
    const csv = csvBase +
      `00.099-0,01/01/2000,${denomLonga},Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,SP,SAO PAULO,a@a.com,2020-01-01,FULANO,-\n`;
    const { rows } = parseCsvToCartorios(csv);
    expect(rows[0].denominacao).toHaveLength(500);
  });

  it('lida com aspas duplas em denominacao (CSV com virgula interna)', () => {
    const csv = csvBase +
      '00.011-7,01/01/2000,"Cartório Notas, Protesto e Registro",Privatizada,Registro de Imóveis,Ativo,PROVIDO,12/07/2010,SP,SAO PAULO,a@a.com,2020-01-01,FULANO,-\n';
    const { rows } = parseCsvToCartorios(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].denominacao).toBe('Cartório Notas, Protesto e Registro');
  });
});
