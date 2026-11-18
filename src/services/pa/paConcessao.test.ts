import { describe, it, expect } from 'vitest';
import { lerDadosTermo, clausulasTermo, type LoteTermo } from './paConcessao';

const p = { nome: 'Projeto de Assentamento Salete Moreno', municipio: 'Açailândia', uf: 'MA', associacao_nome: 'Associação do PA Salete Moreno' };
const lote: LoteTermo = {
  lote: '43', area_ha: 30.52, area_util_ha: 30.5167, perimetro_m: 2297.27, vertices: 15, confrontantes: ['Lote 31', 'Estrada vicinal'], denominacao: 'Chácara São José II', municipio: 'Itinga do Maranhão/MA',
  titular: { nome: 'GAELE FERREIRA DA CONCEIÇÃO', cpf: '029.123.803-32', rg: null, nascimento: null, naturalidade: null, filiacao: null, estado_civil: null, profissao: null, endereco: null, nacionalidade: null, numero: 'PASM-028', lote_vila: '28' },
};
const corpo = { lote: '43', vinculo: 'Pai', data: '2026-11-18', outra: { nome: 'Manoel Augusto da Conceição', cpf: '17967864387', rg: '048611212013-8 SSP/MA', nascimento: '1956-03-06', naturalidade: 'Floriano/PI', estado_civil: 'Casado' } };

describe('v3.176.0 — termo de concessão de uso', () => {
  it('valida o formulário (lote, nome e CPF)', () => {
    expect(() => lerDadosTermo({ outra: { nome: 'X' } })).toThrow(/lote/);
    expect(() => lerDadosTermo({ lote: '43', outra: {} })).toThrow(/nome/);
    expect(() => lerDadosTermo({ lote: '43', outra: { nome: 'X', cpf: '111.111.111-11' } })).toThrow(/CPF inválido/);
    const d = lerDadosTermo(corpo);
    expect(d.outra).toMatchObject({ nome: 'MANOEL AUGUSTO DA CONCEIÇÃO', cpf: '179.678.643-87', nascimento: '1956-03-06' });
    expect(d.titularidade_formal).toBe(true);
    expect(d.inverter).toBe(false);
  });

  it('titular concede ao pai: qualificação, objeto com área e a declaração de posse', () => {
    const t = clausulasTermo(p, lote, lerDadosTermo(corpo));
    expect(t.concedente.nome).toBe('GAELE FERREIRA DA CONCEIÇÃO');
    expect(t.concessionario.nome).toBe('MANOEL AUGUSTO DA CONCEIÇÃO');
    expect(t.preambulo).toContain('titular cadastral do lote (associado(a) nº PASM-028)');
    expect(t.preambulo).toContain('<b>pai</b> do(a) titular do lote');
    expect(t.preambulo).toContain('natural de Floriano/PI');
    expect(t.preambulo).toMatch(/estado civil _+/); // o que não está no cadastro vira linha (nada inventado)
    const txt = t.clausulas.map((c) => c.titulo + ' ' + c.paragrafos.join(' ')).join('\n');
    expect(txt).toContain('Chácara São José II');
    expect(txt).toContain('Itinga do Maranhão/MA');
    expect(txt).toContain('30,5200 ha (6,3058 alqueires)');
    expect(txt).toContain('conveniência e segurança familiar');
    expect(txt).toContain('não transfere a titularidade cadastral nem o domínio');
    expect(txt).toContain('Comarca de Açailândia/MA');
    expect(t.clausulas[0].titulo).toBe('CLÁUSULA PRIMEIRA — DO OBJETO');
  });

  it('invertido: a outra pessoa concede ao titular e sai a declaração de posse', () => {
    const t = clausulasTermo(p, lote, lerDadosTermo({ ...corpo, inverter: true }));
    expect(t.concedente.nome).toBe('MANOEL AUGUSTO DA CONCEIÇÃO');
    expect(t.concessionario.nome).toBe('GAELE FERREIRA DA CONCEIÇÃO');
    expect(t.clausulas.some((c) => c.titulo.includes('DECLARAÇÃO DE POSSE'))).toBe(false);
  });

  it('escapa HTML vindo do formulário', () => {
    const t = clausulasTermo(p, lote, lerDadosTermo({ ...corpo, obs: '<script>x</script>', outra: { ...corpo.outra, nome: 'Fulano <b>' } }));
    expect(t.preambulo).not.toContain('<b>FULANO <B>');
    expect(t.preambulo).toContain('FULANO &lt;B&gt;');
    expect(JSON.stringify(t.clausulas)).not.toContain('<script>');
  });
});
