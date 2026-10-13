// v3.144.0 — Código de barras do boleto (FEBRABAN) a partir da linha digitável.
//
// Linha digitável (47 dígitos):  AAABC CCCCX DDDDD DDDDDY EEEEE EEEEEZ K UUUUVVVVVVVVVV
// Código de barras  (44 dígitos): AAAB K UUUU VVVVVVVVVV CCCCC DDDDDDDDDD EEEEEEEEEE
// Desenho: Interleaved 2 of 5 (ITF), barra larga = 3× a estreita.

export function linhaParaCodigoBarras(linha: string): string {
  const d = String(linha || '').replace(/\D/g, '');
  if (d.length !== 47) throw new Error(`Linha digitável deve ter 47 dígitos (veio ${d.length})`);
  const cod = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  if (!codigoBarrasValido(cod)) throw new Error('Linha digitável com dígito verificador geral inválido');
  return cod;
}

/** DV geral (posição 5) do código de barras — módulo 11, pesos 2..9; 0/10/11 → 1. */
export function dvCodigoBarras(cod44: string): number {
  const sem = cod44.slice(0, 4) + cod44.slice(5);
  let soma = 0, peso = 2;
  for (let i = sem.length - 1; i >= 0; i--) {
    soma += Number(sem[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = 11 - (soma % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}

export function codigoBarrasValido(cod44: string): boolean {
  return /^\d{44}$/.test(cod44) && Number(cod44[4]) === dvCodigoBarras(cod44);
}

/** "46191110000000000000013555124018515980000030000" → "46191.11000 00000.000000 13555.124018 5 15980000030000" */
export function formatarLinhaDigitavel(linha: string): string {
  const d = String(linha || '').replace(/\D/g, '');
  if (d.length !== 47) return linha;
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
}

const ITF: Record<string, string> = {
  '0': 'nnwwn', '1': 'wnnnw', '2': 'nwnnw', '3': 'wwnnn', '4': 'nnwnw',
  '5': 'wnwnn', '6': 'nwwnn', '7': 'nnnww', '8': 'wnnwn', '9': 'nwnwn',
};

/**
 * SVG do código de barras ITF (44 dígitos). Medidas em mm: largura total
 * ≈ 103 mm e altura 13 mm (padrão FEBRABAN). Retorna o <svg> pronto.
 */
export function svgCodigoBarras(cod44: string, alturaMm = 13): string {
  if (!/^\d{44}$/.test(cod44)) throw new Error('Código de barras deve ter 44 dígitos');
  const seq: Array<{ barra: boolean; larga: boolean }> = [];
  // início: barra estreita, espaço estreito, barra estreita, espaço estreito
  for (const b of [true, false, true, false]) seq.push({ barra: b, larga: false });
  for (let i = 0; i < 44; i += 2) {
    const pb = ITF[cod44[i]], ps = ITF[cod44[i + 1]];
    for (let k = 0; k < 5; k++) {
      seq.push({ barra: true, larga: pb[k] === 'w' });
      seq.push({ barra: false, larga: ps[k] === 'w' });
    }
  }
  // fim: barra larga, espaço estreito, barra estreita
  seq.push({ barra: true, larga: true }, { barra: false, larga: false }, { barra: true, larga: false });
  const unidades = seq.reduce((s, e) => s + (e.larga ? 3 : 1), 0);
  const estreita = 103 / unidades;
  let x = 0;
  let rects = '';
  for (const e of seq) {
    const w = (e.larga ? 3 : 1) * estreita;
    if (e.barra) rects += `<rect x="${x.toFixed(4)}" y="0" width="${w.toFixed(4)}" height="${alturaMm}"/>`;
    x += w;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x.toFixed(2)}mm" height="${alturaMm}mm" viewBox="0 0 ${x.toFixed(4)} ${alturaMm}" shape-rendering="crispEdges" fill="#000">${rects}</svg>`;
}
