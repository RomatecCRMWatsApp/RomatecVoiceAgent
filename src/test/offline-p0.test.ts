// src/test/offline-p0.test.ts
// Testes do predicate `ehMutacaoP0` exposto pelo offline-engine.js.
// v3.16.0 P0: generaliza a logica antiga (apenas laudos-demarcacao) pros
// cinco modulos do P0 + mantem retro-compat com laudos/galeria.
//
// Como o engine e vanilla JS que roda no browser, montamos um jsdom + injetamos
// indexedDB do `fake-indexeddb` antes de executar o script. O exporte fica em
// `window.OfflineEngine.ehMutacaoP0`.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

let _engineCache: any = null;
let _windowCache: any = null;

function getEngineWindow() {
  return _windowCache;
}

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
  _windowCache = dom.window;
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

// ──────────────────────────────────────────────────────────────────────
// Task A5: replay com cascade translation
// ──────────────────────────────────────────────────────────────────────
describe('Cascade replay', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
    const fila = await eng.listarFilaOffline();
    for (const i of fila) await eng.removerDaFila(i.id);
  });

  // O engine roda dentro do JSDOM (dom.window.eval(src)), entao referencias a
  // `fetch` e `navigator` resolvem pro window do JSDOM — nao pro `global` do
  // Node. Por isso os testes patcham `win.fetch` e `win.navigator.onLine`
  // diretamente em vez de `(global as any).fetch`.

  it('POST cria mapeamento, PUT subsequente usa id real', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    const calls: any[] = [];
    win.fetch = vi.fn(async (url: string, opts: any) => {
      calls.push({ url, method: opts.method });
      if (opts.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 42, uuid_local: 'AAA-111' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    await eng.enfileirarOffline({
      method: 'POST', path: '/api/obras',
      body: JSON.stringify({ nome: 'X', uuid_local: 'AAA-111' }),
    });
    await eng.enfileirarOffline({
      method: 'PUT', path: '/api/obras/<uuid:AAA-111>',
      body: JSON.stringify({ nome: 'Y' }),
    });

    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
    await eng.sincronizarFilaOffline();

    expect(calls.length).toBe(2);
    expect(calls[0].method).toBe('POST');
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].url).toContain('/api/obras/42');
    expect(await eng.idMap.get('AAA-111')).toBe(42);
  });

  it('POST de parcela traduz obra_uuid_local antes de enviar', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    await eng.idMap.set('OBRA-X', 'obras', 99);
    const calls: any[] = [];
    win.fetch = vi.fn(async (url: string, opts: any) => {
      calls.push({ url, method: opts.method, body: opts.body });
      return { ok: true, status: 200, json: async () => ({ id: 100 }) };
    });

    await eng.enfileirarOffline({
      method: 'POST', path: '/api/parcelas',
      body: JSON.stringify({ obra_uuid_local: 'OBRA-X', valor: 5000, uuid_local: 'PARC-1' }),
    });

    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
    await eng.sincronizarFilaOffline();

    const sentBody = JSON.parse(calls[0].body);
    expect(sentBody.obra_id).toBe(99);
    expect(sentBody.obra_uuid_local).toBeUndefined();
    expect(sentBody.valor).toBe(5000);
  });

  it('PUT com uuid sem mapeamento adia (mantem na fila)', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    win.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));

    await eng.enfileirarOffline({
      method: 'PUT', path: '/api/parcelas/<uuid:NAO-MAP>',
      body: JSON.stringify({ pago: true }),
    });

    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
    await eng.sincronizarFilaOffline();

    expect(win.fetch).not.toHaveBeenCalled();
    const fila = await eng.listarFilaOffline();
    expect(fila.length).toBe(1);  // continua na fila
  });
});

// ──────────────────────────────────────────────────────────────────────
// Task C1: cache_v2 IndexedDB (cache de leitura full sync)
// DB separada da romatec_offline_v1 (que guarda fila de mutacoes) pra
// isolar concerns. 5 stores P0 + sync_meta.
// ──────────────────────────────────────────────────────────────────────
describe('cache_v2 (full sync stores)', () => {
  beforeEach(async () => {
    // O engine e cacheado em `_engineCache`, e cada chamada de abrirCacheV2 abre
    // uma nova conexao com a DB. Conexoes abertas BLOQUEIAM deleteDatabase
    // indefinidamente no fake-indexeddb (fica em onblocked sem auto-fechar),
    // entao em vez de deletar a DB, limpamos cada store via transaction clear.
    // Isso e suficiente pra isolar tests porque sync_meta + 5 stores cobrem
    // toda a superficie exposta pelo cacheV2.
    const eng = await carregarEngine();
    const win = getEngineWindow();
    const db = await eng.abrirCacheV2();
    const todasStores = [...eng.CACHE_V2_STORES, 'sync_meta'];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(todasStores, 'readwrite');
      for (const s of todasStores) tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });

  it('cria stores pras 5 entidades + sync_meta', async () => {
    const eng = await carregarEngine();
    const db = await eng.abrirCacheV2();
    const esperado = ['obras', 'parcelas', 'recibos', 'despesas', 'equipe', 'sync_meta'];
    for (const s of esperado) {
      expect(db.objectStoreNames.contains(s)).toBe(true);
    }
  });

  it('put + get devolve registro', async () => {
    const eng = await carregarEngine();
    await eng.cacheV2.put('obras', { id: 1, nome: 'Obra A' });
    const r = await eng.cacheV2.get('obras', 1);
    expect(r?.nome).toBe('Obra A');
  });

  it('bulkPut insere multiplos registros', async () => {
    const eng = await carregarEngine();
    await eng.cacheV2.bulkPut('obras', [{ id: 1, nome: 'A' }, { id: 2, nome: 'B' }]);
    const all = await eng.cacheV2.getAll('obras');
    expect(all).toHaveLength(2);
  });

  it('bulkPut com array vazio nao quebra', async () => {
    const eng = await carregarEngine();
    await eng.cacheV2.bulkPut('obras', []);
    const all = await eng.cacheV2.getAll('obras');
    expect(all).toHaveLength(0);
  });

  it('put substitui registro existente (mesmo id)', async () => {
    const eng = await carregarEngine();
    await eng.cacheV2.put('parcelas', { id: 1, valor: 100 });
    await eng.cacheV2.put('parcelas', { id: 1, valor: 200 });
    const r = await eng.cacheV2.get('parcelas', 1);
    expect(r.valor).toBe(200);
  });

  it('get devolve null pra id inexistente', async () => {
    const eng = await carregarEngine();
    expect(await eng.cacheV2.get('obras', 99)).toBeNull();
  });

  it('getAll devolve array vazio se store vazia', async () => {
    const eng = await carregarEngine();
    expect(await eng.cacheV2.getAll('recibos')).toEqual([]);
  });

  it('setMeta + getMeta funcionam', async () => {
    const eng = await carregarEngine();
    await eng.cacheV2.setMeta('obras', { last_full_sync_at: 12345 });
    const meta = await eng.cacheV2.getMeta('obras');
    expect(meta.last_full_sync_at).toBe(12345);
  });

  it('getMeta devolve objeto vazio se nunca foi setado', async () => {
    const eng = await carregarEngine();
    const meta = await eng.cacheV2.getMeta('parcelas');
    expect(meta).toEqual({});
  });
});
