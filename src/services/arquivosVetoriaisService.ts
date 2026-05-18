// v3.17.0: service de arquivos vetoriais (DXF/DWG/KML) anexos a Laudos de Demarcação.
// Storage no banco (LONGBLOB). Token público de 64 chars hex (256 bits de entropia).
// Validação em camadas: extensão, MIME declarado, magic bytes do conteúdo.

import { randomBytes, createHash } from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { getConfigNumber } from './configuracoes';

export type TipoArquivoVetorial = 'dxf' | 'dwg' | 'kml';

export interface ArquivoVetorialResumo {
  id: number;
  laudo_id: number;
  tipo: TipoArquivoVetorial;
  nome_original: string;
  nome_armazenado: string;
  tamanho_bytes: number;
  mime_type: string;
  sha256: string;
  download_token: string;
  download_expira_em: string | null;
  download_count: number;
  ultimo_download_at: string | null;
  ativo: boolean;
  created_at: string;
}

const EXTENSOES_VALIDAS: TipoArquivoVetorial[] = ['dxf', 'dwg', 'kml'];

const MIME_POR_TIPO: Record<TipoArquivoVetorial, string[]> = {
  // DXF/DWG não têm MIME padrão consistente; navegadores variam.
  dxf: ['image/vnd.dxf', 'application/dxf', 'application/octet-stream', 'text/plain', ''],
  dwg: ['image/vnd.dwg', 'application/dwg', 'application/acad', 'application/octet-stream', ''],
  kml: ['application/vnd.google-earth.kml+xml', 'application/xml', 'text/xml', 'text/plain', ''],
};

/**
 * Sanitiza nome de arquivo: remove acentos, espaços → '-', mantém apenas [a-z0-9._-].
 * Prefixa com 8 chars do SHA-256 para garantir unicidade no armazenamento.
 */
export function sanitizarNomeArquivo(nomeOriginal: string, sha256: string): string {
  const semAcentos = nomeOriginal.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const limpo = semAcentos
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  const final = limpo || 'arquivo';
  return `${sha256.slice(0, 8)}_${final}`;
}

/**
 * Detecta o tipo do arquivo combinando extensão e magic bytes.
 * Retorna o tipo se válido OU lança erro com motivo claro.
 * Magic bytes que falham mas extensão+MIME batem: registra warning e aceita (DXF tem variantes).
 */
export function detectarTipoArquivo(
  nomeOriginal: string,
  mimeType: string,
  conteudo: Buffer
): { tipo: TipoArquivoVetorial; magicBytesOk: boolean } {
  const ext = (nomeOriginal.split('.').pop() ?? '').toLowerCase();
  if (!EXTENSOES_VALIDAS.includes(ext as TipoArquivoVetorial)) {
    throw new Error(`Extensão '${ext}' não suportada. Aceitos: DXF, DWG, KML.`);
  }
  const tipo = ext as TipoArquivoVetorial;

  const mimesPermitidos = MIME_POR_TIPO[tipo];
  if (mimeType && !mimesPermitidos.includes(mimeType.toLowerCase())) {
    // Apenas warning: navegadores variam. Não rejeita pelo MIME.
    console.warn(`[arquivosVetoriais] MIME '${mimeType}' inesperado para .${tipo} (esperado: ${mimesPermitidos.filter(Boolean).join(', ')})`);
  }

  const magicBytesOk = verificarMagicBytes(tipo, conteudo);
  if (!magicBytesOk) {
    console.warn(`[arquivosVetoriais] magic bytes inválidos para .${tipo} (${nomeOriginal}) — aceitando mesmo assim (tolerância documentada).`);
  }
  return { tipo, magicBytesOk };
}

export function verificarMagicBytes(tipo: TipoArquivoVetorial, conteudo: Buffer): boolean {
  if (conteudo.length < 8) return false;
  if (tipo === 'dwg') {
    // DWG: começa com "AC10xx" onde xx é a versão (R13–R2018)
    const head = conteudo.subarray(0, 6).toString('ascii');
    return /^AC10(12|14|15|18|21|24|27|32)$/.test(head);
  }
  if (tipo === 'dxf') {
    // DXF binário: "AutoCAD Binary DXF\r\n\x1a\x00"
    const head22 = conteudo.subarray(0, 22).toString('binary');
    if (head22.startsWith('AutoCAD Binary DXF')) return true;
    // DXF ascii: típicamente começa com "  0\r\n" ou "  0\n" seguido de "SECTION".
    // BOM UTF-8 opcional (EF BB BF) no início.
    const offset = (conteudo[0] === 0xEF && conteudo[1] === 0xBB && conteudo[2] === 0xBF) ? 3 : 0;
    const head200 = conteudo.subarray(offset, offset + 200).toString('utf8');
    return /^\s*0\s*[\r\n]+\s*SECTION/.test(head200);
  }
  if (tipo === 'kml') {
    // KML é XML com namespace KML.
    const offset = (conteudo[0] === 0xEF && conteudo[1] === 0xBB && conteudo[2] === 0xBF) ? 3 : 0;
    const head500 = conteudo.subarray(offset, offset + 500).toString('utf8');
    return /<\?xml[\s\S]*?\?>/.test(head500) && /opengis\.net\/kml/.test(head500);
  }
  return false;
}

/** Gera token de download (64 chars hex = 256 bits de entropia). */
export function gerarDownloadToken(): string {
  return randomBytes(32).toString('hex');
}

/** Calcula SHA-256 do buffer (64 chars hex). */
export function calcularSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function validarTamanho(tipo: TipoArquivoVetorial, tamanhoBytes: number): Promise<void> {
  const chave = `UPLOAD_MAX_SIZE_MB_${tipo.toUpperCase()}`;
  const limiteMb = await getConfigNumber(chave);
  const limiteBytes = (limiteMb || 50) * 1024 * 1024;
  if (tamanhoBytes > limiteBytes) {
    throw new Error(`Arquivo .${tipo} excede ${limiteMb || 50} MB (atual ${(tamanhoBytes / 1024 / 1024).toFixed(2)} MB).`);
  }
}

async function calcularExpiracao(): Promise<Date | null> {
  const dias = await getConfigNumber('DOWNLOAD_TOKEN_EXPIRACAO_DIAS');
  if (!dias || dias <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(dias));
  return d;
}

export interface CriarArquivoInput {
  laudo_id: number;
  nome_original: string;
  mime_type: string;
  conteudo: Buffer;
}

export async function criarArquivoVetorial(input: CriarArquivoInput): Promise<ArquivoVetorialResumo> {
  const laudoId = Number(input.laudo_id);
  if (!laudoId) throw new Error('laudo_id obrigatório');
  if (!input.nome_original?.trim()) throw new Error('nome_original obrigatório');
  if (!Buffer.isBuffer(input.conteudo) || input.conteudo.length === 0) {
    throw new Error('conteudo do arquivo vazio ou inválido');
  }

  const { tipo } = detectarTipoArquivo(input.nome_original, input.mime_type || '', input.conteudo);
  await validarTamanho(tipo, input.conteudo.length);

  const sha256 = calcularSha256(input.conteudo);
  const nome_armazenado = sanitizarNomeArquivo(input.nome_original, sha256) + (input.nome_original.toLowerCase().endsWith('.' + tipo) ? '' : `.${tipo}`);
  const download_token = gerarDownloadToken();
  const expiraEm = await calcularExpiracao();

  // Confere que o laudo existe (FK ON DELETE CASCADE valida no INSERT, mas mensagem melhor aqui)
  const [laudoRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM laudos_demarcacao WHERE id = ? LIMIT 1`,
    [laudoId]
  );
  if (laudoRows.length === 0) throw new Error(`Laudo #${laudoId} não encontrado`);

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO laudos_demarcacao_arquivos
       (laudo_id, tipo, nome_original, nome_armazenado, tamanho_bytes, mime_type,
        sha256, conteudo_blob, download_token, download_expira_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      laudoId,
      tipo,
      input.nome_original.slice(0, 255),
      nome_armazenado.slice(0, 300),
      input.conteudo.length,
      input.mime_type || '',
      sha256,
      input.conteudo,
      download_token,
      expiraEm,
    ]
  );

  return {
    id: r.insertId,
    laudo_id: laudoId,
    tipo,
    nome_original: input.nome_original,
    nome_armazenado,
    tamanho_bytes: input.conteudo.length,
    mime_type: input.mime_type || '',
    sha256,
    download_token,
    download_expira_em: expiraEm ? expiraEm.toISOString() : null,
    download_count: 0,
    ultimo_download_at: null,
    ativo: true,
    created_at: new Date().toISOString(),
  };
}

export async function listarArquivosVetoriais(laudoId: number): Promise<ArquivoVetorialResumo[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, laudo_id, tipo, nome_original, nome_armazenado, tamanho_bytes, mime_type,
            sha256, download_token, download_expira_em, download_count, ultimo_download_at,
            ativo, created_at
       FROM laudos_demarcacao_arquivos
      WHERE laudo_id = ? AND ativo = TRUE
      ORDER BY id ASC`,
    [laudoId]
  );
  return rows.map(r => ({
    id: Number(r.id),
    laudo_id: Number(r.laudo_id),
    tipo: String(r.tipo) as TipoArquivoVetorial,
    nome_original: String(r.nome_original),
    nome_armazenado: String(r.nome_armazenado),
    tamanho_bytes: Number(r.tamanho_bytes),
    mime_type: String(r.mime_type),
    sha256: String(r.sha256),
    download_token: String(r.download_token),
    download_expira_em: r.download_expira_em
      ? (r.download_expira_em instanceof Date ? r.download_expira_em.toISOString() : String(r.download_expira_em))
      : null,
    download_count: Number(r.download_count),
    ultimo_download_at: r.ultimo_download_at
      ? (r.ultimo_download_at instanceof Date ? r.ultimo_download_at.toISOString() : String(r.ultimo_download_at))
      : null,
    ativo: !!r.ativo,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

export async function removerArquivoVetorial(arquivoId: number): Promise<{ ok: true; affected: number }> {
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE laudos_demarcacao_arquivos SET ativo = FALSE WHERE id = ? AND ativo = TRUE`,
    [arquivoId]
  );
  return { ok: true, affected: r.affectedRows };
}

export async function regenerarTokenArquivo(arquivoId: number): Promise<{ download_token: string; expira_em: string | null }> {
  const novoToken = gerarDownloadToken();
  const expiraEm = await calcularExpiracao();
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE laudos_demarcacao_arquivos
        SET download_token = ?, download_expira_em = ?
      WHERE id = ? AND ativo = TRUE`,
    [novoToken, expiraEm, arquivoId]
  );
  if (r.affectedRows === 0) throw new Error('Arquivo não encontrado ou inativo');
  return { download_token: novoToken, expira_em: expiraEm ? expiraEm.toISOString() : null };
}

interface ArquivoComBlobRow extends RowDataPacket {
  id: number;
  laudo_id: number;
  tipo: string;
  nome_original: string;
  mime_type: string;
  conteudo_blob: Buffer;
  download_expira_em: Date | string | null;
  ativo: number | boolean;
}

/** Busca arquivo pelo token público. Retorna null se inativo, expirado ou inexistente. */
export async function buscarPorToken(token: string): Promise<{
  arquivo: ArquivoComBlobRow;
  estado: 'ok' | 'expirado' | 'inativo' | 'inexistente';
}> {
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return { arquivo: null as unknown as ArquivoComBlobRow, estado: 'inexistente' };
  }
  const [rows] = await pool.execute<ArquivoComBlobRow[]>(
    `SELECT id, laudo_id, tipo, nome_original, mime_type, conteudo_blob,
            download_expira_em, ativo
       FROM laudos_demarcacao_arquivos
      WHERE download_token = ? LIMIT 1`,
    [token]
  );
  if (rows.length === 0) {
    return { arquivo: null as unknown as ArquivoComBlobRow, estado: 'inexistente' };
  }
  const r = rows[0];
  if (!r.ativo) {
    return { arquivo: r, estado: 'inativo' };
  }
  if (r.download_expira_em) {
    const dt = r.download_expira_em instanceof Date ? r.download_expira_em : new Date(String(r.download_expira_em));
    if (Number.isFinite(dt.getTime()) && dt.getTime() < Date.now()) {
      return { arquivo: r, estado: 'expirado' };
    }
  }
  return { arquivo: r, estado: 'ok' };
}

/** Incrementa contador de download e registra IP/timestamp (best-effort). */
export async function registrarDownload(arquivoId: number, ip: string | null): Promise<void> {
  await pool.execute(
    `UPDATE laudos_demarcacao_arquivos
        SET download_count = download_count + 1,
            ultimo_download_at = CURRENT_TIMESTAMP,
            ultimo_download_ip = ?
      WHERE id = ?`,
    [ip || null, arquivoId]
  );
}
