// v3.142.1 — Elementos do desenho do layout (vias, praça, equipamentos, áreas
// verdes, rótulos) para o mapa da tela ficar igual ao PDF do kit
// (tools/pa-docs/mapa_layout_modelo.py). Coordenadas em METROS no mesmo sistema
// do croqui dos lotes: x → direita, y → BAIXO (igual ao gerador).
//
// Projeto com `layout_json.desenho` usa o que estiver lá; senão cai no desenho
// padrão do código do projeto (hoje só o PA Salete Moreno). Só geometria — sem
// dado pessoal.

export type Pt = [number, number];
export interface DesenhoLayout {
  areas: Array<{ tipo: 'viario' | 'praca' | 'equipamento' | 'verde'; pts: Pt[] }>;
  caminhos: Array<{ pts: Pt[]; largura: number; cor: string }>;
  eixos: Array<[Pt, Pt]>;
  icones: Array<{ tipo: 'arvore' | 'fonte' | 'saude' | 'ambulancia' | 'estacionamento' | 'quadra' | 'escola' | 'quiosque'; x: number; y: number; w?: number; h?: number; r?: number }>;
  rotulos: Array<{ x: number; y: number; texto: string; rot?: number; estilo: 'via' | 'verde' | 'equip' | 'praca'; tam?: number }>;
  cotas: Array<{ x1: number; y1: number; x2: number; y2: number; texto: string }>;
  limites: { minX: number; minY: number; maxX: number; maxY: number };
}

function salete(): DesenhoLayout {
  const m = 130 / 180;
  const up = (x: number) => 200 + (330 - x) * m;
  const off = 10 * Math.sqrt(1 + m * m);
  const lo = (x: number) => up(x) + off;
  const xl = 330 - ((340 - off) - 200) / m;
  const xb = 330 - 60 / m;
  const xg = 330 - 70 / m;
  const ang = -(Math.atan(m) * 180) / Math.PI; // SVG: y para baixo → rotação negativa

  const arvores: Array<[number, number, number]> = [
    [190, 62, 5], [205, 58, 4], [255, 58, 4], [270, 62, 5], [190, 158, 5], [207, 160, 4], [253, 160, 4], [270, 158, 5],
    [230, 60, 3.5], [230, 162, 3.5], [196, 90, 3.5], [264, 132, 3.5], [196, 132, 3.5], [264, 90, 3.5],
    [147, 278, 4.5], [165, 277, 3.6], [184, 278, 3.2], [203, 278, 2.8], [147, 296, 3.6], [146, 318, 3.2], [156, 322, 2.6],
    [294, 204, 2.4], [294, 222, 2.2],
  ];
  const VERDE: Pt[] = [[140, 270], [xg, 270], [150, 330], [140, 330]];
  const VERDE2: Pt[] = [[290, 200], [330, 200], [290, up(290)]];
  const centroide = (p: Pt[]): Pt => {
    let a = 0, cx = 0, cy = 0;
    p.forEach(([x0, y0], i) => { const [x1, y1] = p[(i + 1) % p.length]; const cr = x0 * y1 - x1 * y0; a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr; });
    a /= 2;
    return [cx / (6 * a), cy / (6 * a)];
  };
  const cv = centroide(VERDE), cv2 = centroide(VERDE2);

  const cotasH: Array<[number, number]> = [[-10, 0], [0, 40], [40, 50], [50, 90], [90, 110], [110, 130], [130, 170], [170, 180], [180, 200], [200, 220], [220, 240], [240, 260], [260, 280], [280, 290], [290, 330], [330, 340]];
  const f = (v: number) => v.toFixed(2).replace('.', ',');

  return {
    areas: [
      { tipo: 'viario', pts: [[-10, -10], [340, -10], [340, lo(340)], [xl, 340], [-10, 340]] },
      { tipo: 'viario', pts: [[40, 340], [50, 340], [50, 360], [40, 360]] },
      { tipo: 'praca', pts: [[180, 50], [280, 50], [280, 170], [180, 170]] },
      { tipo: 'equipamento', pts: [[180, 180], [230, 180], [230, 260], [180, 260]] },
      { tipo: 'equipamento', pts: [[230, 180], [280, 180], [280, up(280)], [xb, 260], [230, 260]] },
      { tipo: 'verde', pts: VERDE },
      { tipo: 'verde', pts: VERDE2 },
    ],
    caminhos: [
      { pts: [[180, 50], [280, 170]], largura: 6, cor: '#E9E4D6' },
      { pts: [[280, 50], [180, 170]], largura: 6, cor: '#E9E4D6' },
    ],
    eixos: [
      [[-10, 85], [170, 85]], [[-10, 175], [170, 175]], [[-10, 265], [170, 265]], [[-10, 335], [xl + 6, 335]],
      [[45, -10], [45, 360]], [[175, 40], [175, 265]], [[285, 40], [285, up(285)]], [[135, 270], [135, 330]],
      [[-5, -5], [335, -5]], [[-5, -5], [-5, 335]], [[335, -5], [335, up(335) + off / 2]], [[180, 45], [280, 45]],
      [[340, up(340) + off / 2], [xl - 2, up(xl - 2) + off / 2]],
    ],
    icones: [
      ...arvores.map(([x, y, r]) => ({ tipo: 'arvore' as const, x, y, r })),
      { tipo: 'fonte', x: 230, y: 110, r: 13 },
      { tipo: 'quiosque', x: 186, y: 103, w: 16, h: 13 },
      { tipo: 'quiosque', x: 258, y: 103, w: 16, h: 13 },
      { tipo: 'saude', x: 186, y: 194, w: 24, h: 18 },
      { tipo: 'ambulancia', x: 213, y: 203, w: 11, h: 5 },
      { tipo: 'estacionamento', x: 186, y: 228, w: 38, h: 22 },
      { tipo: 'quadra', x: 234, y: 184, w: 42, h: 22 },
      { tipo: 'escola', x: 234, y: 222, w: 26, h: 16 },
    ],
    rotulos: [
      { x: 230, y: 54, texto: 'PRAÇA CENTRAL', estilo: 'praca' },
      { x: 205, y: 184, texto: 'POSTO DE SAÚDE', estilo: 'equip' },
      { x: 205, y: 242, texto: 'ESTACIONAMENTO', estilo: 'equip', tam: 3 },
      { x: 255, y: 211, texto: 'QUADRA POLIESPORTIVA', estilo: 'equip', tam: 3 },
      { x: 247, y: 245, texto: 'ESCOLA', estilo: 'equip' },
      { x: cv[0], y: cv[1], texto: 'ÁREA VERDE', estilo: 'verde' },
      { x: cv2[0], y: cv2[1], texto: 'ÁREA VERDE', estilo: 'verde', tam: 2.6 },
      { x: 45, y: 150, texto: 'AVENIDA PRINCIPAL – 10 m', rot: -90, estilo: 'via' },
      { x: 45, y: 350, texto: 'ACESSO', rot: -90, estilo: 'via' },
      { x: 110, y: 85, texto: 'RUA 01 – 10 m', estilo: 'via' },
      { x: 110, y: 175, texto: 'RUA 02 – 10 m', estilo: 'via' },
      { x: 110, y: 265, texto: 'RUA 03 – 10 m', estilo: 'via' },
      { x: 80, y: 335, texto: 'RUA 04 – 10 m', estilo: 'via' },
      { x: 175, y: 135, texto: 'RUA 05 – 10 m', rot: -90, estilo: 'via' },
      { x: 285, y: 120, texto: 'RUA 06 – 10 m', rot: -90, estilo: 'via' },
      { x: 135, y: 300, texto: 'RUA 07 – 10 m', rot: -90, estilo: 'via' },
      { x: 230, y: 45, texto: 'RUA 09 – 10 m', estilo: 'via' },
      { x: 275, y: up(275) + off / 2, texto: 'RUA 08 (DIAGONAL) – 10 m', rot: ang, estilo: 'via' },
      { x: 90, y: -5, texto: 'RUA PERIMETRAL – 10 m', estilo: 'via' },
      { x: -5, y: 130, texto: 'RUA PERIMETRAL – 10 m', rot: -90, estilo: 'via' },
      { x: 335, y: 110, texto: 'RUA PERIMETRAL – 10 m', rot: -90, estilo: 'via' },
    ],
    cotas: [
      ...cotasH.map(([a, b]) => ({ x1: a, y1: -15, x2: b, y2: -15, texto: f(b - a) })),
      { x1: -10, y1: -24, x2: 340, y2: -24, texto: '350,00 m' },
      { x1: -17, y1: -10, x2: -17, y2: 340, texto: '350,00 m' },
    ],
    limites: { minX: -26, minY: -32, maxX: 352, maxY: 364 },
  };
}

const PADRAO: Record<string, () => DesenhoLayout> = { 'PA-SALETE-MORENO': salete };

export function desenhoDoProjeto(codigo: string, layoutJson: unknown): DesenhoLayout | null {
  const lj = layoutJson as { desenho?: DesenhoLayout } | null;
  if (lj && lj.desenho && Array.isArray(lj.desenho.areas)) return lj.desenho;
  const fn = PADRAO[codigo];
  return fn ? fn() : null;
}
