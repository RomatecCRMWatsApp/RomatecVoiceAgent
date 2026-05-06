// v1.74.0 — AES-256-GCM pra criptografar segredos de tenant (API keys, etc).
//
// Usa env SECRETS_ENCRYPTION_KEY (32 bytes hex). Se ausente, falha graciosa
// e armazena em plain (warning logado — pra dev local; em prod a env e
// obrigatoria pelo bootstrap warning).

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;       // GCM padrao
const TAG_LEN = 16;
const PLAIN_PREFIX = 'plain:';
const ENC_PREFIX  = 'enc:';

function getKey(): Buffer | null {
  const hex = process.env.SECRETS_ENCRYPTION_KEY?.trim();
  if (!hex) return null;
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    console.warn(`[crypto] SECRETS_ENCRYPTION_KEY tem ${buf.length} bytes, esperado 32. Ignorando.`);
    return null;
  }
  return buf;
}

/** Criptografa string. Retorna Buffer pra coluna VARBINARY. */
export function encryptSecret(plain: string): Buffer {
  if (!plain) return Buffer.alloc(0);
  const key = getKey();
  if (!key) {
    // Dev fallback — armazena com prefixo "plain:" pra detectar depois
    console.warn('[crypto] SECRETS_ENCRYPTION_KEY nao configurado — armazenando em plain.');
    return Buffer.from(PLAIN_PREFIX + plain, 'utf8');
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: prefix(4) | iv(12) | tag(16) | ciphertext(...)
  return Buffer.concat([Buffer.from(ENC_PREFIX, 'utf8'), iv, tag, enc]);
}

/** Descriptografa Buffer. Retorna '' se vazio ou inválido. */
export function decryptSecret(buf: Buffer | null | undefined): string {
  if (!buf || buf.length === 0) return '';
  const head = buf.slice(0, 4).toString('utf8');
  if (head === PLAIN_PREFIX) {
    return buf.slice(PLAIN_PREFIX.length).toString('utf8');
  }
  if (head !== ENC_PREFIX) {
    console.warn('[crypto] formato desconhecido, retornando string raw');
    return buf.toString('utf8');
  }
  const key = getKey();
  if (!key) {
    console.error('[crypto] SECRETS_ENCRYPTION_KEY ausente mas valor esta criptografado');
    return '';
  }
  const iv  = buf.slice(ENC_PREFIX.length, ENC_PREFIX.length + IV_LEN);
  const tag = buf.slice(ENC_PREFIX.length + IV_LEN, ENC_PREFIX.length + IV_LEN + TAG_LEN);
  const ct  = buf.slice(ENC_PREFIX.length + IV_LEN + TAG_LEN);
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct).toString('utf8') + decipher.final('utf8');
  } catch (err) {
    console.error('[crypto] decrypt falhou:', (err as Error).message);
    return '';
  }
}

/** Gera nova chave aleatoria (helper pro setup). */
export function generateNewKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
