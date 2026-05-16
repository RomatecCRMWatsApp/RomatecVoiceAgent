// src/test/offline-p0.test.ts
// Testes do predicate `ehMutacaoP0` exposto pelo offline-engine.js.
// v3.16.0 P0: generaliza a logica antiga (apenas laudos-demarcacao) pros
// cinco modulos do P0 + mantem retro-compat com laudos/galeria.
//
// Como o engine e vanilla JS que roda no browser, montamos um jsdom + injetamos
// indexedDB do `fake-indexeddb` antes de executar o script. O exporte fica em
// `window.OfflineEngine.ehMutacaoP0`.

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

let _engineCache: any = null;

async function carregarEngine() {
  if (_engineCache) return _engineCache;
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
    runScripts: 'outside-only',
  });
  // O engine roda dentro do `dom.window.eval`, entao nao precisamos atribuir
  // window/document em `global`. Os simbolos do script (window.api,
  // window.OfflineEngine, addEventListener etc.) sao resolvidos no contexto
  // do proprio JSDOM. Node v20+ tem `navigator` como getter readonly no
  // globalThis, entao atribui-lo direto quebra.

  // crypto.randomUUID — JSDOM moderno tem; senao fallback
  if (!dom.window.crypto?.randomUUID) {
    Object.defineProperty(dom.window, 'crypto', {
      value: {
        randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
      },
      configurable: true,
    });
  }
  // indexedDB do fake-indexeddb (ja injetado em globalThis.indexedDB pelo /auto)
  Object.defineProperty(dom.window, 'indexedDB', {
    value: (global as any).indexedDB,
    configurable: true,
  });
  const srcPath = path.resolve(process.cwd(), 'src/public/offline-engine.js');
  const src = fs.readFileSync(srcPath, 'utf8');
  // Executa o script no contexto do window
  dom.window.eval(src);
  _engineCache = dom.window.OfflineEngine;
  return _engineCache;
}

describe('ehMutacaoP0 predicate', () => {
  it('aceita POST /api/obras', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/obras')).toBe(true);
  });

  it('aceita PUT /api/parcelas/123', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('PUT', '/api/parcelas/123')).toBe(true);
  });

  it('aceita DELETE /api/recibos/abc', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('DELETE', '/api/recibos/abc')).toBe(true);
  });

  it('aceita /api/despesas-extras', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/despesas-extras')).toBe(true);
  });

  it('aceita /api/equipe', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('PUT', '/api/equipe/5')).toBe(true);
  });

  it('mantem laudos como antes (retro-compat)', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/laudos-demarcacao')).toBe(true);
  });

  it('mantem galeria (retro-compat)', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/galeria')).toBe(true);
  });

  it('rejeita GET', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('GET', '/api/obras')).toBe(false);
  });

  it('rejeita modulos fora do P0 (vistorias)', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/vistorias')).toBe(false);
  });

  it('aceita path com query string', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/obras?force=1')).toBe(true);
  });

  it('rejeita path look-alike (/api/obrasfoo)', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/obrasfoo')).toBe(false);
  });

  it('rejeita path sem prefixo /api/', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/v2/api/obras')).toBe(false);
  });

  it('aceita method case-insensitive', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('post', '/api/obras')).toBe(true);
  });
});
