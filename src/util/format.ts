// Formatação consistente de datas em pt-BR para respostas que vão à Groq/Claude.
// Saída: "26/04/2026 12:35" (sempre BRT/Fortaleza, GMT-3 sem horário de verão).

const _fmtFull = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day:      '2-digit',
  month:    '2-digit',
  year:     'numeric',
  hour:     '2-digit',
  minute:   '2-digit',
  hour12:   false,
});

const _fmtDateOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  day:      '2-digit',
  month:    '2-digit',
  year:     'numeric',
});

/**
 * Formata uma data (ISO string, Date ou timestamp) como "dd/MM/yyyy HH:mm" em BRT.
 * Retorna string vazia se input for null/undefined/inválido.
 */
export function formatBR(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === '') return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return _fmtFull.format(date);
}

/**
 * Formata só a data (sem hora). "dd/MM/yyyy".
 */
export function formatBRDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === '') return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return _fmtDateOnly.format(date);
}

const _fmtBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formata valor monetário em BRL: "R$ 1.234,56".
 */
export function formatBRL(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'R$ 0,00';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return _fmtBRL.format(n);
}
