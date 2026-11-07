// src/routes/paPixPublico.ts
// v3.161.0 — Página pública do Pix de um boleto: /pa/pix/<token>.
// É o destino do link "TOQUE AQUI PARA COPIAR O PIX" do PDF do boleto: quem abre o
// PDF no próprio celular não consegue ler o QR Code com a câmera — aqui um toque
// copia o código Pix (copia e cola) e a página explica onde colar no app do banco.
// Acesso pelo mesmo token aleatório do link do boleto (só o associado recebe).
// Mostra só o primeiro nome, lote, parcela, valor e vencimento.
import { Router, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { PaErro } from '../services/pa/erros';
import { boletoPorToken, atualizarDoAsaas, urlBoletoRomatec } from '../services/pa/paBoletoPdf';
import { pool, one, num, isoDate } from '../services/pa/paDb';

const router = Router();
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dbr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f1e8;color:#1C1C18;-webkit-text-size-adjust:100%}
.w{max-width:460px;margin:0 auto;padding:16px}
.top{background:linear-gradient(135deg,#0C3320,#14472B);color:#fff;border-radius:14px;padding:16px 18px;border-bottom:4px solid #C9A84C}
.top small{color:#E8D9A8;letter-spacing:1.5px;font-size:10px;text-transform:uppercase}.top h1{margin:4px 0 2px;font-size:20px}.top p{margin:0;color:#d9e6dd;font-size:13px}
.c{background:#fff;border-radius:14px;padding:16px 18px;margin-top:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.val{display:flex;justify-content:space-between;align-items:flex-end;gap:10px}.val b{font-size:26px;color:#0C3320}.val span{font-size:12px;color:#6A6656}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:16px;margin-top:14px;font-size:18px;font-weight:800;cursor:pointer;background:#0C3320;color:#fff;font-family:inherit}
.btn.ok{background:#2E7D32}.sec{display:block;text-align:center;margin-top:10px;color:#0C3320;font-weight:700;font-size:14px}
textarea{width:100%;border:1px solid #CFC7AE;border-radius:10px;padding:10px;font:12px/1.35 monospace;color:#333;background:#FBFAF5;resize:none;margin:10px 0}
.qr{display:flex;justify-content:center;margin:6px 0}.qr svg{width:200px;height:200px}
ol{margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.55}.av{font-size:13px;color:#6A6656;margin-top:8px}
.msg{display:none;margin-top:10px;background:#E6F4EC;color:#1B5E20;border-radius:10px;padding:10px 12px;font-size:14px;font-weight:700}
.pago{font-size:18px;color:#1B5E20;font-weight:800}`;

function pagina(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
  <title>${esc(titulo)} — Romatec</title><style>${CSS}</style></head><body><div class="w">${corpo}
  <p class="av" style="text-align:center">Romatec Consultoria Total · Açailândia/MA</p></div></body></html>`;
}

export interface DadosPaginaPix {
  nome: string; lote: string; projeto: string; rotulo: string; valor: number; vencimento: string | null;
  status: string; pago_em: string | null; pix: string | null; url_pdf: string | null;
}

/** HTML da página do Pix (pura — testável sem banco). */
export async function htmlPaginaPix(d: DadosPaginaPix): Promise<string> {
  const nome = d.nome.trim().split(/\s+/)[0];
  const primeiro = nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase();
  const topo = `<div class="top"><small>Romatec · ${esc(d.projeto)}</small><h1>Pagamento por Pix</h1><p>${esc(primeiro)} · Lote ${esc(d.lote)} · ${esc(d.rotulo)}</p></div>`;
  const valor = `<div class="val"><div><span>Valor</span><br><b>${brl(d.valor)}</b></div><div style="text-align:right"><span>Vencimento</span><br><b style="font-size:17px">${dbr(d.vencimento)}</b></div></div>`;
  const pdf = d.url_pdf;
  if (d.status === 'PAGO') {
    return pagina('Boleto pago', `${topo}<div class="c">${valor}<p class="pago" style="margin-top:14px">✅ Este boleto já foi pago${d.pago_em ? ` em ${dbr(d.pago_em)}` : ''}.</p><p>Obrigado! Não é preciso pagar de novo.</p></div>`);
  }
  if (!d.pix) {
    return pagina('Pix indisponível', `${topo}<div class="c">${valor}<p style="margin-top:14px">O Pix deste boleto não está disponível no momento. Pague pelo código de barras do boleto ou fale com a Romatec.</p>${pdf ? `<a class="sec" href="${esc(pdf)}">📄 Abrir o boleto em PDF</a>` : ''}</div>`);
  }
  const pix = d.pix;
  const qr = await QRCode.toString(pix, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0C3320', light: '#ffffff' } });
  const vencido = d.status === 'VENCIDO';
  return pagina('Copiar Pix', `${topo}
      <div class="c">${valor}${vencido ? '<p class="av" style="color:#B3261E">Boleto vencido: o valor do Pix já inclui multa e juros, se houver.</p>' : ''}
        <button class="btn" id="copiar" type="button">📋 Copiar código Pix</button>
        <div class="msg" id="ok">✅ Código Pix copiado! Agora abra o app do seu banco e cole em <u>Pix › Pix Copia e Cola</u>.</div>
        <textarea id="cod" rows="4" readonly>${esc(pix)}</textarea>
        <b>Como pagar</b>
        <ol><li>Toque em <b>Copiar código Pix</b> (acima).</li><li>Abra o <b>app do seu banco</b> e entre em <b>Pix</b>.</li><li>Escolha <b>Pix Copia e Cola</b>, cole o código e confirme.</li></ol>
        <p class="av">💡 Pelo Pix o pagamento cai na hora. Pelo código de barras a compensação leva até 1 dia útil. Não precisa mandar comprovante: a baixa é automática e você recebe a confirmação no WhatsApp.</p>
      </div>
      <div class="c"><b>Ou escaneie o QR Code</b><p class="av" style="margin-top:2px">Use a câmera do app do banco em outro aparelho (Pix › Ler QR Code).</p><div class="qr">${qr}</div>
        ${pdf ? `<a class="sec" href="${esc(pdf)}">📄 Abrir o boleto em PDF</a>` : ''}</div>
      <script>
        (function(){
          var b = document.getElementById('copiar'), t = document.getElementById('cod'), ok = document.getElementById('ok');
          function feito(){ b.textContent = '✅ Copiado!'; b.className = 'btn ok'; ok.style.display = 'block'; setTimeout(function(){ b.textContent = '📋 Copiar de novo'; b.className = 'btn'; }, 4000); }
          function antigo(){ t.removeAttribute('readonly'); t.focus(); t.select(); t.setSelectionRange(0, 99999); var r = false; try { r = document.execCommand('copy'); } catch (e) {} t.setAttribute('readonly', ''); return r; }
          b.addEventListener('click', function(){
            var v = t.value;
            if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(v).then(feito, function(){ if (antigo()) feito(); else alert('Não consegui copiar sozinho: toque e segure no código abaixo e escolha Copiar.'); }); }
            else if (antigo()) feito(); else alert('Não consegui copiar sozinho: toque e segure no código abaixo e escolha Copiar.');
          });
          t.addEventListener('focus', function(){ t.select(); });
        })();
      </script>`);
}

router.get('/:token', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const token = String(req.params.token);
    const bid = await boletoPorToken(token);
    const b = await one(pool, `SELECT b.*, a.nome, lt.numero AS lote, l.tipo, l.parcela, pr.nome AS projeto,
        (SELECT COUNT(*) FROM pa_lancamentos x WHERE x.associado_id = a.id AND x.tipo = 'BOLETO' AND x.status <> 'CANCELADO') AS tot
      FROM pa_boletos b JOIN pa_associados a ON a.id = b.associado_id JOIN pa_lotes lt ON lt.id = a.lote_id
      JOIN pa_lancamentos l ON l.id = b.lancamento_id JOIN pa_projetos pr ON pr.id = a.projeto_id WHERE b.id = ?`, [bid]);
    if (!b) throw new PaErro('BOLETO_NAO_ENCONTRADO', 'Boleto não encontrado', 404);
    await atualizarDoAsaas(b); // Pix atual do Asaas (pode mudar após o vencimento)
    res.type('html').send(await htmlPaginaPix({
      nome: String(b.nome), lote: String(b.lote), projeto: String(b.projeto),
      rotulo: b.tipo === 'BOLETO' ? `Parcela ${num(b.parcela)}/${num(b.tot)}` : b.tipo === 'SINAL' ? 'Sinal' : b.tipo === 'AVISTA' ? 'Pagamento à vista' : String(b.tipo),
      valor: num(b.valor), vencimento: isoDate(b.vencimento), status: String(b.status), pago_em: isoDate(b.pago_em),
      pix: String(b.pix_copia_cola || '').trim() || null, url_pdf: urlBoletoRomatec(token),
    }));
  } catch (err) {
    if (err instanceof PaErro) {
      res.status(err.http).type('html').send(pagina(err.http === 410 ? 'Boleto cancelado' : 'Boleto não encontrado', `<div class="c"><h2 style="margin:0 0 6px;color:#0C3320">${err.http === 410 ? 'Boleto cancelado' : 'Boleto não encontrado'}</h2><p>${esc(err.message)}</p></div>`));
      return;
    }
    console.error('[pa-pix-publico] falha:', err);
    res.status(500).type('html').send(pagina('Erro', '<div class="c"><p>Não foi possível abrir o Pix agora. Tente de novo em alguns minutos ou fale com a Romatec.</p></div>'));
  }
});

export default router;
