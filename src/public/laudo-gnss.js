// v3.18.0: Modulo de UI para processamento GNSS no laudo de demarcacao.
// Padrao: window.LaudoGnss.X — segue mesmo padrao de window.RelatorioDemarcacao.
// Sem dependencia de framework — DOM vanilla + fetch.

(function () {
  'use strict';

  // v3.20.1: api wrapper que tambem manda x-ceo-token (igual ao window.api do
  // offline-engine). Necessario pra endpoints PUT/DELETE protegidos por
  // requireCeoToken (ex: /api/laudos-demarcacao/:id PUT).
  const api = (url, opts = {}) => {
    const headers = Object.assign({}, opts.headers || {}, {
      'x-ceo-token': (window.state && window.state.ceoToken) ||
                     (typeof localStorage !== 'undefined' ? localStorage.getItem('ceo_token') : '') || '',
    });
    return fetch(url, { credentials: 'same-origin', ...opts, headers }).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
    });
  };

  async function listarSessoes(laudoId) {
    return api(`/api/gnss/processamentos?laudo_id=${laudoId}`);
  }

  async function criarSessao(laudoId, rotulo, fonte) {
    return api(`/api/gnss/processamentos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ laudo_id: laudoId, rotulo, fonte }),
    });
  }

  async function uploadRinex(sessaoId, files) {
    const fd = new FormData();
    for (const f of files) fd.append('arquivos', f);
    return api(`/api/gnss/processamentos/${sessaoId}/arquivos`, { method: 'POST', body: fd });
  }

  async function parseRinex(sessaoId) {
    return api(`/api/gnss/processamentos/${sessaoId}/parse-rinex`, { method: 'POST' });
  }

  async function empacotarIbge(sessaoId) {
    return api(`/api/gnss/processamentos/${sessaoId}/empacotar-ibge`, { method: 'POST' });
  }

  async function importarRetornoIbge(sessaoId, files) {
    const fd = new FormData();
    for (const f of files) fd.append('arquivos', f);
    return api(`/api/gnss/processamentos/${sessaoId}/parse-ibge-retorno`, { method: 'POST', body: fd });
  }

  async function importarPppExterno(sessaoId, files) {
    const fd = new FormData();
    for (const f of files) fd.append('arquivos', f);
    return api(`/api/gnss/processamentos/${sessaoId}/parse-ppp-externo`, { method: 'POST', body: fd });
  }

  async function inserirManual(sessaoId, body) {
    return api(`/api/gnss/processamentos/${sessaoId}/manual`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function aplicarEmPonto(sessaoId, body) {
    return api(`/api/gnss/processamentos/${sessaoId}/aplicar-em-ponto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  // v3.19.1: deletar sessao (hard delete + cascata em arquivos).
  // Se apagarVertice=true e a sessao tinha vertice auto-criado, apaga junto.
  async function deletarSessao(sessaoId, apagarVertice) {
    const qs = apagarVertice ? '?apagar_vertice=1' : '';
    return api(`/api/gnss/processamentos/${sessaoId}${qs}`, { method: 'DELETE' });
  }

  function htmlSessao(s) {
    const lat = s.latitude_graus != null ? Number(s.latitude_graus).toFixed(7) : '—';
    const lon = s.longitude_graus != null ? Number(s.longitude_graus).toFixed(7) : '—';
    const alt = s.altitude_ortometrica_m != null ? Number(s.altitude_ortometrica_m).toFixed(3) + ' m' : '—';
    const utm = s.utm_zona ? `UTM ${s.utm_zona}${s.utm_hemisferio || ''}  N=${s.utm_norte_m}  E=${s.utm_leste_m}` : '—';
    const statusBadge = ({
      rinex_carregado: '<span class="badge">RINEX carregado</span>',
      aguardando_submissao_ibge: '<span class="badge badge-warn">⏳ Aguardando IBGE</span>',
      aguardando_retorno_ibge: '<span class="badge badge-warn">⏳ Aguardando retorno</span>',
      processado: '<span class="badge badge-ok">✅ Processado</span>',
      erro: '<span class="badge badge-err">❌ Erro</span>',
    })[s.status] || s.status;
    return `<div class="gnss-card" data-sessao-id="${s.id}">
      <div class="gnss-hdr"><b>${s.rotulo}</b> · ${s.receptor_modelo || '—'} · ${statusBadge}</div>
      <div class="gnss-coords">
        <div>Lat: ${lat}</div><div>Lon: ${lon}</div><div>Alt orto: ${alt}</div>
        <div>${utm}</div>
      </div>
      <div class="gnss-acts">
        ${s.status === 'rinex_carregado' || s.status === 'aguardando_submissao_ibge'
          ? '<button data-gnss-pacote>Baixar pacote IBGE</button>' : ''}
        ${s.status !== 'processado'
          ? '<button data-gnss-importar-ret>Importar retorno IBGE</button>' : ''}
        ${s.status === 'processado' && s.laudo_id
          ? '<button data-gnss-aplicar>Aplicar em ponto</button>' : ''}
        <button data-gnss-deletar style="background:#c0392b;color:#fff;border:0;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:auto">🗑️ Deletar</button>
      </div>
    </div>`;
  }

  async function renderListaEm(containerEl, laudoId) {
    containerEl.innerHTML = '<div>Carregando sessoes GNSS...</div>';
    try {
      const lista = await listarSessoes(laudoId);
      if (!lista.length) {
        containerEl.innerHTML = '<div class="gnss-empty">Nenhuma sessao GNSS. Clique em "+ Nova sessao".</div>';
        return;
      }
      containerEl.innerHTML = lista.map(htmlSessao).join('');
      // Bind acoes
      containerEl.querySelectorAll('[data-gnss-pacote]').forEach(b => b.onclick = async (e) => {
        const id = e.target.closest('.gnss-card').dataset.sessaoId;
        try {
          const r = await empacotarIbge(id);
          window.open(r.download_url, '_blank');
          alert('Pacote baixado.\n\nSuba esse .zip no portal IBGE-PPP, aguarde o retorno por e-mail, e clique em "Importar retorno IBGE".');
          await renderListaEm(containerEl, laudoId);
        } catch (err) { alert('Erro: ' + err.message); }
      });
      containerEl.querySelectorAll('[data-gnss-importar-ret]').forEach(b => b.onclick = (e) => {
        const id = e.target.closest('.gnss-card').dataset.sessaoId;
        window.LaudoGnss.abrirImportarRetorno(id, () => renderListaEm(containerEl, laudoId));
      });
      containerEl.querySelectorAll('[data-gnss-aplicar]').forEach(b => b.onclick = (e) => {
        const id = e.target.closest('.gnss-card').dataset.sessaoId;
        window.LaudoGnss.abrirAplicarEmPonto(id, laudoId, () => renderListaEm(containerEl, laudoId));
      });
      containerEl.querySelectorAll('[data-gnss-deletar]').forEach(b => b.onclick = async (e) => {
        const card = e.target.closest('.gnss-card');
        const id = card.dataset.sessaoId;
        const sessao = (await listarSessoes(laudoId)).find(s => Number(s.id) === Number(id));
        const tinhaVertice = !!(sessao && sessao.ponto_id);
        const msg = tinhaVertice
          ? `Deletar a sessao ${sessao.rotulo}?\n\n[OK] = Apaga sessao + arquivos RINEX/IBGE armazenados + vertice criado no laudo (ponto #${sessao.ponto_id})\n[Cancelar] = Nada acontece\n\nPra apagar APENAS a sessao e manter o vertice no laudo, clique Cancelar e me avise.`
          : `Deletar a sessao ${sessao ? sessao.rotulo : '#'+id}?\n\nIsso vai apagar a sessao e todos os arquivos armazenados (RINEX, .zip IBGE, retorno). Acao irreversivel.`;
        if (!confirm(msg)) return;
        try {
          await deletarSessao(id, tinhaVertice);
          await renderListaEm(containerEl, laudoId);
        } catch (err) { alert('Erro ao deletar: ' + err.message); }
      });
    } catch (err) {
      containerEl.innerHTML = '<div class="gnss-err">Erro: ' + err.message + '</div>';
    }
  }

  function montarModal(titulo, contentHtml) {
    const dlg = document.createElement('dialog');
    dlg.className = 'gnss-modal';
    dlg.innerHTML = `<div class="gnss-modal-hdr"><h3>${titulo}</h3>
      <button class="gnss-modal-close">x</button></div>
      <div class="gnss-modal-body">${contentHtml}</div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('.gnss-modal-close').onclick = () => { dlg.close(); dlg.remove(); };
    dlg.showModal();
    return dlg;
  }

  async function abrirNovaSessao(laudoId, onDone, opts = {}) {
    const fonteInicial = opts.fonte || 'rinex_ibge';
    const dlg = montarModal('Nova Sessao GNSS', `
      <div class="gnss-wizard">
        <div data-step="1">
          <label>Rotulo do ponto (M01, V03...)</label>
          <input type="text" id="gnss-rotulo" maxlength="50" autofocus />
          <label>Fonte</label>
          <select id="gnss-fonte">
            <option value="rinex_ibge"${fonteInicial==='rinex_ibge'?' selected':''}>🇧🇷 Submeter ao IBGE-PPP (recomendado)</option>
            <option value="ppp_manual"${fonteInicial==='ppp_manual'?' selected':''}>📥 Ja tenho resultado processado (PPP externo)</option>
            <option value="outro">📋 Inserir coordenadas manualmente</option>
          </select>
          <button id="gnss-w-next">Proximo →</button>
        </div>
        <div data-step="2" style="display:none">
          <label>Arquivos RINEX (.YYo obrigatorio; .YYn / .YYg opcionais)</label>
          <input type="file" id="gnss-rinex-files" multiple accept=".rnx,.o,.n,.g,.l" />
          <button id="gnss-w-upload">Enviar e ler cabecalho</button>
        </div>
        <div data-step="3" style="display:none">
          <h4>Metadados extraidos</h4>
          <div id="gnss-meta"></div>
          <label>Altura da antena (m) — confirme</label>
          <input type="number" step="0.001" id="gnss-altura" />
          <button id="gnss-w-confirma">Confirmar →</button>
        </div>
        <div data-step="4" style="display:none">
          <h4>Pacote IBGE-PPP pronto</h4>
          <p>1. Baixe o .zip; 2. Submeta no <a href="#" id="gnss-w-portal" target="_blank">portal IBGE-PPP</a>; 3. Aguarde o retorno por e-mail; 4. Importe o .zip pela tela principal.</p>
          <a id="gnss-w-download" href="#" target="_blank">⬇ Baixar pacote</a>
          <button id="gnss-w-fim">Fechar</button>
        </div>
      </div>
    `);

    let sessaoCriadaId = null;

    dlg.querySelector('#gnss-w-next').onclick = async () => {
      const rotulo = dlg.querySelector('#gnss-rotulo').value.trim();
      const fonte = dlg.querySelector('#gnss-fonte').value;
      if (!rotulo) return alert('Informe o rotulo');
      try {
        const sess = await criarSessao(laudoId, rotulo, fonte);
        sessaoCriadaId = sess.id;
        if (fonte === 'outro') {
          // pula direto para inserir manualmente
          dlg.close(); dlg.remove();
          abrirManual(sess.id, onDone);
          return;
        }
        if (fonte === 'ppp_manual') {
          dlg.close(); dlg.remove();
          window.LaudoGnss.abrirImportarRetorno(sess.id, onDone, { externo: true });
          return;
        }
        dlg.querySelector('[data-step="1"]').style.display = 'none';
        dlg.querySelector('[data-step="2"]').style.display = '';
      } catch (err) { alert('Erro: ' + err.message); }
    };

    dlg.querySelector('#gnss-w-upload').onclick = async () => {
      const files = dlg.querySelector('#gnss-rinex-files').files;
      if (!files.length) return alert('Selecione ao menos 1 arquivo');
      try {
        await uploadRinex(sessaoCriadaId, files);
        const r = await parseRinex(sessaoCriadaId);
        const m = r.header;
        dlg.querySelector('#gnss-meta').innerHTML = `
          <div>Receptor: ${m.receiverModel || '—'}</div>
          <div>Antena: ${m.antennaModel || '—'}</div>
          <div>Inicio: ${m.timeFirstObs || '—'}</div>
          <div>Fim: ${m.timeLastObs || '—'}</div>
          <div>Duracao: ${m.durationSeconds ? Math.round(m.durationSeconds/60)+' min' : '—'}</div>
          <div>Intervalo: ${m.intervalSeconds || '—'} s</div>
          <div>Sistemas: ${m.systems.join(', ') || '—'}</div>
          ${r.validacao.warnings.length ? '<div class="warn">⚠ ' + r.validacao.warnings.join('<br>⚠ ') + '</div>' : ''}
        `;
        dlg.querySelector('#gnss-altura').value = m.antennaHeightM ?? '';
        dlg.querySelector('[data-step="2"]').style.display = 'none';
        dlg.querySelector('[data-step="3"]').style.display = '';
      } catch (err) { alert('Erro: ' + err.message); }
    };

    dlg.querySelector('#gnss-w-confirma').onclick = async () => {
      try {
        const r = await empacotarIbge(sessaoCriadaId);
        dlg.querySelector('#gnss-w-download').href = r.download_url;
        // URL do portal IBGE — busca em /api/config se existir, senao usa hard-coded
        dlg.querySelector('#gnss-w-portal').href =
          'https://www.ibge.gov.br/geociencias/modelos-digitais-de-superficie/modelos-digitais-de-elevacao/19219-ppp-posicionamento-por-ponto-preciso.html';
        dlg.querySelector('[data-step="3"]').style.display = 'none';
        dlg.querySelector('[data-step="4"]').style.display = '';
      } catch (err) { alert('Erro: ' + err.message); }
    };

    dlg.querySelector('#gnss-w-fim').onclick = () => {
      dlg.close(); dlg.remove();
      onDone && onDone();
    };
  }

  function abrirManual(sessaoId, onDone) {
    const dlg = montarModal('Inserir coordenadas manualmente', `
      <label>Latitude (graus decimais, negativa no sul)</label>
      <input type="number" step="0.0000001" id="gm-lat" />
      <label>Longitude (graus decimais, negativa no oeste)</label>
      <input type="number" step="0.0000001" id="gm-lon" />
      <label>Altitude ortometrica (m)</label>
      <input type="number" step="0.001" id="gm-alt" />
      <button id="gm-ok">Salvar</button>
    `);
    dlg.querySelector('#gm-ok').onclick = async () => {
      try {
        await inserirManual(sessaoId, {
          latitude: Number(dlg.querySelector('#gm-lat').value),
          longitude: Number(dlg.querySelector('#gm-lon').value),
          altitude_ortometrica_m: Number(dlg.querySelector('#gm-alt').value) || null,
        });
        dlg.close(); dlg.remove();
        onDone && onDone();
      } catch (err) { alert('Erro: ' + err.message); }
    };
  }

  async function abrirImportarRetorno(sessaoId, onDone, opts = {}) {
    const externo = !!opts.externo;
    const titulo = externo ? 'Importar PPP processado externamente' : 'Importar retorno do IBGE-PPP';
    const dlg = montarModal(titulo, `
      <p>${externo
        ? 'Suba o arquivo .txt / .kml / .pos / .pdf gerado pelo seu software (Topcon Tools, Trimble Business Center, IBGE-PPP web, etc.)'
        : 'Suba o .zip que o IBGE-PPP enviou por e-mail (ou faça upload individual de .txt/.pdf/.kml/.pos)'}.</p>
      <input type="file" id="gi-files" multiple accept=".zip,.txt,.pdf,.kml,.pos" />
      <button id="gi-ok">Processar</button>
    `);
    dlg.querySelector('#gi-ok').onclick = async () => {
      const files = dlg.querySelector('#gi-files').files;
      if (!files.length) return alert('Selecione 1 ou mais arquivos');
      try {
        const r = externo
          ? await importarPppExterno(sessaoId, files)
          : await importarRetornoIbge(sessaoId, files);
        alert('Processado! Lat: ' + r.processamento.latitude_graus + ', Lon: ' + r.processamento.longitude_graus);
        dlg.close(); dlg.remove();
        onDone && onDone();
      } catch (err) { alert('Erro: ' + err.message); }
    };
  }

  async function listarPontosDoLaudo(laudoId) {
    return api(`/api/laudos-demarcacao/${laudoId}/pontos`);
  }

  async function abrirAplicarEmPonto(sessaoId, laudoId, onDone) {
    const pontos = await listarPontosDoLaudo(laudoId).catch(() => []);
    const opcoes = pontos.map(p => `<option value="${p.id}">${p.ordem} — ${p.rotulo}</option>`).join('');
    const dlg = montarModal('Aplicar coordenadas em ponto do laudo', `
      <label><input type="radio" name="ap-modo" value="existente" checked> Atualizar ponto existente</label>
      <select id="ap-ponto">${opcoes || '<option value="">(nenhum ponto cadastrado)</option>'}</select>
      <hr>
      <label><input type="radio" name="ap-modo" value="novo"> Criar novo vertice</label>
      <label>Ordem (numero do vertice)</label>
      <input type="number" id="ap-ordem" min="1" value="${pontos.length + 1}" />
      <label>Rotulo</label>
      <input type="text" id="ap-rotulo" maxlength="50" />
      <button id="ap-ok">Aplicar</button>
    `);
    dlg.querySelector('#ap-ok').onclick = async () => {
      const modo = dlg.querySelector('input[name="ap-modo"]:checked').value;
      try {
        if (modo === 'existente') {
          const ponto_id = dlg.querySelector('#ap-ponto').value;
          if (!ponto_id) return alert('Selecione um ponto ou crie novo');
          await aplicarEmPonto(sessaoId, { ponto_id: Number(ponto_id) });
        } else {
          await aplicarEmPonto(sessaoId, {
            criar_novo: true,
            ordem: Number(dlg.querySelector('#ap-ordem').value),
            rotulo: dlg.querySelector('#ap-rotulo').value.trim() || undefined,
          });
        }
        dlg.close(); dlg.remove();
        onDone && onDone();
      } catch (err) { alert('Erro: ' + err.message); }
    };
  }

  // v3.20.1: edicao manual de valor e base GNSS no laudo (sem precisar de
  // sessao processada). Util pra quando o laudo ainda nao tem retorno IBGE
  // mas voce ja sabe os dados da base (preenchidos em campo).
  async function obterLaudo(laudoId) {
    return api(`/api/laudos-demarcacao/${laudoId}`);
  }
  async function atualizarLaudo(laudoId, body) {
    return api(`/api/laudos-demarcacao/${laudoId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function toLocalDtInput(iso) {
    // Converte ISO "2026-05-17T11:43:01.000Z" -> "2026-05-17T11:43" (input datetime-local)
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalDtInput(s) {
    if (!s) return null;
    return new Date(s).toISOString();
  }

  async function abrirEditarBaseEValor(laudoId, onDone) {
    const l = await obterLaudo(laudoId);
    const dlg = montarModal('Editar valor e dados da base GNSS deste laudo', `
      <h4 style="margin:8px 0 4px">Valor do serviço</h4>
      <label>Valor (R$) — usado no PIX do PDF</label>
      <input type="number" step="0.01" id="ev-valor" value="${l.valor_demarcacao || l.valor_final || ''}" />

      <h4 style="margin:14px 0 4px">Dados da base GNSS</h4>
      <label>Nome do receptor base (ex: S6 PLUS ComNav SN: S61L04366)</label>
      <input type="text" id="ev-base-nome" maxlength="150" value="${(l.base_nome || '').replace(/"/g,'&quot;')}" />

      <label>Início do rastreio</label>
      <input type="datetime-local" id="ev-base-ini" value="${toLocalDtInput(l.base_inicio_rastreio)}" />

      <label>Fim do rastreio</label>
      <input type="datetime-local" id="ev-base-fim" value="${toLocalDtInput(l.base_fim_rastreio)}" />

      <label>Observações da base</label>
      <textarea id="ev-base-obs" rows="3" style="width:100%">${(l.base_observacoes || '').replace(/</g,'&lt;')}</textarea>

      <div style="margin-top:14px">
        <button id="ev-ok" style="background:#10b981;color:#fff;border:0;padding:8px 16px;border-radius:4px;cursor:pointer">Salvar</button>
        <button id="ev-cancel" style="margin-left:8px">Cancelar</button>
      </div>
    `);
    dlg.querySelector('#ev-cancel').onclick = () => { dlg.close(); dlg.remove(); };
    dlg.querySelector('#ev-ok').onclick = async () => {
      try {
        const valorRaw = dlg.querySelector('#ev-valor').value;
        const baseIni = fromLocalDtInput(dlg.querySelector('#ev-base-ini').value);
        const baseFim = fromLocalDtInput(dlg.querySelector('#ev-base-fim').value);
        await atualizarLaudo(laudoId, {
          valor_demarcacao: valorRaw ? Number(valorRaw) : null,
          base_nome: dlg.querySelector('#ev-base-nome').value.trim() || null,
          base_inicio_rastreio: baseIni,
          base_fim_rastreio: baseFim,
          base_observacoes: dlg.querySelector('#ev-base-obs').value.trim() || null,
        });
        dlg.close(); dlg.remove();
        onDone && onDone();
      } catch (err) { alert('Erro ao salvar: ' + err.message); }
    };
  }

  window.LaudoGnss = {
    listarSessoes, criarSessao, uploadRinex, parseRinex, empacotarIbge,
    importarRetornoIbge, importarPppExterno, inserirManual, aplicarEmPonto,
    deletarSessao,
    renderListaEm,
    abrirNovaSessao,
    abrirImportarRetorno,
    abrirAplicarEmPonto,
    abrirEditarBaseEValor,
  };
})();
