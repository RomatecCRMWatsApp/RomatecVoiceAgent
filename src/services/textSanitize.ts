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
