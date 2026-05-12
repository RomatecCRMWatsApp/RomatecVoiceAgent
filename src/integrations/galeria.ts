// v3.8.0 — Galeria de Fotos georreferenciadas.
//
// CRUD básico da tabela galeria_fotos. As fotos são salvas como base64 no
// banco (mesma estratégia das fotos de laudos), com metadados de GPS +
// endereço reverso já populados pelo cliente que tirou a foto (carimbo
// também é aplicado no cliente via canvas, então a `arquivo_b64` já vem
// com a foto "marcada"). Aqui só persistimos e servimos.

import pool from '../database/connection';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface GaleriaFoto {
  id: number;
  tenant_id: number;
  user_id: number | null;
  user_nome: string | null;
  mime: string;
  legenda: string | null;
  lat: number | null;
  lng: number | null;
  altitude_m: number | null;
  accuracy_m: number | null;
  endereco_reverso: string | null;
  capturada_em: string | null;
  tags: string | null;
  obra_id: number | null;
  criada_em: string;
}

export interface GaleriaFotoComB64 extends GaleriaFoto {
  arquivo_b64: string;
}

export interface NovaFotoInput {
  tenant_id?: number;
  user_id?: number | null;
  user_nome?: string | null;
  mime: string;
  arquivo_b64: string;
  legenda?: string | null;
  lat?: number | null;
  lng?: number | null;
  altitude_m?: number | null;
  accuracy_m?: number | null;
  endereco_reverso?: string | null;
  capturada_em?: string | null;
  tags?: string | null;
  obra_id?: number | null;
}

function rowToFoto(r: RowDataPacket): GaleriaFoto {
  return {
    id: Number(r.id),
    tenant_id: Number(r.tenant_id),
    user_id: r.user_id != null ? Number(r.user_id) : null,
    user_nome: r.user_nome ?? null,
    mime: r.mime,
    legenda: r.legenda ?? null,
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    altitude_m: r.altitude_m != null ? Number(r.altitude_m) : null,
    accuracy_m: r.accuracy_m != null ? Number(r.accuracy_m) : null,
    endereco_reverso: r.endereco_reverso ?? null,
    capturada_em: r.capturada_em ? String(r.capturada_em) : null,
    tags: r.tags ?? null,
    obra_id: r.obra_id != null ? Number(r.obra_id) : null,
    criada_em: String(r.criada_em ?? ''),
  };
}

/** Lista fotos da galeria (sem o base64 — pra preview leve). */
export async function listarFotos(opts: {
  tenant_id?: number;
  limit?: number;
  offset?: number;
  obra_id?: number;
} = {}): Promise<GaleriaFoto[]> {
  const tenant = opts.tenant_id ?? 1;
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  const wheres: string[] = ['tenant_id = ?'];
  const params: Array<number | string> = [tenant];
  if (opts.obra_id != null) {
    wheres.push('obra_id = ?');
    params.push(opts.obra_id);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, tenant_id, user_id, user_nome, mime, legenda,
            lat, lng, altitude_m, accuracy_m, endereco_reverso,
            capturada_em, tags, obra_id, criada_em
       FROM galeria_fotos
      WHERE ${wheres.join(' AND ')}
      ORDER BY criada_em DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows.map(rowToFoto);
}

/** Busca 1 foto completa (com base64) — pra preview/download/envio. */
export async function buscarFotoComB64(id: number): Promise<GaleriaFotoComB64 | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT * FROM galeria_fotos WHERE id = ?`,
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { ...rowToFoto(r), arquivo_b64: r.arquivo_b64 };
}

/** Cria nova foto. Retorna o id criado. */
export async function criarFoto(input: NovaFotoInput): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO galeria_fotos
       (tenant_id, user_id, user_nome, mime, arquivo_b64, legenda,
        lat, lng, altitude_m, accuracy_m, endereco_reverso,
        capturada_em, tags, obra_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenant_id ?? 1,
      input.user_id ?? null,
      input.user_nome ?? null,
      input.mime,
      input.arquivo_b64,
      input.legenda ?? null,
      input.lat ?? null,
      input.lng ?? null,
      input.altitude_m ?? null,
      input.accuracy_m ?? null,
      input.endereco_reverso ?? null,
      input.capturada_em ?? null,
      input.tags ?? null,
      input.obra_id ?? null,
    ],
  );
  return res.insertId;
}

/** Apaga 1 foto. */
export async function apagarFoto(id: number): Promise<boolean> {
  const [res] = await pool.execute<ResultSetHeader>(
    `DELETE FROM galeria_fotos WHERE id = ?`,
    [id],
  );
  return res.affectedRows > 0;
}

/** Atualiza legenda/tags/obra_id de uma foto. */
export async function atualizarFoto(
  id: number,
  patches: Partial<Pick<GaleriaFoto, 'legenda' | 'tags' | 'obra_id'>>,
): Promise<boolean> {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (patches.legenda !== undefined) { sets.push('legenda = ?'); params.push(patches.legenda); }
  if (patches.tags !== undefined) { sets.push('tags = ?'); params.push(patches.tags); }
  if (patches.obra_id !== undefined) { sets.push('obra_id = ?'); params.push(patches.obra_id); }
  if (sets.length === 0) return false;
  params.push(id);
  const [res] = await pool.execute<ResultSetHeader>(
    `UPDATE galeria_fotos SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );
  return res.affectedRows > 0;
}
