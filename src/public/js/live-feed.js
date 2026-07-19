/**
 * ZAYRA · Live Feed Universal · v1.99.15
 * Auto-inicializa qualquer .zayra-live-feed na página.
 * Recarrega via window.ZayraLiveFeed.reload(seletor) ou reloadAll().
 */
(function () {
  'use strict';

  const SCROLL_SECONDS_PER_CARD = 4;

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderCard(card) {
    const metrics = card.metrics || [];
    // v3.116.0: o CSS le --zlf-cols pra montar o grid e ajustar largura/fonte
    // quando o card tem 4 metricas (Orcamento/Mao de Obra/Saldo/Equipe).
    const cols = metrics.length > 0 ? metrics.length : 3;
    const cells = metrics
      .map(function (m) {
        const hl = m.highlight ? ' zlf-hl-' + m.highlight : '';
        return (
          '<div class="zlf-cell">' +
          '<div class="zlf-cell-lbl">' + escapeHtml(m.label) + '</div>' +
          '<div class="zlf-cell-val' + hl + '">' + escapeHtml(m.value) + '</div>' +
          '</div>'
        );
      })
      .join('');

    const tag = card.href ? 'a' : 'div';
    const href = card.href ? ' href="' + escapeHtml(card.href) + '"' : '';

    return (
      '<' + tag + ' class="zlf-card" style="--zlf-cols:' + cols + '"' + href + '>' +
        '<div class="zlf-card-top">' +
          '<div class="zlf-avatar">' + escapeHtml(card.avatar) + '</div>' +
          '<div class="zlf-card-info">' +
            '<div class="zlf-card-title">' + escapeHtml(card.title) + '</div>' +
            '<div class="zlf-card-sub">' + escapeHtml(card.subtitle) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="zlf-card-grid">' + cells + '</div>' +
      '</' + tag + '>'
    );
  }

  function buildUrl(el) {
    const tab = el.dataset.tab;
    const params = new URLSearchParams();
    if (el.dataset.obraId) params.set('obraId', el.dataset.obraId);
    if (el.dataset.ano) params.set('ano', el.dataset.ano);
    if (el.dataset.mes) params.set('mes', el.dataset.mes);
    if (el.dataset.limit) params.set('limit', el.dataset.limit);
    const qs = params.toString();
    return '/api/live-feed/' + encodeURIComponent(tab) + (qs ? '?' + qs : '');
  }

  async function loadFeed(el) {
    const tab = el.dataset.tab;
    if (!tab) return;

    try {
      const res = await fetch(buildUrl(el), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      applyData(el, data);
    } catch (err) {
      console.error('[LiveFeed]', tab, err);
      const titleEl = el.querySelector('.zlf-title-text');
      if (titleEl) titleEl.textContent = 'Erro ao carregar';
      el.dataset.theme = 'red';
    }
  }

  function applyData(el, data) {
    el.dataset.theme = data.theme || 'green';

    const titleEl = el.querySelector('.zlf-title-text');
    if (titleEl) titleEl.textContent = data.title || '';

    const counterNum = el.querySelector('.zlf-counter-num');
    const counterLbl = el.querySelector('.zlf-counter-label');
    if (counterNum) counterNum.textContent = String(data.counterValue ?? 0);
    if (counterLbl) counterLbl.textContent = data.counterLabel || 'REGISTROS';

    const empty = el.querySelector('.zlf-empty');
    const viewport = el.querySelector('.zlf-viewport');

    if (!data.cards || data.cards.length === 0) {
      if (empty) empty.hidden = false;
      if (viewport) viewport.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (viewport) viewport.hidden = false;

    const track = el.querySelector('.zlf-track');
    if (!track) return;

    const html = data.cards.map(renderCard).join('');
    track.innerHTML = html + html; // duplica pra loop infinito sem corte

    const duration = Math.max(20, data.cards.length * SCROLL_SECONDS_PER_CARD);
    track.style.setProperty('--zlf-duration', duration + 's');
  }

  function setupAutoRefresh(el) {
    const ms = parseInt(el.dataset.refreshMs || '60000', 10);
    if (Number.isFinite(ms) && ms > 0) {
      const id = setInterval(function () {
        if (document.body.contains(el)) {
          loadFeed(el);
        } else {
          clearInterval(id);
        }
      }, ms);
    }
  }

  function init() {
    document.querySelectorAll('.zayra-live-feed').forEach(function (el) {
      loadFeed(el);
      setupAutoRefresh(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ZayraLiveFeed = {
    reload: function (selectorOrEl) {
      const el = typeof selectorOrEl === 'string'
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
      if (el) loadFeed(el);
    },
    reloadAll: function () {
      document.querySelectorAll('.zayra-live-feed').forEach(loadFeed);
    },
    setFilter: function (selectorOrEl, key, value) {
      const el = typeof selectorOrEl === 'string'
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
      if (!el) return;
      const camelKey = key === 'obraId' ? 'obraId' : key;
      el.dataset[camelKey] = value == null ? '' : String(value);
      loadFeed(el);
    },
  };
})();
