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
 * Importa CSV/TXT de RTK. Formato esperado:
 *   - Linha 1: header com nomes de colunas (ex: "ponto,e,n,h" ou "id,N,E,Z")
 *   - Linhas seguintes: dados separados por virgula, ponto-virgula, ou tab
 *
 * Retorna lista de pontos com mapeamento auto de colunas comuns.
 * Reconhece (case-insensitive): ponto/id/nome, e/leste/x, n/norte/y, h/z/altitude
 */
export interface PontoImportadoRTK {
  rotulo: string;
  e: number | null;
  n: number | null;
  altitude: number | null;
  raw: Record<string, string>;
}
export function importarRTK(text: string): {
  pontos: PontoImportadoRTK[];
  cabecalhos: string[];
} {
  const linhas = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (linhas.length === 0) return { pontos: [], cabecalhos: [] };

  // Detecta separador (preferencia: virgula > ponto-virgula > tab)
  const sep = linhas[0].includes(',') ? ','
            : linhas[0].includes(';') ? ';'
            : linhas[0].includes('\t') ? '\t'
            : ',';

  const cabecalhos = linhas[0].split(sep).map(c => c.trim());
  const cabBaixo = cabecalhos.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const idxRotulo = cabBaixo.findIndex(c => /^(ponto|id|nome|nro|numero|vert)/.test(c));
  const idxE      = cabBaixo.findIndex(c => /^(e|este|leste|x|easting)/.test(c));
  const idxN      = cabBaixo.findIndex(c => /^(n|norte|y|northing)/.test(c));
  const idxAlt    = cabBaixo.findIndex(c => /^(h|z|alt|elev)/.test(c));

  const pontos: PontoImportadoRTK[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const raw: Record<string, string> = {};
    cabecalhos.forEach((h, k) => { raw[h] = cols[k] ?? ''; });
    const parseNum = (s: string | undefined): number | null => {
      if (!s) return null;
      const n = Number(s.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    pontos.push({
      rotulo: idxRotulo >= 0 ? (cols[idxRotulo] || `V${i}`) : `V${i}`,
      e:      idxE      >= 0 ? parseNum(cols[idxE])  : null,
      n:      idxN      >= 0 ? parseNum(cols[idxN])  : null,
      altitude: idxAlt  >= 0 ? parseNum(cols[idxAlt]) : null,
      raw,
    });
  }
  return { pontos, cabecalhos };
}
