// v3.4.0 — Orquestracao de assinatura digital ICP-Brasil de vistorias.
//
// Diferente de recibos (PJ default), vistoria assina como PF por padrao
// (e ato tecnico do profissional/RT, nao da empresa). Override via opts.perfil.
//
// Fluxo POST /api/vistorias/:id/assinar:
//   1) Busca vistoria
//   2) Resolve perfil (PF default, PJ se body explicito)
//   3) Busca cert ativo do perfil
//   4) Gera PDF base com bloco visual de assinatura ja incluido
//   5) Assina via PAdES (PKCS#7 incorporado)
//   6) Salva pdf_assinado + meta no banco
//   7) Retorna meta (sem o blob)

import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import pool from '../database/connection';
import { buscarVistoria, gerarPdfVistoria } from './vistorias';
import type { SignatureVisualMeta } from './vistorias';
import {
  getCertForSigning,
  type Perfil,
} from '../services/signingCertificates';
import { signPdfBuffer } from '../services/pdfSigner';

export interface AssinarVistoriaResult {
  vistoria_id: number;
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

export interface AssinarVistoriaOpts {
  /** Perfil do certificado. Default: 'pf' (RT como profissional tecnico). */
  perfil?: Perfil;
}

export async function assinarVistoria(
  vistoriaId: number | string,
  opts: AssinarVistoriaOpts = {}
): Promise<AssinarVistoriaResult> {
  const vistoria = await buscarVistoria(String(vistoriaId));
  if (!vistoria) throw new Error('Vistoria nao encontrada');

  const perfil: Perfil = opts.perfil ?? 'pf';  // v3.4.0: PF default (diferente de recibo)

  const certData = await getCertForSigning(perfil);
  if (!certData) {
    throw new Error(
      `Nenhum certificado digital ${perfil.toUpperCase()} cadastrado. ` +
      `Cadastre um .pfx em /obras admin antes de assinar.`
    );
  }

  if (certData.meta.expirado) {
    console.warn(`[vto:assinatura] cert ${certData.meta.id} VENCIDO em ${certData.meta.validade_ate}`);
  }

  // Monta metadata visual ANTES de gerar o PDF
  const agora = new Date();
  const signatureVisualMeta: SignatureVisualMeta = {
    signer_cn: certData.meta.subject_cn ?? `Vistoria #${vistoria.id}`,
    signer_doc: certData.meta.subject_doc,
    issuer_cn: certData.meta.issuer_cn,
    validade_ate: certData.meta.validade_ate,
    data_assinatura: agora,
    thumbprint: certData.meta.thumbprint,
  };

  // Gera PDF JA COM bloco visual de assinatura
  const pdfBuffer = await gerarPdfVistoria(vistoria.id, signatureVisualMeta);

  const signMeta = {
    name: certData.meta.subject_cn ?? `Vistoria ${vistoria.id}`,
    reason: `Vistoria #${vistoria.id} - ${vistoria.titulo || 'Sem titulo'}`,
    location: 'Acailandia/MA',
    contactInfo: certData.meta.subject_doc ?? '',
  };

  const pdfAssinado = await signPdfBuffer(
    pdfBuffer,
    certData.pfx,
    certData.senha,
    signMeta,
  );

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

  await pool.execute<ResultSetHeader>(
    `UPDATE romatec_obra_vistorias
     SET pdf_assinado = ?,
         assinado_em = ?,
         assinado_por_cert_id = ?,
         assinatura_meta = ?
     WHERE id = ?`,
    [pdfAssinado, agora, certData.meta.id, JSON.stringify(meta), vistoria.id]
  );

  return {
    vistoria_id: Number(vistoria.id),
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

interface VistoriaAssinadaRow extends RowDataPacket {
  id: number;
  pdf_assinado: Buffer | null;
  assinado_em: Date | string | null;
  assinatura_meta: string | Record<string, unknown> | null;
}

/** Retorna PDF assinado (Buffer). null se ainda nao foi assinado. */
export async function getVistoriaPdfAssinado(vistoriaId: number | string): Promise<{
  pdf: Buffer;
  assinado_em: string;
  meta: Record<string, unknown>;
} | null> {
  const [rows] = await pool.execute<VistoriaAssinadaRow[]>(
    `SELECT id, pdf_assinado, assinado_em, assinatura_meta
     FROM romatec_obra_vistorias WHERE id = ? LIMIT 1`,
    [vistoriaId]
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
