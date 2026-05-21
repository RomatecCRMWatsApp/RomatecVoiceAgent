// v3.23.5: testes do aviso DRL (Declaracao de Respeito de Limite) que vai em
// TODA proposta de Georref Rural — regulamentar, texto fixo nao editavel.
//
// Strategy: testa a funcao pura montarAvisoDRL que retorna fragmentos estruturados
// {text, bold, destaque}. O renderAvisoDRL apenas mapeia esses fragments pra
// chamadas PDFKit, entao testar a estrutura cobre o conteudo. PDF binary parsing
// seria overkill aqui.

import { describe, it, expect } from 'vitest';
import { montarAvisoDRL } from './avisoDRL';

function plainText(bloco: ReturnType<typeof montarAvisoDRL>): string {
  return [bloco.titulo, ...bloco.paragrafos.map((p) => p.fragmentos.map((f) => f.text).join(''))].join(' ');
}

describe('montarAvisoDRL — texto base (CERTIFICACAO)', () => {
  const bloco = montarAvisoDRL('CERTIFICACAO');
  const all = plainText(bloco);

  it('tem o titulo "RESPONSABILIDADE DO PROPRIETARIO — DRL"', () => {
    expect(bloco.titulo).toContain('RESPONSABILIDADE DO PROPRIETARIO');
    expect(bloco.titulo).toContain('DRL');
  });

  it('cita as 3 fontes legais', () => {
    expect(all).toContain('Lei 10.267/2001');
    expect(all).toContain('NTGIR 3a Edicao');
    expect(all).toContain('Provimento CNJ no 65/2017');
  });

  it('afirma obrigacao exclusiva do proprietario com destaque vermelho', () => {
    const todosFragmentos = bloco.paragrafos.flatMap((p) => p.fragmentos);
    const fragObrigacao = todosFragmentos.find((f) => f.text.includes('OBRIGACAO LEGAL E EXCLUSIVA'));
    expect(fragObrigacao).toBeDefined();
    expect(fragObrigacao?.bold).toBe(true);
    expect(fragObrigacao?.destaque).toBe(true);
  });

  it('exige RECONHECIMENTO DE FIRMA EM CARTORIO', () => {
    expect(all).toContain('RECONHECIMENTO DE FIRMA EM CARTORIO');
  });

  it('avisa que INCRA NAO CERTIFICA e cartorio NAO AVERBA', () => {
    expect(all).toContain('INCRA NAO CERTIFICA');
    expect(all).toContain('cartorio NAO AVERBA');
  });

  it('orienta sobre item 6.4 quando NAO e retificacao', () => {
    expect(all).toContain('item 6.4');
    expect(all).toContain('R$ 150,00 por confrontante');
  });

  it('NAO tem reforco de RETIFICACAO em CERTIFICACAO', () => {
    expect(all).not.toContain('ATENCAO REFORCADA');
    expect(bloco.paragrafos.some((p) => p.reforco === true)).toBe(false);
  });

  it('NAO tem paragrafo de poligonal resultante em CERTIFICACAO', () => {
    expect(all).not.toContain('poligonal resultante');
  });
});

describe('montarAvisoDRL — DESMEMBRAMENTO', () => {
  const bloco = montarAvisoDRL('DESMEMBRAMENTO');
  const all = plainText(bloco);

  it('mantem o conteudo base obrigatorio', () => {
    expect(all).toContain('OBRIGACAO LEGAL E EXCLUSIVA');
    expect(all).toContain('Lei 10.267/2001');
  });

  it('adiciona paragrafo de poligonal resultante', () => {
    expect(all).toContain('DRLs de TODOS os confrontantes da poligonal resultante');
    expect(all).toContain('DESMEMBRAMENTO');
    expect(all).toContain('lotes vizinhos que serao criados ou unificados');
  });

  it('mantem orientacao do item 6.4 (nao e retificacao)', () => {
    expect(all).toContain('item 6.4');
    expect(all).not.toContain('ATENCAO REFORCADA');
  });
});

describe('montarAvisoDRL — REMEMBRAMENTO', () => {
  const bloco = montarAvisoDRL('REMEMBRAMENTO');
  const all = plainText(bloco);

  it('adiciona paragrafo de poligonal resultante mencionando REMEMBRAMENTO', () => {
    expect(all).toContain('poligonal resultante');
    expect(all).toContain('REMEMBRAMENTO');
  });
});

describe('montarAvisoDRL — RETIFICACAO (reforco critico)', () => {
  const bloco = montarAvisoDRL('RETIFICACAO');
  const all = plainText(bloco);

  it('mantem o conteudo base obrigatorio', () => {
    expect(all).toContain('OBRIGACAO LEGAL E EXCLUSIVA');
  });

  it('adiciona ATENCAO REFORCADA PARA RETIFICACAO DE AREA', () => {
    expect(all).toContain('ATENCAO REFORCADA PARA RETIFICACAO DE AREA');
    expect(all).toContain('impede TOTALMENTE o procedimento');
    expect(all).toContain('Lei 10.931/2004');
  });

  it('marca o paragrafo final como reforco', () => {
    const ultimoP = bloco.paragrafos[bloco.paragrafos.length - 1];
    expect(ultimoP.reforco).toBe(true);
  });

  it('NAO renderiza o paragrafo de orientacao do item 6.4 separado (substituido pelo reforco)', () => {
    // O reforco menciona item 6.4 in-line; nao tem paragrafo separado com "Caso o proprietario deseje"
    expect(all).not.toContain('Caso o proprietario deseje contratar');
  });

  it('reforco contem destaque vermelho na palavra ATENCAO REFORCADA', () => {
    const ultimoP = bloco.paragrafos[bloco.paragrafos.length - 1];
    const primeiroFrag = ultimoP.fragmentos[0];
    expect(primeiroFrag.bold).toBe(true);
    expect(primeiroFrag.destaque).toBe(true);
    expect(primeiroFrag.text).toContain('ATENCAO REFORCADA');
  });

  it('NAO tem paragrafo de poligonal resultante em RETIFICACAO', () => {
    expect(all).not.toContain('poligonal resultante');
  });
});

describe('montarAvisoDRL — estrutura comum', () => {
  it('todas as finalidades tem o mesmo titulo', () => {
    const finalidades: Array<'CERTIFICACAO' | 'DESMEMBRAMENTO' | 'REMEMBRAMENTO' | 'RETIFICACAO'> =
      ['CERTIFICACAO', 'DESMEMBRAMENTO', 'REMEMBRAMENTO', 'RETIFICACAO'];
    const titulos = finalidades.map((f) => montarAvisoDRL(f).titulo);
    expect(new Set(titulos).size).toBe(1);
  });

  it('todas as finalidades tem ao menos 4 paragrafos (3 base + final)', () => {
    const finalidades: Array<'CERTIFICACAO' | 'DESMEMBRAMENTO' | 'REMEMBRAMENTO' | 'RETIFICACAO'> =
      ['CERTIFICACAO', 'DESMEMBRAMENTO', 'REMEMBRAMENTO', 'RETIFICACAO'];
    for (const f of finalidades) {
      expect(montarAvisoDRL(f).paragrafos.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('DESMEMBRAMENTO/REMEMBRAMENTO tem 5 paragrafos (base 3 + poligonal + final)', () => {
    expect(montarAvisoDRL('DESMEMBRAMENTO').paragrafos.length).toBe(5);
    expect(montarAvisoDRL('REMEMBRAMENTO').paragrafos.length).toBe(5);
  });
});
