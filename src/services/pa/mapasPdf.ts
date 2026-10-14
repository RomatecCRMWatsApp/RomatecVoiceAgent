// v3.146.0 — PDFs técnicos do PA, gerados na hora com os dados atuais:
//   • Mapa da vila + memorial descritivo dos lotes
//   • Mapa geral (perímetro georreferenciado) + memorial descritivo do perímetro
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { svgLayoutPA, type LoteDoMapa } from './mapaSvg';
import type { DesenhoLayout } from './layoutDesenho';
import type { MemorialLote } from './memorialVila';
import { grausDms, latLonDms, textoMemorialPerimetro, type Perimetro } from './perimetro';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fm = (v: number, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function asset(nome: string | null): string {
  if (!nome) return '';
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? `data:${nome.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${readFileSync(f).toString('base64')}` : '';
}

export interface DadosMapaPA {
  projeto: { nome: string; municipio: string; uf: string; associacao: string | null };
  rt: { nome: string; registro: string };
  marca: { brasao: string | null; emblema: string | null }; // nomes de arquivo
  data: string; // dd/mm/aaaa
}

const CSS = `
  @page{size:A4;margin:10mm}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Liberation Sans',Arial,sans-serif;color:#1C1C18;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:9pt}
  .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
  .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}
  .cab .lg img{height:11mm}
  .cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
  .cab h1{margin:0;font-size:13pt;letter-spacing:.4px}
  .cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}
  .cab .t{flex:1}
  .mapa{position:relative;border:1px solid #C9C2AE;border-radius:2mm;margin-top:3mm;overflow:hidden;background:#fff}
  .mapa .bras{position:absolute;right:4mm;bottom:4mm;width:30mm;filter:drop-shadow(0 .6mm 1.2mm rgba(0,0,0,.3))}
  .quadros{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm;margin-top:3mm}
  .q{border:1px solid #C9C2AE;border-radius:2mm;padding:2mm 3mm}
  .q b{display:block;color:#0C3320;font-size:12pt;margin-top:.5mm}
  .q span{color:#6A6656;font-size:7pt;text-transform:uppercase;letter-spacing:.4px;font-weight:700}
  .nota{font-size:7pt;color:#6A6656;font-style:italic;margin-top:2mm}
  .rod{margin-top:2mm;font-size:7pt;color:#555;display:flex;justify-content:space-between;border-top:1px solid #C9A84C;padding-top:1.5mm}
  .quebra{page-break-before:always}
  h2{color:#0C3320;font-size:11pt;margin:3mm 0 2mm;border-bottom:1.2px solid #C9A84C;padding-bottom:1mm}
  table{width:100%;border-collapse:collapse;font-size:7.6pt}
  th{background:#0C3320;color:#fff;padding:1.4mm 1.2mm;text-align:left;font-size:7pt}
  td{border-bottom:1px solid #E5DFCD;padding:1.2mm;vertical-align:top}
  tr:nth-child(even) td{background:#FAF7EE}
  td.n{text-align:right;white-space:nowrap}
  .conf{color:#555;font-size:6.9pt}
  p.memo{text-align:justify;line-height:1.45;font-size:8.6pt;margin:0 0 2.5mm}
  .ass{margin-top:12mm;text-align:center;font-size:8pt}
  .ass div{border-top:1px solid #333;width:80mm;margin:0 auto 1mm;padding-top:1mm}
`;

function cabecalho(d: DadosMapaPA, titulo: string): string {
  const logo = (() => { const f = [path.resolve(__dirname, '../../public/brand/pa/logo_romatec.jpg'), path.resolve(process.cwd(), 'src/public/brand/pa/logo_romatec.jpg')].find((c) => existsSync(c)); return f ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : ''; })();
  const em = asset(d.marca.emblema);
  return `<div class="cab">${logo ? `<div class="lg"><img src="${logo}"></div>` : ''}<div class="t"><h1>${esc(titulo)}</h1><div class="s">${esc(d.projeto.nome)} · ${esc(d.projeto.municipio)}/${esc(d.projeto.uf)}${d.projeto.associacao ? ' · ' + esc(d.projeto.associacao) : ''}</div></div>${em ? `<img class="em" src="${em}">` : ''}</div>`;
}
function rodape(d: DadosMapaPA): string {
  return `<div class="rod"><span>Responsável técnico: ${esc(d.rt.nome)} · ${esc(d.rt.registro)}</span><span>Romatec Consultoria Total · gerado em ${esc(d.data)}</span></div>`;
}

// ─── Mapa da vila + memorial dos lotes ────────────────────────────────────
export function htmlMapaVila(d: DadosMapaPA, lotes: LoteDoMapa[], desenho: DesenhoLayout | null, memorial: MemorialLote[]): string {
  const mapa = svgLayoutPA({ lotes, desenho, destaque: null, css: 'width:100%;height:205mm;display:block' });
  const bras = asset(d.marca.brasao);
  const areaLotes = memorial.reduce((s, m) => s + m.area_m2, 0);
  const inst = memorial.filter((m) => m.institucional).length;
  const linhas = memorial.map((m) => `<tr><td><b>${esc(m.numero)}</b>${m.institucional ? '<div class="conf">institucional</div>' : ''}</td>
    <td class="n">${fm(m.frente.medida)} m<div class="conf">${esc(m.frente.confrontante)}</div></td>
    <td class="n">${fm(m.fundos.medida)} m<div class="conf">${esc(m.fundos.confrontante)}</div></td>
    <td class="n">${fm(m.direita.medida)} m<div class="conf">${esc(m.direita.confrontante)}</div></td>
    <td class="n">${fm(m.esquerda.medida)} m<div class="conf">${esc(m.esquerda.confrontante)}</div></td>
    <td class="n">${fm(m.area_m2)}</td><td class="n">${fm(m.perimetro_m)}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Mapa da vila e memorial descritivo — ${esc(d.projeto.nome)}</title><style>${CSS}</style></head><body>
    ${cabecalho(d, 'MAPA DA VILA — LAYOUT DOS LOTES')}
    <div class="mapa">${mapa}${bras ? `<img class="bras" src="${bras}">` : ''}</div>
    <div class="quadros"><div class="q"><span>Lotes</span><b>${memorial.length}</b>${memorial.length - inst} de associados · ${inst} institucionais</div>
      <div class="q"><span>Área total dos lotes</span><b>${fm(areaLotes)} m²</b>${fm(areaLotes / 10000, 4)} ha</div>
      <div class="q"><span>Padrão</span><b>20,00 × 40,00 m</b>vias de 10,00 m</div></div>
    <div class="nota">Croqui técnico preliminar, sem amarração geodésica — dimensões, áreas e posição definitivas conforme georreferenciamento (SIRGAS 2000) e NBR 13133. Cotas em metros.</div>
    ${rodape(d)}
    <div class="quebra"></div>
    ${cabecalho(d, 'MEMORIAL DESCRITIVO DOS LOTES — VILA')}
    <h2>Medidas e confrontações</h2>
    <p class="memo">Frente: lado voltado para a via de acesso. Laterais direita e esquerda: vistas de quem está na via, de frente para o lote. Medidas em metros e áreas em metros quadrados, extraídas do croqui do layout (preliminar).</p>
    <table><thead><tr><th>Lote</th><th>Frente</th><th>Fundos</th><th>Lateral direita</th><th>Lateral esquerda</th><th>Área (m²)</th><th>Perímetro (m)</th></tr></thead><tbody>${linhas}</tbody></table>
    <div class="ass"><div>${esc(d.rt.nome)}</div>${esc(d.rt.registro)}</div>
    ${rodape(d)}
  </body></html>`;
}

// ─── Mapa geral (perímetro) + memorial ────────────────────────────────────
export function svgPerimetro(p: Perimetro, css = 'width:100%;height:auto;display:block'): string {
  const Es = p.vertices.map((v) => v.E), Ns = p.vertices.map((v) => v.N);
  const minE = Math.min(...Es), maxE = Math.max(...Es), minN = Math.min(...Ns), maxN = Math.max(...Ns);
  const span = Math.max(maxE - minE, maxN - minN) || 1;
  const pad = span * 0.12;
  const x0 = minE - pad, y0 = -(maxN + pad), W = maxE - minE + pad * 2, H = maxN - minN + pad * 2;
  const fs = span * 0.022, sw = span * 0.0025;
  const pts = p.vertices.map((v) => `${v.E.toFixed(3)},${(-v.N).toFixed(3)}`).join(' ');
  const cx = Es.reduce((s, v) => s + v, 0) / Es.length, cy = -Ns.reduce((s, v) => s + v, 0) / Ns.length;
  // barra de escala "redonda"
  const alvo = span / 4;
  const passo = [1, 2, 5].map((m) => m * 10 ** Math.floor(Math.log10(alvo))).concat([10 ** Math.ceil(Math.log10(alvo))]).reduce((a, b) => (Math.abs(b - alvo) < Math.abs(a - alvo) ? b : a));
  const sbx = x0 + pad * 0.5, sby = y0 + H - pad * 0.45;
  // grade de coordenadas
  const grade: string[] = [];
  const gp = passo;
  for (let e = Math.ceil(x0 / gp) * gp; e < x0 + W; e += gp) grade.push(`<line x1="${e}" y1="${y0}" x2="${e}" y2="${y0 + H}" stroke="#D8D2C0" stroke-width="${sw * 0.5}"/><text x="${e}" y="${y0 + fs * 1.1}" font-size="${fs * 0.7}" text-anchor="middle" fill="#8a836f">E ${Math.round(e)}</text>`);
  for (let n = Math.ceil(-(y0 + H) / gp) * gp; n < -y0; n += gp) grade.push(`<line x1="${x0}" y1="${-n}" x2="${x0 + W}" y2="${-n}" stroke="#D8D2C0" stroke-width="${sw * 0.5}"/><text x="${x0 + fs * 0.3}" y="${-n - fs * 0.25}" font-size="${fs * 0.7}" fill="#8a836f">N ${Math.round(n)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${W} ${H}" style="${css}" font-family="Liberation Sans, Arial, sans-serif">
    <rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#FBFAF5"/>${grade.join('')}
    <polygon points="${pts}" fill="#B7D99A" fill-opacity=".55" stroke="#0C3320" stroke-width="${sw * 2}"/>
    ${p.vertices.map((v) => { const dx = v.E - cx, dy = -v.N - cy, L = Math.hypot(dx, dy) || 1; return `<circle cx="${v.E}" cy="${-v.N}" r="${sw * 3}" fill="#B3261E"/><text x="${v.E + (dx / L) * fs * 1.2}" y="${-v.N + (dy / L) * fs * 1.2}" font-size="${fs * 0.85}" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="#B3261E">${esc(v.nome)}</text>`; }).join('')}
    <text x="${cx}" y="${cy}" font-size="${fs * 1.3}" font-weight="800" text-anchor="middle" fill="#0C3320">${fm(p.area_ha, 4)} ha</text>
    <g transform="translate(${x0 + W - pad * 0.55},${y0 + pad * 0.6})"><polygon points="0,${-fs * 1.6} ${fs * 0.7},${fs * 0.6} 0,${fs * 0.2} ${-fs * 0.7},${fs * 0.6}" fill="#0C3320"/><text y="${-fs * 1.9}" font-size="${fs}" font-weight="800" text-anchor="middle" fill="#0C3320">N</text></g>
    <g><rect x="${sbx}" y="${sby}" width="${passo / 2}" height="${fs * 0.4}" fill="#0C3320"/><rect x="${sbx + passo / 2}" y="${sby}" width="${passo / 2}" height="${fs * 0.4}" fill="#fff" stroke="#0C3320" stroke-width="${sw * 0.6}"/>
      <text x="${sbx}" y="${sby - fs * 0.3}" font-size="${fs * 0.7}" fill="#0C3320">0</text><text x="${sbx + passo}" y="${sby - fs * 0.3}" font-size="${fs * 0.7}" text-anchor="end" fill="#0C3320">${passo >= 1000 ? fm(passo / 1000, 0) + ' km' : fm(passo, 0) + ' m'}</text></g>
  </svg>`;
}

export function htmlMapaGeral(d: DadosMapaPA, p: Perimetro): string {
  const bras = asset(d.marca.brasao);
  const paragrafos = textoMemorialPerimetro(p, d.projeto.nome, `${d.projeto.municipio}/${d.projeto.uf}`);
  const linhas = p.vertices.map((v, i) => { const s = p.segmentos[i]; return `<tr><td><b>${esc(v.nome)}</b></td><td class="n">${fm(v.E, 3)}</td><td class="n">${fm(v.N, 3)}</td><td class="n">${esc(latLonDms(v.lat, 'lat'))}</td><td class="n">${esc(latLonDms(v.lon, 'lon'))}</td><td>${esc(s.de)} → ${esc(s.para)}</td><td class="n">${esc(grausDms(s.azimute))}</td><td class="n">${fm(s.distancia)}</td></tr>`; }).join('');
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Mapa geral e memorial descritivo — ${esc(d.projeto.nome)}</title><style>${CSS}</style></head><body>
    ${cabecalho(d, 'MAPA GERAL DO PROJETO DE ASSENTAMENTO — PERÍMETRO')}
    <div class="mapa">${svgPerimetro(p, 'width:100%;height:200mm;display:block')}${bras ? `<img class="bras" src="${bras}">` : ''}</div>
    <div class="quadros"><div class="q"><span>Área</span><b>${fm(p.area_ha, 4)} ha</b>${fm(p.area_m2)} m²</div>
      <div class="q"><span>Perímetro</span><b>${fm(p.perimetro_m)} m</b>${p.vertices.length} vértices</div>
      <div class="q"><span>Referência</span><b>${esc(p.datum)}</b>UTM fuso ${p.fuso}${p.hemisferio === 'S' ? ' Sul' : ' Norte'} · origem ${esc(p.origem.formato)}</div></div>
    ${rodape(d)}
    <div class="quebra"></div>
    ${cabecalho(d, 'MEMORIAL DESCRITIVO DO PERÍMETRO')}
    <h2>Descrição</h2>${paragrafos.map((t) => `<p class="memo">${esc(t)}</p>`).join('')}
    <h2>Quadro de coordenadas, azimutes e distâncias</h2>
    <table><thead><tr><th>Vértice</th><th>E (m)</th><th>N (m)</th><th>Latitude</th><th>Longitude</th><th>Lado</th><th>Azimute</th><th>Distância (m)</th></tr></thead><tbody>${linhas}</tbody></table>
    <div class="ass"><div>${esc(d.rt.nome)}</div>${esc(d.rt.registro)}</div>
    ${rodape(d)}
  </body></html>`;
}

export async function pdfDeHtml(html: string): Promise<Buffer> {
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  return htmlToPdf(html, { format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
}
