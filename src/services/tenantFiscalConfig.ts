// v1.74.0 — Configuração fiscal do tenant.
//
// Encapsula leitura/escrita da tabela tenant_fiscal_config + criptografia
// da api_key do provider. NUNCA retorna api_key em metodos publicos —
// somente getApiKey() retorna a chave plain pra uso interno.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { encryptSecret, decryptSecret } from './cryptoSecrets';

export type RegimeTributario = 'mei' | 'simples' | 'presumido' | 'real';
export type ProviderNF = 'nfeio' | 'plugnotas' | 'enotas' | 'manual';
export type AmbienteFiscal = 'producao' | 'homologacao';

export interface FiscalConfig {
  tenant_id: number;
  cnpj: string;
  inscricao_municipal: string | null;
  inscricao_estadual: string | null;
  regime_tributario: RegimeTributario;
  simples_aliquota: number | null;
  iss_aliquota: number;
  provider: ProviderNF;
  provider_company_id: string | null;
  /** TRUE se a api_key esta cadastrada (nao retorna o valor — use getApiKey). */
  has_api_key: boolean;
  certificado_storage_url: string | null;
  certificado_validade: string | null;
  ambiente: AmbienteFiscal;
  rps_serie: string;
  servicos_codigos: Record<string, string> | null;
  auto_emitir_em: Record<string, boolean> | null;
}

interface FiscalConfigRow extends RowDataPacket {
  tenant_id: number;
  cnpj: string;
  inscricao_municipal: string | null;
  inscricao_estadual: string | null;
  regime_tributario: RegimeTributario;
  simples_aliquota: string | null;
  iss_aliquota: string;
  provider: ProviderNF;
  provider_company_id: string | null;
  provider_api_key_enc: Buffer | null;
  certificado_storage_url: string | null;
  certificado_validade: Date | string | null;
  ambiente: AmbienteFiscal;
  rps_serie: string;
  servicos_codigos: string | Record<string, string> | null;
  auto_emitir_em: string | Record<string, boolean> | null;
}

function parseJson<T>(v: string | T | null): T | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return v;
}

function mapRow(r: FiscalConfigRow): FiscalConfig {
  return {
    tenant_id: Number(r.tenant_id),
    cnpj: String(r.cnpj),
    inscricao_municipal: r.inscricao_municipal ?? null,
    inscricao_estadual: r.inscricao_estadual ?? null,
    regime_tributario: r.regime_tributario,
    simples_aliquota: r.simples_aliquota != null ? Number(r.simples_aliquota) : null,
    iss_aliquota: Number(r.iss_aliquota),
    provider: r.provider,
    provider_company_id: r.provider_company_id ?? null,
    has_api_key: !!(r.provider_api_key_enc && r.provider_api_key_enc.length > 0),
    certificado_storage_url: r.certificado_storage_url ?? null,
    certificado_validade: r.certificado_validade
      ? (r.certificado_validade instanceof Date
          ? r.certificado_validade.toISOString().slice(0, 10)
          : String(r.certificado_validade).slice(0, 10))
      : null,
    ambiente: r.ambiente,
    rps_serie: r.rps_serie,
    servicos_codigos: parseJson<Record<string, string>>(r.servicos_codigos),
    auto_emitir_em: parseJson<Record<string, boolean>>(r.auto_emitir_em),
  };
}

export async function getFiscalConfig(tenant_id = 1): Promise<FiscalConfig | null> {
  const [rows] = await pool.execute<FiscalConfigRow[]>(
    `SELECT * FROM tenant_fiscal_config WHERE tenant_id = ? LIMIT 1`, [tenant_id]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/** Retorna a api_key descriptografada. Uso interno apenas. */
export async function getApiKey(tenant_id = 1): Promise<string> {
  const [rows] = await pool.execute<FiscalConfigRow[]>(
    `SELECT provider_api_key_enc FROM tenant_fiscal_config WHERE tenant_id = ? LIMIT 1`,
    [tenant_id]
  );
  if (!rows.length || !rows[0].provider_api_key_enc) return '';
  return decryptSecret(rows[0].provider_api_key_enc);
}

export interface UpsertFiscalConfigInput {
  tenant_id?: number;
  cnpj: string;
  inscricao_municipal?: string | null;
  inscricao_estadual?: string | null;
  regime_tributario?: RegimeTributario;
  simples_aliquota?: number | null;
  iss_aliquota?: number;
  provider?: ProviderNF;
  provider_company_id?: string | null;
  /** Se string, criptografa. Se undefined, mantem; se null, limpa. */
  api_key?: string | null;
  ambiente?: AmbienteFiscal;
  rps_serie?: string;
  servicos_codigos?: Record<string, string> | null;
  auto_emitir_em?: Record<string, boolean> | null;
}

export async function upsertFiscalConfig(input: UpsertFiscalConfigInput): Promise<FiscalConfig> {
  const tenant_id = input.tenant_id ?? 1;
  if (!input.cnpj?.trim()) throw new Error('cnpj obrigatorio');
  const cnpj = input.cnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('cnpj deve ter 14 digitos');

  const apiKeyValue = input.api_key === undefined
    ? undefined
    : input.api_key === null
      ? null
      : encryptSecret(input.api_key);

  const existing = await getFiscalConfig(tenant_id);

  if (!existing) {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO tenant_fiscal_config
        (tenant_id, cnpj, inscricao_municipal, inscricao_estadual,
         regime_tributario, simples_aliquota, iss_aliquota,
         provider, provider_company_id, provider_api_key_enc,
         ambiente, rps_serie, servicos_codigos, auto_emitir_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        tenant_id, cnpj, input.inscricao_municipal ?? null, input.inscricao_estadual ?? null,
        input.regime_tributario ?? 'simples',
        input.simples_aliquota ?? null,
        input.iss_aliquota ?? 5.00,
        input.provider ?? 'nfeio',
        input.provider_company_id ?? null,
        apiKeyValue ?? null,
        input.ambiente ?? 'homologacao',
        input.rps_serie ?? '1',
        input.servicos_codigos ? JSON.stringify(input.servicos_codigos) : null,
        input.auto_emitir_em ? JSON.stringify(input.auto_emitir_em) : null,
      ]
    );
  } else {
    // UPDATE — so atualiza campos passados
    const fields: string[] = ['cnpj = ?'];
    const params: (string | number | Buffer | null)[] = [cnpj];

    const setIfDefined = <T>(col: string, val: T | undefined, transform?: (v: T) => string | number | null) => {
      if (val !== undefined) {
        fields.push(`${col} = ?`);
        params.push(transform ? transform(val) : (val as string | number | null));
      }
    };
    setIfDefined('inscricao_municipal', input.inscricao_municipal);
    setIfDefined('inscricao_estadual', input.inscricao_estadual);
    setIfDefined('regime_tributario', input.regime_tributario);
    setIfDefined('simples_aliquota', input.simples_aliquota);
    setIfDefined('iss_aliquota', input.iss_aliquota);
    setIfDefined('provider', input.provider);
    setIfDefined('provider_company_id', input.provider_company_id);
    setIfDefined('ambiente', input.ambiente);
    setIfDefined('rps_serie', input.rps_serie);
    if (input.servicos_codigos !== undefined) {
      fields.push('servicos_codigos = ?');
      params.push(input.servicos_codigos ? JSON.stringify(input.servicos_codigos) : null);
    }
    if (input.auto_emitir_em !== undefined) {
      fields.push('auto_emitir_em = ?');
      params.push(input.auto_emitir_em ? JSON.stringify(input.auto_emitir_em) : null);
    }
    if (apiKeyValue !== undefined) {
      fields.push('provider_api_key_enc = ?');
      params.push(apiKeyValue);
    }
    params.push(tenant_id);
    await pool.execute(
      `UPDATE tenant_fiscal_config SET ${fields.join(', ')} WHERE tenant_id = ?`,
      params
    );
  }

  const result = await getFiscalConfig(tenant_id);
  if (!result) throw new Error('falha ao salvar');
  return result;
}
