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

export interface AtualizarLaudoInput {
  tipo_lote_urbano?: TipoLoteUrbano | null;
  quadra?: string | null;
  numero_lote?: string | null;
  loteamento?: string | null;
  denominacao_imovel?: string | null;
  nirf?: string | null;
  ccir?: string | null;
  endereco_imovel?: string | null;
  municipio?: string | null;
  uf_imovel?: string | null;
  comarca?: string | null;
  confrontante_frente?: string | null;
  confrontante_lat_dir?: string | null;
  confrontante_lat_esq?: string | null;
  confrontante_fundo?: string | null;
  confrontante_extra?: string | null;
  usa_art?: boolean;
  numero_art?: string | null;
  usa_trt?: boolean;
  numero_trt?: string | null;
  valor_servico?: number | null;
  forma_pagamento?: FormaPagamentoLaudo | null;
  data_pagamento?: string | null;
  observacoes?: string | null;
}

export async function atualizarLaudo(id: number | string, input: AtualizarLaudoInput): Promise<Laudo> {
  const existente = await buscarLaudo(id);
  if (!existente) throw new Error('Laudo nao encontrado');

  const fields: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  const set = <T>(col: string, val: T | undefined) => {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      params.push(val as string | number | boolean | null);
    }
  };
  set('tipo_lote_urbano', input.tipo_lote_urbano);
  set('quadra', input.quadra);
  set('numero_lote', input.numero_lote);
  set('loteamento', input.loteamento);
  set('denominacao_imovel', input.denominacao_imovel);
  set('nirf', input.nirf);
  set('ccir', input.ccir);
  set('endereco_imovel', input.endereco_imovel);
  set('municipio', input.municipio);
  set('uf_imovel', input.uf_imovel);
  set('comarca', input.comarca);
  set('confrontante_frente', input.confrontante_frente);
  set('confrontante_lat_dir', input.confrontante_lat_dir);
  set('confrontante_lat_esq', input.confrontante_lat_esq);
  set('confrontante_fundo', input.confrontante_fundo);
  set('confrontante_extra', input.confrontante_extra);
  set('usa_art', input.usa_art);
  set('numero_art', input.numero_art);
  set('usa_trt', input.usa_trt);
  set('numero_trt', input.numero_trt);
  set('valor_servico', input.valor_servico);
  set('forma_pagamento', input.forma_pagamento);
  set('data_pagamento', input.data_pagamento);
  set('observacoes', input.observacoes);

  if (fields.length === 0) return existente;
  params.push(Number(id));
  await pool.execute(
    `UPDATE laudos_demarcacao SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  const updated = await buscarLaudo(id);
  if (!updated) throw new Error('Laudo sumiu apos update');
  return updated;
}

// ── v1.99.26: Fase 2 — Pontos (vertices) e calculos geodesicos ────────────

import {
  utmParaGeo, geoParaUtm, decimalParaGMS, areaGauss, perimetro,
  calcularLados, detectarZonaUtm,
} from '../services/geometria';

export interface PontoLaudo {
  id?: number;
  laudo_id?: number;
  ordem: number;
  rotulo: string;
  utm_zona: number | null;
  utm_hemisferio: 'N' | 'S' | null;
  utm_e: number | null;
  utm_n: number | null;
  lat_decimal: number | null;
  long_decimal: number | null;
  lat_gms: string | null;
  long_gms: string | null;
  altitude: number | null;
  descricao_marco: string | null;
}

interface PontoRow extends RowDataPacket {
  id: number; laudo_id: number; ordem: number; rotulo: string;
  utm_zona: string | null; utm_hemisferio: 'N' | 'S' | null;
  utm_e: string | number | null; utm_n: string | number | null;
  lat_decimal: string | number | null; long_decimal: string | number | null;
  lat_gms: string | null; long_gms: string | null;
  altitude: string | number | null; descricao_marco: string | null;
}

function mapPontoRow(r: PontoRow): PontoLaudo {
  return {
    id: Number(r.id),
    laudo_id: Number(r.laudo_id),
    ordem: Number(r.ordem),
    rotulo: String(r.rotulo),
    utm_zona: r.utm_zona ? Number(r.utm_zona) : null,
    utm_hemisferio: r.utm_hemisferio ?? null,
    utm_e: asNum(r.utm_e),
    utm_n: asNum(r.utm_n),
    lat_decimal: asNum(r.lat_decimal),
    long_decimal: asNum(r.long_decimal),
    lat_gms: r.lat_gms ?? null,
    long_gms: r.long_gms ?? null,
    altitude: asNum(r.altitude),
    descricao_marco: r.descricao_marco ?? null,
  };
}

export async function listarPontosDoLaudo(laudoId: number | string): Promise<PontoLaudo[]> {
  const [rows] = await pool.execute<PontoRow[]>(
    'SELECT * FROM laudos_demarcacao_pontos WHERE laudo_id = ? ORDER BY ordem ASC',
    [Number(laudoId)]
  );
  return rows.map(mapPontoRow);
}

/**
 * Substitui TODOS os pontos do laudo (delete + insert em transacao).
 * Cada ponto pode ter UTM, Geo, ou ambos. Sistema completa o que faltar.
 * Default zona UTM: 23S (Acailandia/MA) se nao informado mas tem Geo.
 */
export async function salvarPontosDoLaudo(
  laudoId: number | string,
  pontos: Array<Omit<PontoLaudo, 'id' | 'laudo_id'>>,
  defaultZona: number = 23,
  defaultHemisferio: 'N' | 'S' = 'S'
): Promise<{ pontos: PontoLaudo[]; area_m2: number; perimetro_m: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Limpa lados/pontos antigos
    await conn.execute('DELETE FROM laudos_demarcacao_lados WHERE laudo_id = ?', [Number(laudoId)]);
    await conn.execute('DELETE FROM laudos_demarcacao_pontos WHERE laudo_id = ?', [Number(laudoId)]);

    // Auto-completa UTM↔Geo + GMS
    const pontosCompletos = pontos.map((p, idx) => {
      const ordem = p.ordem ?? (idx + 1);
      const rotulo = p.rotulo || `V${ordem}`;
      let utmZona = p.utm_zona;
      let utmHemisferio = p.utm_hemisferio;
      let utmE = p.utm_e;
      let utmN = p.utm_n;
      let lat = p.lat_decimal;
      let lng = p.long_decimal;
      let latGms = p.lat_gms;
      let longGms = p.long_gms;

      // Se tem UTM mas falta Geo
      if (utmE != null && utmN != null && utmZona && utmHemisferio && (lat == null || lng == null)) {
        try {
          const geo = utmParaGeo({ e: utmE, n: utmN, zona: utmZona, hemisferio: utmHemisferio });
          lat = geo.lat;
          lng = geo.lng;
        } catch (err) {
          console.warn('[laudos:utm→geo]', (err as Error).message);
        }
      }
      // Se tem Geo mas falta UTM
      if (lat != null && lng != null && (utmE == null || utmN == null)) {
        const zona = utmZona ?? detectarZonaUtm(lng);
        const hem = utmHemisferio ?? (lat >= 0 ? 'N' : 'S');
        try {
          const utm = geoParaUtm({ lat, lng, zona, hemisferio: hem });
          utmE = utm.e;
          utmN = utm.n;
          utmZona = zona;
          utmHemisferio = hem;
        } catch (err) {
          console.warn('[laudos:geo→utm]', (err as Error).message);
        }
      }
      // Default zona/hemisferio se ainda nao tem
      if (utmE != null && utmN != null && (!utmZona || !utmHemisferio)) {
        utmZona = utmZona ?? defaultZona;
        utmHemisferio = utmHemisferio ?? defaultHemisferio;
      }
      // GMS se tem decimal
      if (lat != null && !latGms) latGms = decimalParaGMS(lat, true);
      if (lng != null && !longGms) longGms = decimalParaGMS(lng, false);

      return {
        ordem, rotulo,
        utm_zona: utmZona, utm_hemisferio: utmHemisferio,
        utm_e: utmE, utm_n: utmN,
        lat_decimal: lat, long_decimal: lng,
        lat_gms: latGms, long_gms: longGms,
        altitude: p.altitude ?? null,
        descricao_marco: p.descricao_marco ?? null,
      };
    });

    // Insere pontos
    const idsInseridos: number[] = [];
    for (const p of pontosCompletos) {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO laudos_demarcacao_pontos
          (laudo_id, ordem, rotulo, utm_zona, utm_hemisferio, utm_e, utm_n,
           lat_decimal, long_decimal, lat_gms, long_gms, altitude, descricao_marco)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [Number(laudoId), p.ordem, p.rotulo,
         p.utm_zona, p.utm_hemisferio, p.utm_e, p.utm_n,
         p.lat_decimal, p.long_decimal, p.lat_gms, p.long_gms,
         p.altitude, p.descricao_marco]
      );
      idsInseridos.push(r.insertId);
    }

    // Calcula area/perimetro/lados se temos UTM em todos
    const pontosUtm = pontosCompletos
      .filter(p => p.utm_e != null && p.utm_n != null)
      .map(p => ({ e: p.utm_e as number, n: p.utm_n as number }));

    let areaTotal = 0;
    let perimTotal = 0;
    if (pontosUtm.length >= 3 && pontosUtm.length === pontosCompletos.length) {
      areaTotal = areaGauss(pontosUtm);
      perimTotal = perimetro(pontosUtm);
      const lados = calcularLados(pontosUtm);
      for (const l of lados) {
        await conn.execute<ResultSetHeader>(
          `INSERT INTO laudos_demarcacao_lados
            (laudo_id, ordem, ponto_inicio_id, ponto_fim_id, rotulo, distancia_m, azimute)
           VALUES (?,?,?,?,?,?,?)`,
          [Number(laudoId), l.ordem,
           idsInseridos[l.i_idx], idsInseridos[l.f_idx],
           `${pontosCompletos[l.i_idx].rotulo}-${pontosCompletos[l.f_idx].rotulo}`,
           l.distancia_m, l.azimute]
        );
      }
    }

    // Atualiza laudo com area + perimetro
    await conn.execute(
      'UPDATE laudos_demarcacao SET area_total_m2 = ?, perimetro_m = ?, status = IF(status=\'RASCUNHO\', \'PREENCHIDO\', status) WHERE id = ?',
      [areaTotal || null, perimTotal || null, Number(laudoId)]
    );

    await conn.commit();

    const pontosFinais = await listarPontosDoLaudo(laudoId);
    return { pontos: pontosFinais, area_m2: areaTotal, perimetro_m: perimTotal };
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

// Lados (calculados a partir dos pontos)
export interface LadoLaudo {
  id: number; laudo_id: number; ordem: number;
  ponto_inicio_id: number; ponto_fim_id: number;
  rotulo: string | null; distancia_m: number | null; azimute: number | null;
}

interface LadoRow extends RowDataPacket {
  id: number; laudo_id: number; ordem: number;
  ponto_inicio_id: number; ponto_fim_id: number;
  rotulo: string | null; distancia_m: string | number | null; azimute: string | number | null;
}

export async function listarLadosDoLaudo(laudoId: number | string): Promise<LadoLaudo[]> {
  const [rows] = await pool.execute<LadoRow[]>(
    'SELECT * FROM laudos_demarcacao_lados WHERE laudo_id = ? ORDER BY ordem ASC',
    [Number(laudoId)]
  );
  return rows.map(r => ({
    id: Number(r.id), laudo_id: Number(r.laudo_id), ordem: Number(r.ordem),
    ponto_inicio_id: Number(r.ponto_inicio_id), ponto_fim_id: Number(r.ponto_fim_id),
    rotulo: r.rotulo ?? null,
    distancia_m: asNum(r.distancia_m), azimute: asNum(r.azimute),
  }));
}

// ── v1.99.27: Fase 3 — Croqui SVG / Upload + Relatorio Fotografico ────────

import { gerarCroquiSvg } from '../services/croquiSvg';

/**
 * Gera SVG do croqui a partir dos pontos UTM. Nao persiste (gera on-the-fly).
 * Quando user prefere croqui manual, sobrepoe via salvarCroquiUpload().
 */
export async function gerarCroquiAutoSvg(laudoId: number | string): Promise<string> {
  const pontos = await listarPontosDoLaudo(laudoId);
  const lados = await listarLadosDoLaudo(laudoId);
  const pontosSvg = pontos
    .filter(p => p.utm_e != null && p.utm_n != null)
    .map(p => ({ rotulo: p.rotulo, e: p.utm_e as number, n: p.utm_n as number }));
  const ladosSvg = lados.map(l => ({
    i_idx: pontos.findIndex(p => p.id === l.ponto_inicio_id),
    f_idx: pontos.findIndex(p => p.id === l.ponto_fim_id),
    distancia_m: l.distancia_m ?? 0,
  }));
  return gerarCroquiSvg(pontosSvg, ladosSvg);
}

/** Salva croqui manual (upload imagem PNG/JPG/PDF base64). */
export async function salvarCroquiUpload(
  laudoId: number | string,
  base64: string,
  mime: string
): Promise<void> {
  if (!base64) throw new Error('Conteudo base64 vazio');
  if (!/^image\/(png|jpe?g)$|^application\/pdf$/i.test(mime)) {
    throw new Error('Mime deve ser image/png, image/jpeg ou application/pdf');
  }
  await pool.execute(
    `UPDATE laudos_demarcacao
       SET croqui_tipo = 'UPLOAD', croqui_b64 = ?, croqui_mime = ?
     WHERE id = ?`,
    [base64, mime, Number(laudoId)]
  );
}

export async function resetarCroquiAuto(laudoId: number | string): Promise<void> {
  await pool.execute(
    `UPDATE laudos_demarcacao
       SET croqui_tipo = 'AUTO_SVG', croqui_b64 = NULL, croqui_mime = NULL
     WHERE id = ?`,
    [Number(laudoId)]
  );
}

export async function getCroquiUpload(laudoId: number | string): Promise<{
  mime: string; base64: string;
} | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT croqui_b64, croqui_mime FROM laudos_demarcacao WHERE id = ? AND croqui_tipo = "UPLOAD" LIMIT 1',
    [Number(laudoId)]
  );
  if (!rows.length || !rows[0].croqui_b64) return null;
  return {
    mime: String(rows[0].croqui_mime || 'image/png'),
    base64: String(rows[0].croqui_b64),
  };
}

// FOTOS — relatorio fotografico
export interface FotoLaudo {
  id: number;
  laudo_id: number;
  ponto_id: number | null;
  ordem: number | null;
  mime: string;
  legenda: string | null;
  created_at: string;
}

interface FotoRow extends RowDataPacket {
  id: number; laudo_id: number; ponto_id: number | null;
  ordem: number | null; mime: string; conteudo_b64: string;
  legenda: string | null; created_at: Date | string;
}

export async function listarFotosDoLaudo(laudoId: number | string): Promise<FotoLaudo[]> {
  // Lista metadados sem o LONGTEXT (pra payload pequeno)
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, laudo_id, ponto_id, ordem, mime, legenda, created_at
       FROM laudos_demarcacao_fotos
      WHERE laudo_id = ?
      ORDER BY ordem ASC, id ASC`,
    [Number(laudoId)]
  );
  return rows.map(r => ({
    id: Number(r.id),
    laudo_id: Number(r.laudo_id),
    ponto_id: r.ponto_id != null ? Number(r.ponto_id) : null,
    ordem: r.ordem != null ? Number(r.ordem) : null,
    mime: String(r.mime),
    legenda: r.legenda ?? null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function getFotoConteudo(fotoId: number | string): Promise<{
  mime: string; base64: string; legenda: string | null;
} | null> {
  const [rows] = await pool.execute<FotoRow[]>(
    'SELECT mime, conteudo_b64, legenda FROM laudos_demarcacao_fotos WHERE id = ? LIMIT 1',
    [Number(fotoId)]
  );
  if (!rows.length) return null;
  return {
    mime: String(rows[0].mime),
    base64: String(rows[0].conteudo_b64),
    legenda: rows[0].legenda ?? null,
  };
}

export interface AdicionarFotoInput {
  laudo_id: number;
  ponto_id?: number | null;
  ordem?: number | null;
  mime: string;
  conteudo_b64: string;
  legenda?: string | null;
}

export async function adicionarFotoLaudo(input: AdicionarFotoInput): Promise<FotoLaudo> {
  if (!input.conteudo_b64) throw new Error('conteudo_b64 obrigatorio');
  if (!/^image\//.test(input.mime || '')) throw new Error('mime deve ser image/*');

  // Auto-determina ordem (proxima)
  let ordem = input.ordem;
  if (ordem == null) {
    const [maxRows] = await pool.execute<RowDataPacket[]>(
      'SELECT COALESCE(MAX(ordem), 0) AS max_ordem FROM laudos_demarcacao_fotos WHERE laudo_id = ?',
      [input.laudo_id]
    );
    ordem = Number(maxRows[0]?.max_ordem ?? 0) + 1;
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO laudos_demarcacao_fotos
      (laudo_id, ponto_id, ordem, mime, conteudo_b64, legenda)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.laudo_id, input.ponto_id ?? null, ordem, input.mime, input.conteudo_b64, input.legenda ?? null]
  );
  const fotos = await listarFotosDoLaudo(input.laudo_id);
  const criada = fotos.find(f => f.id === r.insertId);
  if (!criada) throw new Error('Falha ao adicionar foto');
  return criada;
}

export async function removerFotoLaudo(fotoId: number | string): Promise<void> {
  await pool.execute('DELETE FROM laudos_demarcacao_fotos WHERE id = ?', [Number(fotoId)]);
}

export async function atualizarLegendaFoto(fotoId: number | string, legenda: string): Promise<void> {
  await pool.execute(
    'UPDATE laudos_demarcacao_fotos SET legenda = ? WHERE id = ?',
    [legenda, Number(fotoId)]
  );
}
