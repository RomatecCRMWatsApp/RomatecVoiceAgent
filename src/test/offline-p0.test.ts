// src/test/offline-p0.test.ts
// Testes do predicate `ehMutacaoP0` exposto pelo offline-engine.js.
// v3.16.0 P0: generaliza a logica antiga (apenas laudos-demarcacao) pros
// cinco modulos do P0 + mantem retro-compat com laudos/galeria.
//
// Como o engine e vanilla JS que roda no browser, montamos um jsdom + injetamos
// indexedDB do `fake-indexeddb` antes de executar o script. O exporte fica em
// `window.OfflineEngine.ehMutacaoP0`.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('UUID injection', () => {
  it('injeta uuid_local em body de POST P0', async () => {
    const eng = await carregarEngine();
    const body = { nome: 'Obra X' };
    const enriched = eng.injetarUuidLocal('POST', '/api/obras', body);
    expect(enriched.uuid_local).toMatch(/^[0-9a-f-]{36}$/i);
    expect(enriched.nome).toBe('Obra X');
  });

  it('NAO injeta em PUT (entidade ja existe)', async () => {
    const eng = await carregarEngine();
    const body = { nome: 'Obra X' };
    const out = eng.injetarUuidLocal('PUT', '/api/obras/42', body);
    expect(out.uuid_local).toBeUndefined();
  });

  it('NAO injeta em DELETE', async () => {
    const eng = await carregarEngine();
    const body = { id: 1 };
    const out = eng.injetarUuidLocal('DELETE', '/api/obras/1', body);
    expect(out.uuid_local).toBeUndefined();
  });

  it('NAO injeta se body ja tem uuid_local (idempotente)', async () => {
    const eng = await carregarEngine();
    const body = { uuid_local: 'existing-uuid', nome: 'X' };
    const out = eng.injetarUuidLocal('POST', '/api/obras', body);
    expect(out.uuid_local).toBe('existing-uuid');
  });

  it('aceita body string JSON e devolve string com uuid', async () => {
    const eng = await carregarEngine();
    const body = JSON.stringify({ nome: 'X' });
    const out = eng.injetarUuidLocal('POST', '/api/parcelas', body);
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out);
    expect(parsed.uuid_local).toMatch(/^[0-9a-f-]{36}$/i);
    expect(parsed.nome).toBe('X');
  });

  it('NAO injeta em modulos fora do P0', async () => {
    const eng = await carregarEngine();
    const out = eng.injetarUuidLocal('POST', '/api/vistorias', { nome: 'X' });
    expect(out.uuid_local).toBeUndefined();
  });

  it('lida com body invalido (string nao-JSON)', async () => {
    const eng = await carregarEngine();
    const out = eng.injetarUuidLocal('POST', '/api/obras', 'not-json');
    expect(out).toBe('not-json');
  });

  it('lida com body null', async () => {
    const eng = await carregarEngine();
    const out = eng.injetarUuidLocal('POST', '/api/obras', null);
    expect(out).toBe(null);
  });
});

describe('gerarUuidLocal', () => {
  it('gera string com formato UUID', async () => {
    const eng = await carregarEngine();
    expect(eng.gerarUuidLocal()).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('gera UUIDs diferentes em chamadas consecutivas', async () => {
    const eng = await carregarEngine();
    const a = eng.gerarUuidLocal();
    const b = eng.gerarUuidLocal();
    expect(a).not.toBe(b);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Task A4: id_map IndexedDB (mapeamento UUID local -> server_id)
// ──────────────────────────────────────────────────────────────────────
describe('id_map (UUID -> server_id)', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
  });

  it('grava e le mapeamento', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('AAA-111', 'obras', 42);
    const id = await eng.idMap.get('AAA-111');
    expect(id).toBe(42);
  });

  it('devolve null pra uuid nao mapeado', async () => {
    const eng = await carregarEngine();
    expect(await eng.idMap.get('NAO-EXISTE')).toBeNull();
  });

  it('clear() apaga tudo', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('X-1', 'obras', 1);
    await eng.idMap.set('X-2', 'parcelas', 2);
    await eng.idMap.clear();
    expect(await eng.idMap.get('X-1')).toBeNull();
    expect(await eng.idMap.get('X-2')).toBeNull();
  });

  it('overrride: set duas vezes mantem ultimo', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('AAA', 'obras', 10);
    await eng.idMap.set('AAA', 'obras', 20);
    expect(await eng.idMap.get('AAA')).toBe(20);
  });
});

describe('traduzirBody', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
  });

  it('substitui campos *_uuid_local por *_id quando mapeado', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('AAA-111', 'obras', 42);
    const body = JSON.stringify({ obra_uuid_local: 'AAA-111', valor: 5000 });
    const out = await eng.traduzirBody(body);
    expect(JSON.parse(out)).toEqual({ obra_id: 42, valor: 5000 });
  });

  it('mantem campo intacto se uuid nao mapeado', async () => {
    const eng = await carregarEngine();
    const body = JSON.stringify({ obra_uuid_local: 'SEM-MAP', valor: 5000 });
    const out = await eng.traduzirBody(body);
    expect(JSON.parse(out)).toEqual({ obra_uuid_local: 'SEM-MAP', valor: 5000 });
  });

  it('aceita body objeto e devolve objeto', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('BBB', 'parcelas', 99);
    const out = await eng.traduzirBody({ parcela_uuid_local: 'BBB' });
    expect(out).toEqual({ parcela_id: 99 });
  });

  it('passa body null/undefined sem erro', async () => {
    const eng = await carregarEngine();
    expect(await eng.traduzirBody(null)).toBe(null);
    expect(await eng.traduzirBody(undefined)).toBe(undefined);
  });
});

describe('traduzirPath', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
  });

  it('substitui <uuid:XXX> em path pelo id real', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('BBB-2', 'parcelas', 100);
    const out = await eng.traduzirPath('/api/parcelas/<uuid:BBB-2>');
    expect(out).toBe('/api/parcelas/100');
  });

  it('lanca erro se uuid no path nao tem mapeamento', async () => {
    const eng = await carregarEngine();
    await expect(eng.traduzirPath('/api/parcelas/<uuid:SEM-MAP>'))
      .rejects.toThrow(/sem mapeamento/i);
  });

  it('path sem placeholder passa intacto', async () => {
    const eng = await carregarEngine();
    expect(await eng.traduzirPath('/api/obras/42')).toBe('/api/obras/42');
  });
});
