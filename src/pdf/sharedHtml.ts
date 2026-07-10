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

// ── v3.65.0 — Caixa ICP-Brasil (compartilhada Prime I/II) ───────────────────
/** Tipo da meta da assinatura digital (espelha LaudoDados['assinaturaIcp']). */
export interface IcpBoxMeta {
  signerCn: string;
  signerDoc?: string;
  issuerCn?: string;
  validadeAte?: string;
  dataAssinatura: string;
}

/**
 * Caixa verde "ASSINADO DIGITALMENTE — ICP-Brasil (PAdES)". Auto-contida
 * (fundo/borda próprios) pra ler bem tanto no tema dark (Prime I) quanto no
 * clean (Prime II). Retorna '' quando não há assinatura.
 */
export function assinaturaIcpHtml(meta?: IcpBoxMeta): string {
  if (!meta) return '';
  const docLinha = meta.signerDoc ? ` · ${escapeHtml(meta.signerDoc)}` : '';
  const certLinha = [
    meta.issuerCn ? `Cert.: ${escapeHtml(meta.issuerCn)}` : '',
    meta.validadeAte ? `válido até ${escapeHtml(meta.validadeAte)}` : '',
  ].filter(Boolean).join(' · ');
  // Selo em SVG inline (não usa emoji: o Chromium do servidor não tem fonte de
  // emoji e o 🔏 virava glyph quebrado/tofu no PDF).
  const selo = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="flex:none;margin-top:1px;" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1F5C3A"/><path d="M7 12.4l3.3 3.3L17 9.2" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `
  <div style="margin-top:14px;border:1.5px solid #1F5C3A;background:#eafff3;border-radius:8px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start;text-align:left;break-inside:avoid;">
    ${selo}
    <div style="flex:1;min-width:0;">
      <div style="font-weight:700;color:#1F5C3A;font-size:.8rem;letter-spacing:.4px;">ASSINADO DIGITALMENTE — ICP-Brasil (PAdES)</div>
      <div style="color:#0B6E4F;font-size:.78rem;margin-top:3px;">${escapeHtml(meta.signerCn)}${docLinha}</div>
      <div style="color:#0B6E4F;font-size:.72rem;margin-top:2px;">Assinado em ${escapeHtml(meta.dataAssinatura)}</div>
      ${certLinha ? `<div style="color:#3a7a5a;font-size:.67rem;margin-top:2px;">${certLinha} · validar em validar.iti.gov.br</div>` : ''}
    </div>
  </div>`;
}

// ── v3.65.0 — Seção "Arquivos Técnicos Anexos" (compartilhada Prime I/II) ────
export interface AnexoTecnicoView {
  nome: string;
  tipoLabel: string;
  tamanho: string;
  url: string;
  validade?: string;
  qrDataUrl: string;
}

/**
 * Renderiza a seção de arquivos técnicos vetoriais (DXF/DWG/KML/PDF) com cards
 * brancos auto-contidos + QR Code, espelhando o PDF padrão. Usa as classes
 * `bloco`/`secao` (presentes em ambos os templates) pro título. Retorna '' se
 * não houver arquivos. `secaoLabel` permite numerar (Prime II usa "N. Título").
 */
export function arquivosAnexosHtml(arquivos: AnexoTecnicoView[] | undefined, secaoLabel: string): string {
  if (!arquivos || arquivos.length === 0) return '';
  const cards = arquivos.map((a) => `
    <div style="border:1px solid rgba(31,92,58,.35);border-radius:8px;padding:10px 12px;display:flex;gap:12px;align-items:center;background:#ffffff;margin-bottom:8px;break-inside:avoid;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;color:#0B6E4F;font-size:.7rem;letter-spacing:.5px;text-transform:uppercase;">${escapeHtml(a.tipoLabel)} <span style="color:#999;font-weight:400;text-transform:none;">(${escapeHtml(a.tamanho)})</span></div>
        <div style="font-weight:600;color:#1A1A2E;font-size:.82rem;margin:3px 0;word-break:break-word;">${escapeHtml(a.nome)}</div>
        <div style="font-size:.68rem;color:#555;">Link de download:<br><span style="color:#0B6E4F;word-break:break-all;">${escapeHtml(a.url)}</span></div>
        ${a.validade ? `<div style="font-size:.64rem;color:#999;font-style:italic;margin-top:2px;">Validade do link: ${escapeHtml(a.validade)}</div>` : ''}
      </div>
      <img src="${escapeHtml(a.qrDataUrl)}" alt="QR Code" style="width:86px;height:86px;flex:none;background:#fff;border:1px solid #eee;border-radius:4px;" />
    </div>`).join('');
  return `
<div class="bloco">
  <h2 class="secao">${escapeHtml(secaoLabel)}</h2>
  <p style="font-size:.74rem;color:#666;margin:0 0 10px;">Os arquivos técnicos vetoriais a seguir compõem o presente laudo e estão disponíveis para download através dos links e QR Codes abaixo. Os links são individuais — podem ser acessados via navegador no computador ou escaneados pelo dispositivo móvel.</p>
  ${cards}
</div>`;
}

// ── v3.93.1 — Seções de PARIDADE com o PDF tradicional (compartilhadas) ──────
// Programa de Necessidades, Etapa Preliminar/Hora Técnica, Documentos a
// Fornecer, Avisos e Condições Técnicas e Foro & Validade. Antes existiam só no
// layout Padrão; agora saem também nos Prime I/II. Cards brancos auto-contidos
// (mesma estratégia da caixa ICP / arquivos anexos) pra ler bem no dark e no
// clean. Cada seção usa o wrapper `.bloco` + título `.secao` (presentes nos dois
// templates). Retorna '' quando não há nenhuma seção presente.
export interface SeccoesParidadeProposta {
  programaNecessidades?: Array<{ categoria: string; itens: string[] }>;
  horaTecnica?: {
    valorFormatado: string;
    paragrafo: string;
    itens: string[];
    condicoes: string[];
    nota: string;
  };
  documentos?: Array<{ texto: string; imprescindivel?: boolean; opcional?: boolean }>;
  avisos?: string[];
  foro?: string;
}

export function seccoesParidadePropostaHtml(d: SeccoesParidadeProposta): string {
  const CARD = 'background:#ffffff;border:1px solid #e5e2d8;border-radius:8px;padding:18px 22px;margin-top:12px;color:#2a2620;font-size:.86rem;line-height:1.55;';
  const partes: string[] = [];

  // Programa de Necessidades
  if (d.programaNecessidades && d.programaNecessidades.length) {
    const totalTipos = d.programaNecessidades.reduce((s, g) => s + g.itens.length, 0);
    const grupos = d.programaNecessidades.map((g) => `
      <div style="margin-top:10px;">
        <div style="font-weight:700;color:#0B6E4F;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(g.categoria)}</div>
        <ul style="margin:4px 0 0;padding-left:18px;">
          ${g.itens.map((i) => `<li style="margin:2px 0;">${escapeHtml(i)}</li>`).join('')}
        </ul>
      </div>`).join('');
    partes.push(`
<div class="bloco">
  <h2 class="secao">Programa de Necessidades</h2>
  <div style="${CARD}">
    <p style="margin:0;">O presente projeto contempla o programa de necessidades abaixo discriminado, composto pelos seguintes cômodos:</p>
    ${grupos}
    <div style="margin-top:12px;text-align:right;font-style:italic;color:#666;font-size:.78rem;">Total: ${totalTipos} tipo(s) de cômodo listado(s).</div>
  </div>
</div>`);
  }

  // Etapa Preliminar — Hora Técnica (box informativo destacado)
  if (d.horaTecnica) {
    const ht = d.horaTecnica;
    partes.push(`
<div class="bloco">
  <h2 class="secao">Etapa Preliminar — Hora Técnica</h2>
  <div style="${CARD}border-left:4px solid #d97706;">
    <div style="font-weight:700;color:#b45309;font-size:.95rem;">Hora Técnica de Anteprojeto e Croqui — ${escapeHtml(ht.valorFormatado)}
      <span style="font-weight:400;color:#92400e;font-size:.78rem;">(informativo, não incluído no valor total)</span></div>
    <p style="margin:10px 0 0;">${escapeHtml(ht.paragrafo)}</p>
    <ul style="margin:8px 0 0;padding-left:18px;">
      ${ht.itens.map((i) => `<li style="margin:3px 0;">${escapeHtml(i)}</li>`).join('')}
    </ul>
    <div style="font-weight:700;color:#b45309;margin-top:12px;font-size:.82rem;text-transform:uppercase;letter-spacing:.5px;">Condição especial de cobrança</div>
    <ul style="margin:6px 0 0;padding-left:0;list-style:none;">
      ${ht.condicoes.map((c) => `<li style="margin:5px 0;padding-left:16px;position:relative;"><span style="position:absolute;left:0;color:#d97706;">►</span>${escapeHtml(c)}</li>`).join('')}
    </ul>
    <p style="margin:12px 0 0;font-style:italic;color:#666;font-size:.78rem;">${escapeHtml(ht.nota)}</p>
  </div>
</div>`);
  }

  // Documentos a Fornecer pelo Cliente
  if (d.documentos && d.documentos.length) {
    const itens = d.documentos.map((doc) => {
      const marca = '☐ ';
      if (doc.imprescindivel) {
        return `<li style="margin:4px 0;color:#dc2626;font-weight:700;">${marca}[IMPRESCINDÍVEL] ${escapeHtml(doc.texto)}</li>`;
      }
      return `<li style="margin:4px 0;">${marca}${escapeHtml(doc.texto)}${doc.opcional ? ' <span style="color:#999;font-style:italic;">(opcional)</span>' : ''}</li>`;
    }).join('');
    partes.push(`
<div class="bloco">
  <h2 class="secao">Documentos a Fornecer pelo Cliente</h2>
  <div style="${CARD}">
    <ul style="margin:0;padding-left:0;list-style:none;">${itens}</ul>
  </div>
</div>`);
  }

  // Avisos e Condições Técnicas
  if (d.avisos && d.avisos.length) {
    partes.push(`
<div class="bloco">
  <h2 class="secao">Avisos e Condições Técnicas</h2>
  <div style="${CARD}font-size:.8rem;">
    <ul style="margin:0;padding-left:18px;">
      ${d.avisos.map((a) => `<li style="margin:5px 0;text-align:justify;">${escapeHtml(a)}</li>`).join('')}
    </ul>
  </div>
</div>`);
  }

  // Foro e Validade
  if (d.foro) {
    partes.push(`
<div class="bloco">
  <h2 class="secao">Foro e Validade</h2>
  <div style="${CARD}">
    <p style="margin:0;text-align:justify;">${escapeHtml(d.foro)}</p>
  </div>
</div>`);
  }

  if (!partes.length) return '';
  return `<div class="page">${partes.join('')}</div>`;
}
