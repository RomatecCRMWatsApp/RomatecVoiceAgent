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

  // v3.20.3: FALLBACK pro formato COMPACTO do IBGE-PPP (pos-2024).
  // Diferente do verboso: campos abreviados (LAT, LON, HGEO, HNOR, UTMN, UTME),
  // sem sinal de igual, sem sufixo N/S/E/W, virgula decimal brasileira, sigmas
  // em linhas separadas (SLAT, SLON, SHGEO).
  // Exemplo:
  //   LAT    -4 56 06,8448
  //   LON    -47 30 24,9097
  //   HGEO   205,22 m
  //   HNOR   230,29 m
  //   UTMN   9453971,255 m
  //   UTME   221981,971 m
  //   MC     -45
  if (out.latitudeGraus == null) {
    const numBr = (s: string) => Number(s.trim().replace(/\./g, '').replace(',', '.'));
    const numBrSimples = (s: string) => Number(s.trim().replace(',', '.'));

    const mLatC = txt.match(/^\s*LAT\s+([-+]?\d{1,2})\s+(\d{1,2})\s+([\d.,]+)\s*$/m);
    if (mLatC) {
      const g = Number(mLatC[1]);
      const m = Number(mLatC[2]);
      const s = numBrSimples(mLatC[3]);
      const abs = Math.abs(g) + m / 60 + s / 3600;
      out.latitudeGraus = g < 0 ? -abs : abs;
    }
    const mLonC = txt.match(/^\s*LON\s+([-+]?\d{1,3})\s+(\d{1,2})\s+([\d.,]+)\s*$/m);
    if (mLonC) {
      const g = Number(mLonC[1]);
      const m = Number(mLonC[2]);
      const s = numBrSimples(mLonC[3]);
      const abs = Math.abs(g) + m / 60 + s / 3600;
      out.longitudeGraus = g < 0 ? -abs : abs;
    }

    // Sigmas
    const mSlat = txt.match(/^\s*SLAT\s+([\d.,]+)\s*m/m);
    if (mSlat) out.sigmaLatM = numBrSimples(mSlat[1]);
    const mSlon = txt.match(/^\s*SLON\s+([\d.,]+)\s*m/m);
    if (mSlon) out.sigmaLonM = numBrSimples(mSlon[1]);
    const mShgeo = txt.match(/^\s*SHGEO\s+([\d.,]+)\s*m/m);
    if (mShgeo) out.sigmaAltM = numBrSimples(mShgeo[1]);

    // Altitudes
    const mHgeo = txt.match(/^\s*HGEO\s+([-+]?[\d.,]+)\s*m/m);
    if (mHgeo) out.altitudeGeometricaM = numBrSimples(mHgeo[1]);
    const mHnor = txt.match(/^\s*HNOR\s+([-+]?[\d.,]+)\s*m/m);
    if (mHnor) out.altitudeOrtometricaM = numBrSimples(mHnor[1]);
    const mModelo = txt.match(/^\s*MODELO\s+(\S+)/m);
    if (mModelo) out.modeloGeoidal = mModelo[1];

    // UTM (linhas separadas no compacto)
    const mUtmN = txt.match(/^\s*UTMN\s+([\d.,]+)\s*m/m);
    if (mUtmN) out.utmNorteM = numBr(mUtmN[1]);
    const mUtmE = txt.match(/^\s*UTME\s+([\d.,]+)\s*m/m);
    if (mUtmE) out.utmLesteM = numBr(mUtmE[1]);
    const mMcC = txt.match(/^\s*MC\s+([-+]?\d{1,3})\b/m);
    if (mMcC && out.utmMc == null) out.utmMc = Number(mMcC[1]);

    // Datum (compacto tem "DATUM  SIRGAS2000, época 2000.4")
    const mDatumC = txt.match(/^\s*DATUM\s+(SIRGAS\s*\d+|WGS\s*\d+)/im);
    if (mDatumC) out.refGeodesico = mDatumC[1].replace(/\s+/g, '');

    // Hemisferio derivado do sinal da latitude
    if (out.latitudeGraus != null && out.utmHemisferio == null) {
      out.utmHemisferio = out.latitudeGraus < 0 ? 'S' : 'N';
    }
    // Zona derivada da longitude (se nao veio explicita)
    if (out.utmZona == null && out.longitudeGraus != null) {
      out.utmZona = Math.floor((out.longitudeGraus + 180) / 6) + 1;
    }
  }

  return out;
}
