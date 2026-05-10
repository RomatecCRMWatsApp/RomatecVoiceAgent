// src/services/croquiHelpers.ts
//
// v3.1.0: Helpers puros para renderizacao do croqui modelo INCRA.
// Usados por croquiSvg.ts (server-side) e espelhados em obras.html
// (client-side, vanilla JS) — sem teste de paridade nesta rodada
// porque as 3 funcoes sao matematicamente triviais.

export interface PontoUtm {
  utm_e: number;
  utm_n: number;
}

/**
 * Centroide aritmetico (media de X e Y).
 * Para poligonos irregulares pode ter pequeno desvio do centroide
 * geometrico real, mas para fins visuais (label da area no centro) e suficiente.
 */
export function calcularCentroide(pontos: PontoUtm[]): { x: number; y: number } {
  const n = pontos.length;
  if (n === 0) return { x: 0, y: 0 };
  const sumX = pontos.reduce((s, p) => s + p.utm_e, 0);
  const sumY = pontos.reduce((s, p) => s + p.utm_n, 0);
  return { x: sumX / n, y: sumY / n };
}

/**
 * Formata area para exibicao no centro do poligono.
 * - RURAL: ha com 4 casas decimais (ex: "19,5300 ha")
 * - URBANO: m² com 2 casas decimais e separador de milhar (ex: "1.500,00 m²")
 */
export function formatarAreaParaCentro(
  area_m2: number,
  tipo_imovel: 'URBANO' | 'RURAL',
): string {
  if (tipo_imovel === 'RURAL') {
    const ha = area_m2 / 10000;
    return ha.toFixed(4).replace('.', ',') + ' ha';
  }
  // URBANO: m² com formato pt-BR
  const fmt = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return fmt.format(area_m2) + ' m²';
}

/**
 * Calcula o Meridiano Central (MC) a partir da zona UTM.
 * Formula: MC = -180 + (zona × 6) - 3
 * - Zona 23 → -45° (Açailândia/MA, padrao do projeto)
 * - Zona 22 → -51°
 * - Zona 24 → -39°
 */
export function calcularMC(zona: number): number {
  return -180 + zona * 6 - 3;
}
