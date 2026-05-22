// v3.24.0: PR A Auth Foundation — middlewares de auth.
//
// 3 middlewares principais:
//   - requireAuth: valida JWT do cookie httpOnly + popula req.user
//   - requireRole(...roles): fail 403 se role não está na lista permitida
//   - requireCeoToken: destravado — agora checa X-CEO-Token contra env real
//
// Padrão dos handlers: anexa user em req via `(req as any).user`. TypeScript
// extension global em src/types/express.d.ts (criar quando necessario).

import type { Request, Response, NextFunction } from 'express';
import { verifyJWT, COOKIE_NAME, type JWTClaims, type AuthRole } from '../services/auth';

// Estende Express.Request inline (sem global type declaration por enquanto —
// scope mantido pequeno na PR A. Criar src/types/express.d.ts se precisar
// em mais lugares).
export interface AuthedRequest extends Request {
  user?: JWTClaims;
}

// ─── requireAuth ──────────────────────────────────────────────────────
// Valida JWT do cookie ou do header Authorization. 401 se invalido/ausente.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie;
  let token: string | null = null;

  // Tenta cookie primeiro (httpOnly via Set-Cookie)
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    token = cookies[COOKIE_NAME] || null;
  }

  // Fallback: Authorization: Bearer xxx (pra API clients e curl)
  if (!token) {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Não autenticado. Faça login em /login.' });
    return;
  }

  try {
    const claims = verifyJWT(token);
    (req as AuthedRequest).user = claims;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido ou expirado.', detail: (err as Error).message });
  }
}

// ─── requireRole ──────────────────────────────────────────────────────
// Exemplo: app.get('/admin/...', requireAuth, requireRole('admin', 'gestor'), handler)
// Fail 403 (não 401) — usuário esta autenticado mas sem permissão.
export function requireRole(...rolesPermitidas: AuthRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      // requireAuth deveria ter rodado antes — fail-fast com 401
      res.status(401).json({ error: 'requireRole sem requireAuth — uso incorreto do middleware' });
      return;
    }
    if (!rolesPermitidas.includes(user.role)) {
      res.status(403).json({
        error: `Acesso negado. Role atual: ${user.role}. Permitido: ${rolesPermitidas.join(', ')}.`,
      });
      return;
    }
    next();
  };
}

// ─── requireCeoToken (destravado em v3.24.0) ──────────────────────────
// Antes (até v3.23.11): NO-OP — chamava next() direto, deixando admin aberto.
// Agora: checa header X-CEO-Token contra env CEO_API_TOKEN.
// Compat: se CEO_API_TOKEN nao tiver setado, FALHA fechado (403) com log.
// Antes era "FALHA aberto" — pior pra seguranca. Mude o env pra rodar.
export function requireCeoToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CEO_API_TOKEN;
  if (!expected) {
    console.error('[auth] CEO_API_TOKEN não setado — rota admin BLOQUEADA. Configure no Railway pra liberar.');
    res.status(403).json({
      error: 'CEO_API_TOKEN não configurado no servidor. Contate o admin.',
    });
    return;
  }
  const got = req.headers['x-ceo-token'] as string | undefined;
  if (got !== expected) {
    res.status(403).json({
      error: 'Forbidden — header X-CEO-Token ausente ou inválido.',
    });
    return;
  }
  next();
}

// ─── Helpers ──────────────────────────────────────────────────────────
function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}
