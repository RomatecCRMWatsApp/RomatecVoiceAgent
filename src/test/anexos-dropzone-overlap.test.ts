// v3.23.6: smoke test do refactor de layout do form Georref Rural.
//
// Bug original: depois das novas secoes adicionadas em v3.23.5
// (Finalidade/Matricula/CRI/Perimetro/Validade/Opcionais), a coluna esquerda
// ficou muito mais alta que a direita. Com grid auto-fit minmax(360px,1fr)
// nao havia overlap real de DOM, mas visualmente a coluna de anexos curta
// "flutuava" ao lado de uma coluna de fields gigante, dando impressao de
// sobreposicao.
//
// Fix: trocar pra grid explicito 1.5fr/1fr, anexos sticky (acompanha scroll)
// e media query propria pra colapsar em mobile (em vez de depender do
// safety-net global).
//
// Esse teste garante que as classes CSS e o markup novo nao regridem.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const obrasHtml = readFileSync(
  join(__dirname, '..', 'public', 'obras.html'),
  'utf8',
);

describe('obras.html — form Georref Rural layout v3.23.6', () => {
  it('CSS .form-georref-grid usa grid explicito 1.5fr/1fr', () => {
    const m = obrasHtml.match(/\.form-georref-grid\s*\{[^}]*\}/);
    expect(m, 'classe .form-georref-grid nao encontrada').not.toBeNull();
    expect(m![0]).toMatch(/display:\s*grid/);
    expect(m![0]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1\.5fr\)\s+minmax\(280px,\s*1fr\)/);
  });

  it('CSS .form-georref-fields tem min-width:0 (CRITICO em grid)', () => {
    // Sem min-width:0 o conteudo intrinseco da option mais longa estoura a coluna
    const m = obrasHtml.match(/\.form-georref-fields\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/min-width:\s*0/);
  });

  it('CSS .form-georref-anexos usa position:sticky top:16px', () => {
    const m = obrasHtml.match(/\.form-georref-anexos\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/position:\s*sticky/);
    expect(m![0]).toMatch(/top:\s*16px/);
  });

  it('em <=768px o grid colapsa e anexos volta a position:static', () => {
    // Procura a media query que tem ambas as regras
    expect(obrasHtml).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.form-georref-grid\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
    expect(obrasHtml).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.form-georref-anexos\s*\{[^}]*position:\s*static/,
    );
  });

  it('renderConsultoriaFormGeoRural emite o markup com as classes novas', () => {
    const fn = obrasHtml.match(/function renderConsultoriaFormGeoRural\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toContain('class="form-georref-grid"');
    expect(body).toContain('data-keep-grid'); // explicita intencao vs safety-net
    expect(body).toContain('class="form-georref-fields"');
    expect(body).toContain('<aside class="form-georref-anexos">');
    expect(body).toContain('</aside>');
    // dropzone IDs preservados (wireUpAnexosDropzone depende deles)
    expect(body).toContain('id="cnsDropZone"');
    expect(body).toContain('id="cnsAnexoInput"');
  });

  it('NAO ha mais o grid inline auto-fit antigo no form Georref', () => {
    // O auto-fit minmax(360px,1fr) era usado em VARIOS forms; aqui valida que
    // o renderConsultoriaFormGeoRural NAO o usa mais (so os outros 4 forms)
    const fn = obrasHtml.match(/function renderConsultoriaFormGeoRural\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).not.toMatch(/grid-template-columns:repeat\(auto-fit, minmax\(360px, 1fr\)\)/);
  });

  it('wireUpAnexosDropzone segue sendo chamado em renderConsultoriaFormGeoRural', () => {
    // Garante que o refactor de layout nao removeu a chamada do helper de wireup
    // (regressao do fix v3.23.4 de dropzone inerte)
    const fn = obrasHtml.match(/function renderConsultoriaFormGeoRural\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(fn!.toString()).toContain('wireUpAnexosDropzone(subtipo);');
  });
});
