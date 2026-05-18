// Parser do cabecalho RINEX 2.11 e 3.x. Cada linha do cabecalho tem 80 colunas;
// o "rotulo" da linha aparece no fim (colunas 61+). Usamos esse rotulo como
// pivot (split por linha + busca por sufixo) ao inves de regex absoluta — RINEX
// emitido por receptores reais varia em espacamento.

export interface RinexHeader {
  version: string | null;
  type: string | null;
  receiverModel: string | null;
  receiverSerial: string | null;
  antennaModel: string | null;
  antennaHeightM: number | null;
  approxXYZ: { x: number; y: number; z: number } | null;
  timeFirstObs: Date | null;
  timeLastObs: Date | null;
  durationSeconds: number | null;
  intervalSeconds: number | null;
  systems: string[];
}

const SYS_MAP: Record<string, string> = {
  G: 'GPS', R: 'GLO', E: 'GAL', C: 'BDS', J: 'QZSS', I: 'IRNSS', S: 'SBAS', M: 'MIXED',
};

function tagOf(line: string): string {
  return line.length > 60 ? line.slice(60).trim() : '';
}
function bodyOf(line: string): string {
  return line.length > 60 ? line.slice(0, 60) : line;
}

function parseFloatOrNull(s: string): number | null {
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
}

function parseTimeLine(body: string): Date | null {
  // Formato: "  YYYY    MM    DD    HH    MM    SS.SSSSSSS     GPS"
  const parts = body.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const [y, mo, d, h, mi, se] = parts;
  const yr = Number(y), mon = Number(mo), day = Number(d);
  const hr = Number(h), min = Number(mi), sec = Number(se);
  if (![yr, mon, day, hr, min, sec].every(Number.isFinite)) return null;
  return new Date(Date.UTC(yr, mon - 1, day, hr, min, Math.floor(sec), Math.round((sec % 1) * 1000)));
}

export function parseRinexHeader(text: string): RinexHeader {
  const out: RinexHeader = {
    version: null, type: null,
    receiverModel: null, receiverSerial: null,
    antennaModel: null, antennaHeightM: null,
    approxXYZ: null,
    timeFirstObs: null, timeLastObs: null,
    durationSeconds: null, intervalSeconds: null,
    systems: [],
  };

  const lines = text.split(/\r?\n/);
  const systemsSet = new Set<string>();
  let typeChar: string | null = null;

  for (const line of lines) {
    const tag = tagOf(line);
    const body = bodyOf(line);
    if (!tag) continue;
    if (tag === 'END OF HEADER') break;

    if (tag === 'RINEX VERSION / TYPE') {
      out.version = body.slice(0, 20).trim() || null;
      out.type = body.slice(20, 40).trim() || null;
      typeChar = body.slice(40, 41).trim() || null; // G/R/E/C/M etc
      if (typeChar && SYS_MAP[typeChar] && typeChar !== 'M') systemsSet.add(SYS_MAP[typeChar]);
    } else if (tag === 'REC # / TYPE / VERS') {
      // Layout: [REC #:0-20][REC TYPE:20-40][VERS:40-60]
      const recNum = body.slice(0, 20).trim();
      const recType = body.slice(20, 40).trim();
      const recVers = body.slice(40, 60).trim();
      // If recNum has content (e.g., "TOPCON HIPER V"), it's actually the type
      out.receiverModel = recNum || recType || null;
      out.receiverSerial = recVers || null;
    } else if (tag === 'ANT # / TYPE') {
      out.antennaModel = body.slice(20, 40).trim() || null;
    } else if (tag === 'ANTENNA: DELTA H/E/N') {
      const h = parseFloatOrNull(body.slice(0, 14));
      out.antennaHeightM = h;
    } else if (tag === 'APPROX POSITION XYZ') {
      const x = parseFloatOrNull(body.slice(0, 14));
      const y = parseFloatOrNull(body.slice(14, 28));
      const z = parseFloatOrNull(body.slice(28, 42));
      if (x != null && y != null && z != null) out.approxXYZ = { x, y, z };
    } else if (tag === 'INTERVAL') {
      out.intervalSeconds = parseFloatOrNull(body);
    } else if (tag === 'TIME OF FIRST OBS') {
      out.timeFirstObs = parseTimeLine(body);
    } else if (tag === 'TIME OF LAST OBS') {
      out.timeLastObs = parseTimeLine(body);
    } else if (tag === 'SYS / # / OBS TYPES') {
      // RINEX 3.x: primeira coluna eh sistema (G/R/E/C/J/I/S)
      const sys = body.slice(0, 1).trim();
      if (sys && SYS_MAP[sys]) systemsSet.add(SYS_MAP[sys]);
    }
  }

  out.systems = Array.from(systemsSet);
  if (out.timeFirstObs && out.timeLastObs) {
    out.durationSeconds = Math.round(
      (out.timeLastObs.getTime() - out.timeFirstObs.getTime()) / 1000
    );
  }
  return out;
}
