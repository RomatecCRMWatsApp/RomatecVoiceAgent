import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type PosicaoCarimbo =
  | 'inferior-esquerda'
  | 'inferior-direita'
  | 'superior-esquerda'
  | 'superior-direita'
  | 'nenhum';

export const POSICOES: readonly PosicaoCarimbo[] = [
  'inferior-esquerda',
  'inferior-direita',
  'superior-esquerda',
  'superior-direita',
  'nenhum',
];

const VERDE = rgb(12 / 255, 51 / 255, 32 / 255);
const DOURADO = rgb(201 / 255, 168 / 255, 76 / 255);

export interface DadosCarimbo {
  titular: string;
  cpfMascarado: string;
  emissor: string;
  data: Date;
  codigo: string;
}

/** Selo visual Romatec na última página (a validade jurídica está na assinatura PAdES, não no selo). */
export async function aplicarCarimbo(pdfDoc: PDFDocument, d: DadosCarimbo, posicao: PosicaoCarimbo): Promise<void> {
  if (posicao === 'nenhum') return;
  const paginas = pdfDoc.getPages();
  const pagina = paginas[paginas.length - 1];
  const { width, height } = pagina.getSize();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const negrito = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const w = Math.min(300, width - 24);
  const h = 52;
  const margem = 12;
  const x = posicao.endsWith('esquerda') ? margem : width - w - margem;
  const y = posicao.startsWith('inferior') ? margem : height - h - margem;

  pagina.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), opacity: 0.94, borderColor: VERDE, borderWidth: 0.8 });
  pagina.drawRectangle({ x, y: y + h - 12, width: w, height: 12, color: VERDE });
  pagina.drawLine({ start: { x, y: y + h - 12 }, end: { x: x + w, y: y + h - 12 }, thickness: 0.8, color: DOURADO });

  pagina.drawText('ASSINADO DIGITALMENTE — ICP-BRASIL', { x: x + 6, y: y + h - 9, size: 6.8, font: negrito, color: rgb(1, 1, 1) });

  const dataFmt = d.data.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  const linhas: Array<[string, typeof regular, number]> = [
    [`${d.titular}${d.cpfMascarado ? `  ·  CPF ${d.cpfMascarado}` : ''}`, negrito, 7],
    [`Técnico em Edificações e Agrimensura — CFT/MA 01209185369`, regular, 6.2],
    [`AC: ${d.emissor}  ·  ${dataFmt}`, regular, 6.2],
    [`Cód. ${d.codigo}  ·  Verifique em validar.iti.gov.br`, regular, 6.2],
  ];
  let ly = y + h - 21;
  for (const [txt, fonte, tam] of linhas) {
    let t = txt;
    while (fonte.widthOfTextAtSize(t, tam) > w - 12 && t.length > 4) t = `${t.slice(0, -2)}…`;
    pagina.drawText(t, { x: x + 6, y: ly, size: tam, font: fonte, color: VERDE });
    ly -= 9;
  }
}
