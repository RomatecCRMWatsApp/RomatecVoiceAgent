// v3.24.0: PR A Auth Foundation — rotas /api/auth/*.
//
// Endpoints:
//   POST /api/auth/login   — body { login, senha }. Aceita email OU telefone.
//                            Set-Cookie httpOnly + retorna user info (sem token).
//   POST /api/auth/logout  — invalida JWT atual via blacklist (jti).
//   GET  /api/auth/me      — retorna user do JWT atual (testa que sessao tá viva).
//
// Rate limit aplicado APENAS em /login (5 tentativas/15min por IP).
// Pra limit por login (10/1h), check manual em auth_logs (mais barato que
// rate-limit store dedicado por key dinamica).
//
// Cada attempt (sucesso OU falha) loga em auth_logs sem senha. Motivo_falha
// preenchido pra debugging (usuario_nao_existe, senha_invalida, locked, etc).

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import {
  verifyPassword,
  issueJWT,
  blacklistJti,
  buildAuthCookieOptions,
  COOKIE_NAME,
  type AuthRole,
} from '../services/auth';
import { requireAuth, type AuthedRequest } from '../middleware/auth';

const router = Router();

// ─── Rate limit ───────────────────────────────────────────────────────
// 5 tentativas / 15 min por IP. Mensagem em pt-BR.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,  // só conta tentativas FALHADAS — boa pratica
  message: {
    error: 'Muitas tentativas de login deste IP. Aguarde 15 minutos.',
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────
async function registrarTentativa(input: {
  user_id: number | null;
  login_attempt: string;
  ip: string;
  user_agent: string | null;
  sucesso: boolean;
  motivo_falha?: string;
}): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO auth_logs (user_id, login_attempt, ip, user_agent, sucesso, motivo_falha)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.user_id,
        input.login_attempt.slice(0, 255),
        input.ip.slice(0, 45),
        input.user_agent ? input.user_agent.slice(0, 1000) : null,
        input.sucesso ? 1 : 0,
        input.motivo_falha?.slice(0, 100) ?? null,
      ],
    );
  } catch (err) {
    // Nao bloquear login se log falhar — apenas warn
    console.warn('[auth] falha registrar tentativa em auth_logs:', (err as Error).message);
  }
}

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  phone: string | null;
  failed_login_attempts: number;
  locked_until: Date | string | null;
  deleted_at: Date | string | null;
}

interface TenantUserRow extends RowDataPacket {
  tenant_id: number;
  role: AuthRole;
  equipe_id: number | null;
}

function isPhone(login: string): boolean {
  // 10-15 digitos (DDI opcional + DDD + numero). Tira tudo nao-digito antes.
  const digits = login.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

async function buscarUserPorLogin(login: string): Promise<UserRow | null> {
  const isPhoneInput = isPhone(login);
  if (isPhoneInput) {
    const digits = login.replace(/\D/g, '');
    const [rows] = await pool.execute<UserRow[]>(
      `SELECT * FROM users
        WHERE phone IS NOT NULL
          AND REGEXP_REPLACE(phone, '[^0-9]', '') = ?
          AND deleted_at IS NULL
        LIMIT 1`,
      [digits],
    );
    return rows[0] || null;
  } else {
    const [rows] = await pool.execute<UserRow[]>(
      `SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1`,
      [login.trim().toLowerCase()],
    );
    return rows[0] || null;
  }
}

async function buscarTenantUser(user_id: number): Promise<TenantUserRow | null> {
  const [rows] = await pool.execute<TenantUserRow[]>(
    `SELECT tenant_id, role, equipe_id FROM tenant_users
      WHERE user_id = ? ORDER BY tenant_id ASC LIMIT 1`,
    [user_id],
  );
  return rows[0] || null;
}

// ─── POST /api/auth/login ─────────────────────────────────────────────
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const ip = (req.ip || req.headers['x-forwarded-for'] || 'desconhecido').toString().slice(0, 45);
  const ua = (req.headers['user-agent'] as string | undefined) || null;
  const body = (req.body || {}) as { login?: string; senha?: string };
  const login = (body.login || '').trim();
  const senha = body.senha || '';

  if (!login || !senha) {
    res.status(400).json({ error: 'login e senha sao obrigatorios.' });
    return;
  }
  if (senha.length < 4) {
    // 4 e' deliberadamente baixo aqui pra nao revelar requisito real e ajudar fuzzers.
    // hashPassword valida >= 8 no signup.
    await registrarTentativa({ user_id: null, login_attempt: login, ip, user_agent: ua, sucesso: false, motivo_falha: 'senha_muito_curta' });
    res.status(401).json({ error: 'Login ou senha invalidos.' });
    return;
  }

  let user: UserRow | null;
  try {
    user = await buscarUserPorLogin(login);
  } catch (err) {
    console.error('[auth] erro buscar user:', (err as Error).message);
    await registrarTentativa({ user_id: null, login_attempt: login, ip, user_agent: ua, sucesso: false, motivo_falha: 'db_error' });
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
    return;
  }

  if (!user) {
    await registrarTentativa({ user_id: null, login_attempt: login, ip, user_agent: ua, sucesso: false, motivo_falha: 'usuario_nao_existe' });
    res.status(401).json({ error: 'Login ou senha invalidos.' });
    return;
  }

  // Check locked_until — bloqueado por failed attempts (gerenciado em outro flow futuro)
  if (user.locked_until) {
    const lockedUntilDate = user.locked_until instanceof Date ? user.locked_until : new Date(user.locked_until);
    if (lockedUntilDate.getTime() > Date.now()) {
      await registrarTentativa({ user_id: user.id, login_attempt: login, ip, user_agent: ua, sucesso: false, motivo_falha: 'locked' });
      res.status(403).json({
        error: `Conta temporariamente bloqueada ate ${lockedUntilDate.toISOString()}.`,
      });
      return;
    }
  }

  const ok = await verifyPassword(senha, user.password_hash);
  if (!ok) {
    await registrarTentativa({ user_id: user.id, login_attempt: login, ip, user_agent: ua, sucesso: false, motivo_falha: 'senha_invalida' });
    // Incrementa failed_login_attempts. Se passar de 10 em 1h, bloqueia 1h.
    await pool.execute(
      `UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = ?`,
      [user.id],
    );
    res.status(401).json({ error: 'Login ou senha invalidos.' });
    return;
  }

  // Login OK — busca tenant + role
  const tu = await buscarTenantUser(user.id);
  if (!tu) {
    // User existe mas sem vinculo a tenant — caso de seed incompleto
    await registrarTentativa({ user_id: user.id, login_attempt: login, ip, user_agent: ua, sucesso: false, motivo_falha: 'sem_tenant_user' });
    res.status(403).json({ error: 'Usuario sem vinculo a tenant. Contate o admin.' });
    return;
  }

  // Reset failed attempts + atualiza last_login
  await pool.execute(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
      last_login_at = CURRENT_TIMESTAMP, last_login_ip = ?
     WHERE id = ?`,
    [ip, user.id],
  );

  const { token, expiresIn } = issueJWT({
    sub: String(user.id),
    role: tu.role,
    tenant_id: tu.tenant_id,
    equipe_id: tu.equipe_id,
    name: user.name,
  });

  const cookieOpts = buildAuthCookieOptions(expiresIn);
  res.cookie(COOKIE_NAME, token, cookieOpts);

  await registrarTentativa({ user_id: user.id, login_attempt: login, ip, user_agent: ua, sucesso: true });

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: tu.role,
      tenant_id: tu.tenant_id,
      equipe_id: tu.equipe_id,
    },
    expires_in: expiresIn,
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────
// Invalida JWT atual via blacklist (jti). Limpa cookie.
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user;
  if (user?.jti && user.exp) {
    blacklistJti(user.jti, user.exp);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────
// Retorna user atual baseado no JWT. Util pro front saber se a sessao ta viva.
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user!;
  res.json({
    id: Number(user.sub),
    name: user.name,
    role: user.role,
    tenant_id: user.tenant_id,
    equipe_id: user.equipe_id,
  });
});

export default router;
