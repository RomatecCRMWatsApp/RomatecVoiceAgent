// v1.99.25 — Fase 1: Laudos de Demarcacao (stubs basicos).
// Funcoes plenas (vertices, calculos, PDF, assinatura, Z-API) virao
// nas Fases 2-7.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import pool from '../database/connection';
import crypto from 'crypto';

export type TipoImovel = 'URBANO' | 'RURAL';
export type TipoLoteUrbano = 'MEIO_QUADRA' | 'ESQUINA';
// v2.1.0 — modos de levantamento (UI ponto-a-ponto)
export type TipoLevantamento = 'URBANO_4P' | 'URBANO_5P' | 'URBANO_NP' | 'RURAL';
export type SistemaCoord = 'UTM' | 'LATLNG' | 'AMBOS';
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
  numero_contrato: string | null;
  denominacao_imovel: string | null;
  nirf: string | null;
  ccir: string | null;
  // v2.6.0 — Dados Registrais (Cartorio): aplica em rural e urbano
  matricula: string | null;
  livro: string | null;
  folhas: string | null;
  cartorio_nome: string | null;
  cartorio_cns: string | null;
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
  // v2.1.0
  tipo_levantamento: TipoLevantamento | null;
  sistema_coord: SistemaCoord;
  // v2.2.2: Base GNSS (estacao de referencia) — obrigatorio em rural (NTGIR/INCRA)
  base_nome: string | null;
  base_inicio_rastreio: string | null;
  base_fim_rastreio: string | null;
  base_observacoes: string | null;
  // v2.2.3: equipamento Rover (receptor movel) + Coletor de dados
  rover_nome: string | null;
  coletor_nome: string | null;
  // v2.4.2: uuid gerado pelo cliente pra suportar criacao offline
  uuid_local: string | null;
  // v2.9.0: vincula laudo ao lote cadastrado em loteamentos (auto-preenchimento)
  lote_loteamento_id: number | null;
  created_at: string;
  updated_at: string;
  // v3.0.0: precificação INCRA (Portaria 12/2025)
  unidade_calculo?: 'km' | 'hectare' | 'lote' | null;
  pont_vegetacao?: number | null;
  pont_relevo?: number | null;
  pont_insalubridade?: number | null;
  pont_acesso?: number | null;
  pont_clima?: number | null;
  pont_area_media?: number | null;
  pontuacao_total?: number | null;
  faixa_aplicada?: string | null;
  valor_unitario?: number | null;
  quantidade_calculo?: number | null;
  valor_base_calculado?: number | null;
  desconto_tipo?: 'percentual' | 'fixo' | 'nenhum' | null;
  desconto_valor?: number | null;
  valor_final?: number | null;
  valor_demarcacao?: number | null;
  precificacao_observacoes?: string | null;
  precificacao_calculada_em?: Date | string | null;
  // v3.5.0: BCI (Boletim do Cadastro Imobiliario - Prefeitura) - todos opcionais
  bci_cod_imovel: string | null;
  bci_loc_cartografica: string | null;
  bci_distrito: string | null;
  bci_setor: string | null;
  bci_quadra: string | null;
  bci_lote: string | null;
  bci_unidade: string | null;
  bci_situacao: string | null;
  bci_natureza: string | null;
  bci_logradouro_tipo: string | null;
  bci_logradouro_nome: string | null;
  bci_numero: string | null;
  bci_cep: string | null;
  bci_complemento: string | null;
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
  numero_contrato: string | null;
  denominacao_imovel: string | null;
  nirf: string | null;
  ccir: string | null;
  matricula: string | null;
  livro: string | null;
  folhas: string | null;
  cartorio_nome: string | null;
  cartorio_cns: string | null;
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
  tipo_levantamento: TipoLevantamento | null;
  sistema_coord: SistemaCoord | null;
  base_nome: string | null;
  base_inicio_rastreio: Date | string | null;
  base_fim_rastreio: Date | string | null;
  base_observacoes: string | null;
  rover_nome: string | null;
  coletor_nome: string | null;
  uuid_local: string | null;
  lote_loteamento_id: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  // v3.0.0: precificação INCRA
  unidade_calculo: 'km' | 'hectare' | 'lote' | null;
  pont_vegetacao: string | number | null;
  pont_relevo: string | number | null;
  pont_insalubridade: string | number | null;
  pont_acesso: string | number | null;
  pont_clima: string | number | null;
  pont_area_media: string | number | null;
  pontuacao_total: string | number | null;
  faixa_aplicada: string | null;
  valor_unitario: string | number | null;
  quantidade_calculo: string | number | null;
  valor_base_calculado: string | number | null;
  desconto_tipo: 'percentual' | 'fixo' | 'nenhum' | null;
  desconto_valor: string | number | null;
  valor_final: string | number | null;
  valor_demarcacao: string | number | null;
  precificacao_observacoes: string | null;
  precificacao_calculada_em: Date | string | null;
  // v3.5.0: BCI (Boletim do Cadastro Imobiliario - Prefeitura) - todos opcionais
  bci_cod_imovel: string | null;
  bci_loc_cartografica: string | null;
  bci_distrito: string | null;
  bci_setor: string | null;
  bci_quadra: string | null;
  bci_lote: string | null;
  bci_unidade: string | null;
  bci_situacao: string | null;
  bci_natureza: string | null;
  bci_logradouro_tipo: string | null;
  bci_logradouro_nome: string | null;
  bci_numero: string | null;
  bci_cep: string | null;
  bci_complemento: string | null;
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
    numero_contrato: r.numero_contrato ?? null,
    denominacao_imovel: r.denominacao_imovel ?? null,
    nirf: r.nirf ?? null,
    ccir: r.ccir ?? null,
    matricula: r.matricula ?? null,
    livro: r.livro ?? null,
    folhas: r.folhas ?? null,
    cartorio_nome: r.cartorio_nome ?? null,
    cartorio_cns: r.cartorio_cns ?? null,
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
    tipo_levantamento: r.tipo_levantamento ?? null,
    sistema_coord: (r.sistema_coord ?? 'AMBOS') as SistemaCoord,
    base_nome: r.base_nome ?? null,
    base_inicio_rastreio: asISO(r.base_inicio_rastreio),
    base_fim_rastreio: asISO(r.base_fim_rastreio),
    base_observacoes: r.base_observacoes ?? null,
    rover_nome: r.rover_nome ?? null,
    coletor_nome: r.coletor_nome ?? null,
    uuid_local: r.uuid_local ?? null,
    lote_loteamento_id: r.lote_loteamento_id != null ? Number(r.lote_loteamento_id) : null,
    created_at: asISO(r.created_at) ?? '',
    updated_at: asISO(r.updated_at) ?? '',
    unidade_calculo: r.unidade_calculo ?? null,
    pont_vegetacao: r.pont_vegetacao != null ? Number(r.pont_vegetacao) : null,
    pont_relevo: r.pont_relevo != null ? Number(r.pont_relevo) : null,
    pont_insalubridade: r.pont_insalubridade != null ? Number(r.pont_insalubridade) : null,
    pont_acesso: r.pont_acesso != null ? Number(r.pont_acesso) : null,
    pont_clima: r.pont_clima != null ? Number(r.pont_clima) : null,
    pont_area_media: r.pont_area_media != null ? Number(r.pont_area_media) : null,
    pontuacao_total: r.pontuacao_total != null ? Number(r.pontuacao_total) : null,
    faixa_aplicada: r.faixa_aplicada ?? null,
    valor_unitario: r.valor_unitario != null ? Number(r.valor_unitario) : null,
    quantidade_calculo: r.quantidade_calculo != null ? Number(r.quantidade_calculo) : null,
    valor_base_calculado: r.valor_base_calculado != null ? Number(r.valor_base_calculado) : null,
    desconto_tipo: r.desconto_tipo ?? null,
    desconto_valor: r.desconto_valor != null ? Number(r.desconto_valor) : null,
    valor_final: r.valor_final != null ? Number(r.valor_final) : null,
    valor_demarcacao: r.valor_demarcacao != null ? Number(r.valor_demarcacao) : null,
    precificacao_observacoes: r.precificacao_observacoes ?? null,
    precificacao_calculada_em: r.precificacao_calculada_em ?? null,
    // v3.5.0: BCI
    bci_cod_imovel:        r.bci_cod_imovel        ?? null,
    bci_loc_cartografica:  r.bci_loc_cartografica  ?? null,
    bci_distrito:          r.bci_distrito          ?? null,
    bci_setor:             r.bci_setor             ?? null,
    bci_quadra:            r.bci_quadra            ?? null,
    bci_lote:              r.bci_lote              ?? null,
    bci_unidade:           r.bci_unidade           ?? null,
    bci_situacao:          r.bci_situacao          ?? null,
    bci_natureza:          r.bci_natureza          ?? null,
    bci_logradouro_tipo:   r.bci_logradouro_tipo   ?? null,
    bci_logradouro_nome:   r.bci_logradouro_nome   ?? null,
    bci_numero:            r.bci_numero            ?? null,
    bci_cep:                r.bci_cep               ?? null,
    bci_complemento:       r.bci_complemento       ?? null,
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
  executante_id?: number; // default: 1 (Jose Romario)
  tipo_imovel: TipoImovel;
  observacoes?: string | null;
  // v2.4.2: uuid client-side pra suportar criacao offline
  uuid_local?: string | null;
}

/**
 * v2.4.2: Resolve um identificador (numero ou UUID) pro id INT do laudo.
 * Aceita: 123 (number), "123" (string numerica), ou uuid v4 (string).
 * Permite que endpoints existentes aceitem ambos formatos.
 */
export async function resolverLaudoId(idOrUuid: string | number): Promise<number> {
  if (typeof idOrUuid === 'number') return idOrUuid;
  const s = String(idOrUuid).trim();
  if (/^\d+$/.test(s)) return Number(s);
  // UUID v4 format check (loose)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM laudos_demarcacao WHERE uuid_local = ? LIMIT 1', [s]
    );
    if (rows.length) return Number(rows[0].id);
    throw new Error('Laudo nao encontrado por uuid_local: ' + s);
  }
  throw new Error('Identificador de laudo invalido: ' + s);
}

export async function criarLaudoRascunho(input: CriarLaudoRascunhoInput): Promise<Laudo> {
  if (!input.contratante_id) throw new Error('contratante_id obrigatorio');
  if (!['URBANO', 'RURAL'].includes(input.tipo_imovel)) {
    throw new Error("tipo_imovel deve ser 'URBANO' ou 'RURAL'");
  }
  const executanteId = input.executante_id ?? 1; // default Jose Romario

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
  // v2.4.2: aceita uuid_local do cliente (offline-first), senao gera novo
  const uuidLocal = input.uuid_local && /^[0-9a-f-]{36}$/i.test(input.uuid_local)
    ? input.uuid_local
    : crypto.randomUUID();

  // Idempotencia: se uuid_local ja existe, retorna o laudo existente em vez de criar duplicata
  // (cenário: sync de fila offline pode tentar criar 2x se algo falhou)
  if (input.uuid_local) {
    const [exist] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM laudos_demarcacao WHERE uuid_local = ? LIMIT 1', [uuidLocal]
    );
    if (exist.length) {
      const existing = await buscarLaudo(Number(exist[0].id));
      if (existing) return existing;
    }
  }

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO laudos_demarcacao
      (numero_laudo, contratante_id, executante_id, tipo_imovel,
       token_uuid, hash_validacao, status, observacoes, uuid_local)
     VALUES (?, ?, ?, ?, ?, ?, 'RASCUNHO', ?, ?)`,
    [numero, input.contratante_id, executanteId, input.tipo_imovel,
     tokenUuid, hashValidacao, input.observacoes ?? null, uuidLocal]
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
  // v2.1.4: trocar contratante/executante do laudo
  contratante_id?: number;
  executante_id?: number;
  tipo_lote_urbano?: TipoLoteUrbano | null;
  quadra?: string | null;
  numero_lote?: string | null;
  loteamento?: string | null;
  numero_contrato?: string | null;
  denominacao_imovel?: string | null;
  nirf?: string | null;
  ccir?: string | null;
  // v2.6.0 — Dados Registrais
  matricula?: string | null;
  livro?: string | null;
  folhas?: string | null;
  cartorio_nome?: string | null;
  cartorio_cns?: string | null;
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
  // v3.15.10: valor que vai pro Relatorio de Demarcacoes Faturaveis
  valor_demarcacao?: number | null;
  forma_pagamento?: FormaPagamentoLaudo | null;
  data_pagamento?: string | null;
  observacoes?: string | null;
  // v2.1.0
  tipo_levantamento?: TipoLevantamento | null;
  sistema_coord?: SistemaCoord;
  escala?: string | null;
  // v2.2.2 — Base GNSS
  base_nome?: string | null;
  base_inicio_rastreio?: string | null;
  base_fim_rastreio?: string | null;
  base_observacoes?: string | null;
  // v2.2.3 — Rover + Coletor
  rover_nome?: string | null;
  coletor_nome?: string | null;
  // v2.9.0 — Vincula laudo a lote do cadastro de loteamentos
  lote_loteamento_id?: number | null;
  // v3.5.0: BCI (opcionais)
  bci_cod_imovel?: string | null;
  bci_loc_cartografica?: string | null;
  bci_distrito?: string | null;
  bci_setor?: string | null;
  bci_quadra?: string | null;
  bci_lote?: string | null;
  bci_unidade?: string | null;
  bci_situacao?: string | null;
  bci_natureza?: string | null;
  bci_logradouro_tipo?: string | null;
  bci_logradouro_nome?: string | null;
  bci_numero?: string | null;
  bci_cep?: string | null;
  bci_complemento?: string | null;
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
  set('contratante_id', input.contratante_id);
  set('executante_id', input.executante_id);
  set('tipo_lote_urbano', input.tipo_lote_urbano);
  set('quadra', input.quadra);
  set('numero_lote', input.numero_lote);
  set('loteamento', input.loteamento);
  set('numero_contrato', input.numero_contrato);
  set('denominacao_imovel', input.denominacao_imovel);
  set('nirf', input.nirf);
  set('ccir', input.ccir);
  set('matricula', input.matricula);
  set('livro', input.livro);
  set('folhas', input.folhas);
  set('cartorio_nome', input.cartorio_nome);
  set('cartorio_cns', input.cartorio_cns);
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
  set('valor_demarcacao', input.valor_demarcacao);
  set('forma_pagamento', input.forma_pagamento);
  set('data_pagamento', input.data_pagamento);
  set('observacoes', input.observacoes);
  set('tipo_levantamento', input.tipo_levantamento);
  set('sistema_coord', input.sistema_coord);
  set('escala', input.escala);
  set('base_nome', input.base_nome);
  set('base_inicio_rastreio', input.base_inicio_rastreio);
  set('base_fim_rastreio', input.base_fim_rastreio);
  set('base_observacoes', input.base_observacoes);
  set('rover_nome', input.rover_nome);
  set('coletor_nome', input.coletor_nome);
  set('lote_loteamento_id', input.lote_loteamento_id);
  // v3.5.0: BCI
  set('bci_cod_imovel',        input.bci_cod_imovel);
  set('bci_loc_cartografica',  input.bci_loc_cartografica);
  set('bci_distrito',          input.bci_distrito);
  set('bci_setor',             input.bci_setor);
  set('bci_quadra',            input.bci_quadra);
  set('bci_lote',              input.bci_lote);
  set('bci_unidade',           input.bci_unidade);
  set('bci_situacao',          input.bci_situacao);
  set('bci_natureza',          input.bci_natureza);
  set('bci_logradouro_tipo',   input.bci_logradouro_tipo);
  set('bci_logradouro_nome',   input.bci_logradouro_nome);
  set('bci_numero',            input.bci_numero);
  set('bci_cep',                input.bci_cep);
  set('bci_complemento',       input.bci_complemento);

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
  // v2.1.0
  azimute_manual: string | null;
  // v2.2.1: tempo de rastreio GNSS em segundos (opcional, util em rural)
  tempo_rastreio_seg: number | null;
}

interface PontoRow extends RowDataPacket {
  id: number; laudo_id: number; ordem: number; rotulo: string;
  utm_zona: string | null; utm_hemisferio: 'N' | 'S' | null;
  utm_e: string | number | null; utm_n: string | number | null;
  lat_decimal: string | number | null; long_decimal: string | number | null;
  lat_gms: string | null; long_gms: string | null;
  altitude: string | number | null; descricao_marco: string | null;
  azimute_manual: string | null;
  tempo_rastreio_seg: string | number | null;
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
    azimute_manual: r.azimute_manual ?? null,
    tempo_rastreio_seg: r.tempo_rastreio_seg != null ? Number(r.tempo_rastreio_seg) : null,
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
        azimute_manual: p.azimute_manual ?? null,
        tempo_rastreio_seg: (p as Partial<PontoLaudo>).tempo_rastreio_seg ?? null,
      };
    });

    // Insere pontos
    const idsInseridos: number[] = [];
    for (const p of pontosCompletos) {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO laudos_demarcacao_pontos
          (laudo_id, ordem, rotulo, utm_zona, utm_hemisferio, utm_e, utm_n,
           lat_decimal, long_decimal, lat_gms, long_gms, altitude, descricao_marco,
           azimute_manual, tempo_rastreio_seg)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [Number(laudoId), p.ordem, p.rotulo,
         p.utm_zona, p.utm_hemisferio, p.utm_e, p.utm_n,
         p.lat_decimal, p.long_decimal, p.lat_gms, p.long_gms,
         p.altitude, p.descricao_marco, p.azimute_manual ?? null,
         (p as Partial<PontoLaudo>).tempo_rastreio_seg ?? null]
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
  // v2.1.0
  medida_manual_m: number | null;
  confrontante_nome: string | null;
  nome_lado: string | null;
}

interface LadoRow extends RowDataPacket {
  id: number; laudo_id: number; ordem: number;
  ponto_inicio_id: number; ponto_fim_id: number;
  rotulo: string | null; distancia_m: string | number | null; azimute: string | number | null;
  medida_manual_m: string | number | null;
  confrontante_nome: string | null;
  nome_lado: string | null;
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
    medida_manual_m: asNum(r.medida_manual_m),
    confrontante_nome: r.confrontante_nome ?? null,
    nome_lado: r.nome_lado ?? null,
  }));
}

// v2.1.0 — atualiza dados do lado (medida manual + confrontante + nome)
export async function atualizarLado(
  ladoId: number | string,
  input: { medida_manual_m?: number | null; confrontante_nome?: string | null; nome_lado?: string | null }
): Promise<void> {
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.medida_manual_m !== undefined) {
    fields.push('medida_manual_m = ?');
    params.push(input.medida_manual_m);
  }
  if (input.confrontante_nome !== undefined) {
    fields.push('confrontante_nome = ?');
    params.push(input.confrontante_nome?.trim() || null);
  }
  if (input.nome_lado !== undefined) {
    fields.push('nome_lado = ?');
    params.push(input.nome_lado?.trim() || null);
  }
  if (!fields.length) return;
  params.push(Number(ladoId));
  await pool.execute(
    `UPDATE laudos_demarcacao_lados SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
}

// v2.1.0 — atualiza dados do ponto (azimute manual + descricao marco)
export async function atualizarPonto(
  pontoId: number | string,
  input: { azimute_manual?: string | null; descricao_marco?: string | null }
): Promise<void> {
  const fields: string[] = [];
  const params: (string | null)[] = [];
  if (input.azimute_manual !== undefined) {
    fields.push('azimute_manual = ?');
    params.push(input.azimute_manual?.trim() || null);
  }
  if (input.descricao_marco !== undefined) {
    fields.push('descricao_marco = ?');
    params.push(input.descricao_marco?.trim() || null);
  }
  if (!fields.length) return;
  params.push(String(pontoId));
  await pool.execute(
    `UPDATE laudos_demarcacao_pontos SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
}

// ── v1.99.27: Fase 3 — Croqui SVG / Upload + Relatorio Fotografico ────────

import { gerarCroquiSvg } from '../services/croquiSvg';

/**
 * Gera SVG do croqui a partir dos pontos UTM. Nao persiste (gera on-the-fly).
 * Quando user prefere croqui manual, sobrepoe via salvarCroquiUpload().
 */
export async function gerarCroquiAutoSvg(laudoId: number | string): Promise<string> {
  const [laudo, pontos, lados] = await Promise.all([
    buscarLaudo(laudoId),
    listarPontosDoLaudo(laudoId),
    listarLadosDoLaudo(laudoId),
  ]);
  const pontosFiltrados = pontos.filter(p => p.utm_e != null && p.utm_n != null);
  const pontosSvg = pontosFiltrados.map(p => ({ rotulo: p.rotulo, e: p.utm_e as number, n: p.utm_n as number }));
  const ladosSvg = lados.map(l => ({
    i_idx: pontos.findIndex(p => p.id === l.ponto_inicio_id),
    f_idx: pontos.findIndex(p => p.id === l.ponto_fim_id),
    distancia_m: l.distancia_m ?? 0,
  }));
  return gerarCroquiSvg(pontosSvg, ladosSvg, {
    // v3.1.0: area no centro + tarjeta SIRGAS
    tipoImovel: laudo?.tipo_imovel as 'URBANO' | 'RURAL' | undefined,
    areaTotalM2: laudo?.area_total_m2 != null ? Number(laudo.area_total_m2) : undefined,
    utmZona: pontosFiltrados[0]?.utm_zona ? Number(pontosFiltrados[0].utm_zona) : undefined,
    utmHemisferio: pontosFiltrados[0]?.utm_hemisferio || 'S',
  });
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

// ── v1.99.29: Fase 5 — Assinatura digital + persistir PDF assinado ────────

export async function salvarPdfAssinado(
  laudoId: number | string,
  pdfBuffer: Buffer
): Promise<void> {
  await pool.execute(
    `UPDATE laudos_demarcacao
       SET pdf_assinado_blob = ?,
           assinado_em = NOW(),
           status = IF(status IN ('RASCUNHO','PREENCHIDO'), 'ASSINADO', status)
     WHERE id = ?`,
    [pdfBuffer, Number(laudoId)]
  );
}

export async function getPdfAssinado(laudoId: number | string): Promise<{
  pdf: Buffer; numero: string; assinado_em: string | null;
} | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT numero_laudo, pdf_assinado_blob, assinado_em
       FROM laudos_demarcacao WHERE id = ? LIMIT 1`,
    [Number(laudoId)]
  );
  if (!rows.length || !rows[0].pdf_assinado_blob) return null;
  const r = rows[0];
  return {
    pdf: r.pdf_assinado_blob as Buffer,
    numero: String(r.numero_laudo),
    assinado_em: r.assinado_em
      ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
      : null,
  };
}

// v3.5.0: envia laudo assinado via Telegram. Replica padrao de enviarVistoriaTelegram.
// chatId opcional → default TELEGRAM_LEAD_CHAT_ID (CEO) ou primeiro de
// TELEGRAM_AUTHORIZED_USER_IDS (CSV).
export async function enviarLaudoTelegram(input: { id: string | number; chatId?: string }) {
  const id = Number(input.id);
  const laudo = await buscarLaudo(id);
  if (!laudo) throw new Error('Laudo nao encontrado.');

  const chatId = (input.chatId || '').trim()
    || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
    || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (!chatId) throw new Error('chatId Telegram obrigatorio (TELEGRAM_LEAD_CHAT_ID ou TELEGRAM_AUTHORIZED_USER_IDS).');

  const pdfData = await getPdfAssinado(id);
  if (!pdfData) throw new Error('Laudo ainda nao foi assinado — assine antes de enviar.');
  const pdfBuf = pdfData.pdf;
  if (pdfBuf.length > 50 * 1024 * 1024) {
    throw new Error(`PDF tem ${(pdfBuf.length / 1024 / 1024).toFixed(1)}MB e Telegram aceita ate 50MB.`);
  }

  const imovelCurto = (laudo.denominacao_imovel || laudo.endereco_imovel || 'imovel')
    .replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
  const fileName = `Laudo_${pdfData.numero}_${imovelCurto}.pdf`;
  const caption = `Laudo #${pdfData.numero} — ${laudo.denominacao_imovel || laudo.endereco_imovel || ''}`;

  const { sendDocument: sendTelegramDocument } = await import('./telegram');
  try {
    await sendTelegramDocument(chatId, pdfBuf, fileName, caption);
  } catch (err) {
    const e = err as Error & { response?: { data?: { description?: string; error_code?: number } } };
    const desc = e.response?.data?.description || e.message;
    const code = e.response?.data?.error_code;
    throw new Error(`Telegram rejeitou: ${desc}${code ? ` (code ${code})` : ''}`);
  }
  return {
    ok: true as const,
    message: `Laudo #${pdfData.numero} enviado via Telegram (chat ${chatId}, ${(pdfBuf.length / 1024).toFixed(0)} KB).`,
    chat_id: chatId,
  };
}

// v3.0.0: persistência da precificação INCRA (Portaria 12/2025)
import type {
  CriteriosPontuacao,
  UnidadeCalculo,
  DescontoTipo,
  ResultadoPrecificacao,
} from '../services/pricing/incra';

export interface DadosPrecificacaoPersistir {
  unidade: UnidadeCalculo;
  criterios: CriteriosPontuacao;
  quantidade: number;
  resultado: ResultadoPrecificacao;
  desconto: { tipo: DescontoTipo; valor: number };
  observacoes?: string | null;
}

export async function atualizarPrecificacao(
  id: number,
  d: DadosPrecificacaoPersistir,
): Promise<void> {
  await pool.execute(
    `UPDATE laudos_demarcacao SET
        unidade_calculo = ?,
        pont_vegetacao = ?, pont_relevo = ?, pont_insalubridade = ?,
        pont_acesso = ?,    pont_clima = ?,  pont_area_media = ?,
        pontuacao_total = ?, faixa_aplicada = ?,
        valor_unitario = ?, quantidade_calculo = ?, valor_base_calculado = ?,
        desconto_tipo = ?, desconto_valor = ?,
        valor_final = ?,    valor_servico = ?,
        precificacao_observacoes = ?,
        precificacao_calculada_em = NOW()
      WHERE id = ?`,
    [
      d.unidade,
      d.criterios.vegetacao, d.criterios.relevo, d.criterios.insalubridade,
      d.criterios.acesso,    d.criterios.clima,  d.criterios.area_media,
      d.resultado.pontuacaoTotal, d.resultado.faixa.label,
      d.resultado.valorUnitario, d.quantidade, d.resultado.valorBase,
      d.desconto.tipo, d.desconto.valor,
      d.resultado.valorFinal, d.resultado.valorFinal,
      d.observacoes ?? null,
      Number(id),
    ],
  );
}

export async function atualizarApenasDesconto(
  id: number,
  desconto: { tipo: DescontoTipo; valor: number },
  novoValorFinal: number,
): Promise<void> {
  await pool.execute(
    `UPDATE laudos_demarcacao SET
        desconto_tipo = ?, desconto_valor = ?,
        valor_final = ?, valor_servico = ?,
        precificacao_calculada_em = NOW()
      WHERE id = ?`,
    [desconto.tipo, desconto.valor, novoValorFinal, novoValorFinal, Number(id)],
  );
}

// v3.1.0: helpers da clonagem de laudo
export function construirPontosZerados(
  tipoLevantamento: string,
  laudoId: number,
): Array<{ laudo_id: number; ordem: number; rotulo: string }> {
  const make = (n: number) => Array.from({ length: n }, (_, i) => ({
    laudo_id: laudoId, ordem: i + 1, rotulo: `V${i + 1}`,
  }));
  switch (tipoLevantamento) {
    case 'URBANO_4P': return make(4);
    case 'URBANO_5P': return make(5);
    case 'URBANO_NP': return make(1);
    case 'RURAL':     return make(1);
    default:          return [];
  }
}

export async function prePopularLadosDoLote(
  conn: PoolConnection,
  loteamentoLoteId: number,
  novoLaudoId: number,
): Promise<Array<{
  laudo_id: number;
  ordem: number;
  rotulo: string;
  confrontante_nome: string | null;
  nome_lado: string;
}>> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT conf_frente_texto, conf_fundo_texto,
            conf_lateral_dir_texto, conf_lateral_esq_texto,
            conf_frente_lote_id, conf_fundo_lote_id,
            conf_lateral_dir_lote_id, conf_lateral_esq_lote_id
       FROM loteamento_lotes WHERE id = ? LIMIT 1`,
    [Number(loteamentoLoteId)],
  );
  if (!rows.length) return [];
  const r = rows[0];

  const resolverFk = async (fkId: unknown): Promise<string | null> => {
    if (!fkId) return null;
    const [r2] = await conn.execute<RowDataPacket[]>(
      `SELECT numero_lote FROM loteamento_lotes WHERE id = ? LIMIT 1`,
      [Number(fkId)],
    );
    return r2.length ? `Lote ${r2[0].numero_lote}` : null;
  };

  const conf_frente  = (r.conf_frente_texto      as string | null) || (await resolverFk(r.conf_frente_lote_id));
  const conf_fundo   = (r.conf_fundo_texto       as string | null) || (await resolverFk(r.conf_fundo_lote_id));
  const conf_lat_dir = (r.conf_lateral_dir_texto as string | null) || (await resolverFk(r.conf_lateral_dir_lote_id));
  const conf_lat_esq = (r.conf_lateral_esq_texto as string | null) || (await resolverFk(r.conf_lateral_esq_lote_id));

  return [
    { laudo_id: novoLaudoId, ordem: 1, rotulo: 'V1-V2', nome_lado: 'Frente',       confrontante_nome: conf_frente },
    { laudo_id: novoLaudoId, ordem: 2, rotulo: 'V2-V3', nome_lado: 'Lateral Dir',  confrontante_nome: conf_lat_dir },
    { laudo_id: novoLaudoId, ordem: 3, rotulo: 'V3-V4', nome_lado: 'Fundo',        confrontante_nome: conf_fundo },
    { laudo_id: novoLaudoId, ordem: 4, rotulo: 'V4-V1', nome_lado: 'Lateral Esq',  confrontante_nome: conf_lat_esq },
  ];
}

/**
 * v3.1.0: Clona um laudo de demarcacao.
 * - Copia campos descritivos (cliente, loteamento, equipamentos, ART/TRT, precif INCRA, etc)
 * - Zera identidade/estado: numero_laudo (gera novo), numero_lote, areas, hashes,
 *   pdf_assinado, recibo, zapi_*, status volta pra 'PREENCHIDO'
 * - Cria pontos zerados conforme tipo_levantamento (4P→4, 5P→5, NP/RURAL→1)
 * - Pre-popula lados com confrontantes do lote (se lote_loteamento_id existir)
 * - Registra em audit_log
 * - Atomic: toda a operacao em transacao com rollback em caso de erro
 *
 * NOTA: representante_nome/cpf/cargo e descricao_area foram OMITIDOS do camposCopiar
 * pois pertencem a tabela contratantes, nao a laudos_demarcacao.
 */
export async function clonarLaudo(
  originalId: number,
  opts: { copiarFotos?: boolean } = {},
): Promise<Laudo> {
  const copiarFotos = !!opts.copiarFotos;
  // gera numero_laudo ANTES de abrir transacao (gerarNumeroLaudo ja tem seu
  // proprio lock pessimista; chamar de dentro de outra transacao causaria deadlock)
  const novoNumero = await gerarNumeroLaudo();
  const novoUuid = crypto.randomUUID();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Carrega original
    const [origRows] = await conn.execute<LaudoRow[]>(
      `SELECT * FROM laudos_demarcacao WHERE id = ? AND ativo = 1 LIMIT 1`,
      [Number(originalId)],
    );
    if (!origRows.length) throw new Error('Laudo nao encontrado ou inativo');
    const o = origRows[0] as unknown as Record<string, unknown>;

    // 2. Lista de campos descritivos a COPIAR (ordem importa pra o INSERT)
    // REMOVIDOS (pertencem a contratantes, nao a laudos_demarcacao):
    //   representante_nome, representante_cpf, representante_cargo, descricao_area
    const camposCopiar = [
      'tipo_imovel', 'tipo_lote_urbano', 'tipo_levantamento',
      'contratante_id', 'executante_id',
      'quadra', 'loteamento', 'numero_contrato',
      'denominacao_imovel', 'nirf', 'ccir',
      'endereco_imovel', 'municipio', 'uf_imovel', 'comarca',
      'confrontante_frente', 'confrontante_lat_dir', 'confrontante_lat_esq',
      'confrontante_fundo', 'confrontante_extra',
      'croqui_tipo', 'croqui_path', 'croqui_b64', 'croqui_mime', 'escala',
      'usa_art', 'numero_art', 'usa_trt', 'numero_trt',
      'sistema_coord',
      'base_nome', 'base_inicio_rastreio', 'base_fim_rastreio', 'base_observacoes',
      'rover_nome', 'coletor_nome',
      'matricula', 'livro', 'folhas', 'cartorio_nome', 'cartorio_cns',
      'lote_loteamento_id',
      // Precificacao INCRA (v3.0.0)
      'unidade_calculo', 'pont_vegetacao', 'pont_relevo', 'pont_insalubridade',
      'pont_acesso', 'pont_clima', 'pont_area_media',
      'pontuacao_total', 'faixa_aplicada',
      'valor_unitario', 'quantidade_calculo', 'valor_base_calculado',
      'desconto_tipo', 'desconto_valor', 'valor_final',
      'precificacao_observacoes', 'precificacao_calculada_em',
      'valor_servico', 'forma_pagamento',
    ];

    // 3. Monta INSERT
    const placeholders = camposCopiar.map(() => '?').join(',');
    // cast explícito: o[c] é unknown (Record<string,unknown>); mysql2 só aceita primitivos
    const values = camposCopiar.map(c => (o[c] ?? null) as string | number | boolean | Date | null);

    const [insertResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO laudos_demarcacao
         (numero_laudo, token_uuid, status,
          ${camposCopiar.join(',')},
          numero_lote, area_total_m2, perimetro_m,
          clonado_de_id, clonado_em,
          ativo, created_at, updated_at)
       VALUES (?, ?, 'PREENCHIDO',
          ${placeholders},
          NULL, NULL, NULL,
          ?, NOW(),
          1, NOW(), NOW())`,
      [novoNumero, novoUuid, ...values, Number(originalId)],
    );
    const cloneId = insertResult.insertId;

    // 4. Pontos zerados conforme tipo_levantamento
    const pontos = construirPontosZerados(String(o.tipo_levantamento ?? ''), cloneId);
    if (pontos.length > 0) {
      const ph = pontos.map(() => '(?, ?, ?)').join(',');
      const flat = pontos.flatMap(p => [p.laudo_id, p.ordem, p.rotulo]);
      await conn.execute(
        `INSERT INTO laudos_demarcacao_pontos (laudo_id, ordem, rotulo) VALUES ${ph}`,
        flat,
      );
    }

    // 5. Lados pre-preenchidos com confrontantes do lote (se houver).
    // v3.15.19: a tabela laudos_demarcacao_lados exige ponto_inicio_id/ponto_fim_id
    // NOT NULL. SELECT-back nos pontos recem-criados e referencia eles circularmente
    // (V1-V2, V2-V3, V3-V4, V4-V1). Antes da v3.15.19 o INSERT explodia com
    // "Field 'ponto_inicio_id' doesn't have a default value".
    if (o.lote_loteamento_id != null) {
      const lados = await prePopularLadosDoLote(conn, Number(o.lote_loteamento_id), cloneId);
      if (lados.length > 0) {
        const [pontosRows] = await conn.execute<RowDataPacket[]>(
          `SELECT id, ordem FROM laudos_demarcacao_pontos
            WHERE laudo_id = ? ORDER BY ordem ASC`,
          [cloneId],
        );
        const pontosIds = pontosRows.map(p => Number(p.id));
        // So pre-popula lados se houver pontos suficientes pra fechar o circuito
        // (prePopularLadosDoLote retorna 4 lados — precisa de pelo menos 4 pontos).
        if (pontosIds.length >= lados.length) {
          const ph = lados.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',');
          const flat = lados.flatMap((l, i) => {
            const inicio = pontosIds[i % pontosIds.length];
            const fim    = pontosIds[(i + 1) % pontosIds.length];
            return [l.laudo_id, l.ordem, l.rotulo, l.confrontante_nome, l.nome_lado, inicio, fim];
          });
          await conn.execute(
            `INSERT INTO laudos_demarcacao_lados
               (laudo_id, ordem, rotulo, confrontante_nome, nome_lado, ponto_inicio_id, ponto_fim_id)
             VALUES ${ph}`,
            flat,
          );
        } else {
          console.warn(`[clonarLaudo] laudo ${cloneId} tem ${pontosIds.length} pontos (<${lados.length} lados) — pulando pre-popular lados`);
        }
      }
    }

    // 5.5. v3.17.4: copia fotos quando opt-in. INSERT...SELECT mantem mime/legenda/
    // conteudo_b64 mas re-aponta laudo_id pro clone e zera ponto_id (pontos novos
    // foram zerados na etapa 4, entao linkagem antiga nao serve).
    let fotosCopiadas = 0;
    if (copiarFotos) {
      const [fotosResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO laudos_demarcacao_fotos
            (laudo_id, ponto_id, ordem, mime, conteudo_b64, legenda, created_at)
         SELECT ?, NULL, ordem, mime, conteudo_b64, legenda, NOW()
           FROM laudos_demarcacao_fotos
          WHERE laudo_id = ?`,
        [cloneId, Number(originalId)],
      );
      fotosCopiadas = fotosResult.affectedRows || 0;
    }

    // 6. Audit log (tenant_id NOT NULL no schema; usa 1 como padrao mono-tenant)
    await conn.execute(
      `INSERT INTO audit_log (tenant_id, action, resource_type, resource_id, payload)
       VALUES (1, 'laudo:clonar', 'laudo', ?, ?)`,
      [String(originalId), JSON.stringify({
        novo_id: cloneId,
        novo_numero: novoNumero,
        tipo_levantamento: o.tipo_levantamento,
        copiar_fotos: copiarFotos,
        fotos_copiadas: fotosCopiadas,
      })],
    );

    await conn.commit();

    const clone = await buscarLaudo(cloneId);
    if (!clone) throw new Error('Erro ao carregar clone recem-criado');
    return clone;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}
