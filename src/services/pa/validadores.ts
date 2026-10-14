// v3.142.0 — Validadores do módulo PA (porta de tools/pa-docs/validar_cpf.py +
// regras de telefone/data de regras-e-conferencias.md). Funções puras.

export function soDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Dígitos verificadores do CPF. Rejeita sequências repetidas (111.111.111-11). */
export function cpfValido(cpf: unknown): boolean {
  const d = soDigitos(cpf).split('').map(Number);
  if (d.length !== 11 || new Set(d).size === 1) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== d[n]) return false;
  }
  return true;
}

/** 000.000.000-00 (assume 11 dígitos). */
export function formatarCpf(cpf: unknown): string {
  const d = soDigitos(cpf).padStart(11, '0').slice(-11);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** LGPD: ***.XXX.XXX-** (mantém os 6 dígitos centrais, padrão dos comprovantes). */
export function mascararCpf(cpf: unknown): string | null {
  const d = soDigitos(cpf);
  if (d.length !== 11) return cpf == null || cpf === '' ? null : '***.***.***-**';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/**
 * Comprovante x pagador: o comprovante mostra ***XXXXXX** — os dígitos 4–9 do CPF.
 * Aceita a máscara em qualquer formato ("***.189.983-**", "***189983**", "189983").
 * Retorna null quando a máscara não traz 6 dígitos (não dá pra conferir).
 */
export function cpfParcialConfere(cpfCompleto: unknown, cpfParcial: unknown): boolean | null {
  const centro = soDigitos(cpfParcial);
  if (centro.length !== 6) return null;
  const d = soDigitos(cpfCompleto);
  if (d.length !== 11) return null;
  return d.slice(3, 9) === centro;
}

export interface TelefoneNormalizado {
  /** +55DDDNNNNNNNNN do PRIMEIRO número informado, ou null se inválido. */
  e164: string | null;
  avisos: string[];
}

// v3.145.1: qualquer DDD brasileiro VÁLIDO é aceito sem aviso (associado pode ter
// número de outro estado — decisão do CEO). Aviso só para DDD que não existe.
const DDD_VALIDOS = new Set(('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 '
  + '61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99').split(' '));

/**
 * Normaliza para E.164 (+55 DDD 9XXXXXXXX). Campo com 2 números ("a / b") usa o
 * primeiro e avisa. Nunca lança — telefone ruim vira aviso (regra §5.8).
 */
export function normalizarTelefone(v: unknown): TelefoneNormalizado {
  const bruto = String(v ?? '').trim();
  const avisos: string[] = [];
  if (!bruto || /informar/i.test(bruto)) return { e164: null, avisos: bruto ? ['telefone não informado'] : [] };
  const partes = bruto.split(/\s*[/;,|]\s*|\s+ou\s+/i).filter(Boolean);
  if (partes.length > 1) avisos.push(`${partes.length} telefones informados; usado o primeiro`);
  let d = soDigitos(partes[0]);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) {
    avisos.push('celular com 10 dígitos (faltando o 9?)');
    return { e164: null, avisos };
  }
  if (d.length !== 11) {
    avisos.push(`telefone com ${d.length} dígitos (esperado 11 com DDD)`);
    return { e164: null, avisos };
  }
  if (d[2] !== '9') avisos.push('número não começa com 9 (fixo?)');
  if (!DDD_VALIDOS.has(d.slice(0, 2))) avisos.push(`DDD ${d.slice(0, 2)} não existe — confira o número`);
  return { e164: `+55${d}`, avisos };
}

/** "dd/mm/aaaa" (com sufixos tipo " às 17:45:03 (BRT)") → "aaaa-mm-dd". */
export function dataBrParaIso(v: unknown): string | null {
  const m = String(v ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, aaaa] = m;
  const iso = `${aaaa}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(dd)) return null;
  return iso;
}

/** "10/10/2026 às 17:45:03 (BRT)" → "2026-10-10 17:45:03" (horário local BRT). */
export function dataHoraBrParaSql(v: unknown): string | null {
  const iso = dataBrParaIso(v);
  if (!iso) return null;
  const h = String(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hh = h ? h[1].padStart(2, '0') : '00';
  const mi = h ? h[2] : '00';
  const ss = h && h[3] ? h[3] : '00';
  return `${iso} ${hh}:${mi}:${ss}`;
}

export function emailValido(v: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());
}
