// v3.154.0 — Planta e memorial descritivo no MODELO SIGEF (mesmo layout dos
// documentos gerados pelo SIGEF/INCRA), com a identidade da Romatec e o brasão
// da associação no lugar dos brasões oficiais. Azimutes e distâncias geodésicos
// (Vincenty/GRS80) e área no Sistema Geodésico Local, como o SIGEF.
// Documento técnico NÃO certificado — o rodapé deixa isso explícito.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Perimetro } from './perimetro';
import { inversoGeodesico, areaGeodesicaLocal, dmsSigef, azimuteSigef } from './geodesia';
import type { DadosMapaPA } from './mapasPdf';
import { alqueiresTxt } from './unidades';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fm = (v: number, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function asset(nome: string | null): string {
  if (!nome) return '';
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? `data:${nome.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${readFileSync(f).toString('base64')}` : '';
}

export interface PecaSigef {
  denominacao: string;                 // ex.: "Lote 03 — Projeto de Assentamento Salete Moreno"
  titular: { nome: string; cpf: string } | null;
  natureza: string;                    // ex.: "Projeto de Assentamento"
  perimetro: Perimetro;
  confrontantes: string[] | null;      // um por lado (vértice i → i+1)
  mapaSvg: string;                     // desenho da peça
}

/** Valores no padrão SIGEF: azimute/distância geodésicos por lado, área local e perímetro geodésico. */
export function calculoSigef(p: Perimetro) {
  const v = p.vertices;
  const lados = v.map((a, i) => { const b = v[(i + 1) % v.length]; return inversoGeodesico(a.lat, a.lon, b.lat, b.lon); });
  return { lados, area_ha: areaGeodesicaLocal(v) / 1e4, perimetro_m: lados.reduce((s, l) => s + l.distancia, 0) };
}

const CSS = `
  @page { size: A4; margin: 9mm; }
  @page paisagem { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: 'Liberation Sans', Arial, sans-serif; color: #111; font-size: 8pt; }
  .pg { page-break-after: always; } .pg:last-child { page-break-after: auto; }
  .land { page: paisagem; }
  .topo { display: grid; grid-template-columns: 34mm 1fr 30mm; align-items: center; gap: 3mm; border-bottom: .5mm solid #0C3320; padding-bottom: 2mm; }
  .topo img.lg { height: 15mm; width: auto; justify-self: start; }
  .topo img.br { height: 20mm; width: auto; justify-self: end; }
  .topo .c { text-align: center; line-height: 1.35; }
  .topo .c b { display: block; font-size: 10pt; letter-spacing: .3pt; }
  .topo .c span { display: block; font-size: 8.5pt; }
  .tit { text-align: center; font-weight: 700; font-size: 11pt; margin: 2.2mm 0 1.6mm; letter-spacing: .4pt; }
  .id { display: grid; grid-template-columns: 1fr 1fr; border: .3mm solid #555; }
  .id div { padding: .9mm 1.6mm; border-bottom: .2mm solid #bbb; font-size: 7.8pt; }
  .id div:nth-child(odd) { border-right: .2mm solid #bbb; }
  .id b { font-weight: 700; }
  .id .full { grid-column: 1 / -1; border-right: 0; }
  .mapa { border: .3mm solid #555; margin-top: 2mm; position: relative; background: #fff; }
  .cert { border: .3mm solid #555; margin-top: 2mm; padding: 1.6mm 2mm; font-size: 7.4pt; line-height: 1.4; }
  .cert b { font-size: 8pt; }
  .rod { margin-top: 1.6mm; font-size: 6.8pt; color: #333; display: flex; justify-content: space-between; gap: 4mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 2mm; font-size: 7.4pt; }
  th, td { border: .2mm solid #777; padding: .9mm 1.1mm; }
  th { background: #E9E6DC; font-weight: 700; text-align: center; }
  td.n { text-align: right; white-space: nowrap; } td.c { text-align: center; white-space: nowrap; }
  td.conf { font-size: 6.9pt; }
`;

function topo(d: DadosMapaPA): string {
  const logo = (() => { const f = [path.resolve(__dirname, '../../public/brand/pa/logo_romatec.jpg'), path.resolve(process.cwd(), 'src/public/brand/pa/logo_romatec.jpg'), path.resolve(process.cwd(), 'dist/public/brand/pa/logo_romatec.jpg')].find((c) => existsSync(c)); return f ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : ''; })();
  const bras = asset(d.marca.brasao);
  return `<div class="topo">${logo ? `<img class="lg" src="${logo}">` : '<span></span>'}<div class="c"><b>ROMATEC CONSULTORIA TOTAL</b><span>ENGENHARIA E AGRIMENSURA</span><span>${esc((d.projeto.associacao || d.projeto.nome).toUpperCase())}</span></div>${bras ? `<img class="br" src="${bras}">` : '<span></span>'}</div>`;
}

function blocoId(d: DadosMapaPA, pc: PecaSigef, c: ReturnType<typeof calculoSigef>, extra: string[] = []): string {
  const rt = d.rt;
  const it = (k: string, v: string, full = false) => `<div${full ? ' class="full"' : ''}><b>${esc(k)}:</b> ${v}</div>`;
  return `<div class="id">
    ${it('Denominação', esc(pc.denominacao), true)}
    ${it('Beneficiário(a)', pc.titular ? esc(pc.titular.nome) : '______________________________')}${it('CPF', pc.titular ? esc(pc.titular.cpf) : '____________________')}
    ${it('Natureza da Área', esc(pc.natureza))}${it('Município/UF', `${esc(d.projeto.municipio)}-${esc(d.projeto.uf)}`)}
    ${it('Responsável Técnico(a)', esc(rt.nome.toUpperCase()))}${it('Formação', 'Técnico(a) em Agrimensura')}
    ${it('Conselho Profissional', esc(rt.cft ? `${rt.cft}/${d.projeto.uf}` : '—'))}${it('Cód. Credenciado(a) INCRA', esc(rt.incra || '—'))}
    ${it('Documento de RT', 'TRT nº ____________________')}${it('Sistema Geodésico', 'SIRGAS 2000')}
    ${it('Área (Sistema Geodésico Local)', `<b>${fm(c.area_ha, 4)} ha</b> (${alqueiresTxt(c.area_ha)})`)}${it('Perímetro', `<b>${fm(c.perimetro_m)} m</b>`)}
    ${extra.join('')}
  </div>`;
}

const NAO_CERT = 'Documento técnico elaborado pela Romatec Consultoria Total com base no levantamento do Responsável Técnico. <b>NÃO certificado no SIGEF</b> — a certificação depende da regularização do Projeto de Assentamento pelo INCRA.';

/** Planta no modelo SIGEF (A4 retrato). */
export function plantaSigef(d: DadosMapaPA, pc: PecaSigef): string {
  const c = calculoSigef(pc.perimetro);
  return `<section class="pg">${topo(d)}<div class="tit">PLANTA</div>
    ${blocoId(d, pc, c, [`<div><b>Sistema de Coordenadas:</b> UTM fuso ${pc.perimetro.fuso}${pc.perimetro.hemisferio === 'S' ? ' Sul' : ' Norte'} · Lat./Long.</div>`, `<div><b>Formato:</b> A4 · ${pc.perimetro.vertices.length} vértices</div>`])}
    <div class="mapa">${pc.mapaSvg}</div>
    <div class="cert"><b>SITUAÇÃO:</b> ${NAO_CERT}<br>Data da geração: ${esc(d.data)}</div>
    <div class="rod"><span>${esc(d.rt.nome)} · ${esc(d.rt.registro)}</span><span>Romatec Consultoria Total · Açailândia/MA</span></div>
  </section>`;
}

/** Memorial descritivo no modelo SIGEF (A4 paisagem, tabela de vértices e segmentos vante). */
export function memorialSigef(d: DadosMapaPA, pc: PecaSigef): string {
  const c = calculoSigef(pc.perimetro);
  const v = pc.perimetro.vertices;
  const linhas = v.map((a, i) => {
    const b = v[(i + 1) % v.length], l = c.lados[i];
    return `<tr><td class="c"><b>${esc(a.nome)}</b></td><td class="n">${dmsSigef(a.lon)}</td><td class="n">${dmsSigef(a.lat)}</td><td class="c">${a.h != null ? fm(a.h, 2) : '—'}</td>
      <td class="c">${esc(b.nome)}</td><td class="c">${azimuteSigef(l.azimute)}</td><td class="n">${fm(l.distancia, 2)}</td><td class="conf">${esc(pc.confrontantes?.[i] ?? '—')}</td></tr>`;
  });
  const POR_PAG = 16;
  const paginas = Math.max(1, Math.ceil(linhas.length / POR_PAG));
  const out: string[] = [];
  for (let k = 0; k < paginas; k++) {
    out.push(`<section class="pg land">${topo(d)}<div class="tit">MEMORIAL DESCRITIVO</div>
      ${k === 0 ? blocoId(d, pc, c, ['<div><b>Coordenadas:</b> latitude e longitude geodésicas</div>', '<div><b>Azimutes:</b> azimutes geodésicos</div>']) : ''}
      <div class="tit" style="font-size:9pt;margin:2mm 0 0">DESCRIÇÃO DA PARCELA</div>
      <table><thead><tr><th colspan="4">VÉRTICE</th><th colspan="3">SEGMENTO VANTE</th><th rowspan="2">Confrontações</th></tr>
        <tr><th>Código</th><th>Longitude</th><th>Latitude</th><th>Altitude (m)</th><th>Código</th><th>Azimute</th><th>Dist. (m)</th></tr></thead>
        <tbody>${linhas.slice(k * POR_PAG, (k + 1) * POR_PAG).join('')}</tbody></table>
      ${k === paginas - 1 ? `<div class="cert">${NAO_CERT}<br>Coordenadas referidas ao Sistema Geodésico Brasileiro (SIRGAS 2000). Azimutes e distâncias geodésicos (elipsoide GRS80); área calculada no Sistema Geodésico Local.${v.every((x) => x.h == null) ? ' Altitudes não informadas no arquivo de origem.' : ''}</div>
        <div style="margin-top:10mm;text-align:center;font-size:8pt"><div style="border-top:.3mm solid #333;width:80mm;margin:0 auto 1mm"></div>${esc(d.rt.nome)}<br>${esc(d.rt.registro)}</div>` : ''}
      <div class="rod"><span>Este memorial foi gerado pelo sistema da Romatec com base nas informações do Responsável Técnico.</span><span>Página ${k + 1}/${paginas}</span></div>
    </section>`);
  }
  return out.join('');
}

export function documentoSigef(titulo: string, secoes: string[]): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>${secoes.join('')}</body></html>`;
}

/** PDF do modelo SIGEF: respeita o tamanho de cada página definido no CSS (planta retrato, memorial paisagem). */
export async function pdfSigef(html: string): Promise<Buffer> {
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  return htmlToPdf(html, { printBackground: true, preferCSSPageSize: true });
}
