// src/pdf/relatorioDemarcacaoPdf.ts
// Geração do PDF do Relatório de Fatura de Demarcações
// RomatecVoiceAgent v1.99.15 — usa pdfkit (mesma stack dos demais PDFs)

import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';

export interface ItemRelatorio {
  laudo_numero: string;
  tipo_imovel: string | null;
  imovel_descricao: string | null;
  contrato: string | null;
  quadra: string | null;
  lote: string | null;
  data_demarcacao: string | Date | null;
  area_m2: number;
  valor: number;
}

export interface RelatorioPdfInput {
  numero: string;
  data_emissao: string | Date;
  data_vencimento: string | Date | null;
  periodo_inicio: string | Date | null;
  periodo_fim: string | Date | null;
  loteador_nome: string;
  loteador_documento?: string | null;
  loteamento?: string | null;
  qtd_itens: number;
  area_total_m2: number;
  valor_total: number;
  pagamento_pix?: string | null;
  pagamento_banco?: string | null;
  pagamento_agencia?: string | null;
  pagamento_conta?: string | null;
  pagamento_titular?: string | null;
  pagamento_documento?: string | null;
  observacoes?: string | null;
  hash_validacao?: string | null;
  itens: ItemRelatorio[];
  baseUrlValidacao?: string;
}

const COR_VERDE = '#16a34a';
const COR_DOURADO = '#d4a017';
const COR_CINZA = '#6b7280';
const COR_PRETO = '#111827';

export async function gerarRelatorioDemarcacaoPdf(
  input: RelatorioPdfInput,
  outputPath: string
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // ===== HEADER =====
      doc.rect(40, 40, 515, 60).fillAndStroke('#f8fafc', '#e5e7eb');
      doc.fillColor(COR_VERDE).fontSize(20).font('Helvetica-Bold')
         .text('ROMATEC', 60, 55);
      doc.fillColor(COR_CINZA).fontSize(9).font('Helvetica')
         .text('Consultoria Total — Topografia, Avaliações e Demarcações', 60, 78)
         .text('Açailândia/MA · CFT/MA 01209185369 · INCRA: FQNS · CRECI/MA 4.705', 60, 90);

      doc.fillColor(COR_DOURADO).fontSize(11).font('Helvetica-Bold')
         .text(`RELATÓRIO DE DEMARCAÇÕES`, 360, 55, { width: 195, align: 'right' });
      doc.fillColor(COR_PRETO).fontSize(14).font('Helvetica-Bold')
         .text(input.numero, 360, 72, { width: 195, align: 'right' });
      doc.fillColor(COR_CINZA).fontSize(9).font('Helvetica')
         .text(`Emissão: ${formatData(input.data_emissao)}`, 360, 90, { width: 195, align: 'right' });

      let y = 120;

      // ===== DESTINATÁRIO =====
      doc.fillColor(COR_PRETO).fontSize(10).font('Helvetica-Bold')
         .text('DESTINATÁRIO', 40, y);
      doc.moveTo(40, y + 14).lineTo(555, y + 14).strokeColor('#e5e7eb').stroke();
      y += 20;
      doc.fillColor(COR_PRETO).fontSize(10).font('Helvetica-Bold')
         .text(input.loteador_nome, 40, y);
      if (input.loteador_documento) {
        doc.font('Helvetica').fontSize(9).fillColor(COR_CINZA)
           .text(`CPF/CNPJ: ${input.loteador_documento}`, 40, y + 13);
      }
      if (input.loteamento) {
        doc.font('Helvetica').fontSize(9).fillColor(COR_CINZA)
           .text(`Loteamento: ${input.loteamento}`, 280, y + 13);
      }
      y += 35;

      // ===== RESUMO =====
      doc.rect(40, y, 515, 50).fillAndStroke('#f0fdf4', '#bbf7d0');
      doc.fillColor(COR_VERDE).fontSize(8).font('Helvetica-Bold')
         .text('QTD. LAUDOS', 55, y + 8);
      doc.fillColor(COR_PRETO).fontSize(16).font('Helvetica-Bold')
         .text(String(input.qtd_itens), 55, y + 20);

      doc.fillColor(COR_VERDE).fontSize(8).font('Helvetica-Bold')
         .text('ÁREA TOTAL', 180, y + 8);
      doc.fillColor(COR_PRETO).fontSize(16).font('Helvetica-Bold')
         .text(`${formatNum(input.area_total_m2)} m²`, 180, y + 20);

      doc.fillColor(COR_VERDE).fontSize(8).font('Helvetica-Bold')
         .text('PERÍODO', 320, y + 8);
      doc.fillColor(COR_PRETO).fontSize(10).font('Helvetica')
         .text(`${formatData(input.periodo_inicio)} a ${formatData(input.periodo_fim)}`, 320, y + 25);

      doc.fillColor(COR_DOURADO).fontSize(8).font('Helvetica-Bold')
         .text('VALOR TOTAL', 455, y + 8);
      doc.fillColor(COR_DOURADO).fontSize(16).font('Helvetica-Bold')
         .text(formatMoeda(input.valor_total), 455, y + 20, { width: 95, align: 'right' });

      y += 65;

      // ===== TABELA DE ITENS =====
      doc.fillColor(COR_PRETO).fontSize(10).font('Helvetica-Bold')
         .text('ITENS', 40, y);
      doc.moveTo(40, y + 14).lineTo(555, y + 14).strokeColor('#e5e7eb').stroke();
      y += 22;

      // Cabeçalho da tabela
      const colX = { num: 40, imovel: 130, area: 380, data: 435, valor: 490 };
      doc.rect(40, y, 515, 18).fill('#1f2937');
      doc.fillColor('#fff').fontSize(8).font('Helvetica-Bold')
         .text('LAUDO', colX.num + 4, y + 5)
         .text('IMÓVEL / LOTE', colX.imovel + 4, y + 5)
         .text('ÁREA (m²)', colX.area, y + 5, { width: 50, align: 'right' })
         .text('DATA', colX.data, y + 5, { width: 50, align: 'center' })
         .text('VALOR', colX.valor, y + 5, { width: 65, align: 'right' });
      y += 18;

      let zebra = false;
      for (const it of input.itens) {
        // Quebra de página
        if (y > 720) {
          doc.addPage();
          y = 50;
        }
        if (zebra) doc.rect(40, y, 515, 22).fill('#f9fafb');
        zebra = !zebra;

        const imovelTxt = montarDescricaoImovel(it);
        doc.fillColor(COR_PRETO).fontSize(8).font('Helvetica-Bold')
           .text(it.laudo_numero, colX.num + 4, y + 4, { width: 85 });
        doc.fillColor(COR_CINZA).fontSize(7).font('Helvetica')
           .text(it.tipo_imovel || '', colX.num + 4, y + 14, { width: 85 });

        doc.fillColor(COR_PRETO).fontSize(8).font('Helvetica')
           .text(imovelTxt, colX.imovel + 4, y + 6, { width: 245, height: 14, ellipsis: true });

        doc.fillColor(COR_PRETO).fontSize(9).font('Helvetica')
           .text(formatNum(it.area_m2), colX.area, y + 6, { width: 50, align: 'right' });

        doc.fillColor(COR_CINZA).fontSize(8).font('Helvetica')
           .text(formatData(it.data_demarcacao), colX.data, y + 6, { width: 50, align: 'center' });

        doc.fillColor(COR_VERDE).fontSize(9).font('Helvetica-Bold')
           .text(formatMoeda(it.valor), colX.valor, y + 6, { width: 65, align: 'right' });

        y += 22;
      }

      // Linha de total
      doc.rect(40, y, 515, 22).fill('#fef3c7');
      doc.fillColor(COR_PRETO).fontSize(10).font('Helvetica-Bold')
         .text(`TOTAL (${input.qtd_itens} itens · ${formatNum(input.area_total_m2)} m²)`,
               colX.num + 4, y + 6);
      doc.fillColor(COR_DOURADO).fontSize(12).font('Helvetica-Bold')
         .text(formatMoeda(input.valor_total), colX.valor, y + 5, { width: 65, align: 'right' });
      y += 35;

      // ===== DADOS DE PAGAMENTO =====
      if (y > 650) { doc.addPage(); y = 50; }
      doc.fillColor(COR_PRETO).fontSize(10).font('Helvetica-Bold')
         .text('DADOS PARA PAGAMENTO', 40, y);
      doc.moveTo(40, y + 14).lineTo(555, y + 14).strokeColor('#e5e7eb').stroke();
      y += 22;

      doc.rect(40, y, 515, 80).fillAndStroke('#fefce8', '#fde68a');
      doc.fillColor(COR_PRETO).fontSize(9).font('Helvetica');

      let py = y + 10;
      if (input.pagamento_pix) {
        doc.font('Helvetica-Bold').text('PIX: ', 55, py, { continued: true })
           .font('Helvetica').text(input.pagamento_pix);
        py += 14;
      }
      if (input.pagamento_banco) {
        doc.font('Helvetica-Bold').text('Banco: ', 55, py, { continued: true })
           .font('Helvetica').text(`${input.pagamento_banco}  ·  Ag: ${input.pagamento_agencia || '-'}  ·  Conta: ${input.pagamento_conta || '-'}`);
        py += 14;
      }
      if (input.pagamento_titular) {
        doc.font('Helvetica-Bold').text('Titular: ', 55, py, { continued: true })
           .font('Helvetica').text(`${input.pagamento_titular} (${input.pagamento_documento || ''})`);
        py += 14;
      }
      if (input.data_vencimento) {
        doc.font('Helvetica-Bold').fillColor('#dc2626').text('Vencimento: ', 55, py, { continued: true })
           .font('Helvetica').text(formatData(input.data_vencimento));
      }
      y += 90;

      // ===== OBSERVAÇÕES =====
      if (input.observacoes) {
        if (y > 720) { doc.addPage(); y = 50; }
        doc.fillColor(COR_PRETO).fontSize(9).font('Helvetica-Bold').text('Observações:', 40, y);
        doc.fillColor(COR_CINZA).fontSize(9).font('Helvetica')
           .text(input.observacoes, 40, y + 13, { width: 515 });
      }

      // ===== QR CODE DE VALIDAÇÃO =====
      if (input.hash_validacao && input.baseUrlValidacao) {
        const urlValid = `${input.baseUrlValidacao}/v/${input.hash_validacao}`;
        const qrData = await QRCode.toDataURL(urlValid, { margin: 0, width: 80 });
        const qrBuffer = Buffer.from(qrData.split(',')[1], 'base64');
        doc.image(qrBuffer, 475, 760, { width: 70 });
        doc.fillColor(COR_CINZA).fontSize(6).font('Helvetica')
           .text('Validação', 475, 762 + 70, { width: 70, align: 'center' });
      }

      // ===== RODAPÉ =====
      doc.fillColor(COR_CINZA).fontSize(7).font('Helvetica')
         .text(
           `Documento emitido eletronicamente · Romatec Consultoria Total · Açailândia/MA · ${new Date().toLocaleString('pt-BR')}`,
           40, 815, { width: 440, align: 'left' }
         );

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

// ===== helpers =====
function montarDescricaoImovel(it: ItemRelatorio): string {
  const partes: string[] = [];
  if (it.imovel_descricao) partes.push(it.imovel_descricao);
  if (it.contrato) partes.push(`Contr. ${it.contrato}`);
  if (it.quadra) partes.push(`Q.${it.quadra}`);
  if (it.lote) partes.push(`Lote ${it.lote}`);
  return partes.join(' · ');
}
function formatData(d: any): string {
  if (!d) return '-';
  const s = String(d).slice(0, 10).split('-');
  if (s.length !== 3) return '-';
  return `${s[2]}/${s[1]}/${s[0]}`;
}
function formatMoeda(v: number): string {
  return `R$ ${Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
function formatNum(v: number): string {
  return Number(v).toFixed(2).replace('.', ',');
}
