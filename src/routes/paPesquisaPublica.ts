// src/routes/paPesquisaPublica.ts
// v3.181.0 — Página pública da pesquisa de satisfação: /pa/pesquisa/<token>.
// Link pessoal (assinado) que o associado recebe no WhatsApp: siga o portal no Instagram
// e dê a nota de 0 a 10 para a Romatec (topografia). Mostra só o primeiro nome e o lote.
import { Router, type Request, type Response } from 'express';
import { PaErro } from '../services/pa/erros';
import { dadosPaginaPesquisa, registrarVoto, registrarCliqueInstagram, listaGrupoPesquisa, INSTAGRAM_PORTAL, INSTAGRAM_ARROBA } from '../services/pa/paPesquisa';

const router = Router();
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const ipDe = (req: Request) => (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null;

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f1e8;color:#1C1C18;-webkit-text-size-adjust:100%}
.w{max-width:480px;margin:0 auto;padding:16px}
.top{background:linear-gradient(135deg,#0C3320,#14472B);color:#fff;border-radius:14px;padding:16px 18px;border-bottom:4px solid #C9A84C;display:flex;gap:12px;align-items:center}
.top img{width:56px;height:56px;border-radius:50%;background:#fff;padding:3px;flex:0 0 auto}
.top small{color:#E8D9A8;letter-spacing:1.5px;font-size:10px;text-transform:uppercase}.top h1{margin:4px 0 2px;font-size:19px}.top p{margin:0;color:#d9e6dd;font-size:13px}
.c{background:#fff;border-radius:14px;padding:16px 18px;margin-top:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.passo{display:flex;align-items:center;gap:8px;font-weight:800;color:#0C3320;font-size:15px;margin-bottom:8px}.passo i{font-style:normal;background:#C9A84C;color:#0C3320;border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-size:14px}
.ig{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:0;border-radius:12px;padding:15px;font-size:17px;font-weight:800;color:#fff;text-decoration:none;background:linear-gradient(45deg,#F58529,#DD2A7B,#8134AF,#515BD4)}
.ig.ok{background:#2E7D32}
.notas{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;margin-top:6px}
.notas button{border:2px solid transparent;border-radius:10px;padding:12px 0;font-size:19px;font-weight:800;cursor:pointer;color:#fff}
.notas button.on{border-color:#0C3320;transform:scale(1.08);box-shadow:0 3px 10px rgba(0,0,0,.25)}
.esc{display:flex;justify-content:space-between;font-size:11.5px;color:#6A6656;margin-top:6px}
textarea{width:100%;border:1px solid #CFC7AE;border-radius:10px;padding:10px;font:15px Arial,sans-serif;margin-top:8px;min-height:70px}
.env{display:block;width:100%;border:0;border-radius:12px;padding:16px;margin-top:12px;font-size:18px;font-weight:800;cursor:pointer;background:#0C3320;color:#fff}
.env:disabled{opacity:.45}
.ok-box{text-align:center}.ok-box b{display:block;font-size:46px;color:#0C3320;margin:6px 0}
.av{font-size:12px;color:#6A6656;margin-top:8px;text-align:center}.erro{color:#B3261E;font-weight:700;margin-top:8px;display:none}`;
const corNota = (n: number) => (n <= 6 ? (n <= 3 ? '#B3261E' : '#E0703A') : n <= 8 ? '#D4A72C' : '#2E7D32');

export function htmlPesquisa(d: { nome: string; lote: string; projeto: string; nota: number | null; comentario: string | null; seguiu: boolean }, token: string): string {
  const p = d.nome.trim().split(/\s+/)[0] ?? '';
  const primeiro = p.charAt(0) + p.slice(1).toLowerCase();
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
  <title>Pesquisa de satisfação — Romatec</title><style>${CSS}</style></head><body><div class="w">
  <div class="top"><img src="/icons/pa-192.png" alt=""><div><small>Romatec · Topografia</small><h1>Pesquisa de satisfação</h1><p>Olá, ${esc(primeiro)} · Lote ${esc(d.lote)} · ${esc(d.projeto)}</p></div></div>
  <div class="c" id="formulario">
    <div class="passo"><i>1</i> Siga o nosso portal no Instagram</div>
    <a class="ig${d.seguiu ? ' ok' : ''}" id="ig" href="${INSTAGRAM_PORTAL}" target="_blank" rel="noopener">📷 ${d.seguiu ? 'Obrigado por seguir ' : 'Seguir '}${INSTAGRAM_ARROBA}</a>
    <div class="av">Abre o Instagram — toque em <b>Seguir</b> e volte para esta página.</div>
  </div>
  <div class="c">
    <div class="passo"><i>2</i> De 0 a 10, qual a sua satisfação com o trabalho de topografia da Romatec?</div>
    <div class="notas">${Array.from({ length: 11 }, (_, n) => `<button type="button" data-n="${n}" style="background:${corNota(n)}" class="${d.nota === n ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="esc"><span>0 = muito insatisfeito</span><span>10 = muito satisfeito</span></div>
    <textarea id="com" placeholder="Quer deixar um comentário ou sugestão? (opcional)" maxlength="600">${esc(d.comentario ?? '')}</textarea>
    <button class="env" id="env" ${d.nota == null ? 'disabled' : ''}>${d.nota == null ? 'Escolha uma nota' : 'Enviar minha nota'}</button>
    <div class="erro" id="erro"></div>
    ${d.nota != null ? `<div class="av">Você já respondeu (nota ${d.nota}). Pode alterar se quiser.</div>` : ''}
  </div>
  <div class="c ok-box" id="obrigado" style="display:none"><div class="passo" style="justify-content:center">✅ Obrigado pela sua avaliação!</div>Sua nota<b id="nf"></b>
    <a class="ig" href="${INSTAGRAM_PORTAL}" target="_blank" rel="noopener" style="margin-top:10px">📷 Acompanhe ${INSTAGRAM_ARROBA} no Instagram</a></div>
  <p class="av">Romatec Consultoria Total · Açailândia/MA · sua resposta é usada só para melhorar o atendimento.</p></div>
  <script>
  (function(){
    var nota = ${d.nota == null ? 'null' : d.nota}, base = '/pa/pesquisa/${esc(token)}';
    var env = document.getElementById('env');
    document.querySelectorAll('.notas button').forEach(function(b){ b.onclick = function(){
      nota = Number(b.dataset.n); document.querySelectorAll('.notas button').forEach(function(x){ x.classList.toggle('on', x === b); });
      env.disabled = false; env.textContent = 'Enviar minha nota (' + nota + ')';
    }; });
    document.getElementById('ig').addEventListener('click', function(){
      try { fetch(base + '/instagram', { method: 'POST', keepalive: true }); } catch (e) {}
      var a = document.getElementById('ig'); setTimeout(function(){ a.classList.add('ok'); a.textContent = '📷 Obrigado por seguir ${INSTAGRAM_ARROBA}'; }, 800);
    });
    env.onclick = function(){
      if (nota == null) return;
      env.disabled = true; env.textContent = 'Enviando…';
      fetch(base + '/voto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nota: nota, comentario: document.getElementById('com').value }) })
        .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.erro || 'Falha ao enviar'); return j; }); })
        .then(function(){ document.getElementById('nf').textContent = nota + ' / 10'; document.getElementById('obrigado').style.display = 'block'; env.closest('.c').style.display = 'none'; window.scrollTo(0, 0); })
        .catch(function(e){ var er = document.getElementById('erro'); er.style.display = 'block'; er.textContent = e.message + ' — tente de novo.'; env.disabled = false; env.textContent = 'Enviar minha nota (' + nota + ')'; });
    };
  })();
  </script></body></html>`;
}

const erroHtml = (msg: string) => `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pesquisa — Romatec</title><style>${CSS}</style></head><body><div class="w"><div class="c"><b>${esc(msg)}</b><p class="av">Peça um novo link à Romatec.</p></div></div></body></html>`;

// v3.193.0: link geral (grupo do PA) — cada um acha o próprio nome ou lote e vai para a pesquisa pessoal
router.get('/grupo/:gtoken', async (req: Request, res: Response) => {
  try {
    const d = await listaGrupoPesquisa(req.params.gtoken);
    const itens = d.itens.map((x) => `<a class="it" href="/pa/pesquisa/${esc(x.token)}" data-b="${esc((x.nome + ' ' + x.lote).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))}"><b>Lote ${esc(x.lote)}</b><span>${esc(x.nome)}</span>${x.respondeu ? '<em>✓ já votou</em>' : '<em class="v">votar ›</em>'}</a>`).join('');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(`<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Pesquisa de satisfação — Romatec</title><style>${CSS}
      .busca{width:100%;border:2px solid #C9A84C;border-radius:12px;padding:14px;font-size:17px;margin-top:6px}
      .it{display:flex;align-items:center;gap:10px;padding:13px 4px;border-bottom:1px solid #EEE7D2;color:#1C1C18;text-decoration:none;font-size:16px}
      .it b{flex:0 0 78px;color:#0C3320}.it span{flex:1}.it em{font-style:normal;font-size:13px;color:#2E7D32;font-weight:700}.it em.v{color:#fff;background:#0C3320;border-radius:8px;padding:6px 10px}</style></head><body><div class="w">
      <div class="top"><img src="/icons/pa-192.png" alt=""><div><small>Romatec · Topografia</small><h1>Pesquisa de satisfação</h1><p>${esc(d.projeto)}</p></div></div>
      <div class="c"><div class="passo"><i>1</i> Procure o seu nome ou o nº do seu lote</div><input class="busca" id="q" placeholder="Ex.: Maria, 14" autocomplete="off" inputmode="search"><div id="l" style="margin-top:6px">${itens}</div>
      <div class="av">Toque no seu nome para abrir a <b>sua</b> pesquisa (siga ${esc(INSTAGRAM_ARROBA)} e dê a nota de 0 a 10).</div></div></div>
      <script>var q=document.getElementById('q');q.oninput=function(){var t=q.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();document.querySelectorAll('.it').forEach(function(a){a.style.display=!t||a.getAttribute('data-b').indexOf(t)>=0?'':'none'})}</script></body></html>`);
  } catch (e) {
    res.status(e instanceof PaErro ? e.http : 500).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;padding:24px">Link da pesquisa inválido.</body>`);
  }
});
router.get('/:token', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const d = await dadosPaginaPesquisa(req.params.token);
    res.type('html').send(htmlPesquisa(d, String(req.params.token)));
  } catch (e) {
    const http = e instanceof PaErro ? e.http : 500;
    if (!(e instanceof PaErro)) console.error('[pa-pesquisa]', e);
    res.status(http).type('html').send(erroHtml(e instanceof PaErro ? e.message : 'Não foi possível abrir a pesquisa agora'));
  }
});
router.post('/:token/voto', async (req: Request, res: Response) => {
  try { res.json(await registrarVoto(req.params.token, req.body?.nota, req.body?.comentario, ipDe(req))); }
  catch (e) { const pe = e instanceof PaErro; if (!pe) console.error('[pa-pesquisa]', e); res.status(pe ? e.http : 500).json({ erro: pe ? e.message : 'Falha ao registrar a nota' }); }
});
router.post('/:token/instagram', async (req: Request, res: Response) => {
  try { res.json(await registrarCliqueInstagram(req.params.token)); }
  catch (e) { const pe = e instanceof PaErro; res.status(pe ? e.http : 500).json({ erro: pe ? e.message : 'falha' }); }
});

export default router;
