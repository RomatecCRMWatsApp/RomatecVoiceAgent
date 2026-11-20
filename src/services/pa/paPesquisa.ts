// v3.181.0 — Pesquisa de satisfação dos associados com a Romatec (topografia do PA).
// Cada associado recebe um link pessoal (assinado, sem login) pelo WhatsApp. Na página:
//   1) "Siga o nosso portal" → Instagram @avalieimob (o clique fica registrado);
//   2) nota de 0 a 10 + comentário opcional (um voto por associado; pode alterar).
// Resultado no Painel: satisfação média (0–10 e %), NPS (promotores 9–10 − detratores 0–6),
// distribuição das notas, cliques no Instagram, comentários e quem ainda não respondeu.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaErro } from './erros';
import { pool, rows, one, exec, isoDateTime, registrarEvento } from './paDb';
import { baseUrlPublica } from './paBoletoPdf';

export const INSTAGRAM_PORTAL = 'https://www.instagram.com/avalieimob';
export const INSTAGRAM_ARROBA = '@avalieimob';

const segredo = () => process.env.JWT_SECRET || process.env.PA_PESQUISA_SEGREDO || 'romatec-pesquisa';
const assinatura = (aid: number) => createHmac('sha256', segredo()).update(`pesquisa:${aid}`).digest('base64url').slice(0, 14);
/** Token do link pessoal: id do associado (base 36) + assinatura. */
export const tokenPesquisa = (aid: number) => `${aid.toString(36)}-${assinatura(aid)}`;
export function lerTokenPesquisa(t: unknown): number | null {
  const m = String(t ?? '').match(/^([0-9a-z]{1,10})-([\w-]{14})$/);
  if (!m) return null;
  const aid = parseInt(m[1], 36);
  if (!Number.isInteger(aid) || aid <= 0) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(assinatura(aid));
  return a.length === b.length && timingSafeEqual(a, b) ? aid : null;
}
export const linkPesquisa = (aid: number) => `${baseUrlPublica()}/pa/pesquisa/${tokenPesquisa(aid)}`;

export function mensagemPesquisa(nome: string, link: string): string {
  const p = nome.trim().split(/\s+/)[0] ?? '';
  const primeiro = p.charAt(0) + p.slice(1).toLowerCase();
  return [
    `⭐ *Pesquisa de satisfação — Romatec Topografia*`,
    ``,
    `Olá, ${primeiro}! Queremos saber o que você está achando do nosso trabalho de topografia no PA.`,
    ``,
    `👉 Toque no link, *siga o nosso portal ${INSTAGRAM_ARROBA}* no Instagram e dê a sua nota de *0 a 10*. Leva menos de 1 minuto:`,
    link,
    ``,
    `Sua opinião ajuda a melhorar o atendimento. Obrigado! 🙏`,
    `_Romatec Consultoria Total — José Romário_`,
  ].join('\n');
}

export interface ResumoNotas { respostas: number; media: number | null; satisfacao_pct: number | null; nps: number | null; promotores: number; neutros: number; detratores: number; distribuicao: number[] }
/** NPS e média (pura — testável). */
export function resumoNotas(notas: number[]): ResumoNotas {
  const ns = notas.filter((n) => Number.isInteger(n) && n >= 0 && n <= 10);
  const distribuicao = Array.from({ length: 11 }, (_, i) => ns.filter((n) => n === i).length);
  if (!ns.length) return { respostas: 0, media: null, satisfacao_pct: null, nps: null, promotores: 0, neutros: 0, detratores: 0, distribuicao };
  const promotores = ns.filter((n) => n >= 9).length, detratores = ns.filter((n) => n <= 6).length;
  const media = Math.round((ns.reduce((s, n) => s + n, 0) / ns.length) * 10) / 10;
  return { respostas: ns.length, media, satisfacao_pct: Math.round(media * 100) / 10, nps: Math.round(((promotores - detratores) / ns.length) * 100), promotores, neutros: ns.length - promotores - detratores, detratores, distribuicao };
}

async function associadoDoToken(token: unknown) {
  const aid = lerTokenPesquisa(token);
  if (!aid) throw new PaErro('LINK_INVALIDO', 'Link da pesquisa inválido', 404);
  const a = await one(pool, `SELECT a.id, a.nome, a.projeto_id, lt.numero AS lote, pr.nome AS projeto FROM pa_associados a
    JOIN pa_lotes lt ON lt.id = a.lote_id JOIN pa_projetos pr ON pr.id = a.projeto_id WHERE a.id = ? AND a.ativo = 1`, [aid]);
  if (!a) throw new PaErro('LINK_INVALIDO', 'Link da pesquisa inválido', 404);
  return { aid, nome: String(a.nome), projeto_id: Number(a.projeto_id), lote: String(a.lote), projeto: String(a.projeto) };
}

export async function dadosPaginaPesquisa(token: unknown) {
  const a = await associadoDoToken(token);
  const r = await one(pool, 'SELECT nota, comentario, instagram_clicou_em FROM pa_pesquisa_respostas WHERE projeto_id = ? AND associado_id = ?', [a.projeto_id, a.aid]);
  return { ...a, nota: r?.nota != null ? Number(r.nota) : null, comentario: (r?.comentario as string) ?? null, seguiu: !!r?.instagram_clicou_em };
}

export async function registrarVoto(token: unknown, notaQ: unknown, comentarioQ: unknown, ip: string | null) {
  const a = await associadoDoToken(token);
  const nota = Number(notaQ);
  if (!Number.isInteger(nota) || nota < 0 || nota > 10) throw new PaErro('NOTA_INVALIDA', 'Escolha uma nota de 0 a 10', 400);
  const comentario = String(comentarioQ ?? '').replace(/\s+/g, ' ').trim().slice(0, 600) || null;
  await exec(pool, `INSERT INTO pa_pesquisa_respostas (projeto_id, associado_id, nota, comentario, respondido_em, ip) VALUES (?, ?, ?, ?, NOW(), ?)
    ON DUPLICATE KEY UPDATE nota = VALUES(nota), comentario = VALUES(comentario), respondido_em = COALESCE(respondido_em, NOW()), atualizado_em = NOW(), ip = VALUES(ip)`,
    [a.projeto_id, a.aid, nota, comentario, ip ? ip.slice(0, 64) : null]);
  await registrarEvento(pool, { projeto_id: a.projeto_id, associado_id: a.aid, usuario: null, tipo: 'PESQUISA_SATISFACAO', dados: { nota } });
  return { nota };
}

export async function registrarCliqueInstagram(token: unknown) {
  const a = await associadoDoToken(token);
  await exec(pool, `INSERT INTO pa_pesquisa_respostas (projeto_id, associado_id, instagram_clicou_em) VALUES (?, ?, NOW())
    ON DUPLICATE KEY UPDATE instagram_clicou_em = COALESCE(instagram_clicou_em, NOW())`, [a.projeto_id, a.aid]);
  return { ok: true };
}

/** Resultado para o Painel. */
export async function resultadoPesquisa(projetoId: number) {
  const ass = await rows(pool, `SELECT a.id, a.nome, lt.numero AS lote, a.telefone_e164, a.whatsapp_numero, a.whatsapp_status, r.nota, r.comentario, r.respondido_em, r.atualizado_em, r.instagram_clicou_em
    FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id LEFT JOIN pa_pesquisa_respostas r ON r.associado_id = a.id AND r.projeto_id = a.projeto_id
    WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY CAST(lt.numero AS UNSIGNED), lt.numero`, [projetoId]);
  const notas = ass.filter((x) => x.nota != null).map((x) => Number(x.nota));
  const enviados = await rows(pool, "SELECT DISTINCT associado_id FROM pa_eventos WHERE projeto_id = ? AND tipo = 'PESQUISA_ENVIADA'", [projetoId]).catch(() => []);
  const env = new Set(enviados.map((x) => Number(x.associado_id)));
  return {
    instagram: INSTAGRAM_PORTAL, total: ass.length, ...resumoNotas(notas),
    instagram_cliques: ass.filter((x) => x.instagram_clicou_em).length, enviados: env.size,
    comentarios: ass.filter((x) => x.comentario).map((x) => ({ nome: String(x.nome), lote: String(x.lote), nota: Number(x.nota), comentario: String(x.comentario), em: isoDateTime(x.atualizado_em ?? x.respondido_em) }))
      .sort((a, b) => String(b.em).localeCompare(String(a.em))).slice(0, 30),
    associados: ass.map((x) => ({ id: Number(x.id), nome: String(x.nome), lote: String(x.lote), nota: x.nota != null ? Number(x.nota) : null, seguiu: !!x.instagram_clicou_em, enviado: env.has(Number(x.id)), whatsapp: x.whatsapp_status === 'VALIDO' || !!x.telefone_e164, telefone: ((x.whatsapp_numero as string) || (x.telefone_e164 as string)) ?? null })),
  };
}

export async function marcarEnviada(projetoId: number, aid: number, usuario: string | null) {
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: aid, usuario, tipo: 'PESQUISA_ENVIADA', dados: { link: linkPesquisa(aid) } });
}

// ─── v3.193.0: link geral (grupo do PA) + link individual para copiar + checagem de resposta ───
const assinaturaGrupo = (pid: number) => createHmac('sha256', segredo()).update(`pesquisa-grupo:${pid}`).digest('base64url').slice(0, 12);
export const tokenGrupoPesquisa = (pid: number) => `g${pid.toString(36)}-${assinaturaGrupo(pid)}`;
export function lerTokenGrupoPesquisa(t: unknown): number | null {
  const m = String(t ?? '').match(/^g([0-9a-z]{1,8})-([\w-]{12})$/);
  if (!m) return null;
  const pid = parseInt(m[1], 36);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(assinaturaGrupo(pid));
  return a.length === b.length && timingSafeEqual(a, b) ? pid : null;
}
export const linkGrupoPesquisa = (pid: number) => `${baseUrlPublica()}/pa/pesquisa/grupo/${tokenGrupoPesquisa(pid)}`;
export function mensagemGrupoPesquisa(projetoNome: string, link: string): string {
  return [
    `⭐ *Pesquisa de satisfação — ${projetoNome}*`,
    '',
    'Queremos saber o que vocês estão achando do nosso trabalho de topografia no PA (medição, atendimento e entrega dos documentos).',
    '',
    `👉 Toque no link, *procure o seu nome ou o número do seu lote*, siga o nosso portal ${INSTAGRAM_ARROBA} no Instagram e dê a sua nota de *0 a 10*. Leva menos de 1 minuto:`,
    link,
    '',
    'Cada associado vota uma vez (dá para mudar a nota depois). Obrigado! 🙏',
    '_Romatec Consultoria Total — José Romário_',
  ].join('\n');
}
/** Página do link geral: cada associado escolhe o próprio nome/lote e vai para a pesquisa dele. Só primeiro nome + inicial. */
export async function listaGrupoPesquisa(token: unknown) {
  const pid = lerTokenGrupoPesquisa(token);
  if (!pid) throw new PaErro('LINK_INVALIDO', 'Link da pesquisa inválido', 404);
  const p = await one(pool, 'SELECT nome FROM pa_projetos WHERE id = ?', [pid]);
  if (!p) throw new PaErro('LINK_INVALIDO', 'Link da pesquisa inválido', 404);
  const ass = await rows(pool, `SELECT a.id, a.nome, lt.numero AS lote, r.nota FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id
    LEFT JOIN pa_pesquisa_respostas r ON r.associado_id = a.id AND r.projeto_id = a.projeto_id
    WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY CAST(lt.numero AS UNSIGNED), lt.numero`, [pid]);
  const curto = (n: string) => { const ps = n.trim().split(/\s+/); const t = (w: string) => w.charAt(0) + w.slice(1).toLowerCase(); return ps.length > 1 ? `${t(ps[0])} ${ps[ps.length - 1].charAt(0)}.` : t(ps[0] ?? ''); };
  return { projeto: String(p.nome), itens: ass.map((a) => ({ nome: curto(String(a.nome)), lote: String(a.lote), respondeu: a.nota != null, token: tokenPesquisa(Number(a.id)) })) };
}
export async function jaRespondeu(aid: number): Promise<boolean> {
  const r = await one(pool, 'SELECT nota FROM pa_pesquisa_respostas WHERE associado_id = ? AND nota IS NOT NULL LIMIT 1', [aid]);
  return !!r;
}
