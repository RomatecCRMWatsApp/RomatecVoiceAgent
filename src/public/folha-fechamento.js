// public/folha-fechamento.js
// Front da aba Folha Mensal — botão "Fechar Folha" + modal + saldo em aberto
// Plug-and-play: assume jQuery-like NÃO; usa fetch e DOM puro.

(function () {
  'use strict';

  const API = ''; // mesma origin

  // ============== MODAL DE FECHAMENTO ==============
  function montarModalFechamento() {
    const modal = document.createElement('div');
    modal.id = 'modal-fechar-folha';
    modal.style.cssText = `
      display:none; position:fixed; inset:0; background:rgba(0,0,0,.75);
      z-index:9999; align-items:center; justify-content:center;
      font-family:'Segoe UI',sans-serif;
    `;
    modal.innerHTML = `
      <div style="background:#0f1a14; border:1px solid #2d4a3a; border-radius:12px;
                  width:min(720px, 96vw); padding:24px; color:#e8f0eb; max-height:90vh; overflow:auto;">
        <h3 style="margin:0 0 16px 0; color:#4ade80;">Fechar Folha — período</h3>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">Data início</label>
            <input id="ff-data-inicio" type="date"
              style="width:100%; padding:8px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px;">
          </div>
          <div>
            <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">
              Data fim <span style="color:#fbbf24;">(EDITÁVEL — dia real do fechamento)</span>
            </label>
            <input id="ff-data-fim" type="date"
              style="width:100%; padding:8px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px;">
          </div>
        </div>

        <div id="ff-info-padrao" style="font-size:12px; color:#9ca3af; margin-bottom:12px;"></div>

        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button id="ff-btn-preview" style="padding:8px 16px; background:#1e40af; color:#fff; border:none; border-radius:6px; cursor:pointer;">
            Pré-visualizar
          </button>
          <button id="ff-btn-cancelar" style="padding:8px 16px; background:#374151; color:#fff; border:none; border-radius:6px; cursor:pointer;">
            Cancelar
          </button>
        </div>

        <div id="ff-preview-area" style="display:none;">
          <h4 style="margin:0 0 8px 0; color:#4ade80;">Preview</h4>
          <div id="ff-totais" style="font-size:13px; color:#d1d5db; margin-bottom:8px;"></div>
          <div id="ff-tabela" style="max-height:300px; overflow:auto; border:1px solid #2d4a3a; border-radius:6px;"></div>

          <div style="margin-top:12px;">
            <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">Rótulo (opcional)</label>
            <input id="ff-rotulo" type="text" placeholder="ex: 1ª quinzena mai/2026"
              style="width:100%; padding:8px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px;">
          </div>
          <div style="margin-top:8px;">
            <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">Observações</label>
            <textarea id="ff-obs" rows="2"
              style="width:100%; padding:8px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px;"></textarea>
          </div>

          <div style="margin-top:16px; padding:12px; background:#422006; border:1px solid #92400e; border-radius:6px; font-size:12px; color:#fbbf24;">
            ⚠ Ao confirmar, os dias marcados nesse período serão <strong>bloqueados</strong>.
            A próxima contagem começará a partir do dia seguinte à data fim escolhida.
            Funcionários ficarão com status <strong>"Em Aberto"</strong> até você confirmar o pagamento de cada um.
          </div>

          <button id="ff-btn-confirmar" style="margin-top:12px; padding:10px 20px; background:#16a34a; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">
            ✓ Confirmar Fechamento
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#ff-btn-cancelar').addEventListener('click', () => fecharModal());
    modal.querySelector('#ff-btn-preview').addEventListener('click', preview);
    modal.querySelector('#ff-btn-confirmar').addEventListener('click', confirmar);

    return modal;
  }

  function fecharModal() {
    const m = document.getElementById('modal-fechar-folha');
    if (m) m.style.display = 'none';
  }

  async function abrirModal(obraId, obraNome) {
    let modal = document.getElementById('modal-fechar-folha');
    if (!modal) modal = montarModalFechamento();
    modal.dataset.obraId = obraId;
    modal.querySelector('#ff-preview-area').style.display = 'none';

    // Busca período sugerido
    try {
      const r = await fetch(`${API}/api/folha/periodo-sugerido/${obraId}`);
      const periodo = await r.json();
      if (!r.ok) throw new Error(periodo.error || 'Erro ao buscar período');

      modal.querySelector('#ff-data-inicio').value = periodo.dataInicio;
      modal.querySelector('#ff-data-fim').value = periodo.dataFimPrevista;
      modal.querySelector('#ff-info-padrao').innerHTML =
        `<strong>Obra:</strong> ${obraNome} · ` +
        `<strong>Ciclo:</strong> ${periodo.ciclo}` +
        (periodo.diaCortePadrao ? ` (corte dia ${periodo.diaCortePadrao})` : '') +
        `<br><span style="color:#6b7280;">${periodo.motivo}</span>`;
    } catch (err) {
      alert('Erro ao calcular período sugerido: ' + err.message);
      return;
    }
    modal.style.display = 'flex';
  }

  // ============== PREVIEW ==============
  async function preview() {
    const modal = document.getElementById('modal-fechar-folha');
    const obraId = modal.dataset.obraId;
    const dataInicio = modal.querySelector('#ff-data-inicio').value;
    const dataFim = modal.querySelector('#ff-data-fim').value;
    if (!dataInicio || !dataFim) return alert('Preencha as duas datas.');
    if (dataFim < dataInicio) return alert('Data fim anterior à data início.');

    try {
      const r = await fetch(`${API}/api/folha/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obraId: Number(obraId), dataInicio, dataFim }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro no preview');

      const fmt = v => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
      modal.querySelector('#ff-totais').innerHTML =
        `<strong>${data.itens.length}</strong> funcionários · ` +
        `Bruto <strong style="color:#4ade80;">${fmt(data.totalValor)}</strong> · ` +
        `Vales <strong style="color:#fbbf24;">${fmt(data.totalVales)}</strong> · ` +
        `Líquido <strong style="color:#4ade80;">${fmt(data.totalLiquido)}</strong>`;

      const linhas = data.itens.map(it => `
        <tr style="border-bottom:1px solid #2d4a3a;">
          <td style="padding:6px 8px;">${escapeHtml(it.nome)}</td>
          <td style="padding:6px 8px; color:#9ca3af; font-size:11px;">${escapeHtml(it.funcao || '')}</td>
          <td style="padding:6px 8px; text-align:center;">${it.dias_integral}</td>
          <td style="padding:6px 8px; text-align:center;">${it.dias_manha}</td>
          <td style="padding:6px 8px; text-align:center;">${it.dias_tarde}</td>
          <td style="padding:6px 8px; text-align:center; font-weight:bold;">${it.dias_equivalente}</td>
          <td style="padding:6px 8px; text-align:right; color:#4ade80;">${fmt(it.valor_total)}</td>
          <td style="padding:6px 8px; text-align:right; color:#fbbf24;">${fmt(it.valor_vales)}</td>
          <td style="padding:6px 8px; text-align:right; font-weight:bold;">${fmt(it.valor_liquido)}</td>
        </tr>
      `).join('');

      modal.querySelector('#ff-tabela').innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:12px; color:#e8f0eb;">
          <thead style="background:#1a2920; position:sticky; top:0;">
            <tr>
              <th style="padding:6px 8px; text-align:left;">Funcionário</th>
              <th style="padding:6px 8px; text-align:left;">Função</th>
              <th style="padding:6px 8px;">Int</th>
              <th style="padding:6px 8px;">Manhã</th>
              <th style="padding:6px 8px;">Tarde</th>
              <th style="padding:6px 8px;">Equiv</th>
              <th style="padding:6px 8px; text-align:right;">Bruto</th>
              <th style="padding:6px 8px; text-align:right;">Vales</th>
              <th style="padding:6px 8px; text-align:right;">Líquido</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      `;
      modal.querySelector('#ff-preview-area').style.display = 'block';
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }

  // ============== CONFIRMAR ==============
  async function confirmar() {
    const modal = document.getElementById('modal-fechar-folha');
    const body = {
      obraId: Number(modal.dataset.obraId),
      dataInicio: modal.querySelector('#ff-data-inicio').value,
      dataFim: modal.querySelector('#ff-data-fim').value,
      rotulo: modal.querySelector('#ff-rotulo').value || undefined,
      observacoes: modal.querySelector('#ff-obs').value || undefined,
      fechadoPor: window.USUARIO_ATUAL || 'José Romário',
    };
    if (!confirm(`Confirmar fechamento de ${body.dataInicio} a ${body.dataFim}?\nEssa ação BLOQUEIA os dias marcados nesse período.`)) return;

    try {
      const r = await fetch(`${API}/api/folha/fechar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      alert(`✓ Fechamento criado (id ${data.fechamentoId})\n${data.totalFuncionarios} funcionários · Líquido R$ ${Number(data.totalLiquido).toFixed(2).replace('.', ',')}`);
      fecharModal();
      if (typeof window.recarregarFolhaMensal === 'function') window.recarregarFolhaMensal();
      if (typeof window.recarregarSaldoAberto === 'function') window.recarregarSaldoAberto();
    } catch (err) {
      alert('Erro ao fechar: ' + err.message);
    }
  }

  // ============== PAINEL "SALDO EM ABERTO" ==============
  async function renderizarSaldoAberto(containerId, obraId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div style="padding:16px; color:#9ca3af;">Carregando...</div>';
    try {
      const r = await fetch(`${API}/api/folha/listar/${obraId}?status=aberta`);
      const rAlt = await fetch(`${API}/api/folha/listar/${obraId}?status=parcialmente_paga`);
      const abertas = await r.json();
      const parciais = await rAlt.json();
      const lista = [...abertas, ...parciais];

      if (lista.length === 0) {
        container.innerHTML = '<div style="padding:16px; color:#9ca3af;">Nenhum fechamento em aberto.</div>';
        return;
      }

      const cards = await Promise.all(lista.map(async f => {
        const det = await fetch(`${API}/api/folha/detalhe/${f.id}`).then(x => x.json());
        const itensHtml = det.itens.map(it => `
          <tr style="border-bottom:1px solid #2d4a3a;">
            <td style="padding:6px 8px;">${escapeHtml(it.funcionario_nome)}</td>
            <td style="padding:6px 8px; text-align:right;">R$ ${Number(it.valor_liquido).toFixed(2).replace('.', ',')}</td>
            <td style="padding:6px 8px;">
              ${it.status_pagamento === 'paga'
                ? `<span style="color:#4ade80;">✓ Pago ${new Date(it.data_pagamento).toLocaleDateString('pt-BR')}</span>
                   <button onclick="window.reverterItem(${it.id})" style="margin-left:8px; padding:2px 6px; background:#7f1d1d; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;">Reverter</button>`
                : `<button onclick="window.pagarItem(${it.id})" style="padding:4px 10px; background:#16a34a; color:#fff; border:none; border-radius:4px; cursor:pointer;">Marcar Pago</button>`}
            </td>
          </tr>
        `).join('');
        return `
          <div style="border:1px solid #2d4a3a; border-radius:8px; padding:12px; margin-bottom:12px; background:#0f1a14;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <div>
                <strong style="color:#4ade80;">Fechamento #${f.id}</strong>
                ${f.rotulo ? ' · ' + escapeHtml(f.rotulo) : ''}
                <span style="color:#9ca3af; font-size:12px;"> · ${formatarData(f.data_inicio)} a ${formatarData(f.data_fim)}</span>
              </div>
              <span style="padding:2px 8px; border-radius:4px; font-size:11px;
                background:${f.status === 'aberta' ? '#7f1d1d' : '#92400e'};">${f.status}</span>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:12px; color:#e8f0eb;">
              <tbody>${itensHtml}</tbody>
            </table>
          </div>
        `;
      }));
      container.innerHTML = cards.join('');
    } catch (err) {
      container.innerHTML = `<div style="color:#f87171; padding:16px;">Erro: ${err.message}</div>`;
    }
  }

  window.pagarItem = async function (itemId) {
    const forma = prompt('Forma de pagamento (pix, dinheiro, transferencia, cheque, outro):', 'pix');
    if (!forma) return;
    try {
      const r = await fetch(`${API}/api/folha/item/${itemId}/pagar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formaPagamento: forma, usuario: window.USUARIO_ATUAL || 'José Romário' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (typeof window.recarregarSaldoAberto === 'function') window.recarregarSaldoAberto();
    } catch (err) { alert('Erro: ' + err.message); }
  };

  window.reverterItem = async function (itemId) {
    const motivo = prompt('Motivo da reversão:');
    if (!motivo) return;
    try {
      const r = await fetch(`${API}/api/folha/item/${itemId}/reverter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: window.USUARIO_ATUAL || 'José Romário', motivo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (typeof window.recarregarSaldoAberto === 'function') window.recarregarSaldoAberto();
    } catch (err) { alert('Erro: ' + err.message); }
  };

  // ============== UTILS ==============
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatarData(d) {
    if (!d) return '';
    const s = String(d).slice(0, 10).split('-');
    return `${s[2]}/${s[1]}/${s[0]}`;
  }

  // ============== EXPORT ==============
  window.FolhaFechamento = {
    abrirModal,
    renderizarSaldoAberto,
  };
})();
