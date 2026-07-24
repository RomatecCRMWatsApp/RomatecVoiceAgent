// src/routes/diarioPublico.ts
// v3.128.0 — Página pública de verificação da assinatura do Diário de Obra.
// Montado em /v/diario (fora da auth — namespaced pra não colidir com
// /v/entrega, /v/inventario, /v/laudo).
//   GET /v/diario/:hash        → página HTML "assinado" + dados do signatário
//   GET /v/diario/:hash/json   → dados públicos (JSON)
//   GET /v/diario/:hash/pdf    → PDF do relatório assinado
import { Router, type Request, type Response } from 'express';
import { getBaseUrl } from '../services/reciboPdf';
import { buscarPorHash, conferirIntegridade, formatarDocumento } from '../services/diario/diarioAssinaturaRepo';

const router = Router();

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
function fmtData(d?: string | null): string {
  if (!d) return '—';
  const p = String(d).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : esc(d);
}
function fmtDataHora(iso?: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return esc(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())} (UTC)`;
}
function papelLabel(p: string): string {
  return p === 'responsavel' ? 'Responsável pela obra' : 'Proprietário';
}

function paginaNaoEncontrada(res: Response): void {
  res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`
    <!doctype html><html lang=pt-br><head><meta charset=utf-8>
    <meta name=viewport content="width=device-width,initial-scale=1">
    <title>Documento não encontrado</title>
    <style>body{font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px;background:#0C3320;color:#fff}
    .x{background:#14472B;border:1px solid #C9A84C;padding:24px;border-radius:12px;text-align:center}</style>
    </head><body><div class=x><h1>❌ Documento não encontrado</h1>
    <p>Link de verificação inválido ou assinatura removida.</p></div></body></html>`);
}

// GET /:hash — página pública de verificação.
router.get('/:hash', async (req: Request, res: Response) => {
  try {
    const a = await buscarPorHash(String(req.params.hash));
    if (!a || !a.snapshot) return paginaNaoEncontrada(res);
    const s = a.snapshot;
    const base = getBaseUrl();
    const pdfUrl = `${base}/v/diario/${a.hash_validacao}/pdf`;
    const integro = conferirIntegridade(a);
    const anulado = a.status === 'anulado';
    const rubricaSrc = a.assinatura_b64
      ? (a.assinatura_b64.startsWith('data:') ? a.assinatura_b64 : `data:image/png;base64,${a.assinatura_b64}`)
      : '';
    const gps = (a.latitude != null && a.longitude != null)
      ? `${a.latitude.toFixed(6)}, ${a.longitude.toFixed(6)}` : null;

    const statusBloco = anulado
      ? `<div class="status no">⚠ Assinatura anulada</div>`
      : integro
        ? `<div class="status ok">✓ Documento assinado e íntegro</div>`
        : `<div class="status no">⚠ Conteúdo divergente do hash — não confiar</div>`;

    const campo = (t: string, v?: string | null) =>
      v && v.trim() ? `<div class="campo"><div class="ct">${esc(t)}</div><div class="cv">${esc(v)}</div></div>` : '';

    res.set('Cache-Control', 'no-cache, must-revalidate').set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diário assinado — Romatec</title>
<style>
  :root{--green:#0C3320;--green2:#14472B;--gold:#C9A84C;--gold-soft:#E3D19A;--ink:#1C1C18;--muted:#6A6656}
  *{box-sizing:border-box}
  body{font-family:'Inter',system-ui,-apple-system,sans-serif;margin:0;background:#f2f0e9;color:var(--ink)}
  .hero{background:linear-gradient(135deg,var(--green),var(--green2));color:#fff;padding:30px 20px}
  .wrap{max-width:720px;margin:0 auto;padding:20px}
  .kick{color:var(--gold-soft);letter-spacing:2px;text-transform:uppercase;font-size:11px;margin:0 0 6px}
  h1{margin:0;font-size:22px}.num{color:var(--gold);font-weight:700;margin-top:4px}
  .card{background:#fff;border-radius:12px;padding:18px 20px;margin:16px 0;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .status{border-radius:10px;padding:14px 16px;font-weight:800;text-align:center;font-size:15px}
  .status.ok{background:rgba(16,185,129,.12);border:1px solid #10b981;color:#0f7a52}
  .status.no{background:rgba(239,68,68,.12);border:1px solid #ef4444;color:#b02020}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
  .row:last-child{border-bottom:0}.row b{color:var(--green)}
  .campo{margin:10px 0}.campo .ct{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:700}
  .campo .cv{font-size:14px;line-height:1.4;margin-top:2px;white-space:pre-wrap}
  .rub{text-align:center;margin-top:10px}
  .rub img{max-width:280px;max-height:120px;border-bottom:2px solid var(--ink)}
  .rub .l{font-size:12px;color:var(--muted);margin-top:4px}
  .hash{font-family:'Courier New',monospace;font-size:11px;word-break:break-all;background:var(--green);color:#fff;padding:10px 12px;border-radius:8px}
  .btn-ghost{display:inline-block;margin-top:12px;color:var(--green);text-decoration:none;font-weight:600;border:1px solid var(--gold);padding:10px 16px;border-radius:8px}
  .foot{color:var(--muted);font-size:11px;text-align:center;padding:20px}
</style></head>
<body>
  <div class="hero"><div class="wrap" style="padding:0">
    <p class="kick">Romatec Consultoria Total — Açailândia/MA</p>
    <h1>Relatório de Visita Técnica</h1>
    <div class="num">${esc(s.obra_nome || (s.obra_id ? 'Obra #' + s.obra_id : 'Diário de Obra'))} · ${fmtData(s.data_visita)}</div>
  </div></div>
  <div class="wrap">
    <div class="card">${statusBloco}</div>
    <div class="card">
      <div class="row"><span>Obra</span><b>${esc(s.obra_nome || (s.obra_id ? '#' + s.obra_id : '—'))}</b></div>
      <div class="row"><span>Data / Hora da visita</span><b>${fmtData(s.data_visita)} ${esc((s.hora_visita || '').slice(0, 5))}</b></div>
      ${campo('Observações', s.observacoes)}
      ${campo('Pendências', s.pendencias)}
      ${campo('Solicitações do Proprietário', s.solicitacoes_proprietario)}
    </div>
    <div class="card">
      <div class="row"><span>Signatário</span><b>${esc(a.signatario_nome)}</b></div>
      <div class="row"><span>Papel</span><b>${esc(papelLabel(a.signatario_papel))}</b></div>
      ${a.signatario_cpf ? `<div class="row"><span>CPF/CNPJ</span><b>${esc(formatarDocumento(a.signatario_cpf))}</b></div>` : ''}
      <div class="row"><span>Assinado em</span><b>${fmtDataHora(a.assinado_em)}</b></div>
      ${gps ? `<div class="row"><span>Local (GPS)</span><b>${esc(gps)}</b></div>` : ''}
      ${a.local_texto ? `<div class="row"><span>Local</span><b>${esc(a.local_texto)}</b></div>` : ''}
      ${rubricaSrc ? `<div class="rub"><img src="${rubricaSrc}" alt="assinatura"><div class="l">${esc(a.signatario_nome)}</div></div>` : ''}
    </div>
    <div class="card">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:700;margin-bottom:6px">Selo SHA-256</div>
      <div class="hash">${esc(a.hash_validacao)}</div>
      <a class="btn-ghost" href="${esc(pdfUrl)}" target="_blank" rel="noopener">📄 Ver relatório assinado (PDF)</a>
    </div>
  </div>
  <div class="foot">Romatec Consultoria Total — Açailândia/MA<br>Documento assinado eletronicamente. Confira o SHA-256 acima.</div>
</body></html>`);
  } catch (err) {
    console.error('[diario público GET /:hash]', err);
    res.status(500).set('Content-Type', 'text/html; charset=utf-8').send('<pre>Erro ao carregar documento.</pre>');
  }
});

// GET /:hash/json — dados públicos.
router.get('/:hash/json', async (req: Request, res: Response) => {
  try {
    const a = await buscarPorHash(String(req.params.hash));
    if (!a || !a.snapshot) return res.status(404).json({ error: 'Hash inválido' });
    res.json({
      tipo: 'diario_obra_assinatura',
      status: a.status,
      integro: conferirIntegridade(a),
      hash_validacao: a.hash_validacao,
      assinado_em: a.assinado_em,
      signatario: {
        nome: a.signatario_nome,
        cpf_cnpj: a.signatario_cpf ? formatarDocumento(a.signatario_cpf) : null,
        papel: a.signatario_papel,
      },
      visita: {
        obra_nome: a.snapshot.obra_nome,
        data_visita: a.snapshot.data_visita,
        hora_visita: a.snapshot.hora_visita,
        observacoes: a.snapshot.observacoes,
        pendencias: a.snapshot.pendencias,
        solicitacoes_proprietario: a.snapshot.solicitacoes_proprietario,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /:hash/pdf — PDF público do relatório assinado.
router.get('/:hash/pdf', async (req: Request, res: Response) => {
  try {
    const a = await buscarPorHash(String(req.params.hash));
    if (!a || !a.snapshot) return res.status(404).json({ error: 'Hash inválido' });
    const { gerarAssinaturaPdf } = await import('../services/diario/diarioAssinaturaPdf');
    const pdf = await gerarAssinaturaPdf({
      assinatura: a,
      snapshot: a.snapshot,
      linkPublico: `${getBaseUrl()}/v/diario/${a.hash_validacao}`,
      integro: conferirIntegridade(a),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="diario-assinado-${a.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

export default router;
