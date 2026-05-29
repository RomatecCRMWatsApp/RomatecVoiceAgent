// v3.50.0: service do PIN secundario (4 digitos numericos) + admin bypass.
//
// Regra: roles `admin` e `owner` dispensam PIN em qualquer rota (autoridade
// equivalente a CEO). Outros roles digitam PIN cadastrado em Configuracoes.

import bcrypt from 'bcrypt';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import type { AuthRole, JWTClaims } from './auth';

export const PIN_BCRYPT_COST = 12;
export const PIN_LENGTH = 4;
export const PIN_MAX_FAILED_ATTEMPTS = 5;
export const PIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 min

/** Roles que dispensam PIN em todas as rotas (mesma autoridade que CEO). */
const ROLES_BYPASS_PIN: ReadonlySet<AuthRole> = new Set(['admin', 'owner']);

export function isAdminBypassPin(claims: JWTClaims | undefined | null): boolean {
  if (!claims) return false;
  return ROLES_BYPASS_PIN.has(claims.role);
}

/** Valida que o PIN tem exatamente 4 digitos numericos. */
export function validarFormatoPin(pin: unknown): pin is string {
  return typeof pin === 'string'
    && pin.length === PIN_LENGTH
    && /^\d{4}$/.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  if (!validarFormatoPin(pin)) {
    throw new Error('PIN deve ter exatamente 4 digitos numericos');
  }
  return bcrypt.hash(pin, PIN_BCRYPT_COST);
}

export async function compararPin(pin: string, hash: string): Promise<boolean> {
  if (!pin || !hash) return false;
  return bcrypt.compare(pin, hash);
}

export interface UserPinRow extends RowDataPacket {
  id: number;
  pin_hash: string | null;
  pin_set_at: Date | string | null;
  pin_failed_attempts: number;
  pin_locked_until: Date | string | null;
}

export async function buscarUserPin(userId: number): Promise<UserPinRow | null> {
  const [rows] = await pool.execute<UserPinRow[]>(
    `SELECT id, pin_hash, pin_set_at, pin_failed_attempts, pin_locked_until
       FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [Number(userId)],
  );
  return rows[0] ?? null;
}

export interface PinStatusResumo {
  has_pin: boolean;
  set_at: string | null;
  is_locked: boolean;
  locked_until: string | null;
  failed_attempts: number;
}

export async function statusPin(userId: number): Promise<PinStatusResumo> {
  const u = await buscarUserPin(userId);
  if (!u) {
    return { has_pin: false, set_at: null, is_locked: false, locked_until: null, failed_attempts: 0 };
  }
  const lockedUntil = u.pin_locked_until ? new Date(u.pin_locked_until as Date) : null;
  const isLocked = !!(lockedUntil && lockedUntil.getTime() > Date.now());
  return {
    has_pin: !!u.pin_hash,
    set_at: u.pin_set_at ? new Date(u.pin_set_at as Date).toISOString() : null,
    is_locked: isLocked,
    locked_until: isLocked ? lockedUntil!.toISOString() : null,
    failed_attempts: Number(u.pin_failed_attempts || 0),
  };
}

/** Define ou troca o PIN. Reseta tentativas falhas. */
export async function definirPin(userId: number, pin: string): Promise<void> {
  if (!validarFormatoPin(pin)) {
    throw new Error('PIN deve ter exatamente 4 digitos numericos');
  }
  const hash = await hashPin(pin);
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE users
        SET pin_hash = ?, pin_set_at = NOW(),
            pin_failed_attempts = 0, pin_locked_until = NULL
      WHERE id = ? AND deleted_at IS NULL`,
    [hash, Number(userId)],
  );
  if (r.affectedRows === 0) throw new Error('Usuario nao encontrado');
}

/** Remove o PIN — usuario volta a nao precisar (mas continua bloqueado em rotas que exigem). */
export async function removerPin(userId: number): Promise<void> {
  await pool.execute(
    `UPDATE users
        SET pin_hash = NULL, pin_set_at = NULL,
            pin_failed_attempts = 0, pin_locked_until = NULL
      WHERE id = ?`,
    [Number(userId)],
  );
}

export type VerificarPinResultado =
  | { ok: true }
  | { ok: false; motivo: 'sem_pin' | 'travado' | 'incorreto' | 'formato_invalido'; mensagem: string; restantes?: number; locked_until?: string };

/** Verifica PIN do usuario. Aplica rate-limit (5 falhas -> trava 15 min). */
export async function verificarPin(userId: number, pinInformado: string): Promise<VerificarPinResultado> {
  if (!validarFormatoPin(pinInformado)) {
    return { ok: false, motivo: 'formato_invalido', mensagem: 'PIN deve ter 4 digitos numericos' };
  }
  const u = await buscarUserPin(userId);
  if (!u || !u.pin_hash) {
    return { ok: false, motivo: 'sem_pin', mensagem: 'PIN nao cadastrado. Configure em Configuracoes > Seguranca.' };
  }
  // Checa lock
  const lockedUntil = u.pin_locked_until ? new Date(u.pin_locked_until as Date) : null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    const minutosRestantes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
    return {
      ok: false,
      motivo: 'travado',
      mensagem: `PIN travado por ${minutosRestantes} min apos varias tentativas erradas.`,
      locked_until: lockedUntil.toISOString(),
    };
  }
  // Compara
  const ok = await compararPin(pinInformado, u.pin_hash);
  if (ok) {
    // Reset contadores
    if (u.pin_failed_attempts > 0 || u.pin_locked_until) {
      await pool.execute(
        `UPDATE users SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = ?`,
        [userId],
      );
    }
    return { ok: true };
  }
  // Errado: incrementa contador, possivel lock
  const novasTentativas = (u.pin_failed_attempts || 0) + 1;
  if (novasTentativas >= PIN_MAX_FAILED_ATTEMPTS) {
    const lock = new Date(Date.now() + PIN_LOCK_DURATION_MS);
    await pool.execute(
      `UPDATE users SET pin_failed_attempts = ?, pin_locked_until = ? WHERE id = ?`,
      [novasTentativas, lock, userId],
    );
    return {
      ok: false,
      motivo: 'travado',
      mensagem: `PIN incorreto. Apos ${PIN_MAX_FAILED_ATTEMPTS} tentativas, travado por 15 min.`,
      locked_until: lock.toISOString(),
    };
  }
  await pool.execute(
    `UPDATE users SET pin_failed_attempts = ? WHERE id = ?`,
    [novasTentativas, userId],
  );
  return {
    ok: false,
    motivo: 'incorreto',
    mensagem: 'PIN incorreto.',
    restantes: PIN_MAX_FAILED_ATTEMPTS - novasTentativas,
  };
}
