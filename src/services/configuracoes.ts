// v1.99.17: service de configurações globais com cache em memória (TTL 5 min).
// Chaves típicas: PRECO_DEFAULT_DESDOBRO_URBANO, PRECO_DEFAULT_DESMEMBRAMENTO_RURAL,
// SALARIO_MINIMO_VIGENTE. Defaults aplicados quando a chave não existe em DB.

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

const TTL_MS = 5 * 60 * 1000; // 5 minutos

interface CacheEntry {
  valor: string;
  expiraEm: number;
}

const cache = new Map<string, CacheEntry>();

const DEFAULTS: Record<string, string> = {
  PRECO_DEFAULT_DESDOBRO_URBANO: '450.00',
  PRECO_DEFAULT_DESMEMBRAMENTO_RURAL: '450.00',
  SALARIO_MINIMO_VIGENTE: '1518.00',
};

interface ConfigRow extends RowDataPacket {
  valor: string;
}

export async function getConfig(chave: string): Promise<string> {
  const hit = cache.get(chave);
  const now = Date.now();
  if (hit && hit.expiraEm > now) return hit.valor;

  try {
    const [rows] = await pool.execute<ConfigRow[]>(
      `SELECT valor FROM configuracoes WHERE chave = ? LIMIT 1`,
      [chave]
    );
    if (rows.length > 0) {
      const valor = String(rows[0].valor);
      cache.set(chave, { valor, expiraEm: now + TTL_MS });
      return valor;
    }
  } catch (err) {
    // DB pode ainda nao ter migrado — cai para default
    console.warn(`[configuracoes] erro lendo ${chave}: ${(err as Error).message}`);
  }

  const fallback = DEFAULTS[chave] ?? '';
  cache.set(chave, { valor: fallback, expiraEm: now + TTL_MS });
  return fallback;
}

export async function getConfigNumber(chave: string): Promise<number> {
  const v = await getConfig(chave);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function setConfig(chave: string, valor: string, descricao?: string): Promise<void> {
  await pool.execute(
    `INSERT INTO configuracoes (chave, valor, descricao) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), descricao = COALESCE(VALUES(descricao), descricao)`,
    [chave, valor, descricao ?? null]
  );
  cache.set(chave, { valor, expiraEm: Date.now() + TTL_MS });
}

export function invalidateConfigCache(chave?: string): void {
  if (chave) cache.delete(chave);
  else cache.clear();
}

/** Atalho usado pelo endpoint /api/configuracoes/defaults-precificacao */
export async function getDefaultsPrecificacao(): Promise<{
  preco_default_desdobro_urbano: number;
  preco_default_desmembramento_rural: number;
  salario_minimo_vigente: number;
}> {
  const [desdobro, desm, sm] = await Promise.all([
    getConfigNumber('PRECO_DEFAULT_DESDOBRO_URBANO'),
    getConfigNumber('PRECO_DEFAULT_DESMEMBRAMENTO_RURAL'),
    getConfigNumber('SALARIO_MINIMO_VIGENTE'),
  ]);
  return {
    preco_default_desdobro_urbano: desdobro,
    preco_default_desmembramento_rural: desm,
    salario_minimo_vigente: sm,
  };
}
