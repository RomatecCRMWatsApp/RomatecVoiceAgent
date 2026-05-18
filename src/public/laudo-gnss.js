// v3.18.0: Modulo de UI para processamento GNSS no laudo de demarcacao.
// Padrao: window.LaudoGnss.X — segue mesmo padrao de window.RelatorioDemarcacao.
// Sem dependencia de framework — DOM vanilla + fetch.

(function () {
  'use strict';

  const api = (url, opts = {}) =>
    fetch(url, { credentials: 'same-origin', ...opts }).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      return r.json();
    });

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
    } catch (err) {
      containerEl.innerHTML = '<div class="gnss-err">Erro: ' + err.message + '</div>';
    }
  }

  window.LaudoGnss = {
    listarSessoes, criarSessao, uploadRinex, parseRinex, empacotarIbge,
    importarRetornoIbge, importarPppExterno, inserirManual, aplicarEmPonto,
    renderListaEm,
    abrirNovaSessao: null,         // setado na Task 6.1
    abrirImportarRetorno: null,    // setado na Task 6.2
    abrirAplicarEmPonto: null,     // setado na Task 6.3
  };
})();
