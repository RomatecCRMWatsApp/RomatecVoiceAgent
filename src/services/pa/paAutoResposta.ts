// v3.147.3 — Resposta automática CURTA no WhatsApp do sistema.
// O número da Zayra passou a mandar boletos para associados: quem responde não
// pode cair no assistente do CEO ("Boa tarde, Chefe!"). Associado do PA recebe
// uma resposta única, com o nome dele, explicando o envio e indicando o contato
// pessoal do CEO; qualquer outro número que não seja o do CEO recebe a versão
// genérica. Uma resposta por contato a cada RESFRIAMENTO — depois, silêncio.
import { pool, rows, num } from './paDb';

export const CONTATO_CEO = process.env.PA_CONTATO_WHATSAPP || process.env.ROMATEC_CONTATO_WHATSAPP || '(99) 99181-1246';
const RESFRIAMENTO_MS = Number(process.env.PA_AUTORESPOSTA_RESFRIAMENTO_MS) || 6 * 3600_000;
const ultimaResposta = new Map<string, number>();

/** Variações do número (com e sem o 9º dígito, com e sem 55) para casar com o cadastro. */
export function variantesTelefone(tel: string): string[] {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return [];
  if (d.length === 10 || d.length === 11) d = '55' + d;
  const out = new Set([d]);
  if (d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
  if (d.length === 12) out.add(d.slice(0, 4) + '9' + d.slice(4));
  return [...out];
}

export function mesmoTelefone(a: string, b: string): boolean {
  const vb = new Set(variantesTelefone(b));
  return variantesTelefone(a).some((x) => vb.has(x));
}

export function saudacao(agora: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(agora)) % 24;
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

const primeiroNome = (nome: string) => { const p = String(nome || '').trim().split(/\s+/)[0] || ''; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); };

export function mensagemAssociado(a: { nome: string; lote: string; projeto: string }, agora: Date = new Date()): string {
  return [
    `${saudacao(agora)}, ${primeiroNome(a.nome)}! 🌱`,
    `Esta é uma mensagem automática da Romatec Consultoria Total. Por aqui enviamos o boleto do *Lote ${a.lote}* do ${a.projeto} — pagando pelo boleto ou pelo Pix enviado, a baixa é automática.`,
    `Para qualquer dúvida, fale direto com José Romário no WhatsApp *${CONTATO_CEO}*. Obrigada!`,
  ].join('\n');
}

export function mensagemGenerica(agora: Date = new Date()): string {
  return [
    `${saudacao(agora)}! Esta é uma mensagem automática da Romatec Consultoria Total.`,
    'Este número é usado só para envios automáticos (boletos e avisos).',
    `Para falar com a gente, chame José Romário no WhatsApp *${CONTATO_CEO}*. Obrigada!`,
  ].join('\n');
}

export async function associadoPorTelefone(tel: string): Promise<{ id: number; nome: string; lote: string; projeto: string } | null> {
  const vs = variantesTelefone(tel);
  if (!vs.length) return null;
  const ph = vs.map(() => '?').join(',');
  const r = await rows(pool, `
    SELECT a.id, a.nome, lt.numero AS lote, p.nome AS projeto
    FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id JOIN pa_projetos p ON p.id = a.projeto_id
    WHERE a.ativo = 1 AND (REPLACE(a.telefone_e164, '+', '') IN (${ph}) OR a.whatsapp_numero IN (${ph}))
    ORDER BY a.id LIMIT 1`, [...vs, ...vs]);
  if (r[0]) return { id: num(r[0].id), nome: String(r[0].nome), lote: String(r[0].lote), projeto: String(r[0].projeto) };
  // v3.150.0: participante do lote (ex.: o esposo que fica em campo) — cumprimenta pelo nome dele.
  try {
    const q = await rows(pool, `
      SELECT a.id, pt.nome, lt.numero AS lote, p.nome AS projeto
      FROM pa_participantes pt JOIN pa_associados a ON a.id = pt.associado_id AND a.ativo = 1
      JOIN pa_lotes lt ON lt.id = a.lote_id JOIN pa_projetos p ON p.id = a.projeto_id
      WHERE pt.ativo = 1 AND REPLACE(pt.telefone_e164, '+', '') IN (${ph}) ORDER BY pt.id LIMIT 1`, vs);
    if (q[0]) return { id: num(q[0].id), nome: String(q[0].nome), lote: String(q[0].lote), projeto: String(q[0].projeto) };
  } catch { /* tabela ainda não migrada */ }
  return null;
}

export type DecisaoAuto = { acao: 'ZAYRA' } | { acao: 'SILENCIO'; motivo: string } | { acao: 'RESPONDER'; texto: string; tipo: 'ASSOCIADO' | 'GENERICA' };

/**
 * Decide o que fazer com uma mensagem recebida que chegou ao fim do roteamento:
 * CEO → assistente completa; associado/estranho → resposta curta (1× por resfriamento).
 * Sem CEO_WHATSAPP_PHONE configurado, só associados são interceptados (não tranca o CEO).
 */
export async function decidirAutoResposta(from: string, agora = Date.now(), ceo = process.env.CEO_WHATSAPP_PHONE || ''): Promise<DecisaoAuto> {
  if (ceo && mesmoTelefone(from, ceo)) return { acao: 'ZAYRA' };
  let assoc: Awaited<ReturnType<typeof associadoPorTelefone>> = null;
  try { assoc = await associadoPorTelefone(from); } catch { assoc = null; }
  if (!assoc && !ceo) return { acao: 'ZAYRA' };
  const chave = [...variantesTelefone(from)].sort((x, y) => y.length - x.length)[0] || from; // forma com o 9º dígito
  const ult = ultimaResposta.get(chave) ?? 0;
  if (agora - ult < RESFRIAMENTO_MS) return { acao: 'SILENCIO', motivo: 'já respondido recentemente' };
  ultimaResposta.set(chave, agora);
  const d = new Date(agora);
  return assoc ? { acao: 'RESPONDER', tipo: 'ASSOCIADO', texto: mensagemAssociado(assoc, d) } : { acao: 'RESPONDER', tipo: 'GENERICA', texto: mensagemGenerica(d) };
}

export function _limparResfriamento(): void { ultimaResposta.clear(); }
