// v1.99.16 — Seletor de template de exportacao PDF (Padrao / Prime I / Prime II).
// Vanilla JS, sem dependencias externas (mesmo padrao dos wizards do projeto).
//
// Uso:
//   <span id="export-proposta"></span>
//   <script src="/js/exportar-pdf-prime.js"></script>
//   <script>
//     montarSeletorPdf(document.getElementById('export-proposta'), {
//       tipo: 'proposta',          // 'proposta' | 'recibo'
//       id: '14',                  // id do documento
//       // URL do template Padrao (pipeline pdfkit existente, intocado):
//       urlPadrao: '/api/propostas-consultoria/14/pdf-assinado',
//     });
//   </script>
//
// Prime I / Prime II usam os endpoints novos /api/pdf-prime/<tipo>/<id>?template=.
'use strict';

(function () {
  var TEMPLATES = [
    { id: 'padrao', label: 'Padrao', descricao: 'Modelo tradicional Romatec' },
    { id: 'prime1', label: 'Prime I', descricao: 'Dark Premium — verde e dourado' },
    { id: 'prime2', label: 'Prime II', descricao: 'Clean Editorial — minimalista' },
  ];

  function baixarBlob(url, filename) {
    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (j) {
            throw new Error(j && j.error ? j.error : 'Falha ao gerar PDF (' + res.status + ')');
          }).catch(function () { throw new Error('Falha ao gerar PDF (' + res.status + ')'); });
        }
        return res.blob();
      })
      .then(function (blob) {
        var objUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
      });
  }

  function urlDoTemplate(opts, templateId) {
    if (templateId === 'padrao') return opts.urlPadrao;
    return '/api/pdf-prime/' + encodeURIComponent(opts.tipo) + '/' + encodeURIComponent(opts.id) +
      '?template=' + encodeURIComponent(templateId);
  }

  // Monta um botao com dropdown de 3 opcoes dentro de `container`.
  window.montarSeletorPdf = function montarSeletorPdf(container, opts) {
    if (!container) throw new Error('container ausente');
    if (!opts || !opts.tipo || !opts.id) throw new Error('opts.tipo e opts.id sao obrigatorios');
    if (!opts.urlPadrao) throw new Error('opts.urlPadrao (endpoint do template Padrao) e obrigatorio');

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.display = 'inline-block';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '📄 Exportar PDF ▼';
    btn.style.cssText =
      'display:inline-flex;gap:8px;align-items:center;padding:8px 16px;background:#0B6E4F;' +
      'color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;';

    var menu = document.createElement('div');
    menu.style.cssText =
      'position:absolute;right:0;margin-top:4px;width:256px;background:#fff;border:1px solid #e5e7eb;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.12);border-radius:8px;z-index:50;display:none;overflow:hidden;';

    TEMPLATES.forEach(function (opt, idx) {
      var item = document.createElement('button');
      item.type = 'button';
      item.style.cssText =
        'display:block;width:100%;text-align:left;padding:12px 16px;background:#fff;border:none;cursor:pointer;' +
        (idx < TEMPLATES.length - 1 ? 'border-bottom:1px solid #f1f1f1;' : '');
      item.innerHTML =
        '<div style="font-weight:600;font-size:13px;color:#1f2937;">' + opt.label + '</div>' +
        '<div style="font-size:12px;color:#6b7280;">' + opt.descricao + '</div>';
      item.addEventListener('mouseenter', function () { item.style.background = '#f9fafb'; });
      item.addEventListener('mouseleave', function () { item.style.background = '#fff'; });
      item.addEventListener('click', function () {
        menu.style.display = 'none';
        var filename = opts.tipo + '-' + opts.id + '-' + opt.id + '.pdf';
        var prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Gerando...';
        baixarBlob(urlDoTemplate(opts, opt.id), filename)
          .catch(function (err) { alert('Erro: ' + err.message); })
          .then(function () { btn.disabled = false; btn.textContent = prev; });
      });
      menu.appendChild(item);
    });

    btn.addEventListener('click', function () {
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) menu.style.display = 'none';
    });

    container.appendChild(btn);
    container.appendChild(menu);
  };
})();
