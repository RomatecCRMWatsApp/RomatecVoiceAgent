// public/relatorio-demarcacao.js
// Front do Relatório de Demarcações Faturáveis
// Plug-and-play: adiciona 2 botões no header de "Laudos de Demarcação"
//   [📊 Gerar Relatório]  [📋 Relatórios Emitidos]

(function () {
  'use strict';
  const API = '/api/relatorios-demarcacao';

  // ============================================================
  // INJEÇÃO DOS 2 BOTÕES no header da seção "Laudos de Demarcação"
  // ============================================================
  function injetarBotoes() {
    // Procura o header da seção "Laudos de Demarcação · 12 laudos"
    // (ajuste o seletor conforme o markup real)
    const headerLaudos = document.querySelector('[data-section="laudos-demarcacao"] .section-header')
      || document.querySelector('#secao-laudos-demarcacao .header')
      || document.querySelector('.laudos-demarcacao-header');
    if (!headerLaudos) return;

    // Evita duplicação
    if (document.getElementById('btn-rel-gerar')) return;

    const btnGerar = document.createElement('button');
    btnGerar.id = 'btn-rel-gerar';
    btnGerar.innerHTML = '📊 Gerar Relatório';
    btnGerar.style.cssText = botaoStyle('#1e40af');
    btnGerar.addEventListener('click', () => abrirModal('a-faturar'));

    const btnEmitidos = document.createElement('button');
    btnEmitidos.id = 'btn-rel-emitidos';
    btnEmitidos.innerHTML = '📋 Relatórios Emitidos';
    btnEmitidos.style.cssText = botaoStyle('#374151');
    btnEmitidos.addEventListener('click', () => abrirModal('ja-faturadas'));

    // Insere ANTES do botão "+ Novo Laudo"
    const btnNovo = headerLaudos.querySelector('[data-action="novo-laudo"]')
      || headerLaudos.querySelector('.btn-novo-laudo');
    if (btnNovo) {
      headerLaudos.insertBefore(btnEmitidos, btnNovo);
      headerLaudos.insertBefore(btnGerar, btnEmitidos);
    } else {
      headerLaudos.appendChild(btnGerar);
      headerLaudos.appendChild(btnEmitidos);
    }
  }

  function botaoStyle(bg) {
    return `padding:8px 14px; background:${bg}; color:#fff; border:none;
            border-radius:6px; cursor:pointer; font-size:13px; font-weight:600;
            margin-right:8px;`;
  }

  // ============================================================
  // MODAL com 2 ABAS
  // ============================================================
  function montarModal() {
    const modal = document.createElement('div');
    modal.id = 'modal-relatorio-dem';
    modal.style.cssText = `
      display:none; position:fixed; inset:0; background:rgba(0,0,0,.78);
      z-index:9999; align-items:flex-start; justify-content:center; padding:30px 10px;
      font-family:'Segoe UI',sans-serif; overflow-y:auto;
    `;
    modal.innerHTML = `
      <div style="background:#0f1a14; border:1px solid #2d4a3a; border-radius:12px;
                  width:min(1100px, 98vw); padding:20px; color:#e8f0eb;">

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h3 style="margin:0; color:#4ade80;">📊 Relatório de Demarcações</h3>
          <button onclick="document.getElementById('modal-relatorio-dem').style.display='none'"
            style="background:transparent; border:none; color:#9ca3af; font-size:24px; cursor:pointer;">×</button>
        </div>

        <!-- ABAS -->
        <div style="display:flex; gap:4px; border-bottom:1px solid #2d4a3a; margin-bottom:16px;">
          <button id="tab-a-faturar" data-tab="a-faturar"
            style="padding:10px 20px; background:#16a34a; color:#fff; border:none;
                   border-radius:6px 6px 0 0; cursor:pointer; font-weight:600;">
            ✓ A FATURAR
          </button>
          <button id="tab-ja-faturadas" data-tab="ja-faturadas"
            style="padding:10px 20px; background:#1f2937; color:#9ca3af; border:none;
                   border-radius:6px 6px 0 0; cursor:pointer;">
            📋 JÁ FATURADAS
          </button>
        </div>

        <!-- FILTROS -->
        <div style="display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:8px; margin-bottom:12px;">
          <input id="f-busca" type="text" placeholder="Buscar (número, contrato, lote, loteamento)..."
            style="${inputStyle()}">
          <input id="f-data-ini" type="date" style="${inputStyle()}">
          <input id="f-data-fim" type="date" style="${inputStyle()}">
          <button id="btn-filtrar" style="padding:8px 14px; background:#1e40af; color:#fff; border:none; border-radius:6px; cursor:pointer;">Filtrar</button>
        </div>

        <!-- TABELA -->
        <div id="tabela-container" style="border:1px solid #2d4a3a; border-radius:8px; overflow:hidden; min-height:200px;">
          <div style="padding:30px; text-align:center; color:#9ca3af;">Carregando...</div>
        </div>

        <!-- RODAPÉ (totais + ação) -->
        <div id="rodape-aba-a-faturar" style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding:14px; background:#1a2920; border-radius:8px;">
          <div id="totais-selecionados" style="font-size:14px; color:#e8f0eb;">
            <span style="color:#9ca3af;">Selecionados:</span> <strong id="sel-qtd">0</strong> ·
            <span style="color:#9ca3af;">Área:</span> <strong id="sel-area">0,00 m²</strong> ·
            <span style="color:#9ca3af;">Total:</span> <strong id="sel-total" style="color:#fbbf24;">R$ 0,00</strong>
          </div>
          <button id="btn-prosseguir" disabled
            style="padding:10px 20px; background:#16a34a; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; opacity:.5;">
            Prosseguir →
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#tab-a-faturar').addEventListener('click', () => trocarAba('a-faturar'));
    modal.querySelector('#tab-ja-faturadas').addEventListener('click', () => trocarAba('ja-faturadas'));
    modal.querySelector('#btn-filtrar').addEventListener('click', () => carregarAtual());
    modal.querySelector('#btn-prosseguir').addEventListener('click', abrirFormFatura);

    return modal;
  }

  function inputStyle() {
    return `padding:8px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px;`;
  }

  let abaAtual = 'a-faturar';
  function abrirModal(aba) {
    let modal = document.getElementById('modal-relatorio-dem');
    if (!modal) modal = montarModal();
    modal.style.display = 'flex';
    trocarAba(aba);
  }

  function trocarAba(aba) {
    abaAtual = aba;
    const modal = document.getElementById('modal-relatorio-dem');
    const tabA = modal.querySelector('#tab-a-faturar');
    const tabJ = modal.querySelector('#tab-ja-faturadas');
    const rodape = modal.querySelector('#rodape-aba-a-faturar');

    if (aba === 'a-faturar') {
      tabA.style.background = '#16a34a'; tabA.style.color = '#fff';
      tabJ.style.background = '#1f2937'; tabJ.style.color = '#9ca3af';
      rodape.style.display = 'flex';
    } else {
      tabJ.style.background = '#d4a017'; tabJ.style.color = '#fff';
      tabA.style.background = '#1f2937'; tabA.style.color = '#9ca3af';
      rodape.style.display = 'none';
    }
    carregarAtual();
  }

  async function carregarAtual() {
    const modal = document.getElementById('modal-relatorio-dem');
    const cont = modal.querySelector('#tabela-container');
    cont.innerHTML = '<div style="padding:30px; text-align:center; color:#9ca3af;">Carregando...</div>';

    const params = new URLSearchParams();
    const busca = modal.querySelector('#f-busca').value.trim();
    const di = modal.querySelector('#f-data-ini').value;
    const df = modal.querySelector('#f-data-fim').value;
    if (busca) params.set('busca', busca);
    if (di) params.set('dataInicio', di);
    if (df) params.set('dataFim', df);

    try {
      const r = await fetch(`${API}/${abaAtual}?${params}`);
      const lista = await r.json();
      if (!r.ok) throw new Error(lista.error);
      if (abaAtual === 'a-faturar') renderTabelaAFaturar(lista);
      else renderTabelaJaFaturadas(lista);
    } catch (err) {
      cont.innerHTML = `<div style="padding:20px; color:#f87171;">Erro: ${err.message}</div>`;
    }
  }

  // ===== TABELA A FATURAR (com checkbox) =====
  function renderTabelaAFaturar(lista) {
    const cont = document.getElementById('modal-relatorio-dem').querySelector('#tabela-container');
    if (lista.length === 0) {
      cont.innerHTML = '<div style="padding:30px; text-align:center; color:#9ca3af;">Nenhuma demarcação pendente de faturamento.</div>';
      atualizarTotais();
      return;
    }
    const linhas = lista.map(l => `
      <tr data-id="${l.id}" data-area="${l.area_m2}" data-valor="${l.valor}" style="border-bottom:1px solid #2d4a3a;">
        <td style="padding:8px; text-align:center;">
          <input type="checkbox" class="chk-laudo" style="width:18px; height:18px; cursor:pointer;">
        </td>
        <td style="padding:8px;">
          <strong style="color:#4ade80;">${escapeHtml(l.numero)}</strong>
          <div style="font-size:11px; color:#9ca3af;">${escapeHtml(l.tipo_imovel || '')}</div>
        </td>
        <td style="padding:8px; font-size:12px;">
          ${escapeHtml(l.imovel_descricao || '-')}
          ${l.contrato ? `<div style="font-size:11px; color:#9ca3af;">Contr. ${escapeHtml(l.contrato)} ${l.quadra ? '· Q.'+escapeHtml(l.quadra) : ''} ${l.lote ? '· Lote '+escapeHtml(l.lote) : ''}</div>` : ''}
        </td>
        <td style="padding:8px; text-align:center; font-size:12px; color:#9ca3af;">${formatarData(l.data_demarcacao)}</td>
        <td style="padding:8px; text-align:right; font-weight:bold;">📏 ${formatNum(l.area_m2)} m²</td>
        <td style="padding:8px; text-align:right; color:#fbbf24; font-weight:bold;">💰 ${formatMoeda(l.valor)}</td>
      </tr>
    `).join('');

    cont.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:13px; color:#e8f0eb;">
        <thead style="background:#1a2920;">
          <tr>
            <th style="padding:10px 8px; width:40px;">
              <input type="checkbox" id="chk-todos" style="width:18px; height:18px; cursor:pointer;">
            </th>
            <th style="padding:10px 8px; text-align:left;">Laudo</th>
            <th style="padding:10px 8px; text-align:left;">Imóvel</th>
            <th style="padding:10px 8px; text-align:center;">Data</th>
            <th style="padding:10px 8px; text-align:right;">Área</th>
            <th style="padding:10px 8px; text-align:right;">Valor</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    `;
    cont.querySelector('#chk-todos').addEventListener('change', e => {
      cont.querySelectorAll('.chk-laudo').forEach(c => c.checked = e.target.checked);
      atualizarTotais();
    });
    cont.querySelectorAll('.chk-laudo').forEach(c => {
      c.addEventListener('change', atualizarTotais);
    });
  }

  // ===== TABELA JÁ FATURADAS =====
  function renderTabelaJaFaturadas(lista) {
    const cont = document.getElementById('modal-relatorio-dem').querySelector('#tabela-container');
    if (lista.length === 0) {
      cont.innerHTML = '<div style="padding:30px; text-align:center; color:#9ca3af;">Nenhuma demarcação faturada no período.</div>';
      return;
    }
    const linhas = lista.map(l => {
      const cor = l.status_faturamento === 'pago' ? '#4ade80' : '#fbbf24';
      const lbl = l.status_faturamento === 'pago' ? '✓ PAGO' : '📤 FATURADO';
      return `
        <tr style="border-bottom:1px solid #2d4a3a;">
          <td style="padding:8px;">
            <strong style="color:#4ade80;">${escapeHtml(l.numero)}</strong>
            <div style="font-size:11px; color:#9ca3af;">${escapeHtml(l.tipo_imovel || '')}</div>
          </td>
          <td style="padding:8px; font-size:12px;">
            ${escapeHtml(l.imovel_descricao || '-')}
            ${l.contrato ? `<div style="font-size:11px; color:#9ca3af;">Contr. ${escapeHtml(l.contrato)} ${l.lote ? '· Lote '+escapeHtml(l.lote) : ''}</div>` : ''}
          </td>
          <td style="padding:8px; text-align:center; font-size:12px;">
            ${l.relatorio_numero ? `<a href="${API}/${l.relatorio_id}/pdf" target="_blank" style="color:#60a5fa;">${escapeHtml(l.relatorio_numero)}</a>` : '-'}
          </td>
          <td style="padding:8px; text-align:center; font-size:11px; color:#9ca3af;">
            ${l.faturado_em ? formatarData(l.faturado_em) : '-'}
          </td>
          <td style="padding:8px; text-align:right;">📏 ${formatNum(l.area_m2)} m²</td>
          <td style="padding:8px; text-align:right; color:#fbbf24; font-weight:bold;">${formatMoeda(l.valor)}</td>
          <td style="padding:8px; text-align:center;">
            <span style="color:${cor}; font-size:11px; font-weight:bold;">${lbl}</span>
          </td>
        </tr>
      `;
    }).join('');

    cont.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:13px; color:#e8f0eb;">
        <thead style="background:#1a2920;">
          <tr>
            <th style="padding:10px 8px; text-align:left;">Laudo</th>
            <th style="padding:10px 8px; text-align:left;">Imóvel</th>
            <th style="padding:10px 8px; text-align:center;">Relatório</th>
            <th style="padding:10px 8px; text-align:center;">Faturado em</th>
            <th style="padding:10px 8px; text-align:right;">Área</th>
            <th style="padding:10px 8px; text-align:right;">Valor</th>
            <th style="padding:10px 8px; text-align:center;">Status</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    `;
  }

  function atualizarTotais() {
    const modal = document.getElementById('modal-relatorio-dem');
    const checks = modal.querySelectorAll('.chk-laudo:checked');
    let area = 0, valor = 0;
    checks.forEach(c => {
      const tr = c.closest('tr');
      area += Number(tr.dataset.area);
      valor += Number(tr.dataset.valor);
    });
    modal.querySelector('#sel-qtd').textContent = checks.length;
    modal.querySelector('#sel-area').textContent = formatNum(area) + ' m²';
    modal.querySelector('#sel-total').textContent = formatMoeda(valor);
    const btn = modal.querySelector('#btn-prosseguir');
    btn.disabled = checks.length === 0;
    btn.style.opacity = checks.length === 0 ? '.5' : '1';
  }

  // ===== FORM FINAL (DADOS DO LOTEADOR) =====
  function abrirFormFatura() {
    const modal = document.getElementById('modal-relatorio-dem');
    const ids = Array.from(modal.querySelectorAll('.chk-laudo:checked'))
      .map(c => Number(c.closest('tr').dataset.id));
    if (ids.length === 0) return;

    const form = document.createElement('div');
    form.id = 'modal-form-fatura';
    form.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:10000;
      display:flex; align-items:center; justify-content:center; padding:20px;
    `;
    form.innerHTML = `
      <div style="background:#0f1a14; border:1px solid #2d4a3a; border-radius:12px;
                  width:min(560px, 96vw); padding:24px; color:#e8f0eb;">
        <h3 style="margin:0 0 16px 0; color:#4ade80;">Dados do Destinatário</h3>
        <p style="color:#9ca3af; font-size:13px; margin:0 0 16px 0;">
          ${ids.length} laudos selecionados · Total ${modal.querySelector('#sel-total').textContent}
        </p>
        <div style="display:grid; gap:10px;">
          <div>
            <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:3px;">Nome do loteador *</label>
            <input id="rf-nome" type="text" style="${inputStyle()} width:100%;">
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
              <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:3px;">CPF/CNPJ</label>
              <input id="rf-doc" type="text" style="${inputStyle()} width:100%;">
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:3px;">WhatsApp (com DDD)</label>
              <input id="rf-zap" type="text" placeholder="5599999999999" style="${inputStyle()} width:100%;">
            </div>
          </div>
          <div style="display:grid; grid-template-columns:2fr 1fr; gap:10px;">
            <div>
              <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:3px;">Loteamento</label>
              <input id="rf-lot" type="text" style="${inputStyle()} width:100%;">
            </div>
            <div>
              <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:3px;">Vencimento</label>
              <input id="rf-venc" type="date" style="${inputStyle()} width:100%;">
            </div>
          </div>
          <div>
            <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:3px;">Observações</label>
            <textarea id="rf-obs" rows="2" style="${inputStyle()} width:100%;"></textarea>
          </div>
          <label style="display:flex; align-items:center; gap:8px; font-size:13px;">
            <input id="rf-enviar" type="checkbox" checked style="width:16px; height:16px;">
            Enviar PDF via WhatsApp logo após gerar
          </label>
        </div>
        <div style="display:flex; gap:8px; margin-top:16px; justify-content:flex-end;">
          <button id="rf-cancelar" style="padding:10px 18px; background:#374151; color:#fff; border:none; border-radius:6px; cursor:pointer;">Cancelar</button>
          <button id="rf-gerar" style="padding:10px 18px; background:#16a34a; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">✓ Gerar Relatório</button>
        </div>
      </div>
    `;
    document.body.appendChild(form);
    form.querySelector('#rf-cancelar').addEventListener('click', () => form.remove());
    form.querySelector('#rf-gerar').addEventListener('click', () => gerarRelatorio(ids, form));
  }

  async function gerarRelatorio(laudoIds, form) {
    const nome = form.querySelector('#rf-nome').value.trim();
    if (!nome) return alert('Informe o nome do loteador.');
    const body = {
      laudoIds,
      loteadorNome: nome,
      loteadorDocumento: form.querySelector('#rf-doc').value.trim() || undefined,
      loteadorWhatsapp: form.querySelector('#rf-zap').value.replace(/\D/g, '') || undefined,
      loteamento: form.querySelector('#rf-lot').value.trim() || undefined,
      dataVencimento: form.querySelector('#rf-venc').value || undefined,
      observacoes: form.querySelector('#rf-obs').value.trim() || undefined,
      emitidoPor: window.USUARIO_ATUAL || 'José Romário',
    };
    const enviarZap = form.querySelector('#rf-enviar').checked;

    try {
      const r = await fetch(`${API}/criar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);

      if (enviarZap && body.loteadorWhatsapp) {
        const rEnv = await fetch(`${API}/${data.relatorioId}/enviar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefone: body.loteadorWhatsapp }),
        });
        const dEnv = await rEnv.json();
        if (!rEnv.ok) {
          alert(`Relatório ${data.numero} gerado, mas falhou ao enviar: ${dEnv.error}`);
        } else {
          alert(`✓ Relatório ${data.numero} gerado e enviado para ${body.loteadorWhatsapp}`);
        }
      } else {
        alert(`✓ Relatório ${data.numero} gerado.`);
      }
      window.open(`${API}/${data.relatorioId}/pdf`, '_blank');
      form.remove();
      trocarAba('ja-faturadas');
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }

  // ===== UTILS =====
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatarData(d) {
    if (!d) return '-';
    const s = String(d).slice(0, 10).split('-');
    return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : '-';
  }
  function formatNum(v) {
    return Number(v || 0).toFixed(2).replace('.', ',');
  }
  function formatMoeda(v) {
    return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // ===== INIT =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injetarBotoes);
  } else {
    injetarBotoes();
  }

  // v3.15.6: re-injecao automatica via MutationObserver — header dos laudos eh
  // renderizado dinamicamente quando user troca de aba, entao DOMContentLoaded
  // sozinho nao basta. Observa o body e re-injeta sempre que aparecer header novo.
  if (window.MutationObserver) {
    const obs = new MutationObserver(() => {
      if (!document.getElementById('btn-rel-gerar')) injetarBotoes();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // Exporta para uso manual e pra trigger explicito do obras.html
  window.RelatorioDemarcacao = { abrirModal, injetar: injetarBotoes };
})();
