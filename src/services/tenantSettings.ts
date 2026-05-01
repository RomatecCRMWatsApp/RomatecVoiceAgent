// v1.64.0 — Configurações de tenant (white-label estrutural).
//
// Hoje mono-tenant: tenant_id=1 (Romatec). Estrutura pronta pra futuro SaaS
// onde cada cliente terá seu próprio logo/marca via UPDATE na tabela.
//
// NÃO inclui (escopo v2):
//   - Multi-tenant real (auth, isolamento de dados, billing)
//   - UI admin pra trocar logo
//   - Onboarding de novos clientes
//
// Função principal `getTenantSettings()` cacheia em memória 5 min pra evitar
// query repetida em toda chamada de PDF/header.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

export interface TenantSettings {
  id:               number;
  tenant_id:        number;
  brand_name:       string;
  brand_short_name: string | null;
  logo_path:        string | null;
  primary_color:    string;
  document_footer:  string | null;
  cnpj:             string | null;
  endereco:         string | null;
  telefone:         string | null;
  email:            string | null;
  site:             string | null;
}

interface TenantRow extends RowDataPacket, TenantSettings {}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<number, { data: TenantSettings; ts: number }>();

const DEFAULT_FALLBACK: TenantSettings = {
  id: 0,
  tenant_id: 1,
  brand_name: 'Romatec Consultoria Imobiliária',
  brand_short_name: 'Romatec',
  logo_path: '/romatec-logo.jpg',
  primary_color: '#10b981',
  document_footer: null,
  cnpj: null,
  endereco: null,
  telefone: null,
  email: null,
  site: null,
};

export async function getTenantSettings(tenantId = 1): Promise<TenantSettings> {
  const cached = cache.get(tenantId);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const [rows] = await pool.execute<TenantRow[]>(
      `SELECT id, tenant_id, brand_name, brand_short_name, logo_path,
              primary_color, document_footer, cnpj, endereco, telefone, email, site
       FROM tenant_settings WHERE tenant_id = ? LIMIT 1`,
      [tenantId],
    );
    if (rows.length === 0) {
      console.warn(`[tenantSettings] tenant_id=${tenantId} não encontrado, usando defaults Romatec`);
      return DEFAULT_FALLBACK;
    }
    const data = rows[0] as TenantSettings;
    cache.set(tenantId, { data, ts: Date.now() });
    return data;
  } catch (err) {
    console.warn('[tenantSettings] DB falhou, usando defaults:', (err as Error).message);
    return DEFAULT_FALLBACK;
  }
}

export async function atualizarTenantSettings(
  tenantId: number,
  patch: Partial<Omit<TenantSettings, 'id' | 'tenant_id'>>,
): Promise<TenantSettings> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const k of [
    'brand_name','brand_short_name','logo_path','primary_color','document_footer',
    'cnpj','endereco','telefone','email','site',
  ] as const) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); params.push(patch[k] ?? null); }
  }
  if (!sets.length) throw new Error('Nada pra atualizar.');
  params.push(tenantId);
  await pool.execute<ResultSetHeader>(
    `UPDATE tenant_settings SET ${sets.join(', ')} WHERE tenant_id = ?`, params,
  );
  cache.delete(tenantId); // invalida cache
  return getTenantSettings(tenantId);
}

export function invalidarCache(tenantId?: number): void {
  if (tenantId !== undefined) cache.delete(tenantId);
  else cache.clear();
}
