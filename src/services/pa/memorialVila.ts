// v3.146.0 — Memorial descritivo dos lotes da vila (a partir do croqui + desenho).
//
// Para cada lote: frente, fundos, lateral direita e lateral esquerda (medida e
// confrontante), área e perímetro. Confrontante é descoberto olhando 5 m para
// fora do meio de cada lado: outro lote, área comunitária (praça, equipamentos,
// área verde) ou via (nome da rua mais próxima no desenho do layout).
// Frente = lado menor voltado para uma via (prefere rua/avenida à perimetral).
// Lateral direita/esquerda = vista de quem está na rua olhando para o lote.
import type { DesenhoLayout } from './layoutDesenho';

type P = [number, number];
export interface LoteCroqui { numero: string; xy: number[][]; institucional?: boolean }
export interface LadoMemorial { medida: number; confrontante: string }
export interface MemorialLote {
  numero: string; institucional: boolean;
  frente: LadoMemorial; fundos: LadoMemorial; direita: LadoMemorial; esquerda: LadoMemorial;
  area_m2: number; perimetro_m: number;
}

function dentro(pt: P, poly: number[][]): boolean {
  let ok = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}
function distSeg(p: P, a: P, b: P): { d: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}
function area(xy: number[][]): number {
  let s = 0;
  for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
const r2 = (v: number) => Math.round(v * 100) / 100;
const titulo = (s: string) => s.toLowerCase().replace(/(^|\s|\()\S/g, (c) => c.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

/** Nome da via mais próxima de um ponto: eixo mais perto → rótulo de via sobre esse eixo. */
function viaMaisProxima(pt: P, d: DesenhoLayout | null, dirLado?: P): string {
  if (!d) return 'via pública';
  const vias = d.rotulos.filter((r) => r.estilo === 'via');
  if (!vias.length) return 'via pública';
  let melhorEixo: [P, P] | null = null, md = Infinity;
  // Só eixos paralelos ao lado do lote (±30°): a rua da frente/fundos corre na mesma direção do lado.
  const paralelo = (a: P, b: P) => {
    if (!dirLado) return true;
    const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1, Ld = Math.hypot(dirLado[0], dirLado[1]) || 1;
    return Math.abs((ex * dirLado[0] + ey * dirLado[1]) / (L * Ld)) > Math.cos(Math.PI / 6);
  };
  const eixos = d.eixos.filter(([a, b]) => paralelo(a as P, b as P));
  for (const [a, b] of (eixos.length ? eixos : d.eixos)) { const { d: dd } = distSeg(pt, a as P, b as P); if (dd < md) { md = dd; melhorEixo = [a as P, b as P]; } }
  const candidatos = melhorEixo
    ? vias.filter((r) => distSeg([r.x, r.y], melhorEixo![0], melhorEixo![1]).d < 4)
    : [];
  const lista = candidatos.length ? candidatos : vias;
  lista.sort((x, y) => {
    const px = Math.hypot(x.x - pt[0], x.y - pt[1]) + (/ACESSO/i.test(x.texto) ? 400 : 0);
    const py = Math.hypot(y.x - pt[0], y.y - pt[1]) + (/ACESSO/i.test(y.texto) ? 400 : 0);
    return px - py;
  });
  return titulo(lista[0].texto.replace(/\s*[–-]\s*\d+\s*m$/i, '').replace(/\s*\(DIAGONAL\)/i, ' (diagonal)'));
}

/** Nome de uma área comunitária: rótulo mais próximo dentro do polígono. */
function nomeArea(poly: number[][], tipo: string, d: DesenhoLayout): string {
  const dentroRot = d.rotulos.filter((r) => r.estilo !== 'via' && dentro([r.x, r.y], poly));
  if (dentroRot.length) return titulo(dentroRot.map((r) => r.texto).join(' / '));
  return tipo === 'praca' ? 'Praça' : tipo === 'verde' ? 'Área Verde' : 'Área de equipamentos comunitários';
}

export function memorialVila(lotes: LoteCroqui[], d: DesenhoLayout | null): MemorialLote[] {
  const validos = lotes.filter((l) => Array.isArray(l.xy) && l.xy.length >= 3);
  const out: MemorialLote[] = [];
  for (const l of validos) {
    const xy = l.xy;
    const cx = xy.reduce((s, p) => s + p[0], 0) / xy.length, cy = xy.reduce((s, p) => s + p[1], 0) / xy.length;
    const lados = xy.map((a, i) => {
      const b = xy[(i + 1) % xy.length];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
      if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) { nx = -nx; ny = -ny; } // normal para fora
      const fora: P = [mx + nx * 5, my + ny * 5];
      let conf = '', ehVia = false;
      const viz = validos.find((o) => o !== l && dentro(fora, o.xy));
      if (viz) conf = `Lote ${viz.numero}${viz.institucional ? ' (área institucional)' : ''}`;
      else if (d) {
        const ar = d.areas.find((x) => x.tipo !== 'viario' && dentro(fora, x.pts));
        if (ar) conf = nomeArea(ar.pts, ar.tipo, d);
        else { conf = viaMaisProxima(fora, d, [b[0] - a[0], b[1] - a[1]]); ehVia = true; }
      } else { conf = 'via pública'; ehVia = true; }
      return { len, mx, my, conf, ehVia };
    });
    // Frente: lado voltado para via — prefere o lado menor e rua/avenida (não perimetral).
    const minLen = Math.min(...lados.map((x) => x.len));
    const pontuar = (x: typeof lados[number]) => (x.ehVia ? 100 : 0) + (Math.abs(x.len - minLen) < 0.5 ? 20 : 0) + (x.ehVia && !/perimetral/i.test(x.conf) ? 10 : 0);
    let iF = 0;
    lados.forEach((x, i) => { if (pontuar(x) > pontuar(lados[iF])) iF = i; });
    const n = lados.length;
    const F = lados[iF];
    const iFundo = n === 4 ? (iF + 2) % 4 : lados.reduce((best, x, i) => (Math.hypot(x.mx - F.mx, x.my - F.my) > Math.hypot(lados[best].mx - F.mx, lados[best].my - F.my) ? i : best), (iF + 1) % n);
    // Direita/esquerda de quem está na frente olhando para dentro (y para baixo no croqui).
    const vx = cx - F.mx, vy = cy - F.my;
    const dirx = -vy, diry = vx;
    const restantes = lados.map((x, i) => i).filter((i) => i !== iF && i !== iFundo);
    const lado = (i: number) => ({ medida: r2(lados[i].len), confrontante: lados[i].conf });
    let iD = restantes[0], iE = restantes[1] ?? restantes[0];
    if (restantes.length >= 2) {
      const dot = (i: number) => (lados[i].mx - cx) * dirx + (lados[i].my - cy) * diry;
      if (dot(restantes[0]) < dot(restantes[1])) { iD = restantes[1]; iE = restantes[0]; }
    }
    out.push({
      numero: l.numero, institucional: !!l.institucional,
      frente: lado(iF), fundos: lado(iFundo), direita: lado(iD), esquerda: lado(iE),
      area_m2: r2(area(xy)), perimetro_m: r2(lados.reduce((s, x) => s + x.len, 0)),
    });
  }
  return out.sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero));
}

const fm = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Parágrafo do memorial de um lote. */
export function textoMemorialLote(m: MemorialLote, projeto: string): string {
  return `Lote ${m.numero}${m.institucional ? ' (área institucional — reserva para a comunidade)' : ''} do ${projeto}, com área de ${fm(m.area_m2)} m² e perímetro de ${fm(m.perimetro_m)} m: `
    + `frente com ${fm(m.frente.medida)} m para ${m.frente.confrontante}; fundos com ${fm(m.fundos.medida)} m confrontando com ${m.fundos.confrontante}; `
    + `lateral direita com ${fm(m.direita.medida)} m confrontando com ${m.direita.confrontante}; lateral esquerda com ${fm(m.esquerda.medida)} m confrontando com ${m.esquerda.confrontante}.`;
}
