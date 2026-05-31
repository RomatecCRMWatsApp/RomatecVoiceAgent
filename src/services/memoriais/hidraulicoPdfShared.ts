// v3.49.2: helpers compartilhados de PDF do modulo Memoriais (padrao Romatec).
// Usado por hidraulicoPdfMemorial.ts (PDF-A) e hidraulicoPdfQuantitativo.ts
// (PDF-B). Baseado no padrao pdfkit ja consolidado em valePdf.ts.
//
// Cabecalho/rodape institucionais sao FIXOS (Romatec Consultoria Total) — nao
// dependem de tenantSettings/DB, o que torna os geradores puros e testaveis.

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

// Cores institucionais Romatec
export const COR_VERDE = '#1F4E2E';
export const COR_AZUL = '#1F4E79';
export const COR_CINZA = '#F5F5F5';
export const COR_ALERTA = '#FFF3CD';
export const COR_ERRO = '#F8D7DA';
export const COR_TEXTO = '#222222';
export const COR_BORDA = '#bfbfbf';
export const COR_SUAVE = '#666666';

export const MARGIN = 40;
export const PAGE_W = 595.28; // A4 pt
export const PAGE_H = 841.89;
export const CONTENT_W = PAGE_W - MARGIN * 2; // 515.28
export const CONTENT_TOP = 92; // y onde o conteudo comeca (abaixo do cabecalho)
export const CONTENT_BOTTOM = 792; // y maximo antes do rodape

export type PDFDoc = InstanceType<typeof PDFDocument>;

export interface DocMeta {
  tipoDocCurto: string; // ex: "Memorial NBR 5626"
  docNome: string; // nome do documento (rodape)
  obra: string;
  proprietario: string;
  data: string; // dd/mm/aaaa
  prancha: string;
}

function logoPath(): string {
  return path.join(__dirname, '..', '..', 'public', 'logo_R-removebg-preview.png');
}

function drawHeader(doc: PDFDoc, meta: DocMeta): void {
  try {
    const lp = logoPath();
    if (fs.existsSync(lp)) doc.image(lp, MARGIN, 26, { width: 42 });
  } catch {
    /* ignora ausencia de logo */
  }
  doc.fontSize(13).fillColor(COR_VERDE).font('Helvetica-Bold')
    .text('ROMATEC CONSULTORIA TOTAL', MARGIN + 50, 28, { width: CONTENT_W - 50 });
  doc.fontSize(7.5).fillColor(COR_SUAVE).font('Helvetica')
    .text('Topografia - Agrimensura - Avaliacao de Imoveis - Edificacoes', MARGIN + 50, 45, { width: CONTENT_W - 50 });
  doc.fontSize(7.5).fillColor(COR_SUAVE).font('Helvetica')
    .text('Acailandia/MA - www.romatecconsult.com.br', MARGIN + 50, 56, { width: CONTENT_W - 50 });
  // regua verde
  doc.moveTo(MARGIN, 72).lineTo(PAGE_W - MARGIN, 72).strokeColor(COR_VERDE).lineWidth(1.5).stroke();
  // linha de contexto
  const ctx = `${meta.tipoDocCurto} - ${meta.obra} - ${meta.proprietario}`;
  doc.fontSize(7.5).fillColor(COR_AZUL).font('Helvetica-Oblique')
    .text(ctx, MARGIN, 76, { width: CONTENT_W, ellipsis: true, height: 11, lineBreak: false });
}

function drawFooter(doc: PDFDoc, meta: DocMeta, pageNum: number, totalPages: number): void {
  doc.moveTo(MARGIN, CONTENT_BOTTOM + 6).lineTo(PAGE_W - MARGIN, CONTENT_BOTTOM + 6)
    .strokeColor(COR_BORDA).lineWidth(0.5).stroke();
  const left = `${meta.docNome}  |  ${meta.data}  |  Prancha ${meta.prancha}`;
  doc.fontSize(7).fillColor(COR_SUAVE).font('Helvetica')
    .text(left, MARGIN, CONTENT_BOTTOM + 10, { width: CONTENT_W - 90, lineBreak: false, ellipsis: true });
  doc.fontSize(7).fillColor(COR_SUAVE).font('Helvetica')
    .text(`Pag. ${pageNum} de ${totalPages}`, PAGE_W - MARGIN - 90, CONTENT_BOTTOM + 10, { width: 90, align: 'right' });
}

export interface DocHandle {
  doc: PDFDoc;
  chunks: Buffer[];
  meta: DocMeta;
  y: () => number;
  setY: (v: number) => void;
  ensure: (h: number) => void;
  finish: () => Promise<Buffer>;
}

// Cria o documento ja com a 1a pagina e o cabecalho desenhado. O rodape com
// numeracao "Pag X de Y" e estampado no finish() (precisa do total de paginas).
export function createDoc(meta: DocMeta): DocHandle {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: meta.docNome, Author: 'ROMATEC CONSULTORIA TOTAL', Subject: meta.tipoDocCurto },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  doc.on('pageAdded', () => {
    drawHeader(doc, meta);
    doc.x = MARGIN;
    doc.y = CONTENT_TOP;
  });
  doc.addPage();

  const handle: DocHandle = {
    doc,
    chunks,
    meta,
    y: () => doc.y,
    setY: (v: number) => {
      doc.y = v;
    },
    ensure: (h: number) => {
      if (doc.y + h > CONTENT_BOTTOM) doc.addPage();
    },
    finish: async () => {
      const range = doc.bufferedPageRange();
      const total = range.count;
      for (let i = 0; i < total; i++) {
        doc.switchToPage(range.start + i);
        drawFooter(doc, meta, i + 1, total);
      }
      doc.flushPages();
      doc.end();
      await new Promise<void>((resolve) => doc.on('end', () => resolve()));
      return Buffer.concat(chunks);
    },
  };
  return handle;
}

// Titulo de secao numerada (ex: "4. ESTIMATIVA DE CONSUMO DIARIO").
export function sectionTitle(h: DocHandle, texto: string): void {
  const { doc } = h;
  h.ensure(34);
  const y = doc.y + 8;
  doc.rect(MARGIN, y, CONTENT_W, 18).fill(COR_VERDE);
  doc.fontSize(10.5).fillColor('#ffffff').font('Helvetica-Bold')
    .text(texto.toUpperCase(), MARGIN + 6, y + 4, { width: CONTENT_W - 12 });
  doc.y = y + 24;
  doc.x = MARGIN;
  doc.fillColor(COR_TEXTO);
}

// Subtitulo azul.
export function subTitle(h: DocHandle, texto: string): void {
  const { doc } = h;
  h.ensure(20);
  doc.fontSize(9.5).fillColor(COR_AZUL).font('Helvetica-Bold')
    .text(texto, MARGIN, doc.y + 4, { width: CONTENT_W });
  doc.y += 2;
  doc.fillColor(COR_TEXTO);
}

// Paragrafo justificado.
export function paragrafo(h: DocHandle, texto: string, opts?: { size?: number }): void {
  const { doc } = h;
  const size = opts?.size ?? 9;
  const altura = doc.heightOfString(texto, { width: CONTENT_W, align: 'justify' });
  h.ensure(altura + 6);
  doc.fontSize(size).fillColor(COR_TEXTO).font('Helvetica')
    .text(texto, MARGIN, doc.y + 4, { width: CONTENT_W, align: 'justify' });
  doc.y += 4;
}

export function bullets(h: DocHandle, itens: string[], opts?: { size?: number }): void {
  const { doc } = h;
  const size = opts?.size ?? 9;
  for (const it of itens) {
    const txt = `- ${it}`;
    const altura = doc.heightOfString(txt, { width: CONTENT_W - 8 });
    h.ensure(altura + 3);
    doc.fontSize(size).fillColor(COR_TEXTO).font('Helvetica')
      .text(txt, MARGIN + 8, doc.y + 2, { width: CONTENT_W - 8 });
  }
  doc.y += 2;
}

export interface Coluna {
  label: string;
  width: number; // soma deve ser ~CONTENT_W
  align?: 'left' | 'center' | 'right';
}

export interface LinhaTabela {
  celulas: string[];
  fundo?: string; // cor de fundo (ALERTA/ERRO/destaque)
  negrito?: boolean;
}

// Tabela com cabecalho verde, zebra cinza, quebra de pagina automatica e
// repeticao de cabecalho. Retorna ao final com doc.y abaixo da tabela.
export function tabela(h: DocHandle, cols: Coluna[], linhas: LinhaTabela[], opts?: { fontSize?: number }): void {
  const { doc } = h;
  const fs2 = opts?.fontSize ?? 8.5;
  const padX = 4;
  const padY = 3;

  const desenharCabecalho = () => {
    h.ensure(20);
    const y = doc.y;
    doc.rect(MARGIN, y, CONTENT_W, 16).fill(COR_AZUL);
    let x = MARGIN;
    doc.fontSize(fs2).fillColor('#ffffff').font('Helvetica-Bold');
    for (const c of cols) {
      doc.text(c.label, x + padX, y + 4, { width: c.width - padX * 2, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
      x += c.width;
    }
    doc.y = y + 16;
  };

  desenharCabecalho();
  let zebra = false;
  for (const linha of linhas) {
    // altura da linha = max altura das celulas
    let altura = 0;
    doc.fontSize(fs2).font(linha.negrito ? 'Helvetica-Bold' : 'Helvetica');
    cols.forEach((c, i) => {
      const t = linha.celulas[i] ?? '';
      const hc = doc.heightOfString(t, { width: c.width - padX * 2 });
      if (hc > altura) altura = hc;
    });
    altura += padY * 2;
    if (doc.y + altura > CONTENT_BOTTOM) {
      doc.addPage();
      desenharCabecalho();
      zebra = false;
    }
    const y = doc.y;
    const fundo = linha.fundo ?? (zebra ? COR_CINZA : '#ffffff');
    if (fundo !== '#ffffff') doc.rect(MARGIN, y, CONTENT_W, altura).fill(fundo);
    let x = MARGIN;
    doc.fontSize(fs2).fillColor(COR_TEXTO).font(linha.negrito ? 'Helvetica-Bold' : 'Helvetica');
    cols.forEach((c, i) => {
      doc.text(linha.celulas[i] ?? '', x + padX, y + padY, { width: c.width - padX * 2, align: c.align ?? 'left' });
      x += c.width;
    });
    // bordas
    doc.rect(MARGIN, y, CONTENT_W, altura).strokeColor(COR_BORDA).lineWidth(0.4).stroke();
    doc.y = y + altura;
    zebra = !zebra;
  }
  doc.y += 4;
  doc.x = MARGIN;
}

// Bloco de assinatura padrao Romatec (ultima pagina).
export function assinaturaRomatec(h: DocHandle, opts: { municipio: string; dataExtenso: string; trtNumero?: string }): void {
  const { doc } = h;
  h.ensure(150);
  doc.y += 16;
  doc.fontSize(9).fillColor(COR_TEXTO).font('Helvetica')
    .text(`${opts.municipio}/MA, ${opts.dataExtenso}.`, MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.y += 40;
  const cx = PAGE_W / 2;
  doc.moveTo(cx - 150, doc.y).lineTo(cx + 150, doc.y).strokeColor('#444').lineWidth(0.6).stroke();
  doc.y += 6;
  doc.fontSize(10).fillColor(COR_TEXTO).font('Helvetica-Bold')
    .text('Jose Romario Pinto Bezerra', MARGIN, doc.y, { width: CONTENT_W, align: 'center' });
  doc.y += 2;
  const linhas = [
    'Tecnico em Edificacoes - CFT/MA no 01209185369',
    'Tecnico em Agrimensura - INCRA/FQNS',
    'Avaliador de Imoveis - CNAI no 031161 - Corretor CRECI/MA 4.705',
    'ROMATEC CONSULTORIA TOTAL',
  ];
  if (opts.trtNumero) {
    linhas.splice(3, 0, `TRT no ${opts.trtNumero} - CFT/BR`);
  }
  for (const l of linhas) {
    doc.fontSize(8).fillColor(COR_SUAVE).font('Helvetica')
      .text(l, MARGIN, doc.y + 2, { width: CONTENT_W, align: 'center' });
  }
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function dataPorExtenso(d: Date = new Date()): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function dataCurta(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function sanitizarNome(s: string): string {
  return (s || 'SEM_NOME')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 40);
}

export function fmt(n: number, dec = 2): string {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
