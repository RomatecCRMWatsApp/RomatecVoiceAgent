// v3.23.3: smoke test do fix mobile da aba Marcar Dias (obras.html).
//
// Projeto serve HTML/JS vanilla via Express (nao tem React/jsdom), entao em vez
// de snapshot de componente, valida que as classes CSS e media queries criticas
// continuam presentes no arquivo. Catch fast se alguem remover por engano.
//
// Bugs cobertos:
//  - BUG 1: safe-area-inset-top no body
//  - BUG 2/4: overflow-wrap break-word (nao "anywhere") no nome do funcionario
//  - BUG 3: card empilhado em mobile (.func-row flex-direction:column)
//  - BUG 5: tabs com scroll horizontal em mobile

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const obrasHtml = readFileSync(
  join(__dirname, '..', 'public', 'obras.html'),
  'utf8',
);

describe('obras.html — Marcar Dias mobile fix (v3.23.3)', () => {
  it('BUG 1: body usa safe-area-inset-* em vez de padding fixo', () => {
    // body.padding-top deve respeitar env(safe-area-inset-top) pra notch iOS
    expect(obrasHtml).toMatch(
      /body\s*\{[^}]*padding-top:\s*max\(env\(safe-area-inset-top\)/,
    );
    expect(obrasHtml).toMatch(/padding-bottom:\s*max\(env\(safe-area-inset-bottom\)/);
  });

  it('BUG 2/4: nenhuma regra CSS ativa usa overflow-wrap:anywhere', () => {
    // overflow-wrap:anywhere quebrava letra-a-letra. Remover comentarios primeiro
    // pra nao confundir com mencao do bug em texto explicativo (ex: changelog inline).
    const stripped = obrasHtml.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('BUG 2/4: .func-row__head .nome usa break-word', () => {
    // O bloco da .nome deve ter overflow-wrap:break-word
    const blocoNome = obrasHtml.match(/\.func-row__head\s+\.nome\s*\{[^}]*\}/);
    expect(blocoNome).not.toBeNull();
    expect(blocoNome![0]).toMatch(/overflow-wrap:\s*break-word/);
    expect(blocoNome![0]).toMatch(/word-break:\s*normal/);
  });

  it('BUG 3: .func-row empilha em mobile (max-width:600px)', () => {
    // Media query mobile deve transformar .func-row em column
    expect(obrasHtml).toMatch(
      /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.func-row\s*\{[^}]*flex-direction:\s*column/,
    );
  });

  it('BUG 3: contadores viram grid 3-cols em mobile', () => {
    expect(obrasHtml).toMatch(
      /\.func-row__counters\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it('BUG 5: .tabs vira scroll horizontal em mobile (max-width:768px)', () => {
    expect(obrasHtml).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.tabs\s*\{[^}]*overflow-x:\s*auto/,
    );
    expect(obrasHtml).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.tabs\s*\{[^}]*flex-wrap:\s*nowrap/,
    );
  });

  it('renderMarcarDias() emite markup com as classes novas', () => {
    // O template literal do card deve conter as classes .func-row*
    // (regressao: se alguem voltar pros inline styles antigos com anywhere)
    const renderFn = obrasHtml.match(/function renderMarcarDias\(\)[\s\S]*?\n\}/);
    expect(renderFn).not.toBeNull();
    expect(renderFn![0]).toContain('class="card func-row"');
    expect(renderFn![0]).toContain('class="func-row__head"');
    expect(renderFn![0]).toContain('class="func-row__counters"');
    expect(renderFn![0]).toContain('class="func-row__actions"');
    // Garante que os inline styles toxicos sumiram do template
    expect(renderFn![0]).not.toMatch(/overflow-wrap:\s*anywhere/);
  });
});
