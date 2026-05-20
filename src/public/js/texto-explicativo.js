(() => {
  const $ = (id) => document.getElementById(id);

  function dadosFromForm() {
    const tipoServico = $('tipoServico').value;
    const out = {
      tipoServico,
      clienteNome: $('clienteNome').value.trim(),
      municipio: $('municipio').value.trim() || undefined,
      uf: $('uf').value.trim().toUpperCase() || undefined,
      tipoImovel: $('tipoImovel').value || undefined,
    };
    if (tipoServico === 'remembramento') {
      const q = Number($('quantidadeImoveis').value);
      if (q) out.quantidadeImoveis = q;
    } else {
      const a = Number($('areaTotal').value);
      if (a) out.areaTotal = a;
      out.unidadeArea = $('unidadeArea').value;
      const f = Number($('quantidadeFracoes').value);
      if (f) out.quantidadeFracoes = f;
    }
    return out;
  }

  function setStatus(msg, kind) {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status ' + (kind || '');
    el.style.display = msg ? 'block' : 'none';
  }

  $('tipoServico').addEventListener('change', (e) => {
    const isRem = e.target.value === 'remembramento';
    $('campos-remembramento').style.display = isRem ? 'flex' : 'none';
    $('campos-desmembramento').style.display = isRem ? 'none' : 'flex';
  });

  $('btnPreview').addEventListener('click', async () => {
    setStatus('Gerando preview…', 'warn');
    try {
      const r = await fetch('/api/explicativo/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dadosFromForm()),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha no preview');
      $('textoMontado').value = j.texto;
      setStatus('Preview gerado. Confira o texto abaixo e clique Enviar.', 'ok');
    } catch (err) {
      setStatus('❌ ' + err.message, 'err');
    }
  });

  $('btnEnviar').addEventListener('click', async () => {
    const numero = $('numeroDestino').value.replace(/\D/g, '');
    if (!numero || numero.length < 10) {
      setStatus('Número inválido (informe com DDI/DDD).', 'err');
      return;
    }
    setStatus('Enviando…', 'warn');
    try {
      const r = await fetch('/api/explicativo/enviar-avulso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dados: dadosFromForm(),
          numeroDestino: numero,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha no envio');
      if (j.ok === false && j.motivo === 'duplicado_60s') {
        setStatus('⚠️ Envio duplicado (mesma mensagem em < 60s). Aguarde.', 'warn');
        return;
      }
      setStatus('✅ Enviado. messageId: ' + (j.messageId || '—'), 'ok');
    } catch (err) {
      setStatus('❌ ' + err.message, 'err');
    }
  });
})();
