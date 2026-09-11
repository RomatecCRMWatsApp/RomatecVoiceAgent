/* v3.138.0 — Utilitários de foto compartilhados (VTO / Galeria / Relatório).
 * - Salvar no dispositivo (1 toque): o navegador NÃO permite salvar direto na
 *   galeria de forma silenciosa; o máximo é acionar o download (no iPhone abre
 *   "Salvar em Fotos/Arquivos", no Android baixa direto).
 * - Purga de armazenamento temporário por idade (evita acumular → travar).
 */
(function () {
  'use strict';

  function _extPorMime(mime) {
    if (/png/i.test(mime)) return 'png';
    if (/webp/i.test(mime)) return 'webp';
    if (/pdf/i.test(mime)) return 'pdf';
    return 'jpg';
  }

  // Baixa 1 arquivo (base64) pro dispositivo. b64 sem o prefixo data:.
  function baixar(b64, mime, filename) {
    try {
      if (!b64) return false;
      mime = mime || 'image/jpeg';
      var nome = filename || ('foto-' + Date.now() + '.' + _extPorMime(mime));
      var a = document.createElement('a');
      a.href = 'data:' + mime + ';base64,' + b64;
      a.download = nome;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); }, 500);
      return true;
    } catch (e) {
      console.warn('[foto-utils] baixar falhou:', e && e.message);
      return false;
    }
  }

  // Baixa várias em sequência (espaça pra o navegador não bloquear o lote).
  // fotos: [{ b64|data_base64, mime|mimetype, filename? }]
  async function baixarVarias(fotos, prefixo) {
    if (!Array.isArray(fotos) || !fotos.length) return 0;
    var n = 0;
    for (var i = 0; i < fotos.length; i++) {
      var f = fotos[i] || {};
      var b64 = f.b64 || f.data_base64;
      var mime = f.mime || f.mimetype || 'image/jpeg';
      if (!b64) continue;
      var nome = f.filename || ((prefixo || 'foto') + '-' + String(i + 1).padStart(2, '0') + '.' + _extPorMime(mime));
      if (baixar(b64, mime, nome)) n++;
      await new Promise(function (r) { setTimeout(r, 350); });
    }
    return n;
  }

  // Purga entradas antigas de um objectStore de IndexedDB cujo VALOR guarde `ts`
  // (epoch ms). Retorna quantas apagou. Silencioso em erro.
  async function purgarIdbPorIdade(dbName, storeName, maxDias) {
    var limite = maxDias * 24 * 60 * 60 * 1000;
    try {
      if (!window.indexedDB) return 0;
      var db = await new Promise(function (res, rej) {
        var rq = indexedDB.open(dbName);
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
      if (!db.objectStoreNames.contains(storeName)) { db.close(); return 0; }
      var agora = (typeof performance !== 'undefined' && Date.now) ? Date.now() : new Date().getTime();
      var apagadas = await new Promise(function (res) {
        var tx = db.transaction(storeName, 'readwrite');
        var st = tx.objectStore(storeName);
        var cnt = 0;
        var cur = st.openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) { res(cnt); return; }
          var v = c.value;
          var ts = v && (v.ts || v.timestamp);
          if (ts && (agora - ts) > limite) { c.delete(); cnt++; }
          c.continue();
        };
        cur.onerror = function () { res(cnt); };
      });
      db.close();
      return apagadas;
    } catch (e) {
      console.warn('[foto-utils] purga IDB falhou:', e && e.message);
      return 0;
    }
  }

  window.FotoUtils = { baixar: baixar, baixarVarias: baixarVarias, purgarIdbPorIdade: purgarIdbPorIdade };
})();
