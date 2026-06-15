/* v3.50.0: Wizard UNIFICADO Memorial Eletrico (NBR 5410) - 3 passos (Obra->Dados->Geracao).
 * Entrada unica pelo card da disciplina (despacho por captura). Sem launcher no topo.
 * Auto-suficiente: coleta dados da obra internamente -> PDF sempre com cabecalho completo.
 * v3.66.0: Passo 0 (Upload da Planta PE) + Passo de Revisao dos dados extraidos. */
(function () {
  'use strict';
  var API = '/api/memoriais/eletrico', SLUG = 'eletrico';
  function h(tag, attrs, kids) { var e = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function (k) { if (k === 'style') e.style.cssText = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]); }); (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }); return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"']/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d || 0); }
  function fmt(n, d) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
  async function api(path, body) { var r = await fetch(API + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.status === 401) { window.location.href = '/login'; throw new Error('nao autenticado'); } var j = await r.json().catch(function () { return {}; }); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }
  var COR = { verde: '#10b981', azul: '#1F4E79', erro: '#dc2626', alerta: '#d39e00', ac: '#f5b301', amber: '#f59e0b' };
  var BTN = 'padding:9px 16px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg-elev,#1c1c1c);color:var(--text,#eee);cursor:pointer;font-size:13px;';
  var BTN_OK = 'padding:10px 18px;border-radius:8px;border:none;background:' + COR.ac + ';color:#3a2c00;cursor:pointer;font-weight:700;font-size:14px;';
  var INP = 'width:100%;padding:7px 9px;border-radius:6px;border:1px solid var(--border,#333);background:var(--bg,#111);color:var(--text,#eee);font-size:13px;box-sizing:border-box;';
  var CARD = 'border:1px solid var(--border,#333);border-radius:10px;padding:16px;background:var(--bg-elev,#161616);margin-bottom:14px;';
  var GAUTO = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 14px;';

  /* Passos visiveis no stepper dependem de se temos extracao */
  function passosVisiveis() {
    if (state && state.extracao) {
      return [['0', 'Upload PE'], ['1', 'Dados da obra'], ['2', 'Dados eletricos'], ['R', 'Revisao'], ['3', 'Geracao']];
    }
    return [['0', 'Upload PE'], ['1', 'Dados da obra'], ['2', 'Dados eletricos'], ['3', 'Geracao']];
  }

  /* Mapeamento: passo state -> indice no stepper */
  function stepperIndex() {
    var p = state.passo;
    if (state.extracao) {
      // 0,1,2,'revisao',3
      var map = { 0: 0, 1: 1, 2: 2, revisao: 3, 3: 4 };
      return map[p] != null ? map[p] : 0;
    } else {
      var map2 = { 0: 0, 1: 1, 2: 2, 3: 3 };
      return map2[p] != null ? map2[p] : 0;
    }
  }

  var state, root;

  function defaults() {
    return { passo: 0,
      obra: { titulo: 'Residencia Unifamiliar', endereco: '', municipio: 'Acailandia', uf: 'MA', proprietario: '', cpfCnpj: '', areaM2: 0, nPavimentos: 1, prancha: 'PE-05', trtNumero: '' },
      uso: { tipoUso: 'residencial', tensaoNominalV: 220, tipoAlimentacao: 'bifasico', comprimentoRamalM: 30, cargas: [
        { tipo: 'tue_chuveiro', potencia_w: 5500, quantidade: 1 }, { tipo: 'tue_ar_condicionado', potencia_w: 1400, quantidade: 1 }, { tipo: 'tue_maquina_lavar', potencia_w: 1500, quantidade: 1 } ] },
      extracao: null,
      resumo: null, gerado: null };
  }
  function montar(container, opts) { root = container; state = defaults(); if (opts && opts.prefill) { if (opts.prefill.obra) Object.assign(state.obra, opts.prefill.obra); if (opts.prefill.uso) Object.assign(state.uso, opts.prefill.uso); } if (opts && opts.passo) state.passo = opts.passo; render(); }
  function fechar() { var v = document.getElementById('view-memoriais'); if (v) v.removeAttribute('data-mem' + SLUG + '-active'); if (typeof window.renderMemoriaisQuantitativos === 'function') window.renderMemoriaisQuantitativos(); else if (v) v.innerHTML = ''; }
  function campo(label, valor, oninput, attrs) { var inp = h('input', Object.assign({ style: INP, value: valor }, attrs || {})); inp.addEventListener('input', function () { oninput(inp.value); }); return h('label', { style: 'display:block;font-size:11px;color:var(--text-muted,#888);margin-bottom:10px;' }, [label, inp]); }
  function sel(label, valor, opcoes, onchange) { var s = h('select', { style: INP }); opcoes.forEach(function (o) { var op = h('option', { value: o[0] }, [o[1]]); if (String(valor) === String(o[0])) op.selected = true; s.appendChild(op); }); s.addEventListener('change', function () { onchange(s.value); }); return h('label', { style: 'display:block;font-size:11px;color:var(--text-muted,#888);margin-bottom:10px;' }, [label, s]); }
  function stepper() {
    var passos = passosVisiveis();
    var idx = stepperIndex();
    return h('div', { style: 'display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;' }, passos.map(function (p, i) {
      var at = idx === i, fz = idx > i;
      return h('div', { style: 'flex:1;min-width:80px;padding:7px 6px;border-radius:8px;text-align:center;font-size:11px;font-weight:600;background:' + (at ? COR.ac : fz ? 'rgba(245,179,1,.18)' : 'var(--bg-elev,#1c1c1c)') + ';color:' + (at ? '#3a2c00' : fz ? COR.ac : 'var(--text-muted,#888)') + ';border:1px solid var(--border,#333);' }, [(fz ? '✓ ' : (i + 1) + '. ') + p[1]]);
    }));
  }

  /* ---- Passo 0: Upload da Planta PE ---- */
  function renderUpload() {
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 8px;font-weight:600;' }, ['Passo 0 - Upload da Planta Eletrica (PE) — opcional']));
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-size:12px;color:var(--text-muted,#888);' }, ['Envie o PDF da planta eletrica para pre-preencher os campos automaticamente via IA. Voce podera revisar e ajustar antes de gerar.']));

    var fileInput = h('input', { type: 'file', accept: 'application/pdf', style: 'display:block;margin-bottom:12px;color:var(--text,#eee);' });
    card.appendChild(fileInput);

    var statusDiv = h('div', { id: 'upload-pe-status', style: 'font-size:12px;margin-bottom:10px;' });
    card.appendChild(statusDiv);

    var btnExtrair = h('button', { style: BTN_OK, onclick: function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) { alert('Selecione um arquivo PDF.'); return; }
      btnExtrair.disabled = true;
      btnExtrair.textContent = 'Lendo a planta com IA...';
      statusDiv.innerHTML = '<span style="color:var(--text-muted,#888);">Lendo a planta com IA… aguarde.</span>';

      var fd = new FormData();
      fd.append('arquivo', f);
      fetch(API + '/extrair-pdf', { method: 'POST', credentials: 'include', body: fd })
        .then(function (r) {
          if (r.status === 401) { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); throw new Error('nao autenticado'); }
          return r.json().then(function (j) { return { ok: r.ok, j: j }; });
        })
        .then(function (res) {
          if (!res.ok || !res.j.ok) throw new Error(res.j && res.j.error ? res.j.error : 'Erro na extracao');
          var ex = res.j.extracao || {};
          state.extracao = ex;

          /* Pre-preenche obra */
          var ob = ex.obra || {};
          if (ob.titulo) state.obra.titulo = ob.titulo;
          if (ob.endereco) state.obra.endereco = ob.endereco;
          if (ob.municipio) state.obra.municipio = ob.municipio;
          if (ob.uf) state.obra.uf = ob.uf;
          if (ob.proprietario) state.obra.proprietario = ob.proprietario;
          if (ob.cpfCnpj) state.obra.cpfCnpj = ob.cpfCnpj;
          if (ob.areaConstruidaM2 != null) state.obra.areaM2 = ob.areaConstruidaM2;
          if (ob.areaLoteM2 != null) state.obra.areaLoteM2 = ob.areaLoteM2;
          if (ob.nPavimentos != null) state.obra.nPavimentos = ob.nPavimentos;
          if (ob.prancha) state.obra.prancha = ob.prancha;
          if (ob.dataProjeto) state.obra.dataProjeto = ob.dataProjeto;

          /* Pre-preenche uso */
          var al = ex.alimentacao || {};
          if (al.tipo) state.uso.tipoAlimentacao = al.tipo;
          if (al.tensaoV != null) state.uso.tensaoNominalV = al.tensaoV;
          if (al.piVA != null || al.pdVA != null) { /* deixa comprimento do ramal com default */ }

          state.passo = 1;
          render();
        })
        .catch(function (e) {
          btnExtrair.disabled = false;
          btnExtrair.textContent = 'Extrair dados';
          statusDiv.innerHTML = '<span style="color:' + COR.erro + ';">Falha: ' + esc(e.message) + '</span>';
        });
    } }, ['Extrair dados']);
    card.appendChild(btnExtrair);

    /* Resultado de confianca - mostrado apos extracao anterior se usuario voltou */
    if (state.extracao) {
      var conf = state.extracao.confianca;
      var pct = conf != null ? Math.round(conf * 100) : null;
      var confDiv = h('div', { style: 'margin-top:12px;padding:10px;border-radius:8px;background:rgba(245,179,1,.1);border:1px solid rgba(245,179,1,.3);' });
      if (pct != null) {
        confDiv.appendChild(h('div', { style: 'font-size:12px;font-weight:600;color:' + COR.ac + ';margin-bottom:6px;' }, ['Confianca da extracao: ' + pct + '%']));
      }
      var obs = state.extracao.observacoes || [];
      if (obs.length) {
        var ol = h('ul', { style: 'margin:4px 0 4px 16px;font-size:12px;color:var(--text-muted,#888);' });
        obs.forEach(function (o) { ol.appendChild(h('li', {}, [o])); });
        confDiv.appendChild(ol);
      }
      var divs = state.extracao.divergencias || [];
      if (divs.length) {
        confDiv.appendChild(h('div', { style: 'font-size:12px;font-weight:600;color:' + COR.amber + ';margin:8px 0 4px;' }, ['⚠ Divergencias:']));
        var dl = h('ul', { style: 'margin:0 0 0 16px;font-size:12px;color:' + COR.amber + ';' });
        divs.forEach(function (d) { dl.appendChild(h('li', {}, [d])); });
        confDiv.appendChild(dl);
      }
      card.appendChild(confDiv);
    }

    return card;
  }

  function obraCard() {
    var o = state.obra, card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-weight:600;' }, ['Passo 1 - Dados da obra (vao no cabecalho do PDF)']));

    /* Badge de extracao se tiver */
    if (state.extracao) {
      var conf = state.extracao.confianca;
      var pct = conf != null ? Math.round(conf * 100) : null;
      var badge = h('div', { style: 'margin-bottom:12px;padding:8px 12px;border-radius:8px;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);font-size:12px;color:' + COR.verde + ';' },
        ['✓ Campos pre-preenchidos pela extracao do PDF' + (pct != null ? ' (confianca: ' + pct + '%)' : '') + '. Confira e ajuste se necessario.']);
      card.appendChild(badge);

      /* Divergencias amber */
      var divs = state.extracao.divergencias || [];
      if (divs.length) {
        var dbox = h('div', { style: 'margin-bottom:12px;padding:8px 12px;border-radius:8px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);' });
        dbox.appendChild(h('div', { style: 'font-size:12px;font-weight:600;color:' + COR.amber + ';margin-bottom:4px;' }, ['⚠ Divergencias detectadas:']));
        var dl = h('ul', { style: 'margin:0 0 0 16px;font-size:12px;color:' + COR.amber + ';' });
        divs.forEach(function (d) { dl.appendChild(h('li', {}, [d])); });
        dbox.appendChild(dl);
        card.appendChild(dbox);
      }
    }

    card.appendChild(campo('Titulo da obra *', o.titulo, function (v) { o.titulo = v; }));
    card.appendChild(campo('Endereco', o.endereco, function (v) { o.endereco = v; }, { placeholder: 'Loteamento ..., Quadra X, Lote Y' }));
    var g1 = h('div', { style: 'display:grid;grid-template-columns:2fr 1fr;gap:0 14px;' }); g1.appendChild(campo('Municipio', o.municipio, function (v) { o.municipio = v; })); g1.appendChild(campo('UF', o.uf, function (v) { o.uf = v; }, { maxlength: '2' })); card.appendChild(g1);
    var g2 = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 14px;' }); g2.appendChild(campo('Proprietario *', o.proprietario, function (v) { o.proprietario = v; })); g2.appendChild(campo('CPF/CNPJ', o.cpfCnpj, function (v) { o.cpfCnpj = v; })); card.appendChild(g2);
    var g3 = h('div', { style: GAUTO }); g3.appendChild(campo('Area construida (m2) *', o.areaM2, function (v) { o.areaM2 = num(v); }, { type: 'number', step: '0.01' })); g3.appendChild(campo('No pavimentos', o.nPavimentos, function (v) { o.nPavimentos = num(v, 1); }, { type: 'number' })); g3.appendChild(campo('Prancha', o.prancha, function (v) { o.prancha = v; })); g3.appendChild(campo('TRT/ART no', o.trtNumero, function (v) { o.trtNumero = v; })); card.appendChild(g3);
    card.appendChild(h('p', { style: 'margin:4px 0 0;font-size:11px;color:var(--text-muted,#888);' }, ['* Obrigatorios para gerar o memorial.']));
    return card;
  }
  function podeAvancar() {
    if (state.passo === 1) { var o = state.obra; if (!o.titulo || !o.titulo.trim()) { alert('Informe o titulo da obra.'); return false; } if (!o.proprietario || !o.proprietario.trim()) { alert('Informe o proprietario.'); return false; } if (!(num(o.areaM2) > 0)) { alert('Informe a area construida.'); return false; } }
    return true;
  }

  /* Calcula o passo seguinte levando em conta se ha extracao */
  function proximoPasso(p) {
    if (p === 0) return 1;
    if (p === 1) return 2;
    if (p === 2) return state.extracao ? 'revisao' : 3;
    if (p === 'revisao') return 3;
    return 3;
  }
  function passoAnterior(p) {
    if (p === 0) return null;
    if (p === 1) return 0;
    if (p === 2) return 1;
    if (p === 'revisao') return 2;
    if (p === 3) return state.extracao ? 'revisao' : 2;
    return null;
  }

  function navBtns() {
    var box = h('div', { style: 'display:flex;justify-content:space-between;margin-top:16px;' });
    var prev = passoAnterior(state.passo);
    box.appendChild(h('button', { style: BTN, onclick: function () {
      if (prev !== null) { state.passo = prev; render(); } else { fechar(); }
    } }, [prev !== null ? '< Voltar' : 'Fechar']));

    /* No passo 0: botao "Pular" + a extracao e feita pelo proprio botao do card */
    if (state.passo === 0) {
      box.appendChild(h('button', { style: BTN, onclick: function () { state.passo = 1; render(); } }, ['Pular (preencher manual) >']));
    } else if (state.passo === 3) {
      box.appendChild(h('span', {}, ['']));
    } else {
      box.appendChild(h('button', { style: BTN_OK, onclick: function () {
        if (!podeAvancar()) return;
        var prox = proximoPasso(state.passo);
        state.passo = prox;
        render();
        if (state.passo === 3) recalc();
      } }, ['Avancar >']));
    }
    return box;
  }

  function render() {
    root.innerHTML = '';
    var wrap = h('div', { style: 'max-width:920px;margin:0 auto;' });
    var head = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;' });
    head.appendChild(h('h2', { style: 'margin:0 0 4px;' }, ['Memorial Eletrico - NBR 5410'])); head.appendChild(h('button', { style: BTN, onclick: fechar }, ['← Voltar a lista'])); wrap.appendChild(head);
    wrap.appendChild(h('p', { style: 'margin:0 0 14px;font-size:12px;color:var(--text-muted,#888);' }, ['Wizard unico: dados da obra, carga e geracao dos 2 PDFs.']));
    wrap.appendChild(stepper());
    var p = state.passo;
    var content;
    if (p === 0) content = renderUpload();
    else if (p === 1) content = obraCard();
    else if (p === 2) content = renderDados();
    else if (p === 'revisao') content = renderRevisao();
    else content = renderGeracao();
    wrap.appendChild(content);
    wrap.appendChild(navBtns()); root.appendChild(wrap);
  }

  var TIPOS = [['tue_chuveiro', 'Chuveiro'], ['tue_aquecedor', 'Aquecedor/boiler'], ['tue_ar_condicionado', 'Ar-condicionado'], ['tue_maquina_lavar', 'Maq. lavar/lava-loucas'], ['tue_forno_micro', 'Forno+microondas'], ['tue_outros', 'Outros TUE']];
  function renderDados() {
    var u = state.uso, card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-weight:600;' }, ['Passo 2 - Carga e alimentacao']));
    var g = h('div', { style: GAUTO });
    g.appendChild(sel('Tensao (V)', u.tensaoNominalV, [[127, '127'], [220, '220'], [380, '380']], function (v) { u.tensaoNominalV = num(v); }));
    g.appendChild(sel('Alimentacao', u.tipoAlimentacao, [['monofasico', 'Monofasico'], ['bifasico', 'Bifasico'], ['trifasico', 'Trifasico']], function (v) { u.tipoAlimentacao = v; }));
    g.appendChild(campo('Comprimento do ramal (m)', u.comprimentoRamalM, function (v) { u.comprimentoRamalM = num(v, 30); }, { type: 'number' }));
    g.appendChild(sel('Tipo de uso', u.tipoUso, [['residencial', 'Residencial'], ['comercial', 'Comercial']], function (v) { u.tipoUso = v; }));
    card.appendChild(g);
    card.appendChild(h('p', { style: 'margin:12px 0 6px;font-weight:600;font-size:13px;' }, ['Cargas especificas (TUE)']));
    var tbl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:12px;' });
    var thr = h('tr', {}); ['Tipo', 'Potencia (W)', 'Qtd', ''].forEach(function (t) { thr.appendChild(h('th', { style: 'text-align:left;padding:4px 6px;color:var(--text-muted,#888);' }, [t])); }); tbl.appendChild(thr);
    u.cargas.forEach(function (c, idx) { var tr = h('tr', {}); var ts = h('select', { style: INP + 'padding:5px 7px;' }); TIPOS.forEach(function (tp) { var op = h('option', { value: tp[0] }, [tp[1]]); if (c.tipo === tp[0]) op.selected = true; ts.appendChild(op); }); ts.addEventListener('change', function () { c.tipo = ts.value; }); tr.appendChild(h('td', { style: 'padding:3px 6px;' }, [ts])); var pot = h('input', { style: INP + 'padding:5px 7px;', type: 'number', value: c.potencia_w }); pot.addEventListener('input', function () { c.potencia_w = num(pot.value); }); tr.appendChild(h('td', { style: 'padding:3px 6px;' }, [pot])); var qt = h('input', { style: INP + 'padding:5px 7px;width:60px;', type: 'number', value: c.quantidade }); qt.addEventListener('input', function () { c.quantidade = num(qt.value, 1); }); tr.appendChild(h('td', { style: 'padding:3px 6px;' }, [qt])); tr.appendChild(h('td', {}, [h('button', { style: 'background:none;border:none;color:' + COR.erro + ';cursor:pointer;font-size:15px;', onclick: function () { u.cargas.splice(idx, 1); render(); } }, ['x'])])); tbl.appendChild(tr); });
    card.appendChild(tbl);
    card.appendChild(h('button', { style: BTN + 'margin-top:10px;', onclick: function () { u.cargas.push({ tipo: 'tue_outros', potencia_w: 1000, quantidade: 1 }); render(); } }, ['+ Adicionar carga']));
    return card;
  }

  /* ---- Passo Revisao: editar dados extraidos do PDF ---- */
  function renderRevisao() {
    var ex = state.extracao || {};
    var card = h('div', { style: CARD });
    card.appendChild(h('p', { style: 'margin:0 0 8px;font-weight:600;' }, ['Revisao dos dados extraidos do PDF']));
    card.appendChild(h('p', { style: 'margin:0 0 12px;font-size:12px;color:var(--text-muted,#888);' }, ['Confira e edite os dados antes de gerar. As alteracoes aqui serao enviadas ao backend junto com o pedido de geracao.']));

    /* Divergencias topo */
    var divs = ex.divergencias || [];
    if (divs.length) {
      var dbox = h('div', { style: 'margin-bottom:14px;padding:10px 12px;border-radius:8px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);' });
      dbox.appendChild(h('div', { style: 'font-size:12px;font-weight:600;color:' + COR.amber + ';margin-bottom:4px;' }, ['⚠ Divergencias detectadas — verifique:']));
      var dl = h('ul', { style: 'margin:0 0 0 16px;font-size:12px;color:' + COR.amber + ';' });
      divs.forEach(function (d) { dl.appendChild(h('li', {}, [d])); });
      dbox.appendChild(dl);
      card.appendChild(dbox);
    }

    /* Pontos */
    var pts = ex.pontos || {};
    var pontosSec = h('div', { style: CARD + 'margin-bottom:10px;' });
    pontosSec.appendChild(h('p', { style: 'margin:0 0 8px;font-weight:600;font-size:13px;' }, ['Pontos eletricos']));
    var pontosGrid = h('div', { style: GAUTO });
    var pontosFields = [
      ['iluminacao', 'Iluminacao'],
      ['tug10A', 'TUG 10A'],
      ['tue20A', 'TUE 20A'],
      ['interruptorSimples', 'Interruptor simples'],
      ['interruptorParalelo', 'Interruptor paralelo'],
      ['interruptorIntermediario', 'Interruptor intermediario'],
      ['conjuntos', 'Conjuntos'],
      ['tomadasPiso', 'Tomadas de piso']
    ];
    pontosFields.forEach(function (pf) {
      var key = pf[0], lbl = pf[1];
      pontosGrid.appendChild(campo(lbl, pts[key] != null ? pts[key] : 0, function (v) { ex.pontos = ex.pontos || {}; ex.pontos[key] = num(v, 0); }, { type: 'number', min: '0' }));
    });
    pontosSec.appendChild(pontosGrid);
    card.appendChild(pontosSec);

    /* Circuitos */
    var circs = ex.circuitos || [];
    var circSec = h('div', { style: CARD + 'margin-bottom:10px;' });
    circSec.appendChild(h('p', { style: 'margin:0 0 8px;font-weight:600;font-size:13px;' }, ['Circuitos']));
    var tbl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:11px;' });
    var hdr = h('tr', {});
    ['#', 'Descricao', 'Tipo', 'Disj.A', 'Cond.Fase mm2', 'Cond.Prot mm2', 'Pot.VA', 'Lance m', ''].forEach(function (t) {
      hdr.appendChild(h('th', { style: 'text-align:left;padding:4px 4px;color:var(--text-muted,#888);font-size:11px;white-space:nowrap;' }, [t]));
    });
    tbl.appendChild(hdr);

    function renderCircRow(c, idx) {
      var tr = h('tr', {});
      var inpId = h('input', { style: INP + 'padding:4px 6px;width:40px;', value: c.id != null ? c.id : idx + 1, type: 'number', min: '1' });
      inpId.addEventListener('input', function () { c.id = num(inpId.value, idx + 1); });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [inpId]));

      var inpDesc = h('input', { style: INP + 'padding:4px 6px;min-width:100px;', value: c.descricao || '' });
      inpDesc.addEventListener('input', function () { c.descricao = inpDesc.value; });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [inpDesc]));

      var selTipo = h('select', { style: INP + 'padding:4px 5px;' });
      [['ilum', 'Ilum'], ['tug', 'TUG'], ['tue', 'TUE']].forEach(function (opt) {
        var op = h('option', { value: opt[0] }, [opt[1]]);
        if (c.tipo === opt[0]) op.selected = true;
        selTipo.appendChild(op);
      });
      selTipo.addEventListener('change', function () { c.tipo = selTipo.value; });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [selTipo]));

      var inpDisj = h('input', { style: INP + 'padding:4px 6px;width:55px;', value: c.disjuntorA != null ? c.disjuntorA : '', type: 'number' });
      inpDisj.addEventListener('input', function () { c.disjuntorA = num(inpDisj.value); });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [inpDisj]));

      var inpFase = h('input', { style: INP + 'padding:4px 6px;width:60px;', value: c.condutorFaseMm2 != null ? c.condutorFaseMm2 : '', type: 'number', step: '0.5' });
      inpFase.addEventListener('input', function () { c.condutorFaseMm2 = num(inpFase.value); });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [inpFase]));

      var inpProt = h('input', { style: INP + 'padding:4px 6px;width:60px;', value: c.condutorProtecaoMm2 != null ? c.condutorProtecaoMm2 : '', type: 'number', step: '0.5' });
      inpProt.addEventListener('input', function () { c.condutorProtecaoMm2 = num(inpProt.value); });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [inpProt]));

      var inpPot = h('input', { style: INP + 'padding:4px 6px;width:65px;', value: c.potenciaVA != null ? c.potenciaVA : '', type: 'number' });
      inpPot.addEventListener('input', function () { c.potenciaVA = num(inpPot.value); });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [inpPot]));

      var inpLance = h('input', { style: INP + 'padding:4px 6px;width:55px;', value: c.lanceMedioM != null ? c.lanceMedioM : '', type: 'number', step: '0.5' });
      inpLance.addEventListener('input', function () { c.lanceMedioM = num(inpLance.value); });
      tr.appendChild(h('td', { style: 'padding:2px 4px;' }, [inpLance]));

      tr.appendChild(h('td', {}, [h('button', { style: 'background:none;border:none;color:' + COR.erro + ';cursor:pointer;font-size:14px;', onclick: function () { circs.splice(idx, 1); ex.circuitos = circs; render(); } }, ['x'])]));
      return tr;
    }

    circs.forEach(function (c, idx) { tbl.appendChild(renderCircRow(c, idx)); });
    circSec.appendChild(tbl);
    circSec.appendChild(h('button', { style: BTN + 'margin-top:8px;', onclick: function () {
      circs.push({ id: circs.length + 1, descricao: '', tipo: 'ilum', disjuntorA: 10, condutorFaseMm2: 1.5, condutorProtecaoMm2: 1.5, potenciaVA: 0, lanceMedioM: 0 });
      ex.circuitos = circs;
      render();
    } }, ['+ Adicionar circuito']));
    card.appendChild(circSec);

    /* Eletrodutos */
    var eletrodutos = ex.eletrodutos || [];
    if (eletrodutos.length) {
      var eletSec = h('div', { style: CARD + 'margin-bottom:10px;' });
      eletSec.appendChild(h('p', { style: 'margin:0 0 8px;font-weight:600;font-size:13px;' }, ['Eletrodutos']));
      var etbl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:11px;' });
      var ehdr = h('tr', {});
      ['Tipo', 'Diametro', 'Comprimento (m)'].forEach(function (t) { ehdr.appendChild(h('th', { style: 'text-align:left;padding:4px 6px;color:var(--text-muted,#888);' }, [t])); });
      etbl.appendChild(ehdr);
      eletrodutos.forEach(function (et) {
        var etr = h('tr', {});
        etr.appendChild(h('td', { style: 'padding:3px 6px;font-size:12px;' }, [et.tipo || '']));
        etr.appendChild(h('td', { style: 'padding:3px 6px;font-size:12px;' }, [et.diametro || '']));
        var inpComp = h('input', { style: INP + 'padding:4px 6px;width:80px;', value: et.comprimentoM != null ? et.comprimentoM : '', type: 'number', step: '0.1' });
        inpComp.addEventListener('input', function () { et.comprimentoM = num(inpComp.value); });
        etr.appendChild(h('td', { style: 'padding:3px 6px;' }, [inpComp]));
        etbl.appendChild(etr);
      });
      eletSec.appendChild(etbl);
      card.appendChild(eletSec);
    }

    /* Caixas */
    var caixas = ex.caixas || [];
    if (caixas.length) {
      var caixSec = h('div', { style: CARD + 'margin-bottom:10px;' });
      caixSec.appendChild(h('p', { style: 'margin:0 0 8px;font-weight:600;font-size:13px;' }, ['Caixas']));
      var ctbl = h('table', { style: 'width:100%;border-collapse:collapse;font-size:11px;' });
      var chdr = h('tr', {});
      ['Tipo', 'Qtd'].forEach(function (t) { chdr.appendChild(h('th', { style: 'text-align:left;padding:4px 6px;color:var(--text-muted,#888);' }, [t])); });
      ctbl.appendChild(chdr);
      caixas.forEach(function (cx) {
        var ctr = h('tr', {});
        ctr.appendChild(h('td', { style: 'padding:3px 6px;font-size:12px;' }, [cx.tipo || '']));
        var inpQtd = h('input', { style: INP + 'padding:4px 6px;width:70px;', value: cx.qtd != null ? cx.qtd : 0, type: 'number', min: '0' });
        inpQtd.addEventListener('input', function () { cx.qtd = num(inpQtd.value, 0); });
        ctr.appendChild(h('td', { style: 'padding:3px 6px;' }, [inpQtd]));
        ctbl.appendChild(ctr);
      });
      caixSec.appendChild(ctbl);
      card.appendChild(caixSec);
    }

    return card;
  }

  function entrada() {
    var body = { dadosObra: state.obra, dadosUso: state.uso };
    if (state.extracao) body.extracao = state.extracao;
    return body;
  }
  function renderGeracao() {
    var box = h('div', {}), r = state.resumo;
    if (!r) { box.appendChild(h('div', { id: 'mem' + SLUG + '-resumo', style: CARD }, ['Calculando...'])); return box; }
    var s = r.saida, dr = s.dimensionamento_ramal, card = h('div', { style: CARD });
    var linhas = [['Carga demandada', fmt(s.carga_demandada_kw, 2) + ' kW'], ['Corrente', fmt(s.corrente_projeto_A, 1) + ' A'], ['Condutor', fmt(dr.secao_condutor_mm2, 1) + ' mm2'], ['Disjuntor', dr.disjuntor_geral_A + ' A'], ['Queda', fmt(dr.queda_tensao_pct, 2) + ' %'], ['Circuitos', r.totais.circuitos + ' un']];
    card.appendChild(h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;' }, linhas.map(function (l) { return h('div', { html: '<div style="font-size:11px;color:var(--text-muted,#888);">' + l[0] + '</div><div style="font-size:16px;color:' + COR.ac + ';font-weight:600;">' + l[1] + '</div>' }); })));
    var sn = r.statusNormativo || {}, checks = [['Queda <= 4%', sn.quedaTensaoOK], ['DR obrigatorio (30mA)', sn.drObrigatorioAtendido], ['DPS surtos', sn.dpsObrigatorioAtendido], ['Aterramento', sn.aterramentoDefinido]];
    var st = h('div', { style: 'margin-top:14px;display:grid;gap:4px;' }); checks.forEach(function (c) { st.appendChild(h('div', { style: 'font-size:13px;color:' + (c[1] ? COR.verde : COR.erro) + ';' }, [(c[1] ? '✅ ' : '❌ ') + c[0]])); }); card.appendChild(st);
    (r.alertas || []).forEach(function (a) { card.appendChild(h('div', { style: 'margin-top:6px;font-size:12px;color:' + COR.alerta + ';background:rgba(211,158,0,.1);padding:6px 8px;border-radius:6px;' }, ['⚠ ' + a])); });
    box.appendChild(card);
    box.appendChild(state.gerado ? blocoGerado() : h('button', { id: 'mem' + SLUG + '-gerar', style: BTN_OK + 'font-size:15px;padding:12px 22px;', onclick: gerar }, ['Gerar Memorial + Quantitativo']));
    return box;
  }
  function recalc() { api('/calcular-resumo', entrada()).then(function (j) { state.resumo = j; if (state.passo === 3) render(); }).catch(function (e) { var o = document.getElementById('mem' + SLUG + '-resumo'); if (o) o.innerHTML = '<span style="color:' + COR.erro + ';">' + esc(e.message) + '</span>'; }); }
  function gerar() { if (!state.obra.titulo || !state.obra.proprietario || !(num(state.obra.areaM2) > 0)) { alert('Dados da obra incompletos (Passo 1).'); state.passo = 1; render(); return; } var b = document.getElementById('mem' + SLUG + '-gerar'); if (b) { b.disabled = true; b.textContent = 'Gerando PDFs...'; } api('/gerar', entrada()).then(function (j) { state.gerado = j; render(); }).catch(function (e) { alert('Falha: ' + e.message); if (b) { b.disabled = false; b.textContent = 'Gerar Memorial + Quantitativo'; } }); }
  function blocoGerado() {
    var g = state.gerado, card = h('div', { style: CARD + 'border-color:' + COR.ac + ';' });
    card.appendChild(h('p', { style: 'margin:0 0 10px;font-weight:600;color:' + COR.ac + ';' }, ['✅ Memorial #' + (g.codigo || g.id) + ' gerado e salvo']));
    var links = h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;' }); links.appendChild(h('a', { href: g.urlMemorial, target: '_blank', style: BTN + 'text-decoration:none;' }, ['Memorial PDF'])); links.appendChild(h('a', { href: g.urlQuantitativo, target: '_blank', style: BTN + 'text-decoration:none;' }, ['Lista PDF'])); card.appendChild(links);
    var tel = h('input', { style: INP + 'max-width:200px;display:inline-block;width:auto;', placeholder: 'WhatsApp (DDD+numero)' });
    card.appendChild(h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' }, [tel, h('button', { style: BTN, onclick: function () { api('/' + g.id + '/enviar-whatsapp', { telefone: tel.value.trim() }).then(function () { alert('Enviado!'); }).catch(function (e) { alert(e.message); }); } }, ['Enviar WhatsApp'])]));
    card.appendChild(h('button', { style: BTN + 'margin-top:14px;', onclick: fechar }, ['Concluir e voltar a lista']));
    return card;
  }
  /* entrada unica + historico */
  function abrir(prefill, passo) { var view = document.getElementById('view-memoriais'); if (!view) return; view.setAttribute('data-mem' + SLUG + '-active', '1'); montar(view, { prefill: prefill || {}, passo: passo || 0 }); }
  (window.MemWizards = window.MemWizards || {})[SLUG] = function () { abrir({}, 0); };
  if (!window.__memDispatchInstalled) { window.__memDispatchInstalled = true; document.addEventListener('click', function (e) { var t = e.target, b = t && t.closest ? t.closest('[data-mem-disc]') : null; if (!b || b.disabled) return; var d = b.getAttribute('data-mem-disc'); var fn = (window.MemWizards || {})[d]; if (typeof fn === 'function') { e.stopImmediatePropagation(); e.preventDefault(); fn(); } }, true); }
  var lista = null, listaT = 0;
  function getLista() { var a = Date.now(); if (lista && a - listaT < 4000) return Promise.resolve(lista); return fetch(API + '?limite=200', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : { data: [] }; }).then(function (j) { lista = j.data || j.items || []; listaT = a; return lista; }).catch(function () { return lista || []; }); }
  function bm(label, cor, onclick) { return h('button', { style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + cor + ';background:transparent;color:' + cor + ';cursor:pointer;font-size:11px;margin-left:6px;', onclick: onclick }, [label]); }
  function injetar() { var view = document.getElementById('view-memoriais'); if (!view) return; if (view.getAttribute('data-mem' + SLUG + '-active') === '1') return; var cards = view.querySelectorAll('.card'); if (!cards.length) return; getLista().then(function (ls) { for (var i = 0; i < cards.length; i++) { var card = cards[i]; if (card.getAttribute('data-mem' + SLUG + '-btns') === '1' || card.getAttribute('data-mem-btns') === '1') continue; var p = card.querySelector('p'); if (!p) continue; var m = (p.textContent || '').match(/MEM-\S+/); if (!m) continue; var reg = ls.filter(function (x) { return x.codigo === m[0]; })[0]; if (!reg) continue; card.setAttribute('data-mem' + SLUG + '-btns', '1'); card.setAttribute('data-mem-btns', '1'); var bar = h('div', { style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:0;align-items:center;' }); bar.appendChild(h('a', { href: API + '/' + reg.id + '/memorial.pdf', target: '_blank', style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + COR.azul + ';background:transparent;color:#7aa7d9;text-decoration:none;font-size:11px;' }, ['Memorial PDF'])); bar.appendChild(h('a', { href: API + '/' + reg.id + '/quantitativo.pdf', target: '_blank', style: 'padding:4px 10px;border-radius:6px;border:1px solid ' + COR.azul + ';background:transparent;color:#7aa7d9;text-decoration:none;font-size:11px;margin-left:6px;' }, ['Lista PDF'])); (function (id, cod, c) { bar.appendChild(bm('Editar', COR.verde, function () { fetch(API + '/' + id + '/dados', { credentials: 'include' }).then(function (r) { return r.json(); }).then(function (j) { var d = j.dados || {}; abrir({ obra: d.dadosObra || {}, uso: d.dadosUso || {} }, 1); }); })); bar.appendChild(bm('Excluir', COR.erro, function () { if (!confirm('Excluir ' + cod + '?')) return; fetch(API + '/' + id, { method: 'DELETE', credentials: 'include' }).then(function (r) { if (r.ok && c.parentNode) c.parentNode.removeChild(c); lista = null; }); })); })(reg.id, m[0], card); card.appendChild(bar); } }); }
  setInterval(injetar, 1300);
  if (document.readyState !== 'loading') injetar(); else document.addEventListener('DOMContentLoaded', injetar);
  window.MemEleWizard = { montar: montar, abrir: abrir };
})();
