// v1.99.16 — Helpers compartilhados de renderizacao PDF (selo CONFIRMADO,
// QR Code de validacao, hash de autenticidade no rodape).
//
// Usados por: reciboPdf.ts (recibos universais) e valePdf.ts (vales).
// Manter UM CODIGO SO pra essas 3 features evita drift entre tipos de PDF.

import QRCode from 'qrcode';

type PDFKitDoc = PDFKit.PDFDocument;

/**
 * Renderiza QR Code apontando pra `${baseUrl}/v/${hash}`.
 * Posicionamento absoluto no PDF (x, y).
 *
 * @returns URL gerada (pra logging ou reuso)
 */
export async function renderQRValidacao(
  doc: PDFKitDoc,
  hash: string,
  baseUrl: string,
  x: number, y: number,
  options?: {
    /** Largura/altura do QR em pontos. Default: 95 */
    size?: number;
    /** Cor do QR (escura). Default: '#10b981' (verde Romatec) */
    corHex?: string;
    /** Adiciona rotulo "Escaneie para validar" abaixo. Default: true */
    comLabel?: boolean;
  }
): Promise<string> {
  const size = options?.size ?? 95;
  const corHex = options?.corHex ?? '#10b981';
  const comLabel = options?.comLabel ?? true;
  const url = `${baseUrl}/v/${hash}`;

  try {
    const qrPng = await QRCode.toBuffer(url, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: corHex, light: '#FFFFFF' },
    });
    doc.image(qrPng, x, y, { width: size });
    if (comLabel) {
      // Label centralizado abaixo do QR (10px de espaco)
      doc.fontSize(7.5).fillColor('#666').font('Helvetica')
         .text('Escaneie para validar', x - 5, y + size + 3, {
           width: size + 10, align: 'center', lineBreak: false,
         });
    }
  } catch (err) {
    console.warn('[reciboPdfShared] falha gerar QR:', (err as Error).message);
  }

  return url;
}

/**
 * Renderiza bloco "Hash de autenticidade" no rodape com:
 *   - Rotulo "Hash de autenticidade:"
 *   - Hash truncado em monospace (Courier)
 *   - URL de validacao
 */
export function renderHashFooter(
  doc: PDFKitDoc,
  hash: string,
  validUrl: string,
  x: number, y: number,
  width: number,
): void {
  doc.fontSize(7.5).fillColor('#888').font('Helvetica')
     .text('Hash de autenticidade:', x, y, { lineBreak: false })
     .fillColor('#444').font('Courier')
     .text(hash.slice(0, 40), x, y + 12, { width, lineBreak: false });
  doc.fontSize(7.5).fillColor('#888').font('Helvetica')
     .text(validUrl, x, y + 26, { width, lineBreak: false });
}

/**
 * Renderiza selo diagonal sobreposto "✓ CONFIRMADO" (verde 33% opacidade).
 * Posicao default: centro do A4 (310, 480), rotacionado -20°.
 *
 * Nao desloca o conteudo (usa save/translate/rotate/restore).
 */
export function renderSeloConfirmado(
  doc: PDFKitDoc,
  centerX: number = 310,
  centerY: number = 480,
  options?: {
    /** Texto do selo. Default: '✓ CONFIRMADO' */
    texto?: string;
    /** Cor com transparencia (RRGGBBaa). Default: verde 33% */
    corHex?: string;
    /** Tamanho da fonte. Default: 50 */
    fontSize?: number;
    /** Rotacao em graus. Default: -20 */
    rotacao?: number;
  }
): void {
  const texto = options?.texto ?? '✓ CONFIRMADO';
  const corHex = options?.corHex ?? '#10b98133';
  const fontSize = options?.fontSize ?? 50;
  const rotacao = options?.rotacao ?? -20;

  doc.save()
     .translate(centerX, centerY)
     .rotate(rotacao)
     .fontSize(fontSize)
     .fillColor(corHex)
     .font('Helvetica-Bold')
     .text(texto, -150, -25, { width: 300, align: 'center' })
     .restore();
}

/**
 * Valor por extenso pt-BR. v3.123.0: movido pra ca (era privado do valePdf)
 * pra o recibo de mao de obra avulsa reusar a MESMA regra, sem virar uma
 * terceira copia e sem acoplar aquele modulo leve a cadeia pesada do
 * valePdf/reciboPdf (tenantSettings/embeddings). Logica inalterada.
 */
export function numeroExtenso(n: number): string {
  if (n === 0) return 'zero';
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const d10 = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function ate999(x: number): string {
    if (x === 100) return 'cem';
    const partes: string[] = [];
    const cc = Math.floor(x / 100);
    if (cc > 0) partes.push(c[cc]);
    const r = x % 100;
    if (r > 0) {
      if (r < 10) partes.push(u[r]);
      else if (r < 20) partes.push(d10[r - 10]);
      else {
        const dd = Math.floor(r / 10);
        const uu = r % 10;
        if (uu > 0) partes.push(d[dd] + ' e ' + u[uu]);
        else partes.push(d[dd]);
      }
    }
    return partes.join(' e ');
  }
  const inteiro = Math.floor(n);
  const cent = Math.round((n - inteiro) * 100);
  let res = '';
  if (inteiro === 0) res = 'zero';
  else if (inteiro < 1000) res = ate999(inteiro);
  else if (inteiro < 1000000) {
    const mil = Math.floor(inteiro / 1000);
    const resto = inteiro % 1000;
    res = (mil === 1 ? 'mil' : ate999(mil) + ' mil') + (resto > 0 ? ' e ' + ate999(resto) : '');
  } else res = inteiro.toLocaleString('pt-BR');
  let out = `${res} ${inteiro === 1 ? 'real' : 'reais'}`;
  if (cent > 0) out += ` e ${ate999(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`;
  return out;
}
