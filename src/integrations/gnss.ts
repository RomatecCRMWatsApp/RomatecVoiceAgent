// v3.18.0: Modulo de dominio para processamento GNSS (RINEX -> IBGE-PPP).
// Segue o mesmo padrao de src/integrations/laudos.ts:
//   - Interface publica (ProcessamentoGnss / ArquivoGnss)
//   - Interface *Row interna estendendo RowDataPacket
//   - map*Row para coercoes mysql2 -> TS
//   - Funcoes CRUD exportadas

import pool from '../database/connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import crypto from 'crypto';

export type GnssStatus =
  | 'rinex_carregado'
  | 'aguardando_submissao_ibge'
  | 'aguardando_retorno_ibge'
  | 'processado'
  | 'erro'
  | 'cancelado';

export type GnssFonte = 'rinex_ibge' | 'ppp_manual' | 'rtk_csv' | 'outro';

export type GnssArquivoPapel =
  | 'rinex_obs' | 'rinex_nav_gps' | 'rinex_nav_glo' | 'rinex_nav_gal' | 'rinex_nav_bds'
  | 'rinex_rnx3' | 'ibge_zip_envio' | 'ibge_zip_retorno' | 'ibge_pdf' | 'ibge_txt'
  | 'ibge_kml' | 'ibge_pos' | 'ppp_externo_pdf' | 'ppp_externo_kml' | 'ppp_externo_pos'
  | 'rtk_csv' | 'outro';

export interface ProcessamentoGnss {
  id?: number;
  laudo_id: number | null;
  ponto_id: number | null;
  rotulo: string;
  status: GnssStatus;
  fonte: GnssFonte;
  inicio_rastreio: Date | null;
  fim_rastreio: Date | null;
  duracao_segundos: number | null;
  intervalo_amostragem_s: number | null;
  num_epocas: number | null;
  receptor_modelo: string | null;
  receptor_serial: string | null;
  antena_modelo: string | null;
  antena_altura_m: number | null;
  sistemas_gnss: string | null;
  ref_geodesico: string | null;
  latitude_graus: number | null;
  longitude_graus: number | null;
  altitude_geometrica_m: number | null;
  altitude_ortometrica_m: number | null;
  modelo_geoidal: string | null;
  utm_norte_m: number | null;
  utm_leste_m: number | null;
  utm_zona: number | null;
  utm_hemisferio: 'N' | 'S' | null;
  utm_mc: number | null;
  sigma_lat_m: number | null;
  sigma_lon_m: number | null;
  sigma_alt_m: number | null;
  pdop_medio: number | null;
  observacoes: string | null;
  created_at?: Date;
  updated_at?: Date;
  processado_at?: Date | null;
}

export interface ArquivoGnss {
  id?: number;
  processamento_id: number;
  papel: GnssArquivoPapel;
  nome_original: string;
  nome_armazenado: string;
  tamanho_bytes: number;
  mime_type: string;
  sha256: string;
  // conteudo_blob: NUNCA exposto via API (Buffer somente no servidor)
  ativo: boolean;
  created_at?: Date;
}

interface ProcRow extends RowDataPacket {
  id: number;
  // demais campos identicos ao schema; mysql2 retorna numericos como string em DECIMAL/BIGINT
  [k: string]: unknown;
}

const asNum = (v: unknown): number | null =>
  v == null ? null : (typeof v === 'number' ? v : Number(v));

function mapProcRow(r: ProcRow): ProcessamentoGnss {
  return {
    id: Number(r.id),
    laudo_id: r.laudo_id != null ? Number(r.laudo_id) : null,
    ponto_id: r.ponto_id != null ? Number(r.ponto_id) : null,
    rotulo: String(r.rotulo),
    status: r.status as GnssStatus,
    fonte: r.fonte as GnssFonte,
    inicio_rastreio: r.inicio_rastreio ? new Date(r.inicio_rastreio as string) : null,
    fim_rastreio: r.fim_rastreio ? new Date(r.fim_rastreio as string) : null,
    duracao_segundos: asNum(r.duracao_segundos),
    intervalo_amostragem_s: asNum(r.intervalo_amostragem_s),
    num_epocas: asNum(r.num_epocas),
    receptor_modelo: (r.receptor_modelo as string) ?? null,
    receptor_serial: (r.receptor_serial as string) ?? null,
    antena_modelo: (r.antena_modelo as string) ?? null,
    antena_altura_m: asNum(r.antena_altura_m),
    sistemas_gnss: (r.sistemas_gnss as string) ?? null,
    ref_geodesico: (r.ref_geodesico as string) ?? null,
    latitude_graus: asNum(r.latitude_graus),
    longitude_graus: asNum(r.longitude_graus),
    altitude_geometrica_m: asNum(r.altitude_geometrica_m),
    altitude_ortometrica_m: asNum(r.altitude_ortometrica_m),
    modelo_geoidal: (r.modelo_geoidal as string) ?? null,
    utm_norte_m: asNum(r.utm_norte_m),
    utm_leste_m: asNum(r.utm_leste_m),
    utm_zona: asNum(r.utm_zona),
    utm_hemisferio: (r.utm_hemisferio as 'N' | 'S' | null) ?? null,
    utm_mc: asNum(r.utm_mc),
    sigma_lat_m: asNum(r.sigma_lat_m),
    sigma_lon_m: asNum(r.sigma_lon_m),
    sigma_alt_m: asNum(r.sigma_alt_m),
    pdop_medio: asNum(r.pdop_medio),
    observacoes: (r.observacoes as string) ?? null,
    created_at: r.created_at ? new Date(r.created_at as string) : undefined,
    updated_at: r.updated_at ? new Date(r.updated_at as string) : undefined,
    processado_at: r.processado_at ? new Date(r.processado_at as string) : null,
  };
}

export function calcularSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sanitizarNome(nome: string): string {
  return nome
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200);
}

export async function criarProcessamento(p: Pick<ProcessamentoGnss,
  'laudo_id' | 'rotulo' | 'fonte'
> & Partial<ProcessamentoGnss>): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO processamentos_gnss (laudo_id, rotulo, status, fonte) VALUES (?, ?, ?, ?)`,
    [p.laudo_id ?? null, p.rotulo, p.status ?? 'rinex_carregado', p.fonte]
  );
  return res.insertId;
}

export async function obterProcessamento(id: number): Promise<ProcessamentoGnss | null> {
  const [rows] = await pool.execute<ProcRow[]>(
    `SELECT * FROM processamentos_gnss WHERE id = ?`, [id]
  );
  return rows.length ? mapProcRow(rows[0]) : null;
}

export async function listarProcessamentos(opts: {
  laudo_id?: number; status?: GnssStatus; limit?: number; offset?: number;
}): Promise<ProcessamentoGnss[]> {
  const where: string[] = [];
  const params: (number | string)[] = [];
  if (opts.laudo_id != null) { where.push('laudo_id = ?'); params.push(opts.laudo_id); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  const sql = `SELECT * FROM processamentos_gnss
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ${Number(opts.limit ?? 50)} OFFSET ${Number(opts.offset ?? 0)}`;
  const [rows] = await pool.execute<ProcRow[]>(sql, params);
  return rows.map(mapProcRow);
}

export async function atualizarProcessamento(
  id: number, patch: Partial<ProcessamentoGnss>
): Promise<void> {
  const colunas = [
    'laudo_id','ponto_id','rotulo','status','fonte','inicio_rastreio','fim_rastreio',
    'duracao_segundos','intervalo_amostragem_s','num_epocas','receptor_modelo',
    'receptor_serial','antena_modelo','antena_altura_m','sistemas_gnss','ref_geodesico',
    'latitude_graus','longitude_graus','altitude_geometrica_m','altitude_ortometrica_m',
    'modelo_geoidal','utm_norte_m','utm_leste_m','utm_zona','utm_hemisferio','utm_mc',
    'sigma_lat_m','sigma_lon_m','sigma_alt_m','pdop_medio','observacoes','processado_at',
  ] as const;
  const sets: string[] = [];
  const vals: (string | number | null | Date | boolean)[] = [];
  for (const c of colunas) {
    if (c in patch) {
      sets.push(`${c} = ?`);
      const val = (patch as Record<string, unknown>)[c];
      vals.push(val === undefined ? null : (val as string | number | null | Date | boolean));
    }
  }
  if (!sets.length) return;
  vals.push(id);
  await pool.execute(
    `UPDATE processamentos_gnss SET ${sets.join(', ')} WHERE id = ?`, vals
  );
}

export async function inserirArquivo(a: Omit<ArquivoGnss, 'id' | 'created_at' | 'ativo'> & {
  conteudo: Buffer;
}): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO processamentos_gnss_arquivos
       (processamento_id, papel, nome_original, nome_armazenado, tamanho_bytes,
        mime_type, sha256, conteudo_blob)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.processamento_id, a.papel, a.nome_original, a.nome_armazenado,
     a.tamanho_bytes, a.mime_type, a.sha256, a.conteudo]
  );
  return res.insertId;
}

export async function listarArquivos(
  processamentoId: number, opts: { papel?: GnssArquivoPapel; soAtivos?: boolean } = {}
): Promise<ArquivoGnss[]> {
  const where = ['processamento_id = ?'];
  const params: (number | string)[] = [processamentoId];
  if (opts.papel) { where.push('papel = ?'); params.push(opts.papel); }
  if (opts.soAtivos !== false) { where.push('ativo = TRUE'); }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, processamento_id, papel, nome_original, nome_armazenado, tamanho_bytes,
            mime_type, sha256, ativo, created_at
       FROM processamentos_gnss_arquivos
      WHERE ${where.join(' AND ')}
      ORDER BY id ASC`, params
  );
  return rows.map((r): ArquivoGnss => ({
    id: Number(r.id),
    processamento_id: Number(r.processamento_id),
    papel: r.papel as GnssArquivoPapel,
    nome_original: String(r.nome_original),
    nome_armazenado: String(r.nome_armazenado),
    tamanho_bytes: Number(r.tamanho_bytes),
    mime_type: String(r.mime_type),
    sha256: String(r.sha256),
    ativo: Boolean(r.ativo),
    created_at: r.created_at ? new Date(r.created_at) : undefined,
  }));
}

export async function obterConteudoArquivo(arquivoId: number): Promise<{
  meta: ArquivoGnss; conteudo: Buffer;
} | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM processamentos_gnss_arquivos WHERE id = ?`, [arquivoId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    meta: {
      id: Number(r.id),
      processamento_id: Number(r.processamento_id),
      papel: r.papel as GnssArquivoPapel,
      nome_original: String(r.nome_original),
      nome_armazenado: String(r.nome_armazenado),
      tamanho_bytes: Number(r.tamanho_bytes),
      mime_type: String(r.mime_type),
      sha256: String(r.sha256),
      ativo: Boolean(r.ativo),
      created_at: r.created_at ? new Date(r.created_at) : undefined,
    },
    conteudo: r.conteudo_blob as Buffer,
  };
}

export async function inativarArquivo(arquivoId: number): Promise<void> {
  await pool.execute(
    `UPDATE processamentos_gnss_arquivos SET ativo = FALSE WHERE id = ?`, [arquivoId]
  );
}
