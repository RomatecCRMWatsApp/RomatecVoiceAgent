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
  // v3.15.17: tab atual (persiste em closure, padrao 'aberto')
  let abaAtual = 'aberto'; // 'aberto' | 'quitadas'

  async function renderizarSaldoAberto(containerId, obraId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.dataset.obraId = String(obraId);
    container.innerHTML = '<div style="padding:16px; color:#9ca3af;">Carregando...</div>';
    try {
      // v3.15.17: tabs (Aberto/Quitadas)
      const tabsHtml = `
        <div style="display:flex; gap:4px; margin-bottom:12px; border-bottom:1px solid #2d4a3a; padding-bottom:0;">
          <button onclick="window.FolhaFechamento.trocarAba('aberto')"
            style="padding:8px 16px; background:${abaAtual === 'aberto' ? '#16a34a' : 'transparent'}; color:${abaAtual === 'aberto' ? '#fff' : '#9ca3af'}; border:1px solid #2d4a3a; border-bottom:none; border-radius:6px 6px 0 0; cursor:pointer; font-size:13px;">Em Aberto</button>
          <button onclick="window.FolhaFechamento.trocarAba('quitadas')"
            style="padding:8px 16px; background:${abaAtual === 'quitadas' ? '#0e8c63' : 'transparent'}; color:${abaAtual === 'quitadas' ? '#fff' : '#9ca3af'}; border:1px solid #2d4a3a; border-bottom:none; border-radius:6px 6px 0 0; cursor:pointer; font-size:13px;">Quitadas</button>
        </div>
      `;

      // Busca conforme aba
      let lista;
      if (abaAtual === 'quitadas') {
        const r = await fetch(`${API}/api/folha/listar/${obraId}?status=quitada`);
        lista = await r.json();
      } else {
        const r = await fetch(`${API}/api/folha/listar/${obraId}?status=aberta`);
        const rAlt = await fetch(`${API}/api/folha/listar/${obraId}?status=parcialmente_paga`);
        lista = [...await r.json(), ...await rAlt.json()];
      }

      if (lista.length === 0) {
        const vazio = abaAtual === 'quitadas'
          ? 'Nenhum fechamento quitado.'
          : 'Nenhum fechamento em aberto.';
        container.innerHTML = tabsHtml + `<div style="padding:16px; color:#9ca3af;">${vazio}</div>`;
        return;
      }

      const cards = await Promise.all(lista.map(async f => {
        const det = await fetch(`${API}/api/folha/detalhe/${f.id}`).then(x => x.json());
        const itensHtml = det.itens.map(it => {
          const temComp = !!it.comprovante_uploaded_em;
          const pagoTxt = it.status_pagamento === 'paga'
            ? `<span style="color:#4ade80;">✓ Pago ${new Date(it.data_pagamento).toLocaleDateString('pt-BR')}</span>`
            : '';
          const acoes = it.status_pagamento === 'paga'
            ? `${pagoTxt} <button onclick="window.reverterItem(${it.id})" style="margin-left:8px; padding:2px 6px; background:#7f1d1d; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;">Reverter</button>`
            : `<button onclick="window.pagarItem(${it.id})" style="padding:4px 10px; background:#16a34a; color:#fff; border:none; border-radius:4px; cursor:pointer;">Marcar Pago</button>`;
          // v3.11.0: botao de upload de comprovante (sempre disponivel) + link pra ver comprovante existente
          const compBtn = temComp
            ? `<a href="/api/folha/item/${it.id}/comprovante" target="_blank" style="padding:4px 8px; background:#0e8c63; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px; text-decoration:none;" title="Ver comprovante">📄 Ver</a>
               <button onclick="window.uploadComprovante(${it.id})" style="margin-left:4px; padding:4px 8px; background:#1e40af; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;" title="Substituir comprovante">📎 Trocar</button>`
            : `<button onclick="window.uploadComprovante(${it.id})" style="padding:4px 10px; background:#1e40af; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;" title="Anexar comprovante (JPG/PNG/PDF) — extrai dados, marca pago e envia via WhatsApp">📎 Comprovante</button>`;
          // v3.15.17: botao reenviar comprovante+recibo via WhatsApp (so faz sentido em item pago)
          const reenviarBtn = it.status_pagamento === 'paga'
            ? `<button onclick="window.reenviarItem(${it.id})" style="margin-left:4px; padding:4px 8px; background:#7c3aed; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;" title="Reenviar comprovante e recibo via WhatsApp">📤 Reenviar</button>`
            : '';
          return `
          <tr style="border-bottom:1px solid #2d4a3a;">
            <td style="padding:6px 8px;">${escapeHtml(it.funcionario_nome)}</td>
            <td style="padding:6px 8px; text-align:right;">R$ ${Number(it.valor_liquido).toFixed(2).replace('.', ',')}</td>
            <td style="padding:6px 8px; white-space:nowrap;">${acoes}</td>
            <td style="padding:6px 8px; white-space:nowrap;">${compBtn}${reenviarBtn}</td>
          </tr>`;
        }).join('');
        // v3.15.17: contagem de pagos pro botao "Enviar Tudo"
        const totalPagos = (det.itens || []).filter(i => i.status_pagamento === 'paga').length;
        const enviarTudoBtn = totalPagos > 0
          ? `<button onclick="window.enviarTudoFechamento(${f.id})" style="padding:4px 10px; background:#7c3aed; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;" title="Reenvia comprovante+recibo de todos os ${totalPagos} pagos via WhatsApp">📤 Enviar Tudo (${totalPagos})</button>`
          : '';
        const pdfCompletoBtn = totalPagos > 0
          ? `<a href="/api/folha/fechamento/${f.id}/pdf-completo" target="_blank" style="padding:4px 10px; background:#0e8c63; color:#fff; border-radius:4px; cursor:pointer; font-size:11px; text-decoration:none; display:inline-block;" title="PDF do fechamento + comprovantes anexados">📦 PDF Completo</a>`
          : '';
        return `
          <div style="border:1px solid #2d4a3a; border-radius:8px; padding:12px; margin-bottom:12px; background:#0f1a14;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
              <div>
                <strong style="color:#4ade80;">Fechamento #${f.id}</strong>
                ${f.rotulo ? ' · ' + escapeHtml(f.rotulo) : ''}
                <span style="color:#9ca3af; font-size:12px;"> · ${formatarData(f.data_inicio)} a ${formatarData(f.data_fim)}</span>
              </div>
              <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <!-- v3.10.1: botao PDF do fechamento -->
                <a href="/api/folha/fechamento/${f.id}/pdf-relatorio" target="_blank"
                   style="padding:4px 10px; background:#1e40af; color:#fff; border-radius:4px; cursor:pointer; font-size:11px; text-decoration:none; display:inline-block;">📄 PDF</a>
                ${pdfCompletoBtn}
                ${enviarTudoBtn}
                <span style="padding:2px 8px; border-radius:4px; font-size:11px;
                  background:${f.status === 'aberta' ? '#7f1d1d' : f.status === 'quitada' ? '#0e8c63' : '#92400e'};">${f.status}</span>
              </div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:12px; color:#e8f0eb;">
              <tbody>${itensHtml}</tbody>
            </table>
          </div>
        `;
      }));
      container.innerHTML = tabsHtml + cards.join('');
    } catch (err) {
      container.innerHTML = `<div style="color:#f87171; padding:16px;">Erro: ${err.message}</div>`;
    }
  }

  // v3.10.1: modal completo de "Marcar Pago" com dados do colaborador + PIX
  window.pagarItem = async function (itemId) {
    let dados;
    try {
      const r = await fetch(`${API}/api/folha/item/${itemId}/dados-pagamento`);
      dados = await r.json();
      if (!r.ok) throw new Error(dados.error || 'Erro ao carregar dados');
    } catch (err) { return alert('Erro ao carregar dados do colaborador: ' + err.message); }

    abrirModalPagar(itemId, dados);
  };

  function abrirModalPagar(itemId, dados) {
    const existente = document.getElementById('modal-marcar-pago');
    if (existente) existente.remove();

    const valor = 'R$ ' + Number(dados.valor_liquido).toFixed(2).replace('.', ',');
    const semPix = !dados.chave_pix;

    const modal = document.createElement('div');
    modal.id = 'modal-marcar-pago';
    modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.75); z-index:10000; display:flex; align-items:center; justify-content:center;';
    modal.innerHTML = `
      <div style="background:#0f1a14; border:1px solid #2d4a3a; border-radius:12px; width:min(540px, 96vw); padding:24px; color:#e8f0eb; max-height:90vh; overflow:auto; font-family:'Segoe UI',sans-serif;">
        <h3 style="margin:0 0 6px 0; color:#4ade80;">Confirmar Pagamento</h3>
        <p style="margin:0 0 16px 0; font-size:13px; color:#9ca3af;">
          ${escapeHtml(dados.funcionario_nome)}${dados.funcao ? ' — <em>'+escapeHtml(dados.funcao)+'</em>' : ''}
        </p>

        <div style="background:#1a2920; border:1px solid #2d4a3a; border-radius:8px; padding:12px; margin-bottom:14px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:#9ca3af;">Valor líquido a pagar:</span>
            <strong style="color:#4ade80; font-size:16px;">${valor}</strong>
          </div>
          ${dados.cpf ? `<div style="color:#9ca3af; font-size:12px;">CPF: ${escapeHtml(dados.cpf)}</div>` : ''}
          ${dados.telefone ? `<div style="color:#9ca3af; font-size:12px;">Telefone: ${escapeHtml(dados.telefone)}</div>` : ''}
        </div>

        <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">
          Chave PIX ${semPix ? '<span style="color:#f59e0b;">(não cadastrada — informe abaixo)</span>' : '<span style="color:#10b981;">(cadastrada)</span>'}
        </label>
        <input id="mp-pix" type="text" value="${escapeHtml(dados.chave_pix || '')}"
          placeholder="CPF, e-mail, telefone ou chave aleatória"
          style="width:100%; padding:10px; background:#1a2920; border:1px solid ${semPix ? '#f59e0b' : '#2d4a3a'}; color:#e8f0eb; border-radius:6px; margin-bottom:12px; font-size:13px;">

        ${semPix ? `
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:#fbbf24; margin-bottom:12px;">
          <input id="mp-salvar-pix" type="checkbox" checked>
          Salvar essa chave PIX no cadastro do colaborador
        </label>` : ''}

        <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">Forma de pagamento</label>
        <select id="mp-forma" style="width:100%; padding:10px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px; margin-bottom:12px; font-size:13px;">
          <option value="pix" selected>PIX</option>
          <option value="dinheiro">Dinheiro</option>
          <option value="transferencia">Transferência</option>
          <option value="cheque">Cheque</option>
          <option value="outro">Outro</option>
        </select>

        <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">Observação (opcional)</label>
        <textarea id="mp-obs" rows="2" placeholder="ex: pago dia 15/05/2026 às 14h"
          style="width:100%; padding:10px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px; margin-bottom:14px; font-size:13px;"></textarea>

        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button id="mp-cancelar" style="padding:10px 16px; background:#374151; color:#fff; border:none; border-radius:6px; cursor:pointer;">Cancelar</button>
          <button id="mp-confirmar" style="padding:10px 16px; background:#16a34a; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">✓ Confirmar Pagamento</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const fechar = () => modal.remove();
    document.getElementById('mp-cancelar').onclick = fechar;
    modal.addEventListener('click', (e) => { if (e.target === modal) fechar(); });

    document.getElementById('mp-confirmar').onclick = async () => {
      const forma = document.getElementById('mp-forma').value;
      const pix = (document.getElementById('mp-pix').value || '').trim();
      const obs = (document.getElementById('mp-obs').value || '').trim();
      const salvarPix = semPix ? document.getElementById('mp-salvar-pix')?.checked : false;

      // Se forma=pix mas sem PIX, bloqueia
      if (forma === 'pix' && !pix) {
        return alert('Forma de pagamento PIX exige a chave. Informe ou troque a forma.');
      }

      const btn = document.getElementById('mp-confirmar');
      btn.disabled = true; btn.textContent = 'Salvando...';

      try {
        // 1. Salva PIX no cadastro se requisitado
        if (salvarPix && pix) {
          await fetch(`${API}/api/folha/funcionario/${dados.funcionario_id}/pix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chave_pix: pix }),
          });
        }

        // 2. Marca pago
        const r = await fetch(`${API}/api/folha/item/${itemId}/pagar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            formaPagamento: forma,
            usuario: window.USUARIO_ATUAL || 'José Romário',
            observacao: obs || undefined,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);

        fechar();
        if (typeof window.recarregarSaldoAberto === 'function') window.recarregarSaldoAberto();
      } catch (err) {
        alert('Erro: ' + err.message);
        btn.disabled = false; btn.textContent = '✓ Confirmar Pagamento';
      }
    };
  }

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

  // v3.11.0: upload de comprovante de pagamento (JPG/PNG/PDF). Cria <input file>
  // hidden, faz upload, mostra dados extraidos via Claude Vision, marca pago,
  // envia via WhatsApp pro colaborador (best-effort).
  window.uploadComprovante = function (itemId) {
    let input = document.getElementById('upload-comprovante-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'upload-comprovante-input';
      input.accept = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      input.value = '';

      // toast de loading
      mostrarToastComprovante('⏳ Enviando comprovante e extraindo dados...', 'info', 0);

      const form = new FormData();
      form.append('arquivo', file);

      try {
        const r = await fetch(`${API}/api/folha/item/${itemId}/upload-comprovante`, {
          method: 'POST', body: form,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro no upload');

        // monta resumo dos dados extraidos
        const ext = data.extraido || {};
        let resumo = `✅ Comprovante anexado pra ${data.funcionario_nome}\n\n`;
        if (ext.erro) {
          resumo += `⚠️ Nao consegui extrair dados automaticamente: ${ext.erro}\n`;
        } else {
          if (ext.tipo)         resumo += `Tipo: ${ext.tipo.toUpperCase()}\n`;
          if (ext.valor != null) resumo += `Valor: R$ ${Number(ext.valor).toFixed(2).replace('.', ',')}\n`;
          if (ext.data_pagamento) resumo += `Data: ${ext.data_pagamento}\n`;
          if (ext.emitente?.nome) resumo += `Emitente: ${ext.emitente.nome}\n`;
          if (ext.destinatario?.nome) resumo += `Destinatario: ${ext.destinatario.nome}\n`;
          if (ext.id_transacao) resumo += `ID Autenticacao: ${ext.id_transacao}\n`;
          if (ext.confianca)    resumo += `Confianca OCR: ${ext.confianca}\n`;
        }
        if (data.marcado_pago) resumo += `\n✓ Item marcado como PAGO automaticamente`;
        if (data.whatsapp_enviado) resumo += `\n📱 Comprovante enviado via WhatsApp pro colaborador`;
        else if (data.whatsapp_erro) resumo += `\n⚠️ WhatsApp comprovante nao enviado: ${data.whatsapp_erro}`;
        // v3.12.0: recibo de autenticacao Romatec
        if (data.recibo_autenticacao) {
          resumo += `\n\n🧾 Recibo Romatec emitido: ${data.recibo_autenticacao.numero}`;
          resumo += `\nLink de confirmação: ${data.recibo_autenticacao.link}`;
          if (data.recibo_autenticacao.enviado) resumo += `\n📱 Recibo enviado via WhatsApp`;
        } else if (data.recibo_erro) {
          resumo += `\n⚠️ Recibo Romatec nao gerado: ${data.recibo_erro}`;
        }

        mostrarToastComprovante('', 'success', 0, true);
        alert(resumo);

        if (typeof window.recarregarSaldoAberto === 'function') window.recarregarSaldoAberto();
        if (typeof window.recarregarFolhaMensal === 'function') window.recarregarFolhaMensal();
      } catch (err) {
        mostrarToastComprovante('', 'error', 0, true);
        alert('Erro ao processar comprovante: ' + err.message);
      }
    };
    input.click();
  };

  function mostrarToastComprovante(msg, tipo, timeout, fechar) {
    let t = document.getElementById('comprovante-toast');
    if (fechar) { if (t) t.remove(); return; }
    if (!t) {
      t = document.createElement('div');
      t.id = 'comprovante-toast';
      t.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:10001; padding:12px 20px; border-radius:8px; color:#fff; font-family:Segoe UI,sans-serif; font-size:14px; box-shadow:0 4px 16px rgba(0,0,0,0.4);';
      document.body.appendChild(t);
    }
    t.style.background = tipo === 'error' ? '#dc2626' : tipo === 'success' ? '#16a34a' : '#1e40af';
    t.textContent = msg;
    if (timeout > 0) setTimeout(() => t.remove(), timeout);
  }

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

  // ============== v3.15.17: Reenvio individual de comprovante+recibo ==============
  window.reenviarItem = async function (itemId) {
    if (!confirm('Reenviar comprovante e recibo Romatec via WhatsApp pra esse colaborador?')) return;
    mostrarToastComprovante('⏳ Reenviando comprovante e recibo...', 'info', 0);
    try {
      const r = await fetch(`${API}/api/folha/item/${itemId}/reenviar`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro no reenvio');
      mostrarToastComprovante('', 'success', 0, true);
      let msg = `📤 Reenvio pra ${data.funcionario_nome}:\n`;
      msg += data.comprovante_enviado ? '✓ Comprovante enviado\n' : `✗ Comprovante: ${data.comprovante_erro || 'falhou'}\n`;
      msg += data.recibo_enviado ? `✓ Recibo ${data.recibo_numero} enviado` : `✗ Recibo: ${data.recibo_erro || 'falhou'}`;
      alert(msg);
    } catch (err) {
      mostrarToastComprovante('', 'error', 0, true);
      alert('Erro: ' + err.message);
    }
  };

  // ============== v3.15.17: Envio em lote do fechamento inteiro ==============
  window.enviarTudoFechamento = async function (fechamentoId) {
    if (!confirm('Reenviar comprovante + recibo de TODOS os itens pagos desse fechamento? Vai mandar 1 documento + 1 mensagem por colaborador via WhatsApp.')) return;
    mostrarToastComprovante('⏳ Enviando em lote, aguarde...', 'info', 0);
    try {
      const r = await fetch(`${API}/api/folha/fechamento/${fechamentoId}/enviar-tudo`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro no envio em lote');
      mostrarToastComprovante('', 'success', 0, true);
      let msg = `📤 Envio em lote — Fechamento #${data.fechamento_id}\n\n`;
      msg += `Total de itens pagos: ${data.total}\n`;
      msg += `Comprovantes enviados: ${data.comprovantes_enviados}/${data.total}\n`;
      msg += `Recibos enviados: ${data.recibos_enviados}/${data.total}\n`;
      if (data.falhas?.length) {
        msg += `\n⚠️ ${data.falhas.length} falha(s):\n`;
        msg += data.falhas.slice(0, 8).map(f => `• ${f.funcionario_nome}: ${f.motivo}`).join('\n');
        if (data.falhas.length > 8) msg += `\n... e mais ${data.falhas.length - 8}`;
      }
      alert(msg);
    } catch (err) {
      mostrarToastComprovante('', 'error', 0, true);
      alert('Erro: ' + err.message);
    }
  };

  // ============== v3.15.17: Trocar aba (Aberto/Quitadas) ==============
  function trocarAba(novaAba) {
    if (novaAba !== 'aberto' && novaAba !== 'quitadas') return;
    abaAtual = novaAba;
    // Re-renderiza o container usando obra_id armazenado no dataset
    const container = document.getElementById('painel-saldo-fechamentos');
    const obraId = container?.dataset?.obraId;
    if (obraId) renderizarSaldoAberto('painel-saldo-fechamentos', obraId);
  }

  // ============== EXPORT ==============
  window.FolhaFechamento = {
    abrirModal,
    renderizarSaldoAberto,
    trocarAba,
  };
})();
