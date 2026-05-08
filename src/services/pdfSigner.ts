// v1.99.3 — Assinatura digital PAdES (ICP-Brasil) de PDFs.
//
// Fluxo:
//   1) PDF gerado pelo PDFKit -> Buffer
//   2) pdf-lib carrega + pdflibAddPlaceholder reserva slot de assinatura
//   3) P12Signer carrega .pfx + senha
//   4) signpdf.sign() calcula hash, gera PKCS#7 CMS, insere no placeholder
//
// Resultado: PDF assinado validavel pelo Adobe Reader, gov.br/validar.

import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { PDFDocument } from 'pdf-lib';

export interface SignMeta {
  /** Nome que aparece como signatario (CN do cert) */
  name: string;
  /** Motivo da assinatura (ex: "Recibo de pagamento") */
  reason?: string;
  /** Localizacao geografica (ex: "Acailandia/MA") */
  location?: string;
  /** Contato (email/cnpj) */
  contactInfo?: string;
}

export async function signPdfBuffer(
  pdfBuffer: Buffer,
  pfxBuffer: Buffer,
  pfxPassword: string,
  meta: SignMeta
): Promise<Buffer> {
  if (!pdfBuffer?.length) throw new Error('PDF vazio');
  if (!pfxBuffer?.length) throw new Error('Certificado .pfx vazio');
  if (!pfxPassword) throw new Error('Senha do certificado vazia');

  // 1) Carrega PDF com pdf-lib
  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // 2) Adiciona placeholder de assinatura (campo de signature dictionary)
  pdflibAddPlaceholder({
    pdfDoc,
    reason: meta.reason ?? 'Documento assinado digitalmente',
    name: meta.name,
    location: meta.location ?? 'Brasil',
    contactInfo: meta.contactInfo ?? '',
    // 32KB — comporta cadeia completa ICP-Brasil (cert titular + AC intermediaria
    // Soluti/Intercert + AC raiz Brasileira) + assinatura RSA-2048/PSS + timestamp
    // futuro. Padrao 8192 do @signpdf nao cabe (~15KB com cadeia ICP-Brasil real).
    signatureLength: 32768,
  });

  // 3) Serializa PDF com placeholder
  const pdfWithPlaceholderUint8 = await pdfDoc.save();
  const pdfWithPlaceholder = Buffer.from(pdfWithPlaceholderUint8);

  // 4) Cria signer P12 e assina
  const signer = new P12Signer(pfxBuffer, { passphrase: pfxPassword });
  const signed = await signpdf.sign(pdfWithPlaceholder, signer);

  return Buffer.isBuffer(signed) ? signed : Buffer.from(signed);
}
