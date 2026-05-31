// v3.50.0: middleware requirePin — exige PIN secundario pra rotas destrutivas.
//
// Bypass automatico pra roles admin/owner (mesma autoridade que CEO_TOKEN).
// Outros roles devem enviar PIN no body.pin ou header X-Pin.
//
// Uso: app.delete('/api/recibos/:id', requireAuth, requirePin, handler);
// (sempre apos requireAuth — depende de req.user populado).

import type { Request, Response, NextFunction } from 'express';
import type { AuthedRequest } from './auth';
import { isAdminBypassPin, verificarPin } from '../services/pinSecundario';

export function requirePin(req: Request, res: Response, next: NextFunction): void {
  const claims = (req as AuthedRequest).user;

  // Bypass legacy: X-CEO-Token valido (scripts/integracoes pre-JWT) =
  // autoridade admin equivalente. Combina com requireCeoToken upstream.
  if (!claims) {
    const expected = process.env.CEO_API_TOKEN;
    const got = req.headers['x-ceo-token'] as string | undefined;
    if (expected && got && got === expected) {
      return next();
    }
    res.status(401).json({ error: 'Sem sessao autenticada — faca login para usar esta rota.' });
    return;
  }

  // Bypass admin/owner (JWT)
  if (isAdminBypassPin(claims)) {
    return next();
  }

  // Le PIN do body ou header
  const pin = (req.body?.pin as string | undefined)
            ?? (req.headers['x-pin'] as string | undefined);

  if (!pin) {
    res.status(403).json({
      error: 'PIN obrigatorio para esta operacao.',
      code: 'PIN_REQUIRED',
    });
    return;
  }

  void verificarPin(Number(claims.sub), String(pin)).then(result => {
    if (result.ok) {
      return next();
    }
    const status = result.motivo === 'travado' ? 423 // Locked
                 : result.motivo === 'sem_pin' ? 403
                 : 403;
    const code = result.motivo === 'travado' ? 'PIN_LOCKED'
               : result.motivo === 'sem_pin' ? 'PIN_NOT_SET'
               : result.motivo === 'formato_invalido' ? 'PIN_INVALID_FORMAT'
               : 'PIN_INVALID';
    res.status(status).json({
      error: result.mensagem,
      code,
      restantes: 'restantes' in result ? result.restantes : undefined,
      locked_until: 'locked_until' in result ? result.locked_until : undefined,
    });
  }).catch(err => {
    res.status(500).json({ error: 'Erro ao verificar PIN: ' + (err as Error).message });
  });
}
