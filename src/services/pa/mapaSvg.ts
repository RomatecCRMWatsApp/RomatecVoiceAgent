// v3.144.0 — Mapa do layout do PA em SVG no SERVIDOR (para PDFs: boleto Romatec).
// Mesmo desenho do mapa da tela (/pa.html, modo Layout) e do PDF do kit
// (mapa_layout_modelo.py): vias com nomes, praça, equipamentos, áreas verdes,
// lotes institucionais e o lote do associado em destaque.
//
// LGPD: em documento que vai para UM associado, os lotes mostram só o número —
// nunca o nome dos vizinhos.
import type { DesenhoLayout } from './layoutDesenho';

export interface LoteDoMapa { numero: string; xy: number[][]; institucional?: boolean }

const escSvg = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const FILL: Record<string, string> = { viario: '#BDBDBD', praca: '#B7D99A', equipamento: '#EEF4EA', verde: '#B7D99A' };
const pts = (p: number[][]) => p.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(' ');

function pill(x: number, y: number, texto: string, rot: number, estilo: string, tam?: number): string {
  const fs = tam || 3.3;
  const w = texto.length * fs * 0.6 + 3, h = fs * 1.35;
  const tr = `translate(${x.toFixed(2)},${y.toFixed(2)})${rot ? ` rotate(${rot.toFixed(2)})` : ''}`;
  const txt = (cor: string) => `<text font-size="${fs}" fill="${cor}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escSvg(texto)}</text>`;
  if (estilo === 'equip') return `<g transform="${tr}">${txt('#0C3320')}</g>`;
  const st = estilo === 'praca' ? 'fill="#0C3320"' : estilo === 'verde' ? 'fill="#ffffff" fill-opacity=".9" stroke="#2E7D32" stroke-width=".35"' : 'fill="#ffffff" stroke="#8A8A8A" stroke-width=".3"';
  const cor = estilo === 'praca' ? '#ffffff' : estilo === 'verde' ? '#1B5E20' : '#0C3320';
  return `<g transform="${tr}"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h / 2}" ${st}/>${txt(cor)}</g>`;
}

function icone(i: DesenhoLayout['icones'][number]): string {
  const { x, y, w = 0, h = 0, r = 0 } = i;
  switch (i.tipo) {
    case 'arvore': return `<circle cx="${x + r * 0.35}" cy="${y + r * 0.35}" r="${r}" fill="#000" fill-opacity=".18"/><circle cx="${x}" cy="${y}" r="${r}" fill="#2E7D32"/><circle cx="${x - r * 0.25}" cy="${y - r * 0.25}" r="${r * 0.62}" fill="#4CAF50"/>`;
    case 'fonte': return `<circle cx="${x}" cy="${y}" r="${r}" fill="#E9E4D6"/><circle cx="${x}" cy="${y}" r="${r * 0.54}" fill="#4FC3F7" stroke="#90A4AE" stroke-width=".4"/>`;
    case 'quiosque': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="#F3D9A4" stroke="#C9A84C" stroke-width=".4"/>`;
    case 'saude': return `<polygon points="${x - 2},${y} ${x + w / 2},${y - 7} ${x + w + 2},${y}" fill="#C62828"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#9E9E9E" stroke-width=".4"/><rect x="${x + w / 2 - 1.4}" y="${y + h / 2 - 4.5}" width="2.8" height="9" fill="#E53935"/><rect x="${x + w / 2 - 4.5}" y="${y + h / 2 - 1.4}" width="9" height="2.8" fill="#E53935"/>`;
    case 'ambulancia': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".8" fill="#fff" stroke="#757575" stroke-width=".3"/><rect x="${x + w / 2 - 2}" y="${y + h / 2 - 0.5}" width="4" height="1" fill="#E53935"/><rect x="${x + w / 2 - 0.5}" y="${y + h / 2 - 1.5}" width="1" height="3" fill="#E53935"/><circle cx="${x + 2.4}" cy="${y + h}" r="1.1" fill="#263238"/><circle cx="${x + w - 2.4}" cy="${y + h}" r="1.1" fill="#263238"/>`;
    case 'estacionamento': {
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="#9E9E9E" stroke="#757575" stroke-width=".4"/>`;
      for (let k = 1; k < 7; k++) s += `<line x1="${x + (w * k) / 7}" y1="${y + 3}" x2="${x + (w * k) / 7}" y2="${y + 11}" stroke="#fff" stroke-width=".5"/>`;
      return s;
    }
    case 'quadra': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="#4E8F5A" stroke="#2E5E38" stroke-width=".4"/><rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" fill="none" stroke="#fff" stroke-width=".5"/><line x1="${x + w / 2}" y1="${y + 2}" x2="${x + w / 2}" y2="${y + h - 2}" stroke="#fff" stroke-width=".5"/><circle cx="${x + w / 2}" cy="${y + h / 2}" r="3" fill="none" stroke="#fff" stroke-width=".5"/>`;
    case 'escola': {
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ECEFF1" stroke="#9E9E9E" stroke-width=".4"/><rect x="${x - 1}" y="${y - 2.2}" width="${w + 2}" height="2.2" fill="#E64A19"/>`;
      for (const k of [0, 3]) s += `<rect x="${x + 1.6 + (k * (w - 3.2)) / 4}" y="${y + h / 2 - 3}" width="${(w - 3.2) / 4 - 1.6}" height="4" fill="#64B5F6"/>`;
      return s + `<rect x="${x + w / 2 - 2.2}" y="${y + h - 6}" width="4.4" height="6" fill="#6D4C41"/><line x1="${x + w + 4}" y1="${y + h}" x2="${x + w + 4}" y2="${y - 5}" stroke="#616161" stroke-width=".4"/><rect x="${x + w + 4}" y="${y - 5}" width="5.4" height="3.5" fill="#2E7D32"/>`;
    }
  }
  return '';
}

export function svgLayoutPA(opts: {
  lotes: LoteDoMapa[];
  desenho: DesenhoLayout | null;
  destaque: string | null;
  corDestaque?: string;
  css?: string;
  rotulosVias?: boolean;
}): string {
  const lotes = opts.lotes.filter((l) => Array.isArray(l.xy) && l.xy.length >= 3);
  if (!lotes.length) return '';
  const d = opts.desenho;
  let lim: { minX: number; minY: number; maxX: number; maxY: number };
  if (d) lim = d.limites;
  else {
    const xs = lotes.flatMap((l) => l.xy.map((p) => p[0])), ys = lotes.flatMap((l) => l.xy.map((p) => p[1]));
    lim = { minX: Math.min(...xs) - 8, minY: Math.min(...ys) - 8, maxX: Math.max(...xs) + 8, maxY: Math.max(...ys) + 8 };
  }
  const W = lim.maxX - lim.minX, H = lim.maxY - lim.minY;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${lim.minX} ${lim.minY} ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="${opts.css ?? 'width:100%;height:auto;display:block'}" font-family="Liberation Sans, Arial, sans-serif">`;
  s += `<rect x="${lim.minX}" y="${lim.minY}" width="${W}" height="${H}" fill="#ffffff"/>`;
  if (d) {
    const praca = d.areas.find((a) => a.tipo === 'praca');
    if (praca) s += `<defs><clipPath id="clipPracaPdf"><polygon points="${pts(praca.pts)}"/></clipPath></defs>`;
    s += d.areas.map((a) => `<polygon points="${pts(a.pts)}" fill="${FILL[a.tipo] ?? '#ddd'}" ${a.tipo === 'viario' ? '' : 'stroke="#3A3A3A" stroke-width=".45"'}/>`).join('');
    s += d.caminhos.map((c) => `<polyline points="${pts(c.pts)}" stroke="${c.cor}" stroke-width="${c.largura}" fill="none"${praca ? ' clip-path="url(#clipPracaPdf)"' : ''}/>`).join('');
    s += d.icones.map(icone).join('');
  }
  let alvo = '';
  for (const l of lotes) {
    const xs = l.xy.map((p) => p[0]), ys = l.xy.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    const destaque = l.numero === opts.destaque;
    const fill = destaque ? (opts.corDestaque ?? '#C9A84C') : l.institucional ? '#DCEBF7' : '#EAF3EC';
    const g = `<polygon points="${pts(l.xy)}" fill="${fill}" stroke="${destaque ? '#0C3320' : '#3A3A3A'}" stroke-width="${destaque ? 1.6 : 0.4}"/>`
      + `<text x="${x0 + w / 2}" y="${y0 + (l.institucional ? h * 0.35 : h / 2)}" font-size="${destaque ? 6 : 4.2}" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="${l.institucional ? '#1F4E79' : '#0C3320'}">${escSvg(l.numero)}</text>`
      + (l.institucional ? `<text x="${x0 + w / 2}" y="${y0 + h * 0.66}" font-size="2.2" text-anchor="middle" dominant-baseline="middle" fill="#1F4E79">INSTITUCIONAL</text>` : '');
    if (destaque) {
      alvo = g + `<circle cx="${x0 + w / 2}" cy="${y0 + h / 2}" r="${Math.max(w, h) * 0.78}" fill="none" stroke="#B3261E" stroke-width="1.3" stroke-dasharray="3 2"/>`;
    } else s += g;
  }
  s += alvo; // destaque por cima de tudo
  if (d) {
    s += d.eixos.map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#F5F5F5" stroke-width=".6" stroke-dasharray="3 3"/>`).join('');
    if (opts.rotulosVias !== false) s += d.rotulos.map((r) => pill(r.x, r.y, r.texto, r.rot ?? 0, r.estilo, r.tam)).join('');
  }
  // Sem seta de norte: o croqui preliminar não tem orientação geodésica (vem com o georreferenciamento).
  return s + '</svg>';
}
