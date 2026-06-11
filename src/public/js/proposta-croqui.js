// v3.63.0 — UI de Pontos & Croqui da Proposta de Demarcação (Fase 2).
// Vanilla JS, sem dependências. Reusa os endpoints do backend (motor testado):
//   POST /coletora/parse       — texto da coletora → pontos
//   POST /croqui-svg           — pontos → SVG (preview ao vivo, com destaque)
//   GET  /:id/pontos           — carrega pontos salvos (ao editar proposta)
//   PUT  /:id/pontos           — persiste pontos (recalcula lados no servidor)
//   PUT  /:id/alinhamento      — marca lados a alinhar + extensão
//
// Estado em memória; os pontos também entram em dados_imovel.pontos (via
// window.__dmCroquiPontos()) pra o preview/PDF funcionarem mesmo em proposta nova.
(function () {
  'use strict';
  const API = '';
  const f2 = n => Number(n || 0).toFixed(2).replace('.', ',');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fetchApi = (url, opts) => (typeof window.api === 'function' ? window.api(url, opts) : fetch(url, Object.assign({ credentials: 'include' }, opts)));

  const S = { pontos: [], alinhar: new Set(), propostaId: null, subtipo: '', alinhamentoAtivo: false, areaM2: 0, areaHa: 0, perimetroM: 0 };
  window.__dmCroquiPontos = () => S.pontos.map(p => ({ ordem: p.ordem, vertice: p.vertice, utmE: p.utmE, utmN: p.utmN, lat: p.lat, lng: p.lng }));
  window.__dmCroquiAlinhamento = () => [...S.alinhar];

  // Distância plana entre 2 pontos UTM (pro cálculo de lados em memória).
  function dist(a, b) {
    if (a.utmE == null || a.utmN == null || b.utmE == null || b.utmN == null) return 0;
    const de = b.utmE - a.utmE, dn = b.utmN - a.utmN;
    return Math.sqrt(de * de + dn * dn);
  }
  function lados() {
    const n = S.pontos.length;
    if (n < 2) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push({ ordem: i + 1, de: S.pontos[i].vertice, para: S.pontos[j].vertice, distancia_m: dist(S.pontos[i], S.pontos[j]) });
    }
    return out;
  }
  function areaGauss() {
    const pts = S.pontos.filter(p => p.utmE != null && p.utmN != null);
    if (pts.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.utmE * b.utmN - b.utmE * a.utmN;
    }
    return Math.abs(s) / 2;
  }

  function recalcResumo() {
    S.areaM2 = +areaGauss().toFixed(2);
    S.areaHa = +(S.areaM2 / 10000).toFixed(4);
    S.perimetroM = +lados().reduce((a, l) => a + l.distancia_m, 0).toFixed(2);
  }

  function el(id) { return document.getElementById(id); }

  function renderTabelaPontos() {
    const box = el('dmcPontosBox'); if (!box) return;
    if (!S.pontos.length) { box.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:6px;">Nenhum ponto. Importe a coletora ou adicione manualmente.</div>'; return; }
    const rows = S.pontos.map((p, i) => `
      <tr>
        <td style="padding:3px 5px; color:var(--text-muted);">${p.ordem}</td>
        <td style="padding:3px 5px;"><input data-pi="${i}" data-pk="vertice" value="${esc(p.vertice)}" style="width:110px; font-size:11px; padding:2px 4px;"></td>
        <td style="padding:3px 5px;"><input data-pi="${i}" data-pk="utmE" value="${p.utmE ?? ''}" style="width:95px; font-size:11px; padding:2px 4px;"></td>
        <td style="padding:3px 5px;"><input data-pi="${i}" data-pk="utmN" value="${p.utmN ?? ''}" style="width:100px; font-size:11px; padding:2px 4px;"></td>
        <td style="padding:3px 5px;"><button data-rm="${i}" title="Remover" style="background:#7f1d1d; color:#fff; border:none; border-radius:3px; cursor:pointer; padding:2px 6px; font-size:11px;">✕</button></td>
      </tr>`).join('');
    box.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead><tr style="color:var(--text-muted); text-align:left;">
          <th style="padding:3px 5px;">#</th><th style="padding:3px 5px;">Vértice</th><th style="padding:3px 5px;">UTM E</th><th style="padding:3px 5px;">UTM N</th><th></th>
        </tr></thead><tbody>${rows}</tbody>
      </table>`;
    box.querySelectorAll('input[data-pi]').forEach(inp => {
      inp.addEventListener('change', () => {
        const i = Number(inp.dataset.pi), k = inp.dataset.pk;
        S.pontos[i][k] = k === 'vertice' ? inp.value : (inp.value === '' ? null : Number(inp.value));
        afterChange();
      });
    });
    box.querySelectorAll('button[data-rm]').forEach(b => b.addEventListener('click', () => {
      S.pontos.splice(Number(b.dataset.rm), 1);
      S.pontos.forEach((p, idx) => p.ordem = idx + 1);
      S.alinhar.clear();
      afterChange();
    }));
  }

  function renderTabelaLados() {
    const box = el('dmcLadosBox'); if (!box) return;
    const ls = lados();
    if (!ls.length) { box.innerHTML = ''; return; }
    const colAlinhar = S.alinhamentoAtivo;
    const rows = ls.map(l => `
      <tr>
        <td style="padding:3px 5px; color:var(--text-muted);">${l.ordem}</td>
        <td style="padding:3px 5px;">${esc(l.de)} → ${esc(l.para)}</td>
        <td style="padding:3px 5px; text-align:right;">${f2(l.distancia_m)} m</td>
        ${colAlinhar ? `<td style="padding:3px 5px; text-align:center;"><input type="checkbox" data-alinhar="${l.ordem}" ${S.alinhar.has(l.ordem) ? 'checked' : ''}></td>` : ''}
      </tr>`).join('');
    box.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <thead><tr style="color:var(--text-muted); text-align:left;">
          <th style="padding:3px 5px;">Lado</th><th style="padding:3px 5px;">De → Para</th><th style="padding:3px 5px; text-align:right;">Extensão</th>${colAlinhar ? '<th style="padding:3px 5px; text-align:center;">Alinhar cerca?</th>' : ''}
        </tr></thead><tbody>${rows}</tbody>
      </table>
      ${colAlinhar ? '' : '<div style="font-size:11px; color:var(--text-muted); padding:4px;">Marque o serviço <b>Alinhamento de Cerca</b> para selecionar os lados.</div>'}`;
    if (colAlinhar) box.querySelectorAll('input[data-alinhar]').forEach(c => c.addEventListener('change', () => {
      const o = Number(c.dataset.alinhar);
      if (c.checked) S.alinhar.add(o); else S.alinhar.delete(o);
      renderCroqui(); renderListaAlinhamento();
    }));
  }

  function renderResumo() {
    const box = el('dmcResumo'); if (!box) return;
    box.innerHTML = `Área: <b>${f2(S.areaM2)} m²</b> (${S.areaHa.toFixed(4).replace('.', ',')} ha) · Perímetro: <b>${f2(S.perimetroM)} m</b> · ${S.pontos.length} vértices`;
  }

  async function renderCroqui() {
    const box = el('dmcCroquiBox'); if (!box) return;
    if (S.pontos.length < 3) { box.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:8px;">Croqui aparece com ≥3 pontos.</div>'; return; }
    const tipo = S.subtipo === 'demarcacao_urbana' ? 'URBANO' : 'RURAL';
    try {
      const r = await fetchApi(`${API}/api/propostas-consultoria/croqui-svg`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pontos: window.__dmCroquiPontos(), tipoImovel: tipo, areaTotalM2: S.areaM2 || undefined }),
      });
      box.innerHTML = await r.text();
    } catch (e) { box.innerHTML = '<div style="color:#f87171; font-size:12px;">Erro ao gerar croqui.</div>'; }

    // Croqui de alinhamento (se há lados marcados)
    const boxA = el('dmcCroquiAlinhBox'); if (!boxA) return;
    if (S.alinhamentoAtivo && S.alinhar.size > 0) {
      try {
        const r = await fetchApi(`${API}/api/propostas-consultoria/croqui-svg`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pontos: window.__dmCroquiPontos(), tipoImovel: tipo, destacarLados: [...S.alinhar], tituloDestaque: 'CERCA A SER ALINHADA' }),
        });
        boxA.innerHTML = await r.text();
      } catch (e) { boxA.innerHTML = ''; }
    } else { boxA.innerHTML = ''; }
  }

  function renderListaAlinhamento() {
    const box = el('dmcAlinhLista'); if (!box) return;
    if (!S.alinhamentoAtivo || S.alinhar.size === 0) { box.innerHTML = ''; return; }
    const ls = lados().filter(l => S.alinhar.has(l.ordem));
    const total = ls.reduce((a, l) => a + l.distancia_m, 0);
    box.innerHTML = `
      <div style="font-size:11px; color:var(--gold); margin-top:6px;">
        <b>Trechos a alinhar:</b><br>
        ${ls.map(l => `• Do marco ${esc(l.de)} ao marco ${esc(l.para)} — cerca de ${f2(l.distancia_m)} m — será alinhada`).join('<br>')}
        <br><b>Extensão total de alinhamento: ${f2(total)} m</b>
      </div>`;
    // Reflete a extensão no campo de metros do serviço Alinhamento de Cerca.
    const inp = el('dmOpcAlinhM');
    if (inp) { inp.value = total.toFixed(2); if (window.__dmPreview) window.__dmPreview.agendar(); }
  }

  function afterChange() {
    recalcResumo();
    renderTabelaPontos();
    renderTabelaLados();
    renderResumo();
    renderListaAlinhamento();
    renderCroqui();
    if (window.__dmPreview) window.__dmPreview.agendar();
  }

  // ── Ações ──────────────────────────────────────────────────────────────
  async function importar() {
    const ta = el('dmcColetoraTexto');
    const texto = (ta && ta.value || '').trim();
    if (!texto) { alert('Cole o conteúdo da coletora ou selecione um arquivo.'); return; }
    try {
      const r = await fetchApi(`${API}/api/propostas-consultoria/coletora/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falha no parse');
      S.pontos = (d.pontos || []).map((p, i) => ({ ordem: i + 1, vertice: p.vertice, utmE: p.utmE, utmN: p.utmN, lat: p.lat, lng: p.lng }));
      S.alinhar.clear();
      afterChange();
    } catch (e) { alert('Erro ao importar: ' + e.message); }
  }

  function usarArea() {
    recalcResumo();
    if (S.subtipo === 'demarcacao_urbana') { const i = el('dmAreaM2'); if (i) i.value = S.areaM2.toFixed(2); }
    else { const i = el('dmAreaHa'); if (i) i.value = S.areaHa.toFixed(4); }
    const pe = el('dmPerimetro'); if (pe && S.perimetroM) pe.value = S.perimetroM.toFixed(2);
    const ve = el('dmVertices'); if (ve) ve.value = String(S.pontos.length);
    if (window.__dmPreview) window.__dmPreview.agendar();
  }

  async function salvar() {
    if (!S.propostaId) { alert('Salve a proposta primeiro (botão Salvar/Criar proposta) para gravar os pontos. Por enquanto eles já aparecem no preview.'); return; }
    try {
      const r = await fetchApi(`${API}/api/propostas-consultoria/${S.propostaId}/pontos`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pontos: window.__dmCroquiPontos() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falha ao salvar');
      if (S.alinhamentoAtivo) {
        await fetchApi(`${API}/api/propostas-consultoria/${S.propostaId}/alinhamento`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ladosOrdem: [...S.alinhar] }),
        });
      }
      alert('✓ Pontos e croqui salvos.');
    } catch (e) { alert('Erro ao salvar: ' + e.message); }
  }

  async function carregarExistente() {
    if (!S.propostaId) return;
    try {
      const r = await fetchApi(`${API}/api/propostas-consultoria/${S.propostaId}/pontos`);
      const d = await r.json();
      if (d.ok && d.pontos && d.pontos.length) {
        S.pontos = d.pontos.map((p, i) => ({ ordem: i + 1, vertice: p.vertice, utmE: p.utm_e != null ? Number(p.utm_e) : null, utmN: p.utm_n != null ? Number(p.utm_n) : null, lat: p.lat != null ? Number(p.lat) : null, lng: p.lng != null ? Number(p.lng) : null }));
        S.alinhar = new Set((d.alinhamento && d.alinhamento.lados) || []);
        afterChange();
      }
    } catch (e) { /* silencioso */ }
  }

  // ── Init (chamado pelo form de demarcação após montar) ───────────────────
  window.PropostaCroqui = {
    init(propostaId, subtipo, alinhamentoAtivo) {
      S.pontos = []; S.alinhar = new Set();
      S.propostaId = propostaId || null;
      S.subtipo = subtipo || '';
      S.alinhamentoAtivo = !!alinhamentoAtivo;
      const imp = el('dmcImportarBtn'); if (imp) imp.onclick = importar;
      const ua = el('dmcUsarAreaBtn'); if (ua) ua.onclick = usarArea;
      const sv = el('dmcSalvarBtn'); if (sv) sv.onclick = salvar;
      const file = el('dmcColetoraFile');
      if (file) file.onchange = () => {
        const f = file.files && file.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { const ta = el('dmcColetoraTexto'); if (ta) ta.value = String(rd.result || ''); };
        rd.readAsText(f);
      };
      afterChange();
      carregarExistente();
    },
    // Chamado quando o checkbox do serviço Alinhamento de Cerca muda.
    setAlinhamentoAtivo(ativo) {
      S.alinhamentoAtivo = !!ativo;
      if (!ativo) S.alinhar.clear();
      renderTabelaLados(); renderListaAlinhamento(); renderCroqui();
    },
  };
})();
