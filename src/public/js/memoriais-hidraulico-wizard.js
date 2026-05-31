/* v3.50.0: Wizard UNIFICADO do Memorial Hidraulico (NBR 5626) - 7 passos, entrada unica.
 * Auto-suficiente: coleta dados da obra dentro do proprio wizard (nao depende de campos externos).
 * Sobrescreve window.abrirWizardHidraulico -> o card da disciplina abre este wizard.
 * NAO injeta launcher proprio (sem duplicidade). Mantem Editar/Excluir/PDF no historico.
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
  var PASSOS = [['1','Upload PDF'],['2','Dados da obra'],['3','Dados hidraulicos'],['4','Aparelhos'],['5','Materiais'],['6','Revisao'],['7','Geracao']];
  var APARELHOS = [['bacia_caixa_acoplada','Bacia c/ caixa acoplada'],['lavatorio','Lavatorio'],['chuveiro','Chuveiro'],['ducha_higienica','Ducha higienica'],['pia_cozinha','Pia de cozinha'],['tanque','Tanque'],['maquina_lavar','Maquina de lavar'],['torneira_geral','Torneira geral']];

  var state, root, debTimer;

  function defaults() {
    return {
      passo: 1,
      pdfNome: '',
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
    if (opts && opts.passo) state.passo = opts.passo;
    render();
  }
  function fecharWizard() {
    var view = document.getElementById('view-memoriais');
    if (view) view.removeAttribute('data-memhid-active');
    if (typeof window.renderMemoriaisQuantitativos === 'function') window.renderMemoriaisQuantitativos();
    else if (view) view.innerHTML = '';
  }
  function stepper() {
    return h('div', { style: 'display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;' }, PASSOS.map(function (p) {
      var n = parseInt(p[0], 10), atual = state.passo === n, feito = state.passo > n;
      var bg = atual ? COR.verde : feito ? 'rgba(16,185,129,.18)' : 'var(--bg-elev,#1c1c1c)';
      var fg = atual ? '#06281c' : feito ? COR.verde : 'var(--text-muted,#888)';
      return h('div', { style: 'flex:1;min-width:96px;padding:7px 6px;border-radius:8px;text-align:center;font-size:11px;font-weight:600;background:' + bg + ';color:' + fg + ';border:1px solid var(--border,#333);' }, [(feito ? '✓ ' : n + '. ') + p[1]]);
    }));
  }
  function podeAvancar() {
    if (state.passo === 2) {
      if (!state.obra.titulo || !state.obra.titulo.trim()) { alert('Informe o titulo da obra (Passo 2).'); return false; }
      if (!state.obra.proprietario || !state.obra.proprietario.trim()) { alert('Informe o proprietario (Passo 2).'); return false; }
      if (!(num(state.obra.areaM2) > 0)) { alert('Informe a area construida (Passo 2).'); return false; }
    }
    return true;
  }
  function navBtns() {
    var box = h('div', { style: 'display:flex;justify-content:space-between;margin-top:16px;' });
    box.appendChild(h('button', { style: BTN, onclick: function () { if (state.passo > 1) { state.passo--; render(); } else { fecharWizard(); } } }, [state.passo > 1 ? '< Voltar' : 'Fechar']));
    box.appendChild(state.passo < 7 ? h('button', { style: BTN_OK, onclick: function () { if (!podeAvancar()) return; state.passo++; render(); if (state.passo === 3) recalcConsumo(); if (state.passo === 6) recalcResumo(); } }, ['Avancar >']) : h('span', {}, ['']));
    return box;
  }
  function render() {
    root.innerHTML = '';
    var wrap = h('div', { style: 'max-width:920px;margin:0 auto;' });
    var head = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;' });
    head.appendChild(h('h2', { style: 'margin:0 0 4px;' }, ['Memorial Hidraulico - NBR 5626']));
    head.appendChild(h('button', { style: BTN, onclick: fecharWizard }, ['← Voltar a lista']));
    wrap.appendChild(head);
    wrap.appendChild(h('p', { style: 'margin:0 0 14px;font-size:12px;color:var(--text-muted,#888);' }, ['Wizard unico de 7 passos: do upload a geracao dos PDFs com cabecalho completo da obra.']));
    wrap.appendChild(stepper());
    var r = state.passo;
    wrap.appendChild(r === 1 ? renderPasso1() : r === 2 ? renderPasso2() : r === 3 ? renderPasso3() : r === 4 ? renderPasso4() : r === 5 ? renderPasso5() : r === 6 ? renderPasso6() : renderPasso7());
    wrap.appendChild(navBtns());
    root.appendChild(wrap);
  }
  function campo(label, valor, oninput, attrs) {
    var inp = h('input', Object.assign({ style: INP, value: valor }, attrs || {}));
    inp.addEventListener('input', function () { oninput(inp.value); });
    return h('label', { style: 'display:block;font-size:11px;color:var(--text-muted,#888);margin-bottom:10px;' }, [label, inp]);
  }

  /* PASSO 1 - Upload PDF (opcional) */
  function renderPasso1() {
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 8px;font-weight:600;' }, ['Passo 1 - Upload do PDF da planta (opcional)']));
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-size:12px;color:var(--text-muted,#888);' }, ['Anexe o PDF do projeto (Revit) para referencia. A extracao automatica de metadados entra em release futura; por ora preencha os dados no Passo 2.']));
    var inp = h('input', { type: 'file', accept: '.pdf', style: 'font-size:12px;' });
    var fb = h('div', { id: 'memhid-pdf-fb', style: 'margin-top:8px;font-size:12px;color:var(--text-muted,#888);' }, [state.pdfNome ? '📎 ' + state.pdfNome : '']);
    inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; if (f) { state.pdfNome = f.name; fb.innerHTML = '<span style="color:' + COR.verde + ';">📎 ' + esc(f.name) + ' anexado (' + Math.round(f.size / 1024) + ' KB)</span>'; } });
    card.appendChild(inp); card.appendChild(fb);
    card.appendChild(h('p', { style: 'margin:12px 0 0;font-size:12px;' }, ['Pode avancar sem anexar — o upload e opcional.']));
    return card;
  }

  /* PASSO 2 - Dados da obra */
  function renderPasso2() {
    var o = state.obra;
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-weight:600;' }, ['Passo 2 - Dados da obra (vao no cabecalho dos PDFs)']));
    card.appendChild(campo('Titulo da obra *', o.titulo, function (v) { o.titulo = v; }));
    card.appendChild(campo('Endereco', o.endereco, function (v) { o.endereco = v; }, { placeholder: 'Loteamento ..., Quadra X, Lote Y' }));
    var g1 = h('div', { style: 'display:grid;grid-template-columns:2fr 1fr;gap:0 14px;' });
    g1.appendChild(campo('Municipio', o.municipio, function (v) { o.municipio = v; }));
    g1.appendChild(campo('UF', o.uf, function (v) { o.uf = v; }, { maxlength: '2' }));
    card.appendChild(g1);
    var g2 = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 14px;' });
    g2.appendChild(campo('Proprietario *', o.proprietario, function (v) { o.proprietario = v; }, { placeholder: 'Nome completo' }));
    g2.appendChild(campo('CPF/CNPJ', o.cpfCnpj, function (v) { o.cpfCnpj = v; }, { placeholder: '123.456.789-00' }));
    card.appendChild(g2);
    var g3 = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0 14px;' });
    g3.appendChild(campo('Area construida (m2) *', o.areaM2, function (v) { o.areaM2 = num(v); }, { type: 'number', step: '0.01' }));
    g3.appendChild(campo('No pavimentos', o.nPavimentos, function (v) { o.nPavimentos = num(v, 1); }, { type: 'number', min: '1' }));
    g3.appendChild(campo('Prancha', o.prancha, function (v) { o.prancha = v; }, { placeholder: 'PH-03' }));
    g3.appendChild(campo('TRT/ART no', o.trtNumero, function (v) { o.trtNumero = v; }));
    card.appendChild(g3);
    card.appendChild(h('p', { style: 'margin:4px 0 0;font-size:11px;color:var(--text-muted,#888);' }, ['* Campos obrigatorios para gerar o memorial.']));
    return card;
  }

  /* PASSO 3 - Dados hidraulicos */
  function renderPasso3() {
    var u = state.uso;
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

  /* PASSO 4 - Aparelhos (pesos NBR 5626) */
  function renderPasso4() {
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-weight:600;' }, ['Passo 4 - Aparelhos hidraulicos (pesos relativos NBR 5626)']));
    var byTipo = {};
    state.aparelhos.forEach(function (a) { byTipo[a.tipo] = a; });
    var g = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 14px;' });
    APARELHOS.forEach(function (ap) {
      var reg = byTipo[ap[0]]; if (!reg) { reg = { tipo: ap[0], qtd: 0 }; state.aparelhos.push(reg); }
      g.appendChild(campo(ap[1], reg.qtd, function (v) { reg.qtd = num(v, 0); }, { type: 'number', min: '0' }));
    });
    card.appendChild(g);
    card.appendChild(h('p', { style: 'margin:4px 0 0;font-size:11px;color:var(--text-muted,#888);' }, ['Os pesos relativos definem a vazao de projeto (Q = 0,3 x raiz(soma dos pesos)).']));
    return card;
  }

  /* PASSO 5 - Materiais (tabelas) */
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
  function renderPasso5() {
    var box = h('div', {});
    box.appendChild(h('p', { style: 'margin:0 0 6px;font-weight:600;' }, ['Passo 5 - Materiais: tubulacoes e conexoes (edite o que precisar)']));
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

  /* PASSO 6 - Revisao & calculo */
  function entrada() { return { dadosObra: state.obra, dadosUso: state.uso, tubulacoes: state.tubulacoes, conexoes: state.conexoes, aparelhos: state.aparelhos }; }
  function renderPasso6() {
    var box = h('div', {});
    box.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;' }, ['Passo 6 - Revisao final e verificacao normativa']));
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
    card.appendChild(h('p', { style: 'margin:12px 0 0;font-size:12px;color:var(--text-muted,#888);' }, ['Confira os numeros e avance para o Passo 7 para gerar os PDFs.']));
    box.appendChild(card);
    return box;
  }
  function recalcResumo() {
    api('/calcular-resumo', entrada()).then(function (j) { state.resumo = j; if (state.passo === 6) render(); })
      .catch(function (e) { var o = document.getElementById('memhid-resumo'); if (o) o.innerHTML = '<span style="color:' + COR.erro + ';">' + esc(e.message) + '</span>'; });
  }

  /* PASSO 7 - Geracao & envio */
  function renderPasso7() {
    var box = h('div', {});
    box.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;' }, ['Passo 7 - Geracao dos PDFs e envio']));
    if (!state.gerado) {
      var card = h('div', { style: CARD });
      card.appendChild(h('p', { style: 'margin:0 0 12px;font-size:13px;' }, ['Obra: ' + esc(state.obra.titulo) + ' — ' + esc(state.obra.proprietario || 's/ proprietario') + '. Gera o Memorial Descritivo (PDF-A) e a Lista de Materiais (PDF-B) com timbre Romatec.']));
      card.appendChild(h('button', { id: 'memhid-gerar', style: BTN_OK + 'font-size:15px;padding:12px 22px;', onclick: gerar }, ['Gerar Memorial + Quantitativo']));
      box.appendChild(card);
    } else {
      box.appendChild(blocoGerado());
    }
    return box;
  }
  function gerar() {
    if (!state.obra.titulo || !state.obra.proprietario || !(num(state.obra.areaM2) > 0)) { alert('Dados da obra incompletos (Passo 2): titulo, proprietario e area sao obrigatorios.'); state.passo = 2; render(); return; }
    var b = document.getElementById('memhid-gerar');
    if (b) { b.disabled = true; b.textContent = 'Gerando PDFs...'; }
    api('/gerar', entrada()).then(function (j) { state.gerado = j; render(); })
      .catch(function (e) { alert('Falha ao gerar: ' + e.message); if (b) { b.disabled = false; b.textContent = 'Gerar Memorial + Quantitativo'; } });
  }
  function blocoGerado() {
    var g = state.gerado;
    var card = h('div', { style: CARD + 'border-color:' + COR.verde + ';' });
    card.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;color:' + COR.verde + ';' }, ['✅ Memorial #' + (g.codigo || g.id) + ' gerado e salvo']));
    var links = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;' });
    links.appendChild(h('a', { href: g.urlMemorial, target: '_blank', style: BTN + 'text-decoration:none;' }, ['PDF-A Memorial']));
    links.appendChild(h('a', { href: g.urlQuantitativo, target: '_blank', style: BTN + 'text-decoration:none;' }, ['PDF-B Lista de Materiais']));
    card.appendChild(links);
    var tel = h('input', { style: INP + 'max-width:200px;display:inline-block;width:auto;', placeholder: 'WhatsApp (DDD+numero)' });
    card.appendChild(h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;' }, [tel, h('button', { style: BTN, onclick: function () { enviar('whatsapp', { telefone: tel.value.trim() }); } }, ['Enviar WhatsApp'])]));
    var chat = h('input', { style: INP + 'max-width:200px;display:inline-block;width:auto;', placeholder: 'Telegram chatId (opcional)' });
    card.appendChild(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [chat, h('button', { style: BTN, onclick: function () { enviar('telegram', { chatId: chat.value.trim() }); } }, ['Enviar Telegram'])]));
    card.appendChild(h('div', { id: 'memhid-envio', style: 'margin-top:8px;font-size:12px;' }, ['']));
    var nv = h('button', { style: BTN + 'margin-top:14px;', onclick: fecharWizard }, ['Concluir e voltar a lista']);
    card.appendChild(nv);
    return card;
  }
  function enviar(canal, body) {
    var out = document.getElementById('memhid-envio');
    if (out) out.innerHTML = 'Enviando...';
    api('/' + state.gerado.id + '/enviar-' + canal, body)
      .then(function (j) { if (out) out.innerHTML = '<span style="color:' + COR.verde + ';">✅ ' + (j.enviados != null ? j.enviados : '') + ' arquivo(s) enviado(s).</span>'; })
      .catch(function (e) { if (out) out.innerHTML = '<span style="color:' + COR.erro + ';">' + esc(e.message) + '</span>'; });
  }

  /* ---------- ENTRADA UNICA + BOTOES EDITAR/EXCLUIR NO HISTORICO ---------- */
  function abrir(prefill, passo) {
    var view = document.getElementById('view-memoriais');
    if (!view) return;
    view.setAttribute('data-memhid-active', '1');
    montar(view, { prefill: prefill || {}, passo: passo || 1 });
  }
  // Sobrescreve a funcao do obras.html: o card "Hidraulico" passa a abrir este wizard de 7 passos.
  window.abrirWizardHidraulico = function () { abrir({}, 1); };
  (window.MemWizards = window.MemWizards || {}).hidraulico = function () { abrir({}, 1); };
  if (!window.__memDispatchInstalled) { window.__memDispatchInstalled = true; document.addEventListener('click', function (e) { var t = e.target, b = t && t.closest ? t.closest('[data-mem-disc]') : null; if (!b || b.disabled) return; var d = b.getAttribute('data-mem-disc'); var fn = (window.MemWizards || {})[d]; if (typeof fn === 'function') { e.stopImmediatePropagation(); e.preventDefault(); fn(); } }, true); }

  var _memLista = null, _memListaT = 0;
  function listaMemoriais() {
    var agora = Date.now();
    if (_memLista && agora - _memListaT < 4000) return Promise.resolve(_memLista);
    return fetch(API + '?limite=200', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : { data: [] }; })
      .then(function (j) { _memLista = j.data || j.items || []; _memListaT = agora; return _memLista; })
      .catch(function () { return _memLista || []; });
  }
  function btnMini(label, cor, onclick) { return h('button', { style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + cor + ';background:transparent;color:' + cor + ';cursor:pointer;font-size:11px;margin-left:6px;', onclick: onclick }, [label]); }
  function linkMini(label, href) { return h('a', { href: href, target: '_blank', style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + COR.azul + ';background:transparent;color:#7aa7d9;text-decoration:none;font-size:11px;margin-left:6px;' }, [label]); }
  function excluirMemorial(id, codigo, card) {
    if (!confirm('Excluir o memorial ' + codigo + '? Some da listagem (soft delete).')) return;
    fetch(API + '/' + id, { method: 'DELETE', credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); if (card && card.parentNode) card.parentNode.removeChild(card); _memLista = null; })
      .catch(function (e) { alert('Falha ao excluir: ' + e.message); });
  }
  function editarMemorial(id) {
    fetch(API + '/' + id + '/dados', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (j) { var d = j.dados || {}; abrir({ obra: d.dadosObra || {}, uso: d.dadosUso || {}, tubulacoes: d.tubulacoes, conexoes: d.conexoes, aparelhos: d.aparelhos }, 2); })
      .catch(function (e) { alert('Falha ao abrir: ' + e.message); });
  }
  function injetarBotoesHistorico() {
    var view = document.getElementById('view-memoriais');
    if (!view) return;
    if (view.getAttribute('data-memhid-active') === '1') return;
    var cards = view.querySelectorAll('.card');
    if (!cards.length) return;
    listaMemoriais().then(function (lista) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        if (card.getAttribute('data-memhid-btns') === '1') continue;
        var p = card.querySelector('p');
        if (!p) continue;
        var m = (p.textContent || '').match(/MEM-\S+/);
        if (!m) continue;
        var reg = lista.filter(function (x) { return x.codigo === m[0]; })[0];
        if (!reg) continue;
        card.setAttribute('data-memhid-btns', '1');
        var bar = h('div', { style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:0;align-items:center;' });
        bar.appendChild(linkMini('Memorial PDF', API + '/' + reg.id + '/memorial.pdf'));
        bar.appendChild(linkMini('Lista PDF', API + '/' + reg.id + '/quantitativo.pdf'));
        (function (id, cod, cardEl) {
          bar.appendChild(btnMini('Editar', COR.verde, function () { editarMemorial(id); }));
          bar.appendChild(btnMini('Excluir', COR.erro, function () { excluirMemorial(id, cod, cardEl); }));
        })(reg.id, m[0], card);
        card.appendChild(bar);
      }
    });
  }
  setInterval(injetarBotoesHistorico, 1200);
  if (document.readyState !== 'loading') injetarBotoesHistorico();
  else document.addEventListener('DOMContentLoaded', injetarBotoesHistorico);

  window.MemHidWizard = { montar: montar, abrir: abrir };
})();
