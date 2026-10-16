// v3.149.0 — Ata da AGE de aprovação da contratação (padrão INCRA).
import { describe, it, expect, vi } from 'vitest';

const PROJ = { id: 1, codigo: 'PA-SALETE-MORENO', nome: 'Projeto de Assentamento Salete Moreno', municipio: 'Açailândia', uf: 'MA',
  associacao_nome: 'Associação do Projeto de Assentamento Salete Moreno', associacao_cnpj: null, presidente_nome: null,
  valor_lote: 1000, sinal_padrao: 300, boleto_padrao: 350, rt_nome: 'José Romário Pinto Bezerra', rt_registro: 'CFT 0000 · INCRA XXXX' };
const LISTA = Array.from({ length: 63 }, (_, i) => ({ numero: `PASM-${String(i + 1).padStart(3, '0')}`, nome: `ASSOCIADO TESTE ${i + 1}`, cpf: '000.000.000-00', lote: String(i + 1).padStart(2, '0') }));
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(async () => LISTA), isoDate: (v: unknown) => (v as string) ?? null, registrarEvento: vi.fn() }));
vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn(async () => PROJ) }));

import { conteudoAta, dataExtenso, numeroExtenso, lerDadosAta, htmlAta, docxAta } from './paAta';

const texto = (d = lerDadosAta({})) => conteudoAta(PROJ as never, d, 63).map((b) => ('r' in b ? b.r.map((r) => r.t).join('') : b.t)).join('\n');

describe('ata da assembleia (INCRA)', () => {
  it('datas e números por extenso', () => {
    expect(dataExtenso('2026-10-17')).toBe('aos dezessete dias do mês de outubro do ano de dois mil e vinte e seis');
    expect(dataExtenso('2026-11-01')).toMatch(/^ao primeiro dia/);
    expect(numeroExtenso(63)).toBe('sessenta e três');
    expect(numeroExtenso(2026)).toBe('dois mil e vinte e seis');
  });
  it('traz os requisitos do INCRA: assembleia, rateio, prestação de contas, credenciado, termo de doação', () => {
    const t = texto();
    for (const k of ['exclusivamente em serviço técnico de georreferenciamento', 'relação particular entre a Associação e a contratada', 'não garante, nem assegura, o êxito', 'Cadastro Ambiental Rural (CAR)', '(CCIR)', '(ITR)', 'marcos', 'será orçado e cobrado à parte', 'não serão submetidas à certificação no SIGEF', 'planilhas ODS', 'plaquetas de identificação', 'não disponibilizará dados brutos', 'exclusivamente em PDF, impresso e/ou digital', 'Termo de Responsabilidade Técnica (TRT)', 'Termo de Doação', 'prestará contas', 'credenciado(a) no INCRA', 'facultativa', 'SIGEF', 'R$ 63.000,00', 'estradas', '17.261.987/0001-09']) {
      expect(t.replace(/\u00a0/g, ' ')).toContain(k);
    }
  });
  it('campos em branco viram linha para preencher; preenchidos entram no texto', () => {
    expect(texto()).toContain('________ votos favoráveis');
    const t = texto(lerDadosAta({ data: '2026-10-17', presidente_mesa: 'Fulano', presentes: '58', votos_favor: '58', votos_contra: '0', abstencoes: '0' }));
    expect(t).toContain('Aos dezessete dias do mês de outubro');
    expect(t).toContain('58 (cinquenta e oito)');
    expect(t).toContain('58 votos favoráveis, 0 votos contrários e 0 abstenções');
  });
  it('PDF: um bloco por associado (4 por folha) + folha em branco, com a rogo e digital', () => {
    const html = htmlAta(PROJ as never, lerDadosAta({}), LISTA);
    expect((html.match(/<div class="bl">/g) || []).length).toBe(63 + 4);
    expect((html.match(/<section class="anexo">/g) || []).length).toBe(17);
    expect(html).toContain('A ROGO');
    expect(html).toContain('Impressão digital');
    expect(html).toContain('ANEXO I — LISTA DE PRESENÇA E ASSINATURAS');
  });
  it('DOCX válido (zip do Word)', async () => {
    const r = await docxAta(1, lerDadosAta({ data: '2026-10-17' }), null);
    expect(r.docx.subarray(0, 2).toString()).toBe('PK');
    expect(r.nome).toBe('ATA-ASSEMBLEIA-CONTRATACAO-PA-SALETE-MORENO-2026-10-17.docx');
    if (process.env.ATA_OUT) (await import('node:fs')).writeFileSync(process.env.ATA_OUT + '/ata.docx', r.docx);
  });
});

import { qualificacao } from './paAta';
describe('qualificação do associado', () => {
  it('usa só o que está no cadastro', () => {
    const q = qualificacao({ lote: '01', numero: 'PASM-001', nome: 'FULANO', cpf: '000.000.000-00', rg: '123 SSP/MA', estado_civil: 'CASADO', nascimento: '1980-05-12', conjuge_nome: 'BELTRANA', terra: 'Chácara X' }, PROJ as never);
    expect(q).toBe('FULANO, brasileiro(a), casado, portador(a) do RG nº 123 SSP/MA, inscrito(a) no CPF sob o nº 000.000.000-00, nascido(a) em 12/05/1980, associado(a) nº PASM-001, beneficiário(a) do Lote 01 (Chácara X) do Projeto de Assentamento Salete Moreno, Açailândia/MA, cônjuge/companheiro(a): BELTRANA.');
    expect(qualificacao({ lote: '02', numero: 'N', nome: 'X', cpf: '1' }, PROJ as never)).not.toMatch(/RG|nascido|cônjuge/);
  });
});
