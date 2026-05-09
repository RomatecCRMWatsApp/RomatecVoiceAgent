// v1.99.25 — CRUD de Executantes (responsaveis tecnicos do laudo).
// Ronicley vem como seed (id=1) na migration de laudos.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

export interface Executante {
  id: number;
  nome: string;
  qualificacao: string | null;
  registro_cft: string | null;
  registro_crea: string | null;
  cadastro_incra: string | null;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

interface ExecutanteRow extends RowDataPacket {
  id: number;
  nome: string;
  qualificacao: string | null;
  registro_cft: string | null;
  registro_crea: string | null;
  cadastro_incra: string | null;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  ativo: 0 | 1;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRow(r: ExecutanteRow): Executante {
  return {
    id: Number(r.id),
    nome: String(r.nome),
    qualificacao: r.qualificacao ?? null,
    registro_cft: r.registro_cft ?? null,
    registro_crea: r.registro_crea ?? null,
    cadastro_incra: r.cadastro_incra ?? null,
    cpf: r.cpf ?? null,
    telefone: r.telefone ?? null,
    email: r.email ?? null,
    ativo: r.ativo === 1,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

export async function listarExecutantes(input: { apenas_ativos?: boolean } = {}): Promise<Executante[]> {
  const where = input.apenas_ativos !== false ? 'WHERE ativo = TRUE' : '';
  const [rows] = await pool.execute<ExecutanteRow[]>(
    `SELECT * FROM executantes ${where} ORDER BY nome ASC`
  );
  return rows.map(mapRow);
}

export async function buscarExecutante(id: number | string): Promise<Executante | null> {
  const [rows] = await pool.execute<ExecutanteRow[]>(
    'SELECT * FROM executantes WHERE id = ? LIMIT 1',
    [Number(id)]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export interface CriarExecutanteInput {
  nome: string;
  qualificacao?: string | null;
  registro_cft?: string | null;
  registro_crea?: string | null;
  cadastro_incra?: string | null;
  cpf?: string | null;
  telefone?: string | null;
  email?: string | null;
}

export async function criarExecutante(input: CriarExecutanteInput): Promise<Executante> {
  if (!input.nome?.trim()) throw new Error('Nome obrigatorio');
  const cpfLimpo = (input.cpf ?? '').replace(/\D/g, '') || null;
  const telLimpo = (input.telefone ?? '').replace(/\D/g, '') || null;

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO executantes
      (nome, qualificacao, registro_cft, registro_crea, cadastro_incra,
       cpf, telefone, email)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      input.nome.trim(),
      input.qualificacao ?? null, input.registro_cft ?? null,
      input.registro_crea ?? null, input.cadastro_incra ?? null,
      cpfLimpo, telLimpo, input.email ?? null,
    ]
  );
  const created = await buscarExecutante(r.insertId);
  if (!created) throw new Error('Falha ao criar executante');
  return created;
}

export type AtualizarExecutanteInput = Partial<CriarExecutanteInput> & { ativo?: boolean };

export async function atualizarExecutante(
  id: number | string,
  input: AtualizarExecutanteInput
): Promise<Executante> {
  const existente = await buscarExecutante(id);
  if (!existente) throw new Error('Executante nao encontrado');

  const fields: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  const set = <T>(col: string, val: T | undefined) => {
    if (val !== undefined) {
      fields.push(`${col} = ?`);
      params.push(val as string | number | boolean | null);
    }
  };
  set('nome', input.nome?.trim());
  set('qualificacao', input.qualificacao);
  set('registro_cft', input.registro_cft);
  set('registro_crea', input.registro_crea);
  set('cadastro_incra', input.cadastro_incra);
  if (input.cpf !== undefined) {
    fields.push('cpf = ?');
    params.push((input.cpf ?? '').replace(/\D/g, '') || null);
  }
  if (input.telefone !== undefined) {
    fields.push('telefone = ?');
    params.push((input.telefone ?? '').replace(/\D/g, '') || null);
  }
  set('email', input.email);
  set('ativo', input.ativo);

  if (fields.length === 0) return existente;

  params.push(Number(id));
  await pool.execute(
    `UPDATE executantes SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  const updated = await buscarExecutante(id);
  if (!updated) throw new Error('Executante sumiu apos update');
  return updated;
}
