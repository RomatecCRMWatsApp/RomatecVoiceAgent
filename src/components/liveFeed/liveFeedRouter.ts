/**
 * Live Feed Universal — Router
 * ZAYRA v1.99.15 — Romatec
 *
 * GET /api/live-feed/:tab
 *   ?obraId  (opcional / obrigatório para folha)
 *   ?ano,?mes (opcional, default = data atual)
 *   ?limit   (opcional)
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { LiveFeedService } from './liveFeedService';
import type { LiveFeedTab } from './liveFeedTypes';

const VALID_TABS: LiveFeedTab[] = [
  'painel', 'obras', 'folha', 'despesas', 'materiais', 'financeiro',
  'clientes', 'colaboradores', 'contratos', 'vales', 'laudos',
  'diarias', 'demarcacoes', 'certs',
];

function parsePositiveInt(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export function createLiveFeedRouter(pool: Pool): Router {
  const router = Router();
  const service = new LiveFeedService(pool);

  router.get('/:tab', async (req: Request, res: Response) => {
    const tab = req.params.tab as LiveFeedTab;

    if (!VALID_TABS.includes(tab)) {
      return res.status(404).json({ error: `Aba desconhecida: ${tab}`, tab });
    }

    try {
      const data = await service.fetch(tab, {
        obraId: parsePositiveInt(req.query.obraId),
        ano: parsePositiveInt(req.query.ano),
        mes: parsePositiveInt(req.query.mes),
        limit: parsePositiveInt(req.query.limit),
      });
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.json(data);
    } catch (err) {
      console.error('[LiveFeed]', tab, (err as Error).message);
      const msg = err instanceof Error ? err.message : 'Erro interno';
      const status = msg.startsWith('Parâmetro') ? 400 : 500;
      res.status(status).json({ error: msg, tab });
    }
  });

  return router;
}
