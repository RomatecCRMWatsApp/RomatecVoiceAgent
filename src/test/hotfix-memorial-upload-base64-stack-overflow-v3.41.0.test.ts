// v3.41.0: testes do hotfix do RangeError no upload do Memorial Hidraulico.
//
// ROOT CAUSE: o handler de change do <input type="file"> fazia
//   `btoa(String.fromCharCode(...new Uint8Array(buf)))`
// O spread (...) em um Uint8Array de PDF (tipicamente > 64KB) passa TODOS os
// bytes como argumentos a String.fromCharCode. O V8 limita ~64-100k argumentos
// — arquivos maiores estouravam "RangeError: Maximum call stack size exceeded".
//
// FIX: FileReader.readAsDataURL nao toca na stack JS (encoding nativo do browser).
// O bug NAO era recursao de input listener (como sugerido no prompt) — era
// limitacao de argumentos da spread syntax.
//
// Defesa em profundidade: guarda `_memUploadEmProgresso` previne dispatch
// sintetico de extensoes ou cliques rapidos de re-entrar no handler.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const OBRAS_HTML = fs.readFileSync(path.join(process.cwd(), 'src', 'public', 'obras.html'), 'utf-8');

describe('HOTFIX v3.41.0 — ROOT CAUSE: spread em Uint8Array gigante', () => {
  it('1. O padrao bugado NAO existe mais como CODIGO (so como comentario documental do fix)', () => {
    // Remove linhas de comentario antes do check.
    const semComentarios = OBRAS_HTML.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('* ')).join('\n');
    expect(semComentarios).not.toMatch(/btoa\(String\.fromCharCode\(\.\.\.new Uint8Array/);
  });

  it('2. Helper arquivoParaBase64 existe e usa FileReader.readAsDataURL', () => {
    expect(OBRAS_HTML).toMatch(/function arquivoParaBase64\(file\)/);
    expect(OBRAS_HTML).toMatch(/new FileReader\(\)/);
    expect(OBRAS_HTML).toMatch(/reader\.readAsDataURL\(file\)/);
  });

  it('3. Helper faz strip do prefixo "data:application/pdf;base64,"', () => {
    // result.slice(idx + 1) descarta "data:.../base64," antes do payload
    expect(OBRAS_HTML).toMatch(/result\.indexOf\(','\)/);
    expect(OBRAS_HTML).toMatch(/result\.slice\(idx \+ 1\)/);
  });

  it('4. onerror tratado (rejeicao explicita)', () => {
    expect(OBRAS_HTML).toMatch(/reader\.onerror\s*=/);
  });

  it('5. Handler do upload usa await arquivoParaBase64 (em vez do spread bugado)', () => {
    expect(OBRAS_HTML).toMatch(/const b64 = await arquivoParaBase64\(file\)/);
  });
});

describe('HOTFIX v3.41.0 — DEFESA EM PROFUNDIDADE: guarda de reentrancia', () => {
  it('6. Sentinela global _memUploadEmProgresso existe', () => {
    expect(OBRAS_HTML).toMatch(/let _memUploadEmProgresso = false/);
  });

  it('7. Handler verifica reentrancia no inicio (early return)', () => {
    expect(OBRAS_HTML).toMatch(/if \(_memUploadEmProgresso\) return/);
  });

  it('8. Reset em finally (nao trava o flag se algo falhar)', () => {
    expect(OBRAS_HTML).toMatch(/finally\s*\{[\s\S]{0,80}?_memUploadEmProgresso = false/);
  });
});

describe('HOTFIX v3.41.0 — Comportamento preservado', () => {
  it('9. memFetch ainda e usado (auth 401 redirect preservado da v3.39.0)', () => {
    expect(OBRAS_HTML).toMatch(/await memFetch\('\/api\/memoriais\/upload-pdf'/);
  });

  it('10. Auto-preenche campos sem disparar input/change sintetico (regra de ouro)', () => {
    // o trecho de auto-preenchimento NAO contem dispatchEvent
    const m = OBRAS_HTML.match(/Auto-preenche campos[\s\S]{0,2000}?ev\.target\?\.value/);
    if (m) {
      expect(m[0]).not.toMatch(/dispatchEvent\(new Event\('input'\)/);
    }
    // Comentario explicativo presente
    expect(OBRAS_HTML).toMatch(/NAO dispara input\/change sintetico/);
  });

  it('11. NAO_AUTENTICADO ainda silencia mensagem confusa (preservado da v3.39.0)', () => {
    expect(OBRAS_HTML).toMatch(/if \(err && err\.code === 'NAO_AUTENTICADO'\) return/);
  });
});

// Reproducer do bug: demonstra que o padrao antigo estouraria a stack pra arquivos > ~100KB.
// Como o teste roda em node, simulamos o gatilho ate o limite seguro.
describe('HOTFIX v3.41.0 — REPRODUCER: spread quebra com Uint8Array grande', () => {
  it('12. String.fromCharCode com spread de Uint8Array gigante estoura (V8 limit)', () => {
    // 200KB — comum em PDFs de planta hidraulica
    const tamanho = 200_000;
    const bytes = new Uint8Array(tamanho);
    for (let i = 0; i < tamanho; i++) bytes[i] = i & 0xff;
    // Esse e' EXATAMENTE o padrao que estava em obras:23115 (v3.39.0–v3.40.0)
    let threw = false;
    try {
      // eslint-disable-next-line no-new-func
      const result = String.fromCharCode(...(bytes as unknown as number[]));
      // Em alguns runtimes nao quebra com 200KB; valor depende do engine.
      // Mas a presenca do bug e' demonstrada qualitativamente.
      expect(typeof result).toBe('string');
    } catch (err) {
      threw = true;
      expect((err as Error).message).toMatch(/Maximum call stack size exceeded|too many arguments/i);
    }
    // Documenta o comportamento — em V8 com PDF real (~500KB+) sempre quebra.
    // Em node v22, 200KB pode passar (limite ~~half a million args). Pra forcar
    // o erro, aumentamos:
    if (!threw) {
      const grande = new Uint8Array(500_000);
      try {
        String.fromCharCode(...(grande as unknown as number[]));
      } catch (err) {
        threw = true;
        expect((err as Error).message).toMatch(/Maximum call stack size exceeded|too many arguments/i);
      }
    }
    expect(threw).toBe(true);
  });

  it('13. Alternativa em chunks (apply + subarray) NAO estoura mesmo com 500KB', () => {
    // Validacao: o padrao QUE PODERIAMOS ter usado tambem funciona.
    // (FileReader.readAsDataURL e' melhor ainda — sem JS na conversao.)
    const tamanho = 500_000;
    const bytes = new Uint8Array(tamanho);
    for (let i = 0; i < tamanho; i++) bytes[i] = i & 0xff;
    const CHUNK = 0x8000; // 32KB
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    expect(binary.length).toBe(tamanho);
  });
});
