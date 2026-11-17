// v3.168.0 — Pontos para a coletora (locação/cravação dos marcos em campo).
// Junta os vértices dos lotes (subdivisão), do perímetro do PA e da vila, sem repetir
// ponto (vértice comum a vários lotes sai uma vez), e exporta em CSV, TXT (P,E,N,Z,D),
// DXF (pontos + nomes + contorno dos lotes) e a caderneta de campo em PDF (por lote,
// com caixa "cravado" para marcar em campo). Coordenadas UTM SIRGAS 2000.
import { PaErro } from './erros';
import { buscarProjeto } from './paRepo';
import { buscarSubdivisao, buscarPerimetro, buscarVila, vinculosParcelas, dadosCabecalho } from './paMapas';
import { cabecalho, pdfDeHtml } from './mapasPdf';
import { utmParaLonLat, type Vertice } from './perimetro';
import { pool, one, exec, registrarEvento } from './paDb';
import * as XLSX from 'xlsx';

/** existente = marco que já está no chão (perímetro do georreferenciamento): não compra nem crava. */
export interface PontoColetora { nome: string; E: number; N: number; h: number | null; lat: number; lon: number; tipo: string; lotes: string[]; origem: 'LOTE' | 'PERIMETRO' | 'VILA'; existente?: boolean; implantar_com?: string | null }
/** v3.169.0: marco oficial (planilha QUANTITATIVO-MARCOS-POR-LOTE). */
export interface MarcoOficial { codigo: string; E: number; N: number; tipo: string; implantar_com: string | null; lotes: string[]; comprar: boolean }

const loteNum = (t: string) => { const m = String(t).match(/(\d+)/); return m ? m[1].padStart(2, '0') : null; };
/** Lê a aba "Coordenadas dos Marcos" da planilha de quantitativo (pura — testável). */
export function marcosDePlanilha(buf: Buffer): MarcoOficial[] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const aba = wb.SheetNames.find((n) => /coordenad/i.test(n)) ?? wb.SheetNames.find((n) => /marco/i.test(n));
  if (!aba) throw new PaErro('PLANILHA_MARCOS', 'Aba "Coordenadas dos Marcos" não encontrada na planilha', 400);
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, defval: '' });
  const out: MarcoOficial[] = [];
  for (const r of linhas) {
    const c = String(r[0] ?? '').trim();
    if (!/^M-?\d+/i.test(c)) continue;
    const E = Number(String(r[1]).replace(',', '.')), N = Number(String(r[2]).replace(',', '.'));
    if (!Number.isFinite(E) || !Number.isFinite(N) || E < 100000 || N < 1000000) continue;
    out.push({ codigo: c.toUpperCase(), E, N, tipo: String(r[5] ?? '').trim() || 'Marco', implantar_com: loteNum(String(r[6] ?? '')),
      lotes: String(r[7] ?? '').split(/[,;/]/).map(loteNum).filter((x): x is string => !!x), comprar: !/^n/i.test(String(r[8] ?? '').trim()) });
  }
  if (!out.length) throw new PaErro('PLANILHA_MARCOS', 'Nenhum marco (M-001…) com coordenadas na planilha', 400);
  return out;
}

export async function buscarMarcos(projetoId: number): Promise<MarcoOficial[] | null> {
  const r = await one(pool, 'SELECT marcos_json FROM pa_projetos WHERE id = ?', [projetoId]).catch(() => null);
  const v = r?.marcos_json;
  return (typeof v === 'string' ? JSON.parse(v) : v) as MarcoOficial[] | null ?? null;
}
export async function salvarMarcos(projetoId: number, buf: Buffer, usuario: string | null) {
  const marcos = marcosDePlanilha(buf);
  await exec(pool, 'UPDATE pa_projetos SET marcos_json = ? WHERE id = ?', [JSON.stringify(marcos), projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'MARCOS_OFICIAIS', dados: { marcos: marcos.length, a_implantar: marcos.filter((m) => m.comprar).length } });
  return { marcos: marcos.length, a_implantar: marcos.filter((m) => m.comprar).length, existentes: marcos.filter((m) => !m.comprar).length };
}
export interface PontosColetora { pontos: PontoColetora[]; fuso: number; hemisferio: 'S' | 'N'; lotes: Array<{ lote: string; area_ha: number; vertices: string[] }> }

const chave = (E: number, N: number) => `${Math.round(E * 50)}:${Math.round(N * 50)}`; // 2 cm
const semNomeMarco = (n: string) => /^L\d+-P\d+$/.test(n);

/** Junta e deduplica os pontos (pura — testável). Nome de marco vence nome provisório (L01-P01). */
export function juntarPontos(fontes: Array<{ origem: PontoColetora['origem']; lote?: string; vertices: Vertice[]; tipos?: Array<string | null> }>): PontoColetora[] {
  const por = new Map<string, PontoColetora>();
  const lista: PontoColetora[] = [];
  for (const f of fontes) f.vertices.forEach((v, i) => {
    const k = chave(v.E, v.N);
    const ja = por.get(k);
    const tipo = f.tipos?.[i] || (f.origem === 'PERIMETRO' ? 'PERIMETRO' : f.origem === 'VILA' ? 'VILA' : 'VERTICE');
    if (ja) {
      if (f.lote && !ja.lotes.includes(f.lote)) ja.lotes.push(f.lote);
      if (semNomeMarco(ja.nome) && !semNomeMarco(v.nome)) { ja.nome = v.nome; ja.tipo = tipo; }
      return;
    }
    const p: PontoColetora = { nome: v.nome, E: v.E, N: v.N, h: v.h ?? null, lat: v.lat, lon: v.lon, tipo, lotes: f.lote ? [f.lote] : [], origem: f.origem };
    por.set(k, p); lista.push(p);
  });
  // nomes repetidos em pontos diferentes (raro) ganham sufixo para a coletora não sobrescrever
  const usados = new Map<string, number>();
  for (const p of lista) { const n = usados.get(p.nome) ?? 0; usados.set(p.nome, n + 1); if (n) p.nome = `${p.nome}_${n + 1}`; }
  return lista;
}

export async function pontosColetora(projetoId: number): Promise<PontosColetora> {
  const [sub, per, vila] = await Promise.all([buscarSubdivisao(projetoId), buscarPerimetro(projetoId), buscarVila(projetoId)]);
  if (!sub && !per && !vila) throw new PaErro('SEM_PONTOS', 'Envie primeiro o DXF dos lotes, o perímetro ou a vila', 404);
  const fontes: Parameters<typeof juntarPontos>[0] = [];
  for (const pc of sub?.parcelas ?? []) fontes.push({ origem: 'LOTE', lote: pc.lote, vertices: pc.perimetro.vertices, tipos: pc.tipos_vertice });
  if (per) fontes.push({ origem: 'PERIMETRO', vertices: per.vertices });
  if (vila) { fontes.push({ origem: 'VILA', vertices: vila.total.vertices }); if (vila.nucleo) fontes.push({ origem: 'VILA', vertices: vila.nucleo.vertices }); }
  const fuso = sub?.fuso ?? per?.fuso ?? vila?.total.fuso ?? 23, hem = sub?.hemisferio ?? per?.hemisferio ?? 'S';
  // v3.169.0: com a planilha oficial, os pontos são os marcos (M-001…) — vértice extra do desenho não é marco
  const marcos = await buscarMarcos(projetoId);
  if (marcos?.length) {
    const ll = utmParaLonLat(fuso, hem);
    const pm: PontoColetora[] = marcos.map((m) => { const [lon, lat] = ll(m.E, m.N); return { nome: m.codigo, E: m.E, N: m.N, h: null, lat, lon, tipo: m.tipo, lotes: m.lotes, origem: 'LOTE' as const, existente: !m.comprar, implantar_com: m.implantar_com }; });
    const vilaPts = juntarPontos(fontes.filter((f) => f.origem === 'VILA'));
    return {
      pontos: [...pm, ...vilaPts], fuso, hemisferio: hem,
      lotes: (sub?.parcelas ?? []).map((pc) => ({ lote: pc.lote, area_ha: pc.perimetro.area_ha, vertices: marcos.filter((m) => m.lotes.includes(pc.lote)).map((m) => m.codigo) })),
    };
  }
  const pontos = juntarPontos(fontes);
  const nomeDe = new Map(pontos.map((p) => [chave(p.E, p.N), p.nome]));
  return {
    pontos, fuso: sub?.fuso ?? per?.fuso ?? vila?.total.fuso ?? 23, hemisferio: sub?.hemisferio ?? per?.hemisferio ?? 'S',
    lotes: (sub?.parcelas ?? []).map((pc) => ({ lote: pc.lote, area_ha: pc.perimetro.area_ha, vertices: pc.perimetro.vertices.map((v) => nomeDe.get(chave(v.E, v.N)) ?? v.nome) })),
  };
}

const f3 = (v: number) => v.toFixed(3);
const cod = (p: PontoColetora) => (`${p.existente ? 'EXISTENTE ' : ''}${p.tipo}${p.lotes.length ? ` LT-${p.lotes.join('/')}` : ''}`).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

/** CSV com cabeçalho (Emlid Flow, CHC LandStar, Carlson, SurvCE…): Name,Easting,Northing,Elevation,Code. */
export const csvColetora = (d: PontosColetora) => ['Name,Easting,Northing,Elevation,Code', ...d.pontos.map((p) => [p.nome, f3(p.E), f3(p.N), f3(p.h ?? 0), cod(p)].join(','))].join('\r\n') + '\r\n';
/** TXT PENZD sem cabeçalho (padrão das coletoras): P,E,N,Z,D. */
export const txtColetora = (d: PontosColetora) => d.pontos.map((p) => [p.nome, f3(p.E), f3(p.N), f3(p.h ?? 0), cod(p)].join(',')).join('\r\n') + '\r\n';

/** DXF R12: POINT + nome de cada ponto (camada por tipo) e o contorno dos lotes como referência. */
export function dxfColetora(d: PontosColetora, contornos: Array<{ lote: string; pts: Array<[number, number]> }>): string {
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), String(v)); };
  const camada = (p: PontoColetora) => `PONTOS_${p.tipo.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const camadas = new Set<string>(['LOTES', 'LOTES_TEXTO', 'PONTOS_NOME', ...d.pontos.map(camada)]);
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 6); g(9, '$PDMODE'); g(70, 34); g(9, '$PDSIZE'); g(40, 2); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, camadas.size);
  for (const l of camadas) { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, l === 'LOTES' || l === 'LOTES_TEXTO' ? 3 : l === 'PONTOS_NOME' ? 7 : /PERIMETRO/.test(l) ? 1 : /VILA/.test(l) ? 6 : 2); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const c of contornos) {
    g(0, 'POLYLINE'); g(8, 'LOTES'); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, 1);
    for (const [x, y] of c.pts) { g(0, 'VERTEX'); g(8, 'LOTES'); g(10, x.toFixed(4)); g(20, y.toFixed(4)); g(30, 0); }
    g(0, 'SEQEND'); g(8, 'LOTES');
    const cx = c.pts.reduce((s, q) => s + q[0], 0) / c.pts.length, cy = c.pts.reduce((s, q) => s + q[1], 0) / c.pts.length;
    g(0, 'TEXT'); g(8, 'LOTES_TEXTO'); g(10, cx.toFixed(4)); g(20, cy.toFixed(4)); g(30, 0); g(40, 12); g(1, `LT-${c.lote}`);
  }
  for (const p of d.pontos) {
    g(0, 'POINT'); g(8, camada(p)); g(10, p.E.toFixed(4)); g(20, p.N.toFixed(4)); g(30, (p.h ?? 0).toFixed(4));
    g(0, 'TEXT'); g(8, 'PONTOS_NOME'); g(10, (p.E + 3).toFixed(4)); g(20, (p.N + 3).toFixed(4)); g(30, 0); g(40, 3); g(1, p.nome);
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const br = (v: number, c = 3) => v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
function gms(v: number, eixo: 'lat' | 'lon') {
  const s = v < 0 ? (eixo === 'lat' ? 'S' : 'W') : (eixo === 'lat' ? 'N' : 'E');
  const a = Math.abs(v), g = Math.floor(a), m = Math.floor((a - g) * 60), sec = ((a - g) * 60 - m) * 60;
  return `${g}°${String(m).padStart(2, '0')}'${sec.toFixed(3).padStart(6, '0')}" ${s}`;
}

/** Caderneta de campo (PDF): por lote, os pontos a locar com coordenadas e caixas para marcar em campo. */
export async function pdfCaderneta(projetoId: number): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const d = await pontosColetora(projetoId);
  const ben = await vinculosParcelas(projetoId).catch((e) => { console.warn('[pa-caderneta] vínculos lote→associado indisponíveis:', (e as Error).message); return {} as Awaited<ReturnType<typeof vinculosParcelas>>; });
  const cab = dadosCabecalho(p);
  const porNome = new Map(d.pontos.map((x) => [x.nome, x]));
  const linha = (x: PontoColetora) => `<tr><td><b>${esc(x.nome)}</b></td><td class="conf">${esc(x.tipo)}</td><td class="n">${br(x.E)}</td><td class="n">${br(x.N)}</td><td class="n">${esc(gms(x.lat, 'lat'))}</td><td class="n">${esc(gms(x.lon, 'lon'))}</td><td class="ck">${x.existente ? '<span style="font-size:7pt;color:#1f7a4d">já existe</span>' : '☐'}</td><td class="obs"></td></tr>`;
  const thead = '<thead><tr><th>Ponto</th><th>Tipo</th><th class="n">E (m)</th><th class="n">N (m)</th><th class="n">Latitude</th><th class="n">Longitude</th><th>Cravado</th><th style="width:34mm">Obs. de campo</th></tr></thead>';
  const blocos = d.lotes.map((l) => {
    const b = ben[l.lote];
    const vs = [...new Set(l.vertices)].map((n) => porNome.get(n)).filter(Boolean) as PontoColetora[];
    return `<div class="bl"><h2>LT-${esc(l.lote)} · ${br(l.area_ha, 4)} ha${b ? ` · ${esc(b.nome)}${b.denominacao ? ` · ${esc(b.denominacao)}` : ''} · vila ${esc(b.lote_vila)}` : ''}</h2>
      <table>${thead}<tbody>${vs.map(linha).join('')}</tbody></table></div>`;
  }).join('');
  const outros = d.pontos.filter((x) => !x.lotes.length);
  const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Caderneta de campo — ${esc(p.nome)}</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#1C1C18;font-size:8.4pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
    .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}.cab .lg img{height:11mm}.cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
    .cab h1{margin:0;font-size:13pt}.cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}.cab .t{flex:1}
    .info{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm;margin:3mm 0}.info div{border:1px solid #C9C2AE;border-radius:2mm;padding:1.5mm 2.5mm}.info span{display:block;color:#6A6656;font-size:6.8pt;text-transform:uppercase;font-weight:700}.info b{font-size:10pt;color:#0C3320}
    h2{color:#0C3320;font-size:10pt;margin:3mm 0 1.5mm;border-bottom:1.2px solid #C9A84C;padding-bottom:.8mm}
    table{width:100%;border-collapse:collapse}th{background:#0C3320;color:#fff;padding:1.2mm;text-align:left;font-size:7pt}td{border-bottom:1px solid #E5DFCD;padding:1.4mm 1.2mm}
    tr:nth-child(even) td{background:#FAF7EE}td.n,th.n{text-align:right;white-space:nowrap}.conf{color:#555;font-size:7pt}td.ck{text-align:center;font-size:12pt}td.obs{border-bottom:1px solid #999}
    .bl{page-break-inside:avoid}thead{display:table-header-group}tr{page-break-inside:avoid}
    .nota{font-size:7.4pt;color:#555;margin:2mm 0}
  </style></head><body>
    ${cabecalho(cab, 'CADERNETA DE CAMPO — LOCAÇÃO DOS MARCOS')}
    <div class="info"><div><span>Pontos a locar</span><b>${d.pontos.length}</b></div><div><span>Lotes</span><b>${d.lotes.length}</b></div><div><span>Sistema</span><b>SIRGAS 2000 · UTM ${d.fuso}${d.hemisferio}</b></div><div><span>Data / equipe</span><b>____/____/______</b></div></div>
    <div class="nota">Vértice comum a mais de um lote aparece em cada lote, mas é um ponto só (mesmo nome) — cravar uma vez. Altitude não informada no levantamento (DXF 2D). Arquivos para a coletora: CSV / TXT (P,E,N,Z,D) / DXF na aba Importar / Exportar.</div>
    ${blocos}
    ${outros.length ? `<div class="bl"><h2>Perímetro do PA e vila (pontos fora dos lotes)</h2><table>${thead}<tbody>${outros.map(linha).join('')}</tbody></table></div>` : ''}
    <div class="nota" style="margin-top:6mm">Responsável técnico: ${esc(cab.rt.nome)} · ${esc(cab.rt.registro)} — Romatec Consultoria Total · gerado em ${esc(cab.data)}</div>
  </body></html>`;
  return { pdf: await pdfDeHtml(html), nome: `CADERNETA-CAMPO-LOCACAO-${p.codigo}.pdf` };
}

export async function arquivoColetora(projetoId: number, formato: 'csv' | 'txt' | 'dxf'): Promise<{ conteudo: string; nome: string; tipo: string }> {
  const p = await buscarProjeto(projetoId);
  const d = await pontosColetora(projetoId);
  const base = `PONTOS-COLETORA-${p.codigo}-SIRGAS2000-UTM${d.fuso}${d.hemisferio}`;
  if (formato === 'csv') return { conteudo: csvColetora(d), nome: `${base}.csv`, tipo: 'text/csv; charset=utf-8' };
  if (formato === 'txt') return { conteudo: txtColetora(d), nome: `${base}.txt`, tipo: 'text/plain; charset=utf-8' };
  const sub = await buscarSubdivisao(projetoId);
  const contornos = (sub?.parcelas ?? []).map((pc) => ({ lote: pc.lote, pts: pc.perimetro.vertices.map((v) => [v.E, v.N] as [number, number]) }));
  return { conteudo: dxfColetora(d, contornos), nome: `${base}.dxf`, tipo: 'application/dxf' };
}
