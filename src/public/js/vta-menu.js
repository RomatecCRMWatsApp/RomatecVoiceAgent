/* v3.51.0 — Liga a aba "VTA" (botao fixo no obras.html) ao painel das 2 ferramentas.
 * Se o botao nao existir (fallback), cria ao lado do "Vistoria (VTO)". */
(function () {
  'use strict';
  var TOOLS = [
    { href: '/vta-relatorio-fotografico.html', icon: '📷', titulo: 'Relatório Fotográfico', desc: 'Captura de fotos com overlay técnico (GPS, UTM, rosa dos ventos, logo, colaborador). As-Built / regularização.', cor: '#1a5c2a', link: '#10b981' },
    { href: '/vta-canvas.html', icon: '📐', titulo: 'Canvas / Croqui', desc: 'Canvas infinito: croqui, planta, seta de caimento, cota, norte. Gera prancha técnica A3 com carimbo automático.', cor: '#1f4e79', link: '#7aa7d9' },
  ];
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style') e.style.cssText = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function escCroqui(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDataCroqui(s) { if (!s) return ''; var d = new Date(s); if (isNaN(d.getTime())) return ''; return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function carregarCroquis(box) {
    fetch('/api/canvas/lista/recentes', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : { croquis: [] }; })
      .then(function (j) {
        var cs = (j && j.croquis) || [];
        if (!cs.length) { box.innerHTML = '<div style="opacity:.6;padding:6px 0">Nenhum croqui salvo ainda.</div>'; return; }
        box.innerHTML = cs.map(function (c) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px;background:#171a21;border:1px solid #2a2f3a;border-radius:8px;margin-bottom:6px">' +
            '<div style="flex:1;min-width:0"><div style="color:#e8eaed;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📐 ' + escCroqui(c.titulo || ('Croqui #' + c.id)) + '</div>' +
            '<div style="font-size:11px;color:#5b6478">' + fmtDataCroqui(c.atualizado_em || c.criado_em) + (c.escala_grafica ? ' · ' + escCroqui(c.escala_grafica) : '') + '</div></div>' +
            '<a href="/vta-canvas.html?id=' + c.id + '" style="background:#1f4e79;color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;text-decoration:none">✏️ Abrir</a>' +
            '<button data-del="' + c.id + '" style="background:#5a2d2d;border:none;color:#fff;padding:6px 9px;border-radius:6px;cursor:pointer;font-size:12px">🗑</button></div>';
        }).join('');
        box.querySelectorAll('[data-del]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('Excluir este croqui?')) return;
            fetch('/api/canvas/' + b.getAttribute('data-del'), { method: 'DELETE', credentials: 'include' }).then(function () { carregarCroquis(box); });
          });
        });
      })
      .catch(function () { box.innerHTML = '<div style="opacity:.6">Não foi possível carregar.</div>'; });
  }
  function abrirPainel() {
    var ov = document.getElementById('vta-overlay');
    if (ov) { ov.style.display = 'flex'; return; }
    ov = h('div', { id: 'vta-overlay', style: 'position:fixed;inset:0;z-index:99999;background:rgba(8,10,14,.86);display:flex;align-items:center;justify-content:center;padding:18px;' });
    var box = h('div', { style: 'max-width:760px;width:100%;background:#13161c;border:1px solid #2a2f3a;border-radius:14px;padding:20px;' });
    var head = h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' });
    head.appendChild(h('h2', { style: 'margin:0;color:#e8eaed;font-size:18px;' }, ['🏗️ VTA — Vistoria Técnica de As-Built']));
    head.appendChild(h('button', { style: 'background:none;border:none;color:#8a93a6;font-size:22px;cursor:pointer;', onclick: function () { ov.style.display = 'none'; } }, ['×']));
    box.appendChild(head);
    box.appendChild(h('p', { style: 'margin:0 0 16px;color:#8a93a6;font-size:12px;' }, ['Levantamento de edificação existente para regularização (averbação, habite-se, REURB, georreferenciamento).']));
    var grid = h('div', { style: 'display:grid;grid-template-columns:1fr;gap:12px;' });
    if (window.innerWidth > 620) grid.style.gridTemplateColumns = '1fr 1fr';
    TOOLS.forEach(function (t) {
      var card = h('a', { href: t.href, style: 'display:block;text-decoration:none;border:1px solid #2a2f3a;border-left:4px solid ' + t.cor + ';border-radius:12px;padding:16px;background:#171a21;color:#e8eaed;' });
      card.appendChild(h('div', { style: 'font-size:30px;margin-bottom:8px;' }, [t.icon]));
      card.appendChild(h('div', { style: 'font-size:15px;font-weight:700;margin-bottom:4px;' }, [t.titulo]));
      card.appendChild(h('div', { style: 'font-size:12px;color:#8a93a6;line-height:1.5;' }, [t.desc]));
      card.appendChild(h('div', { style: 'margin-top:10px;font-size:12px;color:' + t.link + ';' }, ['Abrir →']));
      grid.appendChild(card);
    });
    box.appendChild(grid);
    // v3.60.0: lista de croquis salvos (reusa /api/canvas/lista/recentes)
    var listWrap = h('div', { style: 'margin-top:16px;' });
    listWrap.appendChild(h('div', { style: 'font-size:12px;color:#8a93a6;margin-bottom:8px;font-weight:600;' }, ['📐 Croquis salvos']));
    var listBox = h('div', { id: 'vta-croquis-list', style: 'font-size:12px;color:#8a93a6;max-height:240px;overflow:auto;' }, ['Carregando…']);
    listWrap.appendChild(listBox); box.appendChild(listWrap);
    carregarCroquis(listBox);
    box.appendChild(h('p', { style: 'margin:14px 0 0;font-size:11px;color:#5b6478;' }, ['Dica: abre melhor no celular/tablet (câmera + GPS).']));
    ov.appendChild(box);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
    document.body.appendChild(ov);
  }
  function ligar() {
    var tabs = document.querySelector('.tabs');
    if (!tabs) return;
    var btn = tabs.querySelector('[data-tab="vta"]');
    if (!btn) { // fallback: cria ao lado do VTO se o HTML nao tiver o botao
      btn = h('button', { 'class': 'tab', 'data-tab': 'vta', title: 'Vistoria Técnica de As-Built' }, ['🏗️ VTA']);
      var vto = tabs.querySelector('[data-tab="vto"]');
      if (vto && vto.nextSibling) tabs.insertBefore(btn, vto.nextSibling); else tabs.appendChild(btn);
    }
    if (btn.getAttribute('data-vta-wired') === '1') return;
    btn.setAttribute('data-vta-wired', '1');
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopImmediatePropagation();
      tabs.querySelectorAll('.tab.active').forEach(function (x) { x.classList.remove('active'); });
      btn.classList.add('active');
      abrirPainel();
    }, true);
    tabs.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.tab') : null;
      if (t && t !== btn) { var ov = document.getElementById('vta-overlay'); if (ov) ov.style.display = 'none'; btn.classList.remove('active'); }
    });
  }
  // v3.57.1: deep-link — ao voltar das ferramentas VTA (/obras?vta=1 ou #vta),
  // reabre o painel automaticamente e marca a aba VTA como ativa.
  function autoAbrir() {
    var p = new URLSearchParams(location.search);
    if (p.get('vta') !== '1' && location.hash !== '#vta') return;
    ligar(); // garante o botao VTA injetado
    var btn = document.querySelector('.tabs [data-tab="vta"]');
    if (btn) {
      var tabs = document.querySelector('.tabs');
      if (tabs) tabs.querySelectorAll('.tab.active').forEach(function (x) { x.classList.remove('active'); });
      btn.classList.add('active');
    }
    abrirPainel();
  }

  setInterval(ligar, 1200);
  if (document.readyState !== 'loading') { ligar(); autoAbrir(); }
  else document.addEventListener('DOMContentLoaded', function () { ligar(); autoAbrir(); });
})();
