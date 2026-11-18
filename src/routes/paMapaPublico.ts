// src/routes/paMapaPublico.ts
// v3.182.0 — Mapa público dos lotes para os associados: /pa/mapa/<token>.
// Mesmo motor do sistema (2D/3D, Mapa/Satélite/Relevo, girar, lote que sobe ao clicar), mas
// com dados restritos: só número do lote, nome do associado, lote da vila e denominação da
// chácara. Sem área, perímetro, CPF, telefone ou financeiro. Link assinado por projeto.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { PaErro } from '../services/pa/erros';
import { buscarProjeto } from '../services/pa/paRepo';
import { geojsonSubdivisao } from '../services/pa/paMapas';
import { baseUrlPublica } from '../services/pa/paBoletoPdf';
import { marcaUrls } from '../services/pa/marcaProjeto';

const segredo = () => process.env.JWT_SECRET || process.env.PA_PESQUISA_SEGREDO || 'romatec-mapa';
const assinatura = (pid: number) => createHmac('sha256', segredo()).update(`mapa-publico:${pid}`).digest('base64url').slice(0, 14);
export const tokenMapaPublico = (pid: number) => `${pid.toString(36)}-${assinatura(pid)}`;
export function lerTokenMapa(t: unknown): number | null {
  const m = String(t ?? '').match(/^([0-9a-z]{1,8})-([\w-]{14})$/);
  if (!m) return null;
  const pid = parseInt(m[1], 36);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(assinatura(pid));
  return a.length === b.length && timingSafeEqual(a, b) ? pid : null;
}
export const linkMapaPublico = (pid: number) => `${baseUrlPublica()}/pa/mapa/${tokenMapaPublico(pid)}`;
export function textoMapaPublico(projetoNome: string, link: string): string {
  return [
    `🗺️ *MAPA DOS LOTES — ${projetoNome.toUpperCase()}*`,
    '',
    'Toque no link para ver o mapa do PA no celular: dá para *girar, aproximar, ver em 3D, satélite ou relevo*. Toque no seu lote para ver o número, o nome do associado, o lote da vila e o nome da chácara.',
    '',
    `👉 ${link}`,
    '',
    '_Romatec Consultoria Total_',
  ].join('\n');
}

type Feicao = { type: string; geometry: unknown; properties: Record<string, unknown> };
/** Só o que pode ir para o público (pura — testável): sem área, perímetro, CPF, telefone, financeiro. */
export function geoPublico(geo: { features: Feicao[] }): { type: 'FeatureCollection'; features: Feicao[] } {
  return {
    type: 'FeatureCollection',
    features: geo.features.filter((f) => f.properties.tipo !== 'MUNICIPIO').map((f) => {
      if (f.properties.tipo === 'LOTE') {
        const b = f.properties.beneficiario as { nome?: string; lote_vila?: string; denominacao?: string | null } | null;
        return { type: 'Feature', geometry: f.geometry, properties: { tipo: 'LOTE', lote: f.properties.lote, beneficiario: b ? { nome: b.nome ?? null, lote_vila: b.lote_vila ?? null, denominacao: b.denominacao ?? null } : null } };
      }
      return { type: 'Feature', geometry: f.geometry, properties: { tipo: f.properties.tipo, rotulo: f.properties.rotulo ?? null } };
    }),
  };
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f1e8;color:#1C1C18;-webkit-text-size-adjust:100%}
.w{max-width:1100px;margin:0 auto;padding:12px}
.top{background:linear-gradient(135deg,#0C3320,#14472B);color:#fff;border-radius:14px;padding:12px 16px;border-bottom:4px solid #C9A84C;display:flex;gap:12px;align-items:center}
.top img{width:52px;height:52px;border-radius:50%;background:#fff;padding:2px;flex:0 0 auto;object-fit:contain}
.top small{color:#E8D9A8;letter-spacing:1.5px;font-size:10px;text-transform:uppercase}.top h1{margin:2px 0;font-size:19px}.top p{margin:0;color:#d9e6dd;font-size:12.5px}
.c{background:#fff;border-radius:14px;padding:12px 14px;margin-top:10px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{border:1px solid #CFD8BF;border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer;background:#fff;color:#0C3320}
.btn-primary{background:#0C3320;color:#fff;border-color:#0C3320}.btn-ghost{background:#fff;color:#0C3320}.btn-sm{padding:6px 12px;font-size:12.5px}
label{font-size:12px;font-weight:700;color:#6A6656;display:block;margin-bottom:3px}
input,select{width:100%;border:1px solid #CFC7AE;border-radius:10px;padding:10px;font-size:15px;background:#fff}
.ml-mapa{height:560px;border:1px solid #CFD8BF;border-radius:16px;overflow:hidden;margin-top:8px;background:#E7EEDB}
@media (max-width:700px){.ml-mapa{height:460px}}
.leaflet-tooltip.ml-rot{background:transparent;border:0;box-shadow:none;padding:0;color:#0C3320;font-weight:800;font-size:10px;text-shadow:0 0 3px #fff,0 0 3px #fff}
.leaflet-tooltip.ml-rot:before{display:none}
.ml-modo{display:flex;gap:8px;flex-wrap:wrap}
.ml-modo button{display:inline-flex;align-items:center;gap:6px;border:1px solid #CFD8BF;background:#fff;color:#0C3320;border-radius:999px;padding:7px 16px;font-size:13px;font-weight:700;cursor:pointer}
.ml-modo button.on{border-color:#C9A84C;background:#FBF4E0;color:#7A5B12}
.ml-wrap{position:relative;isolation:isolate}
.ml-ctl{position:absolute;top:10px;left:10px;z-index:5;display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:calc(100% - 64px)}
.ml-ctl .pill,.ml-ctl .seg button{display:inline-flex;align-items:center;gap:6px;background:#fff;color:#0C3320;border:0;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
.ml-ctl .pill{border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.18)}.ml-ctl .pill.on{background:#0C3320;color:#fff}
.ml-ctl .seg{display:flex;flex-wrap:nowrap;max-width:100%;overflow-x:auto;scrollbar-width:none;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.18);background:#fff}
.ml-ctl .seg button.on{background:#0C3320;color:#fff}
.ml-modo .ml-fullbtn{background:#0C3320;color:#fff;border-color:#0C3320}
.ml-fsico{display:flex !important;align-items:center;justify-content:center;width:29px;height:29px;padding:0;border:0;background:#fff;color:#0C3320;cursor:pointer}
.ml-fsctl-l .ml-fsico{width:34px;height:34px;border-radius:4px}
.ml-full{position:absolute;left:10px;bottom:10px;z-index:1100;background:#fff;color:#0C3320;border:0;border-radius:10px;padding:8px 12px;font-weight:700;font-size:13px}
.ml-wrap.cheia{position:fixed !important;inset:0;z-index:9999;margin:0 !important;background:#E7EEDB;border-radius:0}
.ml-wrap.cheia .ml-mapa{height:100vh;height:100dvh;border:0;border-radius:0;margin:0}
.ml-wrap:fullscreen .ml-mapa{height:100%}
.ml-wrap.cheia .ml-ctl{top:calc(10px + env(safe-area-inset-top))}
body.ml-travado{overflow:hidden}
.ml-fsbar{position:absolute;z-index:1100;left:calc(12px + env(safe-area-inset-left));bottom:calc(64px + env(safe-area-inset-bottom));display:flex;flex-wrap:wrap;gap:6px}
.ml-rot3d{color:#0C3320;font-weight:800;font-size:11px;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 2px #fff;pointer-events:none;white-space:nowrap}
@media (max-width:700px){.ml-ctl{max-width:calc(100% - 52px)}.ml-ctl .pill,.ml-ctl .seg button{padding:6px 8px;font-size:11px;gap:4px}.ml-rot3d{font-size:10px}}
.card-lote{margin-top:10px;padding:16px;border-radius:16px;background:#fff;border:2px solid #C9A84C;display:none}
.card-lote small{color:#6A6656;font-size:12px;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
.card-lote h2{margin:2px 0 8px;font-size:26px;color:#0C3320;font-family:Georgia,serif}
.card-lote .g{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.card-lote .g div{border:1px solid #E5DFCD;border-radius:10px;padding:8px 10px;background:#FBFAF5}.card-lote .g span{display:block;font-size:11px;color:#6A6656;text-transform:uppercase;font-weight:700}.card-lote .g b{font-size:16px;color:#0C3320}
.av{font-size:12px;color:#6A6656;margin-top:8px;text-align:center}`;

export function htmlMapaPublico(p: { nome: string; municipio: string; uf: string; associacao: string | null; emblema: string | null; brasao: string | null }, token: string): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
  <meta name="theme-color" content="#0C3320"><title>Mapa dos lotes — ${esc(p.nome)}</title><style>${CSS}</style></head><body><div class="w">
  <div class="top">${p.emblema ? `<img src="${esc(p.emblema)}" alt="">` : ''}<div style="flex:1"><small>Mapa dos lotes</small><h1>${esc(p.nome)}</h1><p>${esc(p.associacao || '')}${p.associacao ? ' · ' : ''}${esc(p.municipio)}/${esc(p.uf)}</p></div>${p.brasao ? `<img src="${esc(p.brasao)}" alt="" style="border-radius:10px">` : ''}</div>
  <div class="c">
    <label for="busca">Procure pelo seu nome, chácara ou número do lote</label>
    <input id="busca" list="lista" placeholder="Ex.: Maria, São José, 43" autocomplete="off"><datalist id="lista"></datalist>
    <div class="row" style="margin-top:10px;justify-content:space-between">
      <div class="ml-modo" id="pModo"><button data-modo="2d">🗺️ Mapa 2D</button><button data-modo="3d">🧊 Mapa 3D</button><button type="button" class="ml-fullbtn">⛶ Tela cheia</button></div>
      <span class="pBase"><button class="btn btn-sm btn-primary" data-base="mapa">🗺️ Mapa</button> <button class="btn btn-sm btn-ghost" data-base="satelite">🛰️ Satélite</button> <button class="btn btn-sm btn-ghost" data-base="relevo">⛰️ Relevo</button></span>
    </div>
    <div class="ml-wrap"><div id="pMapa" class="ml-mapa"><div style="padding:120px 20px;text-align:center;color:#6A6656">Carregando o mapa…</div></div><div id="pCtl" class="ml-ctl" hidden></div></div>
  </div>
  <div class="card-lote" id="cartao"></div>
  <p class="av">Toque num lote para ver o número, o associado, o lote da vila e o nome da chácara. Romatec Consultoria Total · Açailândia/MA</p></div>
  <script>const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));</script>
  <script src="/js/pa-mapa-motor.js"></script>
  <script>
  (function(){
    var GEO = null, ATUAL = null, eng = null;
    var cartao = document.getElementById('cartao');
    function mostrarLote(f){
      var b = f.properties.beneficiario;
      cartao.style.display = 'block';
      cartao.innerHTML = '<small>Lote de produção</small><h2>LT-' + esc(f.properties.lote) + '</h2><div class="g">'
        + '<div><span>Associado(a)</span><b>' + esc(b && b.nome ? b.nome : 'Sem associado vinculado') + '</b></div>'
        + '<div><span>Lote na vila</span><b>' + esc(b && b.lote_vila ? b.lote_vila : '—') + '</b></div>'
        + '<div><span>Chácara</span><b>' + esc(b && b.denominacao ? b.denominacao : '—') + '</b></div></div>';
    }
    function desenhar(){
      var box = document.getElementById('pMapa'), ctl = document.getElementById('pCtl');
      var modo = modoMapaLotes();
      document.querySelectorAll('#pModo [data-modo]').forEach(function(b){
        b.classList.toggle('on', b.dataset.modo === modo);
        b.onclick = function(){ if (b.dataset.modo === modoMapaLotes()) return; try { localStorage.setItem('pa_mapa_modo', b.dataset.modo); } catch (e) {} desenhar(); };
      });
      if (eng && eng.parar) eng.parar();
      if (eng && eng.mapa) { try { eng.mapa.remove(); } catch (e) {} }
      ctl.hidden = true; ctl.innerHTML = ''; box.innerHTML = '';
      (modo === '3d' ? carregarMapLibre() : carregarLeaflet()).then(function(lib){
        var lotesF = GEO.features.filter(function(f){ return f.properties.tipo === 'LOTE'; });
        var porLote = {}; lotesF.forEach(function(f){ porLote[f.properties.lote] = f; });
        var ctx = { geo: GEO, lotesF: lotesF, porLote: porLote, ctl: ctl, baseSel: '.pBase [data-base]', rotulo: function(f){ return 'LT-' + f.properties.lote; } };
        ctx.selecionar = function(l, centralizar){ if (!porLote[l]) return; ATUAL = l; eng.marcar(l, centralizar); mostrarLote(porLote[l]); };
        eng = modo === '3d' ? mapaLotes3D(lib, box, ctx) : mapaLotes2D(lib, box, ctx);
        window.__sel = ctx.selecionar;
        if (ATUAL) setTimeout(function(){ ctx.selecionar(ATUAL, false); }, 400);
      }).catch(function(e){
        if (modo === '3d') { try { localStorage.setItem('pa_mapa_modo', '2d'); } catch (x) {} return desenhar(); }
        box.innerHTML = '<div style="padding:60px 20px;text-align:center">' + esc(e.message) + '</div>';
      });
    }
    fetch('/pa/mapa/${esc(token)}/geo.json').then(function(r){ if (!r.ok) throw new Error('Não foi possível carregar o mapa'); return r.json(); }).then(function(g){
      GEO = g;
      var lotes = g.features.filter(function(f){ return f.properties.tipo === 'LOTE'; });
      var opc = lotes.map(function(f){ var b = f.properties.beneficiario; return { lote: f.properties.lote, txt: 'LT-' + f.properties.lote + (b && b.nome ? ' · ' + b.nome : '') + (b && b.denominacao ? ' · ' + b.denominacao : '') }; });
      document.getElementById('lista').innerHTML = opc.map(function(o){ return '<option value="' + esc(o.txt) + '">'; }).join('');
      var busca = document.getElementById('busca');
      busca.onchange = function(){ var o = opc.find(function(x){ return x.txt === busca.value; }) || opc.find(function(x){ return x.txt.toLowerCase().indexOf(busca.value.trim().toLowerCase()) >= 0; });
        if (o && window.__sel) { window.__sel(o.lote, true); document.getElementById('pMapa').scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
      desenhar();
    }).catch(function(e){ document.getElementById('pMapa').innerHTML = '<div style="padding:60px 20px;text-align:center">' + esc(e.message) + '</div>'; });
  })();
  </script></body></html>`;
}

const router = Router();
async function projetoDoToken(t: unknown) {
  const pid = lerTokenMapa(t);
  if (!pid) throw new PaErro('LINK_INVALIDO', 'Link do mapa inválido', 404);
  return { pid, p: await buscarProjeto(pid) };
}
router.get('/:token', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const { pid, p } = await projetoDoToken(req.params.token);
    const m = marcaUrls(p.codigo);
    void pid;
    res.type('html').send(htmlMapaPublico({ nome: p.nome, municipio: p.municipio, uf: p.uf, associacao: p.associacao_nome, emblema: m.emblema, brasao: m.brasao }, String(req.params.token)));
  } catch (e) {
    const pe = e instanceof PaErro; if (!pe) console.error('[pa-mapa-publico]', e);
    res.status(pe ? e.http : 500).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><p style="font-family:Arial;padding:24px">${esc(pe ? e.message : 'Mapa indisponível no momento')}</p>`);
  }
});
router.get('/:token/geo.json', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, max-age=300'); res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const { pid } = await projetoDoToken(req.params.token);
    res.json(geoPublico((await geojsonSubdivisao(pid)) as unknown as { features: Feicao[] }));
  } catch (e) {
    const pe = e instanceof PaErro; if (!pe) console.error('[pa-mapa-publico]', e);
    res.status(pe ? e.http : 500).json({ erro: pe ? e.message : 'Mapa indisponível' });
  }
});
export default router;
