// v3.93.1 — Paridade de conteúdo Prime I/II ⇄ Tradicional.
// Antes os Prime saíam bem mais enxutos que o PDF padrão: faltavam Programa de
// Necessidades, Etapa Preliminar/Hora Técnica, Documentos a Fornecer, Avisos e
// Condições Técnicas e Foro & Validade — e o export do Prime nem mesclava os
// anexos. Este teste protege o mapper (que popula as seções), os dois builders
// HTML (que as renderizam) e o merge de anexos no export.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { propostaConsultoriaToPropostaDados, type PropostaConsultoriaView } from '../pdf/mappers';
import { buildPropostaPrime1Html } from '../pdf/templates/propostaTemplatePrime1';
import { buildPropostaPrime2Html } from '../pdf/templates/propostaTemplatePrime2';
import type { CustosCalculados } from '../services/pricing/types';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

function fakeCustos(): CustosCalculados {
  return {
    secao_1_projetos: ['Projeto Arquitetonico'],
    secao_2_taxas: [{ ordem: 1, descricao: 'ART (CREA-MA)', valor: 285.59 }],
    secao_3_honorarios: [{ ordem: 1, descricao: 'Projetos Executivos', valor: 2864 }],
    secao_4_checklist: [
      { texto: 'Escritura ou matricula atualizada do imovel', obrigatorio: true, imprescindivel: true },
      { texto: 'IPTU do exercicio atual', obrigatorio: true },
      { texto: 'Referencias visuais / inspiracao', obrigatorio: false },
    ],
    secao_5_total: 3149.59,
    avisos: [
      'O CADASTRO NACIONAL DE OBRAS (CNO) sera vinculado apos a expedicao do Alvara.',
      'A ART junto ao CREA-MA exige profissional habilitado.',
    ],
  };
}

function fakeProposta(): PropostaConsultoriaView {
  return {
    numero: 'PROP-2026-0047-R1',
    subtipo: 'projeto_executivo',
    cliente: { nome: 'Elemilson Melo Cruz', cpf_cnpj: '01119387329' },
    data_proposta: '2026-07-10',
    validade_dias: 15,
    valor_total: 3149.59,
    dados_imovel: {
      cidade_obra: 'Açailândia',
      uf_obra: 'MA',
      taxa_esboco: 750,
      programa_necessidades: [
        { nome: 'Sala de Estar', categoria: 'social', ordem_pdf: 1, quantidade: 1 },
        { nome: 'Suite', nome_plural: 'Suites', categoria: 'intimo', ordem_pdf: 2, quantidade: 1, observacao: 'com closet' },
        { nome: 'Cozinha', categoria: 'servico', ordem_pdf: 3, quantidade: 1 },
      ],
    },
    custos_calculados: fakeCustos(),
  };
}

describe('Proposta Prime — paridade de conteúdo (v3.93.1)', () => {
  it('mapper popula programaNecessidades agrupado por categoria', () => {
    const d = propostaConsultoriaToPropostaDados(fakeProposta());
    expect(d.programaNecessidades?.length).toBeGreaterThanOrEqual(3);
    const cats = d.programaNecessidades!.map((g) => g.categoria);
    expect(cats).toContain('Área Social');
    expect(cats).toContain('Área Íntima');
    // pluraliza/observação juntas
    const intimo = d.programaNecessidades!.find((g) => g.categoria === 'Área Íntima');
    expect(intimo?.itens.join(' ')).toMatch(/Suite.*closet/);
  });

  it('mapper popula horaTecnica só no projeto executivo', () => {
    const d = propostaConsultoriaToPropostaDados(fakeProposta());
    expect(d.horaTecnica?.valorFormatado).toMatch(/750/);
    expect(d.horaTecnica?.itens.length).toBe(5);
    expect(d.horaTecnica?.condicoes.length).toBe(2);

    const georref = propostaConsultoriaToPropostaDados({ ...fakeProposta(), subtipo: 'georreferenciamento_rural' });
    expect(georref.horaTecnica).toBeUndefined();
  });

  it('mapper popula documentos (com flag imprescindivel/opcional), avisos e foro', () => {
    const d = propostaConsultoriaToPropostaDados(fakeProposta());
    expect(d.documentos?.some((x) => x.imprescindivel)).toBe(true);
    expect(d.documentos?.some((x) => x.opcional)).toBe(true);
    expect(d.avisos?.length).toBe(2);
    expect(d.foro).toMatch(/Foro da Comarca de Açailândia\/MA/);
    expect(d.foro).toMatch(/validade de 15/);
  });

  it('Prime I renderiza as 5 seções de paridade', () => {
    const html = buildPropostaPrime1Html(propostaConsultoriaToPropostaDados(fakeProposta()));
    expect(html).toMatch(/Programa de Necessidades/);
    expect(html).toMatch(/Etapa Preliminar — Hora Técnica/);
    expect(html).toMatch(/Documentos a Fornecer/);
    expect(html).toMatch(/Avisos e Condições Técnicas/);
    expect(html).toMatch(/Foro e Validade/);
    expect(html).toMatch(/IMPRESCINDÍVEL/);
  });

  it('Prime II renderiza as 5 seções de paridade', () => {
    const html = buildPropostaPrime2Html(propostaConsultoriaToPropostaDados(fakeProposta()));
    expect(html).toMatch(/Programa de Necessidades/);
    expect(html).toMatch(/Etapa Preliminar — Hora Técnica/);
    expect(html).toMatch(/Documentos a Fornecer/);
    expect(html).toMatch(/Avisos e Condições Técnicas/);
    expect(html).toMatch(/Foro e Validade/);
  });

  it('seções somem quando não há dado (georref sem programa/hora técnica)', () => {
    const georref = propostaConsultoriaToPropostaDados({
      ...fakeProposta(),
      subtipo: 'georreferenciamento_rural',
      dados_imovel: { cidade_obra: 'Açailândia', uf_obra: 'MA' },
    });
    const html = buildPropostaPrime1Html(georref);
    expect(html).not.toMatch(/Programa de Necessidades/);
    expect(html).not.toMatch(/Etapa Preliminar/);
    // Foro continua (é boilerplate sempre presente)
    expect(html).toMatch(/Foro e Validade/);
  });

  it('export do Prime mescla anexos (mesclarAnexosProposta)', () => {
    const ROUTE = read('routes', 'pdfPrime.ts');
    expect(ROUTE).toMatch(/mesclarAnexosProposta\(primePdf, Number\(id\)\)/);
  });

  // v3.93.2 — universalidade: a paridade não é exclusiva do projeto executivo.
  // Qualquer subtipo com checklist/avisos ganha Documentos, Avisos e Foro no Prime.
  it('subtipo não-PE (georref) com checklist/avisos renderiza Documentos/Avisos/Foro', () => {
    const georref = propostaConsultoriaToPropostaDados({
      ...fakeProposta(),
      subtipo: 'georreferenciamento_rural',
      dados_imovel: { cidade_obra: 'Açailândia', uf_obra: 'MA' }, // sem programa/hora técnica
    });
    // programa/hora técnica são específicos do PE → ausentes; o resto (paridade) vem
    expect(georref.programaNecessidades).toBeUndefined();
    expect(georref.horaTecnica).toBeUndefined();
    expect(georref.documentos?.length).toBeGreaterThan(0);
    expect(georref.avisos?.length).toBe(2);

    const html = buildPropostaPrime1Html(georref);
    expect(html).toMatch(/Documentos a Fornecer/);
    expect(html).toMatch(/Avisos e Condições Técnicas/);
    expect(html).toMatch(/Foro e Validade/);
    expect(html).not.toMatch(/Programa de Necessidades/);
  });

  it('download de proposta mão-de-obra também inclui anexos por default (server.ts)', () => {
    const SERVER = read('server.ts');
    expect(SERVER).toMatch(/propostas-consultoria|api\/propostas\/:id\/pdf/);
    // opt-out sem_anexos=1 → bare; default → gerarPdfPropostaCompleto (com anexos)
    expect(SERVER).toMatch(/propostas\.gerarPdfPropostaCompleto\(id\)/);
  });
});
