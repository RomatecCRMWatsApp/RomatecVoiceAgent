// Sanitiza texto extraido de PDF antes de salvar em Postgres TEXT.
// Postgres TEXT NAO aceita NUL bytes (\x00) — qualquer string contendo um
// dispara 'unsupported Unicode escape sequence' no insert. Tambem removemos
// outros caracteres de controle invisiveis (mantendo \t \n \r \f que sao
// uteis pra layout) e normalizamos Unicode NFC pra eliminar sequencias
// mal-formadas que pdfjs-dist gera ocasionalmente em fontes embedded.

const NUL              = String.fromCharCode(0);
const NUL_REGEX        = new RegExp(NUL, 'g');
// chars de controle 0x01-0x08, 0x0B, 0x0E-0x1F, 0x7F
const CTRL_REGEX       = /[\x01-\x08\x0B\x0E-\x1F\x7F]/g;
// surrogates desemparelhados (alta sem baixa ou baixa sem alta)
const LONE_SURROGATES  = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g;

export function sanitizarParaPostgres(s: string): string {
  return s
    .replace(NUL_REGEX, '')
    .replace(CTRL_REGEX, '')
    .replace(LONE_SURROGATES, '')
    .normalize('NFC');
}

// Heuristica pra detectar texto corrompido (PDFs com CID fonts que pdf-parse
// nao decodifica, ou PDFs assinados digitalmente com extracao ruim).
// Retorna { ok, ratio, motivo } — ok=false significa que o texto eh gibberish
// e nao deve ser gravado na memoria vetorial (poluiria a base).
export function validarQualidadeTexto(texto: string): { ok: boolean; ratio: number; motivo?: string } {
  if (!texto || texto.length < 50) {
    return { ok: false, ratio: 0, motivo: 'texto curto demais (<50 chars)' };
  }
  // Conta chars considerados "legiveis": letras (incl. acentuadas), digitos,
  // espacos comuns, pontuacao basica. Tabs, simbolos isolados e chars exoticos NAO contam.
  const total      = texto.length;
  const legiveis   = (texto.match(/[A-Za-zÀ-ÿ0-9 .,;:!?()\-/'"\n%R$¡-ſ]/g) || []).length;
  const ratio      = legiveis / total;
  // PDFs bem extraidos tem ratio >= 0.85. PDFs com gibberish ficam < 0.50.
  // Threshold conservador 0.60 — abaixo eh sinal claro de extracao quebrada.
  if (ratio < 0.60) {
    return {
      ok: false,
      ratio,
      motivo: `texto possivelmente corrompido (apenas ${(ratio * 100).toFixed(0)}% chars legiveis — provavel CID font sem mapeamento Unicode, PDF assinado digitalmente, ou imagem escaneada). Use OCR ou outro PDF.`,
    };
  }
  return { ok: true, ratio };
}
