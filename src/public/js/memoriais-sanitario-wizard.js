/* v3.49.4: Wizard do Memorial Sanitario (NBR 8160/10844/7229). Standalone + auto-launcher.
 * <script src="/js/memoriais-sanitario-wizard.js"></script>. */
(function () {
  'use strict';
  var API = '/api/memoriais/sanitario';
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
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d || 0); }
  function fmt(n, d) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  async function api(path, body, method) {
    var r = await fetch(API + path, { method: method || 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { window.location.href = '/login'; throw new Error('nao autenticado'); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  var COR = { verde: '#10b981', azul: '#1F4E79', erro: '#dc2626', alerta: '#d39e00', ciano: '#0ea5b7' };
  var BTN = 'padding:9px 16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg-elev,#1c1c1c);color:var(--text,#eee);cursor:pointer;font-size:13px;';
  var BTN_OK = 'padding:10px 18px;border-radius:8px;border:none;background:' + COR.ciano + ';color:#012a2f;cursor:pointer;font-weight:700;font-size:14px;';
  var INP = 'width:100%;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#111);color:var(--text,#eee);font-size:13px;box-sizing:border-box;';
  var CARD = 'border:1px solid var(--border,#333);border-radius:10px;padding:16px;background:var(--bg-elev,#161616);margin-bottom:14px;';
  var state, root;
  var APAR = [['bacia_sanitaria','Bacia sanitaria'],['lavatorio','Lavatorio'],['chuveiro','Chuveiro/ducha'],['pia_cozinha','Pia de cozinha'],['tanque','Tanque'],['maquina_lavar','Maq. lavar'],['ralo_sifonado','Ralo sifonado'],['ralo_seco','Ralo seco']];
  var DEST = [['rede_publica','Rede publica'],['fossa_sumidouro','Fossa + sumidouro'],['fossa_filtro_anaerobio','Fossa + filtro'],['eta_compacta','ETE compacta']];

  function defaults() {
    return { passo: 3,
      obra: { titulo: 'Residencia Unifamiliar', endereco: '', municipio: 'Acailandia', uf: 'MA', proprietario: '', cpfCnpj: '', areaM2: 0, nPavimentos: 1, prancha: 'PS-06', trtNumero: '' },
      uso: { tipoUso: 'residencial', numPessoas: 5, areaCoberturaM2: 0, intensidadePluvMmh: 150, destinoEfluente: 'fossa_sumidouro', temCaixaGordura: true, aparelhos: [
        { tipo: 'bacia_sanitaria', quantidade: 2 }, { tipo: 'lavatorio', quantidade: 2 }, { tipo: 'chuveiro', quantidade: 2 },
        { tipo: 'pia_cozinha', quantidade: 1 }, { tipo: 'tanque', quantidade: 1 }, { tipo: 'maquina_lavar', quantidade: 1 }, { tipo: 'ralo_sifonado', quantidade: 3 } ] },
      resumo: null, gerado: null };
  }
  function montar(container, opts) {
    root = container; state = defaults();
    if (opts && opts.prefill) { if (opts.prefill.obra) Object.assign(state.obra, opts.prefill.obra); if (opts.prefill.uso) Object.assign(state.uso, opts.prefill.uso); }
    render();
  }
  function fechar() {
    var v = document.getElementById('view-memoriais');
    if (v) v.removeAttribute('data-memsan-active');
    if (typeof window.renderMemoriaisQuantitativos === 'function') window.renderMemoriaisQuantitativos();
    else if (v) v.innerHTML = '';
  }
  function campo(label, valor, oninput, attrs) {
    var inp = h('input', Object.assign({ style: INP, value: valor }, attrs || {}));
    inp.addEventListener('input', function () { oninput(inp.value); });
    return h('label', { style: 'display:block;font-size:11px;color:var(--text-muted,#888);margin-bottom:10px;' }, [label, inp]);
  }
  function sel(label, valor, opcoes, onchange) {
    var s = h('select', { style: INP });
    opcoes.forEach(function (o) { var op = h('option', { value: o[0] }, [o[1]]); if (String(valor) === String(o[0])) op.selected = true; s.appendChild(op); });
    s.addEventListener('change', function () { onchange(s.value); });
    return h('label', { style: 'display:block;font-size:11px;color:var(--text-muted,#888);margin-bottom:10px;' }, [label, s]);
  }
  function render() {
    root.innerHTML = '';
    var wrap = h('div', { style: 'max-width:920px;margin:0 auto;' });
    wrap.appendChild(h('h2', { style: 'margin:0 0 4px;' }, ['Memorial Sanitario - NBR 8160/10844']));
    wrap.appendChild(h('p', { style: 'margin:0 0 14px;font-size:12px;color:var(--text-muted,#888);' }, ['Esgoto (UHC), aguas pluviais e fossa/sumidouro, calculo e 2 PDFs.']));
    wrap.appendChild(state.passo === 3 ? renderPasso3() : renderPasso5());
    var nav = h('div', { style: 'display:flex;justify-content:space-between;margin-top:16px;' });
    nav.appendChild(h('button', { style: BTN, onclick: function () { if (state.passo > 3) { state.passo = 3; render(); } else { fechar(); } } }, [state.passo > 3 ? '< Voltar' : 'Fechar']));
    nav.appendChild(state.passo === 3 ? h('button', { style: BTN_OK, onclick: function () { state.passo = 5; render(); recalc(); } }, ['Avancar >']) : h('span', {}, ['']));
    wrap.appendChild(nav);
    root.appendChild(wrap);
  }
  function renderPasso3() {
    var u = state.uso, o = state.obra;
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-weight:600;' }, ['Dados sanitarios']));
    var g = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 14px;' });
    g.appendChild(campo('Area construida (m2)', o.areaM2, function (v) { o.areaM2 = num(v); }, { type: 'number', step: '0.01' }));
    g.appendChild(campo('No de pessoas', u.numPessoas, function (v) { u.numPessoas = num(v, 5); }, { type: 'number' }));
    g.appendChild(campo('Area de cobertura (m2)', u.areaCoberturaM2, function (v) { u.areaCoberturaM2 = num(v); }, { type: 'number', step: '0.01' }));
    g.appendChild(campo('Intensidade pluv. (mm/h)', u.intensidadePluvMmh, function (v) { u.intensidadePluvMmh = num(v, 150); }, { type: 'number' }));
    g.appendChild(sel('Destino do efluente', u.destinoEfluente, DEST, function (v) { u.destinoEfluente = v; }));
    g.appendChild(sel('Caixa de gordura', u.temCaixaGordura ? '1' : '0', [['1','Com caixa de gordura'],['0','Sem caixa de gordura']], function (v) { u.temCaixaGordura = v === '1'; }));
    card.appendChild(g);
    card.appendChild(h('p', { style: 'margin:12px 0 6px;font-weight:600;font-size:13px;' }, ['Aparelhos sanitarios (UHC)']));
    var tbl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:12px;' });
    var thr = h('tr', {}); ['Aparelho','Qtd',''].forEach(function (t) { thr.appendChild(h('th', { style: 'text-align:left;padding:4px 6px;color:var(--text-muted,#888);' }, [t])); }); tbl.appendChild(thr);
    u.aparelhos.forEach(function (c, idx) {
      var tr = h('tr', {});
      var tipoSel = h('select', { style: INP + 'padding:5px 7px;' });
      APAR.forEach(function (tp) { var op = h('option', { value: tp[0] }, [tp[1]]); if (c.tipo === tp[0]) op.selected = true; tipoSel.appendChild(op); });
      tipoSel.addEventListener('change', function () { c.tipo = tipoSel.value; });
      tr.appendChild(h('td', { style: 'padding:3px 6px;' }, [tipoSel]));
      var qt = h('input', { style: INP + 'padding:5px 7px;width:70px;', type: 'number', value: c.quantidade }); qt.addEventListener('input', function () { c.quantidade = num(qt.value, 1); });
      tr.appendChild(h('td', { style: 'padding:3px 6px;' }, [qt]));
      tr.appendChild(h('td', {}, [h('button', { style: 'background:none;border:none;color:' + COR.erro + ';cursor:pointer;font-size:15px;', onclick: function () { u.aparelhos.splice(idx, 1); render(); } }, ['x'])]));
      tbl.appendChild(tr);
    });
    card.appendChild(tbl);
    card.appendChild(h('button', { style: BTN + 'margin-top:10px;', onclick: function () { u.aparelhos.push({ tipo: 'lavatorio', quantidade: 1 }); render(); } }, ['+ Adicionar aparelho']));
    return card;
  }
  function renderPasso5() {
    var box = h('div', {});
    var r = state.resumo;
    if (!r) { box.appendChild(h('div', { id: 'memsan-resumo', style: CARD }, ['Calculando...'])); return box; }
    var s = r.saida; var f = s.fossa_sumidouro;
    var card = h('div', { style: CARD });
    var linhas = [['Soma UHC', s.esgoto.soma_uhc], ['Coletor predial', 'DN ' + s.esgoto.dimensionamento_coletor_predial.DN_mm + ' mm'], ['Tubo de queda', 'DN ' + s.esgoto.dimensionamento_tubo_queda.DN_mm + ' mm'], ['Vazao pluvial', fmt(s.aguas_pluviais.vazao_projeto_Lmin, 0) + ' L/min'], ['Calha', 'DN ' + s.aguas_pluviais.dimensionamento_calha.DN_mm + ' mm'], ['Condutor vert.', s.aguas_pluviais.dimensionamento_condutor_vertical.quantidade + 'x DN ' + s.aguas_pluviais.dimensionamento_condutor_vertical.DN_mm]];
    if (f) { linhas.push(['Fossa septica', fmt(f.volume_total_L, 0) + ' L']); linhas.push(['Sumidouro', fmt(f.area_sumidouro_m2, 0) + ' m2']); }
    card.appendChild(h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;' }, linhas.map(function (l) { return h('div', { html: '<div style="font-size:11px;color:var(--text-muted,#888);">' + l[0] + '</div><div style="font-size:16px;color:' + COR.ciano + ';font-weight:600;">' + l[1] + '</div>' }); })));
    var sn = r.statusNormativo || {};
    var checks = [['Esgoto dimensionado (UHC)', sn.esgotoDimensionadoOK], ['Aguas pluviais atendidas', sn.pluvialOK], ['Fossa/sumidouro (se aplicavel)', sn.fossaDimensionada || r.dadosUso.destinoEfluente === 'rede_publica'], ['Caixa de gordura prevista', sn.caixaGorduraPrevista]];
    var st = h('div', { style: 'margin-top:14px;display:grid;gap:4px;' });
    checks.forEach(function (c) { st.appendChild(h('div', { style: 'font-size:13px;color:' + (c[1] ? COR.verde : COR.erro) + ';' }, [(c[1] ? '✅ ' : '❌ ') + c[0]])); });
    card.appendChild(st);
    (r.alertas || []).forEach(function (a) { card.appendChild(h('div', { style: 'margin-top:6px;font-size:12px;color:' + COR.alerta + ';background:rgba(211,158,0,.1);padding:6px 8px;border-radius:6px;' }, ['⚠ ' + a])); });
    box.appendChild(card);
    box.appendChild(state.gerado ? blocoGerado() : h('button', { id: 'memsan-gerar', style: BTN_OK + 'font-size:15px;padding:12px 22px;', onclick: gerar }, ['Gerar Memorial + Quantitativo']));
    return box;
  }
  function entrada() { return { dadosObra: state.obra, dadosUso: state.uso }; }
  function recalc() { api('/calcular-resumo', entrada()).then(function (j) { state.resumo = j; render(); }).catch(function (e) { var o = document.getElementById('memsan-resumo'); if (o) o.innerHTML = '<span style="color:' + COR.erro + ';">' + esc(e.message) + '</span>'; }); }
  function gerar() { var b = document.getElementById('memsan-gerar'); if (b) { b.disabled = true; b.textContent = 'Gerando PDFs...'; } api('/gerar', entrada()).then(function (j) { state.gerado = j; render(); }).catch(function (e) { alert('Falha: ' + e.message); if (b) { b.disabled = false; b.textContent = 'Gerar Memorial + Quantitativo'; } }); }
  function blocoGerado() {
    var g = state.gerado;
    var card = h('div', { style: CARD + 'border-color:' + COR.ciano + ';' });
    card.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;color:' + COR.ciano + ';' }, ['✅ Memorial #' + (g.codigo || g.id) + ' gerado']));
    var links = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;' });
    links.appendChild(h('a', { href: g.urlMemorial, target: '_blank', style: BTN + 'text-decoration:none;' }, ['Memorial PDF']));
    links.appendChild(h('a', { href: g.urlQuantitativo, target: '_blank', style: BTN + 'text-decoration:none;' }, ['Lista PDF']));
    card.appendChild(links);
    var tel = h('input', { style: INP + 'max-width:200px;display:inline-block;width:auto;', placeholder: 'WhatsApp (DDD+numero)' });
    card.appendChild(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [tel, h('button', { style: BTN, onclick: function () { api('/' + g.id + '/enviar-whatsapp', { telefone: tel.value.trim() }).then(function () { alert('Enviado!'); }).catch(function (e) { alert(e.message); }); } }, ['Enviar WhatsApp'])]));
    return card;
  }
  var lista = null, listaT = 0;
  function getLista() { var a = Date.now(); if (lista && a - listaT < 4000) return Promise.resolve(lista); return fetch(API + '?limite=200', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : { data: [] }; }).then(function (j) { lista = j.data || []; listaT = a; return lista; }).catch(function () { return lista || []; }); }
  function bm(label, cor, onclick) { return h('button', { style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + cor + ';background:transparent;color:' + cor + ';cursor:pointer;font-size:11px;margin-left:6px;', onclick: onclick }, [label]); }
  function injetar() {
    var view = document.getElementById('view-memoriais'); if (!view) return;
    var cards = view.querySelectorAll('.card'); if (!cards.length) return;
    getLista().then(function (ls) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i]; if (card.getAttribute('data-memsan-btns') === '1') continue;
        var p = card.querySelector('p'); if (!p) continue;
        var m = (p.textContent || '').match(/MEM-\S+/); if (!m) continue;
        var reg = ls.filter(function (x) { return x.codigo === m[0]; })[0]; if (!reg) continue;
        card.setAttribute('data-memsan-btns', '1');
        var bar = h('div', { style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:0;align-items:center;' });
        bar.appendChild(h('a', { href: API + '/' + reg.id + '/memorial.pdf', target: '_blank', style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + COR.azul + ';background:transparent;color:#7aa7d9;text-decoration:none;font-size:11px;' }, ['Memorial PDF']));
        bar.appendChild(h('a', { href: API + '/' + reg.id + '/quantitativo.pdf', target: '_blank', style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + COR.azul + ';background:transparent;color:#7aa7d9;text-decoration:none;font-size:11px;margin-left:6px;' }, ['Lista PDF']));
        (function (id, cod, c) {
          bar.appendChild(bm('Editar', COR.verde, function () { fetch(API + '/' + id + '/dados', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (j) { var d = j.dados || {}; view.setAttribute('data-memsan-active', '1'); montar(view, { prefill: { obra: d.dadosObra || {}, uso: d.dadosUso || {} } }); }); }));
          bar.appendChild(bm('Excluir', COR.erro, function () { if (!confirm('Excluir ' + cod + '?')) return; fetch(API + '/' + id, { method: 'DELETE', credentials: 'include' }).then(function (r) { if (r.ok && c.parentNode) c.parentNode.removeChild(c); lista = null; }); }));
        })(reg.id, m[0], card);
        card.appendChild(bar);
      }
    });
  }
  function launcher() {
    var view = document.getElementById('view-memoriais'); if (!view) return;
    if (view.getAttribute('data-memsan-active') !== '1' && !document.getElementById('memsan-launch')) {
      var btn = h('button', { id: 'memsan-launch', style: BTN_OK + 'margin:0 0 14px 8px;', onclick: function () {
        view.setAttribute('data-memsan-active', '1');
        var gv = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
        montar(view, { prefill: { obra: { titulo: gv('memObraTitulo') || 'Residencia Unifamiliar', endereco: gv('memObraEndereco'), municipio: gv('memObraMunicipio') || 'Acailandia', uf: gv('memObraUf') || 'MA', proprietario: gv('memProprietario'), cpfCnpj: gv('memCpfCnpj'), areaM2: num(gv('memAreaConstr')), nPavimentos: num(gv('memPavimentos'), 1), prancha: gv('memPrancha') || 'PS-06' } } });
      } }, ['🚽 Abrir Wizard Sanitario (NBR 8160)']);
      view.insertBefore(btn, view.firstChild);
    }
    if (view.getAttribute('data-memsan-active') !== '1') injetar();
  }
  setInterval(launcher, 1300);
  if (document.readyState !== 'loading') launcher(); else document.addEventListener('DOMContentLoaded', launcher);
  window.MemSanWizard = { montar: montar };
})();
