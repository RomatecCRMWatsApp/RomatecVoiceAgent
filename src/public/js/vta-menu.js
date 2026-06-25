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
      // v3.77.0: "Canvas / Croqui" passa pelo wizard (tipo + dimensões + grade).
      if (t.href === '/vta-canvas.html') {
        card.addEventListener('click', function (e) { e.preventDefault(); abrirWizardCroqui(); });
      }
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
  // ───────────────────────────────────────────────────────────────────────────
  // v3.77.0 — Wizard de criação de croqui (2 passos: tipo + dimensões + grade).
  // Espelha o app de floor plan analisado: escala/esboço + edificação/campo
  // (preset), unidade/largura/altura/grade com preview "N × M quadrados".
  // Adaptado ao motor real: NÃO cria registro aqui — só monta a URL e abre o
  // canvas; o canvas_graficos é gravado no 1º "Salvar" (igual ao fluxo atual).
  // Coordenadas internas em cm (igual ao vtaCanvasV5).
  var WZ_PRESETS = {
    edificacao: { w: 20, h: 20, gridsCm: [25, 50, 100, 200], defGridCm: 100, escala: '1:100' },
    campo: { w: 100, h: 100, gridsCm: [100, 500, 1000, 2500], defGridCm: 500, escala: '1:500' },
  };
  var wzStyleDone = false;
  function wzInjectStyle() {
    if (wzStyleDone) return; wzStyleDone = true;
    var css = '' +
      '.wz-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px;font-family:Inter,system-ui,sans-serif}' +
      '.wz-card{background:#fff;border-radius:18px;width:100%;max-width:430px;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.35);max-height:92vh;overflow:auto}' +
      '.wz-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}' +
      '.wz-head h2{font:700 19px/1.2 Inter,system-ui;color:#0C3320;margin:0}' +
      '.wz-ico{width:38px;height:38px;border-radius:10px;background:#E8F3EE;color:#0B6E4F;display:grid;place-items:center;font-size:20px}' +
      '.wz-back{border:0;background:none;font-size:22px;color:#0C3320;cursor:pointer;padding:0 6px 0 0}' +
      '.wz-sub{font:600 13px/1.3 Inter;color:#5b6b63;margin:10px 0 8px}' +
      '.wz-opt{width:100%;display:flex;align-items:center;gap:12px;text-align:left;border:2px solid #e6e9e7;border-radius:14px;background:#fff;padding:14px;margin-bottom:10px;cursor:pointer;transition:.15s}' +
      '.wz-opt:hover{border-color:#cfe5db}.wz-opt.is-active{border-color:#0B6E4F;background:#F2FAF6}' +
      '.wz-opt-ico{width:40px;height:40px;border-radius:10px;background:#eef2f0;display:grid;place-items:center;font-size:20px;flex:0 0 auto}' +
      '.wz-opt strong{display:block;font:700 15px Inter;color:#16241d}.wz-opt small{display:block;font:400 12px Inter;color:#6b7a72}' +
      '.wz-opt .wz-check{margin-left:auto;width:24px;height:24px;border-radius:50%;background:#0B6E4F;color:#fff;display:none;place-items:center;font-size:14px}' +
      '.wz-opt.is-active .wz-check{display:grid}' +
      '.wz-seg{display:flex;background:#eef2f0;border-radius:12px;padding:4px;gap:4px}' +
      '.wz-seg button{flex:1;border:0;background:none;padding:10px;border-radius:9px;font:600 13px Inter;color:#5b6b63;cursor:pointer}' +
      '.wz-seg button.is-active{background:#fff;color:#0C3320;box-shadow:0 1px 4px rgba(0,0,0,.12)}' +
      '.wz-lbl{font:600 12px Inter;color:#6b7a72;display:block;margin-bottom:4px}' +
      '.wz-inp{width:100%;border:2px solid #e6e9e7;border-radius:11px;padding:11px 12px;font:500 15px Inter;color:#16241d;outline:none;box-sizing:border-box}' +
      '.wz-inp:focus{border-color:#0B6E4F}' +
      '.wz-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
      '.wz-field{position:relative}.wz-field .wz-un{position:absolute;right:12px;top:50%;transform:translateY(-50%);font:600 13px Inter;color:#9aa8a1}' +
      '.wz-info{margin-top:12px;background:#EAF6F0;border-radius:11px;padding:11px 13px;font:600 13px Inter;color:#0B6E4F}' +
      '.wz-foot{display:flex;gap:10px;margin-top:18px}' +
      '.wz-btn{flex:1;border:0;border-radius:12px;padding:13px;font:700 15px Inter;cursor:pointer}' +
      '.wz-btn.ghost{background:#fff;border:2px solid #e6e9e7;color:#0C3320}' +
      '.wz-btn.primary{background:#0B6E4F;color:#fff}.wz-btn.primary:disabled{opacity:.5;cursor:not-allowed}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }
  function wzHtml() {
    return '' +
      '<div class="wz-card" role="dialog" aria-modal="true">' +
      '<section id="wzStep1" class="wz-step">' +
      '<header class="wz-head"><span class="wz-ico">＋</span><h2>Novo Croqui</h2></header>' +
      '<p class="wz-sub">Que tipo de croqui você quer criar?</p>' +
      '<button class="wz-opt is-active" data-tipo="escala" type="button"><span class="wz-opt-ico">📐</span><span><strong>Em escala</strong><small>Com medidas reais (NBR 13133)</small></span><span class="wz-check">✓</span></button>' +
      '<button class="wz-opt" data-tipo="esboco" type="button"><span class="wz-opt-ico">✎</span><span><strong>Esboço rápido</strong><small>Sem grade, croqui livre</small></span><span class="wz-check">✓</span></button>' +
      '<p class="wz-sub" style="margin-top:14px">Aplicação</p>' +
      '<div class="wz-seg" id="wzModo"><button class="is-active" data-modo="edificacao" type="button">Edificação</button><button data-modo="campo" type="button">Área de campo</button></div>' +
      '<footer class="wz-foot"><button class="wz-btn ghost" id="wzCancel" type="button">Cancelar</button><button class="wz-btn primary" id="wzNext" type="button">Avançar</button></footer>' +
      '</section>' +
      '<section id="wzStep2" class="wz-step" hidden>' +
      '<header class="wz-head"><button class="wz-back" id="wzBack" type="button">←</button><h2>Dimensões do Croqui</h2></header>' +
      '<label class="wz-lbl">Nome</label><input id="wzNome" class="wz-inp" type="text" placeholder="Ex.: Pavimento térreo — Lote 12" maxlength="120">' +
      '<div class="wz-seg" id="wzUnidade" style="margin:10px 0"><button data-un="m" class="is-active" type="button">Metros (m)</button><button data-un="cm" type="button">Centímetros (cm)</button></div>' +
      '<div class="wz-grid2"><div><label class="wz-lbl">Largura</label><div class="wz-field"><input id="wzW" class="wz-inp" type="number" min="1" step="0.01" value="20"><span class="wz-un">m</span></div></div>' +
      '<div><label class="wz-lbl">Altura</label><div class="wz-field"><input id="wzH" class="wz-inp" type="number" min="1" step="0.01" value="20"><span class="wz-un">m</span></div></div></div>' +
      '<label class="wz-lbl" style="margin-top:10px">Tamanho do quadrado (grade)</label><select id="wzGrid" class="wz-inp"></select>' +
      '<div class="wz-info" id="wzPreview">Grade: 20 × 20 quadrados (1,0 m cada)</div>' +
      '<footer class="wz-foot"><button class="wz-btn ghost" id="wzCancel2" type="button">Cancelar</button><button class="wz-btn primary" id="wzCreate" type="button">Criar Croqui</button></footer>' +
      '</section></div>';
  }
  function abrirWizardCroqui() {
    wzInjectStyle();
    var prev = document.getElementById('wizardOverlay'); if (prev) prev.remove();
    var ov = document.createElement('div'); ov.id = 'wizardOverlay'; ov.className = 'wz-overlay';
    ov.innerHTML = wzHtml();
    document.body.appendChild(ov);
    wzWire(ov);
  }
  function wzWire(ov) {
    var $ = function (s) { return ov.querySelector(s); };
    var state = { tipo: 'escala', modo: 'edificacao', unidade: 'm', gridCm: 100 };
    function segSet(sel, attr, val) { ov.querySelectorAll(sel + ' button').forEach(function (b) { b.classList.toggle('is-active', b.dataset[attr] === val); }); }
    function formatGrid(cm) { return cm >= 100 ? (cm / 100).toLocaleString('pt-BR') + ' m' : cm + ' cm'; }
    function lerDimCm() {
      var f = state.unidade === 'm' ? 100 : 1;
      return { w: Math.round((parseFloat($('#wzW').value || '0')) * f), h: Math.round((parseFloat($('#wzH').value || '0')) * f) };
    }
    function aplicarPreset(modo) {
      var p = WZ_PRESETS[modo] || WZ_PRESETS.edificacao;
      $('#wzW').value = state.unidade === 'm' ? p.w : p.w * 100;
      $('#wzH').value = state.unidade === 'm' ? p.h : p.h * 100;
      var sel = $('#wzGrid'); sel.innerHTML = '';
      p.gridsCm.forEach(function (cm) { var o = document.createElement('option'); o.value = cm; o.textContent = formatGrid(cm); if (cm === p.defGridCm) o.selected = true; sel.appendChild(o); });
      state.gridCm = p.defGridCm; atualizarPreview();
    }
    function atualizarPreview() {
      if (state.tipo === 'esboco') { $('#wzPreview').textContent = 'Esboço livre — sem grade métrica'; return; }
      var d = lerDimCm(), g = state.gridCm;
      if (!d.w || !d.h || !g) { $('#wzPreview').textContent = 'Informe largura, altura e grade'; return; }
      $('#wzPreview').textContent = 'Grade: ' + Math.ceil(d.w / g) + ' × ' + Math.ceil(d.h / g) + ' quadrados (' + formatGrid(g) + ' cada)';
    }
    ov.querySelectorAll('.wz-opt').forEach(function (b) {
      b.addEventListener('click', function () { ov.querySelectorAll('.wz-opt').forEach(function (x) { x.classList.remove('is-active'); }); b.classList.add('is-active'); state.tipo = b.dataset.tipo; atualizarPreview(); });
    });
    ov.querySelectorAll('#wzModo button').forEach(function (b) { b.addEventListener('click', function () { state.modo = b.dataset.modo; segSet('#wzModo', 'modo', state.modo); aplicarPreset(state.modo); }); });
    ov.querySelectorAll('#wzUnidade button').forEach(function (b) {
      b.addEventListener('click', function () {
        var novo = b.dataset.un; if (novo === state.unidade) return;
        var d = lerDimCm(); state.unidade = novo; segSet('#wzUnidade', 'un', novo);
        $('#wzW').value = novo === 'm' ? (d.w / 100) : d.w;
        $('#wzH').value = novo === 'm' ? (d.h / 100) : d.h;
        ov.querySelectorAll('.wz-un').forEach(function (s) { s.textContent = novo; });
        atualizarPreview();
      });
    });
    ['#wzW', '#wzH'].forEach(function (s) { $(s).addEventListener('input', atualizarPreview); });
    $('#wzGrid').addEventListener('change', function (e) { state.gridCm = Number(e.target.value); atualizarPreview(); });
    $('#wzNext').addEventListener('click', function () { $('#wzStep1').hidden = true; $('#wzStep2').hidden = false; $('#wzNome').focus(); });
    $('#wzBack').addEventListener('click', function () { $('#wzStep2').hidden = true; $('#wzStep1').hidden = false; });
    function fechar() { ov.remove(); }
    $('#wzCancel').addEventListener('click', fechar); $('#wzCancel2').addEventListener('click', fechar);
    ov.addEventListener('click', function (e) { if (e.target === ov) fechar(); });
    $('#wzCreate').addEventListener('click', function () {
      var nome = ($('#wzNome').value || '').trim();
      if (nome.length < 2) { $('#wzNome').focus(); return; }
      var d = lerDimCm();
      if (state.tipo === 'escala' && (!d.w || !d.h)) { atualizarPreview(); return; }
      var p = WZ_PRESETS[state.modo] || WZ_PRESETS.edificacao;
      var q = new URLSearchParams();
      q.set('modo', state.tipo); q.set('uso', state.modo); q.set('un', state.unidade);
      q.set('grid', String(state.gridCm)); q.set('w', String(d.w || 2000)); q.set('h', String(d.h || 2000));
      q.set('escala', p.escala); q.set('titulo', nome);
      location.href = '/vta-canvas.html?' + q.toString();
    });
    aplicarPreset('edificacao');
  }
  window.abrirWizardCroqui = abrirWizardCroqui;

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
