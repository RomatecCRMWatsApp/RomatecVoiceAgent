import { describe, it, expect } from 'vitest';
import { tokenPesquisa, lerTokenPesquisa, resumoNotas, mensagemPesquisa, INSTAGRAM_PORTAL } from './paPesquisa';
import { htmlPesquisa } from '../../routes/paPesquisaPublica';

describe('v3.181.0 — pesquisa de satisfação', () => {
  it('link pessoal assinado: só o token certo abre', () => {
    const t = tokenPesquisa(28);
    expect(lerTokenPesquisa(t)).toBe(28);
    expect(lerTokenPesquisa(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBeNull();
    expect(lerTokenPesquisa(`${(29).toString(36)}-${t.split('-').slice(1).join('-')}`)).toBeNull(); // outro associado com a assinatura do 28
    expect(lerTokenPesquisa('../../etc')).toBeNull();
  });
  it('satisfação média, % e NPS', () => {
    const r = resumoNotas([10, 9, 8, 7, 6, 3, 10]);
    expect(r).toMatchObject({ respostas: 7, media: 7.6, satisfacao_pct: 76, promotores: 3, neutros: 2, detratores: 2, nps: 14 });
    expect(r.distribuicao[10]).toBe(2);
    expect(resumoNotas([])).toMatchObject({ respostas: 0, media: null, nps: null });
  });
  it('mensagem do WhatsApp e página com o Instagram e as notas', () => {
    const m = mensagemPesquisa('GAELE FERREIRA', 'https://x/pa/pesquisa/abc');
    expect(m).toContain('Olá, Gaele!');
    expect(m).toContain('@avalieimob');
    expect(m).toContain('https://x/pa/pesquisa/abc');
    const h = htmlPesquisa({ nome: 'GAELE FERREIRA', lote: '43', projeto: 'PA Salete Moreno', nota: null, comentario: null, seguiu: false }, 'tok');
    expect(h).toContain(INSTAGRAM_PORTAL);
    expect(h).toContain('data-n="0"');
    expect(h).toContain('data-n="10"');
    expect(h).not.toContain('FERREIRA'); // só o primeiro nome
  });
});
