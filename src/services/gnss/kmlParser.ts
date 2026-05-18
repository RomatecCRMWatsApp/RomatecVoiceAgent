// Parser minimo de KML do IBGE-PPP. Le apenas <coordinates>lon,lat,alt</coordinates>
// do primeiro Point — suficiente para nossos fins. Sem dep externa de XML parser.

export interface KmlPoint {
  longitude: number;
  latitude: number;
  altitude: number | null;
}

export function parseKmlPoint(xml: string): KmlPoint | null {
  const m = xml.match(/<Point[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
  if (!m) return null;
  const trio = m[1].trim().split(/[\s,]+/).map(Number);
  if (trio.length < 2 || !Number.isFinite(trio[0]) || !Number.isFinite(trio[1])) return null;
  return {
    longitude: trio[0],
    latitude: trio[1],
    altitude: Number.isFinite(trio[2]) ? trio[2] : null,
  };
}
