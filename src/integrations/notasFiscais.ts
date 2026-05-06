// v1.74.0 — Service de orquestração de Notas Fiscais.
//
// Orquestra: validação payload → grava status='rascunho' → envia pro provider
// → grava provider_id + status='processando' → quando webhook chegar
// (handler em server.ts), atualiza pdf_url/xml_url + status final.
//
// Idempotência: se ja existe NF pra (resource_type, resource_id) com status
// nao terminal, retorna a existente.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { getFiscalConfig, getApiKey } from '../services/tenantFiscalConfig';
import { nfeioClient, type NfeioServiceInvoiceInput } from './nfeio';

export type StatusNF =
  | 'rascunho' | 'processando' | 'autorizada' | 'rejeitada'
  | 'cancelada' | 'substituida' | 'manual';

export type TipoNF = 'nfse' | 'nfe' | 'nfce';

export interface NotaFiscal {
  id: number;
  tenant_id: number;
  numero: string | null;
  serie: string | null;
  rps_numero: string;
  rps_serie: string;
  tipo: TipoNF;
  resource_type: string | null;
  resource_id: string | null;
  recibo_id: number | null;
  tomador_doc: string;
  tomador_nome: string;
  tomador_email: string | null;
  tomador_endereco: Record<string, unknown>;
  valor_servico: number;
  valor_iss: number;
  valor_inss: number;
  valor_irrf: number;
  valor_csll: number;
  valor_cofins: number;
  valor_pis: number;
  valor_deducoes: number;
  valor_liquido: number;
  iss_aliquota: number;
  iss_retido: boolean;
  codigo_servico: string;
  descricao: string;
  provider: 'nfeio' | 'plugnotas' | 'enotas' | 'manual';
  provider_id: string | null;
  status: StatusNF;
  motivo_rejeicao: string | null;
  pdf_url: string | null;
  xml_url: string | null;
  codigo_verificacao: string | null;
  link_verificacao: string | null;
  emitida_em: Date | null;
  cancelada_em: Date | null;
  motivo_cancelamento: string | null;
  emitida_por: number | null;
  created_at: Date;
}

interface NFRow extends RowDataPacket {
  [k: string]: unknown;
}

function parseJsonField<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

function mapRow(r: NFRow): NotaFiscal {
  return {
    id: Number(r.id),
    tenant_id: Number(r.tenant_id),
    numero: (r.numero as string) ?? null,
    serie: (r.serie as string) ?? null,
    rps_numero: String(r.rps_numero),
    rps_serie: String(r.rps_serie),
    tipo: r.tipo as TipoNF,
    resource_type: (r.resource_type as string) ?? null,
    resource_id: (r.resource_id as string) ?? null,
    recibo_id: r.recibo_id != null ? Number(r.recibo_id) : null,
    tomador_doc: String(r.tomador_doc),
    tomador_nome: String(r.tomador_nome),
    tomador_email: (r.tomador_email as string) ?? null,
    tomador_endereco: parseJsonField<Record<string, unknown>>(r.tomador_endereco) ?? {},
    valor_servico: Number(r.valor_servico),
    valor_iss: Number(r.valor_iss),
    valor_inss: Number(r.valor_inss),
    valor_irrf: Number(r.valor_irrf),
    valor_csll: Number(r.valor_csll),
    valor_cofins: Number(r.valor_cofins),
    valor_pis: Number(r.valor_pis),
    valor_deducoes: Number(r.valor_deducoes),
    valor_liquido: Number(r.valor_liquido),
    iss_aliquota: Number(r.iss_aliquota),
    iss_retido: !!r.iss_retido,
    codigo_servico: String(r.codigo_servico),
    descricao: String(r.descricao),
    provider: r.provider as 'nfeio' | 'plugnotas' | 'enotas' | 'manual',
    provider_id: (r.provider_id as string) ?? null,
    status: r.status as StatusNF,
    motivo_rejeicao: (r.motivo_rejeicao as string) ?? null,
    pdf_url: (r.pdf_url as string) ?? null,
    xml_url: (r.xml_url as string) ?? null,
    codigo_verificacao: (r.codigo_verificacao as string) ?? null,
    link_verificacao: (r.link_verificacao as string) ?? null,
    emitida_em: r.emitida_em ? new Date(r.emitida_em as Date) : null,
    cancelada_em: r.cancelada_em ? new Date(r.cancelada_em as Date) : null,
    motivo_cancelamento: (r.motivo_cancelamento as string) ?? null,
    emitida_por: r.emitida_por != null ? Number(r.emitida_por) : null,
    created_at: new Date(r.created_at as Date),
  };
}

/** Retorna proximo numero RPS sequencial (por serie). Lock pessimista. */
async function proximoRps(tenant_id: number, serie: string): Promise<string> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(CAST(rps_numero AS UNSIGNED)), 0) AS atual
         FROM notas_fiscais
        WHERE tenant_id = ? AND rps_serie = ?
        FOR UPDATE`,
      [tenant_id, serie]
    );
    const proximo = Number(rows[0]?.atual || 0) + 1;
    await conn.commit();
    return String(proximo);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

export interface CriarNFInput {
  tenant_id?: number;
  resource_type?: string;
  resource_id?: string;
  recibo_id?: number;
  tipo?: TipoNF;
  // Tomador
  tomador_doc: string;
  tomador_nome: string;
  tomador_email?: string;
  tomador_endereco: {
    cep: string; logradouro: string; numero: string;
    complemento?: string; bairro: string;
    municipio: string; uf: string; codigo_municipio?: string;
  };
  // Servico
  valor_servico: number;
  codigo_servico: string;
  codigo_servico_federal?: string;
  descricao: string;
  iss_aliquota?: number;
  iss_retido?: boolean;
  emitida_por?: number;
}

export async function listarNotasFiscais(input: {
  tenant_id?: number;
  status?: StatusNF;
  resource_type?: string;
  resource_id?: string;
  limite?: number;
} = {}): Promise<NotaFiscal[]> {
  const tenant_id = input.tenant_id ?? 1;
  const limite = Math.min(Math.max(Number(input.limite) || 100, 1), 500);
  const params: (string | number)[] = [tenant_id];
  let sql = `SELECT * FROM notas_fiscais WHERE tenant_id = ?`;
  if (input.status) { sql += ' AND status = ?'; params.push(input.status); }
  if (input.resource_type) { sql += ' AND resource_type = ?'; params.push(input.resource_type); }
  if (input.resource_id) { sql += ' AND resource_id = ?'; params.push(input.resource_id); }
  sql += ` ORDER BY created_at DESC LIMIT ${limite}`;
  const [rows] = await pool.execute<NFRow[]>(sql, params);
  return rows.map(mapRow);
}

export async function buscarNotaFiscal(id: number | string): Promise<NotaFiscal> {
  const [rows] = await pool.execute<NFRow[]>(
    `SELECT * FROM notas_fiscais WHERE id = ?`, [Number(id)]
  );
  if (!rows.length) throw new Error('NF nao encontrada');
  return mapRow(rows[0]);
}

export async function buscarPorProviderId(provider_id: string): Promise<NotaFiscal | null> {
  if (!provider_id) return null;
  const [rows] = await pool.execute<NFRow[]>(
    `SELECT * FROM notas_fiscais WHERE provider_id = ? LIMIT 1`, [provider_id]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/** Cria rascunho de NF (sem enviar pro provider ainda). */
export async function criarRascunhoNF(input: CriarNFInput): Promise<NotaFiscal> {
  const tenant_id = input.tenant_id ?? 1;
  const cfg = await getFiscalConfig(tenant_id);
  if (!cfg) throw new Error('Configure os dados fiscais antes de emitir NF');

  const docNorm = input.tomador_doc.replace(/\D/g, '');
  if (docNorm.length !== 11 && docNorm.length !== 14) {
    throw new Error('CPF/CNPJ do tomador invalido');
  }

  const valor = Math.round(input.valor_servico * 100) / 100;
  const aliquota = input.iss_aliquota ?? cfg.iss_aliquota;
  const valor_iss = input.iss_retido
    ? Math.round(valor * aliquota / 100 * 100) / 100
    : 0;
  const valor_liquido = Math.round((valor - valor_iss) * 100) / 100;

  const rps_numero = await proximoRps(tenant_id, cfg.rps_serie);

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO notas_fiscais (
       tenant_id, rps_numero, rps_serie, tipo,
       resource_type, resource_id, recibo_id,
       tomador_doc, tomador_nome, tomador_email, tomador_endereco,
       valor_servico, valor_iss, valor_liquido,
       iss_aliquota, iss_retido,
       codigo_servico, descricao,
       provider, status, emitida_por
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'rascunho', ?)`,
    [
      tenant_id, rps_numero, cfg.rps_serie, input.tipo ?? 'nfse',
      input.resource_type ?? null, input.resource_id ?? null, input.recibo_id ?? null,
      docNorm, input.tomador_nome.trim().slice(0, 120),
      input.tomador_email?.trim() || null,
      JSON.stringify(input.tomador_endereco),
      valor, valor_iss, valor_liquido,
      aliquota, input.iss_retido ?? false,
      input.codigo_servico, input.descricao.trim(),
      cfg.provider, input.emitida_por ?? null,
    ]
  );

  await registrarEvento(r.insertId, 'created', { rps_numero });
  return await buscarNotaFiscal(r.insertId);
}

/** Envia NF pro provider e atualiza status. */
export async function enviarNFParaProvider(id: number | string): Promise<NotaFiscal> {
  const nf = await buscarNotaFiscal(id);
  if (nf.status !== 'rascunho' && nf.status !== 'rejeitada') {
    throw new Error(`NF ${nf.id} status ${nf.status} — nao pode reenviar`);
  }
  const cfg = await getFiscalConfig(nf.tenant_id);
  if (!cfg) throw new Error('config fiscal ausente');
  if (cfg.provider !== 'nfeio') {
    throw new Error(`provider ${cfg.provider} nao implementado nesta release`);
  }
  if (!cfg.provider_company_id) {
    throw new Error('provider_company_id nao configurado — cadastre a empresa no provider primeiro');
  }
  const apiKey = await getApiKey(nf.tenant_id);
  if (!apiKey) throw new Error('api_key NFe.io nao cadastrada');

  const end = nf.tomador_endereco as Record<string, string>;
  const payload: NfeioServiceInvoiceInput = {
    cityServiceCode: nf.codigo_servico,
    description: nf.descricao,
    servicesAmount: nf.valor_servico,
    rpsSerialNumber: nf.rps_serie,
    rpsNumber: nf.rps_numero,
    issRate: nf.iss_aliquota,
    borrower: {
      federalTaxNumber: nf.tomador_doc,
      name: nf.tomador_nome,
      email: nf.tomador_email ?? undefined,
      address: {
        country: 'BRA',
        postalCode: end.cep || '',
        street: end.logradouro || '',
        number: end.numero || 'S/N',
        additionalInformation: end.complemento || undefined,
        district: end.bairro || '',
        city: { code: end.codigo_municipio, name: end.municipio || '' },
        state: end.uf || '',
      },
    },
  };

  await pool.execute(
    `UPDATE notas_fiscais SET status = 'processando' WHERE id = ?`, [nf.id]
  );
  await registrarEvento(nf.id, 'sent_provider', { provider: 'nfeio' });

  const client = nfeioClient(apiKey);
  try {
    const result = await client.emitirNFSe(cfg.provider_company_id, payload);
    await pool.execute(
      `UPDATE notas_fiscais SET provider_id = ? WHERE id = ?`,
      [result.id, nf.id]
    );
    await registrarEvento(nf.id, 'provider_response', {
      provider_id: result.id, status: result.status,
    });
    return await buscarNotaFiscal(nf.id);
  } catch (err) {
    const msg = (err as Error).message;
    await pool.execute(
      `UPDATE notas_fiscais SET status = 'rejeitada', motivo_rejeicao = ? WHERE id = ?`,
      [msg.slice(0, 1000), nf.id]
    );
    await registrarEvento(nf.id, 'provider_error', { erro: msg });
    throw err;
  }
}

/** Aplica atualizacao recebida do webhook NFe.io. */
export async function aplicarAtualizacaoProvider(
  provider_id: string,
  data: {
    status?: string; number?: string; pdfUrl?: string; xmlUrl?: string;
    checkCode?: string; flowMessage?: string; issuedOn?: string; cancelledOn?: string;
  }
): Promise<NotaFiscal | null> {
  const nf = await buscarPorProviderId(provider_id);
  if (!nf) return null;

  // Mapeia status do NFe.io pro nosso enum
  const mapStatus: Record<string, StatusNF> = {
    Issued: 'autorizada',
    Cancelled: 'cancelada',
    Error: 'rejeitada',
  };
  const novoStatus: StatusNF | null = data.status ? mapStatus[data.status] || null : null;

  const fields: string[] = [];
  const params: (string | null)[] = [];
  if (novoStatus)              { fields.push('status = ?');             params.push(novoStatus); }
  if (data.number)             { fields.push('numero = ?');             params.push(data.number); }
  if (data.pdfUrl)             { fields.push('pdf_url = ?');            params.push(data.pdfUrl); }
  if (data.xmlUrl)             { fields.push('xml_url = ?');            params.push(data.xmlUrl); }
  if (data.checkCode)          { fields.push('codigo_verificacao = ?'); params.push(data.checkCode); }
  if (data.flowMessage && novoStatus === 'rejeitada') {
    fields.push('motivo_rejeicao = ?'); params.push(data.flowMessage.slice(0, 1000));
  }
  if (data.issuedOn && novoStatus === 'autorizada') {
    fields.push('emitida_em = ?'); params.push(data.issuedOn);
  }
  if (data.cancelledOn && novoStatus === 'cancelada') {
    fields.push('cancelada_em = ?'); params.push(data.cancelledOn);
  }

  if (fields.length === 0) return nf;
  params.push(String(nf.id));
  await pool.execute(
    `UPDATE notas_fiscais SET ${fields.join(', ')} WHERE id = ?`, params
  );
  await registrarEvento(nf.id, 'webhook_update', data);
  return await buscarNotaFiscal(nf.id);
}

export async function cancelarNotaFiscal(id: number | string, motivo: string): Promise<NotaFiscal> {
  const nf = await buscarNotaFiscal(id);
  if (nf.status === 'cancelada') return nf;
  if (nf.status !== 'autorizada') {
    throw new Error(`Nao pode cancelar — status ${nf.status}`);
  }
  const cfg = await getFiscalConfig(nf.tenant_id);
  if (!cfg || !nf.provider_id || !cfg.provider_company_id) {
    throw new Error('config provider ausente');
  }
  const apiKey = await getApiKey(nf.tenant_id);
  if (!apiKey) throw new Error('api_key ausente');
  const client = nfeioClient(apiKey);
  try {
    await client.cancelarNFSe(cfg.provider_company_id, nf.provider_id, motivo);
    await pool.execute(
      `UPDATE notas_fiscais SET status = 'cancelada', motivo_cancelamento = ?, cancelada_em = NOW()
        WHERE id = ?`,
      [motivo.slice(0, 1000), nf.id]
    );
    await registrarEvento(nf.id, 'cancelled', { motivo });
    return await buscarNotaFiscal(nf.id);
  } catch (err) {
    await registrarEvento(nf.id, 'cancel_error', { erro: (err as Error).message });
    throw err;
  }
}

async function registrarEvento(
  nf_id: number,
  event_type: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await pool.execute(
    `INSERT INTO notas_fiscais_eventos (nf_id, event_type, payload) VALUES (?, ?, ?)`,
    [nf_id, event_type.slice(0, 40), payload ? JSON.stringify(payload) : null]
  ).catch(err => console.warn('[nf:evento]', (err as Error).message));
}
