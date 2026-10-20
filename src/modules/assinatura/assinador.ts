import { PDFDocument } from 'pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { CadesSigner } from './cadesSigner.js';
import { aplicarCarimbo, type PosicaoCarimbo } from './carimbo.js';
import { mascararCpf, type CertificadoCarregado } from './certificado.js';
import { configAssinatura } from './config.js';

export interface OpcoesAssinatura {
  motivo: string;
  codigo: string;
  posicao: PosicaoCarimbo;
  data?: Date;
}

/** Aplica selo visual + assinatura PAdES (ETSI.CAdES.detached) com o certificado A1 do RT. */
export async function assinarPdf(pdfOriginal: Buffer, cert: CertificadoCarregado, opc: OpcoesAssinatura): Promise<Buffer> {
  if (pdfOriginal.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Arquivo não é um PDF válido');
  if (pdfOriginal.includes(Buffer.from('/ByteRange'))) {
    throw new Error('PDF já contém assinatura digital; reassinar por esta rotina invalidaria a assinatura existente');
  }

  const data = opc.data ?? new Date();
  const pdfDoc = await PDFDocument.load(pdfOriginal, { updateMetadata: false });

  await aplicarCarimbo(
    pdfDoc,
    { titular: cert.titular, cpfMascarado: mascararCpf(cert.cpf), emissor: cert.emissor, data, codigo: opc.codigo },
    opc.posicao,
  );

  pdflibAddPlaceholder({
    pdfDoc,
    reason: opc.motivo,
    contactInfo: configAssinatura.contato,
    name: cert.titular,
    location: configAssinatura.local,
    signingTime: data,
    signatureLength: 16384,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    appName: 'ZAYRA · Romatec Consultoria Total',
  });

  const comPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
  return new SignPdf().sign(comPlaceholder, new CadesSigner(cert), data);
}
