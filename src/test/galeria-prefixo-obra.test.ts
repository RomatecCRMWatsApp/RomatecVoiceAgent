// v3.107.0: prefixo de obra na legenda da foto.
//
// O CEO escolheu gravar o prefixo NO BANCO (e nao so na exibicao). Isso e
// destrutivo por natureza, entao a funcao precisa ser idempotente: mover uma foto
// de obra em obra nao pode acumular "[A][B][C] Foto", e devolver pra galeria geral
// tem que limpar o prefixo. Este teste tranca esse contrato.
//
// Espelho no front: aplicarPrefixoObraFront/tirarPrefixoObraFront em obras.html
// (usados no update otimista offline) seguem a MESMA regex.

import { describe, it, expect } from 'vitest';
import { aplicarPrefixoObra, tirarPrefixoObra } from '../integrations/galeria';

describe('galeria — prefixo de obra na legenda', () => {
  it('1. aplica o prefixo numa legenda simples', () => {
    expect(aplicarPrefixoObra('Foto #396', 'GBOX PRIME_02')).toBe('[GBOX PRIME_02] Foto #396');
  });

  it('2. NAO empilha prefixos ao mover de obra em obra', () => {
    const passo1 = aplicarPrefixoObra('Foto #396', 'Obra A');
    const passo2 = aplicarPrefixoObra(passo1, 'Obra B');
    const passo3 = aplicarPrefixoObra(passo2, 'Obra C');
    expect(passo3).toBe('[Obra C] Foto #396');
    expect(passo3).not.toContain('Obra A');
    expect(passo3).not.toContain('Obra B');
  });

  it('3. devolver pra galeria geral (obra null) limpa o prefixo', () => {
    const naObra = aplicarPrefixoObra('Foto #396', 'Fazenda Sao Jose');
    expect(aplicarPrefixoObra(naObra, null)).toBe('Foto #396');
  });

  it('4. legenda vazia/null vira so o prefixo, sem "null" no texto', () => {
    expect(aplicarPrefixoObra(null, 'Obra X')).toBe('[Obra X]');
    expect(aplicarPrefixoObra('', 'Obra X')).toBe('[Obra X]');
    expect(aplicarPrefixoObra(null, null)).toBe('');
  });

  it('5. respeita o limite de 500 chars da coluna, preservando o prefixo', () => {
    const gigante = 'x'.repeat(600);
    const out = aplicarPrefixoObra(gigante, 'Obra Y');
    expect(out.length).toBe(500);
    // o que se perde e o fim da legenda, nunca o nome da obra
    expect(out.startsWith('[Obra Y] ')).toBe(true);
  });

  it('6. tirarPrefixoObra remove so o primeiro [..] e preserva colchetes do texto', () => {
    expect(tirarPrefixoObra('[Obra A] Foto [lote 3]')).toBe('Foto [lote 3]');
    expect(tirarPrefixoObra('Foto sem prefixo')).toBe('Foto sem prefixo');
  });

  it('7. nome de obra com caracteres especiais nao quebra a idempotencia', () => {
    const nome = 'Obra "Sao Joao" & Cia';
    const p1 = aplicarPrefixoObra('Foto #1', nome);
    const p2 = aplicarPrefixoObra(p1, nome);
    expect(p2).toBe(p1);
    expect(p2).toBe(`[${nome}] Foto #1`);
  });
});
