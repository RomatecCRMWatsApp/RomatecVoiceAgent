// src/modules/assinatura/chatLotes.ts
// v3.152.0 — Lotes de assinatura iniciados pelo chat do Claude.
// Um "lote" agrupa 1..N PDFs de um mesmo envio sob um token de aprovação de uso
// único (30 min). O token puro só existe no link enviado ao RT (Telegram/WhatsApp);
// no banco fica só o sha256. A aprovação reaproveita aprovarEAssinar()/rejeitar()
// do serviço existente — a senha do A1 é digitada na página, nunca trafega no chat.
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { PDFDocument } from 'pdf-lib';
import { configAssinatura } from './config.js';
import type { PosicaoCarimbo } from './carimbo.js';
import {
  aprovarEAssinar,
  auditar,
  enfileirarDocumento,
  obterDocumento,
  rejeitar,
  type ContextoRequisicao,
  type DocumentoRow,
  type ResultadoAssinatura,
} from './servico.js';

const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Lote indisponível para a ação (expirado, já usado, ou status final). */
export class ErroLoteIndisponivel extends Error {
  constructor(public readonly codigo: 'nao_encontrado' | 'expirado' | 'usado' | 'finalizado', mensagem: string) {
    super(mensagem);
    this.name = 'ErroLoteIndisponivel';
  }
}

export interface ArquivoLote {
  pdf: Buffer;
  titulo: string;
}

export interface ParamsLote {
  tituloLote: string;
  tipo: string;
  obra?: string | null;
  motivo?: string;
  posicao?: PosicaoCarimbo;
  arquivos: ArquivoLote[];
}

export interface DocumentoResumo {
  id: number;
  codigo: string;
  titulo: string;
  hash: string;
  paginas: number;
  tamanho: number;
}

export interface LoteCriado {
  loteId: string;
  token: string;
  expiraEm: Date;
  documentos: DocumentoResumo[];
}

export interface LoteRow extends RowDataPacket {
  id: string;
  titulo: string;
  token_hash: string;
  origem: string;
  expira_em: Date;
  status: 'aguardando' | 'assinado' | 'rejeitado' | 'expirado' | 'erro';
  usado_em: Date | null;
  criado_em: Date;
}

export interface DocLoteRow extends RowDataPacket {
  id: number;
  codigo: string;
  titulo: string;
  status: DocumentoRow['status'];
  hash_original: string;
  hash_assinado: string | null;
}

/** Conta páginas do PDF (tolerante a falha — só pra exibição). */
export async function contarPaginas(pdf: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

/** Cria o lote, enfileira os PDFs (origem='claude-chat'), gera o token de aprovação. */
export async function criarLote(pool: Pool, params: ParamsLote, ctx: ContextoRequisicao = {}): Promise<LoteCriado> {
  const arquivos = params.arquivos ?? [];
  if (arquivos.length === 0) throw new Error('Envie ao menos um PDF no campo "pdf"');
  if (arquivos.length > configAssinatura.loteMaxDocs) {
    throw new Error(`Máximo de ${configAssinatura.loteMaxDocs} documentos por lote`);
  }
  const tituloLote = (params.tituloLote || '').trim().slice(0, 255) || 'Lote de assinatura';

  const loteId = randomBytes(8).toString('hex'); // 16 hex chars
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256hex(token);
  const expiraEm = new Date(Date.now() + configAssinatura.loteExpiraMinutos * 60_000);

  await pool.execute(
    `INSERT INTO assinatura_lotes (id, titulo, token_hash, origem, expira_em, status)
     VALUES (?, ?, ?, 'claude-chat', ?, 'aguardando')`,
    [loteId, tituloLote, tokenHash, expiraEm],
  );

  const documentos: DocumentoResumo[] = [];
  for (const arq of arquivos) {
    const doc = await enfileirarDocumento(
      pool,
      {
        pdf: arq.pdf,
        titulo: arq.titulo,
        tipo: params.tipo,
        obra: params.obra ?? null,
        motivo: params.motivo,
        posicao: params.posicao,
        origem: 'claude-chat',
      },
      ctx,
    );
    await pool.execute('UPDATE assinatura_documentos SET lote_id = ? WHERE id = ?', [loteId, doc.id]);
    documentos.push({
      id: doc.id,
      codigo: doc.codigo,
      titulo: doc.titulo,
      hash: doc.hash_original,
      paginas: await contarPaginas(arq.pdf),
      tamanho: arq.pdf.length,
    });
  }

  await auditar(pool, 'lote_criado', ctx, { detalhe: `${loteId} · ${documentos.length} doc(s) · ${tituloLote}` });
  return { loteId, token, expiraEm, documentos };
}

/** Status efetivo do lote: aguardando vencido vira 'expirado' (sem gravar). */
function statusEfetivo(l: LoteRow): LoteRow['status'] {
  if (l.status === 'aguardando' && new Date(l.expira_em).getTime() < Date.now()) return 'expirado';
  return l.status;
}

async function docsDoLote(pool: Pool, loteId: string): Promise<DocLoteRow[]> {
  const [rows] = await pool.execute<DocLoteRow[]>(
    `SELECT id, codigo, titulo, status, hash_original, hash_assinado FROM assinatura_documentos WHERE lote_id = ? ORDER BY id ASC`,
    [loteId],
  );
  return rows;
}

export interface LoteComDocs {
  lote: LoteRow;
  statusEfetivo: LoteRow['status'];
  documentos: DocLoteRow[];
}

/** Busca o lote pelo token puro (compara sha256). Não decide disponibilidade. */
export async function buscarLotePorToken(pool: Pool, token: string): Promise<LoteComDocs | null> {
  const tokenHash = sha256hex(String(token || ''));
  const [rows] = await pool.execute<LoteRow[]>('SELECT * FROM assinatura_lotes WHERE token_hash = ? LIMIT 1', [tokenHash]);
  const lote = rows[0];
  if (!lote) return null;
  return { lote, statusEfetivo: statusEfetivo(lote), documentos: await docsDoLote(pool, lote.id) };
}

/** True se o lote pode receber ação (aguardando, não expirado, não usado). */
export function loteDisponivel(info: LoteComDocs): boolean {
  return info.statusEfetivo === 'aguardando' && !info.lote.usado_em;
}

/** Garante que o lote pode receber ação; senão lança ErroLoteIndisponivel. */
function exigirDisponivel(info: LoteComDocs): void {
  if (info.statusEfetivo === 'expirado') throw new ErroLoteIndisponivel('expirado', 'Link expirado');
  if (!loteDisponivel(info)) throw new ErroLoteIndisponivel('usado', 'Link já utilizado');
}

/**
 * Aprova e assina todos os docs pendentes do lote. A senha é validada por
 * aprovarEAssinar (abre o PFX); se a senha estiver errada, ErroSenhaCertificado
 * é lançado ANTES de assinar e o token NÃO é consumido (o chamador trata o lockout).
 */
export async function aprovarLote(pool: Pool, token: string, senha: string, ctx: ContextoRequisicao): Promise<ResultadoAssinatura[]> {
  const info = await buscarLotePorToken(pool, token);
  if (!info) throw new ErroLoteIndisponivel('nao_encontrado', 'Link inválido');
  exigirDisponivel(info);

  const ids = info.documentos.filter((d) => d.status === 'pendente' || d.status === 'erro').map((d) => d.id);
  if (ids.length === 0) throw new ErroLoteIndisponivel('finalizado', 'Nenhum documento pendente neste lote');

  const resultados = await aprovarEAssinar(pool, ids, senha, ctx); // pode lançar ErroSenhaCertificado (token intacto)

  const houveFalha = resultados.some((r) => !r.ok);
  const novoStatus = houveFalha ? 'erro' : 'assinado';
  await pool.execute(`UPDATE assinatura_lotes SET status = ?, usado_em = NOW() WHERE id = ?`, [novoStatus, info.lote.id]);
  await auditar(pool, 'lote_aprovado', ctx, { detalhe: `${info.lote.id} · ${resultados.filter((r) => r.ok).length}/${ids.length} ok` });
  return resultados;
}

export async function rejeitarLote(pool: Pool, token: string, motivo: string, ctx: ContextoRequisicao): Promise<number> {
  const info = await buscarLotePorToken(pool, token);
  if (!info) throw new ErroLoteIndisponivel('nao_encontrado', 'Link inválido');
  exigirDisponivel(info);
  const ids = info.documentos.filter((d) => d.status === 'pendente' || d.status === 'erro').map((d) => d.id);
  const total = await rejeitar(pool, ids, motivo || 'Rejeitado na aprovação', ctx);
  await pool.execute(`UPDATE assinatura_lotes SET status = 'rejeitado', usado_em = NOW() WHERE id = ?`, [info.lote.id]);
  return total;
}

export interface StatusLote {
  status: LoteRow['status'];
  expiraEm: Date;
  documentos: Array<{ id: number; titulo: string; status: DocumentoRow['status']; hashAssinado: string | null }>;
}

/** Status do lote por id (para o long-poll do Claude). */
export async function statusLotePorId(pool: Pool, loteId: string): Promise<StatusLote | null> {
  const [rows] = await pool.execute<LoteRow[]>('SELECT * FROM assinatura_lotes WHERE id = ? LIMIT 1', [loteId]);
  const lote = rows[0];
  if (!lote) return null;
  const docs = await docsDoLote(pool, lote.id);
  return {
    status: statusEfetivo(lote),
    expiraEm: lote.expira_em,
    documentos: docs.map((d) => ({ id: d.id, titulo: d.titulo, status: d.status, hashAssinado: d.hash_assinado })),
  };
}

/** Documento assinado de um lote do chat (só origem='claude-chat'). null se não existir/não for do chat/não assinado. */
export async function documentoAssinadoChat(pool: Pool, id: number): Promise<DocumentoRow | null> {
  const doc = await obterDocumento(pool, id);
  if (!doc || doc.origem !== 'claude-chat') return null;
  if (doc.status !== 'assinado' || !doc.arquivo_assinado) return null;
  return doc;
}

/** Marca como 'expirado' os lotes aguardando que passaram da validade. Retorna quantos. */
export async function expirarLotesVencidos(pool: Pool): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE assinatura_lotes SET status = 'expirado' WHERE status = 'aguardando' AND expira_em < NOW()`,
  );
  return r.affectedRows ?? 0;
}
