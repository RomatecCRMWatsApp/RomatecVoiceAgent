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
// Phase D: blobs IndexedDB + replay automatico
// ──────────────────────────────────────────────────────────────────────
describe('Phase D — blobs', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
    const fila = await eng.listarFilaOffline();
    for (const i of fila) await eng.removerDaFila(i.id);
    // limpa blobs pendentes
    const blobs = await eng.listarBlobsPendentes();
    for (const b of blobs) await eng.removerBlob(b.id);
  });

  function fakeBlob(name = 'foto.jpg', mime = 'image/jpeg', size = 1024) {
    // JSDOM tem Blob/File; aceita Uint8Array como conteudo
    const win = getEngineWindow();
    const bytes = new Uint8Array(size);
    return new win.File([bytes], name, { type: mime });
  }

  it('enfileira blob com serverId direto', async () => {
    const eng = await carregarEngine();
    const file = fakeBlob('comprovante.pdf', 'application/pdf', 2048);
    await eng.enfileirarBlob({
      serverId: 77, campo: 'arquivo', file,
      endpointTemplate: '/api/folha/item/:id/upload-comprovante',
    });
    const blobs = await eng.listarBlobsPendentes();
    expect(blobs.length).toBe(1);
    expect(blobs[0].server_id).toBe(77);
    expect(blobs[0].campo).toBe('arquivo');
    expect(blobs[0].filename).toBe('comprovante.pdf');
    expect(blobs[0].uploaded).toBe(0);
  });

  it('rejeita enfileirar sem uuid_local nem serverId', async () => {
    const eng = await carregarEngine();
    const file = fakeBlob();
    await expect(eng.enfileirarBlob({
      campo: 'arquivo', file,
      endpointTemplate: '/api/equipe/:id/foto',
    })).rejects.toThrow(/uuid_local OU serverId/);
  });

  it('drena blob com serverId direto faz POST multipart no endpoint resolvido', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    const file = fakeBlob('foto.png', 'image/png');
    const calls: any[] = [];
    const errors: any[] = [];
    win.fetch = vi.fn(async (url: string, opts: any) => {
      try {
        calls.push({ url, method: opts.method, hasBody: !!opts.body });
        return { ok: true, status: 200, json: async () => ({ ok: true, size: file.size }) };
      } catch (e) {
        errors.push(e);
        throw e;
      }
    });

    await eng.enfileirarBlob({
      serverId: 42, campo: 'arquivo', file,
      endpointTemplate: '/api/equipe/:id/foto',
    });
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });

    const r = await eng.drenarBlobsPendentes();
    expect(r.ok).toBe(1);
    expect(r.fail).toBe(0);
    expect(calls[0].url).toContain('/api/equipe/42/foto');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].hasBody).toBe(true);
    // Marcado como uploaded — nao retorna mais em listarBlobsPendentes
    const pendentesDepois = await eng.listarBlobsPendentes();
    expect(pendentesDepois.length).toBe(0);
  });

  it('drena blob com uuid_local resolve via idMap apos POST', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    // Simula: o POST que cria a entidade ja rodou e setou idMap[AAA] = 99
    await eng.idMap.set('AAA-XYZ', 'despesas', 99);
    const calls: any[] = [];
    win.fetch = vi.fn(async (url: string, opts: any) => {
      calls.push({ url, method: opts.method });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    await eng.enfileirarBlob({
      uuid_local: 'AAA-XYZ', campo: 'arquivo', file: fakeBlob(),
      endpointTemplate: '/api/despesas-extras/:id/comprovante',
    });
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });

    const r = await eng.drenarBlobsPendentes();
    expect(r.ok).toBe(1);
    expect(calls[0].url).toContain('/api/despesas-extras/99/comprovante');
  });

  it('adia blob com uuid_local sem mapeamento (POST pai ainda nao rodou)', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    win.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

    await eng.enfileirarBlob({
      uuid_local: 'PENDENTE', campo: 'arquivo', file: fakeBlob(),
      endpointTemplate: '/api/despesas-extras/:id/comprovante',
    });
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });

    const r = await eng.drenarBlobsPendentes();
    expect(r.ok).toBe(0);
    expect(r.fail).toBe(1);
    expect(win.fetch).not.toHaveBeenCalled();
    const pend = await eng.listarBlobsPendentes();
    expect(pend.length).toBe(1); // continua aguardando
  });

  it('sincronizarFilaOffline encadeia replay de POST + drain de blob (e2e cascade)', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    const calls: any[] = [];
    win.fetch = vi.fn(async (url: string, opts: any) => {
      calls.push({ url, method: opts.method });
      if (opts.method === 'POST' && url.includes('/api/despesas-extras') && !url.includes('comprovante')) {
        return { ok: true, status: 200, json: async () => ({ id: 555, uuid_local: 'DESP-X' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    // 1) POST de despesa (criacao offline)
    await eng.enfileirarOffline({
      method: 'POST', path: '/api/despesas-extras',
      body: JSON.stringify({ uuid_local: 'DESP-X', valor: 100 }),
    });
    // 2) Blob amarrado por uuid_local (vai resolver depois que POST rodar)
    await eng.enfileirarBlob({
      uuid_local: 'DESP-X', campo: 'arquivo', file: fakeBlob('nf.pdf', 'application/pdf'),
      endpointTemplate: '/api/despesas-extras/:id/comprovante',
    });
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });

    await eng.sincronizarFilaOffline();

    // POST primeiro, depois upload do comprovante no id real
    const urls = calls.map(c => c.url);
    expect(urls.some(u => u.includes('/api/despesas-extras') && !u.includes('comprovante'))).toBe(true);
    expect(urls.some(u => u.includes('/api/despesas-extras/555/comprovante'))).toBe(true);
    const blobsPend = await eng.listarBlobsPendentes();
    expect(blobsPend.length).toBe(0);
  });

  it('tentativas >= 5 marca blob como dead (nao tenta mais)', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    win.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'falhou' }) }));

    const id = await eng.enfileirarBlob({
      serverId: 1, campo: 'arquivo', file: fakeBlob(),
      endpointTemplate: '/api/equipe/:id/foto',
    });
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });

    // Dispara 5 vezes pra atingir o limite
    for (let i = 0; i < 5; i++) await eng.drenarBlobsPendentes();
    // 6a drenagem: blob com tentativas >= 5 eh ignorado, fetch nao incrementa
    const callsAntes = (win.fetch as any).mock.calls.length;
    await eng.drenarBlobsPendentes();
    expect((win.fetch as any).mock.calls.length).toBe(callsAntes);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Phase E: pendentesPorEntidade (indicador por aba)
// ──────────────────────────────────────────────────────────────────────
describe('Phase E — pendentesPorEntidade', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
    const fila = await eng.listarFilaOffline();
    for (const i of fila) await eng.removerDaFila(i.id);
    const blobs = await eng.listarBlobsPendentes();
    for (const b of blobs) await eng.removerBlob(b.id);
  });

  it('conta zero quando fila vazia', async () => {
    const eng = await carregarEngine();
    const r = await eng.pendentesPorEntidade();
    expect(r).toEqual({});
  });

  it('agrupa POST/PUT/DELETE da mesma entidade', async () => {
    const eng = await carregarEngine();
    await eng.enfileirarOffline({ method: 'POST', path: '/api/obras', body: '{}' });
    await eng.enfileirarOffline({ method: 'PUT',  path: '/api/obras/1', body: '{}' });
    await eng.enfileirarOffline({ method: 'POST', path: '/api/parcelas', body: '{}' });

    const r = await eng.pendentesPorEntidade();
    expect(r.obras).toBe(2);
    expect(r.parcelas).toBe(1);
  });

  it('normaliza despesas-extras -> despesas e laudos-demarcacao -> laudos', async () => {
    const eng = await carregarEngine();
    await eng.enfileirarOffline({ method: 'POST', path: '/api/despesas-extras', body: '{}' });
    await eng.enfileirarOffline({ method: 'PUT',  path: '/api/laudos-demarcacao/55', body: '{}' });

    const r = await eng.pendentesPorEntidade();
    expect(r.despesas).toBe(1);
    expect(r.laudos).toBe(1);
    expect(r['despesas-extras']).toBeUndefined();
  });

  it('inclui blobs em _blobs', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    const file = new win.File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' });
    await eng.enfileirarBlob({ serverId: 1, campo: 'arquivo', file, endpointTemplate: '/api/equipe/:id/foto' });
    await eng.enfileirarBlob({ serverId: 2, campo: 'arquivo', file, endpointTemplate: '/api/equipe/:id/foto' });
    const r = await eng.pendentesPorEntidade();
    expect(r._blobs).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Client-wins: cliente sobrescreve sempre, sem merge com server
// ──────────────────────────────────────────────────────────────────────
describe('Client-wins (conflict resolution)', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
    const fila = await eng.listarFilaOffline();
    for (const i of fila) await eng.removerDaFila(i.id);
  });

  it('PUT offline envia body local mesmo se server tem versao diferente', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    const calls: any[] = [];
    win.fetch = vi.fn(async (url: string, opts: any) => {
      calls.push({ url, method: opts.method, body: opts.body });
      // Server "responderia" com nome diferente, mas o replay NAO faz merge —
      // simplesmente envia o body local. A garantia eh: o ultimo PUT do cliente vence.
      return { ok: true, status: 200, json: async () => ({ id: 7, nome: 'SERVER-VALUE' }) };
    });

    await eng.enfileirarOffline({
      method: 'PUT', path: '/api/obras/7',
      body: JSON.stringify({ nome: 'CLIENT-WINS' }),
    });
    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
    await eng.sincronizarFilaOffline();

    const sent = JSON.parse(calls[0].body);
    expect(sent.nome).toBe('CLIENT-WINS');
    // Verifica que o engine nao tentou fazer GET antes pra checar versao do server
    expect(calls.filter(c => c.method === 'GET').length).toBe(0);
  });

  it('multiplos PUTs sequenciais — apenas o estado final do ultimo eh enviado a cada item', async () => {
    const eng = await carregarEngine();
    const win = getEngineWindow();
    const calls: any[] = [];
    win.fetch = vi.fn(async (url: string, opts: any) => {
      calls.push({ body: opts.body });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    // Enfileira 3 PUTs com nomes diferentes — todos vao virar requests separados.
    // O server vai receber os 3 em ordem; o "ultimo a chegar" eh o estado final.
    // (engine NAO faz coalesce — isso eh decisao de design pra preservar audit trail)
    await eng.enfileirarOffline({ method: 'PUT', path: '/api/obras/9', body: JSON.stringify({ nome: 'V1' }) });
    await eng.enfileirarOffline({ method: 'PUT', path: '/api/obras/9', body: JSON.stringify({ nome: 'V2' }) });
    await eng.enfileirarOffline({ method: 'PUT', path: '/api/obras/9', body: JSON.stringify({ nome: 'V3' }) });

    Object.defineProperty(win.navigator, 'onLine', { value: true, configurable: true });
    await eng.sincronizarFilaOffline();

    expect(calls.length).toBe(3);
    expect(JSON.parse(calls[0].body).nome).toBe('V1');
    expect(JSON.parse(calls[1].body).nome).toBe('V2');
    expect(JSON.parse(calls[2].body).nome).toBe('V3');
  });
});
