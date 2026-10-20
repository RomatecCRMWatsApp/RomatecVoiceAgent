import forge from 'node-forge';

export interface CertificadoCarregado {
  chavePkcs8: Buffer;
  certDer: Buffer;
  cadeiaDer: Buffer[];
  titular: string;
  cpf: string | null;
  emissor: string;
  serial: string;
  validoDe: Date;
  validoAte: Date;
  icpBrasil: boolean;
}

export class ErroSenhaCertificado extends Error {
  constructor() {
    super('Senha do certificado incorreta');
    this.name = 'ErroSenhaCertificado';
  }
}

const derCert = (c: forge.pki.Certificate): Buffer =>
  Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary');

const campo = (attrs: forge.pki.Certificate['subject'], nome: string): string =>
  String(attrs.getField(nome)?.value ?? '');

/** Abre o PFX/P12 (A1) com a senha informada e extrai chave, certificado e cadeia. */
export function abrirPfx(pfx: Buffer, senha: string): CertificadoCarregado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/mac|password|invalid|decrypt|pad/i.test(msg)) throw new ErroSenhaCertificado();
    throw new Error(`Não foi possível abrir o PFX: ${msg}`);
  }

  const oids = forge.pki.oids;
  const bagsChave = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
  ];
  const chave = bagsChave.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new Error('Chave privada não encontrada no PFX');

  const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));

  const folha = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n));
  if (!folha) throw new Error('Certificado correspondente à chave privada não encontrado no PFX');

  const cn = campo(folha.subject, 'CN');
  const [nome, cpfBruto] = cn.split(':');
  const cpf = cpfBruto && /^\d{11}$/.test(cpfBruto) ? cpfBruto : null;
  const icpBrasil = [folha, ...certs].some(
    (c) => /ICP-Brasil/i.test(campo(c.subject, 'O')) || /ICP-Brasil/i.test(campo(c.issuer, 'O')),
  );

  return {
    chavePkcs8: Buffer.from(
      forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(chave))).getBytes(),
      'binary',
    ),
    certDer: derCert(folha),
    cadeiaDer: certs.filter((c) => c !== folha).map(derCert),
    titular: (nome ?? cn).trim(),
    cpf,
    emissor: campo(folha.issuer, 'CN'),
    serial: folha.serialNumber,
    validoDe: folha.validity.notBefore,
    validoAte: folha.validity.notAfter,
    icpBrasil,
  };
}

/** Zera a chave em memória após o uso. */
export function descartar(c: CertificadoCarregado): void {
  c.chavePkcs8.fill(0);
}

export function mascararCpf(cpf: string | null): string {
  return cpf ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : '';
}
