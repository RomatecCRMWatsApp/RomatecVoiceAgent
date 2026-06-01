// v3.52.0 — VTA Vinculo: helper compartilhado pelas telas VTA (Canvas e
// Relatorio Fotografico) para vincular o registro a um Laudo ou Proposta via
// query string (?laudo_id=123 / ?proposta_id=45).
//
// Puro e isomorfico: exporta em window.VtaVinculo (browser) e module.exports
// (vitest/node). Sem dependencias.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VtaVinculo = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Converte para inteiro positivo ou null (descarta 0, negativos, NaN, lixo).
  function intPos(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!/^[0-9]+$/.test(s)) return null;
    var n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Le o vinculo da query string. Aceita string ("?a=1&b=2"), URLSearchParams,
  // ou objeto {laudo_id, proposta_id}. Retorna sempre {laudo_id, proposta_id}.
  function lerVinculo(search) {
    var laudo = null, proposta = null;
    if (search == null) search = (typeof location !== 'undefined' ? location.search : '');
    if (typeof URLSearchParams !== 'undefined' && (typeof search === 'string' || search instanceof URLSearchParams)) {
      var p = search instanceof URLSearchParams ? search : new URLSearchParams(String(search));
      laudo = intPos(p.get('laudo_id'));
      proposta = intPos(p.get('proposta_id'));
    } else if (typeof search === 'object') {
      laudo = intPos(search.laudo_id);
      proposta = intPos(search.proposta_id);
    }
    return { laudo_id: laudo, proposta_id: proposta };
  }

  // Mescla o vinculo num payload de criacao (POST). Nao muta o original.
  // So injeta a chave quando ha valor (evita sobrescrever com null).
  function aplicarVinculo(payload, ctx) {
    var out = {};
    payload = payload || {};
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) out[k] = payload[k];
    ctx = ctx || {};
    if (ctx.laudo_id != null) out.laudo_id = ctx.laudo_id;
    if (ctx.proposta_id != null) out.proposta_id = ctx.proposta_id;
    return out;
  }

  // Monta uma URL (base) com o vinculo como query string.
  function urlComVinculo(base, ctx) {
    ctx = ctx || {};
    var qs = [];
    if (ctx.laudo_id != null) qs.push('laudo_id=' + encodeURIComponent(ctx.laudo_id));
    if (ctx.proposta_id != null) qs.push('proposta_id=' + encodeURIComponent(ctx.proposta_id));
    if (!qs.length) return base;
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + qs.join('&');
  }

  // Verdadeiro se ha algum vinculo.
  function temVinculo(ctx) {
    return !!(ctx && (ctx.laudo_id != null || ctx.proposta_id != null));
  }

  // Texto curto pra badge na UI.
  function textoBadge(ctx) {
    if (!temVinculo(ctx)) return 'Sem vínculo (avulso)';
    if (ctx.laudo_id != null) return 'Vinculado ao Laudo #' + ctx.laudo_id;
    return 'Vinculado à Proposta #' + ctx.proposta_id;
  }

  return {
    intPos: intPos,
    lerVinculo: lerVinculo,
    aplicarVinculo: aplicarVinculo,
    urlComVinculo: urlComVinculo,
    temVinculo: temVinculo,
    textoBadge: textoBadge,
  };
});
