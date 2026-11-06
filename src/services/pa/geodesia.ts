// v3.154.0 — Cálculos geodésicos no padrão do SIGEF (elipsoide GRS80 / SIRGAS 2000):
// azimute e distância geodésicos (Vincenty, problema inverso) e área no Sistema
// Geodésico Local (plano topocêntrico com origem no centroide). Funções puras.
const A = 6378137, F = 1 / 298.257222101, B = A * (1 - F);
const rad = Math.PI / 180;

/** Inverso de Vincenty: distância (m) e azimute inicial (graus) de P1 → P2. */
export function inversoGeodesico(lat1: number, lon1: number, lat2: number, lon2: number): { distancia: number; azimute: number } {
  const L = (lon2 - lon1) * rad;
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * rad)), U2 = Math.atan((1 - F) * Math.tan(lat2 * rad));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, lamAnt = 0, it = 0;
  let sSig = 0, cSig = 0, sig = 0, c2a = 0, c2sm = 0, sLam = 0, cLam = 0;
  do {
    sLam = Math.sin(lam); cLam = Math.cos(lam);
    sSig = Math.hypot(cU2 * sLam, cU1 * sU2 - sU1 * cU2 * cLam);
    if (sSig === 0) return { distancia: 0, azimute: 0 };
    cSig = sU1 * sU2 + cU1 * cU2 * cLam;
    sig = Math.atan2(sSig, cSig);
    const sA = (cU1 * cU2 * sLam) / sSig;
    c2a = 1 - sA * sA;
    c2sm = c2a ? cSig - (2 * sU1 * sU2) / c2a : 0;
    const C = (F / 16) * c2a * (4 + F * (4 - 3 * c2a));
    lamAnt = lam;
    lam = L + (1 - C) * F * sA * (sig + C * sSig * (c2sm + C * cSig * (-1 + 2 * c2sm * c2sm)));
  } while (Math.abs(lam - lamAnt) > 1e-12 && ++it < 200);
  const u2 = (c2a * (A * A - B * B)) / (B * B);
  const Ak = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bk = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSig = Bk * sSig * (c2sm + (Bk / 4) * (cSig * (-1 + 2 * c2sm * c2sm) - (Bk / 6) * c2sm * (-3 + 4 * sSig * sSig) * (-3 + 4 * c2sm * c2sm)));
  const distancia = B * Ak * (sig - dSig);
  const az = Math.atan2(cU2 * sLam, cU1 * sU2 - sU1 * cU2 * cLam) / rad;
  return { distancia, azimute: (az + 360) % 360 };
}

function ecef(lat: number, lon: number, h = 0): [number, number, number] {
  const e2 = F * (2 - F), sl = Math.sin(lat * rad), N = A / Math.sqrt(1 - e2 * sl * sl);
  return [(N + h) * Math.cos(lat * rad) * Math.cos(lon * rad), (N + h) * Math.cos(lat * rad) * Math.sin(lon * rad), (N * (1 - e2) + h) * sl];
}

/** Área (m²) no Sistema Geodésico Local: projeta os vértices no plano topocêntrico do centroide. */
export function areaGeodesicaLocal(pts: Array<{ lat: number; lon: number }>): number {
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon0 = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const [x0, y0, z0] = ecef(lat0, lon0);
  const sf = Math.sin(lat0 * rad), cf = Math.cos(lat0 * rad), sl = Math.sin(lon0 * rad), cl = Math.cos(lon0 * rad);
  const enu = pts.map((p) => {
    const [x, y, z] = ecef(p.lat, p.lon); const dx = x - x0, dy = y - y0, dz = z - z0;
    return { e: -sl * dx + cl * dy, n: -sf * cl * dx - sf * sl * dy + cf * dz };
  });
  let s = 0;
  for (let i = 0; i < enu.length; i++) { const a = enu[i], b = enu[(i + 1) % enu.length]; s += a.e * b.n - b.e * a.n; }
  return Math.abs(s / 2);
}

/** Coordenada no formato do SIGEF: -47°30'19,620" (sinal, graus, minutos, segundos com 3 casas). */
export function dmsSigef(v: number): string {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  let d = Math.floor(a), m = Math.floor((a - d) * 60), seg = Math.round(((a - d) * 60 - m) * 60 * 1000) / 1000;
  if (seg >= 60) { seg -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  return `${s}${d}°${String(m).padStart(2, '0')}'${seg.toFixed(3).padStart(6, '0').replace('.', ',')}"`;
}

/** Azimute no formato do SIGEF: 104°48' (graus e minutos arredondados). */
export function azimuteSigef(g: number): string {
  let t = Math.round(g * 60);
  if (t >= 360 * 60) t -= 360 * 60;
  return `${String(Math.floor(t / 60)).padStart(3, '0')}°${String(t % 60).padStart(2, '0')}'`;
}
