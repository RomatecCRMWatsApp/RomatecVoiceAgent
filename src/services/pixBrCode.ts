// v3.20.0: PIX BR Code (EMV) generator — gera o payload "Copia e Cola"
// conforme spec do Banco Central (Manual BR Code v2.0.1). O texto retornado
// pode ser exibido como "Copia e Cola" OU codificado como QR Code — qualquer
// app de banco brasileiro le os dois. Sem dependencia externa.
// Spec: https://www.bcb.gov.br/estabilidadefinanceira/pix

export interface PixBrCodeInput {
  chave: string;          // chave PIX (CPF/CNPJ/email/telefone/aleatoria)
  nome: string;           // nome do recebedor (max 25 chars ASCII)
  cidade: string;         // cidade do recebedor (max 15 chars ASCII)
  valor?: number | null;  // valor em BRL (opcional — sem valor = pagador define)
  txid?: string;          // identificador (max 25 chars alfanumericos, ou "***")
  descricao?: string;     // descricao opcional (max 50 chars)
}

// Codifica um campo EMV no formato ID + LEN + VALUE (LEN com 2 digitos)
function emv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return id + len + value;
}

// CRC16-CCITT-FALSE (polinomio 0x1021, inicial 0xFFFF) — usado no campo 63 do BR Code
function crc16(str: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      else crc = (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Remove acentos, caracteres especiais e trunca — BR Code aceita so ASCII
function sanitize(s: string, max: number): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function gerarPixBrCode(input: PixBrCodeInput): string {
  // 00 — Payload Format Indicator
  let p = emv('00', '01');

  // 26 — Merchant Account Information (PIX)
  let mai = emv('00', 'BR.GOV.BCB.PIX');
  mai += emv('01', input.chave);
  if (input.descricao) {
    const desc = sanitize(input.descricao, 50);
    if (desc) mai += emv('02', desc);
  }
  p += emv('26', mai);

  // 52 — Merchant Category Code (0000 = sem categoria)
  p += emv('52', '0000');

  // 53 — Transaction Currency (986 = BRL)
  p += emv('53', '986');

  // 54 — Transaction Amount (opcional)
  if (input.valor != null && input.valor > 0) {
    p += emv('54', input.valor.toFixed(2));
  }

  // 58 — Country Code
  p += emv('58', 'BR');

  // 59 — Merchant Name
  p += emv('59', sanitize(input.nome, 25) || 'NA');

  // 60 — Merchant City
  p += emv('60', sanitize(input.cidade, 15) || 'BR');

  // 62 — Additional Data Field (txid)
  const txid = (input.txid || '***').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || '***';
  p += emv('62', emv('05', txid));

  // 63 — CRC16 (calculado sobre todo o payload anterior + "6304")
  p += '6304';
  return p + crc16(p);
}
