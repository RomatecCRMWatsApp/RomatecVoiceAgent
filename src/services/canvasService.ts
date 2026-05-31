// v3.51.0 — VTA Canvas: geracao da Prancha Tecnica A3 (SVG) com carimbo Romatec.
// Puro (sem deps nativas). A3 landscape = 1587x1123 px (~150 dpi).

export interface PranchaParams {
  tituloObra?: string;
  proprietario?: string;
  endereco?: string;
  municipio?: string;
  tipoObra?: string;
  escala?: string;
  dataPrancha?: string;        // ja formatada DD/MM/YYYY
  responsavelTecnico?: string;
  cftCrea?: string;
  numeroPrancha?: string;
  revisao?: string;
  conteudoSvg?: string;        // SVG interno do canvas (elementos), ja serializado
  larguraVirtual?: number;
  alturaVirtual?: number;
}

export const PRANCHA_W = 1587;
export const PRANCHA_H = 1123;
const COR_AZUL = '#1a3a5c';
const COR_DOURADO = '#c8a84b';

export function escapeSvg(v: unknown): string {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function val(v: string | undefined, padrao: string): string {
  return v && String(v).trim() ? String(v).trim() : padrao;
}

export function gerarPranchaSVG(params: PranchaParams): string {
  const tituloObra = val(params.tituloObra, 'Obra sem titulo');
  const proprietario = val(params.proprietario, '-');
  const endereco = val(params.endereco, '-');
  const municipio = val(params.municipio, 'Acailandia/MA');
  const tipoObra = val(params.tipoObra, '-');
  const escala = val(params.escala, '1:500');
  const dataPrancha = val(params.dataPrancha, new Date().toLocaleDateString('pt-BR'));
  const rt = val(params.responsavelTecnico, 'Jose Romario Pinto Bezerra');
  const cftCrea = val(params.cftCrea, 'CFT/MA no 01209185369');
  const numeroPrancha = val(params.numeroPrancha, 'PR-001');
  const revisao = val(params.revisao, 'R00');

  // Carimbo: 500x140 no canto inferior direito (margem 12px)
  const cbW = 500, cbH = 140, margin = 12;
  const cbX = PRANCHA_W - cbW - margin;
  const cbY = PRANCHA_H - cbH - margin;

  // Area util do desenho (acima/esquerda do carimbo)
  const conteudo = params.conteudoSvg || '';
  const vbW = params.larguraVirtual && params.larguraVirtual > 0 ? params.larguraVirtual : 2000;
  const vbH = params.alturaVirtual && params.alturaVirtual > 0 ? params.alturaVirtual : 2000;

  const linhasCarimbo: Array<[string, string]> = [
    ['Obra', tituloObra],
    ['Proprietario', proprietario],
    ['Endereco', `${endereco} - ${municipio}`],
    ['Tipo de obra', tipoObra],
    ['Resp. Tecnico', `${rt} - ${cftCrea}`],
  ];
  const textoLinhas = linhasCarimbo.map((l, i) => {
    const y = cbY + 30 + i * 17;
    return `<text x="${cbX + 70}" y="${y}" font-family="Arial, sans-serif" font-size="10" fill="#222">`
      + `<tspan font-weight="bold">${escapeSvg(l[0])}: </tspan>${escapeSvg(l[1])}</text>`;
  }).join('');

  const rodapeY = cbY + cbH - 22;
  const infoY = cbY + cbH - 8;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PRANCHA_W}" height="${PRANCHA_H}" viewBox="0 0 ${PRANCHA_W} ${PRANCHA_H}">
  <rect x="0" y="0" width="${PRANCHA_W}" height="${PRANCHA_H}" fill="#ffffff"/>
  <rect x="6" y="6" width="${PRANCHA_W - 12}" height="${PRANCHA_H - 12}" fill="none" stroke="${COR_AZUL}" stroke-width="2"/>
  <rect x="14" y="14" width="${PRANCHA_W - 28}" height="${PRANCHA_H - 28}" fill="none" stroke="#999" stroke-width="0.5"/>
  <!-- conteudo do canvas (escalado p/ area util) -->
  <svg x="20" y="20" width="${PRANCHA_W - 40}" height="${cbY - 30}" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">
    ${conteudo}
  </svg>
  <!-- CARIMBO -->
  <g>
    <rect x="${cbX}" y="${cbY}" width="${cbW}" height="${cbH}" fill="#ffffff" stroke="${COR_AZUL}" stroke-width="1.5"/>
    <rect x="${cbX}" y="${cbY}" width="56" height="${cbH}" fill="${COR_AZUL}"/>
    <circle cx="${cbX + 28}" cy="${cbY + 34}" r="20" fill="none" stroke="${COR_DOURADO}" stroke-width="2"/>
    <text x="${cbX + 28}" y="${cbY + 42}" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#fff" text-anchor="middle">R</text>
    <text x="${cbX + 28}" y="${cbY + 78}" font-family="Arial, sans-serif" font-size="8" fill="#fff" text-anchor="middle">ROMATEC</text>
    ${textoLinhas}
    <line x1="${cbX + 64}" y1="${rodapeY - 10}" x2="${cbX + cbW - 8}" y2="${rodapeY - 10}" stroke="#ccc" stroke-width="0.5"/>
    <text x="${cbX + 70}" y="${rodapeY}" font-family="Arial, sans-serif" font-size="9" fill="#222">`
      + `<tspan font-weight="bold">Escala:</tspan> ${escapeSvg(escala)}  `
      + `<tspan font-weight="bold">Data:</tspan> ${escapeSvg(dataPrancha)}  `
      + `<tspan font-weight="bold">Prancha:</tspan> ${escapeSvg(numeroPrancha)}  `
      + `<tspan font-weight="bold">Rev:</tspan> ${escapeSvg(revisao)}</text>`
      + `<text x="${cbX + 70}" y="${infoY}" font-family="Arial, sans-serif" font-size="8" fill="#666">Romatec Consultoria Total - Acailandia/MA</text>
  </g>
</svg>`;
}
