// v3.24.4: helpers puros pra fallback de avatar de colaborador.
//
// Usados em 2 lugares:
// 1. Frontend (obras.html) — inline via funcoes JS espelhadas no <script>
// 2. Backend (folhaFechamentoPdf, reciboPdf) — gera blocos HTML pra <img>+initials
//
// Funcoes 100% puras (sem DB, sem HTTP, sem deps). Mesma logica em ambos os
// lados garante consistencia visual entre UI e PDFs.

/**
 * Extrai ate 2 iniciais maiusculas do nome completo.
 * "Cicero da Silva Oliveira" -> "CO" (primeiro + ultimo)
 * "Madonna" -> "MA" (primeiras 2 letras)
 * "Ana Maria" -> "AM"
 */
export function gerarIniciais(nome: string): string {
  if (!nome || typeof nome !== 'string') return '?';
  const limpo = nome.trim().replace(/\s+/g, ' ');
  if (!limpo) return '?';
  const partes = limpo.split(' ').filter(Boolean);
  if (partes.length === 1) {
    return partes[0].slice(0, 2).toUpperCase();
  }
  const primeira = partes[0][0] || '';
  const ultima = partes[partes.length - 1][0] || '';
  return (primeira + ultima).toUpperCase();
}

/**
 * Gera cor HSL deterministica baseada no nome — mesmo nome sempre da mesma
 * cor. Hue distribuido em 360°. Saturation 60%, Lightness 35% pra contraste
 * com texto branco (#fff).
 */
export function corDeFundoPorNome(nome: string): string {
  if (!nome) return 'hsl(0, 0%, 30%)';
  let hash = 0;
  for (let i = 0; i < nome.length; i++) {
    hash = ((hash << 5) - hash) + nome.charCodeAt(i);
    hash |= 0; // 32-bit int
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 35%)`;
}

/**
 * Monta bloco HTML do avatar — usado nos PDFs. Frontend tem versao espelhada
 * inline em obras.html.
 *
 * Se fotoBase64 fornecido (data URL), renderiza <img>. Senao, div circular
 * com iniciais sobre cor de fundo deterministica.
 */
export function montarBlocoAvatarHtml(input: {
  nome: string;
  fotoBase64?: string | null;
  size?: number; // px, default 64
}): string {
  const size = input.size ?? 64;
  const half = Math.floor(size / 2);
  const fontSize = Math.floor(size * 0.4);
  if (input.fotoBase64) {
    return `<img src="${input.fotoBase64}" alt="${escapeHtmlMin(input.nome)}" style="width:${size}px;height:${size}px;border-radius:${half}px;object-fit:cover;border:2px solid #333;display:inline-block;vertical-align:middle;" />`;
  }
  const iniciais = gerarIniciais(input.nome);
  const bg = corDeFundoPorNome(input.nome);
  return `<div style="width:${size}px;height:${size}px;border-radius:${half}px;background:${bg};color:#fff;font-weight:700;font-size:${fontSize}px;text-align:center;line-height:${size}px;display:inline-block;vertical-align:middle;border:2px solid #333;font-family:Arial,sans-serif;">${iniciais}</div>`;
}

function escapeHtmlMin(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
  );
}
