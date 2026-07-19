// v3.8.0 — Galeria de Fotos georreferenciadas.
//
// CRUD básico da tabela galeria_fotos. As fotos são salvas como base64 no
// banco (mesma estratégia das fotos de laudos), com metadados de GPS +
// endereço reverso já populados pelo cliente que tirou a foto (carimbo
// também é aplicado no cliente via canvas, então a `arquivo_b64` já vem
// com a foto "marcada"). Aqui só persistimos e servimos.

import { createHash } from 'crypto';
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
  /** v3.108.0: SHA-256 do binário. Vai pro front pra dedup offline. */
  hash_sha256?: string | null;
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
    hash_sha256: r.hash_sha256 ?? null,
  };
}

/** Lista fotos da galeria (sem o base64 — pra preview leve). */
export async function listarFotos(opts: {
  tenant_id?: number;
  limit?: number;
  offset?: number;
  obra_id?: number;
  /** v3.107.0: true = só a galeria geral (fotos ainda não vinculadas a obra). */
  apenas_geral?: boolean;
} = {}): Promise<GaleriaFoto[]> {
  const tenant = opts.tenant_id ?? 1;
  // v3.105.0: blinda contra NaN vindo de Number(req.query.limit) — LIMIT NaN quebrava a listagem.
  const limit = Math.min(Number.isFinite(opts.limit as number) ? Math.max(1, Math.trunc(opts.limit as number)) : 100, 500);
  const offset = Number.isFinite(opts.offset as number) ? Math.max(0, Math.trunc(opts.offset as number)) : 0;
  const wheres: string[] = ['tenant_id = ?'];
  const params: Array<number | string> = [tenant];
  if (opts.obra_id != null) {
    wheres.push('obra_id = ?');
    params.push(opts.obra_id);
  } else if (opts.apenas_geral) {
    // v3.107.0: foto movida pra obra some da geral — transferência, não cópia.
    // Não é o default da rota: consumidores antigos continuam vendo tudo.
    wheres.push('obra_id IS NULL');
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, tenant_id, user_id, user_nome, mime, legenda,
            lat, lng, altitude_m, accuracy_m, endereco_reverso,
            capturada_em, tags, obra_id, criada_em, hash_sha256
       FROM galeria_fotos
      WHERE ${wheres.join(' AND ')}
      ORDER BY COALESCE(capturada_em, criada_em) DESC, id DESC
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
// ===================== v3.108.0: deduplicação por hash =====================
//
// ALCANCE REAL desta dedup: SHA-256 do binário = bytes idênticos. Como o carimbo é
// queimado no JPEG no cliente e inclui o horário (`🕒 dd/mm/aaaa, hh:mm:ss`), duas
// capturas da MESMA cena nunca batem — os pixels do texto diferem. Na prática isto
// pega reenvio do mesmo arquivo: fila offline reprocessada, sync duplicado, upload
// repetido. NÃO pega "tirei duas fotos parecidas".
//
// Não usei hash perceptual de propósito: a exclusão é silenciosa e sem confirmação,
// então um falso positivo apagaria uma foto legítima de vistoria sem ninguém ver.

/** SHA-256 do binário da imagem (não do base64 — o texto pode variar em padding). */
export function calcularHashFoto(arquivoB64: string): string {
  return createHash('sha256').update(Buffer.from(arquivoB64, 'base64')).digest('hex');
}

/** Procura foto com o mesmo conteúdo NO MESMO ESCOPO (geral ou a mesma obra). */
export async function buscarDuplicata(
  hash: string,
  obraId: number | null,
  tenantId = 1,
): Promise<number | null> {
  // obra_id IS NULL precisa de comparação própria: `= NULL` nunca casa em SQL.
  const cond = obraId == null ? 'obra_id IS NULL' : 'obra_id = ?';
  const params: Array<string | number> = [tenantId, hash];
  if (obraId != null) params.push(obraId);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM galeria_fotos
      WHERE tenant_id = ? AND hash_sha256 = ? AND ${cond}
      ORDER BY id ASC LIMIT 1`,   // a mais antiga prevalece
    params,
  );
  return rows.length ? Number(rows[0].id) : null;
}

async function registrarDuplicataDescartada(dados: {
  tenant_id: number; hash: string; original_id: number; obra_id: number | null;
  origem: string; user_nome?: string | null; capturada_em?: string | null;
}): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO galeria_duplicatas_log
         (tenant_id, hash_sha256, foto_original_id, obra_id, origem, user_nome, capturada_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [dados.tenant_id, dados.hash, dados.original_id, dados.obra_id,
       dados.origem, dados.user_nome ?? null, dados.capturada_em ?? null],
    );
  } catch (err) {
    // Log é diagnóstico: falhar aqui não pode derrubar o upload.
    console.error('[galeria-dedup] falha ao registrar descarte:', (err as Error).message);
  }
}

/**
 * Insere com dedup. Se já existir foto de conteúdo idêntico no mesmo escopo,
 * NÃO cria registro novo: devolve o id da original e registra o descarte.
 */
export async function criarFotoComDedup(
  input: NovaFotoInput,
  origem = 'upload',
): Promise<{ id: number; duplicada: boolean; original_id: number | null }> {
  const tenant = input.tenant_id ?? 1;
  const obraId = input.obra_id ?? null;
  const hash = calcularHashFoto(input.arquivo_b64);

  const originalId = await buscarDuplicata(hash, obraId, tenant);
  if (originalId != null) {
    await registrarDuplicataDescartada({
      tenant_id: tenant, hash, original_id: originalId, obra_id: obraId,
      origem, user_nome: input.user_nome ?? null, capturada_em: input.capturada_em ?? null,
    });
    return { id: originalId, duplicada: true, original_id: originalId };
  }
  const id = await criarFoto({ ...input, hash_sha256: hash });
  return { id, duplicada: false, original_id: null };
}

/**
 * Calcula o hash das fotos antigas (inseridas antes da v3.108.0), em lotes.
 * Sem isto, uma foto nova nunca seria detectada como duplicata das já existentes.
 */
export async function backfillHashes(limite = 50): Promise<{ processadas: number; restantes: number }> {
  const n = Math.max(1, Math.min(Math.trunc(limite), 200));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, arquivo_b64 FROM galeria_fotos WHERE hash_sha256 IS NULL LIMIT ${n}`,
  );
  for (const r of rows) {
    try {
      await pool.execute(
        `UPDATE galeria_fotos SET hash_sha256 = ? WHERE id = ?`,
        [calcularHashFoto(String(r.arquivo_b64)), r.id],
      );
    } catch (err) {
      console.error('[galeria-dedup] backfill falhou na foto', r.id, (err as Error).message);
    }
  }
  const [[{ total }]] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM galeria_fotos WHERE hash_sha256 IS NULL`,
  ) as unknown as [[{ total: number }]];
  return { processadas: rows.length, restantes: Number(total) };
}

export async function criarFoto(input: NovaFotoInput & { hash_sha256?: string }): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO galeria_fotos
       (tenant_id, user_id, user_nome, mime, arquivo_b64, legenda,
        lat, lng, altitude_m, accuracy_m, endereco_reverso,
        capturada_em, tags, obra_id, hash_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      // v3.108.0: se o chamador não passou, calcula aqui — nenhuma foto entra sem hash,
      // senão a dedup teria buracos silenciosos.
      input.hash_sha256 ?? calcularHashFoto(input.arquivo_b64),
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

/**
 * v3.107.0: prefixo de obra na legenda.
 *
 * O prefixo é gravado NO banco (decisão do CEO), então precisa ser idempotente:
 * mover A -> B -> C não pode virar "[A][B][C] Foto". `tirarPrefixoObra` remove um
 * prefixo `[...]` no início antes de qualquer nova aplicação, e mover de volta pra
 * galeria geral limpa o prefixo.
 */
const RE_PREFIXO_OBRA = /^\s*\[[^\]]*\]\s*/;

export function tirarPrefixoObra(legenda: string | null): string {
  return String(legenda ?? '').replace(RE_PREFIXO_OBRA, '').trim();
}

export function aplicarPrefixoObra(legenda: string | null, obraNome: string | null): string {
  const base = tirarPrefixoObra(legenda);
  if (!obraNome) return base;
  const prefixo = `[${obraNome}] `;
  // legenda é VARCHAR(500) — trunca a base, nunca o prefixo, pra não perder a obra.
  // trimEnd: sem legenda, o prefixo sozinho não deve ir pro banco com espaço sobrando.
  return (prefixo + base).slice(0, 500).trimEnd();
}

/**
 * Move um lote de fotos para uma obra (ou de volta pra galeria geral com obraId null).
 * Transferência, não cópia: só troca o obra_id. O nome da obra é resolvido aqui,
 * a partir de romatec_obras — o cliente não dita o texto que vai pro banco.
 */
export async function moverFotosParaObra(
  fotoIds: number[],
  obraId: number | null,
  opts: { tenant_id?: number } = {},
): Promise<{ movidas: number; obra_nome: string | null; descartadas: number }> {
  const ids = [...new Set(fotoIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return { movidas: 0, obra_nome: null, descartadas: 0 };
  const tenant = opts.tenant_id ?? 1;

  let obraNome: string | null = null;
  if (obraId != null) {
    const [obras] = await pool.execute<RowDataPacket[]>(
      `SELECT nome FROM romatec_obras WHERE id = ?`,
      [obraId],
    );
    if (!obras.length) throw new Error(`Obra ${obraId} não encontrada`);
    obraNome = String(obras[0].nome || '').trim() || null;
  }

  // Precisa da legenda atual de cada foto pra recalcular o prefixo por linha.
  const placeholders = ids.map(() => '?').join(',');
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT id, legenda, hash_sha256, user_nome, capturada_em
       FROM galeria_fotos WHERE id IN (${placeholders}) AND tenant_id = ?`,
    [...ids, tenant],
  );

  let movidas = 0;
  let descartadas = 0;
  for (const linha of linhas) {
    // v3.108.0: se a obra destino JÁ tem foto de conteúdo idêntico, mover criaria
    // duplicata dentro do escopo. Descarta a que está chegando (a original prevalece).
    if (linha.hash_sha256) {
      const originalId = await buscarDuplicata(String(linha.hash_sha256), obraId, tenant);
      if (originalId != null && originalId !== Number(linha.id)) {
        await registrarDuplicataDescartada({
          tenant_id: tenant, hash: String(linha.hash_sha256), original_id: originalId,
          obra_id: obraId, origem: 'movimentacao',
          user_nome: linha.user_nome ?? null,
          capturada_em: linha.capturada_em ? String(linha.capturada_em) : null,
        });
        await pool.execute(`DELETE FROM galeria_fotos WHERE id = ? AND tenant_id = ?`, [linha.id, tenant]);
        descartadas++;
        continue;
      }
    }
    const novaLegenda = aplicarPrefixoObra(linha.legenda, obraNome);
    const [res] = await pool.execute<ResultSetHeader>(
      // tenant no WHERE: atualizarFoto() não filtra, e aqui é operação em lote.
      `UPDATE galeria_fotos SET obra_id = ?, legenda = ? WHERE id = ? AND tenant_id = ?`,
      [obraId, novaLegenda || null, linha.id, tenant],
    );
    if (res.affectedRows > 0) movidas++;
  }
  return { movidas, obra_nome: obraNome, descartadas };
}

/**
 * v3.107.0: quantas fotos cada obra tem. Uma consulta agregada em vez de N contagens
 * — a lista de obras renderiza o contador em cada botão.
 */
export async function contarFotosPorObra(opts: { tenant_id?: number } = {}): Promise<Record<string, number>> {
  const tenant = opts.tenant_id ?? 1;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT obra_id, COUNT(*) AS total
       FROM galeria_fotos
      WHERE tenant_id = ? AND obra_id IS NOT NULL
      GROUP BY obra_id`,
    [tenant],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.obra_id)] = Number(r.total);
  return out;
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
