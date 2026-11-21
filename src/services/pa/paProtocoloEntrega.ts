// v3.198.0 — Protocolo de entrega das vias físicas do dossiê técnico do lote, confirmado pelo associado no WhatsApp.
// A Romatec entrega as vias impressas (com ou sem a TRT, que pode vir depois). O sistema gera o protocolo
// (nº PE-<sigla>-<ano>-<seq>) e manda ao associado um link pessoal: ele confere as peças, informa os 3 primeiros
// números do CPF e toca em "Confirmo que recebi". A confirmação grava data/hora, IP, aparelho e número de destino,
// fecha o código de verificação (SHA-256) e gera o PDF do protocolo autenticado, que vai para o associado e para o
// CEO e fica no acervo. Assinatura eletrônica simples (Lei 14.063/2020, art. 4º, I; MP 2.200-2/2001, art. 10, § 2º).
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDateTime, registrarEvento } from './paDb';
import { buscarProjeto } from './paRepo';
import { baseUrlPublica } from './paBoletoPdf';

/** v3.198.1: aviso da TRT (opcional, a pedido do associado) — no protocolo, na página e na mensagem. */
export const AVISO_TRT_TITULO = 'TRT — NÃO É OBRIGATÓRIA';
export const AVISO_TRT = 'A TRT (Termo de Responsabilidade Técnica) não é obrigatória. Se for da sua vontade tê-la, compareça ao escritório da Romatec (Rua São Raimundo, nº 10, Centro, Açailândia/MA) para a expedição da TRT e do boleto; após o pagamento, você retira a via assinada.';
export const LEI_ASSINATURA = 'Lei nº 14.063/2020, art. 4º, I, e MP nº 2.200-2/2001, art. 10, § 2º';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const primeiroNome = (n: string) => { const p = String(n).trim().split(/\s+/)[0] || ''; return p.charAt(0) + p.slice(1).toLowerCase(); };
const soDig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export interface ItemProtocolo { item: string; detalhe?: string | null; pendente?: boolean }
export interface Protocolo {
  id: number; projeto_id: number; lote: string; associado_id: number; numero: string; token: string; link: string;
  sem_trt: boolean; trt_numero: string | null; itens: ItemProtocolo[];
  entregue_em: string | null; entregue_por: string | null; criado_em: string | null; criado_por: string | null;
  enviado_em: string | null; enviado_para: string | null;
  confirmado_em: string | null; confirmado_ip: string | null; confirmado_ua: string | null; confirmado_obs: string | null;
  problema_em: string | null; problema_obs: string | null;
  hash: string | null; doc_id: number | null; cancelado_em: string | null;
}

/** Data/hora gravada em UTC → texto de Brasília (dd/mm/aaaa às hh:mm). */
export function horaBrasilia(iso: string | null, comSeg = false): string {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return iso;
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(comSeg ? { second: '2-digit' } : {}) }).format(d);
  return f.replace(', ', ' às ');
}
/** Número com DDD mascarado para o PDF: (99) 9****-1246. */
export function mascararFone(n: string | null): string {
  const d = soDig(n).replace(/^55(?=\d{10,11}$)/, '');
  if (d.length < 10) return '—';
  return `(${d.slice(0, 2)}) ${d.slice(2, 3)}****-${d.slice(-4)}`;
}
/** CPF mascarado: ***.456.789-** */
export function mascararCpf(cpf: unknown): string {
  const d = soDig(cpf);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '—';
}

/** Peças entregues em via física (pura — testável). */
export function itensProtocolo(o: { lote: string; contratoAssinado: boolean; quitado: boolean; trtNumero: string | null }): ItemProtocolo[] {
  const it: ItemProtocolo[] = [
    { item: `Capa do Dossiê Técnico do Lote de Produção LT-${o.lote}` },
    { item: 'Sumário e quadro de prazos e etapas da entrega' },
    { item: 'Mapa e memorial descritivo do lote — modelo tradicional', detalhe: 'NBR 13133 · SIRGAS 2000' },
    { item: 'Planta e memorial descritivo do lote — modelo SIGEF/INCRA', detalhe: 'NBR 17047 · SIRGAS 2000' },
  ];
  if (o.contratoAssinado) it.push({ item: 'Contrato de prestação de serviços técnicos (via assinada)' });
  if (o.quitado) it.push({ item: 'Termo de quitação com extrato dos pagamentos', detalhe: 'contrato e taxa dos marcos' });
  it.push({ item: 'Carteirinha de associado(a)' }, { item: 'Capa final — orientações e próximos passos' });
  it.push(o.trtNumero
    ? { item: 'TRT — Termo de Responsabilidade Técnica (CFT)', detalhe: `nº ${o.trtNumero}` }
    : { item: 'TRT — Termo de Responsabilidade Técnica (CFT)', detalhe: 'opcional — expedida no escritório a pedido do associado', pendente: true });
  return it;
}

/** Código de verificação: SHA-256 do conteúdo canônico do protocolo confirmado (pura — testável). */
export function hashProtocolo(p: { numero: string; lote: string; associado: string; cpf: string; itens: ItemProtocolo[]; entregue_em: string | null; confirmado_em: string | null; ip: string | null; ua: string | null; enviado_para: string | null }): string {
  const canon = JSON.stringify([p.numero, p.lote, p.associado, soDig(p.cpf), p.itens.map((i) => [i.item, i.detalhe ?? '', !!i.pendente]), p.entregue_em, p.confirmado_em, p.ip, p.ua, soDig(p.enviado_para)]);
  return createHash('sha256').update(canon).digest('hex');
}

export const linkProtocolo = (token: string) => `${baseUrlPublica()}/pa/protocolo/${token}`;

function deLinha(r: Record<string, unknown>): Protocolo {
  let itens: ItemProtocolo[] = [];
  try { itens = typeof r.itens === 'string' ? JSON.parse(r.itens) : (r.itens as ItemProtocolo[]) ?? []; } catch { itens = []; }
  return {
    id: num(r.id), projeto_id: num(r.projeto_id), lote: String(r.lote), associado_id: num(r.associado_id), numero: String(r.numero), token: String(r.token), link: linkProtocolo(String(r.token)),
    sem_trt: !!num(r.sem_trt), trt_numero: (r.trt_numero as string) ?? null, itens,
    entregue_em: isoDateTime(r.entregue_em), entregue_por: (r.entregue_por as string) ?? null, criado_em: isoDateTime(r.criado_em), criado_por: (r.criado_por as string) ?? null,
    enviado_em: isoDateTime(r.enviado_em), enviado_para: (r.enviado_para as string) ?? null,
    confirmado_em: isoDateTime(r.confirmado_em), confirmado_ip: (r.confirmado_ip as string) ?? null, confirmado_ua: (r.confirmado_ua as string) ?? null, confirmado_obs: (r.confirmado_obs as string) ?? null,
    problema_em: isoDateTime(r.problema_em), problema_obs: (r.problema_obs as string) ?? null,
    hash: (r.hash_conteudo as string) ?? null, doc_id: r.doc_id == null ? null : num(r.doc_id), cancelado_em: isoDateTime(r.cancelado_em),
  };
}

/** Protocolo ativo (não cancelado) do lote, se houver. */
export async function protocoloDoLote(projetoId: number, lote: string): Promise<Protocolo | null> {
  const r = await one(pool, 'SELECT * FROM pa_protocolos_entrega WHERE projeto_id = ? AND lote = ? AND cancelado_em IS NULL ORDER BY id DESC LIMIT 1', [projetoId, lote]);
  return r ? deLinha(r) : null;
}
export async function protocolosDoProjeto(projetoId: number): Promise<Record<string, Protocolo>> {
  const out: Record<string, Protocolo> = {};
  for (const r of await rows(pool, 'SELECT * FROM pa_protocolos_entrega WHERE projeto_id = ? AND cancelado_em IS NULL ORDER BY id', [projetoId]).catch(() => [])) { const p = deLinha(r); out[p.lote] = p; }
  return out;
}

async function dadosLote(projetoId: number, lote: string) {
  const d = await one(pool, `SELECT d.id dossie_id, d.status, d.trt_numero, d.associado_id, a.nome, a.cpf, a.numero, a.denominacao_terra, a.contrato_status, a.whatsapp_status, a.whatsapp_numero, lt.numero lote_vila
    FROM pa_dossies d JOIN pa_associados a ON a.id = d.associado_id JOIN pa_lotes lt ON lt.id = a.lote_id WHERE d.projeto_id = ? AND d.lote = ?`, [projetoId, lote]);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', `LT-${lote} não tem dossiê`, 404);
  return d;
}

/** Cria (ou devolve o que já existe) o protocolo de entrega das vias físicas do lote. */
export async function criarProtocolo(projetoId: number, lote: string, usuario: string | null, nomeUsuario: string | null): Promise<Protocolo> {
  const atual = await protocoloDoLote(projetoId, lote);
  if (atual) return atual;
  const d = await dadosLote(projetoId, lote);
  if (d.status !== 'ENVIADO' && d.status !== 'ENTREGUE') throw new PaErro('DOSSIE_NAO_ENVIADO', 'O protocolo das vias físicas é gerado depois que o dossiê foi enviado ao associado', 409);
  const { financeiro } = await import('./paDossie');
  const f = await financeiro(num(d.associado_id));
  const trt = d.trt_numero ? String(d.trt_numero) : null;
  const itens = itensProtocolo({ lote, contratoAssinado: String(d.contrato_status) === 'ASSINADO', quitado: f.saldo <= 0.009 && f.marcos.pagos, trtNumero: trt });
  const token = randomBytes(18).toString('base64url');
  const ins = await exec(pool, `INSERT INTO pa_protocolos_entrega (projeto_id, lote, associado_id, numero, token, sem_trt, trt_numero, itens, entregue_em, entregue_por, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`, [projetoId, lote, num(d.associado_id), `TMP-${token.slice(0, 16)}`, token, trt ? 0 : 1, trt, JSON.stringify(itens), nomeUsuario ?? usuario, usuario]);
  const sigla = (String(d.numero).split('-')[0] || 'PA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PA';
  const ano = new Date(Date.now() - 3 * 3600_000).getUTCFullYear();
  const numero = `PE-${sigla}-${ano}-${String(ins.insertId).padStart(4, '0')}`;
  await exec(pool, 'UPDATE pa_protocolos_entrega SET numero = ? WHERE id = ?', [numero, ins.insertId]);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: num(d.associado_id), usuario, tipo: 'PROTOCOLO_ENTREGA_GERADO', dados: { lote, numero, sem_trt: !trt } });
  return (await protocoloDoLote(projetoId, lote))!;
}

/** Mensagem ao associado com o link (pura — testável). */
export function textoProtocolo(nome: string, lote: string, numero: string, link: string, semTrt: boolean): string {
  return [
    `📦 *Protocolo de entrega — Dossiê técnico do lote LT-${lote}*`,
    '',
    `Olá, ${primeiroNome(nome)}! A Romatec Consultoria Total entregou a você as *vias impressas* do dossiê técnico do seu lote de produção *LT-${lote}*.`,
    '',
    `Para registrar o recebimento, toque no link, confira os documentos e toque em *✅ Confirmo que recebi*:`,
    link,
    '',
    `Protocolo nº *${numero}*. Depois da confirmação você recebe aqui o comprovante em PDF.`,
    ...(semTrt ? ['', `📄 *${AVISO_TRT_TITULO}* — ${AVISO_TRT.replace(/^A TRT \(Termo de Responsabilidade Técnica\) não é obrigatória\. /, '')}`] : []),
    '',
    '_Romatec Consultoria Total — José Romário_',
  ].join('\n');
}

/** Envia o link do protocolo no WhatsApp do associado (Z-API). */
export async function enviarProtocolo(projetoId: number, lote: string, usuario: string | null, nomeUsuario: string | null, outroNumero?: unknown, salvarNoCadastro = false) {
  const p = await criarProtocolo(projetoId, lote, usuario, nomeUsuario);
  if (p.confirmado_em) throw new PaErro('PROTOCOLO_CONFIRMADO', `O LT-${lote} já confirmou o recebimento em ${horaBrasilia(p.confirmado_em)}`, 409);
  const d = await dadosLote(projetoId, lote);
  const wa = await import('./paWhatsapp');
  // v3.198.1: número informado na hora (WhatsApp pessoal do associado) — opcionalmente grava no cadastro
  const temOutro = outroNumero != null && String(outroNumero).trim() !== '';
  const outro = temOutro ? wa.numeroDestino(outroNumero) : null;
  if (temOutro && !outro) throw new PaErro('CAMPO_INVALIDO', 'Número de WhatsApp inválido — use DDD + número (ex.: 99 99999-9999)', 400);
  if (!outro && (d.whatsapp_status !== 'VALIDO' || !d.whatsapp_numero)) throw new PaErro('SEM_WHATSAPP', `${d.nome} está sem WhatsApp no cadastro — informe o número para enviar`, 409);
  await wa.enviarWhatsAppAssociado(num(d.associado_id), textoProtocolo(String(d.nome), lote, p.numero, p.link, p.sem_trt), 'PROTOCOLO_ENTREGA', usuario, outro ?? undefined);
  const destino = outro ?? String(d.whatsapp_numero);
  await exec(pool, 'UPDATE pa_protocolos_entrega SET enviado_em = NOW(), enviado_para = ? WHERE id = ?', [destino, p.id]);
  if (outro && salvarNoCadastro) {
    await exec(pool, "UPDATE pa_associados SET whatsapp_numero = ?, whatsapp_status = 'VALIDO', whatsapp_verificado_em = NOW() WHERE id = ?", [outro, num(d.associado_id)]);
    await registrarEvento(pool, { projeto_id: projetoId, associado_id: num(d.associado_id), usuario, tipo: 'WHATSAPP_ATUALIZADO', dados: { origem: 'protocolo_entrega', final: outro.slice(-4) } });
  }
  return { ...(await protocoloDoLote(projetoId, lote))!, enviado: true };
}

/** Lote: protocolos para todos os dossiês enviados que ainda não confirmaram (fila em segundo plano). */
let filaRodando = false;
export async function enviarProtocolosPendentes(projetoId: number, lotes: string[] | null, usuario: string | null, nomeUsuario: string | null) {
  if (filaRodando) throw new PaErro('ENVIO_EM_ANDAMENTO', 'O envio dos protocolos já está em andamento — aguarde terminar', 409);
  const ds = await rows(pool, `SELECT d.lote FROM pa_dossies d JOIN pa_associados a ON a.id = d.associado_id
    WHERE d.projeto_id = ? AND d.status IN ('ENVIADO','ENTREGUE') AND a.whatsapp_status = 'VALIDO' AND a.whatsapp_numero IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pa_protocolos_entrega p WHERE p.projeto_id = d.projeto_id AND p.lote = d.lote AND p.cancelado_em IS NULL AND (p.confirmado_em IS NOT NULL OR p.enviado_em IS NOT NULL))
    ORDER BY CAST(d.lote AS UNSIGNED)`, [projetoId]);
  const sel = ds.map((x) => String(x.lote)).filter((l) => !lotes || !lotes.length || lotes.includes(l));
  if (!sel.length) return { fila: 0, lotes: [] as string[] };
  filaRodando = true;
  void (async () => {
    let ok = 0; const falhas: string[] = [];
    try {
      for (const l of sel) {
        try { await enviarProtocolo(projetoId, l, usuario, nomeUsuario); ok++; }
        catch (e) { falhas.push(`LT-${l}: ${(e as Error).message.slice(0, 120)}`); console.warn('[pa-protocolo]', l, (e as Error).message); }
      }
      const { numeroCeo } = await import('./paDossie');
      const wa = await import('./paWhatsapp');
      await wa.enviarWhatsAppNumero(numeroCeo(), `📦 Protocolos de entrega das vias físicas: *${ok}* de ${sel.length} enviado(s) para confirmação.${falhas.length ? `\n⚠️ ${falhas.join(' | ').slice(0, 900)}` : ''}`).catch(() => undefined);
    } finally { filaRodando = false; }
  })();
  return { fila: sel.length, lotes: sel };
}

export async function cancelarProtocolo(projetoId: number, lote: string, usuario: string | null) {
  const p = await protocoloDoLote(projetoId, lote);
  if (!p) throw new PaErro('PROTOCOLO_NAO_ENCONTRADO', 'Não há protocolo ativo para este lote', 404);
  if (p.confirmado_em) throw new PaErro('PROTOCOLO_CONFIRMADO', 'Protocolo já confirmado pelo associado — não pode ser cancelado', 409);
  await exec(pool, 'UPDATE pa_protocolos_entrega SET cancelado_em = NOW() WHERE id = ?', [p.id]);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: p.associado_id, usuario, tipo: 'PROTOCOLO_ENTREGA_CANCELADO', dados: { lote, numero: p.numero } });
  return { lote, cancelado: p.numero };
}

// ─── lado público (link do associado) ─
async function porToken(token: unknown): Promise<Protocolo> {
  const t = String(token ?? '');
  if (!/^[\w-]{20,40}$/.test(t)) throw new PaErro('LINK_INVALIDO', 'Link inválido', 404);
  const r = await one(pool, 'SELECT * FROM pa_protocolos_entrega WHERE token = ?', [t]);
  if (!r) throw new PaErro('LINK_INVALIDO', 'Link inválido ou expirado', 404);
  const p = deLinha(r);
  if (p.cancelado_em) throw new PaErro('LINK_CANCELADO', 'Este protocolo foi substituído — peça o link novo à Romatec', 410);
  return p;
}

export interface DadosPublicos {
  numero: string; lote: string; nome: string; numero_associado: string; lote_vila: string; denominacao: string | null; projeto: string; municipio: string;
  itens: ItemProtocolo[]; sem_trt: boolean; entregue_em: string | null; confirmado_em: string | null; hash: string | null; pede_cpf: boolean; confirmado_obs: string | null;
}
export async function dadosPublicos(token: unknown): Promise<DadosPublicos> {
  const p = await porToken(token);
  const a = await one(pool, 'SELECT a.nome, a.cpf, a.numero, a.denominacao_terra, lt.numero lote_vila FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.id = ?', [p.associado_id]);
  const pr = await buscarProjeto(p.projeto_id);
  return {
    numero: p.numero, lote: p.lote, nome: String(a?.nome ?? ''), numero_associado: String(a?.numero ?? ''), lote_vila: String(a?.lote_vila ?? ''), denominacao: (a?.denominacao_terra as string) ?? null,
    projeto: pr.nome, municipio: `${pr.municipio}/${pr.uf}`, itens: p.itens, sem_trt: p.sem_trt, entregue_em: p.entregue_em, confirmado_em: p.confirmado_em, hash: p.hash,
    pede_cpf: soDig(a?.cpf).length === 11, confirmado_obs: p.confirmado_obs,
  };
}

const tentativas = new Map<string, { n: number; ate: number }>();
/** Associado confirma o recebimento (3 primeiros números do CPF). Gera o PDF autenticado e envia. */
export async function confirmarRecebimento(token: unknown, cpf3: unknown, obs: unknown, ip: string | null, ua: string | null) {
  const p = await porToken(token);
  if (p.confirmado_em) return { confirmado_em: p.confirmado_em, hash: p.hash, ja: true };
  const t = tentativas.get(p.token);
  if (t && t.n >= 5 && t.ate > Date.now()) throw new PaErro('MUITAS_TENTATIVAS', 'Muitas tentativas — aguarde 15 minutos ou fale com a Romatec', 429);
  const a = await one(pool, 'SELECT id, nome, cpf FROM pa_associados WHERE id = ?', [p.associado_id]);
  const cpf = soDig(a?.cpf);
  if (cpf.length === 11 && soDig(cpf3).slice(0, 3) !== cpf.slice(0, 3)) {
    tentativas.set(p.token, { n: (t && t.ate > Date.now() ? t.n : 0) + 1, ate: Date.now() + 15 * 60_000 });
    throw new PaErro('CPF_NAO_CONFERE', 'Os 3 primeiros números do CPF não conferem', 400);
  }
  tentativas.delete(p.token);
  const o = String(obs ?? '').trim().slice(0, 500) || null;
  const ipS = ip ? ip.slice(0, 64) : null, uaS = ua ? ua.slice(0, 255) : null;
  const trava = await exec(pool, 'UPDATE pa_protocolos_entrega SET confirmado_em = NOW(), confirmado_ip = ?, confirmado_ua = ?, confirmado_obs = ? WHERE id = ? AND confirmado_em IS NULL', [ipS, uaS, o, p.id]);
  const q = deLinha((await one(pool, 'SELECT * FROM pa_protocolos_entrega WHERE id = ?', [p.id]))!);
  if (!trava.affectedRows) return { confirmado_em: q.confirmado_em, hash: q.hash, ja: true };
  const hash = hashProtocolo({ numero: q.numero, lote: q.lote, associado: String(a?.nome ?? ''), cpf, itens: q.itens, entregue_em: q.entregue_em, confirmado_em: q.confirmado_em, ip: ipS, ua: uaS, enviado_para: q.enviado_para });
  await exec(pool, 'UPDATE pa_protocolos_entrega SET hash_conteudo = ? WHERE id = ?', [hash, p.id]);
  await exec(pool, 'UPDATE pa_dossies SET vias_entregues_em = ?, vias_protocolo = ? WHERE projeto_id = ? AND lote = ?', [q.confirmado_em, q.numero, q.projeto_id, q.lote]).catch(() => undefined);
  await registrarEvento(pool, { projeto_id: q.projeto_id, associado_id: q.associado_id, usuario: null, tipo: 'PROTOCOLO_ENTREGA_CONFIRMADO', dados: { lote: q.lote, numero: q.numero, hash, ip: ipS } });
  void posConfirmacao(q.projeto_id, q.lote).catch((e) => console.warn('[pa-protocolo] pós-confirmação', q.lote, (e as Error).message));
  return { confirmado_em: q.confirmado_em, hash, ja: false };
}

/** Problema relatado pelo associado (não recebeu / falta peça) → aviso ao CEO. */
export async function relatarProblema(token: unknown, obs: unknown) {
  const p = await porToken(token);
  const o = String(obs ?? '').trim().slice(0, 500);
  if (o.length < 3) throw new PaErro('CAMPO_INVALIDO', 'Descreva o problema', 400);
  await exec(pool, 'UPDATE pa_protocolos_entrega SET problema_em = NOW(), problema_obs = ? WHERE id = ?', [o, p.id]);
  const a = await one(pool, 'SELECT nome FROM pa_associados WHERE id = ?', [p.associado_id]);
  await registrarEvento(pool, { projeto_id: p.projeto_id, associado_id: p.associado_id, usuario: null, tipo: 'PROTOCOLO_ENTREGA_PROBLEMA', dados: { lote: p.lote, numero: p.numero, obs: o } });
  try {
    const { numeroCeo } = await import('./paDossie');
    const wa = await import('./paWhatsapp');
    await wa.enviarWhatsAppNumero(numeroCeo(), `⚠️ *Protocolo ${p.numero}* — LT-${p.lote} (${a?.nome ?? ''}) relatou um problema na entrega das vias:\n"${o}"`);
  } catch (e) { console.warn('[pa-protocolo] aviso problema', (e as Error).message); }
  return { ok: true };
}

async function posConfirmacao(projetoId: number, lote: string) {
  const p = (await protocoloDoLote(projetoId, lote))!;
  const { pdf, nome } = await pdfProtocolo(projetoId, lote);
  let docId: number | null = null;
  try {
    const { uploadDocumento } = await import('./paDocumentos');
    docId = (await uploadDocumento(p.associado_id, 'PROTOCOLO_ENTREGA', { buffer: pdf, originalname: nome, mimetype: 'application/pdf' }, 'associado-whatsapp')).id;
    await exec(pool, 'UPDATE pa_protocolos_entrega SET doc_id = ? WHERE id = ?', [docId, p.id]);
  } catch (e) { console.warn('[pa-protocolo] acervo', lote, (e as Error).message); }
  // ficha do associado (tabela de entregas) — mesmo protocolo
  const a = await one(pool, 'SELECT nome, cpf, whatsapp_numero, whatsapp_status FROM pa_associados WHERE id = ?', [p.associado_id]);
  await exec(pool, `INSERT INTO pa_entregas (associado_id, protocolo, itens_json, entregue_em, recebedor_nome, recebedor_cpf, forma, comprovante_doc_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'WHATSAPP', ?, 'ENTREGUE') ON DUPLICATE KEY UPDATE entregue_em = VALUES(entregue_em), comprovante_doc_id = VALUES(comprovante_doc_id), status = 'ENTREGUE'`,
  [p.associado_id, p.numero.slice(0, 30), JSON.stringify(p.itens), p.confirmado_em, String(a?.nome ?? '').slice(0, 160), soDig(a?.cpf).slice(0, 14) || null, docId]).catch((e) => console.warn('[pa-protocolo] pa_entregas', (e as Error).message));
  const wa = await import('./paWhatsapp');
  const { numeroCeo } = await import('./paDossie');
  if (a?.whatsapp_status === 'VALIDO' && a.whatsapp_numero) {
    await wa.enviarDocumentoNumero(String(a.whatsapp_numero), pdf, nome, `✅ Recebimento confirmado, ${primeiroNome(String(a.nome))}! Segue o seu *protocolo de entrega nº ${p.numero}* autenticado. Guarde junto com o dossiê. 🙏\n_Romatec Consultoria Total_`).catch((e) => console.warn('[pa-protocolo] pdf associado', (e as Error).message));
  }
  await wa.enviarDocumentoNumero(numeroCeo(), pdf, nome, `✅ *LT-${lote}* — ${a?.nome ?? ''} confirmou o recebimento das vias físicas (protocolo ${p.numero}) em ${horaBrasilia(p.confirmado_em)}.${p.confirmado_obs ? `\n📝 "${p.confirmado_obs}"` : ''}`).catch((e) => console.warn('[pa-protocolo] pdf ceo', (e as Error).message));
}

// ─── PDF do protocolo ─
const cacheImg = new Map<string, string>();
function img(rel: string, mime: string): string {
  if (cacheImg.has(rel)) return cacheImg.get(rel)!;
  const f = [path.resolve(__dirname, '../../public', rel), path.resolve(process.cwd(), 'src/public', rel), path.resolve(process.cwd(), 'dist/public', rel)].find((c) => existsSync(c));
  const v = f ? `data:${mime};base64,${readFileSync(f).toString('base64')}` : '';
  cacheImg.set(rel, v);
  return v;
}

export interface DadosPdfProtocolo {
  numero: string; lote: string; nome: string; cpf: string; numero_associado: string; lote_vila: string; denominacao: string | null;
  projeto: string; municipio: string; associacao: string; itens: ItemProtocolo[]; sem_trt: boolean;
  entregue_em: string | null; entregue_por: string | null; enviado_em: string | null; enviado_para: string | null;
  confirmado_em: string | null; ip: string | null; ua: string | null; obs: string | null; hash: string | null; link: string; qr: string;
}
function aparelho(ua: string | null): string {
  if (!ua) return '—';
  const so = /Android [\d.]+/.exec(ua)?.[0] ?? (/iPhone OS ([\d_]+)/.exec(ua) ? `iOS ${/iPhone OS ([\d_]+)/.exec(ua)![1].replace(/_/g, '.')}` : /Windows NT/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : 'outro');
  const nav = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return `${so} · ${nav}${/WhatsApp|FBAN|FBAV/.test(ua) ? ' (dentro do WhatsApp)' : ''}`;
}

/** HTML do protocolo (pura — testável). Sem confirmação → modelo "aguardando confirmação". */
export function htmlProtocolo(d: DadosPdfProtocolo): string {
  const ok = !!d.confirmado_em;
  const logo = img('brand/pa/logo_romatec.jpg', 'image/jpeg');
  const bras = img('brand/pa/capa_brasao_salete_moreno.png', 'image/png');
  const linhas = d.itens.map((it, i) => `<tr class="${it.pendente ? 'pend' : ''}"><td class="n">${i + 1}</td><td>${esc(it.item)}${it.detalhe ? `<div class="dt">${esc(it.detalhe)}</div>` : ''}</td><td class="st">${it.pendente ? '<span class="tg p">OPCIONAL</span>' : '<span class="tg e">✓ ENTREGUE</span>'}</td></tr>`).join('');
  const entregues = d.itens.filter((i) => !i.pendente).length;
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Protocolo de entrega ${esc(d.numero)}</title><style>
  @page{size:A4;margin:7mm 12mm 6mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#1C1C18;font-size:8.5pt;line-height:1.27}
  .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
  .cab img.l{height:12mm;background:#fff;border-radius:1.5mm;padding:.8mm}.cab img.b{height:14mm;width:auto;margin-left:auto;object-fit:contain}
  .cab small{color:#E8D9A8;letter-spacing:1.4px;font-size:7.4pt;text-transform:uppercase}.cab h1{margin:.6mm 0 .4mm;font-size:13pt;white-space:nowrap}.cab p{margin:0;color:#d9e6dd;font-size:8.6pt}
  .faixa{display:flex;justify-content:space-between;align-items:center;margin:1.8mm 0 1mm;padding:1.3mm 3mm;border:.35mm solid #C9A84C;border-radius:2mm;background:#FBF7EA}
  .faixa b{font-size:12pt;color:#0C3320}.selo{font-weight:700;font-size:9pt;padding:1.2mm 3mm;border-radius:10mm;color:#fff;background:${ok ? '#1E7A3A' : '#B7791F'}}
  h2{font-size:9.4pt;color:#0C3320;margin:1.9mm 0 .8mm;border-bottom:.35mm solid #C9A84C;padding-bottom:.8mm;text-transform:uppercase;letter-spacing:.4px}
  table{width:100%;border-collapse:collapse}td,th{padding:.75mm 1.6mm;vertical-align:top}
  .id td{border-bottom:.2mm solid #E6E1D0}.id td.k{width:29mm;white-space:nowrap;color:#5B5745;font-weight:700}
  .it th{background:#0C3320;color:#fff;font-size:8.4pt;text-align:left}.it td{border-bottom:.2mm solid #E6E1D0;padding-top:.3mm;padding-bottom:.3mm}.it td.n{width:7mm;text-align:center;color:#5B5745}.it td.st{width:27mm;text-align:center}
  .it tr.pend td{background:#FFF6E6}.dt{display:inline;font-size:7.8pt;color:#6A6656}.dt:before{content:' — '}
  .tg{display:inline-block;font-size:7.4pt;font-weight:700;padding:.6mm 2mm;border-radius:1.2mm}.tg.e{background:#E3F2E7;color:#1E7A3A}.tg.p{background:#E8F1FB;color:#1F5FA8}
  .trt{margin-top:1.4mm;border:.5mm solid #1F5FA8;background:#EEF4FC;color:#1F4E8C;border-radius:1.6mm;padding:1.6mm 2.6mm;font-size:8.6pt;font-weight:700;line-height:1.35}.trt b{display:block;color:#C62828;font-size:9.2pt;letter-spacing:.3px}
  p{margin:.8mm 0;text-align:justify}.decl{background:#F4F6F2;border-left:1.2mm solid #0C3320;padding:1.6mm 2.6mm;border-radius:1mm}
  .aut{display:flex;gap:4mm;border:.4mm solid ${ok ? '#1E7A3A' : '#C9A84C'};border-radius:2mm;padding:2mm 2.6mm;margin-top:1.2mm;background:${ok ? '#F1F8F3' : '#FFFBF0'}}
  .aut table td{padding:.3mm 1.4mm;font-size:8pt}.aut td.k{color:#5B5745;font-weight:700;width:40mm}.aut .qr{text-align:center;font-size:7pt;color:#5B5745;width:30mm}.aut .qr img{width:20mm;height:20mm}
  .hash{font-family:'Courier New',monospace;font-size:7.6pt;word-break:break-all}
  .ass{display:flex;gap:8mm;margin-top:5mm}.ass div{flex:1;text-align:center;font-size:8.4pt;border-top:.3mm solid #1C1C18;padding-top:1.2mm}
  .rod{margin-top:1.8mm;font-size:7pt;white-space:nowrap;color:#6A6656;text-align:center;border-top:.3mm solid #C9A84C;padding-top:1.6mm}
  </style></head><body>
  <div class="cab">${logo ? `<img class="l" src="${logo}">` : ''}<div><small>Romatec Consultoria Total · Topografia</small><h1>PROTOCOLO DE ENTREGA DE VIAS FÍSICAS</h1><p>Dossiê Técnico do Lote de Produção LT-${esc(d.lote)} · ${esc(d.projeto.replace(/Projeto de Assentamento/i, 'PA'))}</p></div>${bras ? `<img class="b" src="${bras}">` : ''}</div>
  <div class="faixa"><div>Protocolo nº <b>${esc(d.numero)}</b></div><div class="selo">${ok ? '✓ RECEBIMENTO CONFIRMADO' : 'AGUARDANDO CONFIRMAÇÃO DO ASSOCIADO'}</div></div>

  <h2>1. Identificação</h2>
  <table class="id">
    <tr><td class="k">Contratada</td><td colspan="3">ROMATEC CONSULTORIA TOTAL — J R P BEZERRA LTDA · CNPJ 17.261.987/0001-09 · Rua São Raimundo, nº 10, Centro, Açailândia/MA</td></tr>
    <tr><td class="k">Responsável técnico</td><td colspan="3">José Romário Pinto Bezerra · Técnico em Agrimensura · CFT 01209185369 · INCRA FQNS</td></tr>
    <tr><td class="k">Associado(a)</td><td><b>${esc(d.nome.toUpperCase())}</b></td><td class="k">CPF</td><td>${esc(d.cpf)}</td></tr>
    <tr><td class="k">Lote de produção</td><td><b>LT-${esc(d.lote)}</b>${d.denominacao ? ` — “${esc(d.denominacao)}”` : ''}</td><td class="k">Nº associado</td><td>${esc(d.numero_associado)} · vila ${esc(d.lote_vila)}</td></tr>
    <tr><td class="k">Projeto</td><td colspan="3">${esc(d.projeto)} · ${esc(d.municipio)} · ${esc(d.associacao)}</td></tr>
  </table>

  <h2>2. Objeto</h2>
  <p>Registro da entrega, pela CONTRATADA ao(à) ASSOCIADO(A), das <b>vias físicas impressas</b> do Dossiê Técnico do Lote de Produção LT-${esc(d.lote)} (NBR 13133 e NBR 17047, SIRGAS 2000), previamente encaminhado em via digital pelo WhatsApp.</p>

  <h2>3. Peças entregues (${entregues} de ${d.itens.length})</h2>
  <table class="it"><thead><tr><th>#</th><th>Documento</th><th style="text-align:center">Situação</th></tr></thead><tbody>${linhas}</tbody></table>
  ${d.sem_trt ? `<div class="trt"><b>⚠ ${AVISO_TRT_TITULO}</b>${esc(AVISO_TRT)}</div>` : ''}

  <h2>4. Declaração de recebimento</h2>
  <div class="decl"><p>Declaro, para todos os fins, que recebi da ROMATEC CONSULTORIA TOTAL as vias físicas impressas relacionadas no item 3, em bom estado e legíveis, referentes ao meu lote de produção LT-${esc(d.lote)} no ${esc(d.projeto)}${d.sem_trt ? ', ciente de que a TRT é opcional e, se for de minha vontade, será expedida a meu pedido no escritório da Romatec' : ''}. Data da entrega: <b>${esc(horaBrasilia(d.entregue_em).split(' às ')[0])}</b>${d.entregue_por ? `, por ${esc(d.entregue_por)}` : ''}.</p></div>

  <h2>5. Autenticação eletrônica da confirmação</h2>
  <div class="aut"><table>
    <tr><td class="k">Forma</td><td>Link pessoal e intransferível enviado ao WhatsApp do associado, com conferência dos 3 primeiros dígitos do CPF</td></tr>
    <tr><td class="k">Link enviado em</td><td>${esc(horaBrasilia(d.enviado_em))} · WhatsApp ${esc(mascararFone(d.enviado_para))}</td></tr>
    <tr><td class="k">Confirmado em</td><td><b>${ok ? esc(horaBrasilia(d.confirmado_em, true)) + ' (horário de Brasília)' : 'aguardando confirmação'}</b></td></tr>
    <tr><td class="k">Endereço IP</td><td>${esc(d.ip ?? '—')}</td></tr>
    <tr><td class="k">Aparelho</td><td>${esc(aparelho(d.ua))}</td></tr>
    ${d.obs ? `<tr><td class="k">Observação do associado</td><td>${esc(d.obs)}</td></tr>` : ''}
    <tr><td class="k">Código de verificação</td><td class="hash">${ok && d.hash ? esc(d.hash) : '— gerado na confirmação (SHA-256) —'}</td></tr>
    <tr><td class="k">Fundamento</td><td>Assinatura eletrônica simples — ${LEI_ASSINATURA}</td></tr>
  </table><div class="qr">${d.qr ? `<img src="${d.qr}">` : ''}<div>Confira a autenticidade<br>no link do protocolo</div></div></div>

  <div class="ass"><div>ROMATEC CONSULTORIA TOTAL<br>José Romário Pinto Bezerra · Responsável técnico<br>CFT 01209185369</div><div>${esc(d.nome.toUpperCase())}<br>Associado(a) · ${ok ? 'confirmado eletronicamente via WhatsApp' : 'confirmação eletrônica via WhatsApp'}<br>Protocolo ${esc(d.numero)}</div></div>
  <div class="rod">Romatec Consultoria Total · (99) 99181-1246 · consultoriaromatec.com.br · Açailândia/MA — gerado pelo sistema ZAYRA em ${esc(horaBrasilia(new Date().toISOString()))}</div>
  </body></html>`;
}

export async function dadosPdfProtocolo(projetoId: number, lote: string): Promise<DadosPdfProtocolo> {
  const p = await protocoloDoLote(projetoId, lote);
  if (!p) throw new PaErro('PROTOCOLO_NAO_ENCONTRADO', `LT-${lote} ainda não tem protocolo de entrega — gere primeiro`, 404);
  const a = await one(pool, 'SELECT a.nome, a.cpf, a.numero, a.denominacao_terra, lt.numero lote_vila FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.id = ?', [p.associado_id]);
  const pr = await buscarProjeto(projetoId);
  return {
    numero: p.numero, lote, nome: String(a?.nome ?? ''), cpf: mascararCpf(a?.cpf), numero_associado: String(a?.numero ?? ''), lote_vila: String(a?.lote_vila ?? ''), denominacao: (a?.denominacao_terra as string) ?? null,
    projeto: pr.nome, municipio: `${pr.municipio}/${pr.uf}`, associacao: pr.associacao_nome || 'Associação dos Produtores Rurais do PA Salete Moreno',
    itens: p.itens, sem_trt: p.sem_trt, entregue_em: p.entregue_em, entregue_por: p.entregue_por, enviado_em: p.enviado_em, enviado_para: p.enviado_para,
    confirmado_em: p.confirmado_em, ip: p.confirmado_ip, ua: p.confirmado_ua, obs: p.confirmado_obs, hash: p.hash, link: p.link,
    qr: await QRCode.toDataURL(p.link, { margin: 0, width: 200 }).catch(() => ''),
  };
}
export const nomePdfProtocolo = (numero: string, lote: string, nome: string) =>
  `Protocolo_Entrega_${numero}_LT-${lote}_${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}.pdf`;

export async function pdfDeDados(d: DadosPdfProtocolo): Promise<Buffer> {
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  return htmlToPdf(htmlProtocolo(d), { format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, preferCSSPageSize: true });
}
export async function pdfProtocolo(projetoId: number, lote: string): Promise<{ pdf: Buffer; nome: string }> {
  const d = await dadosPdfProtocolo(projetoId, lote);
  return { pdf: await pdfDeDados(d), nome: nomePdfProtocolo(d.numero, lote, d.nome) };
}
export async function pdfProtocoloPorToken(token: unknown): Promise<{ pdf: Buffer; nome: string }> {
  const p = await porToken(token);
  return pdfProtocolo(p.projeto_id, p.lote);
}
