// v1.99.13: PDF de RECIBO DE VALE (adiantamento) — documento individual,
// emitido na hora pelo CEO/admin pra cada vale passado a um colaborador.
//
// Diferente do recibo quinzenal (consolidado), este e gerado por evento:
//   1) CEO clica "Passar Vale" na Folha Mensal
//   2) Preview do PDF aparece em tempo real (split-screen)
//   3) Confirma -> persiste ajuste + envia WhatsApp com PDF anexo
// v1.99.16: aceita parametro `recibo` (recibo universal tipo='vale').
// Quando presente, PDF inclui QR de validacao /v/:hash + hash truncado +
// (se status=confirmado) selo "✓ CONFIRMADO" diagonal sobreposto.

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { getTenantSettings } from './tenantSettings';
import type { Recibo } from '../integrations/recibos';
import { getBaseUrl } from './reciboPdf';
import {
  renderQRValidacao,
  renderHashFooter,
  renderSeloConfirmado,
} from './reciboPdfShared';

const fmtBRL = (n: number) =>
  'R$ ' + Number(n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

const fmtData = (d: Date | string): string => {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
};

function periodoLabel(codigo: string): string {
  const m = /^(\d{4})-(\d{2})-([12])$/.exec(codigo || '');
  if (!m) return codigo;
  const meses = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${m[3]}ª quinzena de ${meses[Number(m[2])]}/${m[1]}`;
}

// Helper: valor por extenso pt-BR (reusa logica simples)
function numeroExtenso(n: number): string {
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

export interface ValePdfInput {
  membro_nome: string;
  membro_cpf?: string | null;
  membro_funcao?: string | null;
  membro_telefone?: string | null;
  valor: number;
  descricao?: string | null;
  periodo: string;          // 'YYYY-MM-1' ou 'YYYY-MM-2'
  saldo_anterior: number;   // total a receber antes do vale
  data_emissao?: Date;
  obra_nome?: string | null;
  /** Numero sequencial do vale (opcional — se nao tiver, usa timestamp curto) */
  numero?: string;
  /** Modo preview = sem QR/hash (rapido), sem persistencia */
  preview?: boolean;
  /**
   * v1.99.16: Recibo universal associado ao vale.
   * Quando presente, o PDF inclui:
   *   - QR Code apontando pra /v/:hash (validacao publica)
   *   - Hash de autenticidade no rodape
   *   - Selo "✓ CONFIRMADO" diagonal sobreposto (se status='confirmado')
   * Em modo preview/sem persistencia, deve ser undefined/null.
   */
  recibo?: Recibo | null;
}

export async function gerarPdfVale(input: ValePdfInput): Promise<Buffer> {
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const corHex = t?.primary_color || '#10b981';
  const corGold = '#B8893A';

  const dataEmissao = input.data_emissao || new Date();
  const saldoApos = input.saldo_anterior - input.valor;
  const numero = input.numero || `VALE-${Date.now().toString(36).toUpperCase().slice(-6)}`;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Recibo de Vale ${numero}`,
      Author: brand,
      Subject: `Vale para ${input.membro_nome}`,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', c => chunks.push(c as Buffer));

  // ── Logo + Cabeçalho ─────────────────────────────────────────────────────
  try {
    const logoPath = path.join(__dirname, '..', 'public', 'logo_R-removebg-preview.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 50 });
    }
  } catch { /* ignora */ }

  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
     .text(brand, 100, 36, { width: 455 });
  doc.fontSize(8).fillColor('#666').font('Helvetica')
     .text('Recibo de Vale (Adiantamento sobre Diárias)', 100, 52, { width: 455 });

  // Numero do vale
  doc.fontSize(9).fillColor(corGold).font('Helvetica-Bold')
     .text(`Nº ${numero}`, 40, 90, { width: 515, align: 'right' });

  // ── Linha separadora dourada ────────────────────────────────────────────
  doc.moveTo(40, 105).lineTo(555, 105).strokeColor(corGold).lineWidth(2).stroke();

  // ── Título grande ───────────────────────────────────────────────────────
  doc.fontSize(20).fillColor(corHex).font('Helvetica-Bold')
     .text('RECIBO DE VALE', 40, 120, { width: 515, align: 'center' });
  doc.fontSize(10).fillColor('#666').font('Helvetica-Oblique')
     .text(`Adiantamento sobre diárias da ${periodoLabel(input.periodo)}`, 40, 145, { width: 515, align: 'center' });

  // ── Bloco do colaborador ────────────────────────────────────────────────
  let cy = 180;
  doc.fontSize(10).fillColor('#888').font('Helvetica')
     .text('COLABORADOR', 40, cy);
  cy += 14;
  doc.fontSize(13).fillColor('#111').font('Helvetica-Bold')
     .text(input.membro_nome, 40, cy);
  cy += 16;
  if (input.membro_funcao) {
    doc.fontSize(10).fillColor('#444').font('Helvetica')
       .text(`Função: ${input.membro_funcao}`, 40, cy);
    cy += 12;
  }
  if (input.membro_cpf) {
    doc.fontSize(10).fillColor('#444').font('Helvetica')
       .text(`CPF: ${input.membro_cpf}`, 40, cy);
    cy += 12;
  }
  if (input.obra_nome) {
    doc.fontSize(10).fillColor('#444').font('Helvetica')
       .text(`Obra: ${input.obra_nome}`, 40, cy);
    cy += 12;
  }

  cy += 14;
  doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
  cy += 16;

  // ── Bloco do valor ──────────────────────────────────────────────────────
  doc.fontSize(10).fillColor('#888').font('Helvetica')
     .text('VALOR DO VALE', 40, cy);
  cy += 14;
  doc.fontSize(28).fillColor(corGold).font('Helvetica-Bold')
     .text(fmtBRL(input.valor), 40, cy, { width: 515 });
  cy += 32;
  doc.fontSize(10).fillColor('#444').font('Helvetica-Oblique')
     .text(`(${numeroExtenso(input.valor)})`, 40, cy, { width: 515 });
  cy += 18;

  if (input.descricao) {
    doc.fontSize(10).fillColor('#444').font('Helvetica')
       .text(`Referente a: ${input.descricao}`, 40, cy, { width: 515 });
    cy += 14;
  }

  cy += 14;
  doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
  cy += 16;

  // ── Saldo ────────────────────────────────────────────────────────────────
  doc.fontSize(10).fillColor('#888').font('Helvetica')
     .text('IMPACTO NO RECIBO QUINZENAL', 40, cy);
  cy += 14;

  const drawLinhaSaldo = (label: string, valor: string, cor: string, bold = false) => {
    doc.fontSize(10).fillColor('#444').font('Helvetica').text(label, 40, cy);
    doc.fontSize(11).fillColor(cor).font(bold ? 'Helvetica-Bold' : 'Helvetica')
       .text(valor, 40, cy, { width: 515, align: 'right' });
    cy += 14;
  };
  drawLinhaSaldo('Saldo de diárias antes do vale:', fmtBRL(input.saldo_anterior), '#444');
  drawLinhaSaldo('(–) Vale neste documento:',       fmtBRL(input.valor),          '#dc2626');
  doc.moveTo(40, cy + 2).lineTo(555, cy + 2).strokeColor('#999').lineWidth(0.5).stroke();
  cy += 6;
  drawLinhaSaldo('Saldo restante a receber:',       fmtBRL(saldoApos),            saldoApos < 0 ? '#dc2626' : corHex, true);

  cy += 16;

  // ── Texto explicativo ──────────────────────────────────────────────────
  doc.fontSize(9).fillColor('#444').font('Helvetica')
     .text(
       `Recebi do(a) emitente o valor de ${fmtBRL(input.valor)} (${numeroExtenso(input.valor)}) ` +
       `a título de VALE / ADIANTAMENTO sobre as diárias trabalhadas. ` +
       `Este valor será descontado integralmente do recibo quinzenal correspondente ` +
       `à ${periodoLabel(input.periodo)}.`,
       40, cy, { width: 515, align: 'justify' }
     );
  cy = doc.y + 18;

  // ── Local + Data + Linha de assinatura ─────────────────────────────────
  const cidade = 'Açailândia/MA';
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const dataExtenso = `${cidade}, ${dataEmissao.getDate()} de ${meses[dataEmissao.getMonth()]} de ${dataEmissao.getFullYear()}.`;
  doc.fontSize(10).fillColor('#111').font('Helvetica')
     .text(dataExtenso, 40, cy, { width: 515, align: 'center' });
  cy += 50;

  // Linha colaborador (esq) + linha emitente (dir)
  doc.moveTo(60, cy).lineTo(280, cy).strokeColor('#444').lineWidth(0.5).stroke();
  doc.moveTo(315, cy).lineTo(535, cy).strokeColor('#444').lineWidth(0.5).stroke();
  cy += 6;
  doc.fontSize(8).fillColor('#222').font('Helvetica-Bold')
     .text(input.membro_nome, 60, cy, { width: 220, align: 'center' });
  doc.fontSize(8).fillColor('#222').font('Helvetica-Bold')
     .text('ROMATEC CONSULTORIA TOTAL', 315, cy, { width: 220, align: 'center' });
  cy += 10;
  doc.fontSize(7).fillColor('#666').font('Helvetica')
     .text('Colaborador (assinatura)', 60, cy, { width: 220, align: 'center' });
  doc.fontSize(7).fillColor('#666').font('Helvetica')
     .text('Emitente (CNPJ 17.261.987/0001-09)', 315, cy, { width: 220, align: 'center' });

  // ── v1.99.16: BLOCO DE VALIDACAO DIGITAL (QR + hash) ──────────────────
  // So renderiza quando o vale e um recibo universal persistido.
  // Em modo preview ou sem recibo associado, pula este bloco.
  if (input.recibo) {
    const baseUrl = getBaseUrl();
    const qrUrl = await renderQRValidacao(
      doc, input.recibo.hash_validacao, baseUrl,
      460, 720,
      { size: 75, corHex, comLabel: true }
    );
    renderHashFooter(doc, input.recibo.hash_validacao, qrUrl, 40, 720, 410);

    // Selo "✓ CONFIRMADO" diagonal — so quando confirmado
    if (input.recibo.status === 'confirmado') {
      // Posicao ajustada pra centro-superior do PDF do vale (480 cobre o
      // bloco "VALOR DO VALE" — chama atencao mas nao impede leitura por
      // causa da opacidade 33%)
      renderSeloConfirmado(doc, 310, 460);
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────
  doc.fontSize(7).fillColor('#999').font('Helvetica-Oblique')
     .text(
       `${brand} · Documento emitido em ${fmtData(dataEmissao)} ${dataEmissao.getHours().toString().padStart(2,'0')}:${dataEmissao.getMinutes().toString().padStart(2,'0')}` +
       (input.preview ? ' · PREVIEW (não persistido)' : ''),
       40, 800, { width: 515, align: 'center' }
     );

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}
