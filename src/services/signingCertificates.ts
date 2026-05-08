// v1.99.3 — Gestao de certificados digitais ICP-Brasil (.pfx) por tenant.
//
// Um cert ATIVO por perfil (pj|pf) por tenant. .pfx e senha criptografados
// com cryptoSecrets.ts (AES-256-GCM). Metadados (subject, validade) extraidos
// do cert via node-forge no upload pra exibir na UI sem decrypt.
//
// SEGURANCA: getCertForSigning() retorna .pfx + senha plain. So usar em
// fluxo server-side de assinatura. NUNCA expor por API publica.

import * as forge from 'node-forge';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { encryptSecret, decryptSecret } from './cryptoSecrets';

export type Perfil = 'pj' | 'pf';

export interface SigningCertMeta {
  id: number;
  tenant_id: number;
  perfil: Perfil;
  label: string;
  subject_cn: string | null;
  subject_doc: string | null;
  issuer_cn: string | null;
  thumbprint: string | null;
  validade_de: string | null;
  validade_ate: string | null;
  ativo: boolean;
  created_at: string;
  expirado: boolean;
  dias_para_vencer: number | null;
}

interface CertRow extends RowDataPacket {
  id: number;
  tenant_id: number;
  perfil: Perfil;
  label: string;
  pfx_enc: Buffer;
  senha_enc: Buffer;
  subject_cn: string | null;
  subject_doc: string | null;
  issuer_cn: string | null;
  thumbprint: string | null;
  validade_de: Date | string | null;
  validade_ate: Date | string | null;
  ativo: 0 | 1;
  created_at: Date | string;
}

interface ExtractedCertInfo {
  subject_cn: string | null;
  subject_doc: string | null;
  issuer_cn: string | null;
  thumbprint: string;
  validade_de: Date;
  validade_ate: Date;
}

/** Extrai metadados do .pfx. Lanca erro se senha errada ou .pfx invalido. */
export function extractCertInfo(pfxBuffer: Buffer, senha: string): ExtractedCertInfo {
  let p12: forge.pkcs12.Pkcs12Pfx;
  // PKCS#12 historicamente codifica senha como BMPString (UTF-16BE). Algumas
  // implementacoes (Java, .NET antigo) usam ASCII/UTF-8. node-forge tenta o
  // BMPString primeiro; se falhar, tentamos a senha vazia (alguns .pfx tem
  // MAC sem senha) e depois variantes.
  const tentativas = [
    senha,                    // como digitada
    senha.normalize('NFC'),   // normalizado UTF-8
    senha.normalize('NFD'),   // forma decomposta
  ];
  let lastErr: Error | null = null;
  let asn1: forge.asn1.Asn1;
  try {
    const der = forge.util.createBuffer(pfxBuffer.toString('binary'));
    asn1 = forge.asn1.fromDer(der);
  } catch (err) {
    throw new Error(`Arquivo .pfx invalido (nao e PKCS#12): ${(err as Error).message}`);
  }

  let sucesso = false;
  for (const tentativa of tentativas) {
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(asn1, tentativa);
      sucesso = true;
      break;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  if (!sucesso) {
    const msg = lastErr?.message || 'desconhecido';
    console.error('[signing] forge falhou em todas as variantes de senha:', msg);
    if (/mac|invalid|password|integrity/i.test(msg)) {
      throw new Error(
        `Senha do certificado incorreta. Detalhe tecnico: ${msg.slice(0, 120)}. ` +
        `Se a senha esta certa, pode ser problema de encoding ou algoritmo nao suportado pelo node-forge.`
      );
    }
    throw new Error(`Falha ao ler .pfx: ${msg}`);
  }
  // @ts-expect-error — sucesso=true garante que p12 foi atribuido
  if (!p12) throw new Error('p12 nao inicializado');

  // Pega o primeiro cert do bag (cert do titular)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error('Certificado nao encontrado no .pfx');

  const cert = certBag.cert;

  // Subject CN (Common Name)
  const subjectCN = cert.subject.getField('CN')?.value as string | undefined;

  // Issuer CN
  const issuerCN = cert.issuer.getField('CN')?.value as string | undefined;

  // Thumbprint SHA-256 do cert DER
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(certDer);
  const thumbprint = md.digest().toHex();

  // Documento (CPF/CNPJ) — em ICP-Brasil vem em otherName ou no CN apos ":"
  // Padrao: "NOME:CPFCNPJ" ou "NOME:CNPJCNPJ" no CN, ou em subjectAltName
  let doc: string | null = null;
  if (subjectCN) {
    const m = subjectCN.match(/:(\d{11,14})$/);
    if (m) doc = m[1];
  }

  return {
    subject_cn: subjectCN ?? null,
    subject_doc: doc,
    issuer_cn: issuerCN ?? null,
    thumbprint,
    validade_de: cert.validity.notBefore,
    validade_ate: cert.validity.notAfter,
  };
}

function mapRow(r: CertRow): SigningCertMeta {
  const validadeAte = r.validade_ate
    ? (r.validade_ate instanceof Date ? r.validade_ate : new Date(r.validade_ate))
    : null;
  const now = new Date();
  const expirado = validadeAte ? validadeAte.getTime() < now.getTime() : false;
  const diasParaVencer = validadeAte
    ? Math.ceil((validadeAte.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    id: r.id,
    tenant_id: r.tenant_id,
    perfil: r.perfil,
    label: r.label,
    subject_cn: r.subject_cn,
    subject_doc: r.subject_doc,
    issuer_cn: r.issuer_cn,
    thumbprint: r.thumbprint,
    validade_de: r.validade_de
      ? (r.validade_de instanceof Date ? r.validade_de.toISOString() : String(r.validade_de))
      : null,
    validade_ate: validadeAte ? validadeAte.toISOString() : null,
    ativo: r.ativo === 1,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    expirado,
    dias_para_vencer: diasParaVencer,
  };
}

/** Lista todos certs do tenant (sem expor pfx/senha). */
export async function listCerts(tenant_id = 1): Promise<SigningCertMeta[]> {
  const [rows] = await pool.execute<CertRow[]>(
    `SELECT * FROM tenant_signing_certificates
     WHERE tenant_id = ?
     ORDER BY ativo DESC, created_at DESC`,
    [tenant_id]
  );
  return rows.map(mapRow);
}

/** Pega cert ATIVO de um perfil. */
export async function getCertAtivo(perfil: Perfil, tenant_id = 1): Promise<SigningCertMeta | null> {
  const [rows] = await pool.execute<CertRow[]>(
    `SELECT * FROM tenant_signing_certificates
     WHERE tenant_id = ? AND perfil = ? AND ativo = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [tenant_id, perfil]
  );
  return rows.length ? mapRow(rows[0]) : null;
}

/** Retorna pfx + senha PLAIN. USO INTERNO APENAS — fluxo de assinatura. */
export async function getCertForSigning(
  perfil: Perfil,
  tenant_id = 1
): Promise<{ pfx: Buffer; senha: string; meta: SigningCertMeta } | null> {
  const [rows] = await pool.execute<CertRow[]>(
    `SELECT * FROM tenant_signing_certificates
     WHERE tenant_id = ? AND perfil = ? AND ativo = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [tenant_id, perfil]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const senha = decryptSecret(r.senha_enc);
  if (!senha) throw new Error('Falha ao descriptografar senha do certificado');
  return { pfx: r.pfx_enc, senha, meta: mapRow(r) };
}

export interface UploadCertInput {
  tenant_id?: number;
  perfil: Perfil;
  label: string;
  pfx: Buffer;
  senha: string;
}

/** Upload de novo cert. Valida senha, extrai metadados, desativa anterior do mesmo perfil. */
export async function uploadCert(input: UploadCertInput): Promise<SigningCertMeta> {
  const tenant_id = input.tenant_id ?? 1;
  if (!input.label?.trim()) throw new Error('label obrigatorio');
  if (!['pj', 'pf'].includes(input.perfil)) throw new Error('perfil invalido (pj|pf)');
  if (!input.pfx?.length) throw new Error('arquivo .pfx vazio');
  if (!input.senha) throw new Error('senha obrigatoria');

  // Valida e extrai info — falha aqui se senha errada
  const info = extractCertInfo(input.pfx, input.senha);

  // Aviso se ja vencido (mas ainda permite cadastrar — pode ser pra teste)
  // Server avisa via campo expirado=true no retorno

  const senhaEnc = encryptSecret(input.senha);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Desativa cert ativo anterior do mesmo perfil
    await conn.execute(
      `UPDATE tenant_signing_certificates
       SET ativo = FALSE
       WHERE tenant_id = ? AND perfil = ? AND ativo = TRUE`,
      [tenant_id, input.perfil]
    );

    const [r] = await conn.execute<ResultSetHeader>(
      `INSERT INTO tenant_signing_certificates
        (tenant_id, perfil, label, pfx_enc, senha_enc,
         subject_cn, subject_doc, issuer_cn, thumbprint,
         validade_de, validade_ate, ativo)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, TRUE)`,
      [
        tenant_id, input.perfil, input.label.trim(),
        input.pfx, senhaEnc,
        info.subject_cn, info.subject_doc, info.issuer_cn, info.thumbprint,
        info.validade_de, info.validade_ate,
      ]
    );

    await conn.commit();

    const [rows] = await pool.execute<CertRow[]>(
      `SELECT * FROM tenant_signing_certificates WHERE id = ?`, [r.insertId]
    );
    return mapRow(rows[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function deleteCert(id: number, tenant_id = 1): Promise<void> {
  await pool.execute(
    `DELETE FROM tenant_signing_certificates WHERE id = ? AND tenant_id = ?`,
    [id, tenant_id]
  );
}

export async function setCertAtivo(id: number, ativo: boolean, tenant_id = 1): Promise<SigningCertMeta> {
  const [rows] = await pool.execute<CertRow[]>(
    `SELECT * FROM tenant_signing_certificates WHERE id = ? AND tenant_id = ?`,
    [id, tenant_id]
  );
  if (!rows.length) throw new Error('Certificado nao encontrado');
  const r = rows[0];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (ativo) {
      // Desativa outros do mesmo perfil
      await conn.execute(
        `UPDATE tenant_signing_certificates SET ativo = FALSE
         WHERE tenant_id = ? AND perfil = ? AND id != ?`,
        [tenant_id, r.perfil, id]
      );
    }
    await conn.execute(
      `UPDATE tenant_signing_certificates SET ativo = ? WHERE id = ?`,
      [ativo, id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [updated] = await pool.execute<CertRow[]>(
    `SELECT * FROM tenant_signing_certificates WHERE id = ?`, [id]
  );
  return mapRow(updated[0]);
}
