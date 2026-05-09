// v1.99.25 — CRUD de Contratantes (PF/PJ).
// Reusavel em outros modulos do Romatec (laudos, propostas, recibos).

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

export type TipoPessoa = 'PF' | 'PJ';

export interface Contratante {
  id: number;
  tipo_pessoa: TipoPessoa;
  nome: string;
  cpf_cnpj: string | null;
  rg_ie: string | null;
  nacionalidade: string | null;
  estado_civil: string | null;
  profissao: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  // v2.0.1 — representante legal (opcional, mesmo em PJ)
  representante_nome: string | null;
  representante_cpf: string | null;
  representante_cargo: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

interface ContratanteRow extends RowDataPacket {
  id: number;
  tipo_pessoa: TipoPessoa;
  nome: string;
  cpf_cnpj: string | null;
  rg_ie: string | null;
  nacionalidade: string | null;
  estado_civil: string | null;
  profissao: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  representante_nome: string | null;
  representante_cpf: string | null;
  representante_cargo: string | null;
  ativo: 0 | 1;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRow(r: ContratanteRow): Contratante {
  return {
    id: Number(r.id),
    tipo_pessoa: r.tipo_pessoa,
    nome: String(r.nome),
    cpf_cnpj: r.cpf_cnpj ?? null,
    rg_ie: r.rg_ie ?? null,
    nacionalidade: r.nacionalidade ?? null,
    estado_civil: r.estado_civil ?? null,
    profissao: r.profissao ?? null,
    cep: r.cep ?? null,
    logradouro: r.logradouro ?? null,
    numero: r.numero ?? null,
    complemento: r.complemento ?? null,
    bairro: r.bairro ?? null,
    cidade: r.cidade ?? null,
    uf: r.uf ?? null,
    telefone: r.telefone ?? null,
    email: r.email ?? null,
    observacoes: r.observacoes ?? null,
    representante_nome: r.representante_nome ?? null,
    representante_cpf: r.representante_cpf ?? null,
    representante_cargo: r.representante_cargo ?? null,
    ativo: r.ativo === 1,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

/** Valida CPF (11 digitos com algoritmo de digitos verificadores). */
export function validarCPF(cpfRaw: string): boolean {
  const cpf = (cpfRaw || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calcDV = (slice: string, factor: number): number => {
    let sum = 0;
    for (const d of slice) { sum += Number(d) * factor--; }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = calcDV(cpf.slice(0, 9), 10);
  const d2 = calcDV(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

/** Valida CNPJ (14 digitos com algoritmo de digitos verificadores). */
export function validarCNPJ(cnpjRaw: string): boolean {
  const cnpj = (cnpjRaw || '').replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, ...weights1];
  const calcDV = (slice: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(slice[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calcDV(cnpj.slice(0, 12), weights1);
  const d2 = calcDV(cnpj.slice(0, 13), weights2);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

export interface ListarContratantesInput {
  q?: string;
  tipo_pessoa?: TipoPessoa;
  apenas_ativos?: boolean;
  limit?: number;
  offset?: number;
}

export async function listarContratantes(input: ListarContratantesInput = {}): Promise<{
  items: Contratante[];
  total: number;
}> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (input.apenas_ativos !== false) where.push('ativo = TRUE');
  if (input.tipo_pessoa) {
    where.push('tipo_pessoa = ?');
    params.push(input.tipo_pessoa);
  }
  if (input.q?.trim()) {
    where.push('(nome LIKE ? OR cpf_cnpj LIKE ? OR email LIKE ?)');
    const like = `%${input.q.trim()}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
  const offset = Math.max(Number(input.offset) || 0, 0);

  const [items] = await pool.execute<ContratanteRow[]>(
    `SELECT * FROM contratantes ${whereSql} ORDER BY nome ASC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM contratantes ${whereSql}`,
    params
  );
  return {
    items: items.map(mapRow),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function buscarContratante(id: number | string): Promise<Contratante | null> {
  const [rows] = await pool.execute<ContratanteRow[]>(
    'SELECT * FROM contratantes WHERE id = ? LIMIT 1',
    [Number(id)]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export interface CriarContratanteInput {
  tipo_pessoa: TipoPessoa;
  nome: string;
  cpf_cnpj?: string | null;
  rg_ie?: string | null;
  nacionalidade?: string | null;
  estado_civil?: string | null;
  profissao?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  telefone?: string | null;
  email?: string | null;
  observacoes?: string | null;
  representante_nome?: string | null;
  representante_cpf?: string | null;
  representante_cargo?: string | null;
}

export async function criarContratante(input: CriarContratanteInput): Promise<Contratante> {
  if (!input.nome?.trim()) throw new Error('Nome obrigatorio');
  if (!['PF', 'PJ'].includes(input.tipo_pessoa)) throw new Error('tipo_pessoa deve ser PF ou PJ');

  // Valida CPF/CNPJ se informado
  const cpfCnpjLimpo = (input.cpf_cnpj ?? '').replace(/\D/g, '') || null;
  if (cpfCnpjLimpo) {
    if (input.tipo_pessoa === 'PF' && !validarCPF(cpfCnpjLimpo)) {
      throw new Error('CPF invalido');
    }
    if (input.tipo_pessoa === 'PJ' && !validarCNPJ(cpfCnpjLimpo)) {
      throw new Error('CNPJ invalido');
    }
  }

  // v2.1.5: representante legal totalmente opcional. Trata placeholder
  // (todos os digitos iguais — 00000000000, etc) como vazio.
  let repCpfLimpo = (input.representante_cpf ?? '').replace(/\D/g, '') || null;
  if (repCpfLimpo && /^(\d)\1+$/.test(repCpfLimpo)) repCpfLimpo = null;
  if (repCpfLimpo && !validarCPF(repCpfLimpo)) {
    throw new Error('CPF do representante invalido');
  }

  // Telefone (so digitos)
  const telLimpo = (input.telefone ?? '').replace(/\D/g, '') || null;

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO contratantes
      (tipo_pessoa, nome, cpf_cnpj, rg_ie, nacionalidade, estado_civil, profissao,
       cep, logradouro, numero, complemento, bairro, cidade, uf,
       telefone, email, observacoes,
       representante_nome, representante_cpf, representante_cargo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      input.tipo_pessoa, input.nome.trim(), cpfCnpjLimpo,
      input.rg_ie ?? null, input.nacionalidade ?? null, input.estado_civil ?? null, input.profissao ?? null,
      input.cep ?? null, input.logradouro ?? null, input.numero ?? null, input.complemento ?? null,
      input.bairro ?? null, input.cidade ?? null, input.uf ?? null,
      telLimpo, input.email ?? null, input.observacoes ?? null,
      input.representante_nome?.trim() || null, repCpfLimpo as string | null, input.representante_cargo?.trim() || null,
    ]
  );
  const created = await buscarContratante(r.insertId);
  if (!created) throw new Error('Falha ao criar contratante');
  return created;
}

export type AtualizarContratanteInput = Partial<CriarContratanteInput>;

export async function atualizarContratante(
  id: number | string,
  input: AtualizarContratanteInput
): Promise<Contratante> {
  const existente = await buscarContratante(id);
  if (!existente) throw new Error('Contratante nao encontrado');

  // Re-valida CPF/CNPJ se for trocado
  let cpfCnpjLimpo = existente.cpf_cnpj;
  if (input.cpf_cnpj !== undefined) {
    cpfCnpjLimpo = (input.cpf_cnpj ?? '').replace(/\D/g, '') || null;
    const tipo = input.tipo_pessoa ?? existente.tipo_pessoa;
    if (cpfCnpjLimpo) {
      if (tipo === 'PF' && !validarCPF(cpfCnpjLimpo)) throw new Error('CPF invalido');
      if (tipo === 'PJ' && !validarCNPJ(cpfCnpjLimpo)) throw new Error('CNPJ invalido');
    }
  }

  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const set = <T>(col: string, val: T | undefined) => {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      params.push(val as string | number | null);
    }
  };
  set('tipo_pessoa', input.tipo_pessoa);
  set('nome', input.nome?.trim());
  if (input.cpf_cnpj !== undefined) {
    fields.push('cpf_cnpj = ?');
    params.push(cpfCnpjLimpo);
  }
  set('rg_ie', input.rg_ie);
  set('nacionalidade', input.nacionalidade);
  set('estado_civil', input.estado_civil);
  set('profissao', input.profissao);
  set('cep', input.cep);
  set('logradouro', input.logradouro);
  set('numero', input.numero);
  set('complemento', input.complemento);
  set('bairro', input.bairro);
  set('cidade', input.cidade);
  set('uf', input.uf);
  if (input.telefone !== undefined) {
    fields.push('telefone = ?');
    params.push((input.telefone ?? '').replace(/\D/g, '') || null);
  }
  set('email', input.email);
  set('observacoes', input.observacoes);
  set('representante_nome', input.representante_nome?.trim() || null);
  set('representante_cargo', input.representante_cargo?.trim() || null);
  if (input.representante_cpf !== undefined) {
    let repCpfLimpo = (input.representante_cpf ?? '').replace(/\D/g, '') || null;
    if (repCpfLimpo && /^(\d)\1+$/.test(repCpfLimpo)) repCpfLimpo = null;
    if (repCpfLimpo && !validarCPF(repCpfLimpo)) throw new Error('CPF do representante invalido');
    fields.push('representante_cpf = ?');
    params.push(repCpfLimpo);
  }

  if (fields.length === 0) return existente;

  params.push(Number(id));
  await pool.execute(
    `UPDATE contratantes SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  const updated = await buscarContratante(id);
  if (!updated) throw new Error('Contratante sumiu apos update');
  return updated;
}

/** Soft delete — ativo=false. Mantem historico de laudos vinculados. */
export async function desativarContratante(id: number | string): Promise<void> {
  await pool.execute(
    'UPDATE contratantes SET ativo = FALSE WHERE id = ?',
    [Number(id)]
  );
}

/** Hard delete — so usa em casos administrativos. Bloqueia se tem laudo vinculado. */
export async function excluirContratante(id: number | string): Promise<void> {
  const [laudoRows] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM laudos_demarcacao WHERE contratante_id = ?',
    [Number(id)]
  );
  if (Number(laudoRows[0]?.n ?? 0) > 0) {
    throw new Error('Contratante tem laudos vinculados — use desativar (soft delete)');
  }
  await pool.execute('DELETE FROM contratantes WHERE id = ?', [Number(id)]);
}
