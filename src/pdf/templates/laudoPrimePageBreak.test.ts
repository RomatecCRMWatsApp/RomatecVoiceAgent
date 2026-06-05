// v3.56.1 — garante as correções de quebra de página dos templates Prime de laudo:
// margem inferior >= 22mm (footer não sobrepõe), título com break-after (não orfão),
// linhas/blocos com break-inside, e ausência de rodapé fixo duplicado no body.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname);
const src = (f: string) => readFileSync(join(dir, f), 'utf8');

const laudos = ['laudoTemplatePrime1.ts', 'laudoTemplatePrime2.ts'];
const todos = [...laudos, 'propostaTemplatePrime1.ts', 'propostaTemplatePrime2.ts'];

describe('Prime laudo — quebra de página (v3.56.1)', () => {
  for (const f of laudos) {
    it(`${f}: margin.bottom >= 22mm no footer`, () => {
      const m = src(f).match(/bottom:\s*'(\d+)mm'/);
      expect(m, 'margin.bottom não encontrado').not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(22);
    });
    it(`${f}: h2.secao tem break-after (título não orfão)`, () => {
      const h2 = src(f).match(/h2\.secao\s*\{[^}]*\}/);
      expect(h2).not.toBeNull();
      expect(h2![0]).toContain('break-after:avoid');
    });
    it(`${f}: linhas de tabela (tr) com break-inside`, () => {
      expect(src(f)).toMatch(/(^|[,\s])tr,?[^{]*\{[^}]*break-inside:avoid/m);
    });
    it(`${f}: body com padding inferior (espaço do footer)`, () => {
      expect(src(f)).toMatch(/body\s*\{[^}]*padding:0 12mm 8mm/);
    });
  }
});

describe('Prime — sem rodapé fixo duplicado no body (todos)', () => {
  for (const f of todos) {
    it(`${f}: não usa position:fixed bottom (rodapé só no footerTemplate/rodape final)`, () => {
      expect(src(f)).not.toMatch(/position:\s*fixed;[^"]*bottom:\s*0/);
    });
  }
});
