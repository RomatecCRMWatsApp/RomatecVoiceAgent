// v3.49.0: Anexos de documentos em recibos universais.
//
// Permite anexar 1–5 documentos por recibo (PDF/JPG/PNG/WebP) que serao
// enviados junto ao PDF principal via WhatsApp (CCIR antigo, CCIR atualizado,
// declaracao ITR, recibo CAR, etc.). Storage em LONGBLOB no proprio banco
// (mesmo padrao de laudos_demarcacao_arquivos — Railway sem volume persistente).

import { randomBytes, createHash } from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';

export const MAX_ANEXOS_POR_RECIBO = 5;
export const MAX_TAMANHO_BYTES = 10 * 1024 * 1024; // 10 MB

/** MIME types permitidos para anexos de recibo. */
export const MIMES_PERMITIDOS: ReadonlyArray<string> = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

/** Extensoes permitidas (validacao secundaria, alem do MIME). */
const EXT_PERMITIDAS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

export interface AnexoReciboResumo {
  id: number;
  recibo_id: number;
  nome_original: string;
  nome_armazenado: string;
  descricao: string | null;
  mime_type: string;
  tamanho_bytes: number;
  sha256: string;
  download_token: string;
  ativo: boolean;
  criado_em: string;
}

export interface AnexoReciboComBlob extends AnexoReciboResumo {
  conteudo_blob: Buffer;
}

/** Sanitiza nome: NFD, lowercase, espacos->-, mantem [a-z0-9._-], prefixo sha8. */
export function sanitizarNomeArquivo(nomeOriginal: string, sha256: string): string {
  const semAcentos = nomeOriginal.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const limpo = semAcentos
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  const finalNome = limpo || 'arquivo';
  return `${sha256.slice(0, 8)}_${finalNome}`;
}

export function calcularSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function gerarDownloadToken(): string {
  return randomBytes(32).toString('hex');
}

/** Valida extensao + MIME. Retorna a extensao normalizada ou lanca erro. */
export function validarMimeEExtensao(nomeOriginal: string, mimeType: string): string {
  const ext = (nomeOriginal.split('.').pop() ?? '').toLowerCase();
  if (!ext || !EXT_PERMITIDAS.has(ext)) {
    throw new Error(`Extensao '.${ext}' nao permitida. Aceitos: PDF, JPG, PNG, WebP.`);
  }
  const mimeNorm = (mimeType || '').toLowerCase();
  if (mimeNorm && !MIMES_PERMITIDOS.includes(mimeNorm)) {
    // Tolerancia: alguns navegadores enviam octet-stream ou variantes. Apenas warning.
    console.warn(`[recibosAnexos] MIME '${mimeType}' inesperado para .${ext} — aceitando.`);
  }
  return ext;
}

function mapRow(r: RowDataPacket): AnexoReciboResumo {
  return {
    id: Number(r.id),
    recibo_id: Number(r.recibo_id),
    nome_original: String(r.nome_original),
    nome_armazenado: String(r.nome_armazenado),
    descricao: r.descricao ?? null,
    mime_type: String(r.mime_type),
    tamanho_bytes: Number(r.tamanho_bytes),
    sha256: String(r.sha256),
    download_token: String(r.download_token),
    ativo: !!r.ativo,
    criado_em: r.criado_em instanceof Date
      ? r.criado_em.toISOString()
      : String(r.criado_em),
  };
}

export interface CriarAnexoInput {
  recibo_id: number;
  nome_original: string;
  mime_type: string;
  conteudo: Buffer;
  descricao?: string | null;
  /** tenant_id do solicitante — usado pra checagem anti-IDOR (default 1). */
  tenant_id?: number;
}

/** Confere que o recibo existe e pertence ao tenant. Lanca erro descritivo. */
async function assertReciboPertenceAoTenant(
  reciboId: number,
  tenantId: number,
): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, tenant_id FROM recibos WHERE id = ? LIMIT 1`,
    [reciboId],
  );
  if (rows.length === 0) {
    throw new Error(`Recibo #${reciboId} nao encontrado`);
  }
  if (Number(rows[0].tenant_id) !== tenantId) {
    throw new Error(`Recibo #${reciboId} pertence a outro tenant`);
  }
}

export async function criarAnexo(input: CriarAnexoInput): Promise<AnexoReciboResumo> {
  const reciboId = Number(input.recibo_id);
  if (!reciboId) throw new Error('recibo_id obrigatorio');
  if (!input.nome_original?.trim()) throw new Error('nome_original obrigatorio');
  if (!Buffer.isBuffer(input.conteudo) || input.conteudo.length === 0) {
    throw new Error('conteudo do arquivo vazio ou invalido');
  }
  if (input.conteudo.length > MAX_TAMANHO_BYTES) {
    throw new Error(
      `Arquivo excede ${MAX_TAMANHO_BYTES / 1024 / 1024} MB (atual ${(input.conteudo.length / 1024 / 1024).toFixed(2)} MB)`,
    );
  }

  const tenantId = Number(input.tenant_id ?? 1);
  await assertReciboPertenceAoTenant(reciboId, tenantId);

  // Limite de 5 anexos ATIVOS por recibo
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM recibos_anexos WHERE recibo_id = ? AND ativo = TRUE`,
    [reciboId],
  );
  const total = Number((countRows[0] as { n: number }).n);
  if (total >= MAX_ANEXOS_POR_RECIBO) {
    throw new Error(
      `Recibo #${reciboId} ja tem ${total} anexos (maximo ${MAX_ANEXOS_POR_RECIBO})`,
    );
  }

  const ext = validarMimeEExtensao(input.nome_original, input.mime_type);
  const sha256 = calcularSha256(input.conteudo);
  let nomeArmazenado = sanitizarNomeArquivo(input.nome_original, sha256);
  if (!nomeArmazenado.toLowerCase().endsWith(`.${ext}`)) {
    nomeArmazenado += `.${ext}`;
  }
  const downloadToken = gerarDownloadToken();
  const descricao = input.descricao?.toString().trim().slice(0, 255) || null;

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO recibos_anexos
       (recibo_id, nome_original, nome_armazenado, descricao, mime_type,
        tamanho_bytes, sha256, conteudo_blob, download_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reciboId,
      input.nome_original.slice(0, 255),
      nomeArmazenado.slice(0, 300),
      descricao,
      (input.mime_type || '').slice(0, 120),
      input.conteudo.length,
      sha256,
      input.conteudo,
      downloadToken,
    ],
  );

  return {
    id: r.insertId,
    recibo_id: reciboId,
    nome_original: input.nome_original,
    nome_armazenado: nomeArmazenado,
    descricao,
    mime_type: input.mime_type || '',
    tamanho_bytes: input.conteudo.length,
    sha256,
    download_token: downloadToken,
    ativo: true,
    criado_em: new Date().toISOString(),
  };
}

export async function listarAnexos(
  reciboId: number,
  tenantId = 1,
): Promise<AnexoReciboResumo[]> {
  await assertReciboPertenceAoTenant(Number(reciboId), Number(tenantId));
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, recibo_id, nome_original, nome_armazenado, descricao, mime_type,
            tamanho_bytes, sha256, download_token, ativo, criado_em
       FROM recibos_anexos
      WHERE recibo_id = ? AND ativo = TRUE
      ORDER BY id ASC`,
    [Number(reciboId)],
  );
  return rows.map(mapRow);
}

/** Busca todos os anexos ATIVOS de um recibo COM blob (uso interno — envio Z-API). */
export async function listarAnexosComBlob(reciboId: number): Promise<AnexoReciboComBlob[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, recibo_id, nome_original, nome_armazenado, descricao, mime_type,
            tamanho_bytes, sha256, conteudo_blob, download_token, ativo, criado_em
       FROM recibos_anexos
      WHERE recibo_id = ? AND ativo = TRUE
      ORDER BY id ASC`,
    [Number(reciboId)],
  );
  return rows.map(r => ({
    ...mapRow(r),
    conteudo_blob: r.conteudo_blob as Buffer,
  }));
}

export interface AnexoParaDownload {
  nome_original: string;
  mime_type: string;
  tamanho_bytes: number;
  conteudo_blob: Buffer;
}

/** Busca anexo pelo id, com checagem de ownership. Retorna null se nao encontrado. */
export async function buscarAnexoParaDownload(
  anexoId: number,
  tenantId = 1,
): Promise<AnexoParaDownload | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT a.nome_original, a.mime_type, a.tamanho_bytes, a.conteudo_blob, a.ativo,
            r.tenant_id
       FROM recibos_anexos a
       JOIN recibos r ON r.id = a.recibo_id
      WHERE a.id = ? LIMIT 1`,
    [Number(anexoId)],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.ativo) return null;
  if (Number(row.tenant_id) !== Number(tenantId)) {
    throw new Error('Anexo pertence a outro tenant');
  }
  return {
    nome_original: String(row.nome_original),
    mime_type: String(row.mime_type),
    tamanho_bytes: Number(row.tamanho_bytes),
    conteudo_blob: row.conteudo_blob as Buffer,
  };
}

/** Busca anexo pelo token publico (uso pra link de download direto sem auth). */
export async function buscarAnexoPorToken(
  token: string,
): Promise<AnexoParaDownload | null> {
  if (!token || typeof token !== 'string' || token.length !== 64) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT nome_original, mime_type, tamanho_bytes, conteudo_blob, ativo
       FROM recibos_anexos
      WHERE download_token = ? LIMIT 1`,
    [token],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.ativo) return null;
  return {
    nome_original: String(row.nome_original),
    mime_type: String(row.mime_type),
    tamanho_bytes: Number(row.tamanho_bytes),
    conteudo_blob: row.conteudo_blob as Buffer,
  };
}

/** Soft delete: marca ativo=false. Checagem anti-IDOR via tenant. */
export async function removerAnexo(
  anexoId: number,
  tenantId = 1,
): Promise<{ ok: true; affected: number }> {
  // Confere ownership antes (mais rapido que JOIN no UPDATE em alguns engines)
  const [check] = await pool.execute<RowDataPacket[]>(
    `SELECT r.tenant_id, a.ativo
       FROM recibos_anexos a
       JOIN recibos r ON r.id = a.recibo_id
      WHERE a.id = ? LIMIT 1`,
    [Number(anexoId)],
  );
  if (check.length === 0) {
    return { ok: true, affected: 0 };
  }
  if (Number(check[0].tenant_id) !== Number(tenantId)) {
    throw new Error('Anexo pertence a outro tenant');
  }
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE recibos_anexos SET ativo = FALSE WHERE id = ? AND ativo = TRUE`,
    [Number(anexoId)],
  );
  return { ok: true, affected: r.affectedRows };
}
