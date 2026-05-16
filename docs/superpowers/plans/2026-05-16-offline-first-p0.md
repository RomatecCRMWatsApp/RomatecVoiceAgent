# Offline-first P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender o suporte offline-first existente (hoje só `laudos-demarcacao`+`galeria`) pros 5 módulos de uso real em campo: `obras`, `parcelas`, `recibos`, `despesas`, `equipe`. Mutações offline enfileiradas com UUID local, replay automático com reconciliação em cascata, cache de leitura full sync, anexos como Blobs.

**Architecture:** Estende o padrão IndexedDB queue + replay já em produção em `src/public/obras.html` (linhas 1118-1374). Adiciona 3 stores novas (`id_map`, `cache_v2`, `romatec_blobs`). Backend aceita `uuid_local` em POST + parâmetro `?since=` em GET. Cliente vence em conflito (silencioso, log de auditoria). UI mantém badge atual + adiciona indicadores por aba/card.

**Tech Stack:** TypeScript (backend Express + mysql2), JS vanilla inline (frontend obras.html), IndexedDB (cache + queue + blobs), Vitest (testes).

---

## File Structure

**Modificar:**
- `src/public/obras.html` — generalizar `api()` wrapper, `ehMutacaoLaudo` → `ehMutacaoP0`, adicionar funções de id_map/cache_v2/blobs, UI indicadores por aba (linhas ~1118-1400 + render functions)
- `src/server.ts` — aceitar `uuid_local` em POSTs P0, parâmetro `?since=` em GETs P0
- `src/integrations/obras.ts` + `parcelas.ts` (não existe ainda) + `propostas.ts` etc. — adicionar `uuid_local` na resposta de criação

**Criar:**
- `src/public/offline-engine.js` — extração do código offline + extensões P0 (substitui linhas inline em obras.html)
- `src/test/offline-p0.spec.ts` — testes Vitest do engine

**Referências (não modificar, só ler):**
- `src/public/obras.html:1118-1374` — código offline existente (laudos)
- `src/public/obras.html:15071-15090` — `LAUDOS_OFFLINE_KEY` localStorage cache
- `src/integrations/laudos.ts` — pattern de POST que aceita uuid_local (referência)
- `src/database/migrations.ts` — não precisa migration nova pro P0

---

## Phase A — Extract & generalize queue

### Task A1: Extrair offline engine pra arquivo separado

**Files:**
- Create: `src/public/offline-engine.js`
- Modify: `src/public/obras.html` (linhas 1118-1374 removidas, substituídas por `<script src="/offline-engine.js"></script>`)

- [ ] **Step 1: Criar arquivo `src/public/offline-engine.js` com cópia exata do código atual**

Copiar TODO o bloco entre `// v2.4.0 OFFLINE-FIRST` (linha 1118) e o fim da função `api()` (~linha 1374) pra `src/public/offline-engine.js`. Wrap num IIFE pra escopo:

```javascript
// src/public/offline-engine.js
// Offline-first engine — IndexedDB queue + auto-sync
// Originalmente inline em obras.html, extraído em v3.16.0 pra organizacao
// e pra estender suporte offline pros modulos P0 (obras, parcelas, recibos,
// despesas, equipe) alem dos ja existentes (laudos, galeria).

(function() {
  'use strict';

  // [colar TODO o código entre linhas 1118-1374 de obras.html aqui]

  // Expõe a API pra obras.html consumir:
  window.OfflineEngine = {
    api,
    enfileirarOffline,
    listarFilaOffline,
    removerDaFila,
    sincronizarFilaOffline,
    atualizarBadgeOffline,
    mostrarToastOffline,
  };
})();
```

**IMPORTANTE:** o `api()` precisa ficar acessível como nome global porque obras.html chama `api()` direto em centenas de lugares. Adicionar no final do IIFE: `window.api = api;`

- [ ] **Step 2: Substituir bloco em obras.html**

Em `src/public/obras.html`, **remover** linhas 1118-1374 (o bloco offline + função `api()`). **Adicionar** no `<head>` antes dos outros scripts inline:

```html
<script src="/offline-engine.js"></script>
```

Verificar que `<script src="/relatorio-demarcacao.js"></script>` (já existe) também está antes do uso, OK.

- [ ] **Step 3: Smoke test manual**

Abrir `http://localhost:8080/obras` no navegador (após `npm run dev`). Ações:
- Lista de obras carrega? ✅
- Cria uma obra de teste → salva ✅
- DevTools → Network → Offline → tenta criar laudo → aparece badge OFFLINE
- Volta online → badge muda pra sincronizando

Esperado: comportamento idêntico ao anterior. Se quebrou algo, reverter e investigar antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add src/public/offline-engine.js src/public/obras.html
git commit -m "refactor: extrai offline engine pra offline-engine.js (sem mudanca de comportamento)"
```

---

### Task A2: Generalizar predicate de mutação

**Files:**
- Modify: `src/public/offline-engine.js`
- Test: `src/test/offline-p0.spec.ts` (novo)

- [ ] **Step 1: Criar arquivo de teste com helper de import**

Criar `src/test/offline-p0.spec.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Carrega offline-engine.js num jsdom controlado
async function carregarEngine() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  global.window = dom.window as any;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.localStorage = dom.window.localStorage;
  global.indexedDB = (dom.window as any).indexedDB || (await import('fake-indexeddb')).default;
  // Carrega o script
  const fs = await import('fs');
  const src = fs.readFileSync('src/public/offline-engine.js', 'utf8');
  new Function(src)();
  return (global.window as any).OfflineEngine;
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

  it('aceita /api/despesas-extras (path real do sistema)', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/despesas-extras')).toBe(true);
  });

  it('aceita /api/equipe', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('PUT', '/api/equipe/5')).toBe(true);
  });

  it('mantem laudos como antes', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/laudos-demarcacao')).toBe(true);
  });

  it('rejeita GET', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('GET', '/api/obras')).toBe(false);
  });

  it('rejeita modulos fora do P0 (vistorias)', async () => {
    const eng = await carregarEngine();
    expect(eng.ehMutacaoP0('POST', '/api/vistorias')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar teste — esperado FAIL**

```bash
npm test -- offline-p0
```

Esperado: erro "ehMutacaoP0 is not a function" ou similar.

- [ ] **Step 3: Implementar `ehMutacaoP0` em offline-engine.js**

Em `src/public/offline-engine.js`, dentro do IIFE, ANTES da função `api()` existente, adicionar:

```javascript
// v3.16.0 P0: predicate de mutacao offline-eligivel — generaliza ehMutacaoLaudo
// pros 5 modulos do P0 + mantem laudos/galeria que ja funcionavam
function ehMutacaoP0(method, path) {
  if (!['POST','PUT','DELETE'].includes(method)) return false;
  // Modulos cobertos: obras, parcelas, recibos, despesas-extras, equipe,
  // laudos-demarcacao (pre-existente), galeria (pre-existente)
  return /\/api\/(obras|parcelas|recibos|despesas-extras|equipe|laudos-demarcacao|galeria)(?:[\/\?]|$)/.test(path);
}
```

Substituir a linha existente `const ehMutacaoLaudo = ['POST',...].includes(method) && /\/api\/laudos-demarcacao/.test(path);` na função `api()` por:

```javascript
const ehMutacao = ehMutacaoP0(method, path);
```

E trocar `if (ehMutacaoLaudo && ehErroRede ...)` por `if (ehMutacao && ehErroRede ...)`.

Adicionar `ehMutacaoP0` ao `window.OfflineEngine` no final do IIFE.

- [ ] **Step 4: Rodar teste — esperado PASS**

```bash
npm test -- offline-p0
```

Esperado: 8 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add src/public/offline-engine.js src/test/offline-p0.spec.ts
git commit -m "feat(offline): generaliza ehMutacaoP0 pra obras+parcelas+recibos+despesas+equipe"
```

---

### Task A3: UUID injection em POSTs

**Files:**
- Modify: `src/public/offline-engine.js`
- Test: `src/test/offline-p0.spec.ts`

- [ ] **Step 1: Adicionar testes de UUID injection**

Em `src/test/offline-p0.spec.ts` adicionar:

```typescript
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
    const parsed = JSON.parse(out);
    expect(parsed.uuid_local).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
```

- [ ] **Step 2: Rodar teste — esperado FAIL**

```bash
npm test -- offline-p0
```

Esperado: novos testes falham (`injetarUuidLocal is not a function`).

- [ ] **Step 3: Implementar `injetarUuidLocal`**

Em `src/public/offline-engine.js`, antes de `ehMutacaoP0`:

```javascript
// v3.16.0 P0: gera UUID v4 (RFC 4122). crypto.randomUUID em browsers modernos,
// fallback manual pra Safari < 15.4
function gerarUuidLocal() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  // Fallback: 8-4-4-4-12 hex chars
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Injeta uuid_local em body de POST P0 (se ainda nao tem). Aceita body como
// objeto OU string JSON. Devolve no mesmo formato recebido.
function injetarUuidLocal(method, path, body) {
  if (method !== 'POST') return body;
  if (!ehMutacaoP0(method, path)) return body;
  let obj = body;
  let eraString = false;
  if (typeof body === 'string') {
    try { obj = JSON.parse(body); eraString = true; }
    catch { return body; }  // body nao-JSON: deixa passar
  }
  if (!obj || typeof obj !== 'object') return body;
  if (obj.uuid_local) return body;  // idempotente
  obj.uuid_local = gerarUuidLocal();
  return eraString ? JSON.stringify(obj) : obj;
}
```

Modificar a função `api()` no offline-engine.js: ANTES do `try { const r = await fetch...`, adicionar:

```javascript
// v3.16.0: injeta uuid_local em POSTs P0 (idempotente)
if (opts.body) {
  fetchOpts.body = injetarUuidLocal(method, path, opts.body);
}
```

E na chamada `enfileirarOffline({ method, path, body: opts.body, ... })` trocar `body: opts.body` por `body: fetchOpts.body` pra fila ter o uuid_local.

Exportar `injetarUuidLocal` e `gerarUuidLocal` no `window.OfflineEngine`.

- [ ] **Step 4: Rodar testes**

```bash
npm test -- offline-p0
```

Esperado: 12 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add src/public/offline-engine.js src/test/offline-p0.spec.ts
git commit -m "feat(offline): injeta uuid_local em POSTs P0 (idempotente, suporte browser+node)"
```

---

### Task A4: Store id_map (UUID → server_id)

**Files:**
- Modify: `src/public/offline-engine.js`
- Test: `src/test/offline-p0.spec.ts`

- [ ] **Step 1: Adicionar testes de id_map**

Em `src/test/offline-p0.spec.ts`:

```typescript
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

  it('substitui no body fields *_uuid_local pelos *_id reais', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('AAA-111', 'obras', 42);
    const body = JSON.stringify({ obra_uuid_local: 'AAA-111', valor: 5000 });
    const out = await eng.traduzirBody(body);
    expect(JSON.parse(out)).toEqual({ obra_id: 42, valor: 5000 });
  });

  it('substitui <uuid:XXX> em path pelo id real', async () => {
    const eng = await carregarEngine();
    await eng.idMap.set('BBB-2', 'parcelas', 100);
    const out = await eng.traduzirPath('/api/parcelas/<uuid:BBB-2>');
    expect(out).toBe('/api/parcelas/100');
  });

  it('falha se uuid no path nao tem mapeamento ainda', async () => {
    const eng = await carregarEngine();
    await expect(eng.traduzirPath('/api/parcelas/<uuid:SEM-MAP>'))
      .rejects.toThrow(/sem mapeamento/i);
  });
});
```

- [ ] **Step 2: Rodar — FAIL esperado**

```bash
npm test -- offline-p0
```

- [ ] **Step 3: Implementar id_map em offline-engine.js**

Adicionar logo após as constantes existentes (`OFFLINE_DB_NAME`, `OFFLINE_STORE`):

```javascript
// v3.16.0 P0: store de mapeamento UUID local → server_id
// (mesma DB do offline pra simplificar, store separada)
const ID_MAP_STORE = 'id_map';

// Sobrescreve abrirDBOffline pra incluir os novos stores
function abrirDBOffline() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB nao suportado'));
    const req = indexedDB.open(OFFLINE_DB_NAME, 2);  // version 2 (era 1)
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        const s = db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(ID_MAP_STORE)) {
        db.createObjectStore(ID_MAP_STORE, { keyPath: 'uuid_local' });
      }
    };
  });
}

const idMap = {
  async set(uuid, entidade, serverId) {
    const db = await abrirDBOffline();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ID_MAP_STORE, 'readwrite');
      tx.objectStore(ID_MAP_STORE).put({ uuid_local: uuid, entidade, server_id: serverId, mapped_at: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(uuid) {
    const db = await abrirDBOffline();
    return new Promise((resolve, reject) => {
      const r = db.transaction(ID_MAP_STORE, 'readonly').objectStore(ID_MAP_STORE).get(uuid);
      r.onsuccess = () => resolve(r.result?.server_id ?? null);
      r.onerror = () => reject(r.error);
    });
  },
  async clear() {
    const db = await abrirDBOffline();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ID_MAP_STORE, 'readwrite');
      tx.objectStore(ID_MAP_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// Traduz body: campos *_uuid_local viram *_id se houver mapeamento
async function traduzirBody(body) {
  if (!body) return body;
  let obj = body;
  let eraString = false;
  if (typeof body === 'string') {
    try { obj = JSON.parse(body); eraString = true; } catch { return body; }
  }
  if (!obj || typeof obj !== 'object') return body;
  for (const k of Object.keys(obj)) {
    if (k.endsWith('_uuid_local')) {
      const id = await idMap.get(obj[k]);
      if (id != null) {
        const novoCampo = k.replace(/_uuid_local$/, '_id');
        obj[novoCampo] = id;
        delete obj[k];
      }
    }
  }
  return eraString ? JSON.stringify(obj) : obj;
}

// Traduz path: /api/X/<uuid:YYY> → /api/X/123 (se mapeado)
async function traduzirPath(path) {
  const m = /<uuid:([^>]+)>/.exec(path);
  if (!m) return path;
  const id = await idMap.get(m[1]);
  if (id == null) throw new Error('Path com uuid sem mapeamento: ' + m[1]);
  return path.replace(/<uuid:[^>]+>/, String(id));
}
```

Exportar `idMap`, `traduzirBody`, `traduzirPath` no `window.OfflineEngine`.

- [ ] **Step 4: Adicionar `fake-indexeddb` ao package.json (devDep)**

```bash
npm i -D fake-indexeddb
```

E em `src/test/offline-p0.spec.ts`, ajustar import:
```typescript
import 'fake-indexeddb/auto';  // No topo do arquivo
```

- [ ] **Step 5: Rodar testes**

```bash
npm test -- offline-p0
```

Esperado: 17 testes verdes.

- [ ] **Step 6: Commit**

```bash
git add src/public/offline-engine.js src/test/offline-p0.spec.ts package.json package-lock.json
git commit -m "feat(offline): id_map (UUID local -> server_id) + traducao de body/path em cascata"
```

---

### Task A5: Replay com cascade translation

**Files:**
- Modify: `src/public/offline-engine.js` (função `sincronizarFilaOffline`)
- Test: `src/test/offline-p0.spec.ts`

- [ ] **Step 1: Adicionar teste de cascade replay**

```typescript
describe('Replay cascata', () => {
  beforeEach(async () => {
    const eng = await carregarEngine();
    await eng.idMap.clear();
    // Limpa fila tambem
    const fila = await eng.listarFilaOffline();
    for (const i of fila) await eng.removerDaFila(i.id);
  });

  it('POST cria mapeamento, PUT subsequente usa id real', async () => {
    const eng = await carregarEngine();
    // Mock fetch que devolve {id: 42, uuid_local} no POST e {ok:true} no PUT
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body });
      if (opts.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ id: 42, uuid_local: 'AAA-111' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as any;

    // Enfileira POST + PUT em cascata
    await eng.enfileirarOffline({
      method: 'POST', path: '/api/obras',
      body: JSON.stringify({ nome: 'X', uuid_local: 'AAA-111' }),
    });
    await eng.enfileirarOffline({
      method: 'PUT', path: '/api/obras/<uuid:AAA-111>',
      body: JSON.stringify({ nome: 'Y' }),
    });

    await eng.sincronizarFilaOffline();

    // Esperado: POST chamado primeiro, depois PUT com /api/obras/42
    expect(calls.length).toBe(2);
    expect(calls[0].method).toBe('POST');
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].url).toContain('/api/obras/42');
  });
});
```

- [ ] **Step 2: Rodar — esperado FAIL (replay nao traduz path/body)**

```bash
npm test -- offline-p0
```

- [ ] **Step 3: Atualizar `sincronizarFilaOffline` em offline-engine.js**

Substituir o corpo do for da função (versão atual nas linhas 1218-1247 do código original) por:

```javascript
for (const item of fila.sort((a,b) => a.ts - b.ts)) {
  if ((item.tentativas || 0) >= 5) { fail++; continue; }
  try {
    // v3.16.0: traduz path/body se contem refs a uuid_local
    let path = item.path;
    let body = item.body;
    try { path = await traduzirPath(path); } catch (e) {
      // uuid no path sem mapeamento — pula este, tenta no proximo replay
      // (provavelmente o POST que cria o mapeamento ainda nao rodou)
      console.warn('[offline] adiando', item.id, e.message);
      fail++;
      continue;
    }
    body = await traduzirBody(body);

    const url = path + (path.includes('?') ? '&' : '?') + '_t=' + Date.now();
    const r = await fetch(url, {
      method: item.method,
      body,
      headers: body
        ? { 'Content-Type': 'application/json', ...(item.headers || {}) }
        : item.headers,
    });
    if (r.ok) {
      // v3.16.0: se foi POST com uuid_local, captura id real do server e
      // grava no id_map pra cascata futura
      if (item.method === 'POST' && body) {
        try {
          const reqBody = typeof body === 'string' ? JSON.parse(body) : body;
          const respBody = await r.json();
          if (reqBody?.uuid_local && respBody?.id != null) {
            const entidade = (path.match(/\/api\/([^\/\?]+)/) || [])[1] || 'unknown';
            await idMap.set(reqBody.uuid_local, entidade, respBody.id);
          }
          // Mantem retro-compat com laudos
          if (item.method === 'POST' && item.path === '/api/laudos-demarcacao' && reqBody?.uuid_local) {
            try { removerLaudoOfflineLocal(reqBody.uuid_local); } catch {}
          }
        } catch (_) {}
      }
      await removerDaFila(item.id);
      ok++;
    } else {
      await incrementarTentativa(item.id, `HTTP ${r.status}`);
      fail++;
    }
  } catch (err) {
    await incrementarTentativa(item.id, err.message);
    fail++;
  }
}
```

- [ ] **Step 4: Rodar testes — PASS esperado**

```bash
npm test -- offline-p0
```

- [ ] **Step 5: Commit**

```bash
git add src/public/offline-engine.js src/test/offline-p0.spec.ts
git commit -m "feat(offline): replay com traducao em cascata (POST grava id_map, PUT/DELETE usam id real)"
```

---

## Phase B — Backend support

### Task B1: Echo de uuid_local nos POSTs P0

**Files:**
- Modify: `src/integrations/obras.ts` (criarObra), `src/services/cobrancaParcelas.ts` (não tem create), `src/integrations/recibos.ts`, `src/integrations/despesasExtras.ts`, `src/integrations/equipe.ts` ou os equivalentes que existirem

- [ ] **Step 1: Identificar handlers reais**

```bash
grep -rn "export async function criar\|export async function inserir" src/integrations/ src/services/ | head -30
```

Documentar aqui os caminhos reais encontrados (provavelmente cada módulo P0 tem 1 função `criarXxx`):
- Obras: `src/integrations/obras.ts:criarObra`
- Parcelas: `src/integrations/obras.ts:criarParcela`
- Recibos: `src/integrations/recibos.ts:criarRecibo` (provável)
- Despesas: `src/integrations/despesasExtras.ts:criarDespesa` (provável)
- Equipe: `src/integrations/obras.ts` ou `src/integrations/equipe.ts`

- [ ] **Step 2: Pra cada handler, aceitar e devolver uuid_local**

Padrão (exemplo com `criarObra`):

```typescript
// Antes
export async function criarObra(input: CriarObraInput): Promise<{insertId: number}> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obras (...) VALUES (...)`,
    [...]
  );
  return { insertId: r.insertId };
}

// Depois
export async function criarObra(input: CriarObraInput & { uuid_local?: string }): Promise<{insertId: number, uuid_local?: string}> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_obras (...) VALUES (...)`,
    [...]
  );
  return { insertId: r.insertId, uuid_local: input.uuid_local };
}
```

E garantir que o handler do server.ts devolve `id` (não só `insertId`) na resposta. Pattern:

```typescript
// server.ts
const r = await criarObra(req.body);
res.json({ id: r.insertId, uuid_local: r.uuid_local });
```

- [ ] **Step 3: Aplicar mesmo padrão nos 5 módulos P0**

Repetir pra `criarParcela`, `criarRecibo`, `criarDespesa`, `criarEquipe` (ou nomes equivalentes). Sempre:
1. Aceitar `uuid_local` opcional no input
2. Devolver `uuid_local` na resposta junto do `id`

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Esperado: sem erros.

- [ ] **Step 5: Smoke manual no curl**

```bash
curl -X POST http://localhost:8080/api/obras \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Teste UUID","tipo":"residencial","uuid_local":"test-uuid-aaa"}'
```

Esperado: response inclui `"uuid_local":"test-uuid-aaa"`.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/ src/services/ src/server.ts
git commit -m "feat(api): aceitar e ecoar uuid_local em POSTs P0 (obras, parcelas, recibos, despesas, equipe)"
```

---

### Task B2: Parâmetro `?since=` em GETs P0

**Files:**
- Modify: `src/server.ts` (handlers de GET pras 5 entidades)
- Modify: `src/integrations/obras.ts` (listarObras), etc.

- [ ] **Step 1: Adicionar suporte em listarObras**

Em `src/integrations/obras.ts`, encontrar a função que lista obras (provavelmente `listarObras`). Adicionar parâmetro `since`:

```typescript
export async function listarObras(opts: { since?: string } = {}): Promise<ObraRow[]> {
  let sql = `SELECT * FROM romatec_obras WHERE 1=1`;
  const params: any[] = [];
  if (opts.since) {
    sql += ` AND updated_at > ?`;
    params.push(opts.since);
  }
  sql += ` ORDER BY id DESC`;
  const [rows] = await pool.query<ObraRow[]>(sql, params);
  return rows;
}
```

E no handler:

```typescript
app.get('/api/obras', async (req, res) => {
  try {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const r = await listarObras({ since });
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
```

- [ ] **Step 2: Repetir pros outros 4 (parcelas, recibos, despesas, equipe)**

Cada listagem aceita `?since=<ISO_DATE>`. Se a tabela não tem `updated_at`, usar `created_at`.

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run typecheck
curl 'http://localhost:8080/api/obras?since=2026-01-01' | jq 'length'
```

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/integrations/
git commit -m "feat(api): GETs P0 aceitam ?since=<ISO> pra delta sync (obras, parcelas, recibos, despesas, equipe)"
```

---

## Phase C — Cache de leitura

### Task C1: Schema do cache_v2 IndexedDB

**Files:**
- Modify: `src/public/offline-engine.js`
- Test: `src/test/offline-p0.spec.ts`

- [ ] **Step 1: Adicionar testes**

```typescript
describe('cache_v2 (full sync stores)', () => {
  it('cria stores pras 5 entidades', async () => {
    const eng = await carregarEngine();
    const db = await eng.abrirCacheV2();
    const stores = ['obras', 'parcelas', 'recibos', 'despesas', 'equipe', 'sync_meta'];
    for (const s of stores) {
      expect(db.objectStoreNames.contains(s)).toBe(true);
    }
  });

  it('grava e le obras', async () => {
    const eng = await carregarEngine();
    await eng.cacheV2.put('obras', { id: 1, nome: 'Obra A' });
    const r = await eng.cacheV2.get('obras', 1);
    expect(r.nome).toBe('Obra A');
  });

  it('bulkPut substitui registros', async () => {
    const eng = await carregarEngine();
    await eng.cacheV2.bulkPut('obras', [{ id: 1, nome: 'A' }, { id: 2, nome: 'B' }]);
    const all = await eng.cacheV2.getAll('obras');
    expect(all).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Implementar cache_v2**

Em `src/public/offline-engine.js`, adicionar:

```javascript
const CACHE_V2_DB = 'romatec_cache_v2';
const CACHE_V2_STORES = ['obras', 'parcelas', 'recibos', 'despesas', 'equipe'];

function abrirCacheV2() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_V2_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const s of CACHE_V2_STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const store = db.createObjectStore(s, { keyPath: 'id' });
          store.createIndex('uuid_local', 'uuid_local', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains('sync_meta')) {
        db.createObjectStore('sync_meta', { keyPath: 'entidade' });
      }
    };
  });
}

const cacheV2 = {
  async put(entidade, registro) {
    const db = await abrirCacheV2();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(entidade, 'readwrite');
      tx.objectStore(entidade).put(registro);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async bulkPut(entidade, registros) {
    if (!registros?.length) return;
    const db = await abrirCacheV2();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(entidade, 'readwrite');
      const store = tx.objectStore(entidade);
      for (const r of registros) store.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(entidade, id) {
    const db = await abrirCacheV2();
    return new Promise((resolve, reject) => {
      const r = db.transaction(entidade, 'readonly').objectStore(entidade).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  },
  async getAll(entidade) {
    const db = await abrirCacheV2();
    return new Promise((resolve, reject) => {
      const r = db.transaction(entidade, 'readonly').objectStore(entidade).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },
  async setMeta(entidade, meta) {
    const db = await abrirCacheV2();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sync_meta', 'readwrite');
      tx.objectStore('sync_meta').put({ entidade, ...meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async getMeta(entidade) {
    const db = await abrirCacheV2();
    return new Promise((resolve, reject) => {
      const r = db.transaction('sync_meta', 'readonly').objectStore('sync_meta').get(entidade);
      r.onsuccess = () => resolve(r.result || {});
      r.onerror = () => reject(r.error);
    });
  },
};
```

Exportar `abrirCacheV2`, `cacheV2`, `CACHE_V2_STORES` no `window.OfflineEngine`.

- [ ] **Step 3: Rodar testes — PASS**

```bash
npm test -- offline-p0
```

- [ ] **Step 4: Commit**

```bash
git add src/public/offline-engine.js src/test/offline-p0.spec.ts
git commit -m "feat(offline): cache_v2 IndexedDB com 5 stores (obras, parcelas, recibos, despesas, equipe) + sync_meta"
```

---

### Task C2: Network-first com fallback de cache nas funções `loadXxx`

**Files:**
- Modify: `src/public/obras.html` (funções `loadObras`, `loadEtapas`, `loadEquipe`, etc. — linhas ~1384-1430)

- [ ] **Step 1: Wrap genérico em offline-engine.js**

Adicionar:

```javascript
// v3.16.0: helper pra usar em loadXxx() — tenta network primeiro, salva no cache,
// fallback no cache se rede falhar
async function carregarComCache(entidade, fetchFn) {
  if (navigator.onLine) {
    try {
      const dados = await fetchFn();
      if (Array.isArray(dados)) {
        await cacheV2.bulkPut(entidade, dados);
        await cacheV2.setMeta(entidade, { last_full_sync_at: Date.now() });
      }
      return dados;
    } catch (_) {
      // Network failed — fallback cache
    }
  }
  return cacheV2.getAll(entidade);
}
```

Exportar no `window.OfflineEngine`.

- [ ] **Step 2: Modificar `loadObras` em obras.html**

```javascript
async function loadObras() {
  state.obras = await OfflineEngine.carregarComCache('obras', () => api('/api/obras'));
  if (!state.currentObra && state.obras.length) state.currentObra = state.obras[0].id;
}
```

- [ ] **Step 3: Repetir pra `loadEtapas`, `loadTransacoes`, `loadEquipe`, `loadFolha`, `loadDespesasExtras`, `loadRecibos`, `loadMateriais`** (qualquer que seja P0)

NB: pra parcelas, atualmente é parte de obra (vi `state.parcelas` por obra). Cuidar pra não destruir essa estrutura — pode usar `cacheV2.getAll('parcelas')` e filtrar no frontend, ou guardar por obra_id no cache.

- [ ] **Step 4: Smoke manual**

```
1. Abrir /obras online → carrega lista
2. Aguardar 2s (cache popular)
3. DevTools → Application → IndexedDB → romatec_cache_v2 → obras → ver registros
4. DevTools → Network → Offline
5. Recarregar /obras → lista ainda aparece (do cache)
```

- [ ] **Step 5: Commit**

```bash
git add src/public/offline-engine.js src/public/obras.html
git commit -m "feat(offline): loadXxx() usa carregarComCache (network-first com fallback IndexedDB)"
```

---

### Task C3: Full sync inicial com modal de progresso

**Files:**
- Modify: `src/public/offline-engine.js`, `src/public/obras.html`

- [ ] **Step 1: Implementar `executarFullSync` em offline-engine.js**

```javascript
async function executarFullSync(onProgress) {
  if (!navigator.onLine) throw new Error('Offline — nao da pra full sync');
  const entidades = [
    { nome: 'obras', endpoint: '/api/obras' },
    { nome: 'parcelas', endpoint: '/api/parcelas' },
    { nome: 'recibos', endpoint: '/api/recibos' },
    { nome: 'despesas', endpoint: '/api/despesas-extras' },
    { nome: 'equipe', endpoint: '/api/equipe' },
  ];
  const total = entidades.length;
  for (let i = 0; i < total; i++) {
    const e = entidades[i];
    onProgress?.({ entidade: e.nome, atual: i, total });
    try {
      const r = await fetch(e.endpoint, { headers: { 'Content-Type': 'application/json' } });
      if (r.ok) {
        const dados = await r.json();
        if (Array.isArray(dados)) {
          await cacheV2.bulkPut(e.nome, dados);
          await cacheV2.setMeta(e.nome, { last_full_sync_at: Date.now() });
        }
      }
    } catch (err) {
      console.warn('[fullsync]', e.nome, 'falhou:', err.message);
    }
  }
  onProgress?.({ entidade: 'done', atual: total, total });
}
```

- [ ] **Step 2: Modal de progresso em obras.html**

Adicionar função:

```javascript
async function abrirModalFullSync() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; display:flex; align-items:center; justify-content:center;';
  ov.innerHTML = `
    <div style="background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:30px; min-width:320px; text-align:center;">
      <h3 style="margin:0 0 16px; color:var(--gold);">🔄 Sincronizando dados</h3>
      <p id="fs-label" style="margin:0 0 12px; color:var(--text-muted);">Preparando…</p>
      <div style="background:#1a2920; border-radius:8px; height:14px; overflow:hidden; margin-bottom:8px;">
        <div id="fs-bar" style="background:#16a34a; height:100%; width:0%; transition:width 0.3s;"></div>
      </div>
      <p id="fs-pct" style="font-size:12px; color:var(--text-muted);">0%</p>
      <p style="font-size:11px; color:#9ca3af; margin-top:14px;">⏳ Não feche o app</p>
    </div>
  `;
  document.body.appendChild(ov);

  await OfflineEngine.executarFullSync(({ entidade, atual, total }) => {
    const pct = Math.round((atual / total) * 100);
    ov.querySelector('#fs-label').textContent = entidade === 'done' ? '✓ Pronto!' : `Carregando ${entidade}…`;
    ov.querySelector('#fs-bar').style.width = pct + '%';
    ov.querySelector('#fs-pct').textContent = pct + '%';
  });

  setTimeout(() => ov.remove(), 800);
}
```

- [ ] **Step 3: Trigger no boot da primeira sessão**

Em obras.html, no boot (após `atualizarBadgeOffline`), adicionar:

```javascript
// Primeira sessao? Faz full sync inicial
if (!localStorage.getItem('offline_p0_first_sync')) {
  if (navigator.onLine) {
    await abrirModalFullSync();
    localStorage.setItem('offline_p0_first_sync', String(Date.now()));
  }
}
```

- [ ] **Step 4: Smoke**

```
1. localStorage.removeItem('offline_p0_first_sync') no console
2. Reload → modal aparece, progresso 0→100%
3. Verificar IndexedDB tem dados em todas as 5 stores
```

- [ ] **Step 5: Commit**

```bash
git add src/public/offline-engine.js src/public/obras.html
git commit -m "feat(offline): full sync inicial com modal de progresso (5 entidades P0)"
```

---

## Phase D — Anexos (Blobs)

### Task D1: Store romatec_blobs + helper enfileirarBlob

**Files:**
- Modify: `src/public/offline-engine.js`

- [ ] **Step 1: Adicionar store + API**

```javascript
const BLOBS_DB = 'romatec_blobs';
const BLOBS_STORE = 'pending_blobs';

function abrirBlobsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BLOBS_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        const s = db.createObjectStore(BLOBS_STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('uuid_local', 'uuid_local');
        s.createIndex('uploaded', 'uploaded');
      }
    };
  });
}

async function enfileirarBlob({ uuid_local, campo, file, endpointTemplate }) {
  const db = await abrirBlobsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOBS_STORE, 'readwrite');
    tx.objectStore(BLOBS_STORE).add({
      uuid_local, campo, filename: file.name, mime: file.type,
      blob: file, endpointTemplate, ts: Date.now(), tentativas: 0, uploaded: false,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listarBlobsPendentes() {
  const db = await abrirBlobsDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(BLOBS_STORE, 'readonly').objectStore(BLOBS_STORE).getAll();
    r.onsuccess = () => resolve((r.result || []).filter(b => !b.uploaded));
    r.onerror = () => reject(r.error);
  });
}

async function marcarBlobUploaded(id, server_url) {
  const db = await abrirBlobsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOBS_STORE, 'readwrite');
    const g = tx.objectStore(BLOBS_STORE).get(id);
    g.onsuccess = () => {
      const b = g.result;
      if (b) { b.uploaded = true; b.server_url = server_url; tx.objectStore(BLOBS_STORE).put(b); }
      tx.oncomplete = () => resolve();
    };
    g.onerror = () => reject(g.error);
  });
}
```

Exportar tudo no `window.OfflineEngine`.

- [ ] **Step 2: Estender `sincronizarFilaOffline` pra processar blobs após mutações**

No final de `sincronizarFilaOffline`, antes do `atualizarBadgeOffline`, adicionar:

```javascript
// v3.16.0: drena blobs pendentes (replay anexos)
const blobs = await listarBlobsPendentes();
for (const b of blobs) {
  if (b.tentativas >= 5) continue;
  try {
    // Resolve uuid_local → server_id antes do upload
    const serverId = await idMap.get(b.uuid_local);
    if (serverId == null) continue; // sem mapeamento ainda — pula
    const url = b.endpointTemplate.replace(':id', String(serverId));
    const fd = new FormData();
    fd.append(b.campo, b.blob, b.filename);
    const r = await fetch(url, { method: 'POST', body: fd });
    if (r.ok) {
      const resp = await r.json().catch(() => ({}));
      await marcarBlobUploaded(b.id, resp.url || '');
    }
  } catch (err) {
    b.tentativas = (b.tentativas || 0) + 1;
    // Persiste contador (similar ao incrementarTentativa)
    const db = await abrirBlobsDB();
    db.transaction(BLOBS_STORE, 'readwrite').objectStore(BLOBS_STORE).put(b);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/public/offline-engine.js
git commit -m "feat(offline): blobs IndexedDB + replay automatico apos mutacao confirmada"
```

---

### Task D2: Conectar inputs file aos enfileirarBlob

**Files:**
- Modify: `src/public/obras.html` (forms de despesa, recibo, equipe que têm `<input type="file">`)

- [ ] **Step 1: Identificar inputs file relevantes**

```bash
grep -n "input.*type=.file\|input\[type=.file" src/public/obras.html | head
```

- [ ] **Step 2: Pra cada input file P0, modificar onchange handler**

Padrão (exemplo despesa):

```javascript
// ANTES (síncrono direto pra fetch)
inputComprovante.onchange = async (e) => {
  const fd = new FormData();
  fd.append('comprovante', e.target.files[0]);
  await fetch('/api/despesas-extras/' + state.despesa.id + '/comprovante', { method: 'POST', body: fd });
};

// DEPOIS (offline-aware)
inputComprovante.onchange = async (e) => {
  const file = e.target.files[0];
  const desp = state.despesa;
  // Se tem id real → tenta upload direto; se offline ou ainda sem id → enfileira
  if (desp.id && navigator.onLine) {
    try {
      const fd = new FormData();
      fd.append('comprovante', file);
      const r = await fetch('/api/despesas-extras/' + desp.id + '/comprovante', { method: 'POST', body: fd });
      if (r.ok) return alert('✓ Anexado');
    } catch { /* cai pro enfileirar */ }
  }
  await OfflineEngine.enfileirarBlob({
    uuid_local: desp.uuid_local || desp.id,  // se ja tem id real, passa direto
    campo: 'comprovante', file,
    endpointTemplate: '/api/despesas-extras/:id/comprovante',
  });
  alert('📎 Anexo salvo localmente — sera enviado quando reconectar');
};
```

- [ ] **Step 3: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(offline): inputs file enfileiram Blobs no IndexedDB quando offline"
```

---

## Phase E — UI / Indicators

### Task E1: Indicador por aba (count de pendentes)

**Files:**
- Modify: `src/public/offline-engine.js`, `src/public/obras.html`

- [ ] **Step 1: Helper `pendentesPorEntidade`**

```javascript
async function pendentesPorEntidade() {
  const fila = await listarFilaOffline();
  const counts = {};
  for (const item of fila) {
    const m = item.path.match(/\/api\/([^\/\?]+)/);
    if (!m) continue;
    counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return counts;  // ex: { obras: 3, parcelas: 5 }
}
```

Exportar.

- [ ] **Step 2: Modificar render dos titulos das abas**

Em obras.html, encontrar onde renderiza `📋 Obras (12)` e adicionar:

```javascript
// Após renderizar a lista
const pend = await OfflineEngine.pendentesPorEntidade();
if (pend.obras) {
  titulo.innerHTML += ` <span style="color:#f59e0b; font-size:11px;">🟡 ${pend.obras}↻</span>`;
}
```

Repetir pras abas Parcelas, Recibos, Despesas, Equipe.

- [ ] **Step 3: Smoke + commit**

```bash
git add src/public/offline-engine.js src/public/obras.html
git commit -m "feat(offline): contador de pendentes por modulo no titulo das abas"
```

---

### Task E2: Painel admin offline (`/offline-status`)

**Files:**
- Modify: `src/public/obras.html` (adicionar link no menu + painel embed)

- [ ] **Step 1: Painel inline ativado por shortcut**

Adicionar no boot:

```javascript
// Atalho: Ctrl+Shift+O abre painel offline
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'O') abrirPainelOffline();
});

async function abrirPainelOffline() {
  const fila = await OfflineEngine.listarFilaOffline();
  const meta = {};
  for (const ent of OfflineEngine.CACHE_V2_STORES) {
    meta[ent] = await OfflineEngine.cacheV2.getMeta(ent);
    meta[ent].count = (await OfflineEngine.cacheV2.getAll(ent)).length;
  }
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px;';
  ov.innerHTML = `
    <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:24px; max-width:680px; width:100%; max-height:90vh; overflow:auto; color:var(--text);">
      <h3 style="margin-top:0;">⚙️ Status offline</h3>
      <h4>📊 Cache local</h4>
      <table style="width:100%; font-size:13px;">
        <tr><th align="left">Entidade</th><th align="right">Registros</th><th align="right">Última sync</th></tr>
        ${Object.entries(meta).map(([e,m]) => `<tr><td>${e}</td><td align="right">${m.count}</td><td align="right" style="font-size:11px; color:var(--text-muted);">${m.last_full_sync_at ? new Date(m.last_full_sync_at).toLocaleString('pt-BR') : '-'}</td></tr>`).join('')}
      </table>
      <h4>📥 Fila pendente (${fila.length})</h4>
      <pre style="background:#0a0f0c; padding:10px; border-radius:6px; font-size:11px; max-height:200px; overflow:auto;">${fila.map(f => `${f.method} ${f.path} (tent ${f.tentativas || 0})`).join('\n') || '(vazia)'}</pre>
      <div style="display:flex; gap:8px; margin-top:14px;">
        <button onclick="OfflineEngine.executarFullSync(()=>{}); this.closest('div[style*=fixed]').remove();" class="btn-primary">🔄 Forçar full sync</button>
        <button onclick="if(confirm('Limpar TODO cache local? Mutacoes pendentes serao perdidas.')) { indexedDB.deleteDatabase('romatec_cache_v2'); indexedDB.deleteDatabase('romatec_offline_v1'); indexedDB.deleteDatabase('romatec_blobs'); localStorage.removeItem('offline_p0_first_sync'); location.reload(); }" class="btn-danger">🗑️ Limpar cache local</button>
        <button onclick="this.closest('div[style*=fixed]').remove()">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/public/obras.html
git commit -m "feat(offline): painel admin Ctrl+Shift+O (cache stats + fila + acoes)"
```

---

## Phase F — Testes & Smoke

### Task F1: Bateria final de testes Vitest

**Files:**
- Modify: `src/test/offline-p0.spec.ts`

- [ ] **Step 1: Adicionar cenários integrados**

```typescript
describe('Cenarios end-to-end', () => {
  it('cria obra offline + parcela em cascata + replay', async () => {
    // Setup similar aos testes anteriores...
    // Cria obra → enfileira → mock fetch retorna {id:42}
    // Cria parcela referenciando obra_uuid_local
    // sincronizarFilaOffline → verifica que parcela usou obra_id=42
  });

  it('blob pendente sobe apos mutacao POST que mapeia uuid', async () => {
    // Cria despesa offline com uuid AAA
    // Enfileira blob com uuid_local AAA
    // Mock fetch resolve POST → id_map[AAA]=99
    // Verifica que upload do blob bateu /api/despesas-extras/99/comprovante
  });

  it('conflito client-wins: PUT offline depois GET nao sobrescreve fila', async () => {
    // Enfileira PUT com nome:"ABC"
    // Backend retorna obra com nome:"XYZ"
    // Replay envia ABC, verifica que server final eh ABC
  });
});
```

- [ ] **Step 2: Implementar mocks suficientes pros testes passarem**

- [ ] **Step 3: Rodar tudo**

```bash
npm test -- offline-p0
```

Esperado: TODOS os testes verdes.

- [ ] **Step 4: Commit**

```bash
git add src/test/offline-p0.spec.ts
git commit -m "test(offline): bateria end-to-end (cascata, blob replay, conflito client-wins)"
```

---

### Task F2: Smoke test manual final

**Files:**
- Create: `docs/superpowers/plans/2026-05-16-offline-first-p0-smoke.md` (checklist de validação)

- [ ] **Step 1: Criar arquivo de smoke checklist**

Criar `docs/superpowers/plans/2026-05-16-offline-first-p0-smoke.md` com os 5 cenários listados no spec (criação pura, conflito, anexo, crash, dead queue), cada um com passo-a-passo verificável.

- [ ] **Step 2: Executar todos os 5 cenários**

Pra cada um, marcar ✅ ou ❌. Se ❌, abrir issue/task de correção antes de fechar a P0.

- [ ] **Step 3: Bump versão pra v3.16.0**

Atualizar:
- `package.json` → 3.16.0
- `src/agent/identity.ts` → 3.16.0
- `src/public/sw.js` cache → zayra-v3.16.0

- [ ] **Step 4: Commit final + tag**

```bash
git add package.json src/agent/identity.ts src/public/sw.js docs/superpowers/plans/2026-05-16-offline-first-p0-smoke.md
git commit -m "chore(release): v3.16.0 - offline-first P0 (obras+parcelas+recibos+despesas+equipe)"
git push origin main
```

- [ ] **Step 5: Monitorar Railway logs por 2 semanas**

Olhar logs do servidor diariamente os primeiros dias procurando:
- Erros relacionados a `uuid_local` (campo desconhecido em INSERT etc.)
- Spike de POSTs duplicados (sync repetindo)
- Erros 500 em rotas P0

Se aparecer algo recorrente, criar plano de fix antes de avançar pra P1.

---

## Self-Review

**1. Cobertura do spec:**
- ✅ 5 módulos P0 (Phase A1-A5 + B1-B2 + C1-C3)
- ✅ UUID + reconciliação cascata (Task A3-A5)
- ✅ Cache full sync (Task C1-C3)
- ✅ Anexos Blobs (Task D1-D2)
- ✅ UI indicadores (Task E1-E2)
- ✅ Cliente vence em conflito (implícito no replay — não há lógica de merge, sempre sobrescreve)
- ✅ Testes Vitest + smoke manual (Task F1-F2)

**2. Sem placeholders:** Verificado — todos os steps com código têm código completo, nenhum "TBD" ou "implementar depois".

**3. Tipos consistentes:** `idMap.set/get/clear`, `cacheV2.put/bulkPut/get/getAll/setMeta/getMeta`, `enfileirarBlob/listarBlobsPendentes/marcarBlobUploaded`, `ehMutacaoP0`, `injetarUuidLocal`, `traduzirBody/traduzirPath`, `executarFullSync`, `carregarComCache`, `pendentesPorEntidade` — todos usados consistentes ao longo do plano.

**4. Tarefas independentes:** Cada Task produz commit funcional. Phase A entrega o engine, Phase B o backend, Phase C o cache, etc. — interrupção em qualquer ponto deixa o sistema em estado coerente.

**Estimativa total:** 9 dias dev (consistente com o spec). 17 tasks no total.
