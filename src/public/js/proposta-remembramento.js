// Wizard de Proposta de Remembramento (v3.22.x — Task 5 do plano v2)
// Vanilla JS, sem dependências externas. Pareado com proposta-remembramento.html.
// Endpoints usados:
//   GET  /api/cartorios/autocomplete?q=<termo>&uf=<UF>
//   POST /api/propostas-consultoria
//
// Estrutura:
//   - Navegação por step (.wizard-step.active + stepper visual)
//   - Step 2: validação 30 dias na certidão de inteiro teor
//   - Step 3: repeater (mín 2), autocomplete CRI com debounce ~220ms, soma de áreas
//   - Step 4: toggle do fieldset cônjuge baseado em estado_civil
//   - Step 5: toggle valor Assessoria Técnica
//   - Submit: monta payload conforme InputDesmembramento (tipo: 'remembramento')

'use strict';

// ─── Constantes ─────────────────────────────────────────────────────────────
const MIN_IMOVEIS = 2;
const AUTOCOMPLETE_DEBOUNCE_MS = 220;
const AUTOCOMPLETE_MIN_CHARS = 2;
const CERTIDAO_LIMITE_DIAS = 30;

// ─── Estado ─────────────────────────────────────────────────────────────────
let currentStep = 1;
let imovelCounter = 0;
let submitting = false;

// ─── Helpers ────────────────────────────────────────────────────────────────
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function debounce(fn, ms) {
  let t;
  return function () {
    const args = arguments;
    const self = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(self, args); }, ms);
  };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function diasDesde(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const partes = isoDate.split('-').map(Number);
  const dt = new Date(partes[0], partes[1] - 1, partes[2]);
  if (isNaN(dt.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  const diffMs = hoje.getTime() - dt.getTime();
  return Math.floor(diffMs / 86400000);
}

// ─── Navegação entre steps ──────────────────────────────────────────────────
function goToStep(n) {
  const target = Number(n);
  if (!target || target < 1 || target > 5) return;

  $$('.wizard-step').forEach(function (s) {
    s.classList.toggle('active', Number(s.dataset.step) === target);
  });
  $$('.step-pill').forEach(function (p) {
    const num = Number(p.dataset.pill);
    p.classList.toggle('active', num === target);
    p.classList.toggle('done', num < target);
  });

  currentStep = target;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindNavButtons() {
  $$('[data-next]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!validateStep(currentStep)) return;
      goToStep(btn.dataset.next);
    });
  });
  $$('[data-prev]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      goToStep(btn.dataset.prev);
    });
  });
}

// ─── Validação por step (light client-side) ─────────────────────────────────
function validateStep(step) {
  if (step === 1) {
    const nome = $('#cli_nome').value.trim();
    const doc = $('#cli_documento').value.trim();
    const tel = $('#cli_telefone').value.trim();
    const ec = $('#cli_estado_civil').value;
    const tipo = $('#cli_tipo_imovel').value;
    if (!nome) { alert('Nome do cliente é obrigatório.'); $('#cli_nome').focus(); return false; }
    if (!doc) { alert('CPF/CNPJ é obrigatório.'); $('#cli_documento').focus(); return false; }
    if (!tel) { alert('Telefone / WhatsApp é obrigatório.'); $('#cli_telefone').focus(); return false; }
    if (!ec) { alert('Estado civil é obrigatório.'); $('#cli_estado_civil').focus(); return false; }
    if (!tipo) { alert('Tipo de imóvel é obrigatório.'); $('#cli_tipo_imovel').focus(); return false; }
    return true;
  }

  if (step === 2) {
    if (!$('#st_iptu_em_dia').checked) { alert('Confirme que o IPTU está em dia.'); return false; }
    if (!$('#st_cnd_iptu').checked) { alert('Confirme que a CND de IPTU foi anexada.'); return false; }
    if (!$('#st_bci').checked) { alert('Confirme que o BCI do imóvel foi anexado.'); return false; }
    const data = $('#st_certidao_data').value;
    if (!data) { alert('Informe a data de emissão da Certidão de Inteiro Teor.'); $('#st_certidao_data').focus(); return false; }
    const dias = diasDesde(data);
    if (dias === null) { alert('Data da certidão inválida.'); return false; }
    if (dias < 0) { alert('Data da certidão não pode ser futura.'); return false; }
    if (dias > CERTIDAO_LIMITE_DIAS) {
      const ok = confirm('A Certidão de Inteiro Teor está com mais de 30 dias (' + dias + ' dias). Deseja continuar mesmo assim?');
      if (!ok) return false;
    }
    return true;
  }

  if (step === 3) {
    const cards = $$('.imovel-card[data-imovel-id]');
    if (cards.length < MIN_IMOVEIS) {
      alert('Remembramento exige no mínimo ' + MIN_IMOVEIS + ' imóveis.');
      return false;
    }
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const endereco = $('.f-endereco', card).value.trim();
      const area = parseFloat($('.f-area', card).value);
      const matricula = $('.f-matricula', card).value.trim();
      const livro = $('.f-livro', card).value.trim();
      const folha = $('.f-folha', card).value.trim();
      const cri = $('.f-cri-input', card).value.trim();
      if (!endereco) { alert('Endereço do imóvel #' + (i + 1) + ' é obrigatório.'); return false; }
      if (!area || area <= 0) { alert('Área (m²) do imóvel #' + (i + 1) + ' é obrigatória.'); return false; }
      if (!matricula) { alert('Matrícula do imóvel #' + (i + 1) + ' é obrigatória.'); return false; }
      if (!livro) { alert('Livro do imóvel #' + (i + 1) + ' é obrigatório.'); return false; }
      if (!folha) { alert('Folha do imóvel #' + (i + 1) + ' é obrigatória.'); return false; }
      if (!cri) { alert('CRI (cartório) do imóvel #' + (i + 1) + ' é obrigatório.'); return false; }
    }
    return true;
  }

  if (step === 4 || step === 5) return true;

  return true;
}

// ─── Step 2: aviso de prazo da certidão ─────────────────────────────────────
function bindCertidaoAviso() {
  const input = $('#st_certidao_data');
  const aviso = $('#st_certidao_aviso');
  if (!input || !aviso) return;
  input.addEventListener('change', function () {
    const data = input.value;
    if (!data) { aviso.textContent = ''; aviso.className = 'aviso'; return; }
    const dias = diasDesde(data);
    if (dias === null) {
      aviso.textContent = 'Data inválida.';
      aviso.className = 'aviso err';
      return;
    }
    if (dias < 0) {
      aviso.textContent = 'Data futura — verifique a emissão.';
      aviso.className = 'aviso err';
      return;
    }
    if (dias <= CERTIDAO_LIMITE_DIAS) {
      aviso.textContent = 'OK — emitida há ' + dias + ' dia(s) (dentro do prazo de 30 dias).';
      aviso.className = 'aviso ok';
    } else {
      aviso.textContent = 'Atenção: emitida há ' + dias + ' dias. Excede o prazo recomendado de 30 dias.';
      aviso.className = 'aviso err';
    }
  });
}

// ─── Step 3: imóveis (repeater + autocomplete + soma) ───────────────────────
function novoImovelCardHTML(ordem) {
  const id = ++imovelCounter;
  return (
    '<div class="imovel-card" data-imovel-id="' + id + '">' +
      '<div class="imovel-header">' +
        '<h3>Imóvel #' + ordem + '</h3>' +
        '<button type="button" class="danger btn-remover-imovel">Remover</button>' +
      '</div>' +
      '<label>' +
        '<span class="label-text">Endereço *</span>' +
        '<input type="text" class="f-endereco" required />' +
      '</label>' +
      '<div class="row">' +
        '<label>' +
          '<span class="label-text">Área (m²) *</span>' +
          '<input type="number" class="f-area" min="0.01" step="0.01" required />' +
        '</label>' +
        '<label>' +
          '<span class="label-text">Matrícula *</span>' +
          '<input type="text" class="f-matricula" required />' +
        '</label>' +
      '</div>' +
      '<div class="row">' +
        '<label>' +
          '<span class="label-text">Livro *</span>' +
          '<input type="text" class="f-livro" required />' +
        '</label>' +
        '<label>' +
          '<span class="label-text">Folha *</span>' +
          '<input type="text" class="f-folha" required />' +
        '</label>' +
      '</div>' +
      '<label class="autocomplete-wrap">' +
        '<span class="label-text">CRI (Cartório de Registro de Imóveis) *</span>' +
        '<input type="text" class="f-cri-input" required autocomplete="off" placeholder="Digite 2+ letras para buscar..." />' +
        '<input type="hidden" class="f-cri-cns" />' +
        '<div class="autocomplete-list" style="display:none;"></div>' +
      '</label>' +
      '<label>' +
        '<span class="label-text">Valor (R$)</span>' +
        '<input type="number" class="f-valor" min="0" step="0.01" />' +
      '</label>' +
    '</div>'
  );
}

function renumerarImoveis() {
  $$('.imovel-card[data-imovel-id]').forEach(function (card, idx) {
    const h = $('h3', card);
    if (h) h.textContent = 'Imóvel #' + (idx + 1);
  });
}

function recalcularAreaTotal() {
  let total = 0;
  $$('.imovel-card[data-imovel-id] .f-area').forEach(function (inp) {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) total += v;
  });
  const span = $('#area-total');
  if (span) span.textContent = total.toFixed(2).replace(/\.00$/, '');
}

function bindCardEvents(card) {
  // Botão remover
  $('.btn-remover-imovel', card).addEventListener('click', function () {
    const totalCards = $$('.imovel-card[data-imovel-id]').length;
    if (totalCards <= MIN_IMOVEIS) {
      alert('Remembramento exige no mínimo ' + MIN_IMOVEIS + ' imóveis. Não é possível remover.');
      return;
    }
    card.remove();
    renumerarImoveis();
    recalcularAreaTotal();
  });

  // Área dispara recálculo
  $('.f-area', card).addEventListener('input', recalcularAreaTotal);

  // Autocomplete CRI
  bindAutocompleteCRI(card);
}

function bindAutocompleteCRI(card) {
  const input = $('.f-cri-input', card);
  const hidden = $('.f-cri-cns', card);
  const list = $('.autocomplete-list', card);

  function closeList() {
    list.style.display = 'none';
    list.innerHTML = '';
  }

  function renderResults(items) {
    if (!items || items.length === 0) {
      list.innerHTML = '<div class="empty">Nenhum cartório encontrado.</div>';
      list.style.display = 'block';
      return;
    }
    const html = items.map(function (it) {
      return (
        '<div class="item" data-cns="' + escapeHtml(it.cns) + '" data-denominacao="' + escapeHtml(it.denominacao) + '">' +
          '<strong>' + escapeHtml(it.denominacao) + '</strong>' +
          '<small>' + escapeHtml(it.cidade || '') + ' / ' + escapeHtml(it.uf || '') + ' · CNS ' + escapeHtml(it.cns) + '</small>' +
        '</div>'
      );
    }).join('');
    list.innerHTML = html;
    list.style.display = 'block';

    $$('.item', list).forEach(function (el) {
      el.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        input.value = el.dataset.denominacao;
        hidden.value = el.dataset.cns;
        closeList();
      });
    });
  }

  const fetchCartorios = debounce(async function (termo) {
    try {
      const url = '/api/cartorios/autocomplete?q=' + encodeURIComponent(termo);
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) { closeList(); return; }
      const data = await resp.json();
      renderResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('[autocomplete CRI] erro:', err);
      closeList();
    }
  }, AUTOCOMPLETE_DEBOUNCE_MS);

  input.addEventListener('input', function () {
    const termo = input.value.trim();
    // Se o usuário altera o texto após ter selecionado um cartório, o hidden CNS perde a validade
    if (hidden.value) hidden.value = '';
    if (termo.length < AUTOCOMPLETE_MIN_CHARS) { closeList(); return; }
    fetchCartorios(termo);
  });

  input.addEventListener('blur', function () {
    // Pequeno delay para permitir mousedown no item
    setTimeout(closeList, 150);
  });
}

function adicionarImovel() {
  const container = $('#imoveis-container');
  const ordem = $$('.imovel-card[data-imovel-id]', container).length + 1;
  const wrap = document.createElement('div');
  wrap.innerHTML = novoImovelCardHTML(ordem);
  const card = wrap.firstElementChild;
  container.appendChild(card);
  bindCardEvents(card);
  recalcularAreaTotal();
  return card;
}

function initImoveisStep() {
  const container = $('#imoveis-container');
  container.innerHTML = '';
  imovelCounter = 0;
  for (let i = 0; i < MIN_IMOVEIS; i++) adicionarImovel();
  $('#btn-add-imovel').addEventListener('click', adicionarImovel);
}

// ─── Step 4: toggle cônjuge ─────────────────────────────────────────────────
function bindConjugeToggle() {
  const select = $('#cli_estado_civil');
  const fieldset = $('#docs-conjuge');
  if (!select || !fieldset) return;
  function sync() {
    const v = select.value;
    const mostrar = v === 'casado' || v === 'uniao_estavel';
    fieldset.classList.toggle('hidden', !mostrar);
  }
  select.addEventListener('change', sync);
  sync();
}

// ─── Step 5: toggle Assessoria Técnica ──────────────────────────────────────
function bindAssessoriaToggle() {
  const cb = $('#assessoria_habilitada');
  const wrap = $('#assessoria-valor-wrap');
  if (!cb || !wrap) return;
  function sync() {
    wrap.classList.toggle('hidden', !cb.checked);
    if (!cb.checked) $('#assessoria_valor').value = '';
  }
  cb.addEventListener('change', sync);
  sync();
}

// ─── Submit ─────────────────────────────────────────────────────────────────
function coletarImoveis() {
  return $$('.imovel-card[data-imovel-id]').map(function (card, idx) {
    return {
      ordem: idx + 1,
      area_m2: parseFloat($('.f-area', card).value) || 0,
      endereco: $('.f-endereco', card).value.trim(),
      matricula: $('.f-matricula', card).value.trim(),
      livro: $('.f-livro', card).value.trim(),
      folha: $('.f-folha', card).value.trim(),
      cri_denominacao: $('.f-cri-input', card).value.trim(),
      cri_cns: $('.f-cri-cns', card).value.trim(),
    };
  });
}

function montarPayload() {
  const imoveis = coletarImoveis();
  const areaTotal = imoveis.reduce(function (s, i) { return s + (Number(i.area_m2) || 0); }, 0);
  const valorVenalTotal = $$('.imovel-card[data-imovel-id] .f-valor').reduce(function (s, inp) {
    const v = parseFloat(inp.value);
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  const tipoImovel = $('#cli_tipo_imovel').value;
  const tipoZona = tipoImovel === 'rural' ? 'rural' : 'urbana';
  const estadoCivil = $('#cli_estado_civil').value || undefined;
  const honorario = parseFloat($('#honorario_sm').value) === 0.5 ? 0.5 : 1.0;

  const assessoriaHab = $('#assessoria_habilitada').checked;
  const assessoriaValor = parseFloat($('#assessoria_valor').value);

  const dadosImovel = {
    tipo: 'remembramento',
    area_total_m2: areaTotal,
    valor_venal_total: valorVenalTotal,
    tipo_zona: tipoZona,
    iptu_em_dia: $('#st_iptu_em_dia').checked,
    honorario_projeto_sm: honorario,
    numero_lotes_origem: imoveis.length,
    imoveis: imoveis,
    cliente_estado_civil: estadoCivil,
    status_documentacao: {
      cnd_iptu_anexada: $('#st_cnd_iptu').checked,
      bci_anexado: $('#st_bci').checked,
      certidao_inteiro_teor_data: $('#st_certidao_data').value,
    },
    assessoria_tecnica: {
      habilitada: assessoriaHab,
      valor: assessoriaHab && !isNaN(assessoriaValor) ? assessoriaValor : 0,
    },
  };

  return {
    subtipo: 'remembramento',
    cliente_id: (typeof window.__CLIENTE_ID__ !== 'undefined' && window.__CLIENTE_ID__ !== null)
      ? window.__CLIENTE_ID__
      : null,
    dados_imovel: dadosImovel,
  };
}

async function submitForm(ev) {
  ev.preventDefault();
  if (submitting) return;

  // Re-valida todos os steps antes de enviar
  for (let s = 1; s <= 5; s++) {
    if (!validateStep(s)) {
      goToStep(s);
      return;
    }
  }

  const btn = $('#btn-submit');
  const form = $('#form-remembramento');
  submitting = true;
  form.classList.add('submitting');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const payload = montarPayload();
    const resp = await fetch('/api/propostas-consultoria', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      let msg = 'Falha ao criar a proposta (HTTP ' + resp.status + ').';
      try {
        const err = await resp.json();
        if (err && (err.error || err.message)) msg = err.error || err.message;
      } catch (_) { /* corpo não-JSON */ }
      alert(msg);
      return;
    }

    // Sucesso — redireciona para o painel
    window.location.href = '/painel.html';
  } catch (err) {
    console.error('[submit remembramento] erro:', err);
    alert('Erro de rede ao enviar a proposta. Tente novamente.');
  } finally {
    submitting = false;
    form.classList.remove('submitting');
    btn.disabled = false;
    btn.textContent = 'Criar proposta';
  }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────
function init() {
  // Default: certidão hoje
  const certInput = $('#st_certidao_data');
  if (certInput && !certInput.value) certInput.max = todayISO();

  bindNavButtons();
  bindCertidaoAviso();
  initImoveisStep();
  bindConjugeToggle();
  bindAssessoriaToggle();

  $('#form-remembramento').addEventListener('submit', submitForm);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
