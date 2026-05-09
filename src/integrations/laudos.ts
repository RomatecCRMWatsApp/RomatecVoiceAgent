// v1.99.25 — Fase 1: Laudos de Demarcacao (stubs basicos).
// Funcoes plenas (vertices, calculos, PDF, assinatura, Z-API) virao
// nas Fases 2-7.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import crypto from 'crypto';

export type TipoImovel = 'URBANO' | 'RURAL';
export type TipoLoteUrbano = 'MEIO_QUADRA' | 'ESQUINA';
export type StatusLaudo =
  | 'RASCUNHO' | 'PREENCHIDO' | 'ASSINADO' | 'RECIBO_GERADO'
  | 'ENVIADO' | 'CONFIRMADO' | 'CANCELADO';
export type FormaPagamentoLaudo = 'PIX' | 'DINHEIRO' | 'TRANSFERENCIA' | 'BOLETO';
export type CroquiTipo = 'AUTO_SVG' | 'UPLOAD';

export interface Laudo {
  id: number;
  numero_laudo: string;
  contratante_id: number;
  executante_id: number;
  tipo_imovel: TipoImovel;
  tipo_lote_urbano: TipoLoteUrbano | null;
  quadra: string | null;
  numero_lote: string | null;
  loteamento: string | null;
  denominacao_imovel: string | null;
  nirf: string | null;
  ccir: string | null;
  endereco_imovel: string | null;
  municipio: string | null;
  uf_imovel: string | null;
  comarca: string | null;
  confrontante_frente: string | null;
  confrontante_lat_dir: string | null;
  confrontante_lat_esq: string | null;
  confrontante_fundo: string | null;
  confrontante_extra: string | null;
  area_total_m2: number | null;
  perimetro_m: number | null;
  croqui_tipo: CroquiTipo;
  escala: string | null;
  usa_art: boolean;
  numero_art: string | null;
  usa_trt: boolean;
  numero_trt: string | null;
  valor_servico: number | null;
  forma_pagamento: FormaPagamentoLaudo | null;
  data_pagamento: string | null;
  recibo_id: number | null;
  hash_validacao: string | null;
  token_uuid: string | null;
  assinado_em: string | null;
  zapi_message_id: string | null;
  zapi_enviado_em: string | null;
  zapi_confirmado_em: string | null;
  status: StatusLaudo;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

interface LaudoRow extends RowDataPacket {
  id: number;
  numero_laudo: string;
  contratante_id: number;
  executante_id: number;
  tipo_imovel: TipoImovel;
  tipo_lote_urbano: TipoLoteUrbano | null;
  quadra: string | null;
  numero_lote: string | null;
  loteamento: string | null;
  denominacao_imovel: string | null;
  nirf: string | null;
  ccir: string | null;
  endereco_imovel: string | null;
  municipio: string | null;
  uf_imovel: string | null;
  comarca: string | null;
  confrontante_frente: string | null;
  confrontante_lat_dir: string | null;
  confrontante_lat_esq: string | null;
  confrontante_fundo: string | null;
  confrontante_extra: string | null;
  area_total_m2: string | number | null;
  perimetro_m: string | number | null;
  croqui_tipo: CroquiTipo;
  croqui_path: string | null;
  escala: string | null;
  usa_art: 0 | 1;
  numero_art: string | null;
  usa_trt: 0 | 1;
  numero_trt: string | null;
  valor_servico: string | number | null;
  forma_pagamento: FormaPagamentoLaudo | null;
  data_pagamento: Date | string | null;
  recibo_id: number | null;
  hash_validacao: string | null;
  token_uuid: string | null;
  assinado_em: Date | string | null;
  zapi_message_id: string | null;
  zapi_enviado_em: Date | string | null;
  zapi_confirmado_em: Date | string | null;
  status: StatusLaudo;
  observacoes: string | null;
  ativo: 0 | 1;
  created_at: Date | string;
  updated_at: Date | string;
}

function asISO(v: Date | string | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function asNum(v: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(r: LaudoRow): Laudo {
  return {
    id: Number(r.id),
    numero_laudo: String(r.numero_laudo),
    contratante_id: Number(r.contratante_id),
    executante_id: Number(r.executante_id),
    tipo_imovel: r.tipo_imovel,
    tipo_lote_urbano: r.tipo_lote_urbano ?? null,
    quadra: r.quadra ?? null,
    numero_lote: r.numero_lote ?? null,
    loteamento: r.loteamento ?? null,
    denominacao_imovel: r.denominacao_imovel ?? null,
    nirf: r.nirf ?? null,
    ccir: r.ccir ?? null,
    endereco_imovel: r.endereco_imovel ?? null,
    municipio: r.municipio ?? null,
    uf_imovel: r.uf_imovel ?? null,
    comarca: r.comarca ?? null,
    confrontante_frente: r.confrontante_frente ?? null,
    confrontante_lat_dir: r.confrontante_lat_dir ?? null,
    confrontante_lat_esq: r.confrontante_lat_esq ?? null,
    confrontante_fundo: r.confrontante_fundo ?? null,
    confrontante_extra: r.confrontante_extra ?? null,
    area_total_m2: asNum(r.area_total_m2),
    perimetro_m: asNum(r.perimetro_m),
    croqui_tipo: r.croqui_tipo,
    escala: r.escala ?? null,
    usa_art: r.usa_art === 1,
    numero_art: r.numero_art ?? null,
    usa_trt: r.usa_trt === 1,
    numero_trt: r.numero_trt ?? null,
    valor_servico: asNum(r.valor_servico),
    forma_pagamento: r.forma_pagamento ?? null,
    data_pagamento: r.data_pagamento
      ? (r.data_pagamento instanceof Date
          ? r.data_pagamento.toISOString().slice(0, 10)
          : String(r.data_pagamento).slice(0, 10))
      : null,
    recibo_id: r.recibo_id != null ? Number(r.recibo_id) : null,
    hash_validacao: r.hash_validacao ?? null,
    token_uuid: r.token_uuid ?? null,
    assinado_em: asISO(r.assinado_em),
    zapi_message_id: r.zapi_message_id ?? null,
    zapi_enviado_em: asISO(r.zapi_enviado_em),
    zapi_confirmado_em: asISO(r.zapi_confirmado_em),
    status: r.status,
    observacoes: r.observacoes ?? null,
    ativo: r.ativo === 1,
    created_at: asISO(r.created_at) ?? '',
    updated_at: asISO(r.updated_at) ?? '',
  };
}

/**
 * Gera proximo numero de laudo no formato LAUDO-YYYY-NNNN com lock pessimista
 * pra evitar duplicacao em chamadas concorrentes.
 */
async function gerarNumeroLaudo(): Promise<string> {
  const ano = new Date().getFullYear();
  const prefix = `LAUDO-${ano}-`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT numero_laudo FROM laudos_demarcacao
        WHERE numero_laudo LIKE ?
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [`${prefix}%`]
    );
    let proximo = 1;
    if (rows.length > 0) {
      const ultimo = String(rows[0].numero_laudo);
      const match = ultimo.match(/-(\d+)$/);
      if (match) proximo = Number(match[1]) + 1;
    }
    await conn.commit();
    return `${prefix}${String(proximo).padStart(4, '0')}`;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

export interface CriarLaudoRascunhoInput {
  contratante_id: number;
  executante_id?: number; // default: 1 (Ronicley)
  tipo_imovel: TipoImovel;
  observacoes?: string | null;
}

export async function criarLaudoRascunho(input: CriarLaudoRascunhoInput): Promise<Laudo> {
  if (!input.contratante_id) throw new Error('contratante_id obrigatorio');
  if (!['URBANO', 'RURAL'].includes(input.tipo_imovel)) {
    throw new Error("tipo_imovel deve ser 'URBANO' ou 'RURAL'");
  }
  const executanteId = input.executante_id ?? 1; // default Ronicley

  // Valida FKs antes de inserir
  const [contratantes] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM contratantes WHERE id = ? LIMIT 1', [input.contratante_id]
  );
  if (!contratantes.length) throw new Error('Contratante nao encontrado');
  const [execs] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM executantes WHERE id = ? AND ativo = TRUE LIMIT 1', [executanteId]
  );
  if (!execs.length) throw new Error('Executante nao encontrado ou inativo');

  const numero = await gerarNumeroLaudo();
  const tokenUuid = crypto.randomUUID();
  const hashValidacao = crypto.randomBytes(32).toString('hex');

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO laudos_demarcacao
      (numero_laudo, contratante_id, executante_id, tipo_imovel,
       token_uuid, hash_validacao, status, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, 'RASCUNHO', ?)`,
    [numero, input.contratante_id, executanteId, input.tipo_imovel,
     tokenUuid, hashValidacao, input.observacoes ?? null]
  );

  const created = await buscarLaudo(r.insertId);
  if (!created) throw new Error('Falha ao criar laudo');
  return created;
}

export interface ListarLaudosInput {
  status?: StatusLaudo;
  contratante_id?: number;
  apenas_ativos?: boolean;
  limit?: number;
  offset?: number;
}

export async function listarLaudos(input: ListarLaudosInput = {}): Promise<{
  items: Laudo[];
  total: number;
}> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (input.apenas_ativos !== false) where.push('ativo = TRUE');
  if (input.status) { where.push('status = ?'); params.push(input.status); }
  if (input.contratante_id) { where.push('contratante_id = ?'); params.push(input.contratante_id); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
  const offset = Math.max(Number(input.offset) || 0, 0);

  const [items] = await pool.execute<LaudoRow[]>(
    `SELECT * FROM laudos_demarcacao ${whereSql} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM laudos_demarcacao ${whereSql}`,
    params
  );
  return {
    items: items.map(mapRow),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function buscarLaudo(id: number | string): Promise<Laudo | null> {
  const [rows] = await pool.execute<LaudoRow[]>(
    'SELECT * FROM laudos_demarcacao WHERE id = ? LIMIT 1', [Number(id)]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export async function buscarLaudoPorHash(hash: string): Promise<Laudo | null> {
  const [rows] = await pool.execute<LaudoRow[]>(
    'SELECT * FROM laudos_demarcacao WHERE hash_validacao = ? LIMIT 1', [hash]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export async function desativarLaudo(id: number | string): Promise<void> {
  await pool.execute(
    'UPDATE laudos_demarcacao SET ativo = FALSE, status = "CANCELADO" WHERE id = ?',
    [Number(id)]
  );
}
