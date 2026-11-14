// v3.146.0 — PDFs técnicos do PA, gerados na hora com os dados atuais:
//   • Mapa da vila + memorial descritivo dos lotes
//   • Mapa geral (perímetro georreferenciado) + memorial descritivo do perímetro
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { svgLayoutPA, type LoteDoMapa } from './mapaSvg';
import type { DesenhoLayout } from './layoutDesenho';
import type { MemorialLote } from './memorialVila';
import { grausDms, latLonDms, textoMemorialPerimetro, type Perimetro } from './perimetro';
import { textoMemorialParcela, type Subdivisao, type CamadaDesenho } from './parcelas';
import { alqueiresTxt, haAlq, haAlqCurto, haParaAlqueires } from './unidades';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fm = (v: number, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function asset(nome: string | null): string {
  if (!nome) return '';
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? `data:${nome.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${readFileSync(f).toString('base64')}` : '';
}

export interface DadosMapaPA {
  projeto: { nome: string; municipio: string; uf: string; associacao: string | null };
  rt: { nome: string; registro: string; cft?: string | null; incra?: string | null };
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

export function cabecalho(d: DadosMapaPA, titulo: string): string {
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
      <div class="q"><span>Área total dos lotes</span><b>${fm(areaLotes)} m²</b>${haAlq(areaLotes / 10000)}</div>
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
    <text x="${cx}" y="${cy}" font-size="${fs * 1.3}" font-weight="800" text-anchor="middle" fill="#0C3320">${fm(p.area_ha, 4)} ha</text><text x="${cx}" y="${cy + fs * 1.5}" font-size="${fs * 1.05}" font-weight="700" text-anchor="middle" fill="#0C3320">${alqueiresTxt(p.area_ha)}</text>
    <g transform="translate(${x0 + W - pad * 0.55},${y0 + pad * 0.6})"><polygon points="0,${-fs * 1.6} ${fs * 0.7},${fs * 0.6} 0,${fs * 0.2} ${-fs * 0.7},${fs * 0.6}" fill="#0C3320"/><text y="${-fs * 1.9}" font-size="${fs}" font-weight="800" text-anchor="middle" fill="#0C3320">N</text></g>
    <g><rect x="${sbx}" y="${sby}" width="${passo / 2}" height="${fs * 0.4}" fill="#0C3320"/><rect x="${sbx + passo / 2}" y="${sby}" width="${passo / 2}" height="${fs * 0.4}" fill="#fff" stroke="#0C3320" stroke-width="${sw * 0.6}"/>
      <text x="${sbx}" y="${sby - fs * 0.3}" font-size="${fs * 0.7}" fill="#0C3320">0</text><text x="${sbx + passo}" y="${sby - fs * 0.3}" font-size="${fs * 0.7}" text-anchor="end" fill="#0C3320">${passo >= 1000 ? fm(passo / 1000, 0) + ' km' : fm(passo, 0) + ' m'}</text></g>
  </svg>`;
}

export function htmlMapaGeral(d: DadosMapaPA, p: Perimetro, t: { imovel?: string; mapa?: string; memorial?: string } = {}): string {
  const bras = asset(d.marca.brasao);
  const paragrafos = textoMemorialPerimetro(p, t.imovel ?? d.projeto.nome, `${d.projeto.municipio}/${d.projeto.uf}`);
  const linhas = p.vertices.map((v, i) => { const s = p.segmentos[i]; return `<tr><td><b>${esc(v.nome)}</b></td><td class="n">${fm(v.E, 3)}</td><td class="n">${fm(v.N, 3)}</td><td class="n">${esc(latLonDms(v.lat, 'lat'))}</td><td class="n">${esc(latLonDms(v.lon, 'lon'))}</td><td>${esc(s.de)} → ${esc(s.para)}</td><td class="n">${esc(grausDms(s.azimute))}</td><td class="n">${fm(s.distancia)}</td></tr>`; }).join('');
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Mapa geral e memorial descritivo — ${esc(d.projeto.nome)}</title><style>${CSS}</style></head><body>
    ${cabecalho(d, t.mapa ?? 'MAPA GERAL DO PROJETO DE ASSENTAMENTO — PERÍMETRO')}
    <div class="mapa">${svgPerimetro(p, 'width:100%;height:200mm;display:block')}${bras ? `<img class="bras" src="${bras}">` : ''}</div>
    <div class="quadros"><div class="q"><span>Área</span><b>${fm(p.area_ha, 4)} ha</b>${alqueiresTxt(p.area_ha)} · ${fm(p.area_m2)} m²</div>
      <div class="q"><span>Perímetro</span><b>${fm(p.perimetro_m)} m</b>${p.vertices.length} vértices</div>
      <div class="q"><span>Referência</span><b>${esc(p.datum)}</b>UTM fuso ${p.fuso}${p.hemisferio === 'S' ? ' Sul' : ' Norte'} · origem ${esc(p.origem.formato)}</div></div>
    ${rodape(d)}
    <div class="quebra"></div>
    ${cabecalho(d, t.memorial ?? 'MEMORIAL DESCRITIVO DO PERÍMETRO')}
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

// ─── v3.151.0: subdivisão do PA em lotes — mapa geral e mapa + memorial por lote ─
const COR_CAMADA: Record<CamadaDesenho['tipo'], { fill: string; stroke: string }> = {
  APP: { fill: '#9FD08A', stroke: '#3E8E41' },
  COMUNITARIA: { fill: '#F1DFA4', stroke: '#A07A10' },
  AGUA: { fill: 'none', stroke: '#2B6CB0' },
  ESTRADA: { fill: 'none', stroke: '#8C5A2B' },
  OUTRA: { fill: 'none', stroke: '#999' },
};

/** SVG da subdivisão: todos os lotes, ou um lote em destaque (zoom nele, vértices nomeados). */
export function svgSubdivisao(sub: Subdivisao, opts: { destaque?: string | null; perimetro?: Perimetro | null; css?: string } = {}): string {
  const alvo = opts.destaque ? sub.parcelas.find((p) => p.lote === opts.destaque) ?? null : null;
  const todosPts = (alvo ? alvo.perimetro.vertices : sub.parcelas.flatMap((p) => p.perimetro.vertices)).map((v) => [v.E, v.N]);
  const Es = todosPts.map((p) => p[0]), Ns = todosPts.map((p) => p[1]);
  const minE = Math.min(...Es), maxE = Math.max(...Es), minN = Math.min(...Ns), maxN = Math.max(...Ns);
  const span = Math.max(maxE - minE, maxN - minN) || 1;
  const pad = span * (alvo ? 0.35 : 0.06);
  const x0 = minE - pad, y0 = -(maxN + pad), W = maxE - minE + pad * 2, H = maxN - minN + pad * 2;
  // só desenha o que aparece no recorte (PDF de 63 lotes não carrega o PA inteiro 63 vezes)
  const vis = (pts: number[][]) => pts.some(([e, n]) => e > x0 - pad && e < x0 + W + pad && -n > y0 - pad && -n < y0 + H + pad);
  const base = alvo ? span * 1.7 : span;
  const fs = base * 0.012, sw = base * 0.0012;
  const poly = (pts: number[][]) => pts.map(([e, n]) => `${e.toFixed(1)},${(-n).toFixed(1)}`).join(' ');
  const centro = (pts: number[][]) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, -pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const camadas = sub.camadas.filter((c) => vis(c.pts)).map((c) => {
    const k = COR_CAMADA[c.tipo];
    const larg = c.tipo === 'ESTRADA' ? sw * 2.4 : c.tipo === 'AGUA' ? sw * 1.2 : sw;
    const forma = c.fechada
      ? `<polygon points="${poly(c.pts)}" fill="${k.fill}" fill-opacity="${c.tipo === 'APP' ? 0.45 : 0.6}" stroke="${k.stroke}" stroke-width="${larg}"/>`
      : `<polyline points="${poly(c.pts)}" fill="none" stroke="${k.stroke}" stroke-width="${larg}"/>`;
    let rot = '';
    if (c.rotulo && c.tipo === 'COMUNITARIA') { const [cx, cy] = centro(c.pts); rot = `<text x="${cx}" y="${cy}" font-size="${fs * 0.75}" text-anchor="middle" fill="#6b4f08" font-weight="700">${esc(c.rotulo)}</text>`; }
    return forma + rot;
  }).join('');
  const lotes = sub.parcelas.filter((p) => vis(p.perimetro.vertices.map((v) => [v.E, v.N]))).map((p) => {
    const pts = p.perimetro.vertices.map((v) => [v.E, v.N]);
    const [cx, cy] = centro(pts);
    const eu = alvo !== null && p.lote === alvo.lote;
    return `<polygon points="${poly(pts)}" fill="${eu ? '#B7D99A' : alvo ? '#F4F1E6' : '#E4EED8'}" fill-opacity="${eu ? 0.75 : 0.55}" stroke="${eu ? '#0C3320' : '#55704A'}" stroke-width="${eu ? sw * 3 : sw}"/>`
      + `<text x="${cx}" y="${cy}" font-size="${eu ? fs * 1.6 : fs}" font-weight="800" text-anchor="middle" dominant-baseline="middle" fill="${eu ? '#0C3320' : '#3d5233'}">LT-${esc(p.lote)}</text>`
      + (eu ? `<text x="${cx}" y="${cy + fs * 1.8}" font-size="${fs * 0.95}" text-anchor="middle" fill="#0C3320">${haAlqCurto(p.perimetro.area_ha)}</text>` : '');
  }).join('');
  const per = opts.perimetro && !alvo ? `<polygon points="${poly(opts.perimetro.vertices.map((v) => [v.E, v.N]))}" fill="none" stroke="#0C3320" stroke-width="${sw * 3.5}"/>` : '';
  let vert = '';
  if (alvo) {
    const [cx, cy] = centro(alvo.perimetro.vertices.map((v) => [v.E, v.N]));
    vert = alvo.perimetro.vertices.map((v) => { const dx = v.E - cx, dy = -v.N - cy, L = Math.hypot(dx, dy) || 1; return `<circle cx="${v.E}" cy="${-v.N}" r="${sw * 3.2}" fill="#B3261E"/><text x="${v.E + (dx / L) * fs * 1.6}" y="${-v.N + (dy / L) * fs * 1.6}" font-size="${fs * 1.15}" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="#B3261E">${esc(v.nome)}</text>`; }).join('');
  }
  const alvoBarra = W / 5;
  const passo = [1, 2, 5].map((m) => m * 10 ** Math.floor(Math.log10(alvoBarra))).concat([10 ** Math.ceil(Math.log10(alvoBarra))]).reduce((a, b) => (Math.abs(b - alvoBarra) < Math.abs(a - alvoBarra) ? b : a));
  const sbx = x0 + W * 0.04, sby = y0 + H * 0.96;
  const fsg = fs * 0.8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${W} ${H}" style="${opts.css ?? 'width:100%;height:auto;display:block'}" font-family="Liberation Sans, Arial, sans-serif">
    <rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#FBFAF5"/>${lotes}${camadas}${per}${vert}
    <g transform="translate(${x0 + W * 0.95},${y0 + H * 0.07})"><polygon points="0,${-fsg * 1.6} ${fsg * 0.7},${fsg * 0.6} 0,${fsg * 0.2} ${-fsg * 0.7},${fsg * 0.6}" fill="#0C3320"/><text y="${-fsg * 1.9}" font-size="${fsg}" font-weight="800" text-anchor="middle" fill="#0C3320">N</text></g>
    <g><rect x="${sbx}" y="${sby}" width="${passo / 2}" height="${fsg * 0.4}" fill="#0C3320"/><rect x="${sbx + passo / 2}" y="${sby}" width="${passo / 2}" height="${fsg * 0.4}" fill="#fff" stroke="#0C3320" stroke-width="${sw * 0.6}"/>
      <text x="${sbx}" y="${sby - fsg * 0.3}" font-size="${fsg * 0.8}" fill="#0C3320">0</text><text x="${sbx + passo}" y="${sby - fsg * 0.3}" font-size="${fsg * 0.8}" text-anchor="end" fill="#0C3320">${passo >= 1000 ? fm(passo / 1000, 0) + ' km' : fm(passo, 0) + ' m'}</text></g>
  </svg>`;
}

const LEGENDA = `<div class="nota" style="font-style:normal">Legenda: <span style="color:#55704A">▭ lotes</span> · <span style="color:#3E8E41">■ APP</span> · <span style="color:#A07A10">■ áreas comunitárias</span> · <span style="color:#8C5A2B">━ estradas/servidão</span> · <span style="color:#2B6CB0">━ córregos</span></div>`;

/** PDF: mapa geral da subdivisão + quadro de áreas, e/ou mapa + memorial de cada lote. */
export interface BeneficiarioParcela { nome: string; cpf: string }
export function htmlSubdivisao(d: DadosMapaPA, sub: Subdivisao, opts: { lotes: string[]; geral: boolean; perimetro: Perimetro | null; beneficiarios?: Record<string, BeneficiarioParcela> }): string {
  const bras = asset(d.marca.brasao);
  const paginas: string[] = [];
  if (opts.geral) {
    const tot = sub.parcelas.reduce((s, p) => s + p.perimetro.area_ha, 0);
    paginas.push(`${cabecalho(d, 'MAPA GERAL DA SUBDIVISÃO EM LOTES')}
      <div class="mapa">${svgSubdivisao(sub, { perimetro: opts.perimetro, css: 'width:100%;height:205mm;display:block' })}${bras ? `<img class="bras" src="${bras}">` : ''}</div>
      ${LEGENDA}
      <div class="quadros"><div class="q"><span>Lotes</span><b>${sub.parcelas.length}</b>${sub.marcos} marcos</div>
        <div class="q"><span>Área total dos lotes</span><b>${fm(tot, 4)} ha</b>${alqueiresTxt(tot)}${opts.perimetro ? `<br>perímetro do PA: ${haAlq(opts.perimetro.area_ha)}` : ''}</div>
        <div class="q"><span>Referência</span><b>SIRGAS 2000</b>UTM fuso ${sub.fuso}${sub.hemisferio === 'S' ? ' Sul' : ' Norte'}</div></div>
      ${rodape(d)}`);
    paginas.push(`${cabecalho(d, 'QUADRO DE ÁREAS DOS LOTES')}
      <table><thead><tr><th>Lote</th><th class="n">Área total (ha)</th><th class="n">Área total (alq.)</th><th class="n">Área útil (ha)</th><th class="n">Área útil (alq.)</th><th class="n">Perímetro (m)</th><th class="n">Vértices</th><th>Beneficiário(a)</th><th>Confrontantes</th></tr></thead><tbody>
      ${sub.parcelas.map((p) => `<tr><td><b>LT-${esc(p.lote)}</b></td><td class="n">${fm(p.perimetro.area_ha, 4)}</td><td class="n">${fm(haParaAlqueires(p.perimetro.area_ha), 4)}</td><td class="n">${p.area_util_ha != null ? fm(p.area_util_ha, 4) : '—'}</td><td class="n">${p.area_util_ha != null ? fm(haParaAlqueires(p.area_util_ha), 4) : '—'}</td><td class="n">${fm(p.perimetro.perimetro_m)}</td><td class="n">${p.perimetro.vertices.length}</td><td class="conf">${esc(opts.beneficiarios?.[p.lote]?.nome ?? '—')}</td><td class="conf">${esc([...new Set(p.lados.map((l) => l.confrontante))].join('; '))}</td></tr>`).join('')}
      </tbody></table>${rodape(d)}`);
  }
  for (const lote of opts.lotes) {
    const pc = sub.parcelas.find((p) => p.lote === lote);
    if (!pc) continue;
    const p = pc.perimetro;
    const ben = opts.beneficiarios?.[pc.lote] ?? null;
    const paragrafos = textoMemorialParcela(pc, d.projeto.nome, `${d.projeto.municipio}/${d.projeto.uf}`, ben ? `${ben.nome}, CPF ${ben.cpf}` : null);
    paginas.push(`${cabecalho(d, `LOTE ${pc.lote} — MAPA E MEMORIAL DESCRITIVO`)}
      <div class="mapa">${svgSubdivisao(sub, { destaque: pc.lote, css: 'width:100%;height:112mm;display:block' })}</div>
      ${LEGENDA}
      <div class="quadros"><div class="q"><span>Área total (com APP e estradas)</span><b>${fm(p.area_ha, 4)} ha</b>${alqueiresTxt(p.area_ha)}<br>${pc.area_util_ha != null ? `área útil: <b style="display:inline;font-size:9pt">${haAlq(pc.area_util_ha)}</b>` : `${fm(p.area_m2)} m²`}</div>
        <div class="q"><span>Perímetro</span><b>${fm(p.perimetro_m)} m</b>${p.vertices.length} vértices</div>
        <div class="q"><span>Beneficiário(a)</span>${ben ? `<b style="font-size:9pt">${esc(ben.nome)}</b>CPF: ${esc(ben.cpf)}` : '<b style="font-size:9pt">______________________________</b>CPF: ____________________'}</div></div>
      <h2>Memorial descritivo</h2>${paragrafos.map((t) => `<p class="memo">${esc(t)}</p>`).join('')}
      ${rodape(d)}`);
    paginas.push(`${cabecalho(d, `LOTE ${pc.lote} — QUADRO DE COORDENADAS E CONFRONTAÇÕES`)}
      <table><thead><tr><th>Vértice</th><th>Tipo</th><th class="n">E (m)</th><th class="n">N (m)</th><th class="n">Latitude</th><th class="n">Longitude</th><th>Lado</th><th class="n">Azimute</th><th class="n">Dist. (m)</th><th>Confrontante</th></tr></thead><tbody>
      ${p.vertices.map((v, i) => { const s = pc.lados[i]; return `<tr><td><b>${esc(v.nome)}</b></td><td class="conf">${esc(pc.tipos_vertice[i] ?? '—')}</td><td class="n">${fm(v.E, 3)}</td><td class="n">${fm(v.N, 3)}</td><td class="n">${esc(latLonDms(v.lat, 'lat'))}</td><td class="n">${esc(latLonDms(v.lon, 'lon'))}</td><td>${esc(s.de)} → ${esc(s.para)}</td><td class="n">${esc(grausDms(s.azimute))}</td><td class="n">${fm(s.distancia)}</td><td class="conf">${esc(s.confrontante)}</td></tr>`; }).join('')}
      </tbody></table>
      <div class="ass"><div>${esc(d.rt.nome)}</div>${esc(d.rt.registro)}</div>
      ${rodape(d)}`);
  }
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Subdivisão em lotes — ${esc(d.projeto.nome)}</title><style>${CSS}</style></head><body>
    ${paginas.join('<div class="quebra"></div>')}
  </body></html>`;
}
