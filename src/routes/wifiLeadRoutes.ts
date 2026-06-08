// v3.61.0: Rotas do Captive Portal Wi-Fi. Montadas em /api/wifi no server.ts.
//
// authMiddleware do spec == requireAuth existente (src/middleware/auth.ts),
// que valida o JWT do cookie httpOnly OU do header Authorization: Bearer.

import { Router } from 'express';
import { registrarLead, listarLeads, exportarLeadsCSV } from '../controllers/wifiLeadController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Publica — chamada pelo captive portal (sem auth)
router.post('/lead', registrarLead);

// Protegidas — painel interno ZAYRA
router.get('/leads', requireAuth, listarLeads);
router.get('/leads/export', requireAuth, exportarLeadsCSV);

export default router;
