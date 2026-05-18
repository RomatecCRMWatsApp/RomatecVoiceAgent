// Conversao geograficas <-> UTM em SIRGAS2000 via proj4. SIRGAS2000 e
// equivalente em precisao a WGS84 (~1cm) — proj4 usa "+ellps=GRS80" + "+towgs84=0,0,0".

import proj4 from 'proj4';

const SIRGAS2000_WGS84 = '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs';

function utmDef(zona: number, hemisferio: 'N' | 'S'): string {
  const south = hemisferio === 'S' ? ' +south' : '';
  return `+proj=utm +zone=${zona}${south} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
}

export function zonaUtmDe(longitudeGraus: number): number {
  return Math.floor((longitudeGraus + 180) / 6) + 1;
}

export interface UtmPoint {
  utmLeste: number;
  utmNorte: number;
  zona: number;
  hemisferio: 'N' | 'S';
  mc: number;
}

export function latLonToUtm(lat: number, lon: number, zonaForcada?: number): UtmPoint {
  const zona = zonaForcada ?? zonaUtmDe(lon);
  const hemisferio: 'N' | 'S' = lat < 0 ? 'S' : 'N';
  const [e, n] = proj4(SIRGAS2000_WGS84, utmDef(zona, hemisferio), [lon, lat]);
  const mc = (zona - 1) * 6 - 180 + 3;
  return { utmLeste: e, utmNorte: n, zona, hemisferio, mc };
}

export function utmToLatLon(
  utmLeste: number, utmNorte: number, zona: number, hemisferio: 'N' | 'S'
): { latitude: number; longitude: number } {
  const [lon, lat] = proj4(utmDef(zona, hemisferio), SIRGAS2000_WGS84, [utmLeste, utmNorte]);
  return { latitude: lat, longitude: lon };
}

// Bounding box "Brasil" amplo (cobre territorio nacional + Fernando de Noronha + Trindade)
export function isWithinBrazil(lat: number, lon: number): boolean {
  return lat >= -34 && lat <= 6 && lon >= -75 && lon <= -28;
}
