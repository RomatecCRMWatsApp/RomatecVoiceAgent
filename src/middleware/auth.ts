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

// ─── requireCeoToken (destravado v3.24.0, hybrid v3.24.19, aberto a v3.109.0) ──
// Hoje se comporta como "requireAuth com fallback legacy":
//   1. JWT valido de QUALQUER role -> libera
//   2. Sem JWT -> tenta header X-CEO-Token contra env CEO_API_TOKEN
//
// Duas mudancas em v3.109.0:
//  (a) o nome do cookie estava errado (`auth_token` em vez de `zayra_auth`), o
//      que fazia o caminho JWT nunca funcionar — todo mundo, CEO incluido, caia
//      no header. Era o motivo real dos "sem permissao" que apareceram em campo.
//  (b) a exigencia de role admin/owner saiu a pedido do CEO: sistema de uso
//      interno unico, e o gate por papel so atrapalhava. Quando virar SaaS, o
//      controle volta como requireRole(...) por rota — nao como token compartilhado.
//
// O fallback X-CEO-Token FOI MANTIDO de proposito: ele nao bloqueia ninguem (e
// so uma porta a mais) e a env CEO_API_TOKEN ainda e usada por requirePin.ts.
// Remover exigiria auditar integracoes scripted que nao tenho como ver daqui.
export function requireCeoToken(req: Request, res: Response, next: NextFunction): void {
  // 1. Tenta JWT primeiro (cookie definido em /api/auth/login).
  // v3.109.0: usa o verifyJWT importado no topo. Antes havia um require() inline
  // que estoura em contexto ESM (ReferenceError -> 500 em vez de 401/403).
  // verifyJWT já checa a blacklist internamente e lança se o jti foi revogado.

  // v3.109.0 — BUG CORRIGIDO: lia `cookies.auth_token`, mas o cookie do login se
  // chama `zayra_auth` (COOKIE_NAME). O caminho do JWT por cookie NUNCA disparava,
  // entao todas as ~96 rotas caiam no fallback do header X-CEO-Token — inclusive
  // pro proprio CEO logado. Era a causa real dos "sem permissao" em campo.
  // Agora extrai igual ao requireAuth: cookie zayra_auth, com Bearer de reserva.
  const cookies = req.headers.cookie ? parseCookies(req.headers.cookie) : {};
  const token = cookies[COOKIE_NAME]
             || (req as { cookies?: Record<string, string> }).cookies?.[COOKIE_NAME]
             || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (token) {
    try {
      const claims = verifyJWT(token);
      // v3.109.0: exigencia de role admin/owner REMOVIDA a pedido do CEO — o sistema
      // hoje e' de uso interno unico e o gate por papel so travava o time em campo.
      // Estar logado basta. Quando virar SaaS, o aperto volta como requireRole(...)
      // nas rotas sensiveis, nao como token compartilhado.
      if (claims) {
        (req as AuthedRequest).user = claims;
        return next();
      }
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
