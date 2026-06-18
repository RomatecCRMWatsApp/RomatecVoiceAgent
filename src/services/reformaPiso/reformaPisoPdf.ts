// src/services/reformaPiso/reformaPisoPdf.ts
// v3.67.0: PDF dos 3 temas (Tradicional / Prime I / Prime II) via PDFKit (puro Node).
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { ResultadoCalculo, TemaProposta } from './reformaPisoTypes';

/**
 * v3.73.0: mescla as páginas de plantas em PDF ao final do documento da proposta.
 * Imagens já são embutidas pelo gerarPdf; aqui anexamos arquivos PDF (prancha/planta).
 * Best-effort: planta inválida é ignorada (não derruba a geração).
 */
export async function mesclarPlantasPdf(base: Buffer, plantasPdf: Buffer[]): Promise<Buffer> {
  if (!plantasPdf || plantasPdf.length === 0) return base;
  try {
    const out = await PdfLibDocument.load(base);
    for (const buf of plantasPdf) {
      try {
        const src = await PdfLibDocument.load(buf);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } catch (e) {
        console.warn('[reformaPisoPdf] planta PDF ignorada na mesclagem:', (e as Error).message);
      }
    }
    return Buffer.from(await out.save());
  } catch (e) {
    console.warn('[reformaPisoPdf] mesclagem de plantas falhou, retornando proposta sem anexo:', (e as Error).message);
    return base;
  }
}

// Paleta da marca Romatec
const VERDE = '#0C3320';
const VERDE_CLARO = '#0B6E4F';
const DOURADO = '#B8860B';
const DOURADO_CLARO = '#C9A84C';

// const FONT_TITULO = 'Playfair';
// doc.registerFont('Playfair', '/abs/path/PlayfairDisplay-Bold.ttf');
const FONT_TITULO = 'Helvetica-Bold';
const FONT_TXT = 'Helvetica';

export interface CabecalhoPdf {
  numero: string;
  contratanteNome: string;
  contratanteDoc?: string;
  obraEndereco?: string;
  cidade: string;
  uf: string;
  validadeDias: number;
  comRemocao: boolean;
}

interface TemaCfg {
  faixa: string; texto: string; destaque: string; corHeaderTabela: string;
}

const TEMAS: Record<TemaProposta, TemaCfg> = {
  tradicional: { faixa: VERDE, texto: '#1a1a1a', destaque: VERDE_CLARO, corHeaderTabela: VERDE },
  prime1: { faixa: VERDE, texto: '#222222', destaque: DOURADO, corHeaderTabela: VERDE_CLARO },
  prime2: { faixa: '#072017', texto: '#1a1a1a', destaque: DOURADO_CLARO, corHeaderTabela: DOURADO },
};

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Extras opcionais embutidos no PDF (relatório fotográfico + plantas). */
export interface ExtrasPdf {
  fotos?: Array<{ mime: string; dataBase64: string; legenda: string | null }>;
  plantasImagens?: Array<{ nome: string; buffer: Buffer }>;
  // anexado=true → o PDF da planta é mesclado ao final do documento; senão vai à parte.
  plantasArquivos?: Array<{ nome: string; anexado?: boolean }>;
}

/** Gera o PDF e devolve um Buffer. */
export function gerarPdf(
  tema: TemaProposta,
  cab: CabecalhoPdf,
  r: ResultadoCalculo,
  extras?: ExtrasPdf,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const t = TEMAS[tema];
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const M = doc.page.margins.left;
      const innerW = W - M * 2;

      // -------- Cabeçalho --------
      doc.rect(0, 0, W, 88).fill(t.faixa);
      doc.fillColor('#FFFFFF').font(FONT_TITULO).fontSize(18)
        .text('ROMATEC CONSULTORIA TOTAL', M, 24);
      doc.font(FONT_TXT).fontSize(9).fillColor(DOURADO_CLARO)
        .text('Topografia • Avaliações • Georreferenciamento • Obras', M, 48);
      doc.fillColor('#FFFFFF').fontSize(9)
        .text(`Proposta ${cab.numero}`, M, 62)
        .text(`${cab.cidade}/${cab.uf}`, W - M - 120, 62, { width: 120, align: 'right' });

      let y = 108;
      const titulo = (txt: string) => {
        doc.font(FONT_TITULO).fontSize(12).fillColor(t.destaque).text(txt, M, y);
        y = doc.y + 4;
        doc.moveTo(M, y).lineTo(W - M, y).strokeColor(t.destaque).lineWidth(1).stroke();
        y += 8;
        doc.fillColor(t.texto).font(FONT_TXT).fontSize(10);
      };
      const linha = (txt: string) => {
        doc.font(FONT_TXT).fontSize(10).fillColor(t.texto).text(txt, M, y, { width: innerW });
        y = doc.y + 3;
      };

      // -------- 1. Contratante / Objeto --------
      titulo('1. IDENTIFICAÇÃO');
      linha(`Contratante: ${cab.contratanteNome}${cab.contratanteDoc ? `  —  ${cab.contratanteDoc}` : ''}`);
      if (cab.obraEndereco) linha(`Local da obra: ${cab.obraEndereco}`);
      linha(`Validade da proposta: ${cab.validadeDias} dias`);
      y += 6;

      titulo('2. OBJETO');
      linha(
        `Execução de revestimento de piso ${cab.comRemocao ? 'com remoção do piso existente' : 'sobreposto (sem remoção do piso/contrapiso existente)'}, ` +
        `compreendendo o fornecimento de mão de obra especializada e o assentamento de placas cerâmicas/porcelanato ` +
        `em conformidade com a ABNT NBR 13753, NBR 14081 e NBR 14992.`,
      );
      y += 6;

      // -------- 3. Memória de área --------
      titulo('3. MEMÓRIA DE ÁREA');
      const colDesc = innerW * 0.5, colC = innerW * 0.16, colL = innerW * 0.16, colA = innerW * 0.18;
      const headRow = () => {
        doc.rect(M, y, innerW, 18).fill(t.corHeaderTabela);
        doc.fillColor('#FFFFFF').font(FONT_TITULO).fontSize(9);
        doc.text('Ambiente', M + 4, y + 5, { width: colDesc - 8 });
        doc.text('Compr. (m)', M + colDesc, y + 5, { width: colC, align: 'right' });
        doc.text('Larg. (m)', M + colDesc + colC, y + 5, { width: colL, align: 'right' });
        doc.text('Área (m²)', M + colDesc + colC + colL, y + 5, { width: colA - 4, align: 'right' });
        y += 18;
      };
      headRow();
      doc.font(FONT_TXT).fontSize(9).fillColor(t.texto);
      r.ambientes.forEach((a, i) => {
        if (i % 2 === 1) doc.rect(M, y, innerW, 16).fill('#F3F4F2').fillColor(t.texto);
        doc.fillColor(t.texto);
        doc.text(a.descricao, M + 4, y + 4, { width: colDesc - 8 });
        doc.text(a.comprimentoM > 0 ? a.comprimentoM.toFixed(3) : '— (polig.)', M + colDesc, y + 4, { width: colC, align: 'right' });
        doc.text(a.larguraM > 0 ? a.larguraM.toFixed(3) : '—', M + colDesc + colC, y + 4, { width: colL, align: 'right' });
        doc.text(a.areaM2.toFixed(4), M + colDesc + colC + colL, y + 4, { width: colA - 4, align: 'right' });
        y += 16;
      });
      doc.font(FONT_TITULO).fontSize(9).fillColor(t.destaque);
      doc.text(`ÁREA TOTAL: ${r.areaTotalM2.toFixed(4)} m²  (c/ perda: ${r.areaComPerdaM2.toFixed(4)} m²)`,
        M, y + 4, { width: innerW, align: 'right' });
      y += 24;

      // -------- 4. Quantitativo de materiais --------
      if (y > 640) { doc.addPage(); y = 60; }
      titulo('4. QUANTITATIVO DE MATERIAIS (informativo)');
      doc.font(FONT_TXT).fontSize(8).fillColor('#555').text(
        'Quantitativo para aquisição pelo CONTRATANTE. Os preços unitários são de referência (SINAPI/cotação), meramente informativos, e NÃO compõem o valor desta proposta — que é de MÃO DE OBRA.',
        M, y, { width: innerW });
      y = doc.y + 6;
      const cI = innerW * 0.42, cU = innerW * 0.12, cQ = innerW * 0.14, cP = innerW * 0.16, cT = innerW * 0.16;
      doc.rect(M, y, innerW, 18).fill(t.corHeaderTabela);
      doc.fillColor('#FFFFFF').font(FONT_TITULO).fontSize(9);
      doc.text('Item', M + 4, y + 5, { width: cI - 8 });
      doc.text('Un.', M + cI, y + 5, { width: cU });
      doc.text('Qtd.', M + cI + cU, y + 5, { width: cQ, align: 'right' });
      doc.text('Unit.', M + cI + cU + cQ, y + 5, { width: cP, align: 'right' });
      doc.text('Total', M + cI + cU + cQ + cP, y + 5, { width: cT - 4, align: 'right' });
      y += 18;
      doc.font(FONT_TXT).fontSize(9).fillColor(t.texto);
      r.insumos.forEach((it, i) => {
        const h = it.obs ? 24 : 16;
        if (i % 2 === 1) { doc.rect(M, y, innerW, h).fill('#F3F4F2'); }
        doc.fillColor(t.texto).font(FONT_TXT).fontSize(9);
        doc.text(it.item, M + 4, y + 4, { width: cI - 8 });
        doc.text(it.unidade, M + cI, y + 4, { width: cU });
        doc.text(String(it.quantidade), M + cI + cU, y + 4, { width: cQ, align: 'right' });
        doc.text(brl(it.precoUnit), M + cI + cU + cQ, y + 4, { width: cP, align: 'right' });
        doc.text(brl(it.total), M + cI + cU + cQ + cP, y + 4, { width: cT - 4, align: 'right' });
        if (it.obs) {
          doc.fillColor('#666').fontSize(7).text(it.obs, M + 4, y + 15, { width: innerW - 8 });
        }
        y += h;
      });
      doc.font(FONT_TITULO).fontSize(9).fillColor(t.destaque)
        .text(`Subtotal materiais (referência — não incluso no valor): ${brl(r.valorMateriais)}`, M, y + 4, { width: innerW, align: 'right' });
      y += 26;

      // -------- 5. Mão de obra / Prazo / Valor --------
      if (y > 640) { doc.addPage(); y = 60; }
      titulo('5. MÃO DE OBRA, PRAZO E VALOR');
      linha(`Mão de obra: ${brl(r.maoObraM2)}/m²  ×  ${r.areaTotalM2.toFixed(4)} m²  =  ${brl(r.valorMaoObra)}`);
      linha(`Prazo de execução: ${r.prazoDiasUteis} dias úteis ` +
        `(assentamento ${r.prazoDetalhe.assentamento} + rejunte ${r.prazoDetalhe.rejuntamento} + cura/liberação ${r.prazoDetalhe.curaLiberacao}).`);
      linha(`BDI (${r.bdiPct.toFixed(2)}%) sobre a mão de obra: ${brl(r.valorBdi)}`);
      linha('Materiais por conta do contratante (quantitativo informativo na seção 4).');
      y += 6;

      // Caixa de valor final (apenas mão de obra + BDI)
      doc.rect(M, y, innerW, 46).fill(t.faixa);
      doc.fillColor('#FFFFFF').font(FONT_TITULO).fontSize(13)
        .text('VALOR FINAL — MÃO DE OBRA', M + 12, y + 9);
      doc.fontSize(16).fillColor(DOURADO_CLARO)
        .text(brl(r.valorFinal), M, y + 8, { width: innerW - 14, align: 'right' });
      doc.font(FONT_TXT).fontSize(9).fillColor('#FFFFFF')
        .text(`Equivalente a ${brl(r.valorM2Final)}/m²`, M + 12, y + 30);
      y += 60;

      // -------- Relatório Fotográfico (se houver fotos) --------
      const fotos = extras?.fotos ?? [];
      if (fotos.length) {
        doc.addPage(); y = 60;
        titulo('RELATÓRIO FOTOGRÁFICO');
        for (let i = 0; i < fotos.length; i++) {
          if (y > 600) { doc.addPage(); y = 60; }
          const f = fotos[i];
          doc.font(FONT_TITULO).fontSize(9).fillColor(t.destaque)
            .text(`Foto ${i + 1}${f.legenda ? ' — ' + f.legenda : ''}`, M, y, { width: innerW });
          y = doc.y + 4;
          try {
            doc.image(Buffer.from(f.dataBase64, 'base64'), M, y, { fit: [innerW, 300], align: 'center' });
            y += 308;
          } catch {
            doc.font(FONT_TXT).fontSize(8).fillColor('#999').text('(falha ao renderizar foto)', M, y);
            y += 14;
          }
        }
      }

      // -------- Plantas anexas (imagens embutidas + lista de arquivos) --------
      const plImgs = extras?.plantasImagens ?? [];
      const plArqs = extras?.plantasArquivos ?? [];
      if (plImgs.length || plArqs.length) {
        doc.addPage(); y = 60;
        titulo('PLANTAS ANEXAS');
        for (const pl of plImgs) {
          if (y > 540) { doc.addPage(); y = 60; }
          doc.font(FONT_TITULO).fontSize(9).fillColor(t.destaque).text(pl.nome, M, y, { width: innerW });
          y = doc.y + 4;
          try {
            doc.image(pl.buffer, M, y, { fit: [innerW, 360], align: 'center' });
            y += 368;
          } catch {
            doc.font(FONT_TXT).fontSize(8).fillColor('#999').text('(falha ao renderizar planta)', M, y);
            y += 14;
          }
        }
        if (plArqs.length) {
          if (y > 680) { doc.addPage(); y = 60; }
          doc.font(FONT_TXT).fontSize(9).fillColor(t.texto).text('Plantas anexas:', M, y, { width: innerW });
          y = doc.y + 3;
          for (const a of plArqs) {
            const sufixo = a.anexado ? ' (anexada nas páginas a seguir)' : ' (enviada à parte)';
            doc.font(FONT_TXT).fontSize(9).fillColor(t.texto).text(`•  ${a.nome}${sufixo}`, M + 8, y, { width: innerW - 8 });
            y = doc.y + 2;
          }
          y += 6;
        }
      }

      // -------- 6. Base normativa + assinatura --------
      if (y > 660) { doc.addPage(); y = 60; }
      titulo('6. BASE NORMATIVA E RESPONSABILIDADE TÉCNICA');
      doc.font(FONT_TXT).fontSize(8).fillColor('#444');
      doc.text('ABNT NBR 13753 (assentamento c/ argamassa colante) • NBR 14081 (argamassa colante) • ' +
        'NBR 14992 (rejuntamento) • NBR 9050 (acessibilidade em soleiras/transições, quando aplicável).',
        M, y, { width: innerW });
      y = doc.y + 24;

      doc.moveTo(M + 120, y).lineTo(W - M - 120, y).strokeColor('#888').lineWidth(0.8).stroke();
      y += 4;
      doc.font(FONT_TITULO).fontSize(10).fillColor(t.texto)
        .text('José Romário Pinto Bezerra', M, y, { width: innerW, align: 'center' });
      doc.font(FONT_TXT).fontSize(8).fillColor('#444')
        .text('Técnico em Agrimensura — CFT/MA 01209185369 • Técnico em Edificações • CREA/CRECI-MA 4.705',
          M, doc.y + 1, { width: innerW, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
