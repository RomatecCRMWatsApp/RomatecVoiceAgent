// src/public/offline-engine.js
// Offline-first engine - IndexedDB queue + auto-sync
// Originalmente inline em obras.html, extraido em v3.16.0 pra organizacao
// e pra estender suporte offline pros modulos P0 (obras, parcelas, recibos,
// despesas, equipe) alem dos ja existentes (laudos, galeria).
//
// IMPORTANTE: este script depende de simbolos definidos no <script> inline de
// obras.html (state, getCeoToken, sanitizeHeaderValue, loadLaudoDetalhe,
// renderLaudoEditor, removerLaudoOfflineLocal). Esses sao resolvidos em
// runtime via lookup no escopo de classic-scripts compartilhado, entao a
// ordem de carga e: este arquivo pode ser incluido antes ou depois do bloco
// inline, desde que nenhuma das funcoes daqui execute antes do inline ser
// avaliado. Em pratica chamamos tudo via setTimeout/event listeners.

(function () {
  'use strict';

  // API base: replica do `const API = window.location.origin` em obras.html.
  // Nao acessamos a variavel `API` do inline porque ela e `const` (escopo
  // lexical do classic-script) - apesar de ser tecnicamente acessivel, fica
  // mais robusto reproduzir o calculo aqui.
  function getAPI() {
    if (typeof window.API === 'string') return window.API;
    return window.location.origin;
  }

  // Lookup defensivo de simbolos do inline. Sao funcoes declaradas no top
  // level do inline `<script>`, portanto vao parar em window.
  function getSanitizeHeaderValue() {
    return typeof window.sanitizeHeaderValue === 'function'
      ? window.sanitizeHeaderValue
      : (v) => String(v == null ? '' : v).replace(/[^\x20-\x7E]/g, '').trim();
  }
  function getCeoTokenSafe() {
    return typeof window.getCeoToken === 'function' ? window.getCeoToken() : null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // v2.4.0 OFFLINE-FIRST — IndexedDB queue + auto-sync
  // Escopo: requests de mutação em /api/laudos-demarcacao quando offline.
  // Salva em IndexedDB local; sincroniza ao detectar 'online' event.
  // ──────────────────────────────────────────────────────────────────────
  const OFFLINE_DB_NAME = 'romatec_offline_v1';
  const OFFLINE_STORE = 'pending_requests';
  // v3.16.0 P0 (Task A4): store nova `id_map` (UUID local -> server_id) na
  // MESMA database `romatec_offline_v1` pra simplificar transacoes e backup.
  // Subimos a versao 1 -> 2 e adicionamos o store no onupgradeneeded sem
  // tocar no `pending_requests` ja existente.
  const ID_MAP_STORE = 'id_map';

  function abrirDBOffline() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB nao suportado'));
      const req = indexedDB.open(OFFLINE_DB_NAME, 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
          const store = db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts');
        }
        if (!db.objectStoreNames.contains(ID_MAP_STORE)) {
          db.createObjectStore(ID_MAP_STORE, { keyPath: 'uuid_local' });
        }
      };
    });
  }

  async function enfileirarOffline(req) {
    try {
      const db = await abrirDBOffline();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readwrite');
        const store = tx.objectStore(OFFLINE_STORE);
        const r = store.add({ ...req, ts: Date.now(), tentativas: 0 });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } catch (err) {
      console.error('[offline] enfileirar falhou:', err);
      // Fallback: salva em localStorage (limite menor, mas resiliente)
      try {
        const fila = JSON.parse(localStorage.getItem('romatec_offline_fallback') || '[]');
        fila.push({ ...req, ts: Date.now(), id: Date.now() });
        localStorage.setItem('romatec_offline_fallback', JSON.stringify(fila));
      } catch (_) {}
    }
  }

  async function listarFilaOffline() {
    try {
      const db = await abrirDBOffline();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readonly');
        const store = tx.objectStore(OFFLINE_STORE);
        const r = store.getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    } catch (_) { return []; }
  }

  async function removerDaFila(id) {
    try {
      const db = await abrirDBOffline();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readwrite');
        const store = tx.objectStore(OFFLINE_STORE);
        const r = store.delete(id);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    } catch (_) {}
  }

  async function incrementarTentativa(id, erro) {
    try {
      const db = await abrirDBOffline();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, 'readwrite');
        const store = tx.objectStore(OFFLINE_STORE);
        const g = store.get(id);
        g.onsuccess = () => {
          const item = g.result;
          if (!item) return resolve();
          item.tentativas = (item.tentativas || 0) + 1;
          item.ultimoErro = String(erro || '').slice(0, 200);
          const u = store.put(item);
          u.onsuccess = () => resolve();
          u.onerror = () => reject(u.error);
        };
        g.onerror = () => reject(g.error);
      });
    } catch (_) {}
  }

  // Sync: tenta replay sequencial da fila. Não para na primeira falha — segue
  // pra próxima e mantém na fila pra retry depois. Items com >5 tentativas ficam
  // estagnados (provável bug de payload — usuário precisa intervir).
  async function sincronizarFilaOffline() {
    if (!navigator.onLine) return;
    const fila = await listarFilaOffline();
    if (!fila.length) return;
    console.log('[offline] sincronizando', fila.length, 'requests pendentes');
    let ok = 0, fail = 0;
    for (const item of fila.sort((a,b) => a.ts - b.ts)) {
      if ((item.tentativas || 0) >= 5) { fail++; continue; }
      try {
        // v3.16.0 Task A5: traduz path/body se contem refs a uuid_local.
        // Se uuid no PATH nao tem mapeamento ainda — adia (next replay tenta
        // de novo depois que o POST que cria o mapeamento tiver rodado).
        let pathTrad;
        try { pathTrad = await traduzirPath(item.path); }
        catch (e) {
          console.warn('[offline] adiando', item.id, e.message);
          fail++;
          continue;
        }
        const bodyTrad = await traduzirBody(item.body);

        const url = getAPI() + pathTrad + (pathTrad.includes('?') ? '&' : '?') + '_t=' + Date.now();
        const r = await fetch(url, {
          method: item.method,
          body: bodyTrad,
          headers: bodyTrad
            ? { 'Content-Type': 'application/json', ...(item.headers || {}) }
            : item.headers,
        });
        if (r.ok) {
          // v3.16.0 Task A5: se foi POST com uuid_local, captura id real do
          // server e grava no id_map pra cascata futura (PUT/DELETE
          // subsequentes que referenciem essa entidade).
          if (item.method === 'POST' && bodyTrad) {
            try {
              const reqBody = typeof bodyTrad === 'string' ? JSON.parse(bodyTrad) : bodyTrad;
              const respBody = await r.json();
              if (reqBody?.uuid_local && respBody?.id != null) {
                const entidade = (pathTrad.match(/\/api\/([^\/\?]+)/) || [])[1] || 'unknown';
                await idMap.set(reqBody.uuid_local, entidade, respBody.id);
              }
              // Retro-compat com laudos: remove do cache offline local
              if (item.path === '/api/laudos-demarcacao' && reqBody?.uuid_local) {
                try { window.removerLaudoOfflineLocal?.(reqBody.uuid_local); } catch (_) {}
              }
            } catch (_) {}
          }
          await removerDaFila(item.id);
          ok++;
        }
        else {
          await incrementarTentativa(item.id, `HTTP ${r.status}`);
          fail++;
        }
      } catch (err) {
        await incrementarTentativa(item.id, err.message);
        fail++;
      }
    }
    // v3.16.1 P0 Phase D: drena blobs pendentes (anexos enfileirados offline).
    // Roda APOS o replay das mutacoes — idMap ja tem os mapeamentos de UUID
    // pra server_id, entao endpointTemplate.replace(':id', serverId) resolve.
    let blobsOk = 0, blobsFail = 0;
    try {
      const r = await drenarBlobsPendentes();
      blobsOk = r.ok;
      blobsFail = r.fail;
    } catch (err) {
      console.warn('[offline] drenagem de blobs falhou:', err.message);
    }

    atualizarBadgeOffline();
    if (ok > 0 || blobsOk > 0) {
      const partes = [];
      if (ok > 0) partes.push(`${ok} açõe${ok>1?'s':''}`);
      if (blobsOk > 0) partes.push(`${blobsOk} anexo${blobsOk>1?'s':''}`);
      const totalFail = fail + blobsFail;
      mostrarToastOffline(`✅ ${partes.join(' + ')} sincronizado${(ok+blobsOk)>1?'s':''}${totalFail?` (${totalFail} pendente${totalFail>1?'s':''})`:''}`, 'success');
      // Recarrega laudo atual se aberto
      // state agora vive em window.state (obras.html exporta explicitamente
      // pra escapar do escopo de modulo "const" top-level que nao vaza pra global).
      try {
        const st = window.state || null;
        if (st && st.laudoAtual && typeof loadLaudoDetalhe === 'function') {
          await loadLaudoDetalhe(st.laudoAtual.id);
          if (st.laudosView === 'editor' && typeof renderLaudoEditor === 'function') {
            renderLaudoEditor(document.getElementById('view-laudos'));
          }
        }
      } catch (_) {}
    }
  }

  // Badge floating bottom-left mostrando status online/offline + count de pendentes
  async function atualizarBadgeOffline() {
    const fila = await listarFilaOffline();
    const count = fila.length;
    let el = document.getElementById('offlineBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'offlineBadge';
      el.style.cssText = 'position:fixed; bottom:12px; left:12px; z-index:9999; padding:6px 10px; border-radius:20px; font-size:11px; font-weight:600; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.4); transition:all 0.2s;';
      el.onclick = async () => {
        const itens = await listarFilaOffline();
        if (!itens.length) {
          alert('✅ Nenhuma ação pendente — tudo sincronizado.');
          return;
        }
        const desc = itens.map(i => `• ${i.method} ${i.path}${i.tentativas?` (tent. ${i.tentativas})`:''}${i.ultimoErro?` — ${i.ultimoErro}`:''}`).join('\n');
        const escolha = confirm(`📋 ${itens.length} ações pendentes:\n\n${desc}\n\n[OK] Tentar sincronizar agora\n[Cancelar] Manter na fila`);
        if (escolha) sincronizarFilaOffline();
      };
      document.body.appendChild(el);
    }
    if (!navigator.onLine) {
      el.style.background = '#ef4444';
      el.style.color = '#fff';
      el.textContent = `🔴 OFFLINE${count?' · '+count+' pendente'+(count>1?'s':''):''}`;
      el.style.display = 'block';
    } else if (count > 0) {
      el.style.background = '#f59e0b';
      el.style.color = '#06120a';
      el.textContent = `🟡 ONLINE · ${count} sincronizando…`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none'; // Esconde quando online sem pendentes
    }
    // v3.16.2 P0 (E1): notifica consumidores (obras.html atualiza badges nas abas)
    try { window.dispatchEvent(new CustomEvent('offline-fila-changed', { detail: { count } })); } catch (_) {}
  }

  function mostrarToastOffline(msg, tipo) {
    const t = document.createElement('div');
    const cor = tipo === 'success' ? '#10b981' : '#f59e0b';
    t.style.cssText = `position:fixed; top:80px; left:50%; transform:translateX(-50%); z-index:99999; padding:10px 18px; background:${cor}; color:#06120a; border-radius:6px; font-size:13px; font-weight:600; box-shadow:0 4px 12px rgba(0,0,0,0.4); animation:slideDown 0.3s;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { try { document.body.removeChild(t); } catch(_) {} }, 4000);
  }

  // Listeners: detecta online/offline + auto-sync
  window.addEventListener('online', () => {
    console.log('[offline] reconectado — sincronizando fila');
    mostrarToastOffline('🟢 Online — sincronizando ações pendentes…', 'success');
    setTimeout(sincronizarFilaOffline, 500);
  });
  window.addEventListener('offline', () => {
    console.log('[offline] desconectado — mudando pra modo offline');
    mostrarToastOffline('🔴 Offline — alterações ficam salvas localmente até reconectar', 'warn');
    atualizarBadgeOffline();
  });
  // Boot: badge inicial + sync se já tiver fila pendente do refresh anterior.
  // Antes usavamos setTimeout(1500) — fragil em devices lentos (sync podia
  // disparar antes do DOM montar). DOMContentLoaded garante que body/badge
  // ja estao prontos pra montagem.
  function bootOffline() {
    atualizarBadgeOffline();
    if (navigator.onLine) sincronizarFilaOffline();
    // v3.16.0 P0 (C3): se for a primeira sessao em /obras (PWA recem-instalada
    // ou cache_v2 zerado), dispara full sync com modal. Best-effort — falha
    // nao quebra o boot.
    try {
      const naPaginaObras = /\/obras(\/|$)/i.test(location.pathname);
      const jaSincronizou = localStorage.getItem('offline_p0_first_sync');
      if (naPaginaObras && !jaSincronizou && navigator.onLine) {
        setTimeout(() => abrirModalFullSync().catch(() => {}), 1200);
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootOffline);
  } else {
    bootOffline();
  }

  // v3.16.0 P0: predicate de mutacao offline-eligivel — generaliza ehMutacaoLaudo
  // pros 5 modulos do P0 (obras, parcelas, recibos, despesas-extras, equipe) +
  // mantem laudos-demarcacao/galeria que ja funcionavam. Modulos fora do P0
  // (vistorias, etc.) continuam exigindo rede e nao sao enfileirados.
  function ehMutacaoP0(method, path) {
    method = String(method || '').toUpperCase();
    if (!['POST','PUT','DELETE'].includes(method)) return false;
    return /^\/api\/(obras|parcelas|recibos|despesas-extras|equipe|laudos-demarcacao|galeria)(?:[\/\?]|$)/.test(path);
  }

  // v3.16.0 P0: gera UUID v4 (RFC 4122). crypto.randomUUID em browsers modernos,
  // fallback manual pra Safari < 15.4
  function gerarUuidLocal() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // v3.16.0 P0: injeta uuid_local em body de POST P0 (se ainda nao tem).
  // Aceita body como objeto OU string JSON. Devolve no mesmo formato recebido.
  function injetarUuidLocal(method, path, body) {
    if (body == null) return body;
    if (!ehMutacaoP0(method, path)) return body;
    if (String(method).toUpperCase() !== 'POST') return body;
    let obj = body;
    let eraString = false;
    if (typeof body === 'string') {
      try { obj = JSON.parse(body); eraString = true; }
      catch { return body; }
    }
    if (!obj || typeof obj !== 'object') return body;
    if (obj.uuid_local) return body;
    obj.uuid_local = gerarUuidLocal();
    return eraString ? JSON.stringify(obj) : obj;
  }

  async function api(path, opts={}) {
    // Cache-busting via query param só em GET (Safari iOS engasga com cache:'no-store' + Content-Type)
    const method = (opts.method || 'GET').toUpperCase();
    let url = getAPI() + path;
    if (method === 'GET') {
      url += (path.includes('?') ? '&' : '?') + '_t=' + Date.now();
    }
    // Content-Type só quando tem body (evita "The string did not match the expected pattern" no iOS)
    const fetchOpts = { ...opts };
    const baseHeaders = {};
    // v1.99.2: sanitiza todo header de entrada
    const sanitize = getSanitizeHeaderValue();
    for (const [k, v] of Object.entries(opts.headers || {})) {
      const clean = sanitize(v);
      if (clean) baseHeaders[k] = clean;
    }
    // Injeta X-CEO-Token quando existir (servidor exige só pra mutações sensíveis)
    const ceoTok = getCeoTokenSafe();
    if (ceoTok) baseHeaders['X-CEO-Token'] = ceoTok;
    if (opts.body) {
      fetchOpts.headers = { 'Content-Type': 'application/json', ...baseHeaders };
    } else if (Object.keys(baseHeaders).length > 0) {
      fetchOpts.headers = baseHeaders;
    }
    // v3.16.0: injeta uuid_local em POSTs P0 (idempotente). Importante fazer
    // ANTES do fetch — o servidor vai persistir o uuid_local, e se cair offline
    // a fila guarda o mesmo body (com uuid_local) pra retry conseguir dedupe.
    if (opts.body) {
      fetchOpts.body = injetarUuidLocal(method, path, opts.body);
    }
    // v3.16.0 P0 OFFLINE-FIRST: mutacoes em modulos P0 sao enfileiradas se network falhar
    // — criterios delegados pra ehMutacaoP0 (cobre os 5 modulos do P0 + laudos/galeria
    // retro-compat). GET continua sempre online (precisa de dados frescos).
    const ehMutacao = ehMutacaoP0(method, path);
    try {
      const r = await fetch(url, fetchOpts);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erro API');
      return d;
    } catch (err) {
      // Erro de rede (offline ou timeout) — só enfileira se for mutacao P0
      const ehErroRede = err.message?.includes('Failed to fetch')
        || err.message?.includes('NetworkError')
        || err.name === 'TypeError'
        || !navigator.onLine;
      if (ehMutacao && ehErroRede && typeof enfileirarOffline === 'function') {
        // Usa fetchOpts.body (com uuid_local injetado), nao opts.body original
        await enfileirarOffline({ method, path, body: fetchOpts.body, headers: baseHeaders });
        atualizarBadgeOffline();
        return { ok: true, _offline: true, _queued: true };
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // v3.16.1 P0 Phase D: store de Blobs pendentes (anexos offline)
  // ──────────────────────────────────────────────────────────────────────
  // DB separada (romatec_blobs) — blobs binarios sao pesados e idealmente
  // nao competem por transacoes com a fila de mutacoes. Cada blob aponta
  // pra entidade dona via uuid_local (resolvido pelo idMap apos POST) OU
  // diretamente pelo serverId (quando a entidade ja existe online).
  const BLOBS_DB_NAME = 'romatec_blobs';
  const BLOBS_STORE = 'pending_blobs';

  function abrirBlobsDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB nao suportado'));
      const req = indexedDB.open(BLOBS_DB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(BLOBS_STORE)) {
          const s = db.createObjectStore(BLOBS_STORE, { keyPath: 'id', autoIncrement: true });
          s.createIndex('uuid_local', 'uuid_local', { unique: false });
          s.createIndex('uploaded', 'uploaded', { unique: false });
        }
      };
    });
  }

  // Enfileira um anexo pra upload posterior. Aceita:
  // - file: instancia File ou Blob
  // - campo: nome do field multipart (ex: 'arquivo', 'comprovante')
  // - endpointTemplate: path com ':id' que sera substituido pelo server_id
  //   resolvido (via uuid_local no idMap, ou serverId se ja conhecido)
  // - uuid_local: UUID da entidade dona OU null/undefined se serverId
  // - serverId: se entidade ja existe no server (e.g. recibo ja criado),
  //   passa direto e pula a etapa de resolver UUID
  async function enfileirarBlob({ uuid_local, serverId, campo, file, endpointTemplate }) {
    if (!file) throw new Error('file obrigatorio');
    if (!campo) throw new Error('campo obrigatorio');
    if (!endpointTemplate) throw new Error('endpointTemplate obrigatorio');
    if (!uuid_local && serverId == null) {
      throw new Error('uuid_local OU serverId obrigatorio');
    }
    const db = await abrirBlobsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS_STORE, 'readwrite');
      const r = tx.objectStore(BLOBS_STORE).add({
        uuid_local: uuid_local || null,
        server_id: serverId != null ? Number(serverId) : null,
        campo,
        filename: file.name || `${campo}-${Date.now()}`,
        mime: file.type || 'application/octet-stream',
        size: file.size || 0,
        blob: file,
        endpointTemplate,
        ts: Date.now(),
        tentativas: 0,
        uploaded: 0,    // boolean indexable como int (IndexedDB nao indexa boolean)
      });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function listarBlobsPendentes() {
    try {
      const db = await abrirBlobsDB();
      return new Promise((resolve, reject) => {
        const r = db.transaction(BLOBS_STORE, 'readonly').objectStore(BLOBS_STORE).getAll();
        r.onsuccess = () => resolve((r.result || []).filter(b => !b.uploaded));
        r.onerror = () => reject(r.error);
      });
    } catch (_) { return []; }
  }

  async function marcarBlobUploaded(id, serverResp) {
    const db = await abrirBlobsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS_STORE, 'readwrite');
      const store = tx.objectStore(BLOBS_STORE);
      const g = store.get(id);
      g.onsuccess = () => {
        const b = g.result;
        if (b) {
          b.uploaded = 1;
          b.uploaded_at = Date.now();
          b.server_response = serverResp;
          store.put(b);
        }
        tx.oncomplete = () => resolve();
      };
      g.onerror = () => reject(g.error);
    });
  }

  async function incrementarTentativaBlob(id, erro) {
    const db = await abrirBlobsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(BLOBS_STORE, 'readwrite');
      const store = tx.objectStore(BLOBS_STORE);
      const g = store.get(id);
      g.onsuccess = () => {
        const b = g.result;
        if (b) {
          b.tentativas = (b.tentativas || 0) + 1;
          b.ultimoErro = String(erro || '').slice(0, 200);
          store.put(b);
        }
        tx.oncomplete = () => resolve();
      };
      g.onerror = () => reject(g.error);
    });
  }

  async function removerBlob(id) {
    try {
      const db = await abrirBlobsDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(BLOBS_STORE, 'readwrite');
        tx.objectStore(BLOBS_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  // Drena blobs: pra cada pendente, resolve endpoint (uuid_local -> server_id
  // via idMap se necessario), faz POST multipart. Best-effort: erros NAO matam
  // o batch. Skip silencioso se uuid_local ainda nao mapeado (POST que cria a
  // entidade dona pode nao ter rodado ainda no replay).
  async function drenarBlobsPendentes() {
    if (!navigator.onLine) return { ok: 0, fail: 0 };
    const blobs = await listarBlobsPendentes();
    if (!blobs.length) return { ok: 0, fail: 0 };
    console.log('[offline-blobs] drenando', blobs.length, 'anexos pendentes');
    let ok = 0, fail = 0;
    for (const b of blobs) {
      if ((b.tentativas || 0) >= 5) { fail++; continue; }
      try {
        // Resolve serverId — preferencia: explicito > idMap(uuid_local)
        let serverId = b.server_id;
        if (serverId == null && b.uuid_local) {
          serverId = await idMap.get(b.uuid_local);
          if (serverId == null) {
            // POST que cria a entidade ainda nao rodou — pula esta rodada
            console.log('[offline-blobs] adiando blob', b.id, 'uuid_local sem mapeamento ainda');
            fail++;
            continue;
          }
        }
        const url = b.endpointTemplate.replace(':id', String(serverId));
        const fd = new FormData();
        // Reconstroi Blob se o round-trip pelo IndexedDB nao preservou a identidade
        // (acontece em fake-indexeddb e em alguns browsers antigos). FormData.append
        // exige um Blob real no parametro 2.
        let blobToSend = b.blob;
        if (blobToSend && !(blobToSend instanceof Blob)) {
          try { blobToSend = new Blob([blobToSend], { type: b.mime || 'application/octet-stream' }); }
          catch (_) { /* mantem o original se construcao falhar */ }
        }
        fd.append(b.campo, blobToSend, b.filename);
        const r = await fetch(getAPI() + url, { method: 'POST', body: fd });
        if (r.ok) {
          let serverResp = null;
          try { serverResp = await r.json(); } catch (_) {}
          await marcarBlobUploaded(b.id, serverResp);
          ok++;
        } else {
          await incrementarTentativaBlob(b.id, `HTTP ${r.status}`);
          fail++;
        }
      } catch (err) {
        await incrementarTentativaBlob(b.id, err.message);
        fail++;
      }
    }
    return { ok, fail };
  }

  // ──────────────────────────────────────────────────────────────────────
  // v3.16.0 P0 (Task A4): id_map (UUID local -> server_id)
  // ──────────────────────────────────────────────────────────────────────
  // Pequena store IndexedDB que guarda o mapeamento de UUID local (gerado em
  // POSTs offline via `injetarUuidLocal`) pro server_id real devolvido pelo
  // backend quando o replay subiu a entidade. Usado na cascata: PUT/DELETE
  // ou POSTs subsequentes que referenciam a entidade nova (via campo
  // `<entidade>_uuid_local` no body ou `<uuid:XXX>` no path) sao traduzidos
  // pro id real ANTES de serem replayed.
  const idMap = {
    async set(uuid, entidade, serverId) {
      const db = await abrirDBOffline();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(ID_MAP_STORE, 'readwrite');
        tx.objectStore(ID_MAP_STORE).put({
          uuid_local: uuid,
          entidade,
          server_id: serverId,
          mapped_at: Date.now(),
        });
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

  // v3.16.0 P0 (Task A4): traduz body — campos `*_uuid_local` viram `*_id`
  // se houver mapeamento no `idMap`. Se o uuid ainda nao foi mapeado (porque
  // o POST que cria a entidade pai ainda nao rodou), o campo original fica
  // intacto — o caller deve adiar o replay (ver Task A5).
  // Aceita body como string JSON ou objeto. Devolve no mesmo formato.
  async function traduzirBody(body) {
    if (body == null) return body;
    let obj = body;
    let eraString = false;
    if (typeof body === 'string') {
      try { obj = JSON.parse(body); eraString = true; }
      catch { return body; }
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

  // v3.16.2 P0 (E1): conta itens pendentes por entidade extraindo o primeiro
  // segmento de /api/<entidade>. Inclui blobs como sub-tipo da entidade dona.
  // Retorna ex: { obras: 3, parcelas: 5, _blobs: 2 }.
  async function pendentesPorEntidade() {
    const counts = {};
    try {
      const fila = await listarFilaOffline();
      for (const item of fila) {
        const m = (item.path || '').match(/^\/api\/([^\/\?]+)/);
        if (!m) continue;
        // Normaliza nomes (despesas-extras -> despesas pra alinhar com cache_v2)
        let ent = m[1];
        if (ent === 'despesas-extras') ent = 'despesas';
        if (ent === 'laudos-demarcacao') ent = 'laudos';
        counts[ent] = (counts[ent] || 0) + 1;
      }
    } catch (_) {}
    try {
      const blobs = await listarBlobsPendentes();
      if (blobs.length > 0) counts._blobs = blobs.length;
    } catch (_) {}
    return counts;
  }

  // v3.16.0 P0 (Task A4): traduz path — placeholders `<uuid:XXX>` viram o id
  // real do mapeamento. Lanca erro se o uuid nao tem mapeamento ainda — o
  // caller (sincronizarFilaOffline) deve tratar isso pulando o item e tentando
  // de novo no proximo replay (depois que o POST que cria a entidade pai rodar).
  async function traduzirPath(path) {
    const m = /<uuid:([^>]+)>/.exec(path);
    if (!m) return path;
    const id = await idMap.get(m[1]);
    if (id == null) throw new Error('Path com uuid sem mapeamento: ' + m[1]);
    return path.replace(/<uuid:[^>]+>/, String(id));
  }

  // ── v3.16.0 P0 Phase C: cache_v2 IndexedDB ──────────────────────────────────
  // 5 stores (obras/parcelas/recibos/despesas/equipe) + sync_meta. Permite
  // que loadXxx() funcione offline (network-first com fallback do cache) e
  // permite full sync inicial pra puxar tudo de uma vez.
  const CACHE_V2_DB = 'romatec_cache_v2';
  const CACHE_V2_VERSION = 1;
  const CACHE_V2_STORES = ['obras', 'parcelas', 'recibos', 'despesas', 'equipe'];

  function abrirCacheV2() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CACHE_V2_DB, CACHE_V2_VERSION);
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

  // Promise wrapper genérico pra IDBRequest
  function ipromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const cacheV2 = {
    async put(entidade, registro) {
      if (!registro || registro.id == null) return;
      const db = await abrirCacheV2();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(entidade, 'readwrite');
        tx.objectStore(entidade).put(registro);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async bulkPut(entidade, registros) {
      if (!Array.isArray(registros) || registros.length === 0) return;
      const db = await abrirCacheV2();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(entidade, 'readwrite');
        const store = tx.objectStore(entidade);
        for (const r of registros) {
          if (r && r.id != null) store.put(r);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async get(entidade, id) {
      const db = await abrirCacheV2();
      const tx = db.transaction(entidade, 'readonly');
      return ipromise(tx.objectStore(entidade).get(id));
    },
    async getAll(entidade) {
      const db = await abrirCacheV2();
      const tx = db.transaction(entidade, 'readonly');
      const res = await ipromise(tx.objectStore(entidade).getAll());
      return res || [];
    },
    async clear(entidade) {
      const db = await abrirCacheV2();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(entidade, 'readwrite');
        tx.objectStore(entidade).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
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
      const tx = db.transaction('sync_meta', 'readonly');
      const r = await ipromise(tx.objectStore('sync_meta').get(entidade));
      return r || {};
    },
  };

  // v3.16.0 (C2): network-first com fallback de cache pras loadXxx().
  // - Tenta o fetch online primeiro
  // - Se vier array, salva no cache e atualiza sync_meta
  // - Se rede falhar (ou navegador estiver offline), retorna cache.getAll(entidade)
  // - Se nao temos cache nem rede, retorna []
  async function carregarComCache(entidade, fetchFn) {
    if (navigator.onLine !== false) {
      try {
        const dados = await fetchFn();
        if (Array.isArray(dados)) {
          // Substitui o cache inteiro pra evitar "fantasmas" de registros apagados.
          // Cuidado: usuario que apenas filtrou no front nao deveria chamar
          // carregarComCache — eh pra full sync da entidade.
          await cacheV2.clear(entidade).catch(() => {});
          await cacheV2.bulkPut(entidade, dados);
          await cacheV2.setMeta(entidade, { last_full_sync_at: Date.now(), count: dados.length });
        }
        return dados;
      } catch (err) {
        console.warn('[carregarComCache]', entidade, 'fetch falhou, usando cache:', err.message);
      }
    }
    return cacheV2.getAll(entidade);
  }

  // v3.16.0 (C3): modal de progresso do full sync — overlay fullscreen com
  // barra que enche de 0 a 100. Best-effort: se o usuario fechar a aba no meio,
  // o que ja foi populado fica no cache (parcial — proxima abertura completa).
  async function abrirModalFullSync() {
    if (document.getElementById('full-sync-modal')) return;
    const ov = document.createElement('div');
    ov.id = 'full-sync-modal';
    ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; display:flex; align-items:center; justify-content:center; font-family:Segoe UI,sans-serif;';
    ov.innerHTML = `
      <div style="background:#0f1a14; border:1px solid #2d4a3a; border-radius:12px; padding:28px; min-width:320px; max-width:90vw; text-align:center;">
        <h3 style="margin:0 0 14px; color:#facc15;">Sincronizando dados</h3>
        <p id="fs-label" style="margin:0 0 12px; color:#9ca3af; font-size:13px;">Preparando...</p>
        <div style="background:#1a2920; border-radius:8px; height:14px; overflow:hidden; margin-bottom:8px;">
          <div id="fs-bar" style="background:#16a34a; height:100%; width:0%; transition:width 0.3s;"></div>
        </div>
        <p id="fs-pct" style="font-size:12px; color:#9ca3af;">0%</p>
        <p style="font-size:11px; color:#9ca3af; margin-top:14px;">Nao feche o app ate concluir.</p>
      </div>`;
    document.body.appendChild(ov);
    try {
      const r = await executarFullSync(({ entidade, atual, total }) => {
        const pct = Math.round((atual / total) * 100);
        const lbl = entidade === 'done' ? 'Concluido!' : 'Carregando ' + entidade + '...';
        const elLabel = ov.querySelector('#fs-label');
        const elBar = ov.querySelector('#fs-bar');
        const elPct = ov.querySelector('#fs-pct');
        if (elLabel) elLabel.textContent = lbl;
        if (elBar) elBar.style.width = pct + '%';
        if (elPct) elPct.textContent = pct + '%';
      });
      localStorage.setItem('offline_p0_first_sync', String(Date.now()));
      // Se houver falhas, mantem modal aberto 1.5s com aviso
      if (r.falha > 0) {
        const elLabel = ov.querySelector('#fs-label');
        if (elLabel) elLabel.textContent = r.falha + ' entidade(s) falharam — confira a conexao.';
        setTimeout(() => ov.remove(), 1800);
      } else {
        setTimeout(() => ov.remove(), 600);
      }
      return r;
    } catch (err) {
      const elLabel = ov.querySelector('#fs-label');
      if (elLabel) elLabel.textContent = 'Erro: ' + err.message;
      setTimeout(() => ov.remove(), 1500);
      throw err;
    }
  }

  // v3.16.0 (C3): full sync inicial — itera todas as 5 entidades P0 e popula cache.
  // onProgress recebe { entidade, atual, total } a cada passo.
  // Best-effort: erros individuais nao matam o batch, so registram no console.
  async function executarFullSync(onProgress) {
    if (navigator.onLine === false) throw new Error('Offline — full sync exige rede');
    const entidades = [
      { nome: 'obras',    endpoint: '/api/obras' },
      { nome: 'parcelas', endpoint: '/api/parcelas' },
      { nome: 'recibos',  endpoint: '/api/recibos' },
      { nome: 'despesas', endpoint: '/api/despesas-extras' },
      { nome: 'equipe',   endpoint: '/api/equipe' },
    ];
    const total = entidades.length;
    const resultado = { total, sucesso: 0, falha: 0, erros: [] };
    for (let i = 0; i < total; i++) {
      const e = entidades[i];
      if (typeof onProgress === 'function') onProgress({ entidade: e.nome, atual: i, total });
      try {
        const r = await fetch(e.endpoint, { headers: { 'Content-Type': 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        // Alguns endpoints (ex: /api/despesas-extras) podem retornar {items: [...]}
        // ou direto o array. Aceita ambos.
        let arr;
        if (Array.isArray(body)) arr = body;
        else if (Array.isArray(body?.items)) arr = body.items;
        else throw new Error('Resposta nao eh array');
        await cacheV2.clear(e.nome).catch(() => {});
        await cacheV2.bulkPut(e.nome, arr);
        await cacheV2.setMeta(e.nome, { last_full_sync_at: Date.now(), count: arr.length });
        resultado.sucesso++;
      } catch (err) {
        resultado.falha++;
        resultado.erros.push({ entidade: e.nome, motivo: err.message });
        console.warn('[fullsync]', e.nome, 'falhou:', err.message);
      }
    }
    if (typeof onProgress === 'function') onProgress({ entidade: 'done', atual: total, total });
    return resultado;
  }

  // Expoe a API:
  window.api = api; // CRITICO: obras.html chama api() em centenas de lugares
  // v3.17.2: obras.html chama mostrarToastOffline() direto (sem prefixo) em 12 lugares.
  // Sem isto, qualquer fluxo que dispara toast (sync de fotos, parse RTK, copiar
  // memorial, etc.) quebra com ReferenceError e aborta a operacao.
  window.mostrarToastOffline = mostrarToastOffline;
  window.OfflineEngine = {
    api,
    ehMutacaoP0,
    gerarUuidLocal,
    injetarUuidLocal,
    enfileirarOffline,
    listarFilaOffline,
    removerDaFila,
    sincronizarFilaOffline,
    atualizarBadgeOffline,
    mostrarToastOffline,
    // v3.16.0 P0 Task A4
    idMap,
    traduzirBody,
    traduzirPath,
    // v3.16.0 P0 Phase C — cache de leitura
    abrirCacheV2,
    cacheV2,
    CACHE_V2_STORES,
    carregarComCache,
    executarFullSync,
    abrirModalFullSync,
    // v3.16.1 P0 Phase D — blobs (anexos offline)
    enfileirarBlob,
    listarBlobsPendentes,
    drenarBlobsPendentes,
    removerBlob,
    // v3.16.2 P0 Phase E — indicators
    pendentesPorEntidade,
  };
})();
