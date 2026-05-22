// v3.24.0: PR A Auth Foundation — bcrypt + JWT + blacklist.
//
// Decisões tomadas no plano (ver 06-Changelog/v3.24.0):
// - bcrypt cost 12 (nativo, builda no Railway — testado)
// - JWT em cookie httpOnly (não localStorage); expira 8h colaborador / 24h admin
// - Logout via blacklist em memória (Map<jti, expiraEm>), revisado periodicamente
//   pra cleanup. Dívida técnica: migrar pra Redis quando escalar (registrado)
// - JWT_SECRET obrigatório no boot (mínimo 32 chars) — fail-fast em server.ts
//
// Claims do JWT:
//   sub: user_id (string)
//   role: 'admin' | 'gestor' | 'colaborador' | 'engenheiro' | 'financeiro' | 'viewer' | 'owner'
//   tenant_id: number
//   equipe_id: number | null (só pra colaborador)
//   name: string
//   jti: nonce pra blacklist
//   iat, exp: standard JWT timestamps

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const BCRYPT_COST = 12;
export const JWT_EXPIRES_COLABORADOR = '8h';  // jornada de trabalho
export const JWT_EXPIRES_ADMIN = '24h';        // sessao admin

export type AuthRole =
  | 'owner'
  | 'admin'
  | 'gestor'
  | 'engenheiro'
  | 'financeiro'
  | 'colaborador'
  | 'viewer';

export interface JWTClaims {
  sub: string;          // user_id
  role: AuthRole;
  tenant_id: number;
  equipe_id: number | null;
  name: string;
  jti: string;
  iat?: number;
  exp?: number;
}

// ─── Hash ─────────────────────────────────────────────────────────────
export async function hashPassword(senha: string): Promise<string> {
  if (!senha || senha.length < 8) {
    throw new Error('Senha deve ter ao menos 8 caracteres');
  }
  return bcrypt.hash(senha, BCRYPT_COST);
}

export async function verifyPassword(senha: string, hash: string): Promise<boolean> {
  if (!senha || !hash) return false;
  return bcrypt.compare(senha, hash);
}

// ─── JWT ──────────────────────────────────────────────────────────────
function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    // Fail-fast adicional caso o boot guard tenha sido bypassed em algum import
    throw new Error('JWT_SECRET ausente ou < 32 caracteres (config invalida)');
  }
  return s;
}

export function issueJWT(claims: Omit<JWTClaims, 'jti' | 'iat' | 'exp'>): { token: string; jti: string; expiresIn: string } {
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresIn = claims.role === 'colaborador' ? JWT_EXPIRES_COLABORADOR : JWT_EXPIRES_ADMIN;
  const token = jwt.sign({ ...claims, jti }, getSecret(), { expiresIn });
  return { token, jti, expiresIn };
}

export function verifyJWT(token: string): JWTClaims {
  // Pode lançar — caller deve try/catch
  const decoded = jwt.verify(token, getSecret()) as JWTClaims;
  if (isBlacklisted(decoded.jti)) {
    throw new Error('Token revogado');
  }
  return decoded;
}

// ─── Blacklist (logout) ───────────────────────────────────────────────
// Map<jti, expiraEm>. Cleanup oportunista a cada check.
// DIVIDA TÉCNICA: trocar por Redis quando escalar pra multi-instance Railway.
// Hoje funciona porque servimos de uma instancia só.
const blacklist = new Map<string, number>();

export function blacklistJti(jti: string, expiraEm: number): void {
  if (!jti) return;
  blacklist.set(jti, expiraEm);
  // Cleanup oportunista de entradas expiradas
  if (blacklist.size > 1000) cleanupBlacklist();
}

export function isBlacklisted(jti: string): boolean {
  if (!jti) return false;
  const exp = blacklist.get(jti);
  if (!exp) return false;
  if (exp < Date.now() / 1000) {
    blacklist.delete(jti);
    return false;
  }
  return true;
}

function cleanupBlacklist(): void {
  const nowSec = Date.now() / 1000;
  for (const [jti, exp] of blacklist.entries()) {
    if (exp < nowSec) blacklist.delete(jti);
  }
}

// Test-only helper — não exporta no index pra evitar abuso
export function _blacklistSize(): number {
  return blacklist.size;
}

// ─── Cookie helpers ────────────────────────────────────────────────────
export const COOKIE_NAME = 'zayra_auth';
export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  maxAge: number;  // ms
  path: string;
}

export function buildAuthCookieOptions(expiresIn: string): CookieOptions {
  // expiresIn é "8h" ou "24h" — converte pra ms
  const m = expiresIn.match(/^(\d+)(h|m|s)$/);
  let maxAge = 8 * 60 * 60 * 1000; // default 8h
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    maxAge = n * (unit === 'h' ? 3600_000 : unit === 'm' ? 60_000 : 1000);
  }
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge,
    path: '/',
  };
}

// ─── Boot guard ────────────────────────────────────────────────────────
// Chamado no server.ts no boot ANTES de qualquer rota subir. Crasha o processo
// se JWT_SECRET nao tiver setado/curto demais. Nao bypassavel.
export function bootValidateAuthEnv(): void {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'JWT_SECRET ausente ou curto demais (minimo 32 chars). Boot abortado.\n' +
      'Gere um secret seguro com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"\n' +
      'E configure no Railway: JWT_SECRET=<seu_secret>\n' +
      'Documentado em .env.example',
    );
  }
}
