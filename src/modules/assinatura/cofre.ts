import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface Cifrado {
  dados: Buffer;
  iv: Buffer;
  tag: Buffer;
}

/** AES-256-GCM — cifra o PFX em repouso (a senha do certificado nunca é armazenada). */
export function cifrar(claro: Buffer, chave: Buffer): Cifrado {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([c.update(claro), c.final()]);
  return { dados, iv, tag: c.getAuthTag() };
}

export function decifrar(cif: Cifrado, chave: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', chave, cif.iv);
  d.setAuthTag(cif.tag);
  try {
    return Buffer.concat([d.update(cif.dados), d.final()]);
  } catch {
    throw new Error('Falha ao decifrar o certificado: ASSINATURA_MASTER_KEY incorreta ou registro corrompido');
  }
}
