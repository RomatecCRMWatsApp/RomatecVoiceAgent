// v3.51.1 — VTA Overlay tecnico nas fotos de vistoria (node-canvas).
// node-canvas e importado de forma LAZY (resolvido em runtime, nao no build).
// Cores por linha conforme padrao Romatec: branco/ciano/cinza.

export interface OverlayParams {
  imageBuffer: Buffer;
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
  utm_zona: string;
  utm_e: number | null;
  utm_n: number | null;
  datum: string;
  municipio: string;
  logradouro: string;
  horario_captura: string;
  colaborador: string;
}

export interface OverlayResult { buffer: Buffer; base64: string; largura: number; altura: number; }
export interface LinhaOverlay { text: string; cor: string; bold: boolean; escala: number; }

const COR_DOURADO = '#c8a84b';
const COR_VERDE = '#1a5c2a';
const COR_CIANO = '#00d4ff';
const COR_CINZA = '#cccccc';
const COR_BRANCO = '#ffffff';
const TARGET_W = Number(process.env.OVERLAY_TARGET_WIDTH || 1080);
const JPEG_Q = Number(process.env.OVERLAY_JPEG_QUALITY || 92) / 100;

export function formatarUTM(valor: number | null): string {
  if (valor == null || !Number.isFinite(valor)) return '-';
  return Math.round(valor).toLocaleString('pt-BR');
}

export function formatarDataHora(iso: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Linhas com estilo (cor/bold/escala) — base do desenho e do texto puro.
export function linhasEstilizadas(p: OverlayParams): LinhaOverlay[] {
  const out: LinhaOverlay[] = [];
  if (p.latitude != null && p.longitude != null) {
    const alt = p.altitude_m != null ? `  alt ${Math.round(p.altitude_m)}m` : '';
    out.push({ text: `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}${alt}`, cor: COR_BRANCO, bold: true, escala: 1.0 });
  } else {
    out.push({ text: 'Coordenadas nao disponiveis', cor: COR_BRANCO, bold: true, escala: 1.0 });
  }
  if (p.utm_e != null && p.utm_n != null) {
    out.push({ text: `UTM ${p.utm_zona || ''} · E=${formatarUTM(p.utm_e)} · N=${formatarUTM(p.utm_n)} (${p.datum || 'SIRGAS 2000'})`, cor: COR_CIANO, bold: false, escala: 0.95 });
  } else if (p.utm_zona) {
    out.push({ text: `UTM ${p.utm_zona} (${p.datum || 'SIRGAS 2000'})`, cor: COR_CIANO, bold: false, escala: 0.95 });
  }
  const local = [p.logradouro, p.municipio].filter((s) => s && String(s).trim()).join(', ');
  out.push({ text: local || '—', cor: COR_CINZA, bold: false, escala: 0.85 });
  out.push({ text: formatarDataHora(p.horario_captura), cor: COR_BRANCO, bold: false, escala: 0.95 });
  out.push({ text: `Romatec · ${p.colaborador || ''}`, cor: COR_BRANCO, bold: false, escala: 0.95 });
  return out;
}

// Compat: texto puro das linhas (usado em testes e fallback).
export function montarLinhasOverlay(p: OverlayParams): string[] {
  return linhasEstilizadas(p).map((l) => l.text);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function desenharRosaDosVentos(ctx: any, cx: number, cy: number, size: number): void {
  const r = size / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  const dirs: Array<[number, number, string, boolean]> = [
    [0, -1, 'N', true], [0, 1, 'S', false], [1, 0, 'L', false], [-1, 0, 'O', false],
  ];
  for (const [dx, dy, label, destaque] of dirs) {
    const px = cx + dx * r * 0.82, py = cy + dy * r * 0.82;
    const ox = -dy, oy = dx;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(cx + ox * r * 0.16, cy + oy * r * 0.16);
    ctx.lineTo(cx - ox * r * 0.16, cy - oy * r * 0.16);
    ctx.closePath();
    ctx.fillStyle = destaque ? COR_DOURADO : 'rgba(200,200,200,0.85)';
    ctx.fill();
    ctx.fillStyle = destaque ? COR_DOURADO : '#eee';
    ctx.font = `bold ${Math.round(size * 0.2)}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + dx * r * 1.18, cy + dy * r * 1.18);
  }
  ctx.restore();
}

function desenharLogoRomatec(ctx: any, cx: number, cy: number, size: number): void {
  const r = size / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = COR_VERDE; ctx.fill();
  ctx.lineWidth = Math.max(1.5, size * 0.04); ctx.strokeStyle = COR_DOURADO; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, size * 0.02); ctx.strokeStyle = 'rgba(200,168,75,0.5)'; ctx.stroke();
  const lr = r * 0.34, lx = cx - r * 0.12, ly = cy - r * 0.12;
  ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2, size * 0.05); ctx.strokeStyle = COR_DOURADO; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lx + lr * 0.7, ly + lr * 0.7);
  ctx.lineTo(cx + r * 0.5, cy + r * 0.5);
  ctx.lineWidth = Math.max(2.5, size * 0.06); ctx.strokeStyle = COR_DOURADO; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(lr * 1.1)}px Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('R', lx, ly);
  ctx.restore();
}

export async function aplicarOverlayFoto(params: OverlayParams): Promise<OverlayResult> {
  // @ts-ignore -- 'canvas' e dependencia nativa opcional, resolvida em runtime (nao no build)
  const mod: any = await import('canvas');
  const { createCanvas, loadImage } = mod.default || mod;
  const img = await loadImage(params.imageBuffer);

  const scale = TARGET_W / img.width;
  const W = TARGET_W;
  const H = Math.round(img.height * scale);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  const faixaH = Math.max(Math.round(H * 0.18), 150);
  const faixaY = H - faixaH;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, faixaY, W, faixaH);
  ctx.fillStyle = COR_DOURADO;
  ctx.fillRect(0, faixaY, W, Math.max(2, Math.round(H * 0.004)));

  const linhas = linhasEstilizadas(params);
  const fsBase = Math.max(13, Math.round(faixaH * 0.13));
  const lh = Math.round(faixaH / (linhas.length + 1));
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  linhas.forEach((linha, i) => {
    ctx.font = `${linha.bold ? 'bold ' : ''}${Math.round(fsBase * linha.escala)}px Arial, sans-serif`;
    ctx.fillStyle = linha.cor;
    ctx.fillText(linha.text, Math.round(W * 0.025), faixaY + lh * (i + 0.8), W * 0.78);
  });

  const rosaSize = Math.round(W * 0.10);
  desenharRosaDosVentos(ctx, W - rosaSize * 0.75, faixaY - rosaSize * 0.7, rosaSize);
  const logoSize = Math.round(faixaH * 0.55);
  desenharLogoRomatec(ctx, W - logoSize * 0.7, faixaY + faixaH * 0.5, logoSize);

  const buffer = canvas.toBuffer('image/jpeg', { quality: JPEG_Q });
  return { buffer, base64: `data:image/jpeg;base64,${buffer.toString('base64')}`, largura: W, altura: H };
}
