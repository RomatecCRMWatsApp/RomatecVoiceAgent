// v1.99.26 — Calculos geodesicos pro modulo Laudo de Demarcacao.
// - Conversao UTM ↔ Geografica (proj4, SIRGAS 2000 default)
// - Area por Gauss/Shoelace sobre coordenadas UTM (planas)
// - Distancia e azimute entre pontos (geometria plana sobre UTM)
// - GMS formatter (graus-minutos-segundos)
//
// LIMITACAO: Brasil cobre zonas UTM 18 a 25 (hemisferio S). Default e 23S
// (Acailandia/MA). Pra outras zonas, passar utm_zona/hemisferio explicito.

import proj4 from 'proj4';

// SIRGAS 2000 / UTM (Brasil) — define zonas comuns
// Acailandia/MA = zona 23S
const PROJ_WGS84 = '+proj=longlat +datum=WGS84 +no_defs';
function projUTM(zona: number, hemisferio: 'N' | 'S'): string {
  // SIRGAS 2000 com proj UTM. Pra simplicidade usamos WGS84 (conversao
  // pra metros bate ~ centimetro com SIRGAS pro Brasil).
  return `+proj=utm +zone=${zona} ${hemisferio === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
}

export interface UtmCoord { e: number; n: number; zona: number; hemisferio: 'N' | 'S' }
export interface GeoCoord { lat: number; lng: number }

/** UTM → Geografica (graus decimais WGS84) */
export function utmParaGeo(input: UtmCoord): GeoCoord {
  const [lng, lat] = proj4(projUTM(input.zona, input.hemisferio), PROJ_WGS84, [input.e, input.n]);
  return { lat, lng };
}

/** Geografica → UTM (zona/hemisferio explicitos) */
export function geoParaUtm(input: GeoCoord & { zona: number; hemisferio: 'N' | 'S' }): UtmCoord {
  const [e, n] = proj4(PROJ_WGS84, projUTM(input.zona, input.hemisferio), [input.lng, input.lat]);
  return { e, n, zona: input.zona, hemisferio: input.hemisferio };
}

/** Auto-detecta zona UTM a partir de longitude. Hemisferio S pro Brasil. */
export function detectarZonaUtm(lng: number): number {
  return Math.floor((lng + 180) / 6) + 1;
}

/** Decimal → GMS (graus, minutos, segundos). Ex: 5.3375 → "5°20'15.0\"" */
export function decimalParaGMS(decimal: number, ehLatitude = false): string {
  const sufixo = ehLatitude
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'W');
  const abs = Math.abs(decimal);
  const graus = Math.floor(abs);
  const minDec = (abs - graus) * 60;
  const minutos = Math.floor(minDec);
  const segundos = (minDec - minutos) * 60;
  return `${graus}°${String(minutos).padStart(2, '0')}'${segundos.toFixed(3)}"${sufixo}`;
}

/** Distancia plana entre 2 pontos UTM (mesma zona). Sqrt((dE)² + (dN)²) */
export function distanciaPlana(p1: { e: number; n: number }, p2: { e: number; n: number }): number {
  const de = p2.e - p1.e;
  const dn = p2.n - p1.n;
  return Math.sqrt(de * de + dn * dn);
}

/**
 * Azimute geodesico (atan2) — sentido horario a partir do norte.
 * Range: [0°, 360°). UTM-based (planar).
 */
export function azimute(p1: { e: number; n: number }, p2: { e: number; n: number }): number {
  const de = p2.e - p1.e;
  const dn = p2.n - p1.n;
  let az = Math.atan2(de, dn) * (180 / Math.PI);
  if (az < 0) az += 360;
  return az;
}

/** Azimute decimal → DMS string. Ex: 87.4321° → "87°25'56\"" */
export function azimuteParaDMS(decimal: number): string {
  const graus = Math.floor(decimal);
  const minDec = (decimal - graus) * 60;
  const minutos = Math.floor(minDec);
  const segundos = (minDec - minutos) * 60;
  return `${graus}°${String(minutos).padStart(2, '0')}'${segundos.toFixed(0)}"`;
}

/**
 * Area por Gauss/Shoelace sobre poligonal fechada UTM (m²).
 * Sequencia de pontos em ordem (horaria ou anti-horaria).
 */
export function areaGauss(pontos: Array<{ e: number; n: number }>): number {
  const n = pontos.length;
  if (n < 3) return 0;
  let soma = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pontos[i];
    const p2 = pontos[(i + 1) % n];
    soma += (p1.e * p2.n) - (p2.e * p1.n);
  }
  return Math.abs(soma) / 2;
}

/** Perimetro (soma das distancias entre pontos consecutivos, fechando) */
export function perimetro(pontos: Array<{ e: number; n: number }>): number {
  const n = pontos.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pontos[i];
    const p2 = pontos[(i + 1) % n];
    total += distanciaPlana(p1, p2);
  }
  return total;
}

/**
 * v3.95.0 — Contador de NUVEM DE PONTOS sobre a poligonal (levantamento
 * planialtimetrico). Reaproveita a geometria ja existente (mesmos vertices UTM do
 * croqui / alinhamento de cerca): conta os pontos de CONTORNO (perimetro /
 * espacamento) mais os pontos INTERNOS de uma malha regular de passo
 * `espacamento` que caem DENTRO do poligono (ponto-em-poligono por ray-casting).
 * Da a contagem exata para a forma REAL do lote — nao superestima em terreno
 * irregular como faria uma divisao area/espacamento².
 *
 * Retorna null quando nao ha poligono valido (<3 vertices) ou quando a malha
 * excederia o teto de seguranca (evita loop gigante); nesses casos o chamador
 * cai no calculo aproximado por area/perimetro.
 */
const NUVEM_MAX_CELULAS = 2_000_000; // teto de seguranca do lattice

/**
 * v3.96.0 — Gera as COORDENADAS da nuvem de pontos (contorno + interior) sobre a
 * poligonal, pro croqui grafico. `contarNuvemPontos` delega aqui (contagem =
 * tamanho das listas), entao a contagem cobrada e o desenho batem sempre.
 * - contorno: caminha o perimetro fechado a passo `espacamento` (=> ceil(P/esp)).
 * - interior: nos de uma malha regular que caem DENTRO do poligono (ray-casting).
 * Retorna null quando invalido (<3 vertices, passo <=0) ou malha alem do teto.
 */
export function gerarNuvemPontos(
  pontos: Array<{ e: number; n: number }>,
  espacamento: number,
): { contorno: Array<{ e: number; n: number }>; interno: Array<{ e: number; n: number }> } | null {
  if (!Array.isArray(pontos) || pontos.length < 3) return null;
  if (!Number.isFinite(espacamento) || espacamento <= 0) return null;

  // Bounding box do poligono.
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of pontos) {
    if (p.e < minE) minE = p.e;
    if (p.e > maxE) maxE = p.e;
    if (p.n < minN) minN = p.n;
    if (p.n > maxN) maxN = p.n;
  }
  const larg = maxE - minE, alt = maxN - minN;
  if (!Number.isFinite(larg) || !Number.isFinite(alt) || larg <= 0 || alt <= 0) return null;

  const cols = Math.floor(larg / espacamento) + 1;
  const rows = Math.floor(alt / espacamento) + 1;
  if (cols * rows > NUVEM_MAX_CELULAS) return null; // grande demais → fallback

  // Contorno: caminha o perimetro a passo `espacamento`.
  const contorno: Array<{ e: number; n: number }> = [];
  const perim = perimetro(pontos);
  for (let d = 0; d < perim - 1e-9; d += espacamento) {
    contorno.push(pontoNoPerimetro(pontos, d));
  }

  // Interior: nos da malha regular DENTRO do poligono.
  const interno: Array<{ e: number; n: number }> = [];
  for (let ix = 0; ix <= cols; ix++) {
    const x = minE + ix * espacamento;
    for (let iy = 0; iy <= rows; iy++) {
      const y = minN + iy * espacamento;
      if (pontoEmPoligono(x, y, pontos)) interno.push({ e: x, n: y });
    }
  }

  return { contorno, interno };
}

/** Ponto a `dist` metros ao longo do perimetro fechado do poligono. */
function pontoNoPerimetro(poly: Array<{ e: number; n: number }>, dist: number): { e: number; n: number } {
  const n = poly.length;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const seg = Math.hypot(b.e - a.e, b.n - a.n);
    if (acc + seg >= dist || i === n - 1) {
      const t = seg > 0 ? Math.max(0, Math.min(1, (dist - acc) / seg)) : 0;
      return { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t };
    }
    acc += seg;
  }
  return { e: poly[0].e, n: poly[0].n };
}

export function contarNuvemPontos(
  pontos: Array<{ e: number; n: number }>,
  espacamento: number,
): { perimetro: number; interno: number; total: number } | null {
  const g = gerarNuvemPontos(pontos, espacamento);
  if (!g) return null;
  return { perimetro: g.contorno.length, interno: g.interno.length, total: g.contorno.length + g.interno.length };
}

/** Ray-casting: true se (x,y) esta dentro do poligono (vertices em ordem). */
function pontoEmPoligono(x: number, y: number, poly: Array<{ e: number; n: number }>): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].e, yi = poly[i].n, xj = poly[j].e, yj = poly[j].n;
    const intersecta = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersecta) dentro = !dentro;
  }
  return dentro;
}

/**
 * Calcula lados (segmentos consecutivos): distancia + azimute.
 * Retorna array com n elementos pra poligonal fechada.
 */
export function calcularLados(pontos: Array<{ e: number; n: number }>): Array<{
  ordem: number;
  i_idx: number;       // indice do ponto inicial em pontos[]
  f_idx: number;       // indice do ponto final
  distancia_m: number;
  azimute: number;
}> {
  const n = pontos.length;
  if (n < 2) return [];
  const lados = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    lados.push({
      ordem: i + 1,
      i_idx: i,
      f_idx: j,
      distancia_m: distanciaPlana(pontos[i], pontos[j]),
      azimute: azimute(pontos[i], pontos[j]),
    });
  }
  return lados;
}

/**
 * v2.5.0: Importa pontos da coletora em multiplos formatos.
 *   - CSV/TXT (cabecalhos: ponto/id, e/n OU lat/lng, opcional h/z)
 *   - KML (Google Earth, coordinates="lng,lat,alt")
 *   - GPX (track/waypoint, lat="" lon="")
 *
 * BOM UTF-8 (﻿) e BOM UTF-16 sao removidos automaticamente.
 *
 * Quando o arquivo traz lat/lng, converte automaticamente para UTM
 * usando zona detectada (a partir da longitude) + hemisferio S (Brasil).
 * Pra outras zonas/hemisferios passar via opts.
 */
export interface PontoImportadoRTK {
  rotulo: string;
  e: number | null;
  n: number | null;
  altitude: number | null;
  /** v2.5.0: tambem expostos quando origem e lat/lng (KML/GPX/CSV-geo) */
  lat: number | null;
  lng: number | null;
  raw: Record<string, string>;
}
export interface ImportarOpts {
  defaultZona?: number;        // pra conversao lat/lng -> UTM
  defaultHemisferio?: 'N' | 'S';
}

/** Remove BOM (UTF-8 e UTF-16). Lida com encoding-detect ja feito antes. */
function stripBOM(s: string): string {
  // UTF-8 BOM apos decode = U+FEFF; UTF-16 BOM idem (TextDecoder ja processou).
  // Tambem cobre BOMs duplicados (raro mas acontece em arquivos editados).
  return s.replace(/^﻿+/, '');
}

/**
 * v2.7.1: Parse numero com tolerancia a formato BR (`9.449.891,6805`) e ingles
 * (`9449891.6805`). Tambem remove unidades comuns (`191,57 m`, `19,5 ha`).
 *
 * Regra: se a string contem virgula, considera virgula = decimal e ponto =
 * milhar (formato BR). Senao, ponto = decimal (formato EN). Heuristica simples
 * que cobre 99% dos casos sem precisar de locale parsing complexo.
 */
export function parseNumBR(s: string | undefined): number | null {
  if (!s) return null;
  let limpo = String(s).trim().replace(/^["']|["']$/g, '');
  // Strip unidades comuns no final
  limpo = limpo.replace(/\s+(m|km|cm|mm|ha|m[²2]|m\^2|graus|deg)\s*$/i, '');
  if (!limpo) return null;
  // Formato BR: tem virgula → ponto eh milhar, virgula eh decimal
  if (limpo.includes(',')) {
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/**
 * v2.7.1: Converte DMS (graus/minutos/segundos com hemisferio) para decimal.
 * Aceita formatos:
 *   `04°58'19.995"S`     → -4.972220...
 *   `04°58'19,995997"S`  → idem (decimal BR)
 *   `47°28'35"W`         → -47.476388...
 *   `-4° 58' 19" S`      → -4.972...
 *   `-4.972220`          → -4.972220 (passa direto se ja decimal)
 *
 * Hemisferio S/W/O = negativo; N/E ou ausente = sinal preservado.
 */
export function parseDMS(s: string | undefined): number | null {
  if (!s) return null;
  const limpo = String(s).trim().replace(/^["']|["']$/g, '');
  if (!limpo) return null;
  // Tenta decimal direto primeiro (caso seja "-4.97222" ou "-4,97222")
  const direto = parseNumBR(limpo);
  if (direto != null && !/[°'"′″]/.test(limpo)) return direto;
  // DMS: graus + (minutos + (segundos)) + (hemisferio?)
  const m = limpo.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*["″]?\s*)?\s*([NSEWO])?\s*$/i);
  if (!m) return null;
  const grausStr = m[1];
  const grausNum = Number(grausStr.replace(',', '.'));
  if (!Number.isFinite(grausNum)) return null;
  const min = m[2] ? Number(m[2].replace(',', '.')) : 0;
  const seg = m[3] ? Number(m[3].replace(',', '.')) : 0;
  const hem = (m[4] || '').toUpperCase();
  let dec = Math.abs(grausNum) + min / 60 + seg / 3600;
  if (grausNum < 0 || hem === 'S' || hem === 'W' || hem === 'O') dec = -dec;
  return dec;
}

/** Detecta formato pelo conteudo (sem depender de extensao). */
export function detectarFormatoArquivo(text: string): 'KML' | 'GPX' | 'CSV' | 'MEMORIAL' {
  const cleaned = stripBOM(text);
  const head = cleaned.trimStart().slice(0, 500).toLowerCase();
  if (head.includes('<gpx')) return 'GPX';
  if (head.includes('<kml')) return 'KML';
  // v2.7.1: memorial descritivo brasileiro tem cabecalho "De ... Para ... Coord"
  // (com Azimute e/ou Distancia perto). Detecta nas primeiras 500 chars.
  const temDeParaCoord = /\bde\b/.test(head) && /\bpara\b/.test(head)
    && (/coord/.test(head) || /azimute/.test(head) || /dist[áa]ncia/.test(head));
  if (temDeParaCoord) return 'MEMORIAL';
  // <?xml + nada conhecido: cai no CSV (eventualmente quebra com erro claro)
  return 'CSV';
}

/** v2.5.1: palavras que costumam aparecer em headers de coletoras. */
const PALAVRAS_HEADER = new Set([
  'ponto','id','nome','name','vert','vertice','nro','numero',
  'lat','latitude','lng','long','lon','longitude',
  'e','este','leste','x','easting',
  'n','norte','y','northing',
  'h','z','alt','elev','altitude','elevation',
  'code','rms','pdop','hdop','vdop','tdop','gdop','depth','b','l',
]);

/** v2.5.1: detecta string como numero (com sinal e ponto/virgula decimal). */
function ehNumerico(s: string): boolean {
  if (!s) return false;
  const limpo = s.trim().replace(/^["']|["']$/g, '').replace(',', '.');
  return /^[-+]?\d+(\.\d+)?$/.test(limpo);
}

/**
 * Importa CSV/TXT (separador auto: virgula, ponto-virgula, tab).
 *
 * v2.5.1: aceita arquivos SEM header (formato "name,E,N,Z" comum em
 * coletoras). Quando nao detecta palavras-chave de header na linha 1,
 * cai pro modo posicional com inferencia de E/N/altitude por magnitude:
 *   - |valor| > 1_000_000 → UTM Northing (Brasil S: 7M-10M)
 *   - 10_000 ≤ |valor| ≤ 1_000_000 → UTM Easting
 *   - |valor| ≤ 10_000 → Altitude (em metros)
 *   - Se nao tiver E/N e os 2 primeiros numeros forem ≤ 180 → Lat/Lng
 */
export function importarRTK(text: string, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
} {
  const cleaned = stripBOM(text);
  const linhas = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (linhas.length === 0) return { pontos: [], cabecalhos: [] };

  // Detecta separador (preferencia: virgula > ponto-virgula > tab)
  const sep = linhas[0].includes(',') ? ','
            : linhas[0].includes(';') ? ';'
            : linhas[0].includes('\t') ? '\t'
            : ',';

  // v2.5.1: detecta se linha 1 e header ou ja e dado
  const cols0 = linhas[0].split(sep).map(c => c.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const temHeader = cols0.some(c => PALAVRAS_HEADER.has(c));

  let cabecalhos: string[];
  let cabBaixo: string[];
  let dataStart: number;
  if (temHeader) {
    cabecalhos = linhas[0].split(sep).map(c => c.trim());
    cabBaixo = cabecalhos.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    dataStart = 1;
  } else {
    const ncols = linhas[0].split(sep).length;
    cabecalhos = Array.from({ length: ncols }, (_, i) => `col${i}`);
    cabBaixo = cabecalhos.slice();
    dataStart = 0;
  }

  // v2.5.0: rotulo usa prefix-match (vert, vertice). Demais usam exact-match
  // pra evitar falsos positivos (ex: "Latitude Corrections" nao deve casar com Lat).
  // "name" e "elevation" adicionados pro formato SinoGNSS R60/R80 (ingles).
  const idxRotulo = temHeader ? cabBaixo.findIndex(c => /^(ponto|id|nome|name|nro|numero|vert)/.test(c)) : -1;
  const idxLat    = temHeader ? cabBaixo.findIndex(c => /^(lat|latitude)$/.test(c))                       : -1;
  const idxLng    = temHeader ? cabBaixo.findIndex(c => /^(lng|long|longitude|lon)$/.test(c))             : -1;
  const idxE      = temHeader ? cabBaixo.findIndex(c => /^(e|este|leste|x|easting)$/.test(c))             : -1;
  const idxN      = temHeader ? cabBaixo.findIndex(c => /^(n|norte|y|northing)$/.test(c))                 : -1;
  const idxAlt    = temHeader ? cabBaixo.findIndex(c => /^(h|z|alt|elev|altitude|elevation)$/.test(c))    : -1;

  // v2.7.1: usa parseNumBR (cobre BR `1.234,56` e EN `1234.56`)
  const parseNum = parseNumBR;

  const pontos: PontoImportadoRTK[] = [];
  for (let i = dataStart; i < linhas.length; i++) {
    const cols = linhas[i].split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const raw: Record<string, string> = {};
    cabecalhos.forEach((h, k) => { raw[h] = cols[k] ?? ''; });

    let rotulo: string;
    let e: number | null = null;
    let n: number | null = null;
    let lat: number | null = null;
    let lng: number | null = null;
    let altitude: number | null = null;

    if (temHeader) {
      rotulo   = idxRotulo >= 0 ? (cols[idxRotulo] || `V${i}`) : `V${i}`;
      altitude = idxAlt    >= 0 ? parseNum(cols[idxAlt])  : null;
      e        = idxE      >= 0 ? parseNum(cols[idxE])    : null;
      n        = idxN      >= 0 ? parseNum(cols[idxN])    : null;
      lat      = idxLat    >= 0 ? parseNum(cols[idxLat])  : null;
      lng      = idxLng    >= 0 ? parseNum(cols[idxLng])  : null;
    } else {
      // v2.5.1: modo posicional sem header. col[0] e rotulo (se nao-numerico),
      // restantes sao coords. Inferencia por magnitude.
      const idxData = (cols[0] && !ehNumerico(cols[0])) ? 1 : 0;
      rotulo = idxData === 1 ? cols[0] : `V${i - dataStart + 1}`;
      const nums: Array<number | null> = cols.slice(idxData).map(parseNum);
      const restantes: number[] = [];
      for (const v of nums) {
        if (v == null) continue;
        const abs = Math.abs(v);
        if (abs > 1_000_000 && n == null) {
          n = v;
        } else if (abs >= 10_000 && abs <= 1_000_000 && e == null) {
          e = v;
        } else if (abs <= 10_000 && altitude == null) {
          altitude = v;
        } else {
          restantes.push(v);
        }
      }
      // Fallback geo: se nao deu UTM, talvez sejam lat/lng decimais
      if (e == null && n == null) {
        const validos = nums.filter((x): x is number => x != null);
        if (validos.length >= 2 && validos.slice(0, 2).every(v => Math.abs(v) <= 180)) {
          const a = validos[0];
          const b = validos[1];
          // Heuristica: lat <= 90, lng <= 180. Se a > 90 → ordem invertida.
          if (Math.abs(a) > 90) { lng = a; lat = b; } else { lat = a; lng = b; }
          altitude = validos[2] ?? altitude;
        }
      }
    }

    // v2.5.0: se vieram lat/lng e e/n estao vazios, converte
    if ((e == null || n == null) && lat != null && lng != null) {
      try {
        const zona = opts.defaultZona ?? detectarZonaUtm(lng);
        const hemisferio = opts.defaultHemisferio ?? (lat < 0 ? 'S' : 'N');
        const utm = geoParaUtm({ lat, lng, zona, hemisferio });
        e = utm.e;
        n = utm.n;
      } catch (_) { /* deixa null se proj4 falhar */ }
    }

    pontos.push({ rotulo, e, n, altitude, lat, lng, raw });
  }
  return { pontos, cabecalhos };
}

/** v2.5.0: Importa KML (Google Earth, coletoras pro). */
export function importarKML(text: string, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
} {
  const cleaned = stripBOM(text);
  const pontos: PontoImportadoRTK[] = [];

  // Parser regex-based — KMLs reais sao XML mas parsear arvore aqui seria
  // overkill. Pega cada <Placemark>...</Placemark> e extrai <name> + <coordinates>.
  // Tolera variacoes de namespace (<kml:Placemark>) e whitespace.
  const placemarkRe = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let m: RegExpExecArray | null;
  let idx = 1;
  while ((m = placemarkRe.exec(cleaned)) !== null) {
    const inner = m[1];
    const nameMatch = inner.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
    const coordsMatch = inner.match(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
    if (!coordsMatch) continue;
    const rotuloBase = (nameMatch?.[1] || '').trim() || `V${idx}`;

    // Cada coord pode ser "lng,lat,alt" separados por whitespace (Point ou LineString)
    const coordTokens = coordsMatch[1].trim().split(/\s+/).filter(Boolean);
    coordTokens.forEach((tok, j) => {
      const parts = tok.split(',').map(p => Number(p.trim()));
      const lng = parts[0];
      const lat = parts[1];
      const altitude = parts[2] ?? null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      let e: number | null = null;
      let n: number | null = null;
      try {
        const zona = opts.defaultZona ?? detectarZonaUtm(lng);
        const hemisferio = opts.defaultHemisferio ?? (lat < 0 ? 'S' : 'N');
        const utm = geoParaUtm({ lat, lng, zona, hemisferio });
        e = utm.e;
        n = utm.n;
      } catch (_) { /* null */ }
      const rotulo = coordTokens.length > 1 ? `${rotuloBase}-${j + 1}` : rotuloBase;
      pontos.push({
        rotulo, e, n,
        altitude: Number.isFinite(altitude as number) ? (altitude as number) : null,
        lat, lng,
        raw: { source: 'kml', name: rotuloBase },
      });
    });
    idx++;
  }
  return { pontos, cabecalhos: ['name', 'lng', 'lat', 'altitude'] };
}

/** v2.5.0: Importa GPX (waypoints e trackpoints). */
export function importarGPX(text: string, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
} {
  const cleaned = stripBOM(text);
  const pontos: PontoImportadoRTK[] = [];

  // Captura wpt|trkpt|rtept; lat e lon como atributos. Tolera ordem invertida.
  const ptRe = /<(wpt|trkpt|rtept)\b([^>]*?)\/?>([\s\S]*?)(?:<\/\1>|\/>)/gi;
  let m: RegExpExecArray | null;
  let idx = 1;
  while ((m = ptRe.exec(cleaned)) !== null) {
    const attrs = m[2];
    const inner = m[3] || '';
    const latMatch = attrs.match(/\blat=["']([^"']+)["']/i);
    const lonMatch = attrs.match(/\blon=["']([^"']+)["']/i);
    if (!latMatch || !lonMatch) continue;
    const lat = Number(latMatch[1]);
    const lng = Number(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const nameMatch = inner.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
    const eleMatch = inner.match(/<ele[^>]*>([\s\S]*?)<\/ele>/i);
    const rotulo = (nameMatch?.[1] || '').trim() || `V${idx}`;
    const altitude = eleMatch ? Number((eleMatch[1] || '').trim()) : null;
    let e: number | null = null;
    let n: number | null = null;
    try {
      const zona = opts.defaultZona ?? detectarZonaUtm(lng);
      const hemisferio = opts.defaultHemisferio ?? (lat < 0 ? 'S' : 'N');
      const utm = geoParaUtm({ lat, lng, zona, hemisferio });
      e = utm.e;
      n = utm.n;
    } catch (_) { /* null */ }
    pontos.push({
      rotulo, e, n,
      altitude: Number.isFinite(altitude as number) ? (altitude as number) : null,
      lat, lng,
      raw: { source: 'gpx', tag: m[1] },
    });
    idx++;
  }
  return { pontos, cabecalhos: ['name', 'lat', 'lon', 'ele'] };
}

/**
 * v2.7.1: Importa MEMORIAL DESCRITIVO (relatorio de laterais De/Para/Coord).
 * Formato tipico de softwares topograficos brasileiros (Posiciona, TopoEvn,
 * AutoCAD memorial export):
 *
 *   De           Para         Coord. N(Y)      Coord. E(X)   Azimute       Distância    Fator K       Latitude            Longitude
 *   FQNS-P-003   AVEX-M-0123  9.449.891,6805   225.372,3751  124°05'41"    191,57 m     1,00053356    04°58'19,995997"S   47°28'35,415962"W
 *
 * Cada linha descreve um SEGMENTO (lado), nao um vertice. As coordenadas
 * referem-se ao "Para" (vertice destino). Ao parsear, cada linha vira um
 * ponto com rotulo = "Para".
 *
 * Suporta:
 *   - Numeros formato BR (9.449.891,6805 = 9449891.6805)
 *   - DMS na latitude/longitude com sufixo de hemisferio
 *   - Linhas separadoras (==== ou ----) e linhas de sumario (Perímetro:, Área:)
 *     sao ignoradas
 *   - Separador: tab ou multi-espaco (auto-detectado)
 */
export function importarMemorial(text: string, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
} {
  const cleaned = stripBOM(text);
  const linhas = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (linhas.length === 0) return { pontos: [], cabecalhos: [] };

  // v2.9.1: detecta posicao do header (linha com "De" + "Para" + coord/dist/azimute)
  // Tolera single-space, multi-space, tab. Ignora prefixo (IMÓVEL, MUNICÍPIO,
  // SISTEMA GEODÉSICO, MERIDIANO CENTRAL, etc).
  let headerIdx = -1;
  for (let i = 0; i < Math.min(linhas.length, 30); i++) {
    const lower = linhas[i].toLowerCase();
    const tokens = lower.split(/\s+/);
    if (tokens.includes('de') && tokens.includes('para') && /coord|azimute|dist[áa]ncia/.test(lower)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { pontos: [], cabecalhos: [] };

  // v2.9.1: parser regex POSICIONAL (nao depende de split de colunas).
  // Cada linha de dados tem sempre: <De> <Para> <N-BR> <E-BR> ... resto opcional.
  // Funciona com qualquer espacamento (single/multi/tab) e tolera mojibake
  // nos simbolos de DMS (°/"/').
  //
  // Numeros BR: "9.449.891,6805" — pontos como milhares, virgula como decimal.
  // Regex aceita digitos, ponto, virgula, sinal negativo.
  const dataLineRe = /^(\S+)\s+(\S+)\s+([-+]?[\d.,]+)\s+([-+]?[\d.,]+)/;

  // Captura DMS lat/lng do resto da linha. Aceita tambem mojibake (`Â°` em
  // lugar de `°`) — usamos `[^a-zA-Z0-9\s\-+,.]` como hint de "simbolo grau".
  // Mas pra simplificar, usamos parseDMS que ja eh robusto se o token completo
  // for passado.
  const dmsRe = /(-?\d+(?:[.,]\d+)?)\s*[°°Â]+\s*(\d+(?:[.,]\d+)?)\s*['′´]\s*(\d+(?:[.,]\d+)?)\s*["″]?\s*([NSEWO])/gi;

  const ignoraLinha = (l: string) => {
    if (/^[=\-_*\s]+$/.test(l)) return true; // separadores
    if (/^per[íi]metro\s*:/i.test(l)) return true;
    if (/^[áa]rea\s*(total)?\s*:/i.test(l)) return true;
    if (/^total\s*:/i.test(l)) return true;
    if (/^im[óo]vel\s*:/i.test(l)) return true;
    if (/^munic[íi]pio\s*:/i.test(l)) return true;
    if (/^sistema\s+geod[ée]sico/i.test(l)) return true;
    if (/^meridiano\s+central/i.test(l)) return true;
    return false;
  };

  const pontos: PontoImportadoRTK[] = [];

  for (let i = headerIdx + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (ignoraLinha(l)) continue;
    const m = l.match(dataLineRe);
    if (!m) continue;
    const [, _de, para, nStr, eStr] = m;
    const n = parseNumBR(nStr);
    const e = parseNumBR(eStr);
    if (e == null || n == null) continue;

    // Tenta extrair lat/lng DMS do resto da linha
    let lat: number | null = null;
    let lng: number | null = null;
    const dmsMatches = [...l.matchAll(dmsRe)];
    for (const dm of dmsMatches) {
      const dec = parseDMS(dm[0]);
      if (dec == null) continue;
      const hem = (dm[4] || '').toUpperCase();
      if (hem === 'S' || hem === 'N') lat = dec;
      else if (hem === 'W' || hem === 'E' || hem === 'O') lng = dec;
    }

    pontos.push({
      rotulo: para,
      e, n,
      altitude: null,
      lat, lng,
      raw: { source: 'memorial', de: _de, para },
    });
  }

  return { pontos, cabecalhos: ['de', 'para', 'n', 'e', 'lat', 'lng'] };
}

/** v2.5.0: Dispatcher que detecta formato e roteia pra parser certo. */
export function importarPontosArquivo(text: string, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
  formato: 'KML' | 'GPX' | 'CSV' | 'MEMORIAL';
} {
  const formato = detectarFormatoArquivo(text);
  const r = formato === 'KML' ? importarKML(text, opts)
         : formato === 'GPX' ? importarGPX(text, opts)
         : formato === 'MEMORIAL' ? importarMemorial(text, opts)
         : importarRTK(text, opts);
  return { ...r, formato };
}

/**
 * v2.7.0: Importa XLSX (Excel) — converte primeira sheet pra CSV e
 * delega pra importarRTK. Cabe headers ou sem header (mesma logica).
 */
export function importarXLSX(buffer: Buffer, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xlsx = require('xlsx') as typeof import('xlsx');
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { pontos: [], cabecalhos: [] };
  const ws = wb.Sheets[sheetName];
  const csv = xlsx.utils.sheet_to_csv(ws, { strip: false, blankrows: false });
  return importarRTK(csv, opts);
}

/**
 * v2.7.0: Importa DXF (AutoCAD ASCII). Parser minimalista que extrai:
 *   - Entidades POINT (com layer name como rotulo)
 *   - Vertices de LWPOLYLINE / POLYLINE (cada vertice vira ponto)
 *
 * DXF e formato tagged-value: linhas alternadas de codigo (par) e valor
 * (impar). Codigos relevantes:
 *   0  = tipo de entidade (POINT, LWPOLYLINE, POLYLINE, VERTEX, ...)
 *   8  = layer name
 *  10  = X
 *  20  = Y
 *  30  = Z (opcional)
 *
 * Suporta DXF R12-R2018 ASCII. Binary DXF nao suportado.
 */
export function importarDXF(text: string, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
} {
  const cleaned = stripBOM(text);
  const linhas = cleaned.split(/\r?\n/).map(l => l.trim());
  const pontos: PontoImportadoRTK[] = [];
  let i = 0;
  let idxAuto = 1;

  // Le par de linhas (codigo, valor) e avanca i por 2
  const lerPar = (): { codigo: number; valor: string } | null => {
    if (i + 1 >= linhas.length) return null;
    const codigo = Number(linhas[i]);
    const valor = linhas[i + 1] ?? '';
    i += 2;
    return Number.isFinite(codigo) ? { codigo, valor } : null;
  };

  while (i < linhas.length) {
    const par = lerPar();
    if (!par) break;
    if (par.codigo !== 0) continue; // procura inicio de entidade

    const tipo = par.valor.toUpperCase();
    if (tipo !== 'POINT' && tipo !== 'LWPOLYLINE' && tipo !== 'POLYLINE' && tipo !== 'VERTEX') continue;

    let layer = '';
    let x: number | null = null;
    let y: number | null = null;
    let z: number | null = null;
    const vertices: Array<{ x: number; y: number; z: number | null }> = [];

    // Le pares ate proximo 0 (proxima entidade)
    while (i < linhas.length) {
      const peek = Number(linhas[i]);
      if (peek === 0) break; // proxima entidade
      const sub = lerPar();
      if (!sub) break;
      if (sub.codigo === 8) layer = sub.valor;
      else if (sub.codigo === 10) x = Number(sub.valor);
      else if (sub.codigo === 20) y = Number(sub.valor);
      else if (sub.codigo === 30) z = Number(sub.valor);

      // LWPOLYLINE empacota multiplos pares 10/20 num so bloco
      if (tipo === 'LWPOLYLINE' && sub.codigo === 20 && x != null && Number.isFinite(y as number)) {
        vertices.push({ x, y: y as number, z: Number.isFinite(z as number) ? (z as number) : null });
        x = null; y = null; z = null;
      }
    }

    if (tipo === 'POINT' && Number.isFinite(x as number) && Number.isFinite(y as number)) {
      pontos.push({
        rotulo: layer || `V${idxAuto++}`,
        e: x, n: y,
        altitude: Number.isFinite(z as number) ? z : null,
        lat: null, lng: null,
        raw: { source: 'dxf', layer, tipo: 'POINT' },
      });
    } else if (tipo === 'LWPOLYLINE') {
      const baseRot = layer || `Poly${idxAuto++}`;
      vertices.forEach((v, k) => {
        pontos.push({
          rotulo: vertices.length > 1 ? `${baseRot}-${k + 1}` : baseRot,
          e: v.x, n: v.y, altitude: v.z,
          lat: null, lng: null,
          raw: { source: 'dxf', layer, tipo: 'LWPOLYLINE' },
        });
      });
    } else if (tipo === 'VERTEX' && Number.isFinite(x as number) && Number.isFinite(y as number)) {
      // VERTEX (de POLYLINE classico) vira ponto solo
      pontos.push({
        rotulo: layer || `V${idxAuto++}`,
        e: x, n: y,
        altitude: Number.isFinite(z as number) ? z : null,
        lat: null, lng: null,
        raw: { source: 'dxf', layer, tipo: 'VERTEX' },
      });
    }
    // POLYLINE container: ignora — vertices vem em entidades VERTEX subsequentes
  }

  // Inferencia: se as coords parecem latitude (|x| < 180 e |y| < 90), trata como geo
  if (pontos.length > 0) {
    const todosGeo = pontos.every(p => p.e != null && p.n != null && Math.abs(p.e) <= 180 && Math.abs(p.n) <= 90);
    if (todosGeo) {
      for (const p of pontos) {
        if (p.e != null && p.n != null) {
          // DXF geo: assumindo lon=X, lat=Y (convencao usual)
          p.lng = p.e;
          p.lat = p.n;
          p.e = null; p.n = null;
          try {
            const zona = opts.defaultZona ?? detectarZonaUtm(p.lng);
            const hemisferio = opts.defaultHemisferio ?? (p.lat < 0 ? 'S' : 'N');
            const utm = geoParaUtm({ lat: p.lat, lng: p.lng, zona, hemisferio });
            p.e = utm.e;
            p.n = utm.n;
          } catch (_) { /* deixa null */ }
        }
      }
    }
  }

  return { pontos, cabecalhos: ['layer', 'x', 'y', 'z'] };
}

/**
 * v2.7.0: Importa SHP (ESRI Shapefile). Recebe Buffer do .shp e
 * extrai geometrias Point e Polygon (cada vertice vira ponto).
 *
 * shapefile lib (mbostock) precisa de path em disco. Salva em temp,
 * processa, apaga.
 */
export async function importarSHP(buffer: Buffer, opts: ImportarOpts = {}): Promise<{
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const shapefile = require('shapefile') as { open: (path: string) => Promise<{ read: () => Promise<{ done: boolean; value: { type: string; coordinates: unknown; properties?: Record<string, unknown> } }> }> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs/promises') as typeof import('fs/promises');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto');

  const tmp = path.join(os.tmpdir(), `shp-${crypto.randomBytes(8).toString('hex')}.shp`);
  await fs.writeFile(tmp, buffer);
  const pontos: PontoImportadoRTK[] = [];
  let idxAuto = 1;

  try {
    const source = await shapefile.open(tmp);
    while (true) {
      const { done, value } = await source.read();
      if (done) break;
      if (!value) continue;

      const handlePoint = (coords: number[], rotulo: string) => {
        const x = coords[0];
        const y = coords[1];
        const z = coords[2] ?? null;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        // SHP Point: coords sao [lon, lat] ou [E, N] dependendo do CRS.
        // Heuristica: se |x| <= 180 e |y| <= 90 → lon/lat; senao UTM.
        let e: number | null = null, n: number | null = null;
        let lat: number | null = null, lng: number | null = null;
        let altitude: number | null = Number.isFinite(z as number) ? (z as number) : null;
        if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
          lng = x; lat = y;
          try {
            const zona = opts.defaultZona ?? detectarZonaUtm(lng);
            const hemisferio = opts.defaultHemisferio ?? (lat < 0 ? 'S' : 'N');
            const utm = geoParaUtm({ lat, lng, zona, hemisferio });
            e = utm.e;
            n = utm.n;
          } catch (_) { /* null */ }
        } else {
          e = x; n = y;
        }
        pontos.push({ rotulo, e, n, altitude, lat, lng, raw: { source: 'shp', tipo: value.type } });
      };

      const props = value.properties || {};
      const baseRotulo = String(props.NAME || props.Name || props.name || props.ID || props.id || '').trim();

      if (value.type === 'Point') {
        const coords = value.coordinates as number[];
        handlePoint(coords, baseRotulo || `V${idxAuto++}`);
      } else if (value.type === 'MultiPoint' || value.type === 'LineString') {
        const arr = value.coordinates as number[][];
        const rot = baseRotulo || `Geom${idxAuto++}`;
        arr.forEach((c, k) => handlePoint(c, arr.length > 1 ? `${rot}-${k + 1}` : rot));
      } else if (value.type === 'Polygon') {
        // Anel externo apenas (primeiro array)
        const rings = value.coordinates as number[][][];
        const ext = rings[0] || [];
        const rot = baseRotulo || `Pol${idxAuto++}`;
        // Polygon GeoJSON repete o primeiro ponto no fim — descarta
        const limite = ext.length > 1 && ext[0][0] === ext[ext.length - 1][0] && ext[0][1] === ext[ext.length - 1][1]
          ? ext.length - 1
          : ext.length;
        for (let k = 0; k < limite; k++) {
          handlePoint(ext[k], `${rot}-${k + 1}`);
        }
      } else if (value.type === 'MultiPolygon') {
        const polys = value.coordinates as number[][][][];
        polys.forEach((rings, j) => {
          const ext = rings[0] || [];
          const rot = baseRotulo ? `${baseRotulo}-${j + 1}` : `Pol${idxAuto++}`;
          const limite = ext.length > 1 && ext[0][0] === ext[ext.length - 1][0] && ext[0][1] === ext[ext.length - 1][1]
            ? ext.length - 1
            : ext.length;
          for (let k = 0; k < limite; k++) {
            handlePoint(ext[k], `${rot}-${k + 1}`);
          }
        });
      }
    }
  } finally {
    try { await fs.unlink(tmp); } catch (_) { /* ignora */ }
  }

  return { pontos, cabecalhos: ['name', 'x/lng', 'y/lat', 'z'] };
}
