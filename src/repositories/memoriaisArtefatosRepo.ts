// v3.49.2: persistencia dos artefatos do Memorial Hidraulico (PDF-A/PDF-B em
// LONGBLOB + dados de calculo em JSON). Aditivo ao memoriaisRepo (nao o altera).
// Armazena os PDFs no proprio MySQL — robusto no Railway (FS efemero entre deploys).

import pool from '../database/connection';
import type { RowDataPacket } from 'mysql2';

export interface ArtefatosInput {
  memorialBuf: Buffer;
  memorialNome: string;
  memorialHash: string;
  quantBuf: Buffer;
  quantNome: string;
  quantHash: string;
  dadosCalculo: unknown;
}

export interface ArtefatoLido {
  buffer: Buffer;
  filename: string;
}

export const memoriaisArtefatosRepo = {
  async salvar(id: number, a: ArtefatosInput): Promise<void> {
    await pool.execute(
      `UPDATE memoriais_calculo SET
         memorial_pdf_blob = ?, memorial_pdf_filename = ?, memorial_pdf_hash = ?, memorial_pdf_size_bytes = ?,
         lista_materiais_pdf_blob = ?, lista_materiais_pdf_filename = ?, lista_materiais_hash = ?,
         dados_calculo = ?
       WHERE id = ?`,
      [
        a.memorialBuf, a.memorialNome, a.memorialHash, a.memorialBuf.length,
        a.quantBuf, a.quantNome, a.quantHash,
        JSON.stringify(a.dadosCalculo ?? {}),
        id,
      ],
    );
  },

  async ler(id: number, tipo: 'memorial' | 'quantitativo'): Promise<ArtefatoLido | null> {
    const blobCol = tipo === 'memorial' ? 'memorial_pdf_blob' : 'lista_materiais_pdf_blob';
    const nomeCol = tipo === 'memorial' ? 'memorial_pdf_filename' : 'lista_materiais_pdf_filename';
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT ${blobCol} AS blobData, ${nomeCol} AS filename
         FROM memoriais_calculo WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (!rows.length || !rows[0].blobData) return null;
    const buffer = rows[0].blobData as Buffer;
    const filename = (rows[0].filename as string) || `${tipo}_${id}.pdf`;
    return { buffer, filename };
  },
};
