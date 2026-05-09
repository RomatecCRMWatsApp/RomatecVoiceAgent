// v1.99.28 — PDF do Laudo Tecnico de Demarcacao.
// Reusa reciboPdfShared.ts pra QR/hash/selo. Gera memorial NTGIR
// automatico a partir dos pontos + lados.
//
// Layout enxuto (Fase 4 escopo C — finalizar tudo na sessao):
//   1. Cabecalho Romatec
//   2. Titulo
//   3. Contratante
//   4. Executante
//   5. Objeto da demarcacao + confrontantes
//   6. Tabela de coordenadas
//   7. Memorial descritivo NTGIR auto
//   8. Tabela de lados (azimute + distancia)
//   9. Area + perimetro
//  10. Croqui (auto SVG ou upload)
//  11. Fotos (grid 2 cols)
//  12. ART/TRT
//  13. Local + data + linha de assinatura
//  14. QR + hash no rodape

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { getTenantSettings } from './tenantSettings';
import {
  renderQRValidacao,
  renderHashFooter,
  renderSeloConfirmado,
} from './reciboPdfShared';
import { getBaseUrl } from './reciboPdf';
import type { Laudo, PontoLaudo, LadoLaudo } from '../integrations/laudos';
import type { Contratante } from '../integrations/contratantes';
import type { Executante } from '../integrations/executantes';
import { azimuteParaDMS } from './geometria';

const fmtBRL = (n: number) =>
  'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtArea = (m2: number): string => {
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(4).replace('.', ',')} ha (${m2.toFixed(2).replace('.', ',')} m²)`;
  return `${m2.toFixed(2).replace('.', ',')} m²`;
};

const fmtNum = (n: number, casas = 4): string =>
  Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function fmtData(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// v2.0.1: formata CPF/CNPJ pra exibicao com mascara
function formatarCpfCnpj(v: string | null, tipo: 'PF' | 'PJ'): string {
  if (!v) return '—';
  const d = String(v).replace(/\D/g, '');
  if (tipo === 'PF' && d.length === 11) {
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  if (tipo === 'PJ' && d.length === 14) {
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return d;
}

function fmtDataExtenso(d: Date): string {
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * Gera memorial descritivo NTGIR automatico.
 * Formato: "Inicia-se a descricao deste perimetro no vertice V1 de
 * coordenadas UTM E=xxx,xxxxm e N=xxx,xxxxm; dai segue com azimute de
 * xx°xx'xx" e distancia de xx,xxm ate o vertice V2..."
 */
function gerarMemorialNTGIR(pontos: PontoLaudo[], lados: LadoLaudo[]): string {
  if (pontos.length < 3 || lados.length === 0) {
    return 'Memorial descritivo nao disponivel — adicione pelo menos 3 vertices ao laudo.';
  }
  const pontosOrdenados = [...pontos].sort((a, b) => a.ordem - b.ordem);
  const ladosOrdenados = [...lados].sort((a, b) => a.ordem - b.ordem);
  const v0 = pontosOrdenados[0];

  let texto = `Inicia-se a descrição deste perímetro no vértice ${v0.rotulo} de coordenadas `;
  if (v0.utm_e != null && v0.utm_n != null) {
    texto += `UTM E=${fmtNum(v0.utm_e)} m e N=${fmtNum(v0.utm_n)} m`;
    if (v0.utm_zona && v0.utm_hemisferio) {
      texto += ` (zona ${v0.utm_zona}${v0.utm_hemisferio})`;
    }
  }
  if (v0.lat_gms && v0.long_gms) {
    texto += `, lat ${v0.lat_gms} long ${v0.long_gms}`;
  }
  texto += '; ';

  // Pra cada lado: "daí segue com azimute de XX°XX'XX" e distância de XX,XXm até o vértice VN"
  for (let i = 0; i < ladosOrdenados.length; i++) {
    const l = ladosOrdenados[i];
    const verticeFim = pontosOrdenados.find(p => p.id === l.ponto_fim_id);
    if (!verticeFim) continue;
    const az = l.azimute != null ? azimuteParaDMS(l.azimute) : '—';
    const dist = l.distancia_m != null ? `${l.distancia_m.toFixed(2).replace('.', ',')} m` : '— m';

    if (i === 0) texto += `daí segue com azimute de ${az} e distância de ${dist} até o vértice ${verticeFim.rotulo}; `;
    else if (i === ladosOrdenados.length - 1) texto += `e finalmente segue com azimute de ${az} e distância de ${dist} até o vértice ${verticeFim.rotulo}, ponto inicial desta descrição, fechando assim o perímetro. `;
    else texto += `daí segue com azimute de ${az} e distância de ${dist} até o vértice ${verticeFim.rotulo}; `;
  }

  return texto;
}

export interface LaudoPdfInput {
  laudo: Laudo;
  contratante: Contratante;
  executante: Executante;
  pontos: PontoLaudo[];
  lados: LadoLaudo[];
  fotos: Array<{ id: number; mime: string; legenda: string | null }>;
  fotoBase64Loader?: (fotoId: number) => Promise<{ base64: string; mime: string } | null>;
  croquiUpload?: { mime: string; base64: string } | null;
  croquiSvg?: string | null;
}

export async function gerarPdfLaudo(input: LaudoPdfInput): Promise<Buffer> {
  const { laudo, contratante, executante, pontos, lados } = input;
  const t = await getTenantSettings(1).catch(() => null);
  const brand = t?.brand_name || 'Romatec Consultoria Imobiliária';
  const corHex = t?.primary_color || '#10b981';
  const corGold = '#B8893A';

  const dataEmissao = new Date();

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `Laudo Tecnico de Demarcacao ${laudo.numero_laudo}`,
      Author: brand,
      Subject: `Laudo de demarcacao para ${contratante.nome}`,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', c => chunks.push(c as Buffer));

  // ── 1. Cabecalho ───────────────────────────────────────────────────
  try {
    const logoPath = path.join(__dirname, '..', 'public', 'logo_R-removebg-preview.png');
    if (fs.existsSync(logoPath)) doc.image(logoPath, 40, 30, { width: 50 });
  } catch { /* ignora */ }
  doc.fontSize(11).fillColor(corHex).font('Helvetica-Bold')
     .text(brand, 100, 36, { width: 455 });
  doc.fontSize(8).fillColor('#666').font('Helvetica')
     .text('Laudo Técnico de Demarcação de Imóvel', 100, 52);
  doc.fontSize(9).fillColor(corGold).font('Helvetica-Bold')
     .text(`Nº ${laudo.numero_laudo}`, 40, 90, { width: 515, align: 'right' });
  doc.moveTo(40, 105).lineTo(555, 105).strokeColor(corGold).lineWidth(2).stroke();

  // ── 2. Titulo ──────────────────────────────────────────────────────
  doc.fontSize(18).fillColor(corHex).font('Helvetica-Bold')
     .text('LAUDO TÉCNICO DE DEMARCAÇÃO', 40, 120, { width: 515, align: 'center' });
  doc.fontSize(10).fillColor('#666').font('Helvetica-Oblique')
     .text(`Imóvel ${laudo.tipo_imovel.toLowerCase()} · emitido em ${fmtData(dataEmissao)}`, 40, 145, { width: 515, align: 'center' });

  let cy = 175;

  // ── 3. Contratante ─────────────────────────────────────────────────
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('1. CONTRATANTE', 40, cy);
  cy += 14;
  doc.fontSize(11).fillColor('#111').font('Helvetica-Bold').text(contratante.nome, 40, cy);
  cy += 14;
  doc.fontSize(9).fillColor('#444').font('Helvetica');
  const partesC: string[] = [];
  partesC.push(`${contratante.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ'}: ${formatarCpfCnpj(contratante.cpf_cnpj, contratante.tipo_pessoa)}`);
  if (contratante.rg_ie) partesC.push(`${contratante.tipo_pessoa === 'PF' ? 'RG' : 'IE'}: ${contratante.rg_ie}`);
  if (contratante.nacionalidade) partesC.push(contratante.nacionalidade);
  if (contratante.estado_civil) partesC.push(contratante.estado_civil);
  if (contratante.profissao) partesC.push(contratante.profissao);
  doc.text(partesC.join(' · '), 40, cy, { width: 515 });
  cy += 12;
  if (contratante.logradouro || contratante.cidade) {
    const end = [
      contratante.logradouro, contratante.numero, contratante.complemento,
      contratante.bairro, contratante.cidade, contratante.uf, contratante.cep,
    ].filter(Boolean).join(', ');
    doc.text(end, 40, cy, { width: 515 });
    cy += 12;
  }
  // v2.0.1: Representante legal quando PJ
  if (contratante.tipo_pessoa === 'PJ' && contratante.representante_nome) {
    doc.fontSize(9).fillColor('#666').font('Helvetica-Oblique')
      .text(`Representante legal: ${contratante.representante_nome}` +
        (contratante.representante_cargo ? ` (${contratante.representante_cargo})` : '') +
        (contratante.representante_cpf ? ` — CPF: ${formatarCpfCnpj(contratante.representante_cpf, 'PF')}` : ''),
        40, cy, { width: 515 });
    cy += 12;
  }
  cy += 8;

  // ── 4. Executante ──────────────────────────────────────────────────
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('2. EXECUTANTE / RESPONSÁVEL TÉCNICO', 40, cy);
  cy += 14;
  doc.fontSize(11).fillColor('#111').font('Helvetica-Bold').text(executante.nome, 40, cy);
  cy += 14;
  const partesE: string[] = [];
  if (executante.qualificacao) partesE.push(executante.qualificacao);
  if (executante.registro_cft) partesE.push(`CFT: ${executante.registro_cft}`);
  if (executante.registro_crea) partesE.push(`CREA: ${executante.registro_crea}`);
  if (executante.cadastro_incra) partesE.push(`INCRA: ${executante.cadastro_incra}`);
  doc.fontSize(9).fillColor('#444').font('Helvetica').text(partesE.join(' · '), 40, cy, { width: 515 });
  cy += 16;

  // ── 5. Objeto + confrontantes ──────────────────────────────────────
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('3. OBJETO DA DEMARCAÇÃO', 40, cy);
  cy += 14;
  doc.fontSize(9).fillColor('#444').font('Helvetica');
  if (laudo.tipo_imovel === 'URBANO') {
    const partesO: string[] = [];
    if (laudo.tipo_lote_urbano) partesO.push(`Tipo: ${laudo.tipo_lote_urbano === 'MEIO_QUADRA' ? 'Meio de quadra (4 vértices)' : 'Esquina (5 vértices)'}`);
    if (laudo.quadra) partesO.push(`Quadra ${laudo.quadra}`);
    if (laudo.numero_lote) partesO.push(`Lote ${laudo.numero_lote}`);
    if (laudo.loteamento) partesO.push(laudo.loteamento);
    doc.text(partesO.join(' · '), 40, cy, { width: 515 });
    cy += 12;
  } else {
    if (laudo.denominacao_imovel) {
      doc.text(`Denominação: ${laudo.denominacao_imovel}`, 40, cy, { width: 515 });
      cy += 12;
    }
    const partesR: string[] = [];
    if (laudo.nirf) partesR.push(`NIRF: ${laudo.nirf}`);
    if (laudo.ccir) partesR.push(`CCIR: ${laudo.ccir}`);
    if (partesR.length) {
      doc.text(partesR.join(' · '), 40, cy, { width: 515 });
      cy += 12;
    }
  }
  if (laudo.endereco_imovel) {
    doc.text(laudo.endereco_imovel, 40, cy, { width: 515 });
    cy += 12;
  }
  if (laudo.municipio || laudo.uf_imovel) {
    doc.text(`Município/UF: ${laudo.municipio || '—'}/${laudo.uf_imovel || '—'}${laudo.comarca ? ` · Comarca: ${laudo.comarca}` : ''}`, 40, cy, { width: 515 });
    cy += 12;
  }
  cy += 4;

  // Confrontantes
  const confs: string[] = [];
  if (laudo.confrontante_frente) confs.push(`Frente: ${laudo.confrontante_frente}`);
  if (laudo.confrontante_lat_dir) confs.push(`Lateral direita: ${laudo.confrontante_lat_dir}`);
  if (laudo.confrontante_lat_esq) confs.push(`Lateral esquerda: ${laudo.confrontante_lat_esq}`);
  if (laudo.confrontante_fundo) confs.push(`Fundo: ${laudo.confrontante_fundo}`);
  if (laudo.confrontante_extra) confs.push(`Lateral extra: ${laudo.confrontante_extra}`);
  if (confs.length) {
    doc.fontSize(9).fillColor('#888').font('Helvetica-Bold').text('Confrontantes:', 40, cy);
    cy += 12;
    doc.fontSize(9).fillColor('#444').font('Helvetica').text(confs.join('; '), 40, cy, { width: 515 });
    cy = doc.y + 6;
  }

  // ── 6. Tabela de coordenadas ───────────────────────────────────────
  if (cy > 700) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('4. COORDENADAS DOS VÉRTICES', 40, cy);
  cy += 16;
  // Header da tabela
  doc.fontSize(8).fillColor('#666').font('Helvetica-Bold');
  doc.text('Vért.', 40, cy, { width: 35 });
  doc.text('UTM-E (m)', 80, cy, { width: 95 });
  doc.text('UTM-N (m)', 180, cy, { width: 95 });
  doc.text('Latitude', 280, cy, { width: 100 });
  doc.text('Longitude', 385, cy, { width: 105 });
  doc.text('Alt.', 495, cy, { width: 60 });
  cy += 10;
  doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
  cy += 4;
  doc.font('Helvetica').fillColor('#222');
  for (const p of [...pontos].sort((a, b) => a.ordem - b.ordem)) {
    if (cy > 770) { doc.addPage(); cy = 60; }
    doc.text(p.rotulo, 40, cy, { width: 35 });
    doc.text(p.utm_e != null ? fmtNum(p.utm_e, 3) : '—', 80, cy, { width: 95 });
    doc.text(p.utm_n != null ? fmtNum(p.utm_n, 3) : '—', 180, cy, { width: 95 });
    doc.text(p.lat_gms || (p.lat_decimal != null ? p.lat_decimal.toFixed(6) : '—'), 280, cy, { width: 100 });
    doc.text(p.long_gms || (p.long_decimal != null ? p.long_decimal.toFixed(6) : '—'), 385, cy, { width: 105 });
    doc.text(p.altitude != null ? `${p.altitude.toFixed(1)}m` : '—', 495, cy, { width: 60 });
    cy += 11;
  }
  cy += 10;

  // ── 7. Memorial NTGIR ──────────────────────────────────────────────
  if (cy > 660) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('5. MEMORIAL DESCRITIVO', 40, cy);
  cy += 14;
  const memorial = gerarMemorialNTGIR(pontos, lados);
  doc.fontSize(9).fillColor('#222').font('Helvetica')
     .text(memorial, 40, cy, { width: 515, align: 'justify' });
  cy = doc.y + 12;

  // ── 8. Tabela de lados ─────────────────────────────────────────────
  if (lados.length > 0) {
    if (cy > 720) { doc.addPage(); cy = 60; }
    doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('6. LADOS DA POLIGONAL', 40, cy);
    cy += 14;
    doc.fontSize(8).fillColor('#666').font('Helvetica-Bold');
    doc.text('Lado', 40, cy, { width: 100 });
    doc.text('Distância', 145, cy, { width: 80 });
    doc.text('Azimute', 230, cy, { width: 100 });
    cy += 10;
    doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
    cy += 4;
    doc.font('Helvetica').fillColor('#222');
    for (const l of [...lados].sort((a, b) => a.ordem - b.ordem)) {
      if (cy > 770) { doc.addPage(); cy = 60; }
      doc.text(l.rotulo || `${l.ordem}`, 40, cy, { width: 100 });
      doc.text(l.distancia_m != null ? `${l.distancia_m.toFixed(2)} m` : '—', 145, cy, { width: 80 });
      doc.text(l.azimute != null ? azimuteParaDMS(l.azimute) : '—', 230, cy, { width: 100 });
      cy += 11;
    }
    cy += 8;
  }

  // ── 9. Area + perimetro ────────────────────────────────────────────
  if (cy > 720) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('7. ÁREA E PERÍMETRO', 40, cy);
  cy += 14;
  doc.fontSize(11).fillColor(corGold).font('Helvetica-Bold');
  if (laudo.area_total_m2 != null) doc.text(`Área total: ${fmtArea(laudo.area_total_m2)}`, 40, cy);
  cy += 14;
  if (laudo.perimetro_m != null) doc.text(`Perímetro: ${laudo.perimetro_m.toFixed(2).replace('.', ',')} m`, 40, cy);
  cy += 16;

  // ── 10. Croqui ─────────────────────────────────────────────────────
  if (cy > 600) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('8. CROQUI DO LEVANTAMENTO', 40, cy);
  cy += 14;
  if (input.croquiUpload && input.croquiUpload.mime.startsWith('image/')) {
    try {
      const buf = Buffer.from(input.croquiUpload.base64, 'base64');
      const maxH = 250;
      doc.image(buf, 40, cy, { width: 515, fit: [515, maxH], align: 'center' });
      cy += maxH + 10;
    } catch { /* ignora se imagem ruim */ }
  } else {
    doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
       .text('(Croqui auto-gerado disponivel em /api/laudos-demarcacao/' + laudo.id + '/croqui)', 40, cy, { width: 515, align: 'center' });
    cy += 12;
  }

  // ── 11. Fotos ──────────────────────────────────────────────────────
  if (input.fotos.length > 0 && input.fotoBase64Loader) {
    if (cy > 600) { doc.addPage(); cy = 60; }
    doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('9. RELATÓRIO FOTOGRÁFICO', 40, cy);
    cy += 14;
    const fotoW = 250;
    const fotoH = 180;
    let col = 0;
    for (const f of input.fotos) {
      if (cy + fotoH + 20 > 800) { doc.addPage(); cy = 60; col = 0; }
      const conteudo = await input.fotoBase64Loader(f.id);
      if (conteudo && conteudo.mime.startsWith('image/')) {
        try {
          const buf = Buffer.from(conteudo.base64, 'base64');
          const x = col === 0 ? 40 : 305;
          doc.image(buf, x, cy, { width: fotoW, height: fotoH, fit: [fotoW, fotoH] });
          doc.fontSize(8).fillColor('#444').font('Helvetica')
             .text(f.legenda || `Foto ${f.id}`, x, cy + fotoH + 2, { width: fotoW, align: 'center' });
        } catch { /* ignora foto ruim */ }
      }
      if (col === 1) {
        cy += fotoH + 18;
        col = 0;
      } else {
        col = 1;
      }
    }
    if (col === 1) cy += fotoH + 18; // fecha linha incompleta
    cy += 10;
  }

  // ── 12. ART/TRT ────────────────────────────────────────────────────
  if (cy > 720) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('10. RESPONSABILIDADE TÉCNICA', 40, cy);
  cy += 14;
  doc.fontSize(9).fillColor('#444').font('Helvetica');
  if (laudo.usa_art) doc.text(`☑ ART (CREA): ${laudo.numero_art || '—'}`, 40, cy, { width: 515 });
  else doc.text('☐ ART (CREA): não aplicável', 40, cy);
  cy += 12;
  if (laudo.usa_trt) doc.text(`☑ TRT (CFT): ${laudo.numero_trt || '—'}`, 40, cy, { width: 515 });
  else doc.text('☐ TRT (CFT): não aplicável', 40, cy);
  cy += 16;

  // ── 13. Local + data + assinatura ──────────────────────────────────
  if (cy > 720) { doc.addPage(); cy = 60; }
  const cidade = laudo.municipio || 'Açailândia';
  const uf = laudo.uf_imovel || 'MA';
  doc.fontSize(10).fillColor('#111').font('Helvetica')
     .text(`${cidade}/${uf}, ${fmtDataExtenso(dataEmissao)}.`, 40, cy, { width: 515, align: 'center' });
  cy += 50;
  doc.moveTo(180, cy).lineTo(415, cy).strokeColor('#444').lineWidth(0.5).stroke();
  cy += 6;
  doc.fontSize(9).fillColor('#222').font('Helvetica-Bold')
     .text(executante.nome, 40, cy, { width: 515, align: 'center' });
  cy += 11;
  doc.fontSize(8).fillColor('#666').font('Helvetica');
  const partesAssina: string[] = [];
  if (executante.qualificacao) partesAssina.push(executante.qualificacao);
  if (executante.registro_cft) partesAssina.push(`CFT ${executante.registro_cft}`);
  doc.text(partesAssina.join(' · '), 40, cy, { width: 515, align: 'center' });

  // ── 14. QR + hash + selo ───────────────────────────────────────────
  if (laudo.hash_validacao) {
    const baseUrl = getBaseUrl();
    const qrUrl = await renderQRValidacao(
      doc, laudo.hash_validacao, `${baseUrl}/v/laudo`,
      460, 720,
      { size: 75, corHex, comLabel: true }
    );
    renderHashFooter(doc, laudo.hash_validacao, qrUrl, 40, 720, 410);
    if (laudo.status === 'CONFIRMADO') {
      renderSeloConfirmado(doc, 310, 460);
    }
  }
  // Footer fixo
  doc.fontSize(7).fillColor('#999').font('Helvetica-Oblique')
     .text(`${brand} · Laudo ${laudo.numero_laudo} · ${fmtData(dataEmissao)}`,
           40, 800, { width: 515, align: 'center' });

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

