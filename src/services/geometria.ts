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

/** Detecta formato pelo conteudo (sem depender de extensao). */
export function detectarFormatoArquivo(text: string): 'KML' | 'GPX' | 'CSV' {
  const head = stripBOM(text).trimStart().slice(0, 200).toLowerCase();
  if (head.includes('<gpx')) return 'GPX';
  if (head.includes('<kml')) return 'KML';
  // <?xml + nada conhecido: cai no CSV (eventualmente quebra com erro claro)
  return 'CSV';
}

/** Importa CSV/TXT (separador auto: virgula, ponto-virgula, tab). */
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

  const cabecalhos = linhas[0].split(sep).map(c => c.trim());
  const cabBaixo = cabecalhos.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // v2.5.0: rotulo usa prefix-match (vert, vertice). Demais usam exact-match
  // pra evitar falsos positivos (ex: "Latitude Corrections" nao deve casar com Lat).
  // "name" e "elevation" adicionados pro formato SinoGNSS R60/R80 (ingles).
  const idxRotulo = cabBaixo.findIndex(c => /^(ponto|id|nome|name|nro|numero|vert)/.test(c));
  const idxLat    = cabBaixo.findIndex(c => /^(lat|latitude)$/.test(c));
  const idxLng    = cabBaixo.findIndex(c => /^(lng|long|longitude|lon)$/.test(c));
  const idxE      = cabBaixo.findIndex(c => /^(e|este|leste|x|easting)$/.test(c));
  const idxN      = cabBaixo.findIndex(c => /^(n|norte|y|northing)$/.test(c));
  const idxAlt    = cabBaixo.findIndex(c => /^(h|z|alt|elev|altitude|elevation)$/.test(c));

  const parseNum = (s: string | undefined): number | null => {
    if (!s) return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const pontos: PontoImportadoRTK[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const raw: Record<string, string> = {};
    cabecalhos.forEach((h, k) => { raw[h] = cols[k] ?? ''; });

    const rotulo = idxRotulo >= 0 ? (cols[idxRotulo] || `V${i}`) : `V${i}`;
    const altitude = idxAlt >= 0 ? parseNum(cols[idxAlt]) : null;

    let e: number | null = idxE >= 0 ? parseNum(cols[idxE]) : null;
    let n: number | null = idxN >= 0 ? parseNum(cols[idxN]) : null;
    const lat = idxLat >= 0 ? parseNum(cols[idxLat]) : null;
    const lng = idxLng >= 0 ? parseNum(cols[idxLng]) : null;

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

/** v2.5.0: Dispatcher que detecta formato e roteia pra parser certo. */
export function importarPontosArquivo(text: string, opts: ImportarOpts = {}): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
  formato: 'KML' | 'GPX' | 'CSV';
} {
  const formato = detectarFormatoArquivo(text);
  const r = formato === 'KML' ? importarKML(text, opts)
         : formato === 'GPX' ? importarGPX(text, opts)
         : importarRTK(text, opts);
  return { ...r, formato };
}
