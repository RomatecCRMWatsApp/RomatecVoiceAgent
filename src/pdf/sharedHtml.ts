// v1.99.16 — Helpers HTML compartilhados pelos templates Prime (I e II).
//
// Tudo aqui e' PURO (sem I/O sincrono, sem DB), exceto gerarQrCodeBase64 que e'
// async (usa a lib qrcode, ja presente no projeto). Isso mantem os builders de
// HTML 100% testaveis sem Chromium.

import QRCode from 'qrcode';

// ── Identidade visual Romatec ───────────────────────────────────────────────
export const CORES = {
  verde: '#0B6E4F',
  verdeEscuro: '#074a35',
  verdeClaro: '#0e8a63',
  dourado: '#B8860B',
  douradoClaro: '#d4a017',
  douradoBrilho: '#f0c040',
} as const;

/** Formata numero como moeda BRL: 3000 → "R$ 3.000,00". */
export function fmtBRL(n: number | null | undefined): string {
  if (n == null) return '—';
  return (
    'R$ ' +
    Number(n || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Escapa caracteres perigosos pra interpolacao segura em HTML. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Valor por extenso (pt-BR, ate R$ 999.999.999,99) ────────────────────────
// Reimplementacao pura/standalone (nao arrasta pdfkit de services/reciboPdf.ts).
const UNIDADES = ['', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_A_DEZENOVE = [
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
];

function ate999PorExtenso(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (d === 1) {
    partes.push(DEZ_A_DEZENOVE[u]);
  } else {
    if (d > 1) partes.push(DEZENAS[d]);
    if (u > 0) partes.push(UNIDADES[u]);
  }
  return partes.join(' e ');
}

/** "3000" → "tres mil reais"; trata centavos. Ate R$ 999.999.999,99. */
export function valorPorExtenso(valor: number): string {
  const v = Math.max(0, Math.round((valor + Number.EPSILON) * 100) / 100);
  const reais = Math.floor(v);
  const centavos = Math.round((v - reais) * 100);

  const blocoReais = (() => {
    if (reais === 0) return 'zero reais';
    const milhoes = Math.floor(reais / 1_000_000);
    const milhares = Math.floor((reais % 1_000_000) / 1000);
    const resto = reais % 1000;
    const segmentos: string[] = [];
    if (milhoes > 0) {
      segmentos.push(`${ate999PorExtenso(milhoes)} ${milhoes === 1 ? 'milhao' : 'milhoes'}`);
    }
    if (milhares > 0) {
      segmentos.push(milhares === 1 ? 'mil' : `${ate999PorExtenso(milhares)} mil`);
    }
    if (resto > 0) segmentos.push(ate999PorExtenso(resto));
    const texto = segmentos.join(' e ').trim();
    return `${texto} ${reais === 1 ? 'real' : 'reais'}`;
  })();

  if (centavos > 0) {
    const blocoCent = `${ate999PorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
    return `${blocoReais} e ${blocoCent}`;
  }
  return blocoReais;
}

// ── QR Code de validacao ────────────────────────────────────────────────────
/** Gera um data URL (PNG base64) do QR apontando pra `url`, verde Romatec. */
export async function gerarQrCodeBase64(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 120,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: CORES.verde, light: '#FFFFFF' },
  });
}

// ── @import de fontes Google (com fallback offline) ─────────────────────────
// Em ambiente sem rede externa, o navegador cai nos fallbacks declarados nas
// font-family de cada template (serif/sans-serif/monospace). Nada quebra.
export const FONTS_PRIME1 = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@400;500;600;700&display=swap');`;
export const FONTS_PRIME2 = `@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap');`;

// ── Bloco de assinatura (compartilhado) ─────────────────────────────────────
/**
 * Renderiza o HTML do conteudo de assinatura: imagem base64 quando disponivel,
 * senao linha pontilhada + rotulo. `cor` controla a cor da linha/rotulo.
 */
export function blocoAssinaturaHtml(assinaturaBase64: string | undefined, cor: string): string {
  if (assinaturaBase64) {
    const src = assinaturaBase64.startsWith('data:')
      ? assinaturaBase64
      : `data:image/png;base64,${assinaturaBase64}`;
    return `<img class="assinatura-img" src="${escapeHtml(src)}" alt="Assinatura Digital" style="max-height:60px;max-width:220px;object-fit:contain;" />`;
  }
  return `
    <div style="border-bottom:1px dashed ${cor};width:220px;height:50px;"></div>
    <div style="font-size:0.7rem;color:${cor};text-align:center;margin-top:4px;letter-spacing:1px;">Assinatura</div>`;
}
