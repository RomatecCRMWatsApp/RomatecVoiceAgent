// v1.99.27 — Gerador de croqui SVG do laudo de demarcacao.
// Renderiza poligonal a partir de pontos UTM, com escala automatica,
// rotulos dos vertices, medidas dos lados e indicador de norte.
//
// Saida: string SVG (XML). Pode ser embutida no HTML ou convertida
// pra raster pra inserir no PDF.

import { calcularCentroide, formatarAreaParaCentro, calcularMC } from './croquiHelpers';

export interface PontoSvg {
  rotulo: string;
  e: number;
  n: number;
}

export interface LadoSvg {
  i_idx: number;
  f_idx: number;
  distancia_m: number;
}

export interface CroquiOpcoes {
  /** Largura do SVG em pixels. Default 600 */
  larguraPx?: number;
  /** Altura do SVG em pixels. Default 600 */
  alturaPx?: number;
  /** Cor da poligonal. Default verde Romatec. */
  corPoligonal?: string;
  /** Mostra rotulos dos vertices */
  mostrarRotulos?: boolean;
  /** Mostra distancias nos lados */
  mostrarDistancias?: boolean;
  /** Mostra indicador de norte */
  mostrarNorte?: boolean;
  /** v3.1.0: tipo do imovel pra formatacao da area */
  tipoImovel?: 'URBANO' | 'RURAL';
  /** v3.1.0: area total em m² (renderizada no centro) */
  areaTotalM2?: number;
  /** v3.1.0: zona UTM (renderizada na tarjeta SIRGAS) */
  utmZona?: number;
  /** v3.1.0: hemisferio UTM ('S' ou 'N'). Default 'S' (Brasil). */
  utmHemisferio?: string;
  /**
   * v3.63.0: ordens (1-based, posicao no array `lados`) dos lados a DESTACAR —
   * usado no croqui de Alinhamento de Cerca. Os destacados saem em dourado
   * tracejado (#C9A84C, espessura 4, dash 8 4), cota em negrito dourado com
   * sufixo "(ALINHAR)", e ganha legenda no rodape com a extensao total. Os
   * demais lados ficam cinza fino pra o destaque saltar. Quando vazio/ausente,
   * o comportamento e' IDENTICO ao croqui normal (laudo nao quebra).
   */
  destacarLados?: number[];
  /** v3.63.0: titulo do croqui de destaque (ex: "CERCA A SER ALINHADA"). */
  tituloDestaque?: string;
  /**
   * v3.96.0: nuvem de pontos do levantamento planialtimetrico (coordenadas UTM
   * de contorno + interior, de gerarNuvemPontos). Renderiza pontinhos sobre a
   * poligonal — o mapa grafico do que sera levantado. Vazio/ausente => sem nuvem.
   */
  nuvemPontos?: Array<{ e: number; n: number }>;
  /** v3.96.0: titulo do croqui da nuvem (ex: "NUVEM DE PONTOS — PLANIALTIMETRIA"). */
  nuvemTitulo?: string;
}

/**
 * Gera SVG da poligonal. Normaliza UTM (m) pra viewport com 5% de margem.
 */
export function gerarCroquiSvg(
  pontos: PontoSvg[],
  lados: LadoSvg[] = [],
  opts: CroquiOpcoes = {}
): string {
  const W = opts.larguraPx ?? 600;
  const H = opts.alturaPx ?? 600;
  const cor = opts.corPoligonal ?? '#10b981';
  const mostrarRotulos = opts.mostrarRotulos !== false;
  const mostrarDistancias = opts.mostrarDistancias !== false;
  const mostrarNorte = opts.mostrarNorte !== false;

  if (pontos.length < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2}" text-anchor="middle" font-family="Helvetica" font-size="14" fill="#666">Adicione pelo menos 2 vertices pra gerar o croqui</text></svg>`;
  }

  // Limites UTM
  const minE = Math.min(...pontos.map(p => p.e));
  const maxE = Math.max(...pontos.map(p => p.e));
  const minN = Math.min(...pontos.map(p => p.n));
  const maxN = Math.max(...pontos.map(p => p.n));
  const dE = maxE - minE || 1;
  const dN = maxN - minN || 1;

  // Margem 8% pra rotulos caberem
  const margem = 0.08;
  const wContent = W * (1 - 2 * margem);
  const hContent = H * (1 - 2 * margem);

  // Escala uniforme pra preservar proporcoes
  const escala = Math.min(wContent / dE, hContent / dN);
  const offsetX = (W - dE * escala) / 2;
  const offsetY = (H - dN * escala) / 2;

  // Calcula escala "real" (1:N) — qual relacao 1cm SVG → metros reais
  // Considerando 1 polegada = 96px e 1 polegada = 2.54cm => 1cm = 37.8px
  const cmReal = (dE / escala) / 37.8;
  const escalaTexto = `1:${Math.round(cmReal * 100)}`;

  // UTM → SVG (Y invertido — UTM N cresce pra cima, SVG Y cresce pra baixo)
  const toSvg = (e: number, n: number): { x: number; y: number } => ({
    x: offsetX + (e - minE) * escala,
    y: offsetY + (maxN - n) * escala,
  });

  const svgPontos = pontos.map(p => toSvg(p.e, p.n));

  // v3.63.0: conjunto de lados destacados (1-based → 0-based). Vazio = sem destaque.
  const hiSet = new Set((opts.destacarLados ?? []).map(o => o - 1).filter(i => i >= 0));
  const destacando = hiSet.size > 0;
  // Quando destacando, a poligonal base fica cinza fina pra o dourado saltar.
  const corBase = destacando ? '#6e7681' : cor;
  const wBase = destacando ? 1.5 : 2;

  // Poligonal fechada (path)
  const pathD = svgPontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z';

  // Rotulos dos vertices
  let rotulosSvg = '';
  if (mostrarRotulos) {
    rotulosSvg = pontos.map((p, i) => {
      const sp = svgPontos[i];
      // Desloca rotulo pra fora da poligonal (simples: pra cima-direita)
      return `<g>
        <circle cx="${sp.x.toFixed(2)}" cy="${sp.y.toFixed(2)}" r="4" fill="${cor}" stroke="#fff" stroke-width="1.5"/>
        <text x="${(sp.x + 8).toFixed(2)}" y="${(sp.y - 8).toFixed(2)}" font-family="Helvetica" font-size="12" font-weight="bold" fill="#222">${escapeXml(p.rotulo)}</text>
      </g>`;
    }).join('');
  }

  // Distancias dos lados (se fornecidas)
  // v3.5.2: usa normal perpendicular ao lado pra posicionar o texto FORA do
  // poligono (centroide como referencia). Antes usava dy=-5 com rotacao,
  // mas pra metade dos lados (rotacao+180 pra manter legivel) o dy negativo
  // desloca pra DENTRO do poligono — texto atravessava a linha.
  let distanciasSvg = '';
  if (mostrarDistancias && lados.length > 0) {
    // Centroide do poligono no espaco SVG (media simples dos vertices)
    const cenX = svgPontos.reduce((s, p) => s + p.x, 0) / svgPontos.length;
    const cenY = svgPontos.reduce((s, p) => s + p.y, 0) / svgPontos.length;
    const offsetFora = 12; // pixels de afastamento da linha (PDF: SVG 600x600)
    distanciasSvg = lados.map(l => {
      const p1 = svgPontos[l.i_idx];
      const p2 = svgPontos[l.f_idx];
      if (!p1 || !p2) return '';
      const meioX = (p1.x + p2.x) / 2;
      const meioY = (p1.y + p2.y) / 2;
      // Vetor direcao do lado e normais perpendiculares
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // 2 normais possiveis (perpendiculares ao lado)
      const n1x = -dy / len, n1y = dx / len;
      const n2x =  dy / len, n2y = -dx / len;
      // Escolhe a normal que aponta PRA FORA (longe do centroide)
      const d1 = Math.hypot(meioX + n1x * offsetFora - cenX, meioY + n1y * offsetFora - cenY);
      const d2 = Math.hypot(meioX + n2x * offsetFora - cenX, meioY + n2y * offsetFora - cenY);
      const nx = d1 > d2 ? n1x : n2x;
      const ny = d1 > d2 ? n1y : n2y;
      const tx = meioX + nx * offsetFora;
      const ty = meioY + ny * offsetFora;
      // Rotacao do texto baseada no angulo do lado (mantem legivel)
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const angTxt = ang > 90 || ang < -90 ? ang + 180 : ang;
      // v3.63.0: cota dourada + "(ALINHAR)" quando o lado esta destacado.
      const idx = lados.indexOf(l);
      const isHi = hiSet.has(idx);
      const fillCota = isHi ? '#C9A84C' : '#222';
      const sufixo = isHi ? ' (ALINHAR)' : '';
      return `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-family="Helvetica" font-size="14" font-weight="bold" fill="${fillCota}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${angTxt.toFixed(1)} ${tx.toFixed(2)} ${ty.toFixed(2)})">${l.distancia_m.toFixed(2)}m${sufixo}</text>`;
    }).join('');
  }

  // v3.63.0: segmentos destacados (dourado tracejado) por cima da poligonal.
  let destaqueSegsSvg = '';
  let extensaoDestaque = 0;
  if (destacando) {
    destaqueSegsSvg = lados.map((l, idx) => {
      if (!hiSet.has(idx)) return '';
      const p1 = svgPontos[l.i_idx];
      const p2 = svgPontos[l.f_idx];
      if (!p1 || !p2) return '';
      extensaoDestaque += Number(l.distancia_m) || 0;
      return `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="#C9A84C" stroke-width="4" stroke-dasharray="8 4" stroke-linecap="round"/>`;
    }).join('');
  }

  // Indicador de norte (canto superior direito)
  let norteSvg = '';
  if (mostrarNorte) {
    const nx = W - 50;
    const ny = 50;
    norteSvg = `
      <g transform="translate(${nx}, ${ny})">
        <line x1="0" y1="-25" x2="0" y2="15" stroke="#222" stroke-width="2"/>
        <polygon points="0,-30 -6,-15 6,-15" fill="#222"/>
        <text x="0" y="32" font-family="Helvetica" font-size="14" font-weight="bold" fill="#222" text-anchor="middle">N</text>
      </g>`;
  }

  // v3.1.0: area no centro do poligono (se areaTotalM2 e tipoImovel fornecidos)
  let areaSvg = '';
  if (opts.areaTotalM2 != null && opts.areaTotalM2 > 0 && opts.tipoImovel) {
    const centUtm = calcularCentroide(pontos.map(p => ({ utm_e: p.e, utm_n: p.n })));
    // Mesma transformacao usada no toSvg() acima: offsetX + (e - minE) * escala, offsetY + (maxN - n) * escala
    const cx = offsetX + (centUtm.x - minE) * escala;
    const cy_c = offsetY + (maxN - centUtm.y) * escala;
    const areaTxt = formatarAreaParaCentro(opts.areaTotalM2, opts.tipoImovel);
    areaSvg = `
  <text x="${cx.toFixed(1)}" y="${cy_c.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica" font-size="14" font-weight="bold" fill="#222">${escapeXml(areaTxt)}</text>
  <text x="${cx.toFixed(1)}" y="${(cy_c + 16).toFixed(1)}" text-anchor="middle" font-family="Helvetica" font-size="9" fill="#888">ÁREA TOTAL</text>`;
  }

  // v3.1.0: tarjeta SIRGAS no canto inferior direito
  let tarjetaSvg = '';
  if (opts.utmZona != null) {
    const tw = 100, th = 42;
    const tx = W - tw - 10;
    const ty = H - th - 10;
    const hemi = opts.utmHemisferio || 'S';
    const mc = calcularMC(opts.utmZona);
    tarjetaSvg = `
  <g>
    <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="#fff" stroke="#888" stroke-width="0.5"/>
    <text x="${tx + 6}" y="${ty + 13}" font-family="Helvetica" font-size="8" font-weight="bold" fill="#222">SIRGAS 2000</text>
    <text x="${tx + 6}" y="${ty + 25}" font-family="Helvetica" font-size="7" fill="#444">UTM Zona ${opts.utmZona}${escapeXml(hemi)}</text>
    <text x="${tx + 6}" y="${ty + 36}" font-family="Helvetica" font-size="7" fill="#444">MC ${mc}°</text>
  </g>`;
  }

  // v3.63.0: titulo do croqui de destaque (topo-centro).
  let tituloSvg = '';
  if (destacando && opts.tituloDestaque) {
    tituloSvg = `
  <text x="${(W / 2).toFixed(1)}" y="26" text-anchor="middle" font-family="Helvetica" font-size="15" font-weight="bold" fill="#C9A84C">${escapeXml(opts.tituloDestaque)}</text>`;
  }

  // v3.63.0: legenda do destaque (rodape-esquerda) com a extensao total.
  let legendaSvg = '';
  if (destacando) {
    const ly = H - 30;
    legendaSvg = `
  <g>
    <rect x="10" y="${ly - 9}" width="14" height="14" fill="none" stroke="#C9A84C" stroke-width="2" stroke-dasharray="4 2"/>
    <text x="30" y="${ly + 2}" font-family="Helvetica" font-size="11" font-weight="bold" fill="#C9A84C">Cerca a ser alinhada — total: ${formatarMetrosBR(extensaoDestaque)} m</text>
  </g>`;
  }

  // v3.96.0: nuvem de pontos (planialtimetria) — pontinhos sobre a poligonal.
  let nuvemSvg = '';
  let nuvemTituloSvg = '';
  let nuvemLegendaSvg = '';
  if (opts.nuvemPontos && opts.nuvemPontos.length > 0) {
    const dots = opts.nuvemPontos.map(pt => {
      const s = toSvg(pt.e, pt.n);
      return `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="1.7" fill="#2563eb" fill-opacity="0.72"/>`;
    }).join('');
    nuvemSvg = `<g>${dots}</g>`;
    if (opts.nuvemTitulo) {
      nuvemTituloSvg = `
  <text x="${(W / 2).toFixed(1)}" y="26" text-anchor="middle" font-family="Helvetica" font-size="15" font-weight="bold" fill="#2563eb">${escapeXml(opts.nuvemTitulo)}</text>`;
    }
    const ly = H - 30;
    nuvemLegendaSvg = `
  <g>
    <circle cx="17" cy="${ly - 2}" r="3" fill="#2563eb" fill-opacity="0.72"/>
    <text x="30" y="${ly + 2}" font-family="Helvetica" font-size="11" font-weight="bold" fill="#2563eb">Nuvem de pontos — ${opts.nuvemPontos.length} pontos</text>
  </g>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <path d="${pathD}" fill="${cor}22" stroke="${corBase}" stroke-width="${wBase}" stroke-linejoin="round"/>
  ${nuvemSvg}
  ${destaqueSegsSvg}
  ${distanciasSvg}
  ${rotulosSvg}
  ${norteSvg}${areaSvg}${tarjetaSvg}${tituloSvg}${legendaSvg}${nuvemTituloSvg}${nuvemLegendaSvg}
  <text x="10" y="${H - 10}" font-family="Helvetica" font-size="11" fill="#666">Escala aprox.: ${escapeXml(escalaTexto)} (UTM)</text>
</svg>`;
}

// v3.63.0: formata metros no padrao BR (1.234,56) pra legenda do croqui.
// Manual (sem Intl/ICU) pra ser deterministico em qualquer build de Node.
function formatarMetrosBR(m: number): string {
  const fixed = (Number(m) || 0).toFixed(2);          // "1234.56"
  const [int, dec] = fixed.split('.');
  const intMil = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // "1.234"
  return `${intMil},${dec}`;
}

function escapeXml(s: string): string {
  return String(s).replace(/[<>&"']/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] ?? c
  ));
}
