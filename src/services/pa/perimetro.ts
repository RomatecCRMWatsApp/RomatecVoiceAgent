// v3.146.0 — Perímetro geral do PA (mapa geral + memorial descritivo).
//
// Entrada: TXT/CSV com coordenadas UTM (E, N[, h]) SIRGAS 2000 ou geográficas
// (lat, lon em graus decimais), com ou sem nome do vértice; ou DXF com
// polilinha fechada (LWPOLYLINE/POLYLINE, coordenadas UTM). Funções puras.
import proj4 from 'proj4';
import { PaErro } from './erros';

export interface Vertice { nome: string; E: number; N: number; h: number | null; lat: number; lon: number }
export interface Segmento { de: string; para: string; azimute: number; distancia: number }
export interface Perimetro {
  vertices: Vertice[];
  fuso: number;
  hemisferio: 'S' | 'N';
  datum: 'SIRGAS 2000';
  area_m2: number;
  area_ha: number;
  perimetro_m: number;
  segmentos: Segmento[];
  origem: { formato: 'TXT' | 'CSV' | 'DXF'; arquivo: string | null; sistema_entrada: 'UTM' | 'GEOGRAFICA' };
  atualizado_em: string | null;
}

const defUtm = (fuso: number, hem: 'S' | 'N') => `+proj=utm +zone=${fuso}${hem === 'S' ? ' +south' : ''} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
const GEO = '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs';

export function fusoDaLongitude(lon: number): number {
  return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
}

function numero(t: string): number | null {
  const s = t.trim();
  if (!s) return null;
  // 9.452.123,45 (pt-BR) | 9452123,45 | 9452123.45
  let n = s;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(n)) n = n.replace(',', '.');
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

interface PontoBruto { nome: string | null; a: number; b: number; c: number | null }

/** Lê TXT/CSV: separador ; tab , ou espaço; cabeçalho opcional. */
export function lerTextoCoordenadas(texto: string): { pontos: PontoBruto[]; colunas: { ordem: 'EN' | 'NE' | 'LATLON' | 'LONLAT' | 'AUTO' } } {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#|^\/\//.test(l));
  if (!linhas.length) throw new PaErro('PERIMETRO_VAZIO', 'Arquivo sem coordenadas', 400);
  const sep = (l: string) => (l.includes(';') ? ';' : l.includes('\t') ? '\t' : /,\s*-?\d/.test(l) && !/\d,\d/.test(l.split(/[;\t]/)[0]) ? ',' : null);
  const quebrar = (l: string) => { const s = sep(l); return (s ? l.split(s) : l.split(/\s+/)).map((x) => x.trim()).filter((x, i, arr) => x !== '' || i < arr.length - 1); };
  let ordem: 'EN' | 'NE' | 'LATLON' | 'LONLAT' | 'AUTO' = 'AUTO';
  let idx = { nome: -1, a: -1, b: -1, c: -1 };
  const cab = quebrar(linhas[0]).map((x) => x.toLowerCase().replace(/[^a-z]/g, ''));
  const temCab = cab.some((x) => /^(e|n|x|y|este|norte|leste|easting|northing|lat|latitude|lon|long|longitude|lng|nome|ponto|vertice|id|h|alt|altitude|cota|z)$/.test(x));
  if (temCab) {
    const achar = (re: RegExp) => cab.findIndex((x) => re.test(x));
    const iLat = achar(/^(lat|latitude)$/), iLon = achar(/^(lon|long|longitude|lng)$/);
    const iE = achar(/^(e|x|este|leste|easting)$/), iN = achar(/^(n|y|norte|northing)$/);
    idx.nome = achar(/^(nome|ponto|vertice|id|codigo|cod)$/);
    idx.c = achar(/^(h|alt|altitude|cota|z|elev)$/);
    if (iLat >= 0 && iLon >= 0) { idx.a = iLat; idx.b = iLon; ordem = 'LATLON'; }
    else if (iE >= 0 && iN >= 0) { idx.a = iE; idx.b = iN; ordem = 'EN'; }
    else throw new PaErro('PERIMETRO_COLUNAS', 'Cabeçalho sem colunas E/N ou lat/lon reconhecíveis', 400);
  }
  const pontos: PontoBruto[] = [];
  for (const l of linhas.slice(temCab ? 1 : 0)) {
    const t = quebrar(l);
    if (temCab) {
      const a = numero(t[idx.a] ?? ''), b = numero(t[idx.b] ?? '');
      if (a == null || b == null) continue;
      pontos.push({ nome: idx.nome >= 0 ? (t[idx.nome] || null) : null, a, b, c: idx.c >= 0 ? numero(t[idx.c] ?? '') : null });
    } else {
      const nums = t.map(numero);
      const primeiroTexto = nums[0] == null ? t[0] : null;
      const vals = nums.filter((v): v is number => v != null);
      if (vals.length < 2) continue;
      pontos.push({ nome: primeiroTexto || null, a: vals[0], b: vals[1], c: vals.length >= 3 ? vals[2] : null });
    }
  }
  if (pontos.length < 3) throw new PaErro('PERIMETRO_POUCOS', 'O perímetro precisa de pelo menos 3 vértices', 400);
  return { pontos, colunas: { ordem } };
}

/** Decide se os pares são UTM ou geográficos e em que ordem. */
export function interpretarPontos(pontos: PontoBruto[], ordem: 'EN' | 'NE' | 'LATLON' | 'LONLAT' | 'AUTO'): { sistema: 'UTM' | 'GEOGRAFICA'; pares: Array<{ x: number; y: number }> } {
  const geo = pontos.every((p) => Math.abs(p.a) <= 180 && Math.abs(p.b) <= 180);
  if (ordem === 'LATLON' || ordem === 'LONLAT' || (ordem === 'AUTO' && geo)) {
    // Brasil: latitude entre -34 e +6; longitude entre -74 e -28.
    const latPrimeiro = ordem === 'LATLON' || (ordem === 'AUTO' && pontos.every((p) => p.a >= -35 && p.a <= 7 && p.b <= -28 && p.b >= -75));
    return { sistema: 'GEOGRAFICA', pares: pontos.map((p) => (latPrimeiro ? { x: p.b, y: p.a } : { x: p.a, y: p.b })) };
  }
  // UTM: E entre 100 km e 900 km; N até 10.000 km. Se veio N,E troca.
  const enOk = pontos.every((p) => p.a > 100_000 && p.a < 900_000 && p.b > 0 && p.b < 10_000_000);
  const neOk = pontos.every((p) => p.b > 100_000 && p.b < 900_000 && p.a > 0 && p.a < 10_000_000);
  if (!enOk && !neOk) throw new PaErro('PERIMETRO_SISTEMA', 'Coordenadas não reconhecidas como UTM (E, N) nem geográficas (lat, lon)', 400);
  const usarNE = !enOk && neOk;
  return { sistema: 'UTM', pares: pontos.map((p) => (usarNE ? { x: p.b, y: p.a } : { x: p.a, y: p.b })) };
}

/** DXF mínimo: polilinhas fechadas (LWPOLYLINE e POLYLINE/VERTEX). Devolve a de maior área. */
export function lerDxfPerimetro(dxf: string): Array<{ x: number; y: number }> {
  const l = dxf.split(/\r?\n/);
  const pares: Array<[number, string]> = [];
  for (let i = 0; i + 1 < l.length; i += 2) pares.push([Number(l[i].trim()), l[i + 1].trim()]);
  const polis: Array<Array<{ x: number; y: number }>> = [];
  for (let i = 0; i < pares.length; i++) {
    const [cod, val] = pares[i];
    if (cod === 0 && val === 'LWPOLYLINE') {
      const pts: Array<{ x: number; y: number }> = [];
      let x: number | null = null;
      for (i++; i < pares.length && pares[i][0] !== 0; i++) {
        const [c, v] = pares[i];
        if (c === 10) x = Number(v);
        else if (c === 20 && x != null) { pts.push({ x, y: Number(v) }); x = null; }
      }
      i--;
      if (pts.length >= 3) polis.push(pts);
    } else if (cod === 0 && val === 'POLYLINE') {
      const pts: Array<{ x: number; y: number }> = [];
      for (i++; i < pares.length && !(pares[i][0] === 0 && pares[i][1] === 'SEQEND'); i++) {
        if (pares[i][0] === 0 && pares[i][1] === 'VERTEX') {
          let x: number | null = null, y: number | null = null;
          for (i++; i < pares.length && pares[i][0] !== 0; i++) {
            if (pares[i][0] === 10) x = Number(pares[i][1]);
            if (pares[i][0] === 20) y = Number(pares[i][1]);
          }
          i--;
          if (x != null && y != null) pts.push({ x, y });
        }
      }
      if (pts.length >= 3) polis.push(pts);
    }
  }
  if (!polis.length) throw new PaErro('PERIMETRO_DXF', 'Nenhuma polilinha com 3+ vértices encontrada no DXF', 400);
  polis.sort((a, b) => Math.abs(areaPlana(b)) - Math.abs(areaPlana(a)));
  return polis[0];
}

export function areaPlana(p: Array<{ x: number; y: number }>): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

/** Azimute plano (grade UTM) de A→B em graus, a partir do Norte, sentido horário. */
export function azimute(a: { E: number; N: number }, b: { E: number; N: number }): number {
  const az = (Math.atan2(b.E - a.E, b.N - a.N) * 180) / Math.PI;
  return (az + 360) % 360;
}

export function grausDms(g: number): string {
  const t = Math.round(g * 3600);
  const d = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
}

export function latLonDms(v: number, eixo: 'lat' | 'lon'): string {
  const hemi = eixo === 'lat' ? (v < 0 ? 'S' : 'N') : v < 0 ? 'W' : 'E';
  const a = Math.abs(v);
  const d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(3).padStart(6, '0')}" ${hemi}`;
}

/** Monta o perímetro completo (UTM + geográficas, área, segmentos). */
export function montarPerimetro(
  entrada: { sistema: 'UTM' | 'GEOGRAFICA'; pares: Array<{ x: number; y: number }>; nomes?: Array<string | null>; alturas?: Array<number | null> },
  opts: { fuso?: number | null; hemisferio?: 'S' | 'N'; formato: Perimetro['origem']['formato']; arquivo: string | null },
): Perimetro {
  let pares = entrada.pares.slice();
  // Último vértice repetindo o primeiro (polígono "fechado" no arquivo) → remove.
  const f = pares[0], u = pares[pares.length - 1];
  if (pares.length > 3 && Math.abs(f.x - u.x) < 1e-6 && Math.abs(f.y - u.y) < 1e-6) pares = pares.slice(0, -1);
  if (pares.length < 3) throw new PaErro('PERIMETRO_POUCOS', 'O perímetro precisa de pelo menos 3 vértices', 400);
  const hem = opts.hemisferio ?? 'S';
  let fuso = opts.fuso ?? null;
  let utm: Array<{ E: number; N: number }>;
  let geo: Array<{ lat: number; lon: number }>;
  if (entrada.sistema === 'GEOGRAFICA') {
    fuso = fuso ?? fusoDaLongitude(pares.reduce((s, p) => s + p.x, 0) / pares.length);
    const conv = proj4(GEO, defUtm(fuso, hem));
    utm = pares.map((p) => { const [E, N] = conv.forward([p.x, p.y]); return { E, N }; });
    geo = pares.map((p) => ({ lat: p.y, lon: p.x }));
  } else {
    fuso = fuso ?? 23; // Açailândia/MA: fuso 23 Sul
    const conv = proj4(defUtm(fuso, hem), GEO);
    utm = pares.map((p) => ({ E: p.x, N: p.y }));
    geo = pares.map((p) => { const [lon, lat] = conv.forward([p.x, p.y]); return { lat, lon }; });
  }
  // Sentido horário (padrão de memorial): se o polígono veio anti-horário, inverte.
  let ordem = utm.map((_, i) => i);
  if (areaPlana(utm.map((p) => ({ x: p.E, y: p.N }))) > 0) ordem = ordem.reverse();
  const vertices: Vertice[] = ordem.map((i, k) => ({
    nome: (entrada.nomes?.[i] || `V${String(k + 1).padStart(2, '0')}`).slice(0, 20),
    E: utm[i].E, N: utm[i].N, h: entrada.alturas?.[i] ?? null, lat: geo[i].lat, lon: geo[i].lon,
  }));
  const segmentos: Segmento[] = vertices.map((v, i) => {
    const w = vertices[(i + 1) % vertices.length];
    return { de: v.nome, para: w.nome, azimute: azimute(v, w), distancia: Math.hypot(w.E - v.E, w.N - v.N) };
  });
  const area = Math.abs(areaPlana(vertices.map((p) => ({ x: p.E, y: p.N }))));
  return {
    vertices, fuso, hemisferio: hem, datum: 'SIRGAS 2000',
    area_m2: Math.round(area * 100) / 100, area_ha: Math.round(area / 100) / 100,
    perimetro_m: Math.round(segmentos.reduce((s, x) => s + x.distancia, 0) * 100) / 100,
    segmentos, origem: { formato: opts.formato, arquivo: opts.arquivo, sistema_entrada: entrada.sistema }, atualizado_em: null,
  };
}

/** Lê um arquivo (TXT/CSV/DXF) e devolve o perímetro calculado. */
export function perimetroDeArquivo(nome: string, conteudo: string, opts: { fuso?: number | null; hemisferio?: 'S' | 'N' } = {}): Perimetro {
  const ext = (nome.split('.').pop() || '').toLowerCase();
  if (ext === 'dxf' || /^\s*0\s*\r?\n\s*SECTION/i.test(conteudo)) {
    const pts = lerDxfPerimetro(conteudo);
    return montarPerimetro({ sistema: 'UTM', pares: pts }, { ...opts, formato: 'DXF', arquivo: nome });
  }
  const { pontos, colunas } = lerTextoCoordenadas(conteudo);
  const { sistema, pares } = interpretarPontos(pontos, colunas.ordem);
  return montarPerimetro({ sistema, pares, nomes: pontos.map((p) => p.nome), alturas: pontos.map((p) => p.c) }, { ...opts, formato: ext === 'csv' ? 'CSV' : 'TXT', arquivo: nome });
}

const m2br = (v: number, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Texto do memorial descritivo do perímetro (padrão de agrimensura). */
export function textoMemorialPerimetro(p: Perimetro, nomeImovel: string, municipio: string): string[] {
  const v = p.vertices;
  const par: string[] = [];
  par.push(`Imóvel: ${nomeImovel} — ${municipio}. Área: ${m2br(p.area_ha, 4)} ha (${m2br(p.area_m2)} m²). Perímetro: ${m2br(p.perimetro_m)} m. Sistema de referência: ${p.datum}, projeção UTM, fuso ${p.fuso}${p.hemisferio === 'S' ? ' Sul' : ' Norte'}.`);
  const trechos = p.segmentos.map((s, i) => {
    const w = v[(i + 1) % v.length];
    return `deste segue com azimute de ${grausDms(s.azimute)} e distância de ${m2br(s.distancia)} m até o vértice ${s.para}, de coordenadas N ${m2br(w.N, 3)} m e E ${m2br(w.E, 3)} m`;
  });
  par.push(`Inicia-se a descrição deste perímetro no vértice ${v[0].nome}, de coordenadas N ${m2br(v[0].N, 3)} m e E ${m2br(v[0].E, 3)} m; ${trechos.join('; ')}, ponto inicial da descrição deste perímetro.`);
  par.push('Todas as coordenadas aqui descritas estão georreferenciadas ao Sistema Geodésico Brasileiro, referenciadas ao datum SIRGAS 2000, e encontram-se representadas no sistema UTM. Os azimutes e distâncias, área e perímetro foram calculados no plano de projeção UTM.');
  return par;
}
