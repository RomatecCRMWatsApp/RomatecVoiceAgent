// v3.35.0: repositorio de memoriais de calculo.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import type { DisciplinaMemorial, StatusMemorial } from '../services/memoriais/types';

export interface MemorialRow {
  id: number;
  codigo: string;
  disciplina: DisciplinaMemorial;
  revisao: number;
  obra_id: number | null;
  cliente_id: number | null;
  user_id: number | null;
  obra_titulo: string;
  obra_uso: string;
  obra_endereco: string;
  obra_municipio: string;
  obra_uf: string;
  obra_cep: string | null;
  proprietario_nome: string;
  proprietario_cpf_cnpj: string | null;
  area_lote_m2: number | null;
  area_construida_m2: number;
  num_pavimentos: number;
  wizard_responses: unknown;
  pdf_extracted_data: unknown;
  pdf_filename: string | null;
  prancha_codigo: string | null;
  status: StatusMemorial;
  memorial_md: string | null;
  trt_numero: string | null;
  trt_data: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function parseJsonCol<T = unknown>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return null;
}

async function gerarCodigo(disciplina: DisciplinaMemorial): Promise<string> {
  const ano = new Date().getFullYear();
  const sufixo = {
    arquitetonico: 'ARQ',
    eletrico: 'ELE',
    hidraulico: 'HID',
    sanitario: 'SAN',
    estrutural: 'EST',
    pci: 'PCI',
  }[disciplina];
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT codigo FROM memoriais_calculo
      WHERE codigo LIKE ? ORDER BY id DESC LIMIT 1`,
    [`MEM-${ano}-%-${sufixo}-R1`],
  );
  let seq = 1;
  if (rows.length > 0) {
    const m = String(rows[0].codigo).match(/MEM-\d{4}-(\d+)-/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `MEM-${ano}-${String(seq).padStart(4, '0')}-${sufixo}-R1`;
}

export const memoriaisRepo = {
  async criar(input: {
    disciplina: DisciplinaMemorial;
    obra_id?: number | null;
    cliente_id?: number | null;
    user_id?: number | null;
    obra_titulo: string;
    obra_uso?: string;
    obra_endereco: string;
    obra_municipio?: string;
    obra_uf?: string;
    obra_cep?: string | null;
    proprietario_nome: string;
    proprietario_cpf_cnpj?: string | null;
    area_lote_m2?: number | null;
    area_construida_m2: number;
    num_pavimentos?: number;
    wizard_responses?: unknown;
    pdf_extracted_data?: unknown;
    pdf_filename?: string | null;
    prancha_codigo?: string | null;
    trt_numero?: string | null;
    trt_data?: string | null;
  }): Promise<{ id: number; codigo: string }> {
    const codigo = await gerarCodigo(input.disciplina);
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO memoriais_calculo
        (codigo, disciplina, obra_id, cliente_id, user_id,
         obra_titulo, obra_uso, obra_endereco, obra_municipio, obra_uf, obra_cep,
         proprietario_nome, proprietario_cpf_cnpj,
         area_lote_m2, area_construida_m2, num_pavimentos,
         wizard_responses, pdf_extracted_data, pdf_filename, prancha_codigo,
         trt_numero, trt_data, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_revisao')`,
      [
        codigo, input.disciplina, input.obra_id ?? null, input.cliente_id ?? null, input.user_id ?? null,
        input.obra_titulo, input.obra_uso ?? 'Residencial unifamiliar',
        input.obra_endereco, input.obra_municipio ?? 'Acailandia', input.obra_uf ?? 'MA', input.obra_cep ?? null,
        input.proprietario_nome, input.proprietario_cpf_cnpj ?? null,
        input.area_lote_m2 ?? null, input.area_construida_m2, input.num_pavimentos ?? 1,
        JSON.stringify(input.wizard_responses ?? {}),
        input.pdf_extracted_data ? JSON.stringify(input.pdf_extracted_data) : null,
        input.pdf_filename ?? null, input.prancha_codigo ?? null,
        input.trt_numero ?? null, input.trt_data ?? null,
      ],
    );
    return { id: r.insertId, codigo };
  },

  async buscarPorId(id: number): Promise<MemorialRow | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM memoriais_calculo WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      ...r,
      wizard_responses: parseJsonCol(r.wizard_responses),
      pdf_extracted_data: parseJsonCol(r.pdf_extracted_data),
    } as unknown as MemorialRow;
  },

  async listar(opts: { disciplina?: DisciplinaMemorial; status?: StatusMemorial; obra_id?: number; limite?: number } = {}): Promise<MemorialRow[]> {
    const wheres: string[] = ['deleted_at IS NULL'];
    const params: Array<string | number> = [];
    if (opts.disciplina) { wheres.push('disciplina = ?'); params.push(opts.disciplina); }
    if (opts.status) { wheres.push('status = ?'); params.push(opts.status); }
    if (opts.obra_id != null) { wheres.push('obra_id = ?'); params.push(opts.obra_id); }
    const limite = Math.min(opts.limite ?? 100, 500);
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM memoriais_calculo
        WHERE ${wheres.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ${limite}`,
      params,
    );
    return rows.map((r) => ({
      ...r,
      wizard_responses: parseJsonCol(r.wizard_responses),
      pdf_extracted_data: parseJsonCol(r.pdf_extracted_data),
    } as unknown as MemorialRow));
  },

  async atualizarStatus(id: number, status: StatusMemorial): Promise<void> {
    await pool.execute(
      `UPDATE memoriais_calculo SET status = ? WHERE id = ?`,
      [status, id],
    );
  },

  async softDelete(id: number): Promise<void> {
    await pool.execute(
      `UPDATE memoriais_calculo SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
    );
  },
};
