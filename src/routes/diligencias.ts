// v3.54.0 — Rotas HTTP do módulo Diligências de Campo.
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listarDiligencias,
  buscarDiligencia,
  criarDiligencia,
  atualizarDiligencia,
  cancelarDiligencia,
  reenviarConfirmacao,
  resolverPropostaInfo,
  DiligenciaError,
} from '../integrations/diligencias';

const router = Router();

function fail(res: Response, err: unknown) {
  const status = err instanceof DiligenciaError ? err.status : 500;
  res.status(status).json({ error: (err as Error).message });
}

// GET /api/diligencias?status=&proposta_id=&page=&limit=
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const out = await listarDiligencias({
      status: req.query.status as string | undefined,
      proposta_id: req.query.proposta_id as string | undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
    });
    res.json(out);
  } catch (err) { fail(res, err); }
});

// GET /api/diligencias/resolver-proposta/:ref → {id, numero, cliente_nome}
// Aceita id interno OU número da proposta (preview do cliente no formulário).
router.get('/resolver-proposta/:ref', requireAuth, async (req: Request, res: Response) => {
  try {
    const info = await resolverPropostaInfo(String(req.params.ref));
    if (!info) { res.status(404).json({ error: 'proposta não encontrada' }); return; }
    res.json(info);
  } catch (err) { fail(res, err); }
});

// GET /api/diligencias/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const d = await buscarDiligencia(String(req.params.id));
    if (!d) { res.status(404).json({ error: 'diligência não encontrada' }); return; }
    res.json(d);
  } catch (err) { fail(res, err); }
});

// POST /api/diligencias  → cria + dispara WhatsApp
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const r = await criarDiligencia(req.body);
    res.status(201).json({ success: true, diligencia: r.diligencia, ...(r.aviso ? { aviso: r.aviso } : {}) });
  } catch (err) { fail(res, err); }
});

// PUT /api/diligencias/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const d = await atualizarDiligencia(String(req.params.id), req.body);
    res.json({ success: true, diligencia: d });
  } catch (err) { fail(res, err); }
});

// DELETE /api/diligencias/:id  → soft (status = cancelado)
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const d = await cancelarDiligencia(String(req.params.id));
    res.json({ success: true, diligencia: d });
  } catch (err) { fail(res, err); }
});

// POST /api/diligencias/:id/reenviar
router.post('/:id/reenviar', requireAuth, async (req: Request, res: Response) => {
  try {
    const r = await reenviarConfirmacao(String(req.params.id));
    res.json({ success: r.ok, ...(r.aviso ? { aviso: r.aviso } : {}) });
  } catch (err) { fail(res, err); }
});

export default router;
