// src/routes/paWebhookAsaas.ts
// v3.143.0 — Webhook do Asaas para os boletos do módulo PA.
// Montado em /webhook/asaas-pa (fora do /api: o Asaas não tem login). A
// autenticação é o token configurado no painel do Asaas, que chega no header
// `asaas-access-token` e é comparado com ASAAS_WEBHOOK_TOKEN em tempo constante.
//
// Resposta: 200 para tudo que foi entendido (inclusive cobrança que não é do
// PA) — o Asaas pausa a fila se receber muitos erros. 500 só em falha real
// (banco fora), pra ele reenviar depois.
import express, { Router, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { processarEventoAsaas, type EventoAsaas } from '../services/pa/paBoletos';

const router = Router();

// v3.144.8: o Asaas pode mandar o JSON com content-type que o express.json global
// não reconhece — aí o corpo chegava vazio ("ignorado:sem_payment"). Lê o corpo
// cru em QUALQUER content-type (se ainda não foi lido) e faz o parse aqui.
router.use(express.text({ type: () => true, limit: '2mb' }));
export function corpoDoEvento(body: unknown): EventoAsaas {
  if (typeof body === 'string') {
    const s = body.trim();
    if (!s) return {};
    try { return JSON.parse(s) as EventoAsaas; } catch { /* pode ser form-urlencoded */ }
    try {
      const p = new URLSearchParams(s);
      const dados = p.get('data') || p.get('payload') || p.get('body');
      if (dados) return JSON.parse(dados) as EventoAsaas;
    } catch { /* formato desconhecido */ }
    return {};
  }
  if (Buffer.isBuffer(body)) return corpoDoEvento(body.toString('utf8'));
  return (body && typeof body === 'object' ? body : {}) as EventoAsaas;
}

export function tokenConfere(recebido: unknown, esperado: string | undefined): boolean {
  if (!esperado || typeof recebido !== 'string' || !recebido) return false;
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

router.post('/', async (req: Request, res: Response) => {
  const esperado = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  if (!esperado) {
    console.error('[pa-asaas-webhook] ASAAS_WEBHOOK_TOKEN não configurado — evento recusado');
    res.status(503).json({ erro: 'webhook não configurado' });
    return;
  }
  // v3.144.3: espaço sobrando no token colado no painel do Asaas não derruba a baixa.
  // v3.144.7: plano B — token também aceito na URL do webhook (?token=...), para
  // quando o painel do Asaas não manda o header asaas-access-token.
  const doHeader = (req.header('asaas-access-token') || '').trim();
  const daUrl = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const recebido = doHeader || daUrl;
  if (!tokenConfere(recebido, esperado)) {
    // Diagnóstico sem expor o segredo: ausente x diferente, tamanhos e NOMES dos headers recebidos.
    const nomes = Object.keys(req.headers).filter((h) => !/^(cookie|authorization)$/i.test(h)).join(',');
    console.warn(`[pa-asaas-webhook] 401: token ${recebido ? `diferente (recebido ${recebido.length} chars via ${doHeader ? 'header' : 'url'}, esperado ${esperado.length})` : 'ausente no header asaas-access-token e na URL'} — headers recebidos: ${nomes}`);
    res.status(401).json({ erro: 'token inválido' });
    return;
  }
  try {
    const ev = corpoDoEvento(req.body);
    const r = await processarEventoAsaas(ev);
    console.log(`[pa-asaas-webhook] ${ev.event ?? '(sem event)'} ${ev.payment?.id ?? '(sem payment)'} → ${r.acao}${ev.event ? '' : ` [content-type=${req.header('content-type') ?? '-'}, body=${typeof req.body}]`}`);
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error('[pa-asaas-webhook] falha:', err);
    res.status(500).json({ erro: 'falha ao processar' });
  }
});

export default router;
