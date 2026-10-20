import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { configAssinatura } from './config.js';
import { decifrar } from './cofre.js';
import { abrirPfx, descartar, ErroSenhaCertificado, type CertificadoCarregado } from './certificado.js';
import { assinarPdf } from './assinador.js';
import type { PosicaoCarimbo } from './carimbo.js';

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export interface ContextoRequisicao {
  ip?: string | null;
  userAgent?: string | null;
}

export interface NovoDocumento {
  pdf: Buffer;
  titulo: string;
  tipo: string;
  obra?: string | null;
  motivo?: string;
  posicao?: PosicaoCarimbo;
  origem?: string;
}

export interface DocumentoRow extends RowDataPacket {
  id: number;
  codigo: string;
  titulo: string;
  tipo: string;
  obra: string | null;
  motivo: string;
  carimbo_posicao: PosicaoCarimbo;
  arquivo_original: string;
  hash_original: string;
  arquivo_assinado: string | null;
  hash_assinado: string | null;
  status: 'pendente' | 'assinado' | 'rejeitado' | 'erro';
  motivo_rejeicao: string | null;
  erro: string | null;
  origem: string;
  criado_em: Date;
  assinado_em: Date | null;
}

interface CertRow extends RowDataPacket {
  id: number;
  titular: string;
  cpf: string | null;
  emissor: string;
  serial: string;
  valido_de: Date;
  valido_ate: Date;
  pfx_cifrado: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export interface ResultadoAssinatura {
  id: number;
  codigo: string;
  titulo: string;
  ok: boolean;
  hashAssinado?: string;
  erro?: string;
}

const dirOriginais = () => path.join(configAssinatura.storageDir, 'originais');
const dirAssinados = () => path.join(configAssinatura.storageDir, 'assinados');

export async function auditar(
  pool: Pool,
  acao: string,
  ctx: ContextoRequisicao,
  extra: { documentoId?: number | null; detalhe?: string | null; hash?: string | null } = {},
): Promise<void> {
  await pool.execute(
    `INSERT INTO assinatura_auditoria (documento_id, acao, detalhe, ip, user_agent, hash_documento)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      extra.documentoId ?? null,
      acao,
      extra.detalhe?.slice(0, 1000) ?? null,
      ctx.ip?.slice(0, 64) ?? null,
      ctx.userAgent?.slice(0, 255) ?? null,
      extra.hash ?? null,
    ],
  );
}

/** Enfileira um PDF para aprovação/assinatura do RT. Pode ser chamado direto pelos geradores da ZAYRA. */
export async function enfileirarDocumento(pool: Pool, doc: NovoDocumento, ctx: ContextoRequisicao = {}): Promise<DocumentoRow> {
  if (doc.pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Arquivo não é um PDF válido');
  const titulo = doc.titulo.trim().slice(0, 255);
  if (!titulo) throw new Error('Título do documento é obrigatório');

  await mkdir(dirOriginais(), { recursive: true });
  const codigo = randomBytes(6).toString('hex').toUpperCase();
  const arquivo = path.join(dirOriginais(), `${codigo}.pdf`);
  await writeFile(arquivo, doc.pdf, { flag: 'wx' });
  const hash = sha256(doc.pdf);

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO assinatura_documentos
       (codigo, titulo, tipo, obra, motivo, carimbo_posicao, arquivo_original, hash_original, origem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      codigo,
      titulo,
      doc.tipo.trim().slice(0, 40) || 'documento',
      doc.obra?.trim().slice(0, 120) || null,
      (doc.motivo?.trim() || 'Responsável Técnico — autoria e responsabilidade técnica').slice(0, 255),
      doc.posicao ?? 'inferior-esquerda',
      arquivo,
      hash,
      (doc.origem ?? 'zayra').slice(0, 60),
    ],
  );
  await auditar(pool, 'enfileirado', ctx, { documentoId: r.insertId, detalhe: titulo, hash });
  const criado = await obterDocumento(pool, r.insertId);
  if (!criado) throw new Error('Falha ao registrar documento');
  return criado;
}

export async function obterDocumento(pool: Pool, id: number): Promise<DocumentoRow | null> {
  const [rows] = await pool.execute<DocumentoRow[]>('SELECT * FROM assinatura_documentos WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function listarDocumentos(pool: Pool, status: string, limite = 100): Promise<DocumentoRow[]> {
  const lim = Math.min(Math.max(Math.trunc(limite) || 100, 1), 500);
  const [rows] = await pool.query<DocumentoRow[]>(
    `SELECT id, codigo, titulo, tipo, obra, motivo, carimbo_posicao, hash_original, hash_assinado,
            status, motivo_rejeicao, erro, origem, criado_em, assinado_em
       FROM assinatura_documentos WHERE status = ? ORDER BY criado_em ASC LIMIT ${lim}`,
    [status],
  );
  return rows;
}

async function certificadoAtivo(pool: Pool): Promise<CertRow> {
  const [rows] = await pool.execute<CertRow[]>(
    'SELECT * FROM assinatura_certificados WHERE ativo = 1 ORDER BY valido_ate DESC LIMIT 1',
  );
  const c = rows[0];
  if (!c) throw new Error('Nenhum certificado ativo. Execute scripts/importar-certificado.ts');
  return c;
}

export async function statusCertificado(pool: Pool) {
  const c = await certificadoAtivo(pool);
  const dias = Math.floor((new Date(c.valido_ate).getTime() - Date.now()) / 86_400_000);
  return {
    titular: c.titular,
    emissor: c.emissor,
    serial: c.serial,
    validoDe: c.valido_de,
    validoAte: c.valido_ate,
    diasRestantes: dias,
    vencido: dias < 0,
    alerta: dias >= 0 && dias <= configAssinatura.diasAlertaVencimento,
  };
}

export async function salvarCertificado(pool: Pool, pfx: Buffer, cert: CertificadoCarregado, cifrado: { dados: Buffer; iv: Buffer; tag: Buffer }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE assinatura_certificados SET ativo = 0');
    await conn.execute(
      `INSERT INTO assinatura_certificados
         (titular, cpf, emissor, serial, valido_de, valido_ate, pfx_cifrado, iv, tag, ativo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE pfx_cifrado = VALUES(pfx_cifrado), iv = VALUES(iv), tag = VALUES(tag),
                               valido_de = VALUES(valido_de), valido_ate = VALUES(valido_ate), ativo = 1`,
      [cert.titular, cert.cpf, cert.emissor, cert.serial, cert.validoDe, cert.validoAte, cifrado.dados, cifrado.iv, cifrado.tag],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await auditar(pool, 'certificado_importado', {}, { detalhe: `${cert.titular} · serial ${cert.serial}`, hash: sha256(pfx) });
}

/**
 * Aprovação do RT: a senha do PFX é informada a cada lote, usada só em memória e descartada.
 * Sem a senha, nem quem tiver o banco + a chave mestra consegue assinar.
 */
export async function aprovarEAssinar(pool: Pool, ids: number[], senha: string, ctx: ContextoRequisicao): Promise<ResultadoAssinatura[]> {
  const registro = await certificadoAtivo(pool);
  const pfx = decifrar({ dados: registro.pfx_cifrado, iv: registro.iv, tag: registro.tag }, configAssinatura.masterKey);

  let cert: CertificadoCarregado;
  try {
    cert = abrirPfx(pfx, senha);
  } finally {
    pfx.fill(0);
  }

  try {
    const agora = new Date();
    if (agora < cert.validoDe || agora > cert.validoAte) {
      throw new Error(`Certificado fora da validade (${cert.validoDe.toISOString()} a ${cert.validoAte.toISOString()})`);
    }
    if (!cert.icpBrasil) throw new Error('Certificado não pertence à cadeia ICP-Brasil');

    await mkdir(dirAssinados(), { recursive: true });
    const resultados: ResultadoAssinatura[] = [];

    for (const id of ids) {
      const doc = await obterDocumento(pool, id);
      if (!doc) {
        resultados.push({ id, codigo: '', titulo: '', ok: false, erro: 'Documento não encontrado' });
        continue;
      }
      if (doc.status !== 'pendente' && doc.status !== 'erro') {
        resultados.push({ id, codigo: doc.codigo, titulo: doc.titulo, ok: false, erro: `Status atual: ${doc.status}` });
        continue;
      }
      try {
        const original = await readFile(doc.arquivo_original);
        if (sha256(original) !== doc.hash_original) {
          throw new Error('Integridade violada: o arquivo foi alterado depois de enfileirado');
        }
        await auditar(pool, 'aprovado', ctx, { documentoId: id, hash: doc.hash_original });

        const assinado = await assinarPdf(original, cert, {
          motivo: doc.motivo,
          codigo: doc.codigo,
          posicao: doc.carimbo_posicao,
        });
        const destino = path.join(dirAssinados(), `${doc.codigo}-assinado.pdf`);
        await writeFile(destino, assinado);
        const hashAssinado = sha256(assinado);

        await pool.execute(
          `UPDATE assinatura_documentos
              SET status = 'assinado', arquivo_assinado = ?, hash_assinado = ?, erro = NULL,
                  certificado_id = ?, assinado_em = NOW()
            WHERE id = ?`,
          [destino, hashAssinado, registro.id, id],
        );
        await auditar(pool, 'assinado', ctx, { documentoId: id, hash: hashAssinado });
        resultados.push({ id, codigo: doc.codigo, titulo: doc.titulo, ok: true, hashAssinado });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await pool.execute(`UPDATE assinatura_documentos SET status = 'erro', erro = ? WHERE id = ?`, [msg.slice(0, 1000), id]);
        await auditar(pool, 'erro', ctx, { documentoId: id, detalhe: msg });
        resultados.push({ id, codigo: doc.codigo, titulo: doc.titulo, ok: false, erro: msg });
      }
    }
    return resultados;
  } finally {
    descartar(cert);
  }
}

export async function rejeitar(pool: Pool, ids: number[], motivo: string, ctx: ContextoRequisicao): Promise<number> {
  let total = 0;
  for (const id of ids) {
    const [r] = await pool.execute<ResultSetHeader>(
      `UPDATE assinatura_documentos SET status = 'rejeitado', motivo_rejeicao = ?
        WHERE id = ? AND status IN ('pendente','erro')`,
      [motivo.slice(0, 500), id],
    );
    if (r.affectedRows) {
      total += 1;
      await auditar(pool, 'rejeitado', ctx, { documentoId: id, detalhe: motivo });
    }
  }
  return total;
}

export { ErroSenhaCertificado };
