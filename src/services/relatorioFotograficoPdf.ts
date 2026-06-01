// v3.53.0 — Task 1 (plano VTA): gerador de PDF do Relatorio Fotografico (Modulo B).
// Documento tecnico autonomo (capa + grid de fotos com overlay + assinatura
// tecnica) para instruir averbacao/REURB a parte do laudo.
//
// Reusa: parseDataUri/montarNotaAsBuilt (laudoAnexos), getTenantSettings (timbre),
// padrao visual do laudoPdf. As fotos ja carregam overlay tecnico embutido
// (fotos_vistoria.base64_overlay), entao aqui so embarcamos a imagem + legenda.

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { parseDataUri, montarNotaAsBuilt } from './laudoAnexos';
import { getTenantSettings } from './tenantSettings';
import type { SignatureVisualMeta } from './reciboPdf';

// ── Tipos ────────────────────────────────────────────────────────────────
export interface FotoVistoriaPdf {
  base64_overlay: string | null;
  descricao: string | null;
  municipio: string | null;
  logradouro: string | null;
  utm_zona: string | null;
  utm_e: number | string | null;
  utm_n: number | string | null;
  datum: string | null;
  colaborador: string | null;
  horario_captura: string | Date | null;
}

export interface RelatorioFotograficoMeta {
  id: number;
  titulo: string;
  laudo_id: number | null;
  proposta_id: number | null;
  colaborador: string;
  municipio: string | null;
  data_vistoria: string | Date | null;
  observacoes: string | null;
}

export interface ExecutanteRelFoto {
  nome: string;
  qualificacao?: string | null;
  registro_cft?: string | null;
  registro_crea?: string | null;
  registro_creci?: string | null;
  cadastro_incra?: string | null;
  cnai?: string | null;
}

export interface RelFotoPdfInput {
  relatorio: RelatorioFotograficoMeta;
  fotos: FotoVistoriaPdf[];
  executante?: ExecutanteRelFoto | null;
  signatureMeta?: SignatureVisualMeta;
}

// Responsavel tecnico padrao Romatec (quando nao informado executante).
const RT_PADRAO: ExecutanteRelFoto = {
  nome: 'José Romário Pinto Bezerra',
  qualificacao: 'Técnico em Agrimensura',
  registro_cft: 'CFT/MA 01209185369',
  registro_creci: 'CRECI/MA 4.705',
  cadastro_incra: 'FQNS',
  cnai: '031161',
};

// ── Helpers puros (testaveis) ───────────────────────────────────────────────
function fmtDataHora(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtData(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Legenda tecnica: descricao + local + georref (UTM/SIRGAS) + colaborador/horario.
export function legendaFotoRelatorio(f: FotoVistoriaPdf, indice: number): string {
  const base = (f.descricao && String(f.descricao).trim()) || `Registro fotográfico ${indice}`;

  const local: string[] = [];
  if (f.logradouro && String(f.logradouro).trim()) local.push(String(f.logradouro).trim());
  if (f.municipio && String(f.municipio).trim()) local.push(String(f.municipio).trim());

  const geo: string[] = [];
  const e = f.utm_e != null ? Number(f.utm_e) : null;
  const n = f.utm_n != null ? Number(f.utm_n) : null;
  if (e != null && Number.isFinite(e) && n != null && Number.isFinite(n)) {
    const zona = f.utm_zona ? ` ${String(f.utm_zona).trim()}` : '';
    geo.push(`UTM${zona}: E ${Math.round(e).toLocaleString('pt-BR')} / N ${Math.round(n).toLocaleString('pt-BR')}`);
  }
  if (f.datum && String(f.datum).trim()) geo.push(String(f.datum).trim());

  const meta: string[] = [];
  if (f.colaborador && String(f.colaborador).trim()) meta.push(String(f.colaborador).trim());
  const dh = fmtDataHora(f.horario_captura);
  if (dh) meta.push(dh);

  let txt = base;
  if (local.length) txt += ` — ${local.join('/')}`;
  if (geo.length) txt += ` (${geo.join(' · ')})`;
  if (meta.length) txt += ` · ${meta.join(', ')}`;
  return txt;
}

// Agrupa fotos em paginas de N (default 4 = grid 2x2).
export function paginarFotos<T>(fotos: T[], porPagina: number): T[][] {
  const n = Number.isInteger(porPagina) && porPagina > 0 ? porPagina : 4;
  const out: T[][] = [];
  for (let i = 0; i < fotos.length; i += n) out.push(fotos.slice(i, i + n));
  return out;
}

// ── Gerador do PDF ──────────────────────────────────────────────────────────
export async function gerarPdfRelatorioFotografico(input: RelFotoPdfInput): Promise<Buffer> {
  const { relatorio, fotos } = input;
  const rt = input.executante || RT_PADRAO;
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const corHex = t?.primary_color || '#10b981';
  const corGold = '#B8893A';

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Relatorio Fotografico ${relatorio.titulo}`,
      Author: brand,
      Subject: `Relatorio fotografico tecnico (As-Built) #${relatorio.id}`,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', c => chunks.push(c as Buffer));

  // ── Cabecalho ──
  try {
    const logoPath = path.join(__dirname, '..', 'public', 'logo_R-removebg-preview.png');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 40, 30, { width: 50 });
  } catch { /* ignora */ }
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold').text(brand, 100, 36, { width: 455 });
  doc.fontSize(8).fillColor('#666').font('Helvetica')
     .text('Relatório Fotográfico Técnico — As-Built / Regularização', 100, 52);
  doc.fontSize(9).fillColor(corGold).font('Helvetica-Bold')
     .text(`Nº RF-${String(relatorio.id).padStart(4, '0')}`, 40, 90, { width: 515, align: 'right' });
  doc.moveTo(40, 105).lineTo(555, 105).strokeColor(corGold).lineWidth(2).stroke();

  // ── Titulo ──
  doc.fontSize(17).fillColor(corHex).font('Helvetica-Bold')
     .text('RELATÓRIO FOTOGRÁFICO TÉCNICO', 40, 120, { width: 515, align: 'center' });
  doc.fontSize(11).fillColor('#444').font('Helvetica')
     .text(relatorio.titulo, 40, 144, { width: 515, align: 'center' });

  let cy = 172;

  // ── Dados da vistoria ──
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('1. DADOS DA VISTORIA', 40, cy);
  cy += 16;
  const vinculo = relatorio.laudo_id != null
    ? `Laudo de Demarcação #${relatorio.laudo_id}`
    : (relatorio.proposta_id != null ? `Proposta #${relatorio.proposta_id}` : 'Avulso (sem vínculo)');
  const linhas: Array<[string, string]> = [
    ['Vínculo', vinculo],
    ['Colaborador (captura)', relatorio.colaborador || '-'],
    ['Município', relatorio.municipio || '-'],
    ['Data da vistoria', fmtData(relatorio.data_vistoria) || '-'],
    ['Total de registros', String(fotos.length)],
  ];
  doc.fontSize(10).font('Helvetica');
  for (const [k, v] of linhas) {
    doc.fillColor('#666').font('Helvetica-Bold').text(`${k}: `, 40, cy, { continued: true });
    doc.fillColor('#111').font('Helvetica').text(v);
    cy = doc.y + 2;
  }
  if (relatorio.observacoes && String(relatorio.observacoes).trim()) {
    cy += 4;
    doc.fillColor('#666').font('Helvetica-Bold').text('Observações: ', 40, cy, { continued: true });
    doc.fillColor('#111').font('Helvetica').text(String(relatorio.observacoes).trim(), { width: 515 });
    cy = doc.y + 2;
  }
  cy += 8;

  // ── Nota As-Built ──
  doc.fontSize(7.5).fillColor('#555').font('Helvetica-Oblique')
     .text(montarNotaAsBuilt({ temCroqui: false, temFotos: true }), 40, cy, { width: 515, align: 'justify' });
  cy = doc.y + 12;

  // ── Registros fotograficos (grid 2 col) ──
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('2. REGISTROS FOTOGRÁFICOS', 40, cy);
  cy += 16;
  const fotoW = 250;
  const fotoH = 188;
  let col = 0;
  for (let i = 0; i < fotos.length; i++) {
    const f = fotos[i];
    if (cy + fotoH + 30 > 800) { doc.addPage(); cy = 60; col = 0; }
    const parsed = parseDataUri(f.base64_overlay);
    const x = col === 0 ? 40 : 305;
    if (parsed && parsed.mime.startsWith('image/')) {
      try {
        const buf = Buffer.from(parsed.base64, 'base64');
        doc.image(buf, x, cy, { width: fotoW, height: fotoH, fit: [fotoW, fotoH] });
      } catch {
        doc.rect(x, cy, fotoW, fotoH).strokeColor('#ddd').stroke();
      }
    } else {
      doc.rect(x, cy, fotoW, fotoH).strokeColor('#ddd').stroke();
      doc.fontSize(8).fillColor('#999').font('Helvetica-Oblique')
         .text('(imagem indisponível)', x, cy + fotoH / 2, { width: fotoW, align: 'center' });
    }
    doc.fontSize(7).fillColor('#444').font('Helvetica')
       .text(legendaFotoRelatorio(f, i + 1), x, cy + fotoH + 2, { width: fotoW, align: 'center' });
    if (col === 1) { cy += fotoH + 30; col = 0; } else { col = 1; }
  }
  if (col === 1) cy += fotoH + 30;
  cy += 10;
  if (fotos.length === 0) {
    doc.fontSize(9).fillColor('#999').font('Helvetica-Oblique')
       .text('(Nenhum registro fotográfico neste relatório.)', 40, cy, { width: 515, align: 'center' });
    cy += 16;
  }

  // ── Bloco visual da assinatura digital ICP-Brasil (quando assinado) ──
  if (input.signatureMeta) {
    const m = input.signatureMeta;
    if (cy + 92 > 800) { doc.addPage(); cy = 60; }
    const boxY = cy, boxH = 78;
    doc.save().rect(40, boxY, 515, boxH).fillColor('#eafaf1').fill().restore();
    doc.rect(40, boxY, 515, boxH).strokeColor('#1F5C3A').lineWidth(1).stroke();
    doc.fontSize(10).fillColor('#1F5C3A').font('Helvetica-Bold')
       .text('ASSINADO DIGITALMENTE — ICP-Brasil (PAdES)', 50, boxY + 8, { width: 495 });
    doc.fontSize(8).fillColor('#222').font('Helvetica');
    const cn = (m.signer_cn || '').replace(/:\d+$/, '');
    doc.text(`Signatário: ${cn}${m.signer_doc ? ' · ' + m.signer_doc : ''}`, 50, boxY + 26, { width: 495 });
    if (m.issuer_cn) doc.text(`AC emitente: ${m.issuer_cn}`, 50, doc.y, { width: 495 });
    doc.text(`Data: ${fmtDataHora(m.data_assinatura)}${m.validade_ate ? ' · Validade do certificado: ' + fmtData(m.validade_ate) : ''}`, 50, doc.y, { width: 495 });
    if (m.thumbprint) doc.fontSize(7).fillColor('#555').text(`Thumbprint: ${m.thumbprint}`, 50, doc.y, { width: 495 });
    cy = boxY + boxH + 10;
  }

  // ── Assinatura tecnica ──
  if (cy + 120 > 800) { doc.addPage(); cy = 60; }
  cy += 10;
  const localData = `${relatorio.municipio || 'Açailândia'}/MA, ${fmtData(new Date())}`;
  doc.fontSize(9).fillColor('#444').font('Helvetica').text(localData, 40, cy, { width: 515, align: 'right' });
  cy += 30;
  doc.moveTo(180, cy).lineTo(415, cy).strokeColor('#333').lineWidth(0.8).stroke();
  cy += 4;
  doc.fontSize(10).fillColor('#111').font('Helvetica-Bold')
     .text(rt.nome, 40, cy, { width: 515, align: 'center' });
  cy = doc.y + 1;
  const credenciais: string[] = [];
  if (rt.qualificacao) credenciais.push(rt.qualificacao);
  if (rt.registro_cft) credenciais.push(rt.registro_cft);
  if (rt.registro_crea) credenciais.push(`CREA ${rt.registro_crea}`);
  if (rt.registro_creci) credenciais.push(rt.registro_creci);
  if (rt.cnai) credenciais.push(`CNAI ${rt.cnai}`);
  if (rt.cadastro_incra) credenciais.push(`INCRA ${rt.cadastro_incra}`);
  doc.fontSize(8).fillColor('#555').font('Helvetica')
     .text(credenciais.join(' · '), 40, cy, { width: 515, align: 'center' });

  // ── Rodape ──
  doc.fontSize(7).fillColor('#999').font('Helvetica')
     .text(`${brand} — Relatório gerado em ${fmtDataHora(new Date())}`, 40, 802, { width: 515, align: 'center' });

  doc.end();
  return new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
