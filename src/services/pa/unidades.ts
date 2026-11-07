// v3.157.0: área sempre nas duas grandezas — hectare e alqueire.
// 1 alqueire = 4,84 ha (48.400 m²), padrão do MA confirmado pelo CEO
// (mesmo valor de src/services/memorialDescritivo.ts e src/pdf/mappers.ts).
export const ALQUEIRE_HA = 4.84;

const br = (v: number, d: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Hectares -> alqueires (4,84 ha). */
export function haParaAlqueires(ha: number): number {
  return ha / ALQUEIRE_HA;
}

/** "7,3487 alqueires" (singular quando exatamente 1). */
export function alqueiresTxt(ha: number, d = 4): string {
  const a = haParaAlqueires(ha);
  return `${br(a, d)} ${Math.abs(a - 1) < 1e-12 ? 'alqueire' : 'alqueires'}`;
}

/** "35,5676 ha (7,3487 alqueires)" — forma usada nos memoriais e quadros. */
export function haAlq(ha: number, d = 4): string {
  return `${br(ha, d)} ha (${alqueiresTxt(ha, d)})`;
}

/** Forma curta para rótulos de mapa: "35,5676 ha · 7,3487 alq." */
export function haAlqCurto(ha: number, d = 4): string {
  return `${br(ha, d)} ha · ${br(haParaAlqueires(ha), d)} alq.`;
}
