// src/routes/obrasEntregaPublica.ts
// v3.81.0 — Página pública do Relatório de Entrega de Obra.
// Montado em /v/entrega (fora da auth — handlers standalone, igual /v/laudo/:hash).
//   GET  /v/entrega/:hash            → página HTML + botão "Confirmar recebimento"
//   GET  /v/entrega/:hash/json       → dados (JSON)
//   GET  /v/entrega/:hash/pdf        → PDF inline
//   POST /v/entrega/:hash/confirmar  → grava timestamp de recebimento
import { Router, type Request, type Response } from 'express';
import { getBaseUrl } from '../services/reciboPdf';
import { buscarPorHash, confirmarRecebimento } from '../services/obrasEntregaRepo';
import { gerarEntregaPdf } from '../services/obrasEntregaPdf';

const router = Router();

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
function fmtBRL(v?: number | null): string {
  return v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDataHora(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return esc(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

function paginaNaoEncontrada(res: Response): void {
  res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`
    <!doctype html><html lang=pt-br><head><meta charset=utf-8>
    <meta name=viewport content="width=device-width,initial-scale=1">
    <title>Entrega não encontrada</title>
    <style>body{font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px;background:#0C3320;color:#fff}
    .x{background:#14472B;border:1px solid #C9A84C;padding:24px;border-radius:12px;text-align:center}</style>
    </head><body><div class=x><h1>❌ Entrega não encontrada</h1>
    <p>Link inválido ou relatório removido.</p></div></body></html>`);
}

// GET /:hash — página pública.
router.get('/:hash', async (req: Request, res: Response) => {
  try {
    const doc = await buscarPorHash(String(req.params.hash));
    if (!doc) return paginaNaoEncontrada(res);
    const base = getBaseUrl();
    const pdfUrl = `${base}/v/entrega/${doc.hash_publico}/pdf`;
    const jaConfirmado = !!doc.recebimento_confirmado_em;
    const confirmBloco = jaConfirmado
      ? `<div class="ok">✓ Recebimento confirmado em ${fmtDataHora(doc.recebimento_confirmado_em)}</div>`
      : `<button id="btnConfirmar" class="btn-gold">✓ Confirmar recebimento</button>
         <p class="hint">Ao confirmar, você registra que recebeu esta obra concluída.</p>`;

    res.set('Cache-Control', 'no-cache, must-revalidate').set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrega ${esc(doc.numero || doc.id)} — Romatec</title>
<style>
  :root{--green:#0C3320;--green2:#14472B;--gold:#C9A84C;--gold-soft:#E3D19A;--ink:#1C1C18}
  *{box-sizing:border-box}
  body{font-family:'Inter',system-ui,-apple-system,sans-serif;margin:0;background:#f2f0e9;color:var(--ink)}
  .hero{background:linear-gradient(135deg,var(--green),var(--green2));color:#fff;padding:30px 20px}
  .wrap{max-width:720px;margin:0 auto;padding:20px}
  .kick{color:var(--gold-soft);letter-spacing:2px;text-transform:uppercase;font-size:11px;margin:0 0 6px}
  h1{margin:0;font-size:22px}.num{color:var(--gold);font-weight:700;margin-top:4px}
  .card{background:#fff;border-radius:12px;padding:18px 20px;margin:16px 0;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
  .row:last-child{border-bottom:0}.row b{color:var(--green)}
  .valor{background:var(--green);color:#fff;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
  .valor .v{color:var(--gold);font-size:24px;font-weight:800}
  .btn-gold{background:var(--gold);color:var(--green);border:0;font-weight:800;font-size:16px;padding:14px 20px;border-radius:10px;width:100%;cursor:pointer}
  .btn-gold:disabled{opacity:.6}
  .btn-ghost{display:inline-block;margin-top:10px;color:var(--green);text-decoration:none;font-weight:600;border:1px solid var(--gold);padding:10px 16px;border-radius:8px}
  .ok{background:rgba(16,185,129,.12);border:1px solid #10b981;color:#0f7a52;border-radius:8px;padding:12px 14px;font-weight:700;text-align:center}
  .hint{color:#6A6656;font-size:12px;text-align:center;margin:8px 0 0}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px}
  .grid img{width:100%;border-radius:8px;border:1px solid #ddd}
  .foot{color:#6A6656;font-size:11px;text-align:center;padding:20px}
</style></head>
<body>
  <div class="hero"><div class="wrap" style="padding:0">
    <p class="kick">Romatec Consultoria Total</p>
    <h1>Relatório de Entrega de Obra</h1>
    <div class="num">${esc(doc.numero || `RE-${doc.id}`)}</div>
  </div></div>
  <div class="wrap">
    <div class="card">
      <div class="row"><span>Obra / Título</span><b>${esc(doc.titulo || '—')}</b></div>
      <div class="row"><span>Cliente</span><b>${esc(doc.cliente || '—')}</b></div>
      <div class="row"><span>Endereço</span><b>${esc(doc.endereco_obra || '—')}</b></div>
      <div class="row"><span>Data de entrega</span><b>${fmtDataHora(doc.data_entrega)}</b></div>
      <div class="row"><span>Responsável</span><b>${esc(doc.responsavel_nome || 'José Romário Pinto Bezerra')}</b></div>
    </div>
    <div class="card"><div class="valor"><span>Valor a receber</span><span class="v">${fmtBRL(doc.valor_receber)}</span></div></div>
    ${(doc.fotos || []).filter((f) => f.tipo === 'depois').length ? `<div class="card"><b style="color:var(--green)">Resultado final</b><div class="grid">${(doc.fotos || []).filter((f) => f.tipo === 'depois').slice(0, 6).map((f) => `<img src="data:${esc(f.mime)};base64,${f.data_base64}" alt="">`).join('')}</div></div>` : ''}
    <div class="card">
      ${confirmBloco}
      <a class="btn-ghost" href="${esc(pdfUrl)}" target="_blank" rel="noopener">📄 Ver relatório completo (PDF)</a>
    </div>
  </div>
  <div class="foot">Romatec Consultoria Total — Açailândia/MA</div>
  <script>
    var btn=document.getElementById('btnConfirmar');
    if(btn){btn.addEventListener('click',function(){
      btn.disabled=true;btn.textContent='Registrando...';
      fetch(location.pathname.replace(/\\/$/,'')+'/confirmar',{method:'POST'})
        .then(function(r){return r.json();})
        .then(function(j){
          if(j.ok){ btn.outerHTML='<div class="ok">✓ Recebimento confirmado! Obrigado.</div>'; }
          else { btn.disabled=false; btn.textContent='✓ Confirmar recebimento'; alert(j.error||'Falha ao confirmar.'); }
        })
        .catch(function(){ btn.disabled=false; btn.textContent='✓ Confirmar recebimento'; alert('Falha de rede.'); });
    });}
  </script>
</body></html>`);
  } catch (err) {
    console.error('[entrega pública GET /:hash]', err);
    res.status(500).set('Content-Type', 'text/html; charset=utf-8').send('<pre>Erro ao carregar entrega.</pre>');
  }
});

// GET /:hash/json — dados públicos.
router.get('/:hash/json', async (req: Request, res: Response) => {
  try {
    const doc = await buscarPorHash(String(req.params.hash));
    if (!doc) return res.status(404).json({ error: 'Hash inválido' });
    res.json({
      tipo: 'entrega_obra',
      entrega: {
        numero: doc.numero, titulo: doc.titulo, cliente: doc.cliente,
        endereco_obra: doc.endereco_obra, cidade_uf: doc.cidade_uf,
        status: doc.status, valor_receber: doc.valor_receber,
        data_entrega: doc.data_entrega, responsavel_nome: doc.responsavel_nome,
        recebimento_confirmado_em: doc.recebimento_confirmado_em,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /:hash/pdf — PDF público.
router.get('/:hash/pdf', async (req: Request, res: Response) => {
  try {
    const doc = await buscarPorHash(String(req.params.hash));
    if (!doc) return res.status(404).json({ error: 'Hash inválido' });
    const link = `${getBaseUrl()}/v/entrega/${doc.hash_publico}`;
    const pdf = await gerarEntregaPdf(doc, { linkPublico: link });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.numero || `RE-${doc.id}`}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// POST /:hash/confirmar — cliente confirma recebimento (grava timestamp + IP).
router.post('/:hash/confirmar', async (req: Request, res: Response) => {
  try {
    const ip = (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip || null;
    const r = await confirmarRecebimento(String(req.params.hash), ip);
    if (!r.ok) return res.status(404).json({ ok: false, error: 'Entrega não encontrada.' });
    res.json({ ok: true, jaConfirmado: r.jaConfirmado });
  } catch (err) {
    console.error('[entrega pública POST /:hash/confirmar]', err);
    res.status(500).json({ ok: false, error: 'Falha ao confirmar recebimento.' });
  }
});

export default router;
