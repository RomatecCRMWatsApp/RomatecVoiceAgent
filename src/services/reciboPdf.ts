// v1.69.0 — Geracao do PDF de recibo universal
//
// QR Code apontando pra URL publica /v/:hash (validacao permanente, sem auth).
// Selo "✓ CONFIRMADO" diagonal quando recibo foi confirmado.
// Layout adaptativo por tipo (titulo, corpo, valor opcional).

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { getTenantSettings } from './tenantSettings';
import type { Recibo } from '../integrations/recibos';
import { META } from '../integrations/recibos';

const fmtBRL = (n: number) =>
  'R$ ' + Number(n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

const fmtData = (d: Date | string | null): string => {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
};

const fmtDataHora = (d: Date | string | null): string => {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${fmtData(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
};

/** Base URL pra QR code. Usa env BASE_URL se setado, senao Railway URL. */
function getBaseUrl(): string {
  return (process.env.BASE_URL || 'https://romatecvoiceagent-production.up.railway.app').replace(/\/$/, '');
}

const FORMA_LABEL: Record<string, string> = {
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência bancária',
  cartao: 'Cartão',
  boleto: 'Boleto',
  cheque: 'Cheque',
};

export async function gerarPdfRecibo(recibo: Recibo): Promise<Buffer> {
  const t = await getTenantSettings(recibo.tenant_id).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const corHex = t?.primary_color || '#10b981';
  const cnpj = t?.cnpj || '';
  const logoFile = path.join(__dirname, '..', 'public', 'romatec-logo-removebg-preview.png');

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `${META.TITULO_PDF[recibo.tipo]} ${recibo.numero}`,
      Author: brand,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // ── Cabecalho ────────────────────────────────────────────────────────
  let yLogo = 40;
  if (fs.existsSync(logoFile)) {
    try {
      doc.image(logoFile, 40, yLogo, { fit: [110, 55] });
    } catch { /* opcional */ }
  }

  doc.fontSize(16).fillColor(corHex).font('Helvetica-Bold').text(brand, 170, 50);
  if (cnpj) {
    doc.fontSize(9).fillColor('#666').font('Helvetica').text(`CNPJ ${cnpj}`, 170, 75);
  }

  // Linha divisoria
  doc.moveTo(40, 110).lineTo(555, 110).strokeColor(corHex).lineWidth(2).stroke();

  // Titulo
  doc.fontSize(18).fillColor('#111').font('Helvetica-Bold')
     .text(META.TITULO_PDF[recibo.tipo], 40, 130, { align: 'center', width: 515 });
  doc.fontSize(11).fillColor('#666').font('Helvetica')
     .text(`Nº ${recibo.numero}`, 40, 158, { align: 'center', width: 515 });

  // ── Corpo ───────────────────────────────────────────────────────────
  let cy = 200;

  // Bloco destinatario
  doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold').text('DESTINATÁRIO', 40, cy);
  cy += 14;
  doc.fontSize(11).fillColor('#111').font('Helvetica')
     .text(recibo.destinatario_nome, 40, cy);
  cy += 14;
  if (recibo.destinatario_doc) {
    doc.fontSize(9).fillColor('#444').text(`CPF/CNPJ: ${recibo.destinatario_doc}`, 40, cy);
    cy += 12;
  }
  doc.fontSize(9).fillColor('#444').text(`Tel: ${recibo.destinatario_phone}`, 40, cy);
  cy += 12;
  if (recibo.destinatario_email) {
    doc.fontSize(9).fillColor('#444').text(`Email: ${recibo.destinatario_email}`, 40, cy);
    cy += 12;
  }
  cy += 12;

  // Bloco valor (so se tem valor)
  if (recibo.valor != null) {
    doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold').text('VALOR', 40, cy);
    cy += 14;
    doc.fontSize(20).fillColor('#111').font('Helvetica-Bold').text(fmtBRL(recibo.valor), 40, cy);
    cy += 28;
    if (recibo.forma_pagamento) {
      doc.fontSize(10).fillColor('#444').font('Helvetica')
         .text(`Forma de pagamento: ${FORMA_LABEL[recibo.forma_pagamento] || recibo.forma_pagamento}`, 40, cy);
      cy += 14;
    }
    cy += 8;
  }

  // Bloco descricao
  if (recibo.descricao_servico) {
    doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold').text('DESCRIÇÃO', 40, cy);
    cy += 14;
    doc.fontSize(10).fillColor('#111').font('Helvetica')
       .text(recibo.descricao_servico, 40, cy, { width: 515 });
    cy = doc.y + 12;
  }

  // Bloco datas
  doc.fontSize(10).fillColor(corHex).font('Helvetica-Bold').text('EMISSÃO', 40, cy);
  cy += 14;
  doc.fontSize(10).fillColor('#444').font('Helvetica')
     .text(`Emitido em: ${fmtDataHora(recibo.created_at)}`, 40, cy);
  cy += 12;
  if (recibo.expires_at) {
    doc.text(`Válido até: ${fmtData(recibo.expires_at)}`, 40, cy);
    cy += 12;
  }
  cy += 8;

  // Bloco confirmacao (se ja respondido)
  if (recibo.respondido_em) {
    const corStatus =
      recibo.status === 'confirmado' ? '#10b981' :
      recibo.status === 'contestado' ? '#dc2626' :
      '#3b82f6';
    doc.fontSize(10).fillColor(corStatus).font('Helvetica-Bold')
       .text('STATUS DE CONFIRMAÇÃO', 40, cy);
    cy += 14;
    const labelStatus =
      recibo.status === 'confirmado' ? '✓ CONFIRMADO PELO DESTINATÁRIO' :
      recibo.status === 'contestado' ? '✗ CONTESTADO PELO DESTINATÁRIO' :
      `Respondido (${recibo.resposta_acao})`;
    doc.fontSize(11).fillColor(corStatus).text(labelStatus, 40, cy);
    cy += 14;
    doc.fontSize(9).fillColor('#444').font('Helvetica')
       .text(`Em ${fmtDataHora(recibo.respondido_em)} via WhatsApp`, 40, cy);
    cy += 12;
    if (recibo.ip_resposta) {
      doc.text(`IP: ${recibo.ip_resposta}`, 40, cy);
      cy += 12;
    }
    if (recibo.resposta_obs) {
      cy += 4;
      doc.fontSize(9).fillColor('#444').text(`Observação: ${recibo.resposta_obs}`, 40, cy, { width: 515 });
      cy = doc.y + 8;
    }
  }

  // ── Selo diagonal "CONFIRMADO" (so se confirmado) ───────────────────
  if (recibo.status === 'confirmado') {
    doc.save()
       .translate(310, 480)
       .rotate(-20)
       .fontSize(50)
       .fillColor('#10b98133')
       .font('Helvetica-Bold')
       .text('✓ CONFIRMADO', -150, -25, { width: 300, align: 'center' })
       .restore();
  }

  // ── Rodape: QR code + hash + assinatura ──────────────────────────────
  const qrUrl = `${getBaseUrl()}/v/${recibo.hash_validacao}`;
  try {
    const qrPng = await QRCode.toBuffer(qrUrl, {
      width: 110,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: corHex, light: '#FFFFFF' },
    });
    doc.image(qrPng, 445, 700, { width: 110 });
    doc.fontSize(8).fillColor('#666').font('Helvetica')
       .text('Escaneie para validar', 440, 815, { width: 120, align: 'center' });
  } catch (err) {
    console.warn('[reciboPdf] falha gerar QR:', (err as Error).message);
  }

  // Hash truncado + url
  doc.fontSize(8).fillColor('#888').font('Helvetica')
     .text('Hash de autenticidade:', 40, 700)
     .fillColor('#444').font('Courier')
     .text(recibo.hash_validacao.slice(0, 32) + '...', 40, 712, { width: 380 });
  doc.fontSize(8).fillColor('#888').font('Helvetica')
     .text(`Validar em: ${qrUrl}`, 40, 730, { width: 380 });

  // Assinatura
  doc.fontSize(8).fillColor('#666').font('Helvetica')
     .text(`Documento eletrônico autenticado por ${brand}.`, 40, 800, { width: 400 })
     .text(`Qualquer alteração no PDF invalida o hash criptográfico.`, 40, 812, { width: 400 });

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}
