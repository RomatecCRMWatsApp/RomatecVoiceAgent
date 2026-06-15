import { describe, it, expect } from 'vitest';
import { parseRespostaExtracao, validarExtracao } from './aiDocExtractor';

const JSON_OK = JSON.stringify({
  obra: { titulo: 'Residência', proprietario: 'Nayara', areaConstruidaM2: 78.69, prancha: 'PE-05' },
  alimentacao: { tipo: 'monofasico', tensaoV: 220, ramalSecaoMm2: 10, disjuntorGeralA: 50, piVA: 9932, pdVA: 8723 },
  circuitos: [
    { id: 'C6', descricao: 'Chuveiro', tipo: 'tue', disjuntorA: 20, polos: 1, condutorFaseMm2: 6, condutorProtecaoMm2: 4, potenciaVA: 5500 },
  ],
  pontos: { iluminacao: 10, tug10A: 16, tue20A: 6, interruptorSimples: 7, interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 2, tomadasPiso: 1 },
  eletrodutos: [{ tipo: 'PVC corrugado', diametro: 'Ø25', comprimentoM: 238.68 }],
  caixas: [{ tipo: '4x2', qtd: 35 }],
  confianca: 0.9, observacoes: [], divergencias: [],
});

describe('aiDocExtractor', () => {
  it('parseia JSON cru (com cercas markdown) e normaliza', () => {
    const r = parseRespostaExtracao('```json\n' + JSON_OK + '\n```');
    expect(r.circuitos[0].id).toBe('C6');
    expect(r.pontos.tug10A).toBe(16);
    expect(r.alimentacao.tipo).toBe('monofasico');
  });

  it('preenche defaults quando campos faltam e força tipos', () => {
    const r = parseRespostaExtracao('{"circuitos":[{"id":"C1","tipo":"tug"}]}');
    expect(r.pontos.iluminacao).toBe(0);
    expect(Array.isArray(r.eletrodutos)).toBe(true);
    expect(r.circuitos[0].disjuntorA).toBe(0);
    expect(r.confianca).toBeGreaterThanOrEqual(0);
  });

  it('lança erro em JSON inválido', () => {
    expect(() => parseRespostaExtracao('isso nao e json')).toThrow();
  });

  it('validarExtracao aponta problemas (sem circuitos)', () => {
    const r = parseRespostaExtracao(JSON_OK);
    r.circuitos = [];
    const probs = validarExtracao(r);
    expect(probs.some((p) => /circuito/i.test(p))).toBe(true);
  });
});
