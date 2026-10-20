import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { Signer } from '@signpdf/utils';
import type { CertificadoCarregado } from './certificado.js';

pkijs.setEngine(
  'nodeWebcrypto',
  new pkijs.CryptoEngine({ name: 'nodeWebcrypto', crypto: globalThis.crypto }),
);

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
} as const;

const ab = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/**
 * Gera CMS destacado no perfil CAdES-BES (contentType, messageDigest, signing-certificate-v2),
 * usado com SubFilter ETSI.CAdES.detached => assinatura PAdES-B.
 */
export class CadesSigner extends Signer {
  constructor(private readonly cert: CertificadoCarregado) {
    super();
  }

  async sign(pdfBuffer: Buffer): Promise<Buffer> {
    const subtle = globalThis.crypto.subtle;
    const cert = pkijs.Certificate.fromBER(ab(this.cert.certDer));
    const cadeia = this.cert.cadeiaDer.map((d) => pkijs.Certificate.fromBER(ab(d)));
    const chave = await subtle.importKey(
      'pkcs8',
      ab(this.cert.chavePkcs8),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const digest = await subtle.digest('SHA-256', ab(pdfBuffer));
    const hashCert = await subtle.digest('SHA-256', ab(this.cert.certDer));

    const essCertIdV2 = new asn1js.Sequence({
      value: [
        new asn1js.OctetString({ valueHex: hashCert }),
        new asn1js.Sequence({
          value: [
            new asn1js.Sequence({
              value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })],
            }),
            new asn1js.Integer({ valueHex: cert.serialNumber.valueBlock.valueHexView.slice().buffer }),
          ],
        }),
      ],
    });

    const signedData = new pkijs.SignedData({
      version: 1,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
              new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: digest })] }),
              new pkijs.Attribute({
                type: OID.signingCertificateV2,
                values: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] })],
              }),
            ],
          }),
        }),
      ],
      certificates: [cert, ...cadeia],
    });

    await signedData.sign(chave, 0, 'SHA-256');

    const contentInfo = new pkijs.ContentInfo({
      contentType: OID.signedData,
      content: signedData.toSchema(true),
    });
    return Buffer.from(contentInfo.toSchema().toBER(false));
  }
}
