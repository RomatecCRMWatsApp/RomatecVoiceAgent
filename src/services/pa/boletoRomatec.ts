// v3.144.0 — Boleto com layout Romatec (3 modelos voltados à agrimensura).
//
// O Asaas gera o PDF dele com layout fixo. Aqui o sistema monta o PDF com a
// identidade Romatec usando OS MESMOS dados da cobrança (linha digitável →
// código de barras ITF, Pix copia-e-cola do Asaas) — o pagamento cai no Asaas
// igual e a baixa automática continua valendo.
//
// Estrutura da página (A4):
//   [ parte de cima  ] livre: identidade + informações do lote (muda por modelo)
//   [ recibo pagador ] resumo destacável
//   [ ficha de compensação ] padrão FEBRABAN (preto no branco, leitura em caixa/lotérica)
//
// Modelos:
//   'carta'       Carta técnica — cabeçalho verde, mapa do PA com o lote em destaque
//   'topografico' Folha topográfica — curvas de nível, croqui cotado do lote, carimbo técnico
//   'carne'       Carnê de parcelas — linha do tempo dos pagamentos e progresso do lote
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { linhaParaCodigoBarras, formatarLinhaDigitavel, svgCodigoBarras } from './boletoCodigo';
import { svgLayoutPA } from './mapaSvg';
import type { DesenhoLayout } from './layoutDesenho';

export type ModeloBoleto = 'carta' | 'topografico' | 'carne';
export const MODELOS_BOLETO: Array<{ id: ModeloBoleto; nome: string; descricao: string }> = [
  { id: 'carta', nome: 'Carta Técnica', descricao: 'Cabeçalho Romatec e mapa do PA com o lote em destaque' },
  { id: 'topografico', nome: 'Folha Topográfica', descricao: 'Curvas de nível, croqui cotado do lote e carimbo técnico' },
  { id: 'carne', nome: 'Carnê de Parcelas', descricao: 'Linha do tempo dos pagamentos e quanto falta para quitar o lote' },
];

export interface LoteMapa { numero: string; xy: number[][]; institucional?: boolean }
export interface DadosBoletoRomatec {
  banco: { codigo: string; nome: string };
  beneficiario: { nome: string; documento: string; endereco: string; agencia_codigo: string };
  pagador: { nome: string; cpf: string; endereco: string };
  projeto: { nome: string; municipio: string; uf: string };
  lote: { numero: string; area_m2: number | null; largura_m: number | null; profundidade_m: number | null; terra: string | null; associado_numero: string; xy: number[][] | null };
  parcela: { rotulo: string; valor: number; vencimento: string; multa_valor: number; juros_mes_pct: number };
  descricao: string;
  linha_digitavel: string;
  nosso_numero: string;
  numero_documento: string;
  data_documento: string;
  pix_copia_cola: string | null;
  url_fatura: string | null;
  responsavel_tecnico: { nome: string; registro: string };
  parcelas: Array<{ rotulo: string; valor: number; vencimento: string | null; status: string }>;
  mapa: { lotes: LoteMapa[]; desenho: DesenhoLayout | null } | null;
  ambiente_teste?: boolean;
  /** v3.144.6: arquivo do brasão do projeto em public/brand/pa (ex.: brasao_salete_moreno.png). */
  brasao?: string | null;
}

// ─── utilidades ───────────────────────────────────────────────────────────
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dbr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const m2 = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`);
const m = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`);

function asset(nome: string): string {
  const candidatos = [
    path.resolve(__dirname, '../../public/brand/pa', nome),
    path.resolve(process.cwd(), 'src/public/brand/pa', nome),
    path.resolve(process.cwd(), 'dist/public/brand/pa', nome),
  ];
  const f = candidatos.find((c) => existsSync(c));
  if (!f) return '';
  const mime = nome.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(f).toString('base64')}`;
}

/** Mapa do PA (layout fiel ao da tela/kit) com o lote do associado em destaque. */
function svgMapa(d: DadosBoletoRomatec, opts: { largura: string; destaque: string; fundo?: string; altura?: string; rotulosVias?: boolean }): string {
  if (!d.mapa || !d.mapa.lotes.length) return '';
  return svgLayoutPA({
    lotes: d.mapa.lotes, desenho: d.mapa.desenho, destaque: d.lote.numero, corDestaque: opts.destaque,
    css: `width:${opts.largura};height:${opts.altura ?? 'auto'};display:block;background:${opts.fundo ?? '#fff'}`,
    rotulosVias: opts.rotulosVias,
  });
}

/** Croqui cotado do lote (desenho técnico). */
function svgCroquiLote(d: DadosBoletoRomatec, larguraCss: string, alturaCss = 'auto'): string {
  const xy = d.lote.xy;
  if (!xy || xy.length < 3) return '';
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const pad = Math.max(w, h) * 0.32;
  const vb = `${x0 - pad} ${y0 - pad} ${w + pad * 2} ${h + pad * 2}`;
  const fs = Math.max(w, h) * 0.075;
  const sw = Math.max(w, h) * 0.008;
  const pts = xy.map((p) => `${p[0]},${p[1]}`).join(' ');
  const off = pad * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" style="width:${larguraCss};height:${alturaCss};display:block" font-family="Arial">
    <defs><pattern id="hach" width="${fs * 0.6}" height="${fs * 0.6}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${fs * 0.6}" stroke="#C9A84C" stroke-width="${sw * 0.8}" opacity=".45"/></pattern></defs>
    <polygon points="${pts}" fill="url(#hach)" stroke="#0C3320" stroke-width="${sw * 2.2}"/>
    ${xy.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${sw * 2.6}" fill="#B3261E"/><text x="${p[0] + (p[0] > x0 + w / 2 ? fs * 0.5 : -fs * 0.5)}" y="${p[1] + (p[1] > y0 + h / 2 ? fs * 0.9 : -fs * 0.4)}" font-size="${fs * 0.62}" fill="#B3261E" text-anchor="middle">V${i + 1}</text>`).join('')}
    <g stroke="#333" stroke-width="${sw}"><line x1="${x0}" y1="${y0 - off}" x2="${x0 + w}" y2="${y0 - off}"/><line x1="${x0}" y1="${y0 - off * 1.3}" x2="${x0}" y2="${y0 - off * 0.5}"/><line x1="${x0 + w}" y1="${y0 - off * 1.3}" x2="${x0 + w}" y2="${y0 - off * 0.5}"/>
      <line x1="${x0 + w + off}" y1="${y0}" x2="${x0 + w + off}" y2="${y0 + h}"/><line x1="${x0 + w + off * 0.5}" y1="${y0}" x2="${x0 + w + off * 1.3}" y2="${y0}"/><line x1="${x0 + w + off * 0.5}" y1="${y0 + h}" x2="${x0 + w + off * 1.3}" y2="${y0 + h}"/></g>
    <text x="${x0 + w / 2}" y="${y0 - off - fs * 0.35}" font-size="${fs}" text-anchor="middle" fill="#222">${esc(m(w))}</text>
    <text transform="translate(${x0 + w + off + fs * 0.9},${y0 + h / 2}) rotate(90)" font-size="${fs}" text-anchor="middle" fill="#222">${esc(m(h))}</text>
    <text x="${x0 + w / 2}" y="${y0 + h / 2 - fs * 0.4}" font-size="${fs * 1.5}" font-weight="700" text-anchor="middle" fill="#0C3320">LOTE ${esc(d.lote.numero)}</text>
    <text x="${x0 + w / 2}" y="${y0 + h / 2 + fs * 1.1}" font-size="${fs * 0.95}" text-anchor="middle" fill="#0C3320">${esc(m2(d.lote.area_m2))}</text>
  </svg>`;
}

/** Curvas de nível decorativas (determinísticas). */
function svgCurvasNivel(): string {
  let s = '';
  for (let k = 0; k < 13; k++) {
    const r = 30 + k * 26;
    let dpath = '';
    for (let a = 0; a <= 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const rr = r * (1 + 0.12 * Math.sin(3 * rad + k * 0.7) + 0.06 * Math.cos(5 * rad - k));
      const x = 560 + rr * Math.cos(rad) * 1.35, y = 140 + rr * Math.sin(rad) * 0.8;
      dpath += `${a === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    }
    s += `<path d="${dpath}Z" fill="none" stroke="#0C3320" stroke-opacity="${k % 5 === 0 ? 0.16 : 0.08}" stroke-width="${k % 5 === 0 ? 1.4 : 0.8}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0;width:100%;height:100%">${s}</svg>`;
}

// ─── ficha de compensação (comum aos 3 modelos) ───────────────────────────
function fichaCompensacao(d: DadosBoletoRomatec, linhaFmt: string, barras: string, logoBanco: string): string {
  const instr = [
    'Não receber com cheque.',
    `Após o vencimento cobrar multa de ${brl(d.parcela.multa_valor)} e juros de ${String(d.parcela.juros_mes_pct).replace('.', ',')}% ao mês.`,
    esc(d.descricao),
    d.url_fatura ? `Fatura: ${esc(d.url_fatura)}` : '',
  ].filter(Boolean).join('<br>');
  return `
  <div class="ficha">
    <div class="fh"><div class="fbanco">${logoBanco || esc(d.banco.nome)}</div><div class="fcod">${esc(d.banco.codigo)}</div><div class="flinha">${esc(linhaFmt)}</div></div>
    <table class="ft">
      <tr><td colspan="5"><i>Local de pagamento</i>Pagável em qualquer banco ou casa lotérica, ou pelo Pix</td><td class="fd"><i>Vencimento</i><b>${dbr(d.parcela.vencimento)}</b></td></tr>
      <tr><td colspan="5"><i>Beneficiário</i>${esc(d.beneficiario.nome)} — CNPJ ${esc(d.beneficiario.documento)}</td><td class="fd"><i>Agência / Código do beneficiário</i>${esc(d.beneficiario.agencia_codigo)}</td></tr>
      <tr><td><i>Data do documento</i>${dbr(d.data_documento)}</td><td><i>Nº documento</i>${esc(d.numero_documento)}</td><td><i>Espécie doc.</i>DM</td><td><i>Aceite</i>N</td><td><i>Data processamento</i>${dbr(d.data_documento)}</td><td class="fd"><i>Nosso número</i>${esc(d.nosso_numero)}</td></tr>
      <tr><td><i>Uso do banco</i>&nbsp;</td><td><i>Carteira</i>1</td><td><i>Espécie</i>R$</td><td><i>Quantidade</i>&nbsp;</td><td><i>Valor</i>&nbsp;</td><td class="fd"><i>(=) Valor do documento</i><b>${brl(d.parcela.valor)}</b></td></tr>
      <tr><td colspan="5" rowspan="5" class="finst"><i>Instruções (texto de responsabilidade do beneficiário)</i>${instr}</td><td class="fd"><i>(-) Desconto / Abatimento</i>&nbsp;</td></tr>
      <tr><td class="fd"><i>(-) Outras deduções</i>&nbsp;</td></tr>
      <tr><td class="fd"><i>(+) Mora / Multa</i>&nbsp;</td></tr>
      <tr><td class="fd"><i>(+) Outros acréscimos</i>&nbsp;</td></tr>
      <tr><td class="fd"><i>(=) Valor cobrado</i>&nbsp;</td></tr>
      <tr><td colspan="6"><i>Pagador</i>${esc(d.pagador.nome)} — CPF ${esc(d.pagador.cpf)}<br>${esc(d.pagador.endereco)}</td></tr>
    </table>
    <div class="fbar"><div>${barras}</div><div class="faut">Autenticação mecânica — <b>FICHA DE COMPENSAÇÃO</b></div></div>
  </div>`;
}

function reciboPagador(d: DadosBoletoRomatec, linhaFmt: string): string {
  return `
  <div class="recibo">
    <div class="rtit">RECIBO DO PAGADOR</div>
    <div class="rgrid">
      <div><i>Beneficiário</i>${esc(d.beneficiario.nome)}</div><div><i>Vencimento</i><b>${dbr(d.parcela.vencimento)}</b></div><div><i>Valor</i><b>${brl(d.parcela.valor)}</b></div>
      <div><i>Pagador</i>${esc(d.pagador.nome)}</div><div><i>Nosso número</i>${esc(d.nosso_numero)}</div><div><i>Referente a</i>Lote ${esc(d.lote.numero)} · ${esc(d.parcela.rotulo)}</div>
    </div>
    <div class="rlinha">${esc(linhaFmt)}</div>
  </div>
  <div class="corte">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>`;
}

const CSS_BASE = `
  @page{size:A4;margin:0}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Liberation Sans',Arial,Helvetica,sans-serif;color:#1C1C18;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pg{width:210mm;height:297mm;position:relative;overflow:hidden;padding:9mm 10mm 7mm}
  i{display:block;font-style:normal;font-size:6.6pt;color:#555;margin-bottom:.6mm}
  .teste{position:absolute;top:118mm;left:0;right:0;text-align:center;font-size:30pt;font-weight:800;color:rgba(179,38,30,.13);transform:rotate(-12deg);pointer-events:none;z-index:5}
  .recibo{border:1px solid #bbb;border-radius:2mm;padding:2mm 3mm;margin-top:3mm;font-size:8pt}
  .rtit{font-size:7pt;font-weight:700;letter-spacing:1px;color:#0C3320;margin-bottom:1.5mm}
  .rgrid{display:grid;grid-template-columns:2fr 1fr 1.3fr;gap:1.6mm 4mm}
  .rlinha{margin-top:2mm;font-family:'Courier New',monospace;font-size:9pt;font-weight:700;letter-spacing:.3px}
  .corte{font-size:7pt;color:#888;margin:2.2mm 0 1.5mm;white-space:nowrap;overflow:hidden}
  .ficha{font-size:8pt}
  .fh{display:flex;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:1mm}
  .fbanco{width:34mm;font-weight:700;font-size:11pt;height:9mm;display:flex;align-items:flex-end}
  .fbanco img{max-height:9mm;max-width:40mm}
  .fcod{border-left:2px solid #000;border-right:2px solid #000;padding:0 3mm;font-size:15pt;font-weight:800;line-height:1}
  .flinha{flex:1;text-align:right;font-family:'Courier New',monospace;font-size:10.4pt;font-weight:700;letter-spacing:0;white-space:nowrap}
  .ft{width:100%;border-collapse:collapse;table-layout:fixed}
  .ft td{border:1px solid #000;border-top:0;padding:.9mm 1.4mm;vertical-align:top;height:7.3mm;overflow:hidden}
  .ft td:first-child{border-left:0}
  .ft td.fd{width:45mm;border-right:0;text-align:right}
  .ft td.fd i{text-align:left}
  .ft td.finst{font-size:7.4pt;line-height:1.35}
  .fbar{display:flex;justify-content:space-between;align-items:flex-start;margin-top:2mm}
  .faut{font-size:7pt;text-align:right;color:#333}
`;

// ─── modelos (parte de cima) ──────────────────────────────────────────────
function blocoPix(d: DadosBoletoRomatec, qr: string, cor: string): string {
  if (!qr) return '';
  return `<div class="pix" style="border-color:${cor}"><div class="pixqr">${qr}</div><div class="pixtxt"><b style="color:${cor}">Pague com Pix</b><span>Abra o app do banco, escolha Pix › Ler QR Code. A baixa é automática.</span></div></div>`;
}

function topoCarta(d: DadosBoletoRomatec, logo: string, wm: string, qr: string): string {
  const mapa = svgMapa(d, { largura: '100%', destaque: '#C9A84C', altura: '84mm' });
  return `
  <style>
    .cab{background:linear-gradient(135deg,#0C3320,#14472B);border-radius:3mm;padding:3.5mm 5mm;display:flex;justify-content:space-between;align-items:center;color:#fff}
    .cab .lg{background:#fff;border-radius:2mm;padding:1.5mm 2.5mm;height:17mm;display:flex;align-items:center}
    .cab .lg img{height:14mm}
    .cab h1{margin:0;font-size:15pt;letter-spacing:.5px;text-align:right}
    .cab .sub{color:#E3D19A;font-size:8.5pt;text-align:right;margin-top:1mm}
    .faixa{height:1.4mm;background:#C9A84C;margin:2mm 0 4mm;border-radius:1mm}
    .corpo{display:grid;grid-template-columns:1.05fr 1fr;gap:5mm;position:relative}
    .wm{position:absolute;right:-4mm;top:-6mm;width:72mm;opacity:.55;z-index:0}
    .info{position:relative;z-index:1}
    .info h2{font-size:10pt;color:#0C3320;margin:0 0 2mm;border-bottom:1.5px solid #C9A84C;padding-bottom:1mm;letter-spacing:.4px}
    .kv{display:grid;grid-template-columns:30mm 1fr;gap:1.3mm 2mm;font-size:8.6pt}
    .kv span:nth-child(odd){color:#6A6656;font-weight:700}
    .valor{margin-top:4mm;display:grid;grid-template-columns:1fr 1fr;gap:3mm}
    .vbox{border-radius:2.5mm;padding:2.6mm 3.2mm;background:#FFF4DC;border:1px solid #E3D19A}
    .vbox b{display:block;font-size:15pt;color:#0C3320;margin-top:.6mm}
    .vbox.v2{background:#0C3320;border-color:#0C3320;color:#E3D19A}
    .vbox.v2 b{color:#fff}
    .mapa{border:1px solid #DCD5C2;border-radius:2.5mm;overflow:hidden;position:relative;z-index:1}
    .mapa .leg{font-size:6.8pt;color:#6A6656;padding:1.2mm 2mm;background:#fff}
    .pix{display:flex;gap:3mm;align-items:center;border:1.5px solid;border-radius:2.5mm;padding:2mm 3mm;margin-top:3.5mm}
    .pixqr svg{width:24mm;height:24mm;display:block}
    .pixtxt{font-size:8pt;line-height:1.35}.pixtxt b{display:block;font-size:10.5pt}
    .rt{font-size:6.8pt;color:#6A6656;margin-top:3mm}
  </style>
  <div class="cab"><div class="lg">${logo ? `<img src="${logo}">` : '<b style="color:#0C3320">ROMATEC</b>'}</div>
    <div><h1>BOLETO DE PAGAMENTO</h1><div class="sub">${esc(d.projeto.nome)} · ${esc(d.projeto.municipio)}/${esc(d.projeto.uf)}</div></div></div>
  <div class="faixa"></div>
  <div class="corpo">
    ${wm ? `<img class="wm" src="${wm}">` : ''}
    <div class="info">
      <h2>DADOS DO LOTE E DA PARCELA</h2>
      <div class="kv">
        <span>Associado(a)</span><span>${esc(d.pagador.nome)}</span>
        <span>Nº cadastro</span><span>${esc(d.lote.associado_numero)}</span>
        <span>Lote</span><span><b>${esc(d.lote.numero)}</b>${d.lote.terra ? ' · ' + esc(d.lote.terra) : ''}</span>
        <span>Dimensões</span><span>${esc(m(d.lote.largura_m))} × ${esc(m(d.lote.profundidade_m))}</span>
        <span>Área do projeto</span><span>${esc(m2(d.lote.area_m2))}</span>
        <span>Referente a</span><span>${esc(d.parcela.rotulo)}</span>
      </div>
      <div class="valor"><div class="vbox"><span style="font-size:7.5pt;color:#6A6656;font-weight:700">VENCIMENTO</span><b>${dbr(d.parcela.vencimento)}</b></div>
        <div class="vbox v2"><span style="font-size:7.5pt;font-weight:700">VALOR</span><b>${brl(d.parcela.valor)}</b></div></div>
      ${blocoPix(d, qr, '#0C3320')}
    </div>
    <div>
      <div class="mapa">${mapa}<div class="leg">Lote ${esc(d.lote.numero)} em destaque · croqui preliminar — posição definitiva conforme georreferenciamento (SIRGAS 2000)</div></div>
      <div class="rt">Responsável técnico: ${esc(d.responsavel_tecnico.nome)} · ${esc(d.responsavel_tecnico.registro)}<br>${esc(d.beneficiario.nome)} · CNPJ ${esc(d.beneficiario.documento)}</div>
    </div>
  </div>`;
}

function topoTopografico(d: DadosBoletoRomatec, logo: string, _wm: string, qr: string): string {
  const croqui = svgCroquiLote(d, '100%', '64mm');
  return `
  <style>
    .folha{position:relative;border:1.6px solid #0C3320;border-radius:1.5mm;padding:4mm;overflow:hidden;height:118mm;background:#FBFAF5}
    .folha .moldura{position:absolute;inset:1.6mm;border:.5px solid #0C3320;pointer-events:none}
    .tt{position:relative;display:flex;justify-content:space-between;align-items:flex-start;z-index:1}
    .tt img{height:13mm}
    .tt .t{text-align:right}.tt .t h1{margin:0;font-size:13pt;color:#0C3320;letter-spacing:1px}
    .tt .t div{font-size:7.8pt;color:#6A6656;margin-top:1mm}
    .grade{position:relative;z-index:1;display:grid;grid-template-columns:.95fr 1.15fr;gap:5mm;margin-top:3mm}
    .croq{background:rgba(255,255,255,.75);border:1px dashed #C9A84C;border-radius:2mm;padding:2mm}
    .croq .cap{font-size:6.8pt;color:#6A6656;text-align:center;margin-top:1mm}
    .lado h2{font-size:9pt;color:#0C3320;margin:0 0 1.5mm;letter-spacing:.6px}
    .coord{font-family:'Courier New',monospace;font-size:7.6pt;background:rgba(255,255,255,.8);border:1px solid #DCD5C2;border-radius:1.5mm;padding:1.6mm 2mm;margin-bottom:3mm}
    .big{display:flex;gap:3mm;margin-bottom:3mm}
    .big div{flex:1;background:#fff;border:1px solid #0C3320;border-radius:1.5mm;padding:2mm 2.6mm}
    .big b{display:block;font-size:14pt;color:#0C3320;margin-top:.5mm}
    .big .val{background:#0C3320;color:#E3D19A}.big .val b{color:#fff}
    .pix{display:flex;gap:3mm;align-items:center;border:1.5px solid;border-radius:1.5mm;padding:2mm 3mm;background:#fff}
    .pixqr svg{width:22mm;height:22mm;display:block}.pixtxt{font-size:7.8pt;line-height:1.35}.pixtxt b{display:block;font-size:10pt}
    .carimbo{position:absolute;right:4mm;bottom:4mm;left:4mm;z-index:1;display:grid;grid-template-columns:1.4fr 1fr .8fr .8fr;border:1.2px solid #0C3320;background:#fff;font-size:7.4pt}
    .carimbo div{border-right:1px solid #0C3320;padding:1.2mm 2mm}.carimbo div:last-child{border-right:0}
    .carimbo b{display:block;font-size:8.4pt;color:#0C3320}
  </style>
  <div class="folha">${svgCurvasNivel()}<div class="moldura"></div>
    <div class="tt">${logo ? `<img src="${logo}">` : ''}<div class="t"><h1>BOLETO · ${esc(d.parcela.rotulo.toUpperCase())}</h1><div>${esc(d.projeto.nome)} — ${esc(d.projeto.municipio)}/${esc(d.projeto.uf)}</div></div></div>
    <div class="grade">
      <div class="croq">${croqui}<div class="cap">Croqui do lote · cotas em metros · vértices preliminares (V1–V${d.lote.xy?.length ?? 4})</div></div>
      <div class="lado">
        <h2>IDENTIFICAÇÃO</h2>
        <div class="coord">ASSOCIADO ${esc(d.lote.associado_numero)}<br>${esc(d.pagador.nome)}<br>${d.lote.terra ? esc(d.lote.terra).toUpperCase() + '<br>' : ''}SISTEMA: croqui local → SIRGAS 2000 (NBR 13133)</div>
        <div class="big"><div><span style="font-size:7pt;color:#6A6656;font-weight:700">VENCIMENTO</span><b>${dbr(d.parcela.vencimento)}</b></div><div class="val"><span style="font-size:7pt;font-weight:700">VALOR</span><b>${brl(d.parcela.valor)}</b></div></div>
        ${blocoPix(d, qr, '#0C3320')}
      </div>
    </div>
    <div class="carimbo">
      <div><span>PROJETO</span><b>${esc(d.projeto.nome)}</b></div>
      <div><span>RESPONSÁVEL TÉCNICO</span><b>${esc(d.responsavel_tecnico.nome.split(' ').slice(0, 2).join(' '))}</b>${esc(d.responsavel_tecnico.registro)}</div>
      <div><span>LOTE / ÁREA</span><b>${esc(d.lote.numero)} · ${esc(m2(d.lote.area_m2))}</b></div>
      <div><span>FOLHA</span><b>${esc(d.parcela.rotulo)}</b>Romatec</div>
    </div>
  </div>`;
}

function topoCarne(d: DadosBoletoRomatec, logo: string, wm: string, qr: string): string {
  const brasao = d.brasao ? asset(d.brasao) : '';
  const total = d.parcelas.reduce((s, p) => s + p.valor, 0);
  const pago = d.parcelas.filter((p) => p.status === 'PAGO').reduce((s, p) => s + p.valor, 0);
  const pct = total ? Math.round((pago / total) * 100) : 0;
  const mapa = svgMapa(d, { largura: '100%', destaque: '#C9A84C', fundo: '#ffffff', altura: d.brasao ? '31mm' : '44mm', rotulosVias: false });
  return `
  <style>
    .cn{display:grid;grid-template-columns:52mm 1fr;border:1.4px solid #0C3320;border-radius:3mm;overflow:hidden;height:118mm}
    .stub{background:#0C3320;color:#fff;padding:4mm;position:relative;overflow:hidden}
    .stub .lg{background:#fff;border-radius:2mm;padding:1.4mm;text-align:center}.stub .lg img{width:100%}
    .stub h3{color:#C9A84C;font-size:8pt;letter-spacing:1px;margin:2.4mm 0 1mm}
    .stub .it{font-size:7.6pt;margin-bottom:1.2mm;line-height:1.22}.stub .it span{display:block;color:#E3D19A;font-size:6.6pt;font-weight:700}
    .stub .wm{position:absolute;bottom:-14mm;left:-10mm;width:70mm;opacity:.12;filter:brightness(3)}
    .stub .bras{position:relative;margin-top:2.2mm;display:flex;align-items:flex-end;gap:2.5mm}
    .stub .bras img{height:22mm;width:auto;filter:drop-shadow(0 .6mm 1mm rgba(0,0,0,.45))}
    .stub .bras span{font-size:6.4pt;line-height:1.3;color:#E3D19A;padding-bottom:1.5mm}
    .stub .bras b{display:block;color:#fff;font-size:7.2pt;letter-spacing:.3px}
    .stub .mini{margin-top:2mm;border-radius:1.5mm;overflow:hidden;border:1px solid rgba(255,255,255,.3)}
    .main{padding:4mm 5mm;position:relative;background:linear-gradient(180deg,#FFF4DC 0,#fff 40mm)}
    .main h1{margin:0;font-size:14pt;color:#0C3320}.main .s{font-size:8pt;color:#6A6656;margin-top:.6mm}
    .prog{margin:4mm 0 2mm;height:5mm;background:#ECE7D8;border-radius:3mm;overflow:hidden}.prog i{display:block;height:100%;background:linear-gradient(90deg,#1f7a4d,#C9A84C);margin:0}
    .ptxt{font-size:8pt;color:#0C3320;display:flex;justify-content:space-between}
    .tl{margin:4mm 0 2mm;display:flex;justify-content:space-between;position:relative}
    .tl:before{content:'';position:absolute;left:6mm;right:6mm;top:5mm;height:1.2mm;background:#DCD5C2}
    .tl .p{position:relative;text-align:center;width:33%;font-size:7.6pt}
    .tl .dot{width:10mm;height:10mm;border-radius:50%;margin:0 auto 1.6mm;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:9pt;border:1.2mm solid #fff;box-shadow:0 0 0 .4mm #DCD5C2}
    .tl .PAGO .dot{background:#1f7a4d;color:#fff}.tl .atual .dot{background:#C9A84C;color:#0C3320;box-shadow:0 0 0 .6mm #0C3320}.tl .fut .dot{background:#F1EFE8;color:#6A6656}
    .tl b{display:block;font-size:8.6pt;color:#0C3320}
    .agora{display:grid;grid-template-columns:1fr 1fr 1.25fr;gap:3mm;margin-top:3mm;align-items:stretch}
    .agora>div{border-radius:2mm;padding:2.5mm 3mm;border:1px solid #DCD5C2;background:#fff}
    .agora b{display:block;font-size:14pt;color:#0C3320;margin-top:.6mm}
    .agora .v{background:#0C3320;color:#E3D19A;border-color:#0C3320}.agora .v b{color:#fff}
    .pix{display:flex;gap:2.5mm;align-items:center;border:1.5px solid;border-radius:2mm;padding:1.6mm 2.4mm}
    .pixqr svg{width:20mm;height:20mm;display:block}.pixtxt{font-size:7.2pt;line-height:1.3}.pixtxt b{display:block;font-size:9.5pt}
    .icons{position:absolute;right:5mm;top:4mm;font-size:6.8pt;color:#6A6656;text-align:right}
    .como{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin-top:4mm;font-size:7.4pt;color:#444;line-height:1.35}
    .como div{border-top:1.2mm solid #C9A84C;padding-top:1.6mm}
    .como b{display:block;color:#0C3320;font-size:8.4pt;margin-bottom:.6mm}
  </style>
  <div class="cn">
    <div class="stub">
      ${wm ? `<img class="wm" src="${wm}">` : ''}
      <div class="lg">${logo ? `<img src="${logo}">` : '<b style="color:#0C3320">ROMATEC</b>'}</div>
      <h3>CARNÊ DO LOTE</h3>
      <div class="it"><span>ASSOCIADO(A)</span>${esc(d.pagador.nome)}</div>
      <div class="it"><span>CADASTRO</span>${esc(d.lote.associado_numero)}</div>
      <div class="it"><span>LOTE · ÁREA</span>${esc(d.lote.numero)} · ${esc(m2(d.lote.area_m2))}</div>
      ${d.lote.terra ? `<div class="it"><span>DENOMINAÇÃO</span>${esc(d.lote.terra)}</div>` : ''}
      <div class="mini">${mapa}</div>
      ${brasao ? `<div class="bras"><img src="${brasao}" alt="Brasão"><span><b>${esc(d.projeto.nome.replace(/^Projeto de Assentamento/i, 'PA'))}</b>Terra · Trabalho · Vida<br>${esc(d.projeto.municipio)} – ${esc(d.projeto.uf)}</span></div>` : ''}
    </div>
    <div class="main">
      <div class="icons">⌖ Agrimensura · Georreferenciamento<br>${esc(d.responsavel_tecnico.registro)}</div>
      <h1>${esc(d.parcela.rotulo)}</h1>
      <div class="s">${esc(d.projeto.nome)} — ${esc(d.projeto.municipio)}/${esc(d.projeto.uf)}</div>
      <div class="prog"><i style="width:${pct}%"></i></div>
      <div class="ptxt"><span>Pago até agora: <b>${brl(pago)}</b></span><span>${pct}% do lote</span><span>Total: <b>${brl(total)}</b></span></div>
      <div class="tl">
        ${d.parcelas.map((p, i) => {
          const atual = p.rotulo === d.parcela.rotulo;
          const cls = p.status === 'PAGO' ? 'PAGO' : atual ? 'atual' : 'fut';
          return `<div class="p ${cls}"><div class="dot">${p.status === 'PAGO' ? '✓' : i + 1}</div><b>${esc(p.rotulo)}</b>${brl(p.valor)}<br>${p.status === 'PAGO' ? 'pago' : 'venc. ' + dbr(p.vencimento)}</div>`;
        }).join('')}
      </div>
      <div class="agora">
        <div><span style="font-size:7pt;color:#6A6656;font-weight:700">VENCIMENTO</span><b>${dbr(d.parcela.vencimento)}</b></div>
        <div class="v"><span style="font-size:7pt;font-weight:700">VALOR DESTA PARCELA</span><b>${brl(d.parcela.valor)}</b></div>
        ${blocoPix(d, qr, '#0C3320') || '<div></div>'}
      </div>
      <div class="como">
        <div><b>1 · Boleto</b>Pague em qualquer banco, app ou lotérica usando o código de barras abaixo.</div>
        <div><b>2 · Pix</b>Leia o QR Code com o app do banco — cai na hora.</div>
        <div><b>3 · Baixa automática</b>Não precisa mandar comprovante: o sistema da Romatec confirma sozinho.</div>
      </div>
    </div>
  </div>`;
}

// ─── montagem ─────────────────────────────────────────────────────────────
export async function htmlBoletoRomatec(d: DadosBoletoRomatec, modelo: ModeloBoleto): Promise<string> {
  const cod = linhaParaCodigoBarras(d.linha_digitavel);
  const linhaFmt = formatarLinhaDigitavel(d.linha_digitavel);
  const barras = svgCodigoBarras(cod);
  const qr = d.pix_copia_cola ? await QRCode.toString(d.pix_copia_cola, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0C3320', light: '#ffffff' } }) : '';
  const logo = asset('logo_romatec.jpg');
  const wm = asset('wm_rgba.png');
  const topo = modelo === 'topografico' ? topoTopografico(d, logo, wm, qr) : modelo === 'carne' ? topoCarne(d, logo, wm, qr) : topoCarta(d, logo, wm, qr);
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Boleto ${esc(d.lote.associado_numero)} ${esc(d.parcela.rotulo)}</title><style>${CSS_BASE}</style></head>
  <body><div class="pg">
    ${d.ambiente_teste ? '<div class="teste">BOLETO DE TESTE — NÃO PAGAR</div>' : ''}
    ${topo}
    ${reciboPagador(d, linhaFmt)}
    ${fichaCompensacao(d, linhaFmt, barras, '')}
  </div></body></html>`;
}

export async function pdfBoletoRomatec(d: DadosBoletoRomatec, modelo: ModeloBoleto): Promise<Buffer> {
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  return htmlToPdf(await htmlBoletoRomatec(d, modelo), { format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
}
