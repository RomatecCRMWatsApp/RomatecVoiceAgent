// v3.142.0 — Documentos do módulo PA: upload, download auditado (LGPD) e export
// ZIP do acervo no layout LOTE-XX-Nome/. Binário em pa_documentos_arquivos
// (Railway não tem disco); `caminho` é o caminho lógico dentro do acervo.
import { createHash } from 'node:crypto';
import type { Archiver } from 'archiver';
import type { Writable } from 'node:stream';
import { PaErro } from './erros';
import { pool, rows, one, exec, transacao, num, isoDateTime, registrarEvento } from './paDb';
import { buscarAssociado, buscarProjeto } from './paRepo';
import { mimePorNome } from './seedPlan';

// archiver instalado é 7.x (função-fábrica) e @types/archiver é 8.x (classes):
// importa via require tipando só o que usamos.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver') as (formato: 'zip', opcoes?: { zlib?: { level?: number } }) => Archiver;

export const TIPOS_DOCUMENTO = [
  'FOTO_3X4', 'DOC_IDENTIFICACAO', 'CERTIDAO', 'DOC_CONJUGE', 'COMPROVANTE_SINAL', 'PROCESSO_FICHA_CONTRATO',
  'PROCESSO_ASSINADO', 'CARTEIRINHA', 'MAPA_LOTE', 'MEMORIAL', 'TRT', 'RELATORIO', 'ORIGINAL', 'OUTRO',
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

const MIMES_ACEITOS = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|text\/plain)$/i;

/** Confere a assinatura do arquivo (magic bytes) contra o mime declarado. */
export function conteudoConfere(buf: Buffer, mime: string): boolean {
  if (/pdf/i.test(mime)) return buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (/jpeg/i.test(mime)) return buf[0] === 0xff && buf[1] === 0xd8;
  if (/png/i.test(mime)) return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (/webp/i.test(mime)) return buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (/officedocument/i.test(mime)) return buf[0] === 0x50 && buf[1] === 0x4b;
  return true; // heic/txt: sem assinatura simples confiável
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function nomeSeguro(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._\-]+/g, '-').replace(/-+/g, '-').slice(-120) || 'arquivo';
}

export async function uploadDocumento(
  aid: number,
  tipoRaw: unknown,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  usuario: string | null,
) {
  const tipo = String(tipoRaw ?? '').toUpperCase() as TipoDocumento;
  if (!TIPOS_DOCUMENTO.includes(tipo)) throw new PaErro('CAMPO_INVALIDO', 'tipo de documento inválido', 400);
  if (!file?.buffer?.length) throw new PaErro('ARQUIVO_VAZIO', 'Arquivo vazio', 400);
  const mime = file.mimetype && file.mimetype !== 'application/octet-stream' ? file.mimetype : mimePorNome(file.originalname);
  if (!MIMES_ACEITOS.test(mime)) throw new PaErro('TIPO_ARQUIVO', `Tipo de arquivo não aceito (${mime})`, 415);
  if (!conteudoConfere(file.buffer, mime)) throw new PaErro('TIPO_ARQUIVO', 'Conteúdo do arquivo não confere com a extensão', 415);

  const a = await buscarAssociado(aid);
  const projeto = await buscarProjeto(a.projeto_id);
  const hash = sha256(file.buffer);
  const pasta = a.acervo_pasta || `LOTE-${a.lote}-${nomeSeguro(a.nome)}`;

  const doc = await transacao(async (c) => {
    const igual = await one(c, 'SELECT id FROM pa_documentos WHERE associado_id = ? AND sha256 = ?', [aid, hash]);
    if (igual) throw new PaErro('DOCUMENTO_DUPLICADO', `Este arquivo já está no acervo (documento #${igual.id})`, 409, { documento_id: num(igual.id) });
    const v = await one(c, 'SELECT COALESCE(MAX(versao), 0) AS v FROM pa_documentos WHERE associado_id = ? AND tipo = ? FOR UPDATE', [aid, tipo]);
    const versao = num(v?.v) + 1;
    const caminho = `${projeto.codigo}/${pasta}/${tipo.toLowerCase()}-v${versao}-${nomeSeguro(file.originalname)}`.slice(0, 400);
    const ins = await exec(c, `
      INSERT INTO pa_documentos (projeto_id, lote_id, associado_id, tipo, versao, caminho, nome_original, mime, sha256, tamanho, arquivo_presente)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
      a.projeto_id, a.lote_id, aid, tipo, versao, caminho, file.originalname.slice(0, 255), mime, hash, file.buffer.length,
    ]);
    await exec(c, 'INSERT INTO pa_documentos_arquivos (documento_id, conteudo) VALUES (?, ?)', [ins.insertId, file.buffer]);
    if (tipo === 'PROCESSO_ASSINADO') {
      await exec(c, "UPDATE pa_associados SET contrato_status = 'ASSINADO', contrato_assinado_em = COALESCE(contrato_assinado_em, NOW()) WHERE id = ?", [aid]);
    }
    await registrarEvento(c, { projeto_id: a.projeto_id, associado_id: aid, usuario, tipo: 'DOC_UPLOAD', dados: { documento_id: ins.insertId, tipo, versao, sha256: hash, tamanho: file.buffer.length } });
    return { id: ins.insertId, tipo, versao, caminho, sha256: hash, tamanho: file.buffer.length, mime };
  });
  return doc;
}

/** Download com auditoria OBRIGATÓRIA: se o evento não grava, o arquivo não sai. */
export async function baixarDocumento(docId: number, usuario: string | null, ip: string | null) {
  const d = await one(pool, 'SELECT * FROM pa_documentos WHERE id = ?', [docId]);
  if (!d) throw new PaErro('DOCUMENTO_NAO_ENCONTRADO', 'Documento não encontrado', 404);
  if (num(d.arquivo_presente) !== 1) throw new PaErro('ARQUIVO_AUSENTE', 'Documento indexado, mas o arquivo ainda não foi carregado (importe o acervo)', 404);
  const f = await one<{ conteudo: Buffer }>(pool, 'SELECT conteudo FROM pa_documentos_arquivos WHERE documento_id = ?', [docId]);
  if (!f) throw new PaErro('ARQUIVO_AUSENTE', 'Arquivo do documento não encontrado', 404);
  await exec(pool, 'INSERT INTO pa_eventos (projeto_id, associado_id, usuario_id, tipo, dados) VALUES (?, ?, ?, ?, ?)', [
    d.projeto_id, d.associado_id ?? null, usuario, 'DOC_LEITURA', JSON.stringify({ documento_id: docId, tipo: d.tipo, ip }),
  ]);
  return {
    conteudo: f.conteudo,
    mime: String(d.mime || 'application/octet-stream'),
    nome: String(d.nome_original || String(d.caminho).split('/').pop() || `documento-${docId}`),
  };
}

export async function listarDocumentosProjeto(projetoId: number, tipo?: string | null) {
  await buscarProjeto(projetoId);
  const params: unknown[] = [projetoId];
  let f = '';
  if (tipo && TIPOS_DOCUMENTO.includes(tipo.toUpperCase() as TipoDocumento)) { f = ' AND d.tipo = ?'; params.push(tipo.toUpperCase()); }
  const ds = await rows(pool, `
    SELECT d.id, d.tipo, d.versao, d.caminho, d.nome_original, d.mime, d.tamanho, d.arquivo_presente, d.criado_em,
      a.id AS associado_id, a.numero, a.nome, l.numero AS lote
    FROM pa_documentos d LEFT JOIN pa_associados a ON a.id = d.associado_id LEFT JOIN pa_lotes l ON l.id = d.lote_id
    WHERE d.projeto_id = ?${f} ORDER BY CAST(l.numero AS UNSIGNED), d.tipo, d.versao`, params);
  return ds.map((d) => ({
    id: num(d.id), tipo: String(d.tipo), versao: num(d.versao), caminho: String(d.caminho), nome_original: d.nome_original ?? null,
    mime: d.mime ?? null, tamanho: d.tamanho == null ? null : num(d.tamanho), arquivo_presente: num(d.arquivo_presente) === 1,
    criado_em: isoDateTime(d.criado_em), associado_id: d.associado_id == null ? null : num(d.associado_id),
    associado_numero: d.numero ?? null, associado_nome: d.nome ?? null, lote: d.lote ?? null,
  }));
}

/**
 * ZIP do acervo (mesma estrutura do pacote: <LOTE-XX-Nome>/<arquivo>). Lê um
 * blob por vez pra não carregar os ~124 MB do acervo inteiro em memória.
 */
export async function exportarAcervo(projetoId: number, destino: Writable, usuario: string | null): Promise<{ arquivos: number; bytes: number }> {
  const projeto = await buscarProjeto(projetoId);
  const docs = await rows(pool, 'SELECT id, caminho, tamanho FROM pa_documentos WHERE projeto_id = ? AND arquivo_presente = 1 ORDER BY caminho', [projetoId]);
  await exec(pool, 'INSERT INTO pa_eventos (projeto_id, usuario_id, tipo, dados) VALUES (?, ?, ?, ?)', [
    projetoId, usuario, 'ACERVO_EXPORT', JSON.stringify({ arquivos: docs.length }),
  ]);
  const zip = archiver('zip', { zlib: { level: 6 } });
  const fim = new Promise<void>((resolve, reject) => {
    destino.on('close', () => resolve());
    destino.on('finish', () => resolve());
    zip.on('error', reject);
  });
  zip.pipe(destino);
  let bytes = 0;
  const prefixo = `${projeto.codigo}/`;
  for (const d of docs) {
    const f = await one<{ conteudo: Buffer }>(pool, 'SELECT conteudo FROM pa_documentos_arquivos WHERE documento_id = ?', [d.id]);
    if (!f) continue;
    const caminho = String(d.caminho);
    zip.append(f.conteudo, { name: caminho.startsWith(prefixo) ? caminho.slice(prefixo.length) : caminho });
    bytes += f.conteudo.length;
  }
  await zip.finalize();
  await fim;
  return { arquivos: docs.length, bytes };
}
