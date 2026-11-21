// src/routes/paProtocoloPublico.ts
// v3.198.0 — Página pública do protocolo de entrega das vias físicas: /pa/protocolo/<token>.
// Link pessoal que o associado recebe no WhatsApp: confere as peças, informa os 3 primeiros números do CPF e
// confirma o recebimento. Depois da confirmação a mesma página serve de verificação (código SHA-256 + PDF).
import { Router, type Request, type Response } from 'express';
import { PaErro } from '../services/pa/erros';
import { dadosPublicos, confirmarRecebimento, relatarProblema, pdfProtocoloPorToken, horaBrasilia, LEI_ASSINATURA, type DadosPublicos } from '../services/pa/paProtocoloEntrega';

const router = Router();
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const ipDe = (req: Request) => (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null;

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f1e8;color:#1C1C18;-webkit-text-size-adjust:100%}
.w{max-width:520px;margin:0 auto;padding:16px}
.top{background:linear-gradient(135deg,#0C3320,#14472B);color:#fff;border-radius:14px;padding:16px 18px;border-bottom:4px solid #C9A84C;display:flex;gap:12px;align-items:center}
.top img{width:56px;height:56px;border-radius:50%;background:#fff;padding:3px;flex:0 0 auto}
.top small{color:#E8D9A8;letter-spacing:1.5px;font-size:10px;text-transform:uppercase}.top h1{margin:4px 0 2px;font-size:18px}.top p{margin:0;color:#d9e6dd;font-size:13px}
.c{background:#fff;border-radius:14px;padding:16px 18px;margin-top:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.passo{display:flex;align-items:center;gap:8px;font-weight:800;color:#0C3320;font-size:15px;margin-bottom:8px}.passo i{font-style:normal;background:#C9A84C;color:#0C3320;border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex:0 0 auto}
.id div{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #EEE7D2;font-size:14.5px}.id div b{flex:0 0 112px;color:#6A6656;font-size:13px}
.it{list-style:none;margin:0;padding:0}.it li{display:flex;gap:9px;padding:9px 0;border-bottom:1px solid #EEE7D2;font-size:15px}.it li span{flex:1}.it li small{display:block;color:#6A6656;font-size:12.5px}
.it li em{font-style:normal;font-size:12px;font-weight:800;color:#2E7D32;white-space:nowrap}.it li.p em{color:#8A5A0B}.it li.p{background:#FFF6E6}
.decl{background:#F4F6F2;border-left:5px solid #0C3320;padding:10px 12px;border-radius:6px;font-size:14.5px;line-height:1.45}
label{display:block;font-weight:700;margin:12px 0 6px;font-size:14.5px}
.cpf{width:100%;border:2px solid #C9A84C;border-radius:12px;padding:14px;font-size:24px;letter-spacing:8px;text-align:center}
textarea{width:100%;border:1px solid #CFC7AE;border-radius:10px;padding:10px;font:15px Arial,sans-serif;min-height:60px}
.chk{display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:14.5px}.chk input{width:24px;height:24px;flex:0 0 auto;margin:0}
.env{display:block;width:100%;border:0;border-radius:12px;padding:17px;margin-top:14px;font-size:18px;font-weight:800;cursor:pointer;background:#1E7A3A;color:#fff}
.env:disabled{opacity:.45}.sec{background:#fff;color:#8A3B12;border:2px solid #E3B59A;font-size:15px;padding:12px}
.ok{text-align:center}.ok .big{font-size:52px}.hash{font-family:'Courier New',monospace;font-size:11.5px;word-break:break-all;background:#F4F6F2;padding:8px;border-radius:8px;margin-top:6px}
.pdf{display:block;text-align:center;text-decoration:none;background:#0C3320;color:#fff;border-radius:12px;padding:15px;font-weight:800;font-size:16px;margin-top:12px}
.av{font-size:12px;color:#6A6656;margin-top:8px;text-align:center;line-height:1.4}.erro{color:#B3261E;font-weight:700;margin-top:10px;display:none;text-align:center}`;

export function htmlProtocoloPublico(d: DadosPublicos, token: string): string {
  const p0 = d.nome.trim().split(/\s+/)[0] ?? '';
  const primeiro = p0.charAt(0) + p0.slice(1).toLowerCase();
  const itens = d.itens.map((i) => `<li class="${i.pendente ? 'p' : ''}"><span>${esc(i.item)}${i.detalhe ? `<small>${esc(i.detalhe)}</small>` : ''}</span><em>${i.pendente ? 'PENDENTE' : '✓ entregue'}</em></li>`).join('');
  const conf = d.confirmado_em
    ? `<div class="c ok"><div class="big">✅</div><div class="passo" style="justify-content:center">Recebimento confirmado</div>
        <div>Confirmado em <b>${esc(horaBrasilia(d.confirmado_em))}</b> (Brasília).</div>
        ${d.hash ? `<div class="av" style="margin-top:10px">Código de verificação (SHA-256)</div><div class="hash">${esc(d.hash)}</div>` : ''}
        <a class="pdf" href="/pa/protocolo/${esc(token)}/protocolo.pdf" target="_blank" rel="noopener">📄 Baixar o protocolo em PDF</a>
        <div class="av">O PDF também foi enviado no seu WhatsApp. Guarde junto com o dossiê.</div></div>`
    : `<div class="c" id="form">
        <div class="passo"><i>3</i> Confirme o recebimento</div>
        <div class="decl">Declaro que recebi da <b>Romatec Consultoria Total</b> as vias impressas listadas acima, referentes ao meu lote <b>LT-${esc(d.lote)}</b>${d.sem_trt ? ', ciente de que a <b>TRT</b> será entregue depois' : ''}.</div>
        ${d.pede_cpf ? `<label for="cpf">Digite os <u>3 primeiros números</u> do seu CPF</label><input class="cpf" id="cpf" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="•••">` : ''}
        <label for="obs">Observação (opcional)</label><textarea id="obs" maxlength="500" placeholder="Ex.: recebido por mim no escritório"></textarea>
        <div class="chk"><input type="checkbox" id="ck"><label for="ck" style="margin:0;font-weight:400">Li a declaração acima e confirmo o recebimento.</label></div>
        <button class="env" id="env" disabled>✅ Confirmo que recebi</button>
        <div class="erro" id="erro"></div>
        <button class="env sec" id="prob" type="button">⚠️ Não recebi / está faltando algo</button>
        <div class="av">A confirmação vale como assinatura eletrônica simples (${esc(LEI_ASSINATURA)}). Ficam registrados data, hora, IP e aparelho.</div>
      </div>
      <div class="c ok" id="feito" style="display:none"><div class="big">✅</div><div class="passo" style="justify-content:center">Obrigado, ${esc(primeiro)}!</div>
        Recebimento confirmado. O <b>protocolo em PDF</b> vai chegar no seu WhatsApp em instantes.
        <a class="pdf" href="/pa/protocolo/${esc(token)}/protocolo.pdf" target="_blank" rel="noopener">📄 Baixar o protocolo em PDF</a></div>`;
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
  <title>Protocolo de entrega ${esc(d.numero)} — Romatec</title><style>${CSS}</style></head><body><div class="w">
  <div class="top"><img src="/icons/pa-192.png" alt=""><div><small>Romatec · Protocolo de entrega</small><h1>Vias físicas do dossiê — LT-${esc(d.lote)}</h1><p>Protocolo nº ${esc(d.numero)}</p></div></div>
  <div class="c"><div class="passo"><i>1</i> Seus dados</div><div class="id">
    <div><b>Associado(a)</b><span>${esc(d.nome)}</span></div><div><b>Nº associado</b><span>${esc(d.numero_associado)} · vila ${esc(d.lote_vila)}</span></div>
    <div><b>Lote de produção</b><span>LT-${esc(d.lote)}${d.denominacao ? ` — “${esc(d.denominacao)}”` : ''}</span></div><div><b>Projeto</b><span>${esc(d.projeto)} · ${esc(d.municipio)}</span></div>
    <div><b>Entregue em</b><span>${esc(horaBrasilia(d.entregue_em).split(' às ')[0])}</span></div></div></div>
  <div class="c"><div class="passo"><i>2</i> Confira os documentos entregues</div><ul class="it">${itens}</ul>
    ${d.sem_trt ? '<div class="av" style="text-align:left">📄 A <b>TRT</b> (Termo de Responsabilidade Técnica) será emitida e entregue depois, com um novo protocolo.</div>' : ''}</div>
  ${conf}
  <p class="av">Romatec Consultoria Total · Açailândia/MA · (99) 99181-1246</p></div>
  ${d.confirmado_em ? '' : `<script>
  (function(){
    var base = '/pa/protocolo/${esc(token)}', env = document.getElementById('env'), ck = document.getElementById('ck'), cpf = document.getElementById('cpf'), er = document.getElementById('erro');
    function pode(){ env.disabled = !ck.checked || (cpf && cpf.value.replace(/\\D/g, '').length !== 3); }
    ck.onchange = pode; if (cpf) cpf.oninput = function(){ cpf.value = cpf.value.replace(/\\D/g, '').slice(0, 3); pode(); };
    function falha(m){ er.style.display = 'block'; er.textContent = m; }
    env.onclick = function(){
      env.disabled = true; env.textContent = 'Confirmando…'; er.style.display = 'none';
      fetch(base + '/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cpf3: cpf ? cpf.value : '', obs: document.getElementById('obs').value }) })
        .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.erro || 'Falha ao confirmar'); return j; }); })
        .then(function(){ document.getElementById('form').style.display = 'none'; document.getElementById('feito').style.display = 'block'; window.scrollTo(0, document.body.scrollHeight); })
        .catch(function(e){ falha(e.message); env.textContent = '✅ Confirmo que recebi'; pode(); });
    };
    document.getElementById('prob').onclick = function(){
      var t = prompt('Conte o que aconteceu (ex.: não recebi, falta a carteirinha):', ''); if (!t || t.trim().length < 3) return;
      fetch(base + '/problema', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ obs: t }) })
        .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.erro || 'Falha'); alert('Recebemos o seu aviso. A Romatec vai falar com você.'); }); })
        .catch(function(e){ falha(e.message); });
    };
  })();
  </script>`}</body></html>`;
}

const erroHtml = (msg: string) => `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protocolo — Romatec</title><style>${CSS}</style></head><body><div class="w"><div class="c"><b>${esc(msg)}</b><p class="av">Fale com a Romatec: (99) 99181-1246.</p></div></div></body></html>`;

router.get('/:token', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  try { res.type('html').send(htmlProtocoloPublico(await dadosPublicos(req.params.token), String(req.params.token))); }
  catch (e) {
    const pe = e instanceof PaErro; if (!pe) console.error('[pa-protocolo]', e);
    res.status(pe ? e.http : 500).type('html').send(erroHtml(pe ? e.message : 'Não foi possível abrir o protocolo agora'));
  }
});
router.get('/:token/protocolo.pdf', async (req: Request, res: Response) => {
  try {
    const r = await pdfProtocoloPorToken(req.params.token);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`); res.setHeader('Cache-Control', 'private, no-store');
    res.end(r.pdf);
  } catch (e) {
    const pe = e instanceof PaErro; if (!pe) console.error('[pa-protocolo]', e);
    res.status(pe ? e.http : 500).type('html').send(erroHtml(pe ? e.message : 'Não foi possível gerar o PDF agora'));
  }
});
router.post('/:token/confirmar', async (req: Request, res: Response) => {
  try { res.json(await confirmarRecebimento(req.params.token, req.body?.cpf3, req.body?.obs, ipDe(req), String(req.headers['user-agent'] ?? '') || null)); }
  catch (e) { const pe = e instanceof PaErro; if (!pe) console.error('[pa-protocolo]', e); res.status(pe ? e.http : 500).json({ erro: pe ? e.message : 'Falha ao confirmar — tente de novo' }); }
});
router.post('/:token/problema', async (req: Request, res: Response) => {
  try { res.json(await relatarProblema(req.params.token, req.body?.obs)); }
  catch (e) { const pe = e instanceof PaErro; res.status(pe ? e.http : 500).json({ erro: pe ? e.message : 'Falha ao enviar' }); }
});

export default router;
