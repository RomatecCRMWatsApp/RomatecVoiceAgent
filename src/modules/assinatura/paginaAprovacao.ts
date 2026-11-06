// src/modules/assinatura/paginaAprovacao.ts
// v3.152.0 — Página pública de aprovação (celular) de um lote de assinatura.
// Montada em /assinatura/aprovar (fora da auth do /api; não é /api). O RT abre o
// link do Telegram, confere os PDFs e digita a senha do A1 AQUI (nunca no chat).
// Sem JavaScript: formulário nativo (2 botões submit). CSP restrita, no-store.
import { readFile } from 'node:fs/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { configAssinatura } from './config.js';
import {
  aprovarLote,
  buscarLotePorToken,
  ErroLoteIndisponivel,
  loteDisponivel,
  rejeitarLote,
  type LoteComDocs,
} from './chatLotes.js';
import { auditar, obterDocumento, statusCertificado, ErroSenhaCertificado } from './servico.js';
import { minutosBloqueado, registrarFalhaSenha, resetarFalhasSenha } from './antiBruteForce.js';

const ctx = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
function fmtDataHora(d?: Date | string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return esc(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

function headersSeguranca(res: Response): void {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  );
  res.set('Content-Type', 'text/html; charset=utf-8');
}

const CSS = `
  :root{--green:#0C3320;--green2:#14472B;--gold:#C9A84C;--gold-soft:#E3D19A;--ink:#1C1C18;--muted:#6A6656}
  *{box-sizing:border-box}
  body{font-family:'Inter',system-ui,-apple-system,sans-serif;margin:0;background:#f2f0e9;color:var(--ink)}
  .hero{background:linear-gradient(135deg,var(--green),var(--green2));color:#fff;padding:26px 20px}
  .wrap{max-width:680px;margin:0 auto;padding:16px}
  .kick{color:var(--gold-soft);letter-spacing:2px;text-transform:uppercase;font-size:11px;margin:0 0 6px}
  h1{margin:0;font-size:20px}
  .card{background:#fff;border-radius:12px;padding:16px 18px;margin:14px 0;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .doc{border-bottom:1px solid #eee;padding:12px 0}.doc:last-child{border-bottom:0}
  .doc .t{font-weight:700;color:var(--green);font-size:15px}
  .doc .m{font-size:12px;color:var(--muted);margin-top:2px}
  .hash{font-family:'Courier New',monospace;font-size:11px;word-break:break-all;color:var(--muted)}
  .pts{display:inline-block;background:rgba(201,168,76,.15);color:#8a6d1f;border:1px solid var(--gold);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;margin-top:6px}
  a.ver{display:inline-block;margin-top:8px;color:var(--green);text-decoration:none;font-weight:600;border:1px solid var(--gold);padding:7px 12px;border-radius:8px;font-size:13px}
  .cert{font-size:13px}.cert .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0efe9}.cert .row:last-child{border-bottom:0}.cert b{color:var(--green)}
  label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:700;margin:14px 0 6px}
  input[type=password],textarea{width:100%;padding:13px;border:1px solid #ccc;border-radius:10px;font-size:16px;font-family:inherit}
  .btns{display:flex;gap:10px;margin-top:16px}
  button{flex:1;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:800;cursor:pointer}
  .b-ok{background:var(--green);color:#fff}
  .b-no{background:#fff;color:#b02020;border:1px solid #e0b4b4}
  .warn{background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#b02020;border-radius:10px;padding:12px 14px;font-weight:700;font-size:14px;margin:12px 0}
  .ok-box{background:rgba(16,185,129,.12);border:1px solid #10b981;color:#0f7a52;border-radius:12px;padding:20px;text-align:center}
  .foot{color:var(--muted);font-size:11px;text-align:center;padding:18px}
`;

function layout(titulo: string, miolo: string): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)} — Romatec</title>
<style>${CSS}</style></head><body>
<div class="hero"><div class="wrap" style="padding:0">
  <p class="kick">Romatec Consultoria Total — Açailândia/MA</p>
  <h1>${esc(titulo)}</h1>
</div></div>
<div class="wrap">${miolo}</div>
<div class="foot">Assinatura digital ICP-Brasil (PAdES). A senha do certificado é usada só neste servidor e nunca é registrada.</div>
</body></html>`;
}

function paginaMensagem(res: Response, status: number, icone: string, titulo: string, texto: string): void {
  headersSeguranca(res);
  res.status(status).send(layout(titulo, `<div class="card"><div class="ok-box" style="background:rgba(201,168,76,.12);border-color:var(--gold);color:var(--ink)">
    <div style="font-size:40px">${icone}</div><h2 style="margin:8px 0">${esc(titulo)}</h2><p>${esc(texto)}</p></div></div>`));
}

function contarAncoras(ancoras: unknown): number {
  if (Array.isArray(ancoras)) return ancoras.length;
  if (typeof ancoras === 'string') { try { const a = JSON.parse(ancoras); return Array.isArray(a) ? a.length : 0; } catch { return 0; } }
  return 0;
}

function paginaFormulario(
  info: LoteComDocs,
  cert: Awaited<ReturnType<typeof statusCertificado>> | null,
  token: string,
  aviso?: string,
): string {
  const docs = info.documentos
    .map((d) => {
      const pts = contarAncoras((d as unknown as { ancoras?: unknown }).ancoras);
      return `<div class="doc">
        <div class="t">${esc(d.titulo)}</div>
        <div class="m">código ${esc(d.codigo)}</div>
        <div class="hash">SHA-256: ${esc((d.hash_original || '').slice(0, 24))}…</div>
        ${pts > 0 ? `<div class="pts">${pts} ponto(s) de assinatura</div>` : ''}
        <div><a class="ver" href="/assinatura/aprovar/${esc(token)}/pdf/${d.id}" target="_blank" rel="noopener">📄 Ver PDF</a></div>
      </div>`;
    })
    .join('');

  const certBloco = cert
    ? `<div class="card cert">
        <div class="row"><span>Certificado</span><b>${esc(cert.titular)}</b></div>
        <div class="row"><span>Autoridade</span><b>${esc(cert.emissor)}</b></div>
        <div class="row"><span>Validade</span><b>${fmtDataHora(cert.validoAte)}${cert.vencido ? ' (VENCIDO)' : ''}</b></div>
      </div>`
    : `<div class="warn">Certificado ativo não encontrado no servidor.</div>`;

  const avisoBloco = aviso ? `<div class="warn">${esc(aviso)}</div>` : '';

  return `
    ${avisoBloco}
    <div class="card">
      <div style="font-weight:800;color:var(--green);margin-bottom:4px">${esc(info.lote.titulo)}</div>
      <div style="font-size:12px;color:var(--muted)">Expira em ${fmtDataHora(info.lote.expira_em)} · ${info.documentos.length} documento(s)</div>
    </div>
    <div class="card">${docs}</div>
    ${certBloco}
    <form method="post" action="/assinatura/aprovar/${esc(token)}" autocomplete="off">
      <div class="card">
        <label for="senha">Senha do certificado A1</label>
        <input type="password" id="senha" name="senha" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="•••••••••">
        <label for="motivo">Motivo da rejeição (se recusar)</label>
        <textarea id="motivo" name="motivo" rows="2" placeholder="opcional"></textarea>
        <div class="btns">
          <button class="b-ok" type="submit" name="acao" value="assinar">✍️ Assinar</button>
          <button class="b-no" type="submit" name="acao" value="rejeitar">Rejeitar</button>
        </div>
      </div>
    </form>`;
}

export function criarRotasAprovacao(pool: Pool): Router {
  const router = Router();

  // GET /:token — página de aprovação.
  router.get('/:token', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token);
      const info = await buscarLotePorToken(pool, token);
      if (!info) return paginaMensagem(res, 404, '❌', 'Link inválido', 'Este link de assinatura não existe.');
      if (!loteDisponivel(info)) {
        return paginaMensagem(res, 410, '⏳', 'Link expirado ou já utilizado',
          'Peça ao Claude para gerar um novo envio de assinatura.');
      }
      const cert = await statusCertificado(pool).catch(() => null);
      await auditar(pool, 'visualizado', ctx(req), { detalhe: `lote ${info.lote.id}` });
      headersSeguranca(res);
      res.send(layout('Conferir e assinar', paginaFormulario(info, cert, token)));
    } catch (err) {
      console.error('[assinatura-aprovar GET]', err);
      paginaMensagem(res, 500, '⚠️', 'Erro', 'Não foi possível carregar o lote.');
    }
  });

  // GET /:token/pdf/:docId — PDF original (inline) para conferência.
  router.get('/:token/pdf/:docId', async (req: Request, res: Response) => {
    try {
      const info = await buscarLotePorToken(pool, String(req.params.token));
      if (!info) return paginaMensagem(res, 404, '❌', 'Link inválido', 'Link inválido.');
      const docId = Number(req.params.docId);
      const pertence = info.documentos.some((d) => d.id === docId);
      if (!pertence) return paginaMensagem(res, 404, '❌', 'Documento não encontrado', 'Documento não pertence a este lote.');
      const doc = await obterDocumento(pool, docId);
      if (!doc) return paginaMensagem(res, 404, '❌', 'Documento não encontrado', 'Documento não encontrado.');
      const pdf = await readFile(doc.arquivo_original);
      await auditar(pool, 'visualizado', ctx(req), { documentoId: docId, hash: doc.hash_original });
      res.set('Cache-Control', 'no-store').set('X-Frame-Options', 'SAMEORIGIN');
      res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${doc.codigo}.pdf"`).send(pdf);
    } catch (err) {
      console.error('[assinatura-aprovar GET pdf]', err);
      res.status(404).type('text/plain').send('PDF indisponível');
    }
  });

  // GET /:token/assinado/:docId — PDF assinado (após aprovação), para download do RT.
  router.get('/:token/assinado/:docId', async (req: Request, res: Response) => {
    try {
      const info = await buscarLotePorToken(pool, String(req.params.token));
      if (!info || info.statusEfetivo !== 'assinado') return paginaMensagem(res, 404, '❌', 'Indisponível', 'Documento assinado indisponível.');
      const docId = Number(req.params.docId);
      const doc = info.documentos.find((d) => d.id === docId);
      if (!doc) return paginaMensagem(res, 404, '❌', 'Não encontrado', 'Documento não pertence a este lote.');
      const full = await obterDocumento(pool, docId);
      if (!full || full.status !== 'assinado' || !full.arquivo_assinado) {
        return paginaMensagem(res, 409, '⏳', 'Ainda não assinado', 'Este documento ainda não está assinado.');
      }
      const pdf = await readFile(full.arquivo_assinado);
      res.set('Cache-Control', 'no-store');
      res.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${full.codigo}-ASSINADO.pdf"`).send(pdf);
    } catch (err) {
      console.error('[assinatura-aprovar GET assinado]', err);
      res.status(404).type('text/plain').send('Indisponível');
    }
  });

  // POST /:token — { acao: 'assinar'|'rejeitar', senha?, motivo? }
  router.post('/:token', async (req: Request, res: Response) => {
    const token = String(req.params.token);
    try {
      const bloqueio = minutosBloqueado();
      if (bloqueio !== null) {
        return paginaMensagem(res, 423, '🔒', 'Bloqueado temporariamente',
          `Muitas senhas inválidas. Tente novamente em ${bloqueio} min.`);
      }

      const info = await buscarLotePorToken(pool, token);
      if (!info) return paginaMensagem(res, 404, '❌', 'Link inválido', 'Este link não existe.');
      if (!loteDisponivel(info)) {
        return paginaMensagem(res, 410, '⏳', 'Link expirado ou já utilizado', 'Peça ao Claude um novo envio.');
      }

      const acao = String(req.body?.acao ?? '');
      const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
      const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';

      if (acao === 'rejeitar') {
        await rejeitarLote(pool, token, motivo || 'Rejeitado pelo responsável', ctx(req));
        return paginaMensagem(res, 200, '🚫', 'Lote rejeitado', 'Os documentos foram marcados como rejeitados.');
      }

      if (acao !== 'assinar') {
        const cert = await statusCertificado(pool).catch(() => null);
        headersSeguranca(res);
        return void res.status(400).send(layout('Conferir e assinar', paginaFormulario(info, cert, token, 'Ação inválida.')));
      }

      if (!senha) {
        const cert = await statusCertificado(pool).catch(() => null);
        headersSeguranca(res);
        return void res.status(400).send(layout('Conferir e assinar', paginaFormulario(info, cert, token, 'Digite a senha do certificado para assinar.')));
      }

      try {
        const resultados = await aprovarLote(pool, token, senha, ctx(req));
        resetarFalhasSenha();
        const assinados = resultados.filter((r) => r.ok);
        const falhas = resultados.filter((r) => !r.ok);
        const links = assinados
          .map((r) => `<div class="doc"><div class="t">${esc(r.titulo)}</div>
            <a class="ver" href="/assinatura/aprovar/${esc(token)}/assinado/${r.id}">⬇️ Baixar assinado</a></div>`)
          .join('');
        const falhasBloco = falhas.length
          ? `<div class="warn">${falhas.length} documento(s) falharam: ${esc(falhas.map((f) => `${f.titulo}: ${f.erro}`).join('; '))}</div>`
          : '';
        headersSeguranca(res);
        return void res.send(layout('Assinatura concluída', `
          <div class="card"><div class="ok-box"><div style="font-size:40px">✅</div>
          <h2 style="margin:8px 0">${assinados.length} documento(s) assinado(s)</h2>
          <p>Assinatura ICP-Brasil (PAdES) aplicada. O Claude vai receber os arquivos no chat.</p></div></div>
          ${falhasBloco}
          <div class="card">${links || '<p>Sem documentos assinados.</p>'}</div>`));
      } catch (e) {
        if (e instanceof ErroSenhaCertificado) {
          const r = registrarFalhaSenha();
          await auditar(pool, 'senha_invalida', ctx(req), { detalhe: `lote ${info.lote.id}` });
          if (r.bloqueado) {
            await auditar(pool, 'bloqueio', ctx(req), { detalhe: `${configAssinatura.bloqueioMinutos} min` });
            return paginaMensagem(res, 423, '🔒', 'Bloqueado temporariamente',
              `Senha inválida demais. Tente novamente em ${configAssinatura.bloqueioMinutos} min.`);
          }
          const restantes = configAssinatura.maxTentativasSenha - r.falhas;
          const cert = await statusCertificado(pool).catch(() => null);
          headersSeguranca(res);
          return void res.status(401).send(layout('Conferir e assinar',
            paginaFormulario(info, cert, token, `Senha incorreta. ${restantes} tentativa(s) restante(s).`)));
        }
        if (e instanceof ErroLoteIndisponivel) {
          return paginaMensagem(res, 410, '⏳', 'Link expirado ou já utilizado', e.message);
        }
        throw e;
      }
    } catch (err) {
      console.error('[assinatura-aprovar POST]', err);
      paginaMensagem(res, 500, '⚠️', 'Erro', 'Não foi possível concluir a operação.');
    }
  });

  return router;
}
