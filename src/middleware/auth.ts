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

// ─── requireCeoToken (destravado em v3.24.0, hybrid v3.24.19) ─────────
// Hibrido com JWT auth:
//   1. JWT admin/owner valido -> libera (CEO ja autenticado via /login)
//   2. JWT colaborador/gestor sem role admin -> 403
//   3. Sem JWT -> tenta header X-CEO-Token contra env CEO_API_TOKEN
//
// Motivacao: depois que o /login com role=admin foi implementado, exigir
// X-CEO-Token em paralelo era redundante e quebrava UX. CEO pediu que o
// login dele e da Daniele ja viessem com "token CEO liberado". Solucao:
// JWT admin == X-CEO-Token (mesmo nivel de poder). Compat com chamadas
// scripted continua via env.
export function requireCeoToken(req: Request, res: Response, next: NextFunction): void {
  // 1. Tenta JWT primeiro (cookie definido em /api/auth/login)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { verifyJWT, isBlacklisted } = require('../services/auth') as typeof import('../services/auth');
  const token = (req as { cookies?: { auth_token?: string } }).cookies?.auth_token
             || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (token) {
    try {
      const claims = verifyJWT(token);
      if (claims && !isBlacklisted(claims.jti) && (claims.role === 'admin' || claims.role === 'owner')) {
        // Admin via JWT — libera (mesmo poder que X-CEO-Token)
        (req as AuthedRequest).user = claims;
        return next();
      }
      // Tem JWT mas nao e' admin -> 403 sem fallback (nao tenta token CEO)
      res.status(403).json({
        error: 'Forbidden — sua sessao nao tem permissao admin.',
      });
      return;
    } catch (_) { /* JWT invalido/expirado -> cai pro fallback X-CEO-Token */ }
  }

  // 2. Fallback legacy: X-CEO-Token via env (scripts, integracoes)
  const expected = process.env.CEO_API_TOKEN;
  if (!expected) {
    console.error('[auth] CEO_API_TOKEN não setado e sem JWT admin — rota BLOQUEADA. Logue em /login como admin OU configure CEO_API_TOKEN no Railway.');
    res.status(403).json({
      error: 'Acesso negado. Faca login em /login como admin OU configure CEO_API_TOKEN.',
    });
    return;
  }
  const got = req.headers['x-ceo-token'] as string | undefined;
  if (got !== expected) {
    res.status(403).json({
      error: 'Forbidden — sem sessao admin ou header X-CEO-Token invalido.',
    });
    return;
  }
  next();
}

// ─── requireColaboradorOwnership (v3.24.1) ────────────────────────────
// Garante que o user com role='colaborador' so acesse rotas filtradas pelo
// SEU proprio equipe_id (a pessoa fisica em romatec_obra_equipe.id).
//
// Logica:
// 1. requireAuth ja populou req.user com JWT claims (sub, role, equipe_id).
// 2. Se role != 'colaborador', deixa passar (admin/gestor pode ver tudo).
// 3. Se role === 'colaborador':
//    - Exige equipe_id presente no JWT (senao 403)
//    - Se rota tem :colaboradorId/:funcionarioId/:equipeId no path, exige
//      bater com req.user.equipe_id
//    - Se rota tem ?colaborador_id/?funcionario_id/?equipe_id no query, idem
//    - Senao (rota generica /minha-quinzena sem param), apenas exige role
export function requireColaboradorOwnership(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user) {
    res.status(401).json({ error: 'requireColaboradorOwnership sem requireAuth — uso incorreto' });
    return;
  }
  if (user.role !== 'colaborador') {
    return next();
  }
  if (user.equipe_id == null) {
    res.status(403).json({
      error: 'Colaborador sem vinculo a equipe_id. Contate o admin pra finalizar o cadastro.',
    });
    return;
  }
  const pathId = req.params.colaboradorId || req.params.funcionarioId
              || req.params.equipeId || req.params.colaborador_id;
  const queryId = (req.query.colaborador_id || req.query.funcionario_id
                || req.query.equipe_id) as string | undefined;
  const alvo = pathId || queryId;
  if (alvo != null && Number(alvo) !== user.equipe_id) {
    res.status(403).json({
      error: `Colaborador so pode acessar seus proprios dados. Voce e' equipe_id=${user.equipe_id}; tentou acessar=${alvo}.`,
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
