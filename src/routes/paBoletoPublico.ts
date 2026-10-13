// src/routes/paBoletoPublico.ts
// v3.144.0 — Link público do boleto Romatec (modelo Carnê): /pa/boleto/<token>.
// O associado não tem login: o acesso é pelo token aleatório (18 bytes) gravado
// em pa_boletos.token_publico, enviado só para ele (WhatsApp da cobrança).
// Mostra os dados do próprio pagador (como o link de fatura do Asaas).
import { Router, type Request, type Response } from 'express';
import { PaErro } from '../services/pa/erros';
import { boletoPorToken, gerarPdfBoleto } from '../services/pa/paBoletoPdf';

const router = Router();

function paginaErro(titulo: string, msg: string): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo} — Romatec</title>
  <style>body{margin:0;font-family:Arial,sans-serif;background:#f4f1e8;color:#1C1C18;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
  .c{background:#fff;border-radius:12px;padding:24px;max-width:420px;border-top:5px solid #C9A84C;box-shadow:0 2px 8px rgba(0,0,0,.08)}h1{color:#0C3320;font-size:19px;margin:0 0 8px}</style></head>
  <body><div class="c"><h1>${titulo}</h1><p>${msg}</p><p style="color:#6A6656;font-size:13px">Romatec Consultoria Total</p></div></body></html>`;
}

router.get('/:token', async (req: Request, res: Response) => {
  try {
    const bid = await boletoPorToken(String(req.params.token).replace(/\.pdf$/i, ''));
    const { pdf, nome } = await gerarPdfBoleto(bid, 'carne');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.end(pdf);
  } catch (err) {
    if (err instanceof PaErro) {
      res.status(err.http).type('html').send(paginaErro(err.http === 410 ? 'Boleto cancelado' : 'Boleto não encontrado', err.message));
      return;
    }
    console.error('[pa-boleto-publico] falha:', err);
    res.status(500).type('html').send(paginaErro('Não foi possível gerar o boleto', 'Tente de novo em alguns minutos ou fale com a Romatec.'));
  }
});

export default router;
