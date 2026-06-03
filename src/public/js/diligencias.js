// v3.54.0 — UI do módulo Diligências de Campo (vanilla JS).
// Renderiza dentro de #view-diligencias do obras.html. Exposto como
// window.DiligenciasUI.render() — chamado pelo mapa de abas (fns.diligencias).
'use strict';
(function () {
  const FINALIDADES = [
    ['avaliacao', 'Avaliação de Imóvel'],
    ['georreferenciamento', 'Georreferenciamento'],
    ['desmembramento', 'Desmembramento'],
    ['remembramento', 'Remembramento'],
    ['averbacao', 'Averbação'],
    ['vistoria', 'Vistoria Técnica'],
    ['demarcacao', 'Demarcação de Lotes'],
  ];
  const FIN_LABEL = Object.fromEntries(FINALIDADES);
  const STATUS_COR = {
    pendente: '#ff9500', confirmado: '#00ff88', remarcado: '#d4af37', cancelado: '#ff3366',
  };
  const STATUS_LABEL = {
    pendente: 'Pendente', confirmado: 'Confirmado', remarcado: 'Remarcado', cancelado: 'Cancelado',
  };

  const state = { busca: '', status: '', page: 1, limit: 20, total: 0, items: [] };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDataHora = (iso) => {
    const d = new Date(iso); if (isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  async function api(url, opts) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data && data.error ? data.error : `Erro ${res.status}`);
    return data;
  }

  async function carregar() {
    const qs = new URLSearchParams();
    if (state.status) qs.set('status', state.status);
    if (state.busca) qs.set('proposta_id', state.busca.replace(/\D+/g, ''));
    qs.set('page', state.page); qs.set('limit', state.limit);
    const out = await api(`/api/diligencias?${qs.toString()}`);
    state.items = out.items || []; state.total = out.total || 0;
  }

  function badge(status) {
    const cor = STATUS_COR[status] || '#888';
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${cor}22;color:${cor};border:1px solid ${cor}55;">${STATUS_LABEL[status] || status}</span>`;
  }

  function linha(d) {
    return `<tr>
      <td style="padding:8px;">#${esc(d.proposta_numero || d.proposta_id)}</td>
      <td style="padding:8px;">${esc(d.cliente_nome)}</td>
      <td style="padding:8px;">${esc(FIN_LABEL[d.finalidade] || d.finalidade)}</td>
      <td style="padding:8px;white-space:nowrap;">${fmtDataHora(d.data_sugerida)}</td>
      <td style="padding:8px;">${badge(d.status)}</td>
      <td style="padding:8px;white-space:nowrap;">
        <button data-dil-reenviar="${d.id}" title="Reenviar confirmação" style="font-size:12px;">📲</button>
        <button data-dil-confirmar="${d.id}" title="Marcar confirmado" style="font-size:12px;">✅</button>
        <button data-dil-cancelar="${d.id}" title="Cancelar" style="font-size:12px;">❌</button>
      </td>
    </tr>`;
  }

  function paginacao() {
    const pages = Math.max(1, Math.ceil(state.total / state.limit));
    if (pages <= 1) return '';
    let html = '<div style="display:flex;gap:6px;justify-content:center;margin-top:14px;">';
    for (let i = 1; i <= pages; i++) {
      html += `<button data-dil-page="${i}" style="padding:4px 10px;${i === state.page ? 'background:#0B6E4F;color:#fff;' : ''}">${i}</button>`;
    }
    return html + '</div>';
  }

  function html() {
    const opts = (sel) => Object.entries(STATUS_LABEL)
      .map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`).join('');
    const linhas = state.items.length
      ? state.items.map(linha).join('')
      : '<tr><td colspan="6" style="padding:20px;text-align:center;color:#888;">Nenhuma diligência encontrada.</td></tr>';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
        <h2 style="margin:0;">📅 Diligências de Campo</h2>
        <button id="dilNova" style="background:#0B6E4F;color:#fff;padding:8px 16px;border:none;border-radius:6px;cursor:pointer;">+ Nova Diligência</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <input id="dilBusca" placeholder="Nº da proposta" value="${esc(state.busca)}" style="padding:6px 10px;flex:1;min-width:160px;">
        <select id="dilStatus" style="padding:6px 10px;"><option value="">Todos os status</option>${opts(state.status)}</select>
        <button id="dilFiltrar" style="padding:6px 14px;">Filtrar</button>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="text-align:left;border-bottom:2px solid #333;">
            <th style="padding:8px;">Proposta</th><th style="padding:8px;">Cliente</th>
            <th style="padding:8px;">Finalidade</th><th style="padding:8px;">Data/Hora</th>
            <th style="padding:8px;">Status</th><th style="padding:8px;">Ações</th>
          </tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      ${paginacao()}`;
  }

  function modalNova() {
    const finOpts = FINALIDADES.map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
    wrap.innerHTML = `
      <div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;width:min(440px,92vw);">
        <h3 style="margin:0 0 16px;">➕ Nova Diligência</h3>
        <label style="display:block;font-size:13px;margin-bottom:8px;">Nº da Proposta *
          <input id="dnProp" type="number" required style="width:100%;padding:8px;margin-top:4px;"></label>
        <div id="dnCliente" style="font-size:12px;color:#0B6E4F;margin-bottom:8px;min-height:16px;"></div>
        <label style="display:block;font-size:13px;margin-bottom:8px;">Finalidade *
          <select id="dnFin" style="width:100%;padding:8px;margin-top:4px;">${finOpts}</select></label>
        <label style="display:block;font-size:13px;margin-bottom:8px;">Telefone *
          <input id="dnTel" type="tel" placeholder="(99) 9 9999-9999" required style="width:100%;padding:8px;margin-top:4px;"></label>
        <label style="display:block;font-size:13px;margin-bottom:8px;">E-mail
          <input id="dnEmail" type="email" style="width:100%;padding:8px;margin-top:4px;"></label>
        <div style="display:flex;gap:10px;">
          <label style="flex:1;font-size:13px;">Data *<input id="dnData" type="date" required style="width:100%;padding:8px;margin-top:4px;"></label>
          <label style="flex:1;font-size:13px;">Hora *<input id="dnHora" type="time" required style="width:100%;padding:8px;margin-top:4px;"></label>
        </div>
        <div id="dnErro" style="color:#ff3366;font-size:12px;margin-top:8px;"></div>
        <div style="display:flex;gap:10px;margin-top:18px;">
          <button id="dnCancelar" style="flex:1;padding:8px;">Cancelar</button>
          <button id="dnEnviar" style="flex:2;padding:8px;background:#0B6E4F;color:#fff;border:none;border-radius:6px;">🚀 Enviar Confirmação</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('#dnCancelar').onclick = close;
    // busca nome do cliente ao sair do campo proposta
    wrap.querySelector('#dnProp').addEventListener('blur', async (e) => {
      const id = e.target.value.replace(/\D+/g, '');
      const box = wrap.querySelector('#dnCliente');
      if (!id) { box.textContent = ''; return; }
      try { const p = await api('/api/propostas/' + id); box.textContent = p && p.cliente_nome ? '👤 ' + p.cliente_nome : ''; }
      catch { box.textContent = ''; }
    });
    wrap.querySelector('#dnEnviar').onclick = async () => {
      const erro = wrap.querySelector('#dnErro'); erro.textContent = '';
      const proposta_id = Number(wrap.querySelector('#dnProp').value);
      const finalidade = wrap.querySelector('#dnFin').value;
      const telefone = wrap.querySelector('#dnTel').value;
      const email = wrap.querySelector('#dnEmail').value.trim();
      const data = wrap.querySelector('#dnData').value;
      const hora = wrap.querySelector('#dnHora').value;
      if (!proposta_id || !telefone || !data || !hora) { erro.textContent = 'Preencha os campos obrigatórios.'; return; }
      const data_sugerida = `${data}T${hora}:00`;
      try {
        const r = await api('/api/diligencias', { method: 'POST', body: JSON.stringify({ proposta_id, finalidade, telefone, email: email || undefined, data_sugerida }) });
        close();
        if (r.aviso) alert(r.aviso);
        await DiligenciasUI.render();
      } catch (err) { erro.textContent = err.message; }
    };
  }

  function wire(root) {
    const byId = (id) => root.querySelector('#' + id);
    if (byId('dilNova')) byId('dilNova').onclick = modalNova;
    if (byId('dilFiltrar')) byId('dilFiltrar').onclick = () => {
      state.busca = byId('dilBusca').value.trim();
      state.status = byId('dilStatus').value;
      state.page = 1; DiligenciasUI.render();
    };
    root.querySelectorAll('[data-dil-page]').forEach(b => b.onclick = () => { state.page = Number(b.dataset.dilPage); DiligenciasUI.render(); });
    root.querySelectorAll('[data-dil-reenviar]').forEach(b => b.onclick = async () => {
      try { const r = await api('/api/diligencias/' + b.dataset.dilReenviar + '/reenviar', { method: 'POST' }); alert(r.success ? 'Confirmação reenviada.' : (r.aviso || 'Falha no reenvio.')); }
      catch (err) { alert('Erro: ' + err.message); }
    });
    root.querySelectorAll('[data-dil-confirmar]').forEach(b => b.onclick = async () => {
      try { await api('/api/diligencias/' + b.dataset.dilConfirmar, { method: 'PUT', body: JSON.stringify({ status: 'confirmado', data_confirmacao: new Date().toISOString() }) }); await DiligenciasUI.render(); }
      catch (err) { alert('Erro: ' + err.message); }
    });
    root.querySelectorAll('[data-dil-cancelar]').forEach(b => b.onclick = async () => {
      if (!confirm('Cancelar esta diligência?')) return;
      try { await api('/api/diligencias/' + b.dataset.dilCancelar, { method: 'DELETE' }); await DiligenciasUI.render(); }
      catch (err) { alert('Erro: ' + err.message); }
    });
  }

  window.DiligenciasUI = {
    async render() {
      const root = document.getElementById('view-diligencias');
      if (!root) return;
      try {
        await carregar();
        root.innerHTML = html();
        wire(root);
      } catch (err) {
        root.innerHTML = `<div style="padding:20px;color:#ff3366;">Erro ao carregar diligências: ${esc(err.message)}</div>`;
      }
    },
  };
})();
