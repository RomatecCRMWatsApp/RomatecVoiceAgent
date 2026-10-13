// v3.142.0 — Pix BR Code estático (EMV TLV + CRC16-CCITT), porta de
// tools/pa-docs/pix_brcode.py. Campos: 00, 26{00 br.gov.bcb.pix, 01 chave}, 52,
// 53 986, [54 valor], 58 BR, 59 nome≤25, 60 cidade≤15, 62{05 ***}, 63 CRC.

function tlv(id: string, valor: string): string {
  const len = Buffer.byteLength(valor, 'utf8');
  if (len > 99) throw new Error(`Campo Pix ${id} excede 99 bytes`);
  return `${id}${String(len).padStart(2, '0')}${valor}`;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF), hex maiúsculo com 4 dígitos. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos e caracteres fora do conjunto aceito pelo BR Code. */
function limpar(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-@_]/g, '').trim();
}

export interface PixParams {
  chave: string;
  favorecido: string;
  cidade: string;
  /** Opcional (campo 54). Sem valor = o pagador digita. */
  valor?: number | null;
  txid?: string;
}

export function gerarPixCopiaECola(p: PixParams): string {
  const chave = String(p.chave || '').trim();
  if (!chave) throw new Error('Chave Pix não configurada no projeto');
  const nome = limpar(p.favorecido || '').toUpperCase().slice(0, 25);
  const cidade = limpar(p.cidade || '').toUpperCase().slice(0, 15);
  if (!nome || !cidade) throw new Error('Favorecido/cidade do Pix não configurados');
  let payload =
    tlv('00', '01') +
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', chave)) +
    tlv('52', '0000') +
    tlv('53', '986');
  if (p.valor != null && Number(p.valor) > 0) payload += tlv('54', Number(p.valor).toFixed(2));
  payload +=
    tlv('58', 'BR') +
    tlv('59', nome) +
    tlv('60', cidade) +
    tlv('62', tlv('05', (p.txid && limpar(p.txid).replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***')) +
    '6304';
  return payload + crc16(payload);
}
