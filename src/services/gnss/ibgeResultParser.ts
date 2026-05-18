// Parser do .txt de retorno do IBGE-PPP. Aceita Buffer (decodifica latin1 que
// e o encoding padrao da IBGE). Tolerante a variacoes de espacamento e sinais.

import iconv from 'iconv-lite';

export interface IbgeResult {
  refGeodesico: string;
  latitudeGraus: number | null;
  longitudeGraus: number | null;
  altitudeGeometricaM: number | null;
  altitudeOrtometricaM: number | null;
  modeloGeoidal: string | null;
  utmZona: number | null;
  utmHemisferio: 'N' | 'S' | null;
  utmMc: number | null;
  utmNorteM: number | null;
  utmLesteM: number | null;
  sigmaLatM: number | null;
  sigmaLonM: number | null;
  sigmaAltM: number | null;
}

function decode(buf: Buffer): string {
  // Tenta UTF-8 primeiro; se vier replacement char em excesso, refaz como latin1
  const utf = buf.toString('utf8');
  if ((utf.match(/�/g)?.length ?? 0) > 2) {
    return iconv.decode(buf, 'latin1');
  }
  return utf;
}

function dms2deg(g: number, m: number, s: number, hem: string): number {
  const mag = Math.abs(g) + m / 60 + s / 3600;
  const isNeg = hem === 'S' || hem === 'W' || g < 0;
  return isNeg ? -mag : mag;
}

function num(s: string): number | null {
  const x = Number(s.replace(/\s+/g, ''));
  return Number.isFinite(x) ? x : null;
}

export function parseIbgeResultTxt(input: Buffer | string): IbgeResult {
  const txt = typeof input === 'string' ? input : decode(input);

  const out: IbgeResult = {
    refGeodesico: 'SIRGAS2000',
    latitudeGraus: null, longitudeGraus: null,
    altitudeGeometricaM: null, altitudeOrtometricaM: null,
    modeloGeoidal: null,
    utmZona: null, utmHemisferio: null, utmMc: null,
    utmNorteM: null, utmLesteM: null,
    sigmaLatM: null, sigmaLonM: null, sigmaAltM: null,
  };

  // Latitude (com SIGMA na mesma linha)
  const mLat = txt.match(
    /LATITUDE\s*=\s*([-+]?\d{1,2})\s+(\d{1,2})\s+([\d.]+)\s*([NS])(?:[^\n]*?SIGMA\s*=\s*([\d.]+)\s*m)?/i
  );
  if (mLat) {
    out.latitudeGraus = dms2deg(Number(mLat[1]), Number(mLat[2]), Number(mLat[3]), mLat[4]);
    out.sigmaLatM = mLat[5] ? Number(mLat[5]) : null;
  }
  const mLon = txt.match(
    /LONGITUDE\s*=\s*([-+]?\d{1,3})\s+(\d{1,2})\s+([\d.]+)\s*([EW])(?:[^\n]*?SIGMA\s*=\s*([\d.]+)\s*m)?/i
  );
  if (mLon) {
    out.longitudeGraus = dms2deg(Number(mLon[1]), Number(mLon[2]), Number(mLon[3]), mLon[4]);
    out.sigmaLonM = mLon[5] ? Number(mLon[5]) : null;
  }

  const mGeom = txt.match(/ALT\s*GEOM\.?\s*=\s*([-+]?[\d.]+)\s*m(?:[^\n]*?SIGMA\s*=\s*([\d.]+))?/i);
  if (mGeom) {
    out.altitudeGeometricaM = num(mGeom[1]);
    out.sigmaAltM = mGeom[2] ? Number(mGeom[2]) : null;
  }

  const mOrt = txt.match(/ALT\s*ORTOM\.?\s*=\s*([-+]?[\d.]+)\s*m\s*\(([^)]+)\)/i);
  if (mOrt) {
    out.altitudeOrtometricaM = num(mOrt[1]);
    out.modeloGeoidal = mOrt[2].trim();
  }

  const mZona = txt.match(/ZONA\s*(\d{1,2})\s*([NS])/i);
  if (mZona) { out.utmZona = Number(mZona[1]); out.utmHemisferio = mZona[2].toUpperCase() as 'N' | 'S'; }
  const mMc = txt.match(/MC\s*([-+]?\d{1,3})\s*W/i);
  if (mMc) out.utmMc = -Math.abs(Number(mMc[1]));
  const mN = txt.match(/\bN\s*=\s*([\d\s.,]+?)\s*m/i);
  if (mN) out.utmNorteM = num(mN[1]);
  const mE = txt.match(/\bE\s*=\s*([\d\s.,]+?)\s*m/i);
  if (mE) out.utmLesteM = num(mE[1]);

  if (/SIRGAS2000/i.test(txt)) out.refGeodesico = 'SIRGAS2000';
  else if (/WGS\s*84/i.test(txt)) out.refGeodesico = 'WGS84';

  return out;
}
