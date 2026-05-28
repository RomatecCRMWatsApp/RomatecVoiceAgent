// v3.31.0: repo da tabela loteamento_quadras_plantas.

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import type { FormatoPlanta } from '../services/quadraPlantaStorage';

export interface QuadraPlantaRow {
  id: number;
  quadra_id: number;
  loteamento_id: number;
  dxf_filename: string | null;
  dxf_path: string | null;
  dxf_size_bytes: number | null;
  dxf_uploaded_at: string | null;
  dxf_hash_sha256: string | null;
  dwg_filename: string | null;
  dwg_path: string | null;
  dwg_size_bytes: number | null;
  dwg_uploaded_at: string | null;
  dwg_hash_sha256: string | null;
  pdf_filename: string | null;
  pdf_path: string | null;
  pdf_size_bytes: number | null;
  pdf_uploaded_at: string | null;
  pdf_hash_sha256: string | null;
  num_lotes_detectados: number | null;
  perimetro_quadra_m: number | null;
  area_total_quadra_m2: number | null;
  lotes_extraidos_json: string | null;
  parsed_at: string | null;
  parse_status: 'pendente' | 'sucesso' | 'erro' | 'manual';
  parse_error: string | null;
  uploaded_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FormatoUploadSnapshot {
  filename: string;
  path: string;
  size_bytes: number;
  hash_sha256: string;
  uploaded_at: Date;
}

function rowFromDb(r: RowDataPacket): QuadraPlantaRow {
  return r as unknown as QuadraPlantaRow;
}

export const quadrasPlantasRepo = {
  async findByQuadraId(quadraId: number): Promise<QuadraPlantaRow | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM loteamento_quadras_plantas
        WHERE quadra_id = ? AND deleted_at IS NULL
        LIMIT 1`,
      [quadraId],
    );
    if (!rows.length) return null;
    return rowFromDb(rows[0]);
  },

  async upsertFormato(args: {
    loteamento_id: number;
    quadra_id: number;
    formato: FormatoPlanta;
    snapshot: FormatoUploadSnapshot;
    uploaded_by_user_id: number | null;
  }): Promise<number> {
    const f = args.formato;
    const cols = {
      filename: `${f}_filename`,
      path: `${f}_path`,
      size: `${f}_size_bytes`,
      uploaded: `${f}_uploaded_at`,
      hash: `${f}_hash_sha256`,
    };

    // Tenta UPDATE primeiro; se nao houver linha, INSERT.
    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM loteamento_quadras_plantas WHERE quadra_id = ? AND deleted_at IS NULL LIMIT 1`,
      [args.quadra_id],
    );
    if (existing.length) {
      await pool.execute(
        `UPDATE loteamento_quadras_plantas
            SET ${cols.filename} = ?,
                ${cols.path} = ?,
                ${cols.size} = ?,
                ${cols.uploaded} = ?,
                ${cols.hash} = ?,
                uploaded_by_user_id = COALESCE(?, uploaded_by_user_id)
          WHERE id = ?`,
        [args.snapshot.filename, args.snapshot.path, args.snapshot.size_bytes, args.snapshot.uploaded_at, args.snapshot.hash_sha256, args.uploaded_by_user_id, existing[0].id],
      );
      return Number(existing[0].id);
    }
    // INSERT inicial
    const [r] = await pool.execute<ResultSetHeader>(
      `INSERT INTO loteamento_quadras_plantas
        (loteamento_id, quadra_id, ${cols.filename}, ${cols.path}, ${cols.size}, ${cols.uploaded}, ${cols.hash}, uploaded_by_user_id, parse_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`,
      [args.loteamento_id, args.quadra_id, args.snapshot.filename, args.snapshot.path, args.snapshot.size_bytes, args.snapshot.uploaded_at, args.snapshot.hash_sha256, args.uploaded_by_user_id],
    );
    return r.insertId;
  },

  async marcarFlagQuadra(quadraId: number, tem: boolean): Promise<void> {
    await pool.execute(
      `UPDATE loteamento_quadras SET tem_planta_individual = ? WHERE id = ?`,
      [tem ? 1 : 0, quadraId],
    );
  },

  async limparFormato(quadraId: number, formato: FormatoPlanta): Promise<void> {
    const f = formato;
    await pool.execute(
      `UPDATE loteamento_quadras_plantas
          SET ${f}_filename = NULL, ${f}_path = NULL, ${f}_size_bytes = NULL,
              ${f}_uploaded_at = NULL, ${f}_hash_sha256 = NULL
        WHERE quadra_id = ?`,
      [quadraId],
    );
  },

  async atualizarParse(quadraId: number, args: {
    parse_status: 'pendente' | 'sucesso' | 'erro' | 'manual';
    num_lotes_detectados?: number | null;
    perimetro_quadra_m?: number | null;
    area_total_quadra_m2?: number | null;
    lotes_extraidos_json?: string | null;
    parse_error?: string | null;
  }): Promise<void> {
    await pool.execute(
      `UPDATE loteamento_quadras_plantas
          SET parse_status = ?,
              num_lotes_detectados = ?,
              perimetro_quadra_m = ?,
              area_total_quadra_m2 = ?,
              lotes_extraidos_json = ?,
              parse_error = ?,
              parsed_at = CURRENT_TIMESTAMP
        WHERE quadra_id = ?`,
      [
        args.parse_status,
        args.num_lotes_detectados ?? null,
        args.perimetro_quadra_m ?? null,
        args.area_total_quadra_m2 ?? null,
        args.lotes_extraidos_json ?? null,
        args.parse_error ?? null,
        quadraId,
      ],
    );
  },

  async softDelete(quadraId: number): Promise<void> {
    await pool.execute(
      `UPDATE loteamento_quadras_plantas SET deleted_at = CURRENT_TIMESTAMP WHERE quadra_id = ?`,
      [quadraId],
    );
  },
};
