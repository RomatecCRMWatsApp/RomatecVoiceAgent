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
import type { SignatureVisualMeta } from './reciboPdf';
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

// v2.1.2 — Textos padrao de metodologia e equipamentos (Romatec / SinoGNSS RTK)
const METODOLOGIA_PADRAO = `O presente levantamento topográfico foi executado mediante o seguinte procedimento técnico:

1. PLANEJAMENTO E RECONHECIMENTO DE CAMPO — vistoria preliminar do imóvel para identificação dos limites, confrontantes e melhor estratégia de implantação dos marcos.

2. MATERIALIZAÇÃO DOS VÉRTICES — implantação física dos marcos (piquetes) em todos os vértices da poligonal, com identificação sequencial (P1, P2, …) e registro fotográfico individual de cada vértice no local.

3. RASTREAMENTO GNSS EM MODO RTK — coleta das coordenadas geodésicas de cada vértice por meio de receptor GNSS de dupla frequência operando em modo Real-Time Kinematic (RTK), com tempo mínimo de fixação até obtenção de solução fixa centimétrica. Sistema geodésico de referência: SIRGAS 2000 (oficial Brasil — IBGE/INCRA), projeção UTM, zona 23 Sul, meridiano central -45°.

4. CAMINHAMENTO DA POLIGONAL — coleta sequencial dos vértices percorrendo o perímetro do imóvel no sentido horário, com fechamento angular e linear sobre o vértice inicial (P1) para verificação de consistência.

5. PROCESSAMENTO E DESENHO TÉCNICO — pós-processamento dos dados brutos em escritório utilizando os softwares Topcon Tools e MetricaTOPO, geração da poligonal final, cálculo de área pelo método de Gauss (Shoelace), perímetro pelo somatório das distâncias planas e azimutes calculados segmento a segmento em DMS (graus, minutos e segundos).

6. EMISSÃO DAS PEÇAS TÉCNICAS — produção do memorial descritivo conforme Norma Técnica de Georreferenciamento (NTGIR/INCRA), planilha de coordenadas, croqui georreferenciado e o presente laudo técnico.`;

const EQUIPAMENTOS_PADRAO = `Equipamentos topográficos e instrumentação utilizados:

• RECEPTOR BASE GNSS RTK — ComNav Technology, configurado como estação de referência fixa, montado sobre tripé com base niveladora ótica e antena de comunicação rádio.

• RECEPTOR ROVER GNSS T30 LASER PLUS (SinoGNSS) — receptor móvel multibanda com 1.668 canais, rastreio simultâneo de todas as constelações ativas (GPS, BeiDou, GLONASS e Galileo), Auto-IMU 120° (compensação de inclinação), tecnologia de bloqueio de sinais multicaminhados e bloqueio de interferência eletromagnética, laser integrado com alcance de 50 m, duas câmeras integradas, certificação IP68 (proteção total contra água e poeira). Precisão estática: 2,5 mm + 0,5 ppm (horizontal) e 5 mm + 0,5 ppm (vertical). Precisão RTK: 8 mm + 1 ppm (horizontal) e 15 mm + 1 ppm (vertical).

• COLETOR DE DADOS R80 (SinoGNSS) — controlador GNSS de alto desempenho com sistema operacional Android 12.0, processador octa-core MediaTek, executando software de coleta topográfica integrada ao receptor rover via Bluetooth.

• ACESSÓRIOS DE CAMPO — tripé robusto para a base, bastão telescópico de 2 m para o rover, bipé estabilizador, base niveladora ótica, trena de aferição.

Software de pós-processamento: Topcon Tools (suíte oficial Topcon para processamento GNSS) e MetricaTOPO (geração de peças técnicas e desenho da poligonal).`;

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
  // v2.11.0: bloco visual ICP-Brasil renderizado quando o laudo e assinado
  // digitalmente. Mesmo padrao do reciboPdf.ts (caixa verde com signatario,
  // CN, doc, data e validade). Quando undefined, NAO renderiza o bloco —
  // util pro endpoint GET /pdf (preview sem assinatura).
  signatureMeta?: SignatureVisualMeta;
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
    if (laudo.loteamento) partesO.push(`Loteamento: ${laudo.loteamento}`);
    if (laudo.numero_contrato) partesO.push(`Contrato: ${laudo.numero_contrato}`);
    if (laudo.quadra) partesO.push(`Quadra ${laudo.quadra}`);
    if (laudo.numero_lote) partesO.push(`Lote ${laudo.numero_lote}`);
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
    // v2.1.8: comarca usa fallback do municipio quando vazia
    doc.text(`Município/UF: ${laudo.municipio || '—'}/${laudo.uf_imovel || '—'} · Comarca: ${laudo.comarca || laudo.municipio || '—'}`, 40, cy, { width: 515 });
    cy += 12;
  }
  // v2.6.0 — Dados Registrais (Cartorio): so renderiza se tiver pelo menos um campo
  const temRegistrais = laudo.matricula || laudo.livro || laudo.folhas || laudo.cartorio_nome || laudo.cartorio_cns;
  if (temRegistrais) {
    cy += 2;
    doc.fontSize(9).fillColor('#888').font('Helvetica-Bold').text('Registro:', 40, cy);
    cy += 12;
    doc.fontSize(9).fillColor('#444').font('Helvetica');
    const partesReg: string[] = [];
    if (laudo.matricula) partesReg.push(`Matrícula: ${laudo.matricula}`);
    if (laudo.livro) partesReg.push(`Livro: ${laudo.livro}`);
    if (laudo.folhas) partesReg.push(`Fls.: ${laudo.folhas}`);
    if (partesReg.length) {
      doc.text(partesReg.join(' · '), 40, cy, { width: 515 });
      cy += 12;
    }
    if (laudo.cartorio_nome) {
      const cartLinha = laudo.cartorio_cns
        ? `${laudo.cartorio_nome} · CNS ${laudo.cartorio_cns}`
        : laudo.cartorio_nome;
      doc.text(cartLinha, 40, cy, { width: 515 });
      cy += 12;
    }
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

  // ── v2.1.2 — Metodologia tecnica + equipamentos ────────────────────
  if (cy > 600) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold')
     .text('4. METODOLOGIA TÉCNICA APLICADA', 40, cy);
  cy += 14;
  doc.fontSize(9).fillColor('#222').font('Helvetica')
     .text(METODOLOGIA_PADRAO, 40, cy, { width: 515, align: 'justify' });
  cy = doc.y + 12;

  if (cy > 600) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold')
     .text('5. EQUIPAMENTOS UTILIZADOS', 40, cy);
  cy += 14;
  // v2.2.3: equipamentos dinamicos (base/rover/coletor por laudo) com fallback
  const baseTxt = laudo.base_nome || 'Receptor GNSS RTK S6 ComNAV';
  const roverTxt = laudo.rover_nome || 'Receptor GNSS RTK T30 Laser Plus (SinoGNSS)';
  const coletorTxt = laudo.coletor_nome || 'Coletor de dados R60 (SinoGNSS)';
  let eqTxt = `Equipamentos topográficos e instrumentação utilizados:\n\n` +
    `• RECEPTOR BASE GNSS: ${baseTxt} — estação de referência fixa montada sobre tripé com base niveladora.\n\n` +
    `• RECEPTOR ROVER GNSS: ${roverTxt} — receptor móvel multibanda com rastreio simultâneo das constelações ativas (GPS, BeiDou, GLONASS, Galileo).\n\n` +
    `• COLETOR DE DADOS: ${coletorTxt} — controlador robusto e ergonômico que proporciona profissionalismo e flexibilidade no levantamento topográfico em campo.\n\n` +
    `• ACESSÓRIOS DE CAMPO: tripé robusto para a base, bastão telescópico de 2m para o rover, bipé estabilizador, base niveladora ótica, trena de aferição.\n\n` +
    `Software de pós-processamento: Topcon Tools + MetricaTOPO.`;
  if (laudo.base_inicio_rastreio && laudo.base_fim_rastreio) {
    const ini = new Date(laudo.base_inicio_rastreio);
    const fim = new Date(laudo.base_fim_rastreio);
    const dur = (fim.getTime() - ini.getTime()) / 1000;
    if (dur > 0) {
      const h = Math.floor(dur / 3600);
      const m = Math.floor((dur % 3600) / 60);
      eqTxt += `\n\n📡 RASTREIO DA BASE: início ${fmtData(ini)} ${ini.toLocaleTimeString('pt-BR').slice(0,5)} → fim ${fmtData(fim)} ${fim.toLocaleTimeString('pt-BR').slice(0,5)} · Duração total: ${h}h ${m}min (${(dur/3600).toFixed(2)} horas).`;
    }
  }
  if (laudo.base_observacoes) {
    eqTxt += `\n\nObservações da base: ${laudo.base_observacoes}`;
  }
  doc.fontSize(9).fillColor('#222').font('Helvetica')
     .text(eqTxt, 40, cy, { width: 515, align: 'justify' });
  cy = doc.y + 14;

  // ── 6. Tabela de coordenadas ───────────────────────────────────────
  // v2.11.0: largura da coluna "Vert." aumentada de 35→80pt pra caber rotulos
  // longos como "AVEX-M-0123" sem quebrar. lineBreak:false em todas as celulas
  // garante uma linha por vertice (sem sobreposicao com a linha seguinte).
  if (cy > 700) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('6. COORDENADAS DOS VÉRTICES', 40, cy);
  cy += 16;
  // Header da tabela
  doc.fontSize(8).fillColor('#666').font('Helvetica-Bold');
  doc.text('Vért.', 40, cy, { width: 80, lineBreak: false });
  doc.text('UTM-E (m)', 125, cy, { width: 85, lineBreak: false });
  doc.text('UTM-N (m)', 215, cy, { width: 85, lineBreak: false });
  doc.text('Latitude', 305, cy, { width: 85, lineBreak: false });
  doc.text('Longitude', 395, cy, { width: 95, lineBreak: false });
  doc.text('Alt.', 495, cy, { width: 60, lineBreak: false });
  cy += 10;
  doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
  cy += 4;
  doc.font('Helvetica').fillColor('#222');
  for (const p of [...pontos].sort((a, b) => a.ordem - b.ordem)) {
    if (cy > 770) { doc.addPage(); cy = 60; }
    doc.text(p.rotulo, 40, cy, { width: 80, ellipsis: true, lineBreak: false });
    doc.text(p.utm_e != null ? fmtNum(p.utm_e, 3) : '—', 125, cy, { width: 85, lineBreak: false });
    doc.text(p.utm_n != null ? fmtNum(p.utm_n, 3) : '—', 215, cy, { width: 85, lineBreak: false });
    doc.text(p.lat_gms || (p.lat_decimal != null ? p.lat_decimal.toFixed(6) : '—'), 305, cy, { width: 85, lineBreak: false });
    doc.text(p.long_gms || (p.long_decimal != null ? p.long_decimal.toFixed(6) : '—'), 395, cy, { width: 95, lineBreak: false });
    doc.text(p.altitude != null ? `${p.altitude.toFixed(1)}m` : '—', 495, cy, { width: 60, lineBreak: false });
    cy += 13; // v2.11.0: era 11pt → 13pt pra dar respiro entre linhas
  }
  cy += 10;

  // ── 7. Memorial Descritivo (v2.10.0: gerador unificado com confrontantes) ──
  if (cy > 660) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('7. MEMORIAL DESCRITIVO', 40, cy);
  cy += 14;
  const { gerarMemorialDescritivo } = await import('./memorialDescritivo');
  const mem = gerarMemorialDescritivo({ laudo, pontos, lados, contratante: input.contratante });
  // No PDF, omitimos o cabecalho do memorial (info ja apresentada nas secoes 3-5).
  // Renderizamos apenas a descricao narrativa (parte mais importante).
  doc.fontSize(9).fillColor('#222').font('Helvetica')
     .text(mem.descricao, 40, cy, { width: 515, align: 'justify' });
  cy = doc.y + 12;

  // ── 8. Tabela de lados (v2.10.2: linhas com 13pt, fontSize controlado linha-a-linha) ──
  if (lados.length > 0) {
    if (cy > 700) { doc.addPage(); cy = 60; }
    doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('8. LADOS DA POLIGONAL', 40, cy);
    cy += 16;
    doc.fontSize(8).fillColor('#666').font('Helvetica-Bold');
    // Layout: Lado (300pt — caber "AVEX-M-0123-APG-M-30105") + Dist (90) + Azimute (110)
    doc.text('Lado', 40, cy, { width: 300, lineBreak: false });
    doc.text('Distância', 345, cy, { width: 90, lineBreak: false });
    doc.text('Azimute', 440, cy, { width: 110, lineBreak: false });
    cy += 12;
    doc.moveTo(40, cy).lineTo(555, cy).strokeColor('#ddd').lineWidth(0.5).stroke();
    cy += 5;
    doc.font('Helvetica').fillColor('#222');
    for (const l of [...lados].sort((a, b) => a.ordem - b.ordem)) {
      if (cy > 770) { doc.addPage(); cy = 60; }
      // v2.10.2: lineBreak:false garante que ficam em UMA linha (sem quebrar pra
      // varias por causa de wrap automatico) — evita sobreposicao com proxima linha
      doc.text(l.rotulo || `${l.ordem}`, 40, cy, { width: 300, ellipsis: true, lineBreak: false });
      doc.text(l.distancia_m != null ? `${l.distancia_m.toFixed(2).replace('.', ',')} m` : '—', 345, cy, { width: 90, lineBreak: false });
      doc.text(l.azimute != null ? azimuteParaDMS(l.azimute) : '—', 440, cy, { width: 110, lineBreak: false });
      cy += 13; // v2.10.2: era 11pt, aumentado pra 13pt (font 8 + leading 5)
    }
    cy += 12;
  }

  // ── 9. Area + perimetro (v2.10.2: tipo-aware com cy correto pra rural) ──
  // Rural ocupa 3 linhas (ha + alq/linha + perimetro). Garante quebra antes se
  // restar < 80pt na pagina.
  const espacoNecessario = laudo.tipo_imovel === 'RURAL' ? 80 : 60;
  if (cy > (792 - espacoNecessario)) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('9. ÁREA E PERÍMETRO', 40, cy);
  cy += 16;
  if (laudo.area_total_m2 != null) {
    if (laudo.tipo_imovel === 'RURAL') {
      const ha = laudo.area_total_m2 / 10000;
      const alq = laudo.area_total_m2 / 48400;       // 1 alqueire = 4,84 ha (MA)
      const linhas = laudo.area_total_m2 / 3025;     // 1 linha = 3.025 m² (1/16 alq)
      doc.fontSize(11).fillColor(corGold).font('Helvetica-Bold');
      doc.text(`Área total: ${ha.toFixed(4).replace('.', ',')} ha`, 40, cy, { lineBreak: false });
      cy += 16;
      doc.fontSize(9).fillColor('#444').font('Helvetica');
      doc.text(`(≈ ${alq.toFixed(4).replace('.', ',')} alqueires · ≈ ${linhas.toFixed(2).replace('.', ',')} linhas de terra)`, 40, cy, { lineBreak: false, width: 515 });
      cy += 14;
    } else {
      doc.fontSize(11).fillColor(corGold).font('Helvetica-Bold');
      doc.text(`Área total: ${fmtArea(laudo.area_total_m2)}`, 40, cy, { lineBreak: false, width: 515 });
      cy += 16;
    }
  }
  if (laudo.perimetro_m != null) {
    doc.fontSize(11).fillColor(corGold).font('Helvetica-Bold');
    doc.text(`Perímetro: ${laudo.perimetro_m.toFixed(2).replace('.', ',')} m`, 40, cy, { lineBreak: false });
    cy += 18;
  }
  cy += 8;

  // ── 10. Croqui ─────────────────────────────────────────────────────
  // v2.10.1: quando nao ha upload de imagem, desenhamos o poligono INLINE
  // direto no PDFKit (PDFKit nao tem SVG nativo, mas paths simples bastam).
  if (cy > 540) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('10. CROQUI DO LEVANTAMENTO', 40, cy);
  cy += 14;
  if (input.croquiUpload && input.croquiUpload.mime.startsWith('image/')) {
    try {
      const buf = Buffer.from(input.croquiUpload.base64, 'base64');
      const maxH = 250;
      doc.image(buf, 40, cy, { width: 515, fit: [515, maxH], align: 'center' });
      cy += maxH + 10;
    } catch { /* ignora se imagem ruim */ }
  } else if (pontos.length >= 3) {
    // v2.10.1: desenha o poligono inline com vertices + medidas dos lados
    const ptsOrd = [...pontos].sort((a, b) => a.ordem - b.ordem)
      .filter(p => p.utm_e != null && p.utm_n != null);
    if (ptsOrd.length >= 3) {
      const xs = ptsOrd.map(p => Number(p.utm_e));
      const ys = ptsOrd.map(p => Number(p.utm_n));
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const rangeX = Math.max(maxX - minX, 0.001);
      const rangeY = Math.max(maxY - minY, 0.001);
      const padding = 60;
      const boxX = 40, boxY = cy;
      const boxW = 515, boxH = 320;
      // Box de fundo
      doc.rect(boxX, boxY, boxW, boxH).strokeColor('#ddd').lineWidth(0.5).stroke();
      // Escala mantendo aspect ratio
      const scale = Math.min(
        (boxW - 2 * padding) / rangeX,
        (boxH - 2 * padding) / rangeY
      );
      const drawW = rangeX * scale;
      const drawH = rangeY * scale;
      const offX = boxX + (boxW - drawW) / 2;
      const offY = boxY + (boxH - drawH) / 2;
      // PDFKit Y eh top-down; UTM N eh bottom-up → inverter Y
      const toX = (utmE: number) => offX + (utmE - minX) * scale;
      const toY = (utmN: number) => offY + drawH - (utmN - minY) * scale;
      // Polygon fill (verde claro 10% opacity) + outline dourado
      doc.fillColor('#10b981').fillOpacity(0.12);
      ptsOrd.forEach((p, i) => {
        const x = toX(Number(p.utm_e));
        const y = toY(Number(p.utm_n));
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.closePath().fill();
      doc.fillOpacity(1);
      doc.strokeColor(corGold).lineWidth(1.2);
      ptsOrd.forEach((p, i) => {
        const x = toX(Number(p.utm_e));
        const y = toY(Number(p.utm_n));
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.closePath().stroke();
      // Vertices + labels
      doc.fontSize(7).fillColor('#222').font('Helvetica-Bold');
      ptsOrd.forEach((p) => {
        const x = toX(Number(p.utm_e));
        const y = toY(Number(p.utm_n));
        doc.circle(x, y, 2).fillColor(corGold).fill();
        doc.fillColor('#222').text(p.rotulo || `P${p.ordem}`, x + 4, y - 4);
      });
      // Medidas dos lados (no meio de cada segmento)
      doc.fontSize(6).fillColor('#444').font('Helvetica');
      ptsOrd.forEach((p, i) => {
        const next = ptsOrd[(i + 1) % ptsOrd.length];
        const lado = lados.find(l => l.ordem === p.ordem);
        const dist = lado?.medida_manual_m ?? lado?.distancia_m;
        if (dist == null) return;
        const x1 = toX(Number(p.utm_e)), y1 = toY(Number(p.utm_n));
        const x2 = toX(Number(next.utm_e)), y2 = toY(Number(next.utm_n));
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        doc.text(`${dist.toFixed(2).replace('.', ',')} m`, mx - 18, my - 3, { width: 36, align: 'center' });
      });
      // Norte (seta no canto superior direito)
      doc.fontSize(8).fillColor('#222').font('Helvetica-Bold').text('N', boxX + boxW - 20, boxY + 8);
      doc.moveTo(boxX + boxW - 16, boxY + 30).lineTo(boxX + boxW - 16, boxY + 18).strokeColor('#222').lineWidth(1).stroke();
      doc.moveTo(boxX + boxW - 19, boxY + 22).lineTo(boxX + boxW - 16, boxY + 18).lineTo(boxX + boxW - 13, boxY + 22).stroke();
      cy = boxY + boxH + 8;
      // Legenda inferior
      doc.fontSize(7).fillColor('#666').font('Helvetica-Oblique')
         .text(`${ptsOrd.length} vértices · Sistema: UTM Zona ${ptsOrd[0].utm_zona || 23}${ptsOrd[0].utm_hemisferio || 'S'} · SIRGAS 2000`, 40, cy, { width: 515, align: 'center' });
      cy += 14;
    } else {
      doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
         .text('(Pontos sem coordenadas UTM — croqui nao gerado)', 40, cy, { width: 515, align: 'center' });
      cy += 12;
    }
  } else {
    doc.fontSize(8).fillColor('#666').font('Helvetica-Oblique')
       .text('(Croqui nao disponivel — adicione 3 ou mais vertices)', 40, cy, { width: 515, align: 'center' });
    cy += 12;
  }

  // ── 11. Fotos ──────────────────────────────────────────────────────
  // v2.4.5: foto da Base ganha subseção dedicada (11.1, foto grande centralizada).
  // Demais fotos (piquetes + gerais) na 11.2 com grid 2 colunas como antes.
  if (input.fotos.length > 0 && input.fotoBase64Loader) {
    if (cy > 600) { doc.addPage(); cy = 60; }
    doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('11. RELATÓRIO FOTOGRÁFICO', 40, cy);
    cy += 14;

    // Categorização por prefixo de legenda (sem precisar de ponto_id no input)
    const fotoBase = input.fotos.find(f => (f.legenda || '').startsWith('📡 Base instalada'));
    const fotosOutras = input.fotos.filter(f => f !== fotoBase);

    // 11.1 — Base GNSS instalada (single column, foto grande centralizada)
    if (fotoBase) {
      doc.fontSize(9).fillColor('#444').font('Helvetica-Bold')
         .text('11.1 Base GNSS instalada em campo', 40, cy);
      cy += 14;
      const bigW = 400;
      const bigH = 290;
      if (cy + bigH + 22 > 800) { doc.addPage(); cy = 60; }
      const conteudo = await input.fotoBase64Loader(fotoBase.id);
      if (conteudo && conteudo.mime.startsWith('image/')) {
        try {
          const buf = Buffer.from(conteudo.base64, 'base64');
          const x = Math.round((595 - bigW) / 2); // largura A4 ≈ 595pt, centraliza
          doc.image(buf, x, cy, { width: bigW, height: bigH, fit: [bigW, bigH] });
          doc.fontSize(8).fillColor('#444').font('Helvetica')
             .text(fotoBase.legenda || `Foto ${fotoBase.id}`, x, cy + bigH + 2, { width: bigW, align: 'center' });
        } catch { /* ignora foto ruim */ }
      }
      cy += bigH + 24;
    }

    // 11.2 — Vértices e demais fotos (grid 2 colunas, comportamento antigo)
    if (fotosOutras.length > 0) {
      if (cy > 700) { doc.addPage(); cy = 60; }
      if (fotoBase) {
        doc.fontSize(9).fillColor('#444').font('Helvetica-Bold')
           .text('11.2 Vértices e demais registros fotográficos', 40, cy);
        cy += 14;
      }
      const fotoW = 250;
      const fotoH = 180;
      let col = 0;
      for (const f of fotosOutras) {
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
    }
    cy += 10;
  }

  // ── 12. ART/TRT ────────────────────────────────────────────────────
  if (cy > 720) { doc.addPage(); cy = 60; }
  doc.fontSize(10).fillColor('#888').font('Helvetica-Bold').text('12. RESPONSABILIDADE TÉCNICA', 40, cy);
  cy += 14;
  doc.fontSize(9).fillColor('#444').font('Helvetica');
  if (laudo.usa_art) doc.text(`☑ ART (CREA): ${laudo.numero_art || '—'}`, 40, cy, { width: 515 });
  else doc.text('☐ ART (CREA): não aplicável', 40, cy);
  cy += 12;
  if (laudo.usa_trt) doc.text(`☑ TRT (CFT): ${laudo.numero_trt || '—'}`, 40, cy, { width: 515 });
  else doc.text('☐ TRT (CFT): não aplicável', 40, cy);
  cy += 16;

  // ── 13. Observacoes (v2.11.0: campo do laudo finalmente renderizado) ─
  if (laudo.observacoes && String(laudo.observacoes).trim()) {
    if (cy > 700) { doc.addPage(); cy = 60; }
    doc.fontSize(10).fillColor('#888').font('Helvetica-Bold')
       .text('13. OBSERVAÇÕES', 40, cy);
    cy += 14;
    doc.fontSize(9).fillColor('#222').font('Helvetica')
       .text(String(laudo.observacoes).trim(), 40, cy, { width: 515, align: 'justify' });
    cy = doc.y + 16;
  }

  // ── 14. Local + data + assinatura ──────────────────────────────────
  if (cy > 720) { doc.addPage(); cy = 60; }
  const cidade = laudo.municipio || 'Açailândia';
  const uf = laudo.uf_imovel || 'MA';
  doc.fontSize(10).fillColor('#111').font('Helvetica')
     .text(`${cidade}/${uf}, ${fmtDataExtenso(dataEmissao)}.`, 40, cy, { width: 515, align: 'center' });
  cy += 30;

  // v2.11.0: BLOCO VISUAL DA ASSINATURA DIGITAL ICP-Brasil (caixa verde).
  // Renderizado APENAS quando o PDF e gerado dentro do fluxo /assinar
  // (input.signatureMeta vem populado). Mesmo padrao do reciboPdf.ts.
  if (input.signatureMeta) {
    const meta = input.signatureMeta;
    const fmtDataAssin = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const validadeFmt = meta.validade_ate ? fmtData(new Date(meta.validade_ate)) : '—';
    const docFmt = (() => {
      const d = (meta.signer_doc || '').replace(/\D/g, '');
      if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      return meta.signer_doc || '—';
    })();
    const dataAssinFmt = fmtDataAssin(meta.data_assinatura);
    const cnLimpo = (meta.signer_cn || executante.nome).replace(/:\d+$/, '');

    const boxX = 130;
    const boxW = 355;
    if (cy + 70 > 800) { doc.addPage(); cy = 60; }
    doc.save()
       .lineWidth(0.8)
       .strokeColor('#10b981')
       .roundedRect(boxX, cy, boxW, 56, 4)
       .stroke()
       .restore();
    doc.fontSize(8).fillColor('#10b981').font('Helvetica-Bold')
       .text('ASSINADO DIGITALMENTE — ICP-Brasil (PAdES)', boxX, cy + 5, {
         width: boxW, align: 'center', lineBreak: false,
       });
    doc.fontSize(8).fillColor('#222').font('Helvetica-Bold')
       .text(cnLimpo, boxX + 6, cy + 19, { width: boxW - 12, align: 'center', lineBreak: false });
    doc.fontSize(7).fillColor('#444').font('Helvetica')
       .text(`${docFmt} · Assinado em ${dataAssinFmt}`, boxX + 6, cy + 31, {
         width: boxW - 12, align: 'center', lineBreak: false,
       });
    doc.fontSize(6.5).fillColor('#666').font('Helvetica')
       .text(`Cert: ${meta.issuer_cn || '—'} · Válido até ${validadeFmt} · Validar em validar.iti.gov.br`,
             boxX + 6, cy + 42, { width: boxW - 12, align: 'center', lineBreak: false });
    cy += 75;
  } else {
    cy += 20;
  }

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

