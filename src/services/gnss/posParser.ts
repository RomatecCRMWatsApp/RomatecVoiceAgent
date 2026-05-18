// Parser do .pos do IBGE-PPP (formato tabular ASCII com comentarios "%"). Cada
// linha de dado: YYYY/MM/DD HH:MM:SS.SSS  lat  lon  alt  Q  ns  sdn  sde  sdu

export interface PosEpoch {
  timestamp: Date;
  latitude: number;
  longitude: number;
  altitude: number;
  quality: number | null;
  numSats: number | null;
}

export interface PosFile {
  epochs: PosEpoch[];
  numEpocas: number;
  mean: { latitude: number; longitude: number; altitude: number };
}

export function parseIbgePos(text: string): PosFile {
  const epochs: PosEpoch[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('%') || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const dateStr = parts[0]; // YYYY/MM/DD
    const timeStr = parts[1]; // HH:MM:SS.SSS
    const lat = Number(parts[2]);
    const lon = Number(parts[3]);
    const alt = Number(parts[4]);
    if (![lat, lon, alt].every(Number.isFinite)) continue;
    const [yy, mo, dd] = dateStr.split('/').map(Number);
    const [hh, mm, ss] = timeStr.split(':').map(Number);
    const ts = new Date(Date.UTC(yy, mo - 1, dd, hh, mm, Math.floor(ss), Math.round((ss % 1) * 1000)));
    epochs.push({
      timestamp: ts,
      latitude: lat,
      longitude: lon,
      altitude: alt,
      quality: parts[5] != null ? Number(parts[5]) : null,
      numSats: parts[6] != null ? Number(parts[6]) : null,
    });
  }
  const sum = epochs.reduce(
    (a, e) => ({ lat: a.lat + e.latitude, lon: a.lon + e.longitude, alt: a.alt + e.altitude }),
    { lat: 0, lon: 0, alt: 0 }
  );
  const n = epochs.length || 1;
  return {
    epochs,
    numEpocas: epochs.length,
    mean: { latitude: sum.lat / n, longitude: sum.lon / n, altitude: sum.alt / n },
  };
}
