// v1.99.3 — Orquestracao de assinatura digital ICP-Brasil de recibos.
//
// Fluxo POST /api/recibos/:id/assinar:
//   1) Busca recibo
//   2) Mapeia emitente_perfil -> perfil cert (pj|pf)
//   3) Busca cert ativo do perfil
//   4) Gera PDF original (com bloco "Assinado digitalmente" se ja foi assinado antes)
//   5) Assina via PAdES (PKCS#7 incorporado)
//   6) Salva pdf_assinado + meta no banco
//   7) Retorna meta (sem o blob pra payload pequeno)

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { buscarReciboPorId } from './recibos';
import { gerarPdfRecibo } from '../services/reciboPdf';
import {
  getCertForSigning,
  type Perfil,
  type SigningCertMeta,
} from '../services/signingCertificates';
import { signPdfBuffer } from '../services/pdfSigner';

export interface AssinarReciboResult {
  recibo_id: number;
  numero: string;
  assinado_em: string;
  perfil: Perfil;
  cert: {
    id: number;
    label: string;
    subject_cn: string | null;
    subject_doc: string | null;
    issuer_cn: string | null;
    thumbprint: string | null;
    validade_ate: string | null;
  };
  pdf_size_bytes: number;
}

/** Mapeia emitente_perfil do recibo (texto livre) pra perfil do cert. */
function perfilDoEmitente(emitente_perfil: string | null | undefined): Perfil {
  const v = (emitente_perfil ?? '').toLowerCase();
  if (v.includes('pf') || v.includes('pessoa_fisica') || v.includes('jose_romario')) {
    return 'pf';
  }
  return 'pj'; // default Romatec PJ
}

export async function assinarRecibo(reciboId: number | string): Promise<AssinarReciboResult> {
  const recibo = await buscarReciboPorId(reciboId);
  if (!recibo) throw new Error('Recibo nao encontrado');

  const perfil = perfilDoEmitente(recibo.emitente_perfil);

  const certData = await getCertForSigning(perfil);
  if (!certData) {
    throw new Error(
      `Nenhum certificado digital ${perfil.toUpperCase()} cadastrado. ` +
      `Cadastre um .pfx em /obras admin antes de assinar.`
    );
  }

  // Avisa se ja vencido (mas nao impede — cert vencido ainda assina, apenas
  // a verificacao posterior aponta como nao-confiavel)
  if (certData.meta.expirado) {
    console.warn(`[assinatura] cert ${certData.meta.id} VENCIDO em ${certData.meta.validade_ate}`);
  }

  // Gera PDF original
  const pdfBuffer = await gerarPdfRecibo(recibo);

  // Metadados de assinatura
  const signMeta = {
    name: certData.meta.subject_cn ?? `Recibo ${recibo.numero}`,
    reason: `Recibo ${recibo.numero} - ${recibo.tipo}`,
    location: 'Acailandia/MA',
    contactInfo: certData.meta.subject_doc ?? '',
  };

  // Assina (PAdES via @signpdf)
  const pdfAssinado = await signPdfBuffer(
    pdfBuffer,
    certData.pfx,
    certData.senha,
    signMeta,
  );

  const agora = new Date();
  const meta = {
    perfil,
    cert_id: certData.meta.id,
    cert_label: certData.meta.label,
    subject_cn: certData.meta.subject_cn,
    subject_doc: certData.meta.subject_doc,
    issuer_cn: certData.meta.issuer_cn,
    thumbprint: certData.meta.thumbprint,
    validade_ate: certData.meta.validade_ate,
    assinado_em: agora.toISOString(),
    sign_reason: signMeta.reason,
    sign_location: signMeta.location,
  };

  // Persiste no banco
  await pool.execute<ResultSetHeader>(
    `UPDATE recibos
     SET pdf_assinado = ?,
         assinado_em = ?,
         assinado_por_cert_id = ?,
         assinatura_meta = ?
     WHERE id = ?`,
    [pdfAssinado, agora, certData.meta.id, JSON.stringify(meta), recibo.id]
  );

  return {
    recibo_id: recibo.id,
    numero: recibo.numero,
    assinado_em: agora.toISOString(),
    perfil,
    cert: {
      id: certData.meta.id,
      label: certData.meta.label,
      subject_cn: certData.meta.subject_cn,
      subject_doc: certData.meta.subject_doc,
      issuer_cn: certData.meta.issuer_cn,
      thumbprint: certData.meta.thumbprint,
      validade_ate: certData.meta.validade_ate,
    },
    pdf_size_bytes: pdfAssinado.length,
  };
}

interface ReciboAssinadoRow extends RowDataPacket {
  id: number;
  pdf_assinado: Buffer | null;
  assinado_em: Date | string | null;
  assinatura_meta: string | Record<string, unknown> | null;
}

/** Retorna PDF assinado (Buffer). null se ainda nao foi assinado. */
export async function getReciboPdfAssinado(reciboId: number | string): Promise<{
  pdf: Buffer;
  assinado_em: string;
  meta: Record<string, unknown>;
} | null> {
  const [rows] = await pool.execute<ReciboAssinadoRow[]>(
    `SELECT id, pdf_assinado, assinado_em, assinatura_meta
     FROM recibos WHERE id = ? LIMIT 1`,
    [reciboId]
  );
  if (!rows.length || !rows[0].pdf_assinado) return null;
  const r = rows[0];
  const meta = typeof r.assinatura_meta === 'string'
    ? JSON.parse(r.assinatura_meta)
    : (r.assinatura_meta ?? {});
  const assinadoEm = r.assinado_em
    ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
    : '';
  return {
    pdf: r.pdf_assinado as Buffer,
    assinado_em: assinadoEm,
    meta,
  };
}

/** Status de assinatura sem retornar o PDF. */
export async function getStatusAssinatura(reciboId: number | string): Promise<{
  assinado: boolean;
  assinado_em: string | null;
  meta: Record<string, unknown> | null;
}> {
  const [rows] = await pool.execute<ReciboAssinadoRow[]>(
    `SELECT id, assinado_em, assinatura_meta,
            CASE WHEN pdf_assinado IS NULL THEN 0 ELSE 1 END AS tem_pdf
     FROM recibos WHERE id = ? LIMIT 1`,
    [reciboId]
  );
  if (!rows.length) throw new Error('Recibo nao encontrado');
  const r = rows[0] as ReciboAssinadoRow & { tem_pdf: number };
  if (!r.tem_pdf) return { assinado: false, assinado_em: null, meta: null };
  const meta = typeof r.assinatura_meta === 'string'
    ? JSON.parse(r.assinatura_meta)
    : (r.assinatura_meta ?? null);
  const assinadoEm = r.assinado_em
    ? (r.assinado_em instanceof Date ? r.assinado_em.toISOString() : String(r.assinado_em))
    : null;
  return { assinado: true, assinado_em: assinadoEm, meta };
}
