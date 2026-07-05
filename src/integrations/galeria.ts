// v3.8.0 — Galeria de Fotos georreferenciadas.
//
// CRUD básico da tabela galeria_fotos. As fotos são salvas como base64 no
// banco (mesma estratégia das fotos de laudos), com metadados de GPS +
// endereço reverso já populados pelo cliente que tirou a foto (carimbo
// também é aplicado no cliente via canvas, então a `arquivo_b64` já vem
// com a foto "marcada"). Aqui só persistimos e servimos.

import pool from '../database/connection';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// v3.90.0: o @types/archiver@8 não expõe a assinatura chamável do runtime
// (archiver v7 = factory `archiver('zip', opts)`). Tipamos o mínimo usado.
type ArchiverFactory = (format: string, options?: { zlib?: { level?: number } }) => ArchiverLike;
interface ArchiverLike {
  on(event: 'data', cb: (chunk: Buffer) => void): ArchiverLike;
  on(event: 'end', cb: () => void): ArchiverLike;
  on(event: 'error', cb: (err: Error) => void): ArchiverLike;
  append(source: Buffer, opts: { name: string }): void;
  finalize(): Promise<void> | void;
}

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

/** Erro de ZIP com status HTTP pra rota mapear (400/404). */
export class ZipGaleriaError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; this.name = 'ZipGaleriaError'; }
}

function sanitizarNomeZip(texto: string): string {
  const limpo = String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return limpo || 'foto';
}

/**
 * v3.90.0 — Gera um ZIP (Buffer) com as fotos selecionadas. Fotos são base64 no
 * banco (galeria_fotos.arquivo_b64), então convertemos cada uma pra Buffer e
 * empacotamos com archiver. Foto ausente/sem base64 é PULADA (não quebra o ZIP).
 * Lança ZipGaleriaError(400) pra lista vazia / > 200, e (404) se nenhuma válida.
 */
export async function gerarZipFotos(ids: number[]): Promise<Buffer> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ZipGaleriaError('Nenhuma foto selecionada.', 400);
  }
  if (ids.length > 200) {
    throw new ZipGaleriaError('Limite de 200 fotos por download em lote.', 400);
  }
  const archiverMod = await import('archiver');
  const criarArchive = ((archiverMod as { default?: unknown }).default ?? archiverMod) as unknown as ArchiverFactory;
  const archive = criarArchive('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const finalizado = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', (err: Error) => reject(err));
  });

  const usados = new Set<string>();
  let incluidas = 0;
  for (const rawId of ids) {
    const id = Number(rawId);
    let foto: GaleriaFotoComB64 | null = null;
    try { foto = await buscarFotoComB64(id); } catch { foto = null; }
    if (!foto || !foto.arquivo_b64) {
      console.warn(`[galeria/zip] foto ${rawId} ausente/sem imagem — pulada`);
      continue;
    }
    const buf = Buffer.from(foto.arquivo_b64, 'base64');
    const ext = (foto.mime && foto.mime.split('/')[1]) || 'jpg';
    let nome = `foto-${foto.id}-${sanitizarNomeZip(foto.endereco_reverso || foto.legenda || '')}.${ext}`;
    while (usados.has(nome)) nome = nome.replace(/(\.[^.]+)$/, `-${incluidas}$1`);
    usados.add(nome);
    archive.append(buf, { name: nome });
    incluidas++;
  }

  if (incluidas === 0) {
    throw new ZipGaleriaError('Nenhuma das fotos selecionadas tem imagem disponível.', 404);
  }
  archive.finalize();
  return finalizado;
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
