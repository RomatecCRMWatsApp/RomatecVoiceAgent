/* v3.49.2: Wizard Passos 3/4/5 do Memorial Hidraulico (NBR 5626).
 * Standalone + AUTO-LAUNCHER: basta incluir <script src="/js/memoriais-hidraulico-wizard.js">.
 * Ele injeta sozinho um botao "Abrir Wizard NBR 5626" dentro da aba Memoriais
 * (#view-memoriais). Tambem expoe MemHidWizard.montar(container, {prefill}) p/ uso manual.
 */
(function () {
  'use strict';
  var API = '/api/memoriais/hidraulico';

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

  async function api(path, body) {
    var r = await fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { window.location.href = '/login'; throw new Error('nao autenticado'); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  var COR = { verde: '#10b981', azul: '#1F4E79', erro: '#dc2626', alerta: '#d39e00' };
  var BTN = 'padding:9px 16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg-elev,#1c1c1c);color:var(--text,#eee);cursor:pointer;font-size:13px;';
  var BTN_OK = 'padding:10px 18px;border-radius:8px;border:none;background:' + COR.verde + ';color:#06281c;cursor:pointer;font-weight:700;font-size:14px;';
  var INP = 'width:100%;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#111);color:var(--text,#eee);font-size:13px;box-sizing:border-box;';
  var CARD = 'border:1px solid var(--border,#333);border-radius:10px;padding:16px;background:var(--bg-elev,#161616);margin-bottom:14px;';

  var state, root, debTimer;

  function defaults() {
    return {
      passo: 3,
      obra: { titulo: 'Residencia Unifamiliar', endereco: '', municipio: 'Acailandia', uf: 'MA', proprietario: '', cpfCnpj: '', areaM2: 0, areaLoteM2: 0, nPavimentos: 1, prancha: 'PH-03', trtNumero: '' },
      uso: { tipoUso: 'residencial', nUsuarios: 4, perCapita: 150, complementares: { lavagemRoupa: 120, limpezaExterna: 80 }, reservaTecnicaPercent: 10, cotaFundoM: 4.0 },
      tubulacoes: [{ dn_mm: 20, comprimento_m: 27.17 }, { dn_mm: 25, comprimento_m: 17.82 }, { dn_mm: 32, comprimento_m: 4.48 }, { dn_mm: 50, comprimento_m: 17.92 }],
      conexoes: [{ descricao: 'Joelho 90 soldavel 25mm', dn_mm: 25, qtd: 18 }, { descricao: 'Te soldavel 25mm', dn_mm: 25, qtd: 12 }],
      aparelhos: [{ tipo: 'bacia_caixa_acoplada', qtd: 2 }, { tipo: 'lavatorio', qtd: 2 }, { tipo: 'chuveiro', qtd: 1 }, { tipo: 'ducha_higienica', qtd: 1 }, { tipo: 'pia_cozinha', qtd: 1 }, { tipo: 'tanque', qtd: 1 }, { tipo: 'maquina_lavar', qtd: 1 }, { tipo: 'torneira_geral', qtd: 1 }],
      consumo: null, resumo: null, gerado: null,
    };
  }

  function montar(container, opts) {
    root = container;
    state = defaults();
    if (opts && opts.prefill) {
      var p = opts.prefill;
      ['obra', 'uso'].forEach(function (k) { if (p[k]) Object.assign(state[k], p[k]); });
      ['tubulacoes', 'conexoes', 'aparelhos'].forEach(function (k) { if (Array.isArray(p[k]) && p[k].length) state[k] = p[k]; });
    }
    render();
    recalcConsumo();
  }

  function stepper() {
    var passos = [['3', 'Uso & Consumo'], ['4', 'Tabelas extraidas'], ['5', 'Revisao & Geracao']];
    return h('div', { style: 'display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;' }, passos.map(function (p) {
      var ativo = String(state.passo) === p[0];
      return h('div', { style: 'flex:1;min-width:140px;padding:8px 10px;border-radius:8px;text-align:center;font-size:12px;font-weight:600;' + (ativo ? 'background:' + COR.verde + ';color:#06281c;' : 'background:var(--bg-elev,#1c1c1c);color:var(--text-muted,#888);border:1px solid var(--border,#333);') }, ['Passo ' + p[0] + ' - ' + p[1]]);
    }));
  }

  function navBtns() {
    var box = h('div', { style: 'display:flex;justify-content:space-between;margin-top:16px;' });
    box.appendChild(h('button', { style: BTN, onclick: function () { if (state.passo > 3) { state.passo--; render(); } } }, [state.passo > 3 ? '< Voltar' : 'Fechar']));
    box.appendChild(state.passo < 5 ? h('button', { style: BTN_OK, onclick: function () { state.passo++; render(); if (state.passo === 5) recalcResumo(); } }, ['Avancar >']) : h('span', {}, ['']));
    return box;
  }

  function render() {
    root.innerHTML = '';
    var wrap = h('div', { style: 'max-width:920px;margin:0 auto;' });
    wrap.appendChild(h('h2', { style: 'margin:0 0 4px;' }, ['Memorial Hidraulico - NBR 5626']));
    wrap.appendChild(h('p', { style: 'margin:0 0 14px;font-size:12px;color:var(--text-muted,#888);' }, ['Passos 3 a 5: dados de uso, conferencia das tabelas e geracao dos PDFs.']));
    wrap.appendChild(stepper());
    wrap.appendChild(state.passo === 3 ? renderPasso3() : state.passo === 4 ? renderPasso4() : renderPasso5());
    wrap.appendChild(navBtns());
    root.appendChild(wrap);
  }

  function campo(label, valor, oninput, attrs) {
    var inp = h('input', Object.assign({ style: INP, value: valor }, attrs || {}));
    inp.addEventListener('input', function () { oninput(inp.value); });
    return h('label', { style: 'display:block;font-size:11px;color:var(--text-muted,#888);margin-bottom:10px;' }, [label, inp]);
  }

  /* PASSO 3 */
  function renderPasso3() {
    var u = state.uso, o = state.obra;
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-weight:600;' }, ['Passo 3 - Dados de uso e ocupacao']));
    var tipoBox = h('div', { style: 'margin-bottom:12px;display:flex;gap:16px;font-size:13px;' }, [['residencial', 'Residencial'], ['comercial', 'Comercial']].map(function (t) {
      var rd = h('input', { type: 'radio', name: 'memhidTipo', value: t[0] });
      if (u.tipoUso === t[0]) rd.checked = true;
      rd.addEventListener('change', function () { u.tipoUso = t[0]; recalcConsumo(); });
      return h('label', { style: 'cursor:pointer;' }, [rd, ' ' + t[1]]);
    }));
    card.appendChild(tipoBox);
    var g = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 14px;' });
    g.appendChild(campo('No de moradores/usuarios', u.nUsuarios, function (v) { u.nUsuarios = num(v, 1); recalcConsumo(); }, { type: 'number', min: '1' }));
    g.appendChild(campo('Per capita (L/dia)', u.perCapita, function (v) { u.perCapita = num(v, 150); recalcConsumo(); }, { type: 'number' }));
    g.appendChild(campo('Lavagem de roupa (L/dia)', u.complementares.lavagemRoupa, function (v) { u.complementares.lavagemRoupa = num(v); recalcConsumo(); }, { type: 'number' }));
    g.appendChild(campo('Limpeza externa (L/dia)', u.complementares.limpezaExterna, function (v) { u.complementares.limpezaExterna = num(v); recalcConsumo(); }, { type: 'number' }));
    g.appendChild(campo('Reserva tecnica (%)', u.reservaTecnicaPercent, function (v) { u.reservaTecnicaPercent = num(v); recalcConsumo(); }, { type: 'number' }));
    g.appendChild(campo('Cota fundo reservatorio (m)', u.cotaFundoM, function (v) { u.cotaFundoM = num(v, 4); }, { type: 'number', step: '0.1' }));
    g.appendChild(campo('TRT/ART no (opcional)', o.trtNumero, function (v) { o.trtNumero = v; }));
    card.appendChild(g);
    var out = h('div', { id: 'memhid-consumo', style: 'margin-top:6px;padding:12px;border-radius:8px;background:rgba(16,185,129,.07);border-left:3px solid ' + COR.verde + ';' });
    out.innerHTML = state.consumo ? consumoHtml(state.consumo) : 'Calculando...';
    card.appendChild(out);
    return card;
  }
  function consumoHtml(c) { return '<strong>Consumo diario:</strong> ' + c.consumoDiario + ' L/dia &nbsp;&nbsp; <strong>Reservatorio recomendado:</strong> ' + c.volumeReservatorio + ' L'; }
  function recalcConsumo() {
    clearTimeout(debTimer);
    debTimer = setTimeout(function () {
      api('/calcular-consumo', state.uso).then(function (j) { state.consumo = j; var o = document.getElementById('memhid-consumo'); if (o) o.innerHTML = consumoHtml(j); })
        .catch(function (e) { var o = document.getElementById('memhid-consumo'); if (o) o.innerHTML = '<span style="color:' + COR.erro + ';">' + esc(e.message) + '</span>'; });
    }, 350);
  }

  /* PASSO 4 */
  function tabelaEditavel(titulo, linhas, cols, onAdd) {
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;' }, [titulo]));
    var tbl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:12px;' });
    var thead = h('tr', {});
    cols.forEach(function (c) { thead.appendChild(h('th', { style: 'text-align:left;padding:4px 6px;color:var(--text-muted,#888);border-bottom:1px solid var(--border,#333);' }, [c.label])); });
    thead.appendChild(h('th', { style: 'width:28px;' }, ['']));
    tbl.appendChild(thead);
    linhas.forEach(function (linha, idx) {
      var tr = h('tr', {});
      var alerta = onAdd.flag && onAdd.flag(linha);
      if (alerta) tr.style.background = 'rgba(211,158,0,.12)';
      cols.forEach(function (c) {
        var inp = h('input', { style: INP + 'padding:5px 7px;', value: linha[c.key] == null ? '' : linha[c.key], type: c.type || 'text', step: c.step || null });
        inp.addEventListener('input', function () { linha[c.key] = c.type === 'number' ? num(inp.value) : inp.value; });
        tr.appendChild(h('td', { style: 'padding:3px 6px;' }, [inp]));
      });
      tr.appendChild(h('td', {}, [h('button', { style: 'background:none;border:none;color:' + COR.erro + ';cursor:pointer;font-size:15px;', onclick: function () { linhas.splice(idx, 1); render(); } }, ['x'])]));
      tbl.appendChild(tr);
      if (alerta) {
        var trA = h('tr', {});
        var td = h('td', { colspan: cols.length + 1, style: 'padding:2px 6px 8px;font-size:11px;color:' + COR.alerta + ';' });
        td.innerHTML = '&#9888; Item sem descricao identificada no Revit. Especifique manualmente.';
        td.appendChild(h('button', { style: BTN + 'padding:3px 8px;font-size:11px;margin-left:8px;', onclick: function () { sugerirItem(linha, idx); } }, ['Sugerir peca (IA)']));
        trA.appendChild(td); tbl.appendChild(trA);
      }
    });
    card.appendChild(tbl);
    card.appendChild(h('button', { style: BTN + 'margin-top:10px;', onclick: function () { onAdd.add(); render(); } }, ['+ Adicionar linha']));
    if (onAdd.rodape) card.appendChild(onAdd.rodape());
    return card;
  }
  function sugerirItem(linha, idx) {
    var ant = state.conexoes[idx - 1] || {}, prox = state.conexoes[idx + 1] || {};
    api('/identificar-item', { itemAnterior: ant.descricao || '', itemProximo: prox.descricao || '', dnEntrada: linha.dn_mm || ant.dn_mm || 0, dnSaida: prox.dn_mm || linha.dn_mm || 0 })
      .then(function (j) { linha.descricao = j.sugestao; render(); }).catch(function (e) { alert('Falha na sugestao: ' + e.message); });
  }
  function renderPasso4() {
    var box = h('div', {});
    box.appendChild(h('p', { style: 'margin:0 0 6px;font-weight:600;' }, ['Passo 4 - Conferencia das tabelas extraidas do PDF (edite o que precisar)']));
    box.appendChild(tabelaEditavel('Tabela 1 - Tubulacoes (PVC Soldavel)', state.tubulacoes,
      [{ label: 'DN (mm)', key: 'dn_mm', type: 'number' }, { label: 'Comprimento (m)', key: 'comprimento_m', type: 'number', step: '0.01' }],
      { add: function () { state.tubulacoes.push({ dn_mm: 25, comprimento_m: 0 }); }, rodape: function () {
        var tot = state.tubulacoes.reduce(function (s, t) { return s + num(t.comprimento_m); }, 0);
        var barras = state.tubulacoes.reduce(function (s, t) { return s + Math.ceil(num(t.comprimento_m) * 1.1 / 6); }, 0);
        return h('p', { style: 'margin:8px 0 0;font-size:12px;color:var(--text-muted,#888);' }, ['Subtotal: ' + fmt(tot) + ' m (+10%) -> ' + barras + ' barras de 6 m = ' + (barras * 6) + ' m a adquirir']);
      } }));
    box.appendChild(tabelaEditavel('Tabela 2 - Conexoes', state.conexoes,
      [{ label: 'Descricao', key: 'descricao' }, { label: 'DN (mm)', key: 'dn_mm', type: 'number' }, { label: 'Qtd', key: 'qtd', type: 'number' }],
      { add: function () { state.conexoes.push({ descricao: '', dn_mm: 25, qtd: 1 }); },
        flag: function (l) { var d = (l.descricao || '').toLowerCase(); return !d || d.indexOf('inexistente') >= 0 || d.indexOf('unknown') >= 0; },
        rodape: function () { var tot = state.conexoes.reduce(function (s, c) { return s + num(c.qtd); }, 0); return h('p', { style: 'margin:8px 0 0;font-size:12px;color:var(--text-muted,#888);' }, ['Subtotal conexoes: ' + tot + ' un']); } }));
    return box;
  }

  /* PASSO 5 */
  function entrada() { return { dadosObra: state.obra, dadosUso: state.uso, tubulacoes: state.tubulacoes, conexoes: state.conexoes, aparelhos: state.aparelhos }; }
  function renderPasso5() {
    var box = h('div', {});
    box.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;' }, ['Passo 5 - Revisao final e geracao']));
    var r = state.resumo;
    if (!r) { box.appendChild(h('div', { id: 'memhid-resumo', style: CARD }, ['Calculando resumo...'])); return box; }
    var card = h('div', { style: CARD });
    var linhas = [['Consumo diario', r.consumoDiario + ' L/dia'], ['Reservatorio adotado', r.volumeReservatorio + ' L'], ['Soma de pesos', fmt(r.somaPesos)], ['Vazao total', fmt(r.vazaoTotal_ls, 3) + ' L/s'], ['Aparelhos', r.totalAparelhos + ' un'], ['Tubulacoes', fmt(r.totalTubos_m) + ' m'], ['Conexoes', r.totalConexoes + ' un'], ['Registros', r.totalRegistros + ' un'], ['Insumos', r.totalInsumos + ' un']];
    card.appendChild(h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;' }, linhas.map(function (l) { return h('div', { html: '<div style="font-size:11px;color:var(--text-muted,#888);">' + l[0] + '</div><div style="font-size:16px;color:' + COR.verde + ';font-weight:600;">' + l[1] + '</div>' }); })));
    var sn = r.statusNormativo || {};
    var checks = [['Pressao dinamica >= 10 kPa', sn.pressaoDinamicaOK], ['Pressao estatica <= 400 kPa', sn.pressaoEstaticaOK], ['Velocidade <= 3,0 m/s', sn.velocidadeOK], ['Reservatorio >= consumo', sn.reservatorioOK], ['Registros de manobra', sn.registrosOK]];
    var st = h('div', { style: 'margin-top:14px;display:grid;gap:4px;' });
    checks.forEach(function (c) { st.appendChild(h('div', { style: 'font-size:13px;color:' + (c[1] ? COR.verde : COR.erro) + ';' }, [(c[1] ? '✅ ' : '❌ ') + c[0]])); });
    card.appendChild(st);
    (r.alertas || []).forEach(function (a) { card.appendChild(h('div', { style: 'margin-top:6px;font-size:12px;color:' + COR.alerta + ';background:rgba(211,158,0,.1);padding:6px 8px;border-radius:6px;' }, ['⚠ ' + a])); });
    box.appendChild(card);
    box.appendChild(state.gerado ? blocoGerado() : h('button', { id: 'memhid-gerar', style: BTN_OK + 'font-size:15px;padding:12px 22px;', onclick: gerar }, ['Gerar Memorial + Quantitativo']));
    return box;
  }
  function recalcResumo() {
    api('/calcular-resumo', entrada()).then(function (j) { state.resumo = j; render(); })
      .catch(function (e) { var o = document.getElementById('memhid-resumo'); if (o) o.innerHTML = '<span style="color:' + COR.erro + ';">' + esc(e.message) + '</span>'; });
  }
  function gerar() {
    var b = document.getElementById('memhid-gerar');
    if (b) { b.disabled = true; b.textContent = 'Gerando PDFs...'; }
    api('/gerar', entrada()).then(function (j) { state.gerado = j; render(); })
      .catch(function (e) { alert('Falha ao gerar: ' + e.message); if (b) { b.disabled = false; b.textContent = 'Gerar Memorial + Quantitativo'; } });
  }
  function blocoGerado() {
    var g = state.gerado;
    var card = h('div', { style: CARD + 'border-color:' + COR.verde + ';' });
    card.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;color:' + COR.verde + ';' }, ['✅ Memorial #' + (g.codigo || g.id) + ' gerado']));
    var links = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;' });
    links.appendChild(h('a', { href: g.urlMemorial, target: '_blank', style: BTN + 'text-decoration:none;' }, ['PDF-A Memorial']));
    links.appendChild(h('a', { href: g.urlQuantitativo, target: '_blank', style: BTN + 'text-decoration:none;' }, ['PDF-B Lista de Materiais']));
    card.appendChild(links);
    var tel = h('input', { style: INP + 'max-width:200px;display:inline-block;width:auto;', placeholder: 'WhatsApp (DDD+numero)' });
    card.appendChild(h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;' }, [tel, h('button', { style: BTN, onclick: function () { enviar('whatsapp', { telefone: tel.value.trim() }); } }, ['Enviar WhatsApp'])]));
    var chat = h('input', { style: INP + 'max-width:200px;display:inline-block;width:auto;', placeholder: 'Telegram chatId (opcional)' });
    card.appendChild(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [chat, h('button', { style: BTN, onclick: function () { enviar('telegram', { chatId: chat.value.trim() }); } }, ['Enviar Telegram'])]));
    card.appendChild(h('div', { id: 'memhid-envio', style: 'margin-top:8px;font-size:12px;' }, ['']));
    return card;
  }
  function enviar(canal, body) {
    var out = document.getElementById('memhid-envio');
    if (out) out.innerHTML = 'Enviando...';
    api('/' + state.gerado.id + '/enviar-' + canal, body)
      .then(function (j) { if (out) out.innerHTML = '<span style="color:' + COR.verde + ';">✅ ' + j.enviados + ' arquivo(s) enviado(s).</span>'; })
      .catch(function (e) { if (out) out.innerHTML = '<span style="color:' + COR.erro + ';">' + esc(e.message) + '</span>'; });
  }

  /* AUTO-LAUNCHER: injeta um botao no topo da aba Memoriais (#view-memoriais). */
  function montarLauncher() {
    var view = document.getElementById('view-memoriais');
    if (!view) return;
    if (document.getElementById('memhid-launch')) return;
    if (view.getAttribute('data-memhid-active') === '1') return;
    var btn = h('button', { id: 'memhid-launch', style: BTN_OK + 'margin:0 0 14px;', onclick: function () {
      view.setAttribute('data-memhid-active', '1');
      var prefill = {};
      try {
        var gv = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
        prefill.obra = {
          titulo: gv('memObraTitulo') || 'Residencia Unifamiliar', endereco: gv('memObraEndereco'),
          municipio: gv('memObraMunicipio') || 'Acailandia', uf: gv('memObraUf') || 'MA',
          proprietario: gv('memProprietario'), cpfCnpj: gv('memCpfCnpj'),
          areaM2: num(gv('memAreaConstr')), nPavimentos: num(gv('memPavimentos'), 1), prancha: gv('memPrancha') || 'PH-03',
        };
      } catch (e) { /* sem Passos 1-2: usa defaults */ }
      montar(view, { prefill: prefill });
    } }, ['📐 Abrir Wizard NBR 5626 (Passos 3-5)']);
    view.insertBefore(btn, view.firstChild);
  }
  setInterval(montarLauncher, 1000);
  if (document.readyState !== 'loading') montarLauncher();
  else document.addEventListener('DOMContentLoaded', montarLauncher);

  window.MemHidWizard = { montar: montar };
})();
