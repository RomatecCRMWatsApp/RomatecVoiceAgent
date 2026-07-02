// public/folha-fechamento.js
// Front da aba Folha Mensal — botão "Fechar Folha" + modal + saldo em aberto
// Plug-and-play: assume jQuery-like NÃO; usa fetch e DOM puro.

(function () {
  'use strict';

  const API = ''; // mesma origin

  // v3.50.1 FIX: este arquivo era o unico do front que nao mandava
  // `credentials` em nenhum fetch. Sem isso, o cookie httpOnly `zayra_auth`
  // (SameSite=strict, secure) nao chegava nas rotas com requireAuth — por
  // isso /preview (publica) funcionava mas /fechar dava 401 "Nao autenticado".
  // apiFetch injeta credentials:'include' em todas as chamadas e centraliza o
  // tratamento de 401 (redireciona pro /login, preservando a origem).
  function apiFetch(url, opts) {
    const o = Object.assign({ credentials: 'include' }, opts || {});
    return window.fetch(url, o).then(function (resp) {
      if (resp.status === 401) {
        const voltar = encodeURIComponent(location.pathname + location.search);
        location.href = '/login?next=' + voltar;
        // promise pendente: interrompe o fluxo do chamador sem disparar os
        // catch/alert — a pagina ja esta navegando pro /login.
        return new Promise(function () {});
      }
      return resp;
    });
  }

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

        <!-- v3.80.0: escopo por funcionário + desvínculo -->
        <div style="margin-bottom:12px;">
          <label style="display:block; font-size:12px; color:#9ca3af; margin-bottom:4px;">Fechar folha de</label>
          <select id="ff-funcionario" style="width:100%; padding:8px; background:#1a2920; border:1px solid #2d4a3a; color:#e8f0eb; border-radius:6px;">
            <option value="">Todos os funcionários</option>
          </select>
          <label id="ff-desvincular-wrap" title="Disponível ao escolher um funcionário específico" style="display:flex; align-items:center; gap:8px; margin-top:8px; font-size:13px; color:#9ca3af; cursor:pointer;">
            <input type="checkbox" id="ff-desvincular" disabled> Desvincular da obra após fechar
            <span style="color:#6b7280;">(transfere — fica livre pra outra obra)</span>
          </label>
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
          <div id="ff-orfas" style="display:none; margin-top:10px; padding:10px; background:#3b0d0d; border:1px solid #7f1d1d; border-radius:6px; font-size:12px; color:#fca5a5;"></div>

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
    // v3.80.0: "desvincular" só habilita com funcionário específico.
    modal.querySelector('#ff-funcionario').addEventListener('change', (e) => {
      const chk = modal.querySelector('#ff-desvincular');
      const especifico = e.target.value !== '';
      chk.disabled = !especifico;
      if (!especifico) chk.checked = false;
    });

    return modal;
  }

  // v3.80.0: popula o select com os funcionários do período (preview "Todos").
  async function popularFuncionarios(modal, obraId, dataInicio, dataFim) {
    const sel = modal.querySelector('#ff-funcionario');
    if (!sel || !dataInicio || !dataFim) return;
    const atual = sel.value;
    try {
      const r = await apiFetch(`${API}/api/folha/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obraId: Number(obraId), dataInicio, dataFim }),
      });
      const data = await r.json();
      const itens = Array.isArray(data.itens) ? data.itens : [];
      sel.innerHTML = '<option value="">Todos os funcionários</option>' +
        itens.map(it => `<option value="${it.funcionario_id}">${escapeHtml(it.nome)}${it.funcao ? ' · ' + escapeHtml(it.funcao) : ''}</option>`).join('');
      if (atual && sel.querySelector(`option[value="${atual}"]`)) sel.value = atual;
    } catch (e) { /* silencioso — mantém "Todos" */ }
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
      const r = await apiFetch(`${API}/api/folha/periodo-sugerido/${obraId}`);
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
    // v3.80.0: reseta escopo e popula funcionários do período sugerido.
    const selF = modal.querySelector('#ff-funcionario');
    if (selF) selF.value = '';
    const chkD = modal.querySelector('#ff-desvincular');
    if (chkD) { chkD.checked = false; chkD.disabled = true; }
    await popularFuncionarios(modal, obraId, modal.querySelector('#ff-data-inicio').value, modal.querySelector('#ff-data-fim').value);
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
    // v3.80.0: escopo por funcionário + desvínculo
    const funcRaw = modal.querySelector('#ff-funcionario').value;
    const funcionario_id = funcRaw === '' ? null : Number(funcRaw);
    const desvincular = modal.querySelector('#ff-desvincular').checked;

    try {
      const r = await apiFetch(`${API}/api/folha/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obraId: Number(obraId), dataInicio, dataFim, funcionario_id, desvincular }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro no preview');
      // v3.15.20: backend pode devolver sem .itens em alguns edge cases
      if (!Array.isArray(data.itens)) throw new Error('Preview vazio ou invalido');

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
      // v3.80.0: aviso de diária órfã (só com desvincular marcado).
      const orf = modal.querySelector('#ff-orfas');
      const pend = (desvincular && data.pendencias_fora_intervalo && data.pendencias_fora_intervalo[0])
        ? data.pendencias_fora_intervalo[0].datas : [];
      if (orf) {
        if (pend.length) {
          orf.style.display = 'block';
          orf.innerHTML = `⚠ Há diárias pendentes <strong>fora do período</strong> (${pend.join(', ')}). ` +
            `Se confirmar o desvínculo, será preciso forçar — essas diárias continuam pendentes, sem vínculo ativo.`;
        } else { orf.style.display = 'none'; orf.innerHTML = ''; }
      }
      modal.querySelector('#ff-preview-area').style.display = 'block';
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  }

  // ============== CONFIRMAR ==============
  async function confirmar() {
    const modal = document.getElementById('modal-fechar-folha');
    // v3.80.0: escopo por funcionário + desvínculo
    const funcRaw = modal.querySelector('#ff-funcionario').value;
    const funcionario_id = funcRaw === '' ? null : Number(funcRaw);
    const desvincular = modal.querySelector('#ff-desvincular').checked;
    const nomeFunc = funcionario_id != null ? (modal.querySelector('#ff-funcionario').selectedOptions[0]?.textContent || 'funcionário') : null;
    const body = {
      obraId: Number(modal.dataset.obraId),
      dataInicio: modal.querySelector('#ff-data-inicio').value,
      dataFim: modal.querySelector('#ff-data-fim').value,
      rotulo: modal.querySelector('#ff-rotulo').value || undefined,
      observacoes: modal.querySelector('#ff-obs').value || undefined,
      fechadoPor: window.USUARIO_ATUAL || 'José Romário',
      funcionario_id,
      desvincular,
    };
    const escopoTxt = funcionario_id != null ? `a folha de ${nomeFunc}` : 'a folha de TODOS';
    const desvTxt = desvincular ? '\nE DESVINCULAR o funcionário da obra (transfere).' : '';
    if (!confirm(`Confirmar ${escopoTxt} de ${body.dataInicio} a ${body.dataFim}?\nEssa ação BLOQUEIA os dias marcados nesse período.${desvTxt}`)) return;

    async function postFechar(payload) {
      const r = await apiFetch(`${API}/api/folha/fechar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { r, data: await r.json() };
    }

    try {
      let { r, data } = await postFechar(body);
      // 409: diária órfã fora do período — oferece forçar o desvínculo.
      if (r.status === 409 && data.detalhe && data.detalhe.datas_pendentes) {
        const ok = confirm(
          `Não dá pra desvincular: há diárias pendentes fora do período (${data.detalhe.datas_pendentes.join(', ')}).\n\n` +
          `Desvincular mesmo assim? As diárias de fora continuam pendentes, sem vínculo ativo.`
        );
        if (!ok) return;
        ({ r, data } = await postFechar({ ...body, forcar_desvinculo: true }));
      }
      if (!r.ok) throw new Error(data.error || 'Erro ao fechar');
      const extra = data.desvinculado ? '\nFuncionário desvinculado da obra (transferido — livre pra nova obra).' : '';
      alert(`✓ Fechamento criado (id ${data.fechamentoId})\n${data.totalFuncionarios} funcionário(s) · Líquido R$ ${Number(data.totalLiquido).toFixed(2).replace('.', ',')}${extra}`);
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

      // Busca conforme aba — sempre garante que lista eh array, mesmo se backend devolver erro
      const asArray = (v) => Array.isArray(v) ? v : [];
      let lista;
      if (abaAtual === 'quitadas') {
        const r = await apiFetch(`${API}/api/folha/listar/${obraId}?status=quitada`);
        lista = asArray(await r.json());
      } else {
        const r = await apiFetch(`${API}/api/folha/listar/${obraId}?status=aberta`);
        const rAlt = await apiFetch(`${API}/api/folha/listar/${obraId}?status=parcialmente_paga`);
        lista = [...asArray(await r.json()), ...asArray(await rAlt.json())];
      }

      if (lista.length === 0) {
        const vazio = abaAtual === 'quitadas'
          ? 'Nenhum fechamento quitado.'
          : 'Nenhum fechamento em aberto.';
        container.innerHTML = tabsHtml + `<div style="padding:16px; color:#9ca3af;">${vazio}</div>`;
        return;
      }

      const cards = await Promise.all(lista.map(async f => {
        let det;
        try {
          const r = await apiFetch(`${API}/api/folha/detalhe/${f.id}`);
          det = await r.json();
        } catch (e) {
          det = { error: e.message };
        }
        // v3.15.20: backend pode devolver {error:...} se a query falhar. Renderiza
        // um card de erro em vez de explodir com "Cannot read properties of undefined".
        if (det?.error || !Array.isArray(det?.itens)) {
          return `
            <div style="border:1px solid #b91c1c; border-radius:8px; padding:12px; margin-bottom:12px; background:#1a0f0f; color:#fca5a5;">
              <strong>Fechamento #${f.id}</strong> — erro ao carregar detalhe: ${escapeHtml(det?.error || 'resposta invalida do servidor')}
            </div>`;
        }
        const itensHtml = det.itens.map(it => {
          const temComp = !!it.comprovante_uploaded_em;
          const pagoTxt = it.status_pagamento === 'paga'
            ? `<span style="color:#4ade80;">✓ Pago ${new Date(it.data_pagamento).toLocaleDateString('pt-BR')}</span>`
            : '';
          // v3.15.18: badge de status do recibo (envio + confirmacao do colaborador)
          const reciboBadge = renderReciboBadge(it);
          const acoes = it.status_pagamento === 'paga'
            ? `${pagoTxt} <button onclick="window.reverterItem(${it.id})" style="margin-left:8px; padding:2px 6px; background:#7f1d1d; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;">Reverter</button>${reciboBadge ? '<br>' + reciboBadge : ''}`
            : `<button onclick="window.pagarItem(${it.id})" style="padding:4px 10px; background:#16a34a; color:#fff; border:none; border-radius:4px; cursor:pointer;">Marcar Pago</button>`;
          // v3.11.0: botao de upload de comprovante (sempre disponivel) + link pra ver comprovante existente
          const compBtn = temComp
            ? `<a href="/api/folha/item/${it.id}/comprovante" target="_blank" style="padding:4px 8px; background:#0e8c63; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px; text-decoration:none;" title="Ver comprovante">📄 Ver</a>
               <button onclick="window.uploadComprovante(${it.id})" style="margin-left:4px; padding:4px 8px; background:#1e40af; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;" title="Substituir comprovante">📎 Trocar</button>`
            : `<button onclick="window.uploadComprovante(${it.id})" style="padding:4px 10px; background:#1e40af; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px;" title="Anexar comprovante (JPG/PNG/PDF) — extrai dados, marca pago e envia via WhatsApp">📎 Comprovante</button>`;
          // v3.15.17: botao reenviar comprovante+recibo via WhatsApp (so faz sentido em item pago)
          // v3.62.5: campo de numero editavel ao lado — pre-preenchido com o telefone
          // do colaborador; pode trocar pra mandar pra outro WhatsApp ou deixar o mesmo.
          const telDigits = String(it.telefone || '').replace(/\D/g, '');
          const reenviarBtn = it.status_pagamento === 'paga'
            ? `<input id="reenviar-phone-${it.id}" value="${escapeHtml(telDigits)}" placeholder="WhatsApp destino"
                 title="Número que vai receber o reenvio — troque se quiser, ou deixe o mesmo (formato 55 + DDD + número)"
                 style="width:135px; margin-left:6px; padding:3px 7px; font-size:11px; background:#0f1a14; color:#e8f0eb; border:1px solid #2d4a3a; border-radius:4px; vertical-align:middle;">
               <button onclick="window.reenviarItem(${it.id})" style="margin-left:4px; padding:4px 8px; background:#7c3aed; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px; vertical-align:middle;" title="Reenviar comprovante e recibo via WhatsApp pro número ao lado">📤 Reenviar</button>`
            : '';
          // v3.62.4: botao editar valor BRUTO (corrige diaria errada na epoca)
          const editarBtn = `<button onclick="window.editarValorItem(${it.id}, ${Number(it.valor_total)})" title="Editar valor bruto (corrige diária/valor errado)" style="margin-left:6px; padding:2px 6px; background:#374151; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:11px;">✏️ Editar</button>`;
          return `
          <tr style="border-bottom:1px solid #2d4a3a;">
            <td style="padding:6px 8px;">${escapeHtml(it.funcionario_nome)}</td>
            <td style="padding:6px 8px; text-align:right; white-space:nowrap;">R$ ${Number(it.valor_liquido).toFixed(2).replace('.', ',')}${editarBtn}</td>
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
      const r = await apiFetch(`${API}/api/folha/item/${itemId}/dados-pagamento`);
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
          await apiFetch(`${API}/api/folha/funcionario/${dados.funcionario_id}/pix`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chave_pix: pix }),
          });
        }

        // 2. Marca pago
        const r = await apiFetch(`${API}/api/folha/item/${itemId}/pagar`, {
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
      const r = await apiFetch(`${API}/api/folha/item/${itemId}/reverter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: window.USUARIO_ATUAL || 'José Romário', motivo }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (typeof window.recarregarSaldoAberto === 'function') window.recarregarSaldoAberto();
    } catch (err) { alert('Erro: ' + err.message); }
  };

  // v3.62.4: editar valor BRUTO do item (corrige diária errada na época do
  // fechamento). Recalcula líquido e totais no backend.
  window.editarValorItem = async function (itemId, valorTotalAtual) {
    const atual = Number(valorTotalAtual) || 0;
    const atualFmt = atual.toFixed(2).replace('.', ',');
    const entrada = prompt(
      `Corrigir valor BRUTO deste item.\nAtual: R$ ${atualFmt}\n\nDigite o novo valor bruto (ex: 1020 ou 1.020,00):`,
      atualFmt
    );
    if (entrada == null) return; // cancelou
    let s = String(entrada).trim();
    // BR: se tem vírgula, ponto é separador de milhar; senão ponto é decimal.
    s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const novo = Number(s);
    if (!isFinite(novo) || novo < 0) { alert('Valor inválido.'); return; }
    // v3.62.7: NÃO retorna cedo se igual — reaplicar o mesmo valor re-sincroniza
    // o recibo vinculado (caso ele tenha ficado com valor antigo).
    try {
      const r = await apiFetch(`${API}/api/folha/item/${itemId}/editar-valor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valorTotal: novo, usuario: window.USUARIO_ATUAL || 'José Romário' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro ao editar');
      const recMsg = Number(data.recibos_atualizados) > 0
        ? `\n\n📄 Recibo atualizado (${data.recibos_atualizados}) — PDF e link de confirmação já refletem o novo valor.`
        : '\n\n(nenhum recibo vinculado a atualizar)';
      alert(
        `✓ Valor atualizado.\nBruto: R$ ${Number(data.valor_total).toFixed(2).replace('.', ',')}` +
        `\nVales: R$ ${Number(data.valor_vales).toFixed(2).replace('.', ',')}` +
        `\nLíquido: R$ ${Number(data.valor_liquido).toFixed(2).replace('.', ',')}` +
        recMsg
      );
      if (typeof window.recarregarSaldoAberto === 'function') window.recarregarSaldoAberto();
      if (typeof window.recarregarFolhaMensal === 'function') window.recarregarFolhaMensal();
    } catch (err) { alert('Erro ao editar valor: ' + err.message); }
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

      // v3.16.1 P0 (D2): se offline, enfileira pra replay quando reconectar
      if (!navigator.onLine && window.OfflineEngine?.enfileirarBlob) {
        try {
          await window.OfflineEngine.enfileirarBlob({
            serverId: itemId, // item ja existe no server (fechamento online)
            campo: 'arquivo',
            file,
            endpointTemplate: '/api/folha/item/:id/upload-comprovante',
          });
          mostrarToastComprovante('', 'success', 0, true);
          alert('📎 Offline — comprovante salvo no aparelho. Vai subir quando reconectar a internet.');
          if (typeof window.OfflineEngine.atualizarBadgeOffline === 'function') {
            window.OfflineEngine.atualizarBadgeOffline();
          }
          return;
        } catch (e) {
          mostrarToastComprovante('', 'error', 0, true);
          alert('Erro ao salvar comprovante offline: ' + e.message);
          return;
        }
      }

      // toast de loading
      mostrarToastComprovante('⏳ Enviando comprovante e extraindo dados...', 'info', 0);

      const form = new FormData();
      form.append('arquivo', file);

      try {
        const r = await apiFetch(`${API}/api/folha/item/${itemId}/upload-comprovante`, {
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
        // v3.16.1 P0 (D2): rede falhou no meio do upload — fallback pra fila offline
        if (window.OfflineEngine?.enfileirarBlob && /Failed to fetch|NetworkError|timeout/i.test(err.message || '')) {
          try {
            await window.OfflineEngine.enfileirarBlob({
              serverId: itemId,
              campo: 'arquivo',
              file,
              endpointTemplate: '/api/folha/item/:id/upload-comprovante',
            });
            alert('📎 Conexao caiu — comprovante salvo no aparelho. Vai subir quando reconectar.');
            if (typeof window.OfflineEngine.atualizarBadgeOffline === 'function') {
              window.OfflineEngine.atualizarBadgeOffline();
            }
            return;
          } catch (_) {}
        }
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

  // v3.15.18: badge visual do status do recibo Romatec vinculado ao item.
  // Mostra envio (enviado/lido) + confirmacao pelo colaborador.
  function renderReciboBadge(it) {
    if (!it.recibo_link_id) {
      return `<span style="display:inline-block; margin-top:4px; padding:2px 8px; border-radius:4px; font-size:10px; background:#374151; color:#9ca3af;" title="Nenhum recibo Romatec foi gerado pra esse item">📭 Sem recibo</span>`;
    }
    const status = String(it.recibo_status || '');
    const numero = it.recibo_numero || '';
    const enviadoDt = it.recibo_enviado_em ? new Date(it.recibo_enviado_em).toLocaleDateString('pt-BR') : null;
    const respondidoDt = it.recibo_respondido_em ? new Date(it.recibo_respondido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
    const acao = it.recibo_resposta_acao;

    // Confirmado pelo colaborador (cliente clicou "Confirmo" no link /r/:token)
    if (status === 'confirmado' || (status === 'respondido' && acao === 'confirma')) {
      return `<span style="display:inline-block; margin-top:4px; padding:3px 8px; border-radius:4px; font-size:10px; background:#15803d; color:#fff; font-weight:600;" title="${escapeHtml(numero)} confirmado pelo colaborador em ${respondidoDt || ''}">✅ Confirmado pelo colaborador${respondidoDt ? ' · ' + respondidoDt : ''}</span>`;
    }
    if (status === 'contestado' || (status === 'respondido' && acao === 'contesta')) {
      return `<span style="display:inline-block; margin-top:4px; padding:3px 8px; border-radius:4px; font-size:10px; background:#991b1b; color:#fff; font-weight:600;" title="${escapeHtml(numero)} contestado em ${respondidoDt || ''}">⚠️ Contestado${respondidoDt ? ' · ' + respondidoDt : ''}</span>`;
    }
    if (status === 'lido' || status === 'entregue') {
      const icon = status === 'lido' ? '👁' : '📬';
      const txt  = status === 'lido' ? 'Visto pelo colaborador' : 'Entregue';
      return `<span style="display:inline-block; margin-top:4px; padding:3px 8px; border-radius:4px; font-size:10px; background:#1e40af; color:#fff;" title="${escapeHtml(numero)} ${txt}">${icon} ${txt}${enviadoDt ? ' · enviado ' + enviadoDt : ''}</span>`;
    }
    if (status === 'enviado') {
      return `<span style="display:inline-block; margin-top:4px; padding:3px 8px; border-radius:4px; font-size:10px; background:#2563eb; color:#fff;" title="${escapeHtml(numero)} enviado, aguardando confirmacao">📤 Enviado · aguardando${enviadoDt ? ' (' + enviadoDt + ')' : ''}</span>`;
    }
    if (status === 'cancelado') {
      return `<span style="display:inline-block; margin-top:4px; padding:3px 8px; border-radius:4px; font-size:10px; background:#4b5563; color:#fff;">🚫 Cancelado</span>`;
    }
    if (status === 'expirado') {
      return `<span style="display:inline-block; margin-top:4px; padding:3px 8px; border-radius:4px; font-size:10px; background:#7c2d12; color:#fff;">⏰ Expirado</span>`;
    }
    // rascunho / aguardando_envio
    return `<span style="display:inline-block; margin-top:4px; padding:3px 8px; border-radius:4px; font-size:10px; background:#92400e; color:#fff;" title="${escapeHtml(numero)} ainda nao enviado">📨 Aguardando envio</span>`;
  }

  // ============== v3.15.18: Badge do recibo (envio + confirmacao) ==============
  function renderReciboBadge(it) {
    // Sem recibo vinculado ainda
    if (!it.recibo_link_id) {
      return '<span style="display:inline-block; padding:2px 6px; background:#374151; color:#9ca3af; border-radius:4px; font-size:10px; margin-top:4px;" title="Recibo ainda nao foi criado pra esse item">Sem recibo</span>';
    }
    const numero = it.recibo_numero ? ` ${escapeHtml(String(it.recibo_numero))}` : '';
    const status = String(it.recibo_status || 'rascunho');
    const respondidoEm = it.recibo_respondido_em
      ? new Date(it.recibo_respondido_em).toLocaleDateString('pt-BR')
      : null;
    const enviadoEm = it.recibo_enviado_em
      ? new Date(it.recibo_enviado_em).toLocaleDateString('pt-BR')
      : null;
    const lidoEm = it.recibo_lido_em
      ? new Date(it.recibo_lido_em).toLocaleDateString('pt-BR')
      : null;
    // resposta_acao: confirma | contesta | outro — define se o badge eh "confirmado" ou "contestado"
    const acao = it.recibo_resposta_acao;
    let bg, fg, ico, txt, tip;
    if (status === 'confirmado' || acao === 'confirma') {
      bg = '#0e8c63'; fg = '#fff'; ico = '✅'; txt = `Confirmado pelo colaborador${respondidoEm ? ' ' + respondidoEm : ''}`;
      tip = `Recibo${numero} confirmado via link em ${respondidoEm || '?'}.`;
    } else if (status === 'contestado' || acao === 'contesta') {
      bg = '#b91c1c'; fg = '#fff'; ico = '⚠️'; txt = `Contestado${respondidoEm ? ' ' + respondidoEm : ''}`;
      tip = `Colaborador CONTESTOU o recibo${numero}. Abra pra ver a observacao.`;
    } else if (status === 'lido') {
      bg = '#1e40af'; fg = '#fff'; ico = '👁'; txt = `Visto${lidoEm ? ' ' + lidoEm : ''}`;
      tip = `Recibo${numero} foi aberto pelo colaborador, falta confirmar.`;
    } else if (status === 'entregue') {
      bg = '#1d4ed8'; fg = '#fff'; ico = '📬'; txt = 'Entregue';
      tip = `Recibo${numero} chegou no WhatsApp mas ainda nao foi aberto.`;
    } else if (status === 'enviado') {
      bg = '#1d4ed8'; fg = '#fff'; ico = '📤'; txt = `Enviado${enviadoEm ? ' ' + enviadoEm : ''}`;
      tip = `Recibo${numero} enviado, aguardando o colaborador abrir e confirmar.`;
    } else if (status === 'cancelado') {
      bg = '#6b7280'; fg = '#fff'; ico = '🚫'; txt = 'Recibo cancelado'; tip = '';
    } else if (status === 'expirado') {
      bg = '#7c2d12'; fg = '#fff'; ico = '⏰'; txt = 'Link expirado';
      tip = 'O link de confirmacao expirou. Reenvie pra emitir um novo.';
    } else {
      // rascunho | aguardando_envio
      bg = '#374151'; fg = '#e5e7eb'; ico = '📨'; txt = 'Aguardando envio';
      tip = `Recibo${numero} ainda nao foi enviado via WhatsApp. Use Reenviar.`;
    }
    const tokenLink = it.recibo_token
      ? `<a href="/r/${escapeHtml(it.recibo_token)}" target="_blank" style="margin-left:4px; color:${fg}; text-decoration:underline; font-size:10px;" title="Abrir o link de confirmacao">link</a>`
      : '';
    return `<span style="display:inline-block; padding:3px 7px; background:${bg}; color:${fg}; border-radius:4px; font-size:10px; margin-top:4px;" title="${escapeHtml(tip)}">${ico} ${escapeHtml(txt)}${numero ? ' · ' + numero : ''}</span>${tokenLink}`;
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
    // v3.62.5: lê o número do campo editável ao lado (override de destino).
    const inp = document.getElementById('reenviar-phone-' + itemId);
    const phone = inp ? String(inp.value || '').replace(/\D/g, '') : '';
    if (phone && phone.length < 10) { alert('Número inválido. Use 55 + DDD + número.'); return; }
    const destinoTxt = phone ? `pro número ${phone}` : 'pro número cadastrado';
    if (!confirm(`Reenviar comprovante e recibo Romatec via WhatsApp ${destinoTxt}?`)) return;
    mostrarToastComprovante('⏳ Reenviando comprovante e recibo...', 'info', 0);
    try {
      const r = await apiFetch(`${API}/api/folha/item/${itemId}/reenviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone || undefined }),
      });
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
      const r = await apiFetch(`${API}/api/folha/fechamento/${fechamentoId}/enviar-tudo`, { method: 'POST' });
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
