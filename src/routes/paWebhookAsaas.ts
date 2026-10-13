// src/routes/paWebhookAsaas.ts
// v3.143.0 — Webhook do Asaas para os boletos do módulo PA.
// Montado em /webhook/asaas-pa (fora do /api: o Asaas não tem login). A
// autenticação é o token configurado no painel do Asaas, que chega no header
// `asaas-access-token` e é comparado com ASAAS_WEBHOOK_TOKEN em tempo constante.
//
// Resposta: 200 para tudo que foi entendido (inclusive cobrança que não é do
// PA) — o Asaas pausa a fila se receber muitos erros. 500 só em falha real
// (banco fora), pra ele reenviar depois.
import { Router, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { processarEventoAsaas, type EventoAsaas } from '../services/pa/paBoletos';

const router = Router();

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
  if (!tokenConfere(req.header('asaas-access-token'), esperado)) {
    res.status(401).json({ erro: 'token inválido' });
    return;
  }
  try {
    const r = await processarEventoAsaas((req.body ?? {}) as EventoAsaas);
    console.log(`[pa-asaas-webhook] ${(req.body as EventoAsaas)?.event} ${(req.body as EventoAsaas)?.payment?.id} → ${r.acao}`);
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error('[pa-asaas-webhook] falha:', err);
    res.status(500).json({ erro: 'falha ao processar' });
  }
});

export default router;
