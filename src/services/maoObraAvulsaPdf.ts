// src/services/maoObraAvulsaPdf.ts
// v3.92.0 — PDF do "Recibo de Pagamento — Mão de Obra Avulsa". PDFKit, tema
// Romatec (verde #0C3320 / dourado #C9A84C), reusando QR + hash + selo
// "✓ CONFIRMADO" do reciboPdfShared. Espelha o valePdf, sem alterá-lo.
import PDFDocument from 'pdfkit';
import type { Recibo } from '../integrations/recibos';
import type { MaoObraAvulsa } from '../integrations/maoObraAvulsa';
import { renderQRValidacao, renderHashFooter, renderSeloConfirmado } from './reciboPdfShared';

// getBaseUrl inline (mesma regra do reciboPdf) — evita acoplar este PDF à cadeia
// pesada de reciboPdf (tenantSettings/embeddings), mantendo o módulo leve/testável.
function getBaseUrl(): string {
  const url = process.env.PUBLIC_BASE_URL || process.env.BASE_URL
    || 'https://romatecvoiceagent-production.up.railway.app';
  return url.replace(/\/$/, '');
}

const VERDE = '#0C3320';
const DOURADO = '#C9A84C';

const fmtBRL = (n: number) =>
  'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtData = (d?: string | null): string => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
};

const FORMA_LABEL: Record<string, string> = {
  pix: 'PIX', dinheiro: 'Dinheiro', transferencia: 'Transferência', outro: 'Outro',
};

export async function gerarPdfMaoObraAvulsa(
  recibo: Recibo,
  det: MaoObraAvulsa,
  opts?: { comprovante?: { mime: string; base64: string } | null },
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  const M = 40;
  const innerW = 595 - M * 2;

  // ── Cabeçalho (faixa verde) ──
  doc.rect(0, 0, 595, 92).fill(VERDE);
  doc.fillColor(DOURADO).font('Helvetica-Bold').fontSize(18).text('ROMATEC CONSULTORIA TOTAL', M, 24, { width: innerW });
  doc.fillColor('#fff').font('Helvetica').fontSize(12).text('Recibo de Pagamento — Mão de Obra Avulsa', M, 50, { width: innerW });
  doc.fillColor(DOURADO).font('Helvetica-Bold').fontSize(11).text(`Nº ${recibo.numero}`, M, 70, { width: innerW });

  let y = 118;
  const linha = (label: string, valor: string) => {
    doc.fillColor('#6A6656').font('Helvetica').fontSize(9).text(label.toUpperCase(), M, y);
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(12).text(valor || '—', M, y + 11, { width: innerW });
    y += 34;
  };

  linha('Obra', det.obra_nome || (det.obra_id ? `Obra #${det.obra_id}` : '—'));
  linha('Prestador', det.nome_prestador);
  linha('Telefone', det.telefone_whatsapp + (det.cpf ? `   ·   CPF: ${det.cpf}` : ''));
  const servico = det.descricao_servico ? `${det.tipo_servico} — ${det.descricao_servico}` : det.tipo_servico;
  linha('Serviço prestado', servico);

  // Valor em destaque
  doc.rect(M, y, innerW, 46).fill(VERDE);
  doc.fillColor(DOURADO).font('Helvetica').fontSize(9).text('VALOR PAGO', M + 14, y + 8);
  doc.fillColor(DOURADO).font('Helvetica-Bold').fontSize(22).text(fmtBRL(det.valor_pago), M + 14, y + 18);
  doc.fillColor('#E3D19A').font('Helvetica').fontSize(10)
     .text(`${FORMA_LABEL[det.forma_pagamento] || det.forma_pagamento}  ·  ${fmtData(det.data_pagamento)}`, M + 14, y + 8, { width: innerW - 28, align: 'right' });
  y += 62;

  // ── Comprovante (miniatura se imagem) ──
  doc.fillColor('#6A6656').font('Helvetica').fontSize(9).text('COMPROVANTE DE PAGAMENTO', M, y);
  y += 14;
  const comp = opts?.comprovante;
  if (comp && comp.base64) {
    if ((comp.mime || '').startsWith('image/')) {
      try {
        doc.image(Buffer.from(comp.base64, 'base64'), M, y, { fit: [200, 200] });
        y += 210;
      } catch {
        doc.fillColor('#111').font('Helvetica').fontSize(10).text('(comprovante anexado — falha ao renderizar imagem)', M, y); y += 20;
      }
    } else {
      doc.fillColor('#111').font('Helvetica').fontSize(10).text(`📎 Comprovante anexado (${det.comprovante_nome || comp.mime}) — enviado junto no WhatsApp.`, M, y, { width: innerW }); y += 20;
    }
  } else {
    doc.fillColor('#888').font('Helvetica-Oblique').fontSize(10).text('Nenhum comprovante anexado.', M, y); y += 20;
  }

  // ── Assinatura ──
  const assinaturaY = 690;
  doc.moveTo(M, assinaturaY).lineTo(M + 300, assinaturaY).strokeColor('#444').lineWidth(0.7).stroke();
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('José Romário Pinto Bezerra', M, assinaturaY + 6);
  doc.fillColor('#555').font('Helvetica').fontSize(9).text('CFT/MA 01209185369 — Romatec Consultoria Total', M, assinaturaY + 22);

  // ── Validação (QR + hash) ──
  const baseUrl = getBaseUrl();
  const qrUrl = await renderQRValidacao(doc, recibo.hash_validacao, baseUrl, 430, 660, { size: 100, corHex: VERDE, comLabel: true });
  renderHashFooter(doc, recibo.hash_validacao, qrUrl, M, 760, 380);

  // Selo diagonal quando confirmado (contra-recibo)
  if (recibo.status === 'confirmado') {
    renderSeloConfirmado(doc, 300, 430);
  }

  doc.end();
  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}
