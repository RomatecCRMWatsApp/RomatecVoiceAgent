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

  function abrirDBOffline() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB nao suportado'));
      const req = indexedDB.open(OFFLINE_DB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
          const store = db.createObjectStore(OFFLINE_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts');
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
        const url = getAPI() + item.path + (item.path.includes('?') ? '&' : '?') + '_t=' + Date.now();
        const r = await fetch(url, {
          method: item.method,
          body: item.body,
          headers: item.body
            ? { 'Content-Type': 'application/json', ...(item.headers || {}) }
            : item.headers,
        });
        if (r.ok) {
          // v2.4.2: se foi POST /api/laudos-demarcacao (criação), remove do cache offline local
          if (item.method === 'POST' && item.path === '/api/laudos-demarcacao' && item.body) {
            try {
              const body = JSON.parse(item.body);
              if (body.uuid_local && typeof window.removerLaudoOfflineLocal === 'function') {
                window.removerLaudoOfflineLocal(body.uuid_local);
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
    atualizarBadgeOffline();
    if (ok > 0) {
      mostrarToastOffline(`✅ ${ok} ações sincronizadas${fail?` (${fail} pendentes)`:''}`, 'success');
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
    if (!['POST','PUT','DELETE'].includes(method)) return false;
    return /\/api\/(obras|parcelas|recibos|despesas-extras|equipe|laudos-demarcacao|galeria)(?:[\/\?]|$)/.test(path);
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
    // v2.4.0 OFFLINE-FIRST: requests de mutação podem ser enfileiradas se a rede
    // falhar. v3.16.0 P0: criterios delegados pra ehMutacaoP0 — cobre os 5
    // modulos do P0 + laudos/galeria (retro-compat). GET continua sempre online
    // (precisa de dados frescos).
    const ehMutacao = ehMutacaoP0(method, path);
    try {
      const r = await fetch(url, fetchOpts);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erro API');
      return d;
    } catch (err) {
      // Erro de rede (offline ou timeout) — só enfileira se for laudo
      const ehErroRede = err.message?.includes('Failed to fetch')
        || err.message?.includes('NetworkError')
        || err.name === 'TypeError'
        || !navigator.onLine;
      if (ehMutacao && ehErroRede && typeof enfileirarOffline === 'function') {
        await enfileirarOffline({ method, path, body: opts.body, headers: baseHeaders });
        atualizarBadgeOffline();
        return { ok: true, _offline: true, _queued: true };
      }
      throw err;
    }
  }

  // Expoe a API:
  window.api = api; // CRITICO: obras.html chama api() em centenas de lugares
  window.OfflineEngine = {
    api,
    ehMutacaoP0,
    enfileirarOffline,
    listarFilaOffline,
    removerDaFila,
    sincronizarFilaOffline,
    atualizarBadgeOffline,
    mostrarToastOffline,
  };
})();
