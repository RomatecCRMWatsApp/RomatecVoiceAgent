// v3.149.0 — Ata da AGE de aprovação da contratação (padrão INCRA).
import { describe, it, expect, vi } from 'vitest';

const PROJ = { id: 1, codigo: 'PA-SALETE-MORENO', nome: 'Projeto de Assentamento Salete Moreno', municipio: 'Açailândia', uf: 'MA',
  associacao_nome: 'Associação do Projeto de Assentamento Salete Moreno', associacao_cnpj: null, presidente_nome: null,
  valor_lote: 1000, sinal_padrao: 300, boleto_padrao: 350, rt_nome: 'José Romário Pinto Bezerra', rt_registro: 'CFT 0000 · INCRA XXXX' };
const LISTA = Array.from({ length: 63 }, (_, i) => ({ numero: `PASM-${String(i + 1).padStart(3, '0')}`, nome: `ASSOCIADO TESTE ${i + 1}`, cpf: '000.000.000-00', lote: String(i + 1).padStart(2, '0') }));
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(async () => LISTA), registrarEvento: vi.fn() }));
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
    for (const k of ['Norma Técnica Conjunta INCRA nº 01/2017', 'Termo de Doação', 'prestará contas', 'credenciado(a) no INCRA', 'facultativa', 'SIGEF', 'R$ 63.000,00', 'estradas', '17.261.987/0001-09']) {
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
  it('PDF: lista de presença com todos os associados + linhas extras', () => {
    const html = htmlAta(PROJ as never, lerDadosAta({}), LISTA);
    expect((html.match(/<tr><td class="c">/g) || []).length).toBe(63 + 8);
    expect(html).toContain('ANEXO I — LISTA DE PRESENÇA E ASSINATURAS');
  });
  it('DOCX válido (zip do Word)', async () => {
    const r = await docxAta(1, lerDadosAta({ data: '2026-10-17' }), null);
    expect(r.docx.subarray(0, 2).toString()).toBe('PK');
    expect(r.nome).toBe('ATA-ASSEMBLEIA-CONTRATACAO-PA-SALETE-MORENO-2026-10-17.docx');
    if (process.env.ATA_OUT) (await import('node:fs')).writeFileSync(process.env.ATA_OUT + '/ata.docx', r.docx);
  });
});
