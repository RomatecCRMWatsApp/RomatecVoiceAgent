// v3.150.0 — Participantes do lote além do titular (cônjuge, filho, amigo…) e
// controle do grupo do WhatsApp do PA.
// Muitas vezes o cadastro está no nome de um (ex.: a esposa) e quem fica no lote
// e resolve tudo é outro (o esposo). O participante guarda os dados dessa pessoa
// e marca quem é o "responsável em campo".
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDate, isoDateTime, registrarEvento } from './paDb';
import { buscarProjeto } from './paRepo';
import { cpfValido, formatarCpf, normalizarTelefone, dataBrParaIso, emailValido } from './validadores';
import { variantesTelefone } from './paAutoResposta';

export const VINCULOS = ['CÔNJUGE', 'COMPANHEIRO(A)', 'FILHO(A)', 'PAI/MÃE', 'IRMÃO(Ã)', 'PARENTE', 'AMIGO(A)', 'CASEIRO/EMPREGADO', 'OUTRO'] as const;

export interface Participante {
  id: number; associado_id: number; nome: string; vinculo: string; cpf: string | null; rg: string | null; nascimento: string | null;
  telefone: string | null; telefone_e164: string | null; email: string | null; responsavel_campo: boolean;
  grupo_whatsapp_manual: 'SIM' | 'NAO' | null; obs: string | null; criado_em: string | null;
}

function mapParticipante(r: Record<string, unknown>): Participante {
  return {
    id: num(r.id), associado_id: num(r.associado_id), nome: String(r.nome), vinculo: String(r.vinculo), cpf: (r.cpf as string) ?? null,
    rg: (r.rg as string) ?? null, nascimento: isoDate(r.nascimento), telefone: (r.telefone as string) ?? null, telefone_e164: (r.telefone_e164 as string) ?? null,
    email: (r.email as string) ?? null, responsavel_campo: num(r.responsavel_campo) === 1,
    grupo_whatsapp_manual: (r.grupo_whatsapp_manual as 'SIM' | 'NAO' | null) ?? null, obs: (r.obs as string) ?? null, criado_em: isoDateTime(r.criado_em),
  };
}

const txt = (v: unknown, max: number) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };

/** Valida e normaliza o body. Telefone ruim e CPF vazio não bloqueiam — viram aviso. */
export function lerParticipante(body: Record<string, unknown>) {
  const avisos: string[] = [];
  const nome = txt(body.nome, 160);
  if (!nome) throw new PaErro('CAMPO_INVALIDO', 'Nome do participante é obrigatório', 400);
  const vinculoRaw = String(body.vinculo ?? '').trim().toUpperCase();
  const vinculo = (VINCULOS as readonly string[]).includes(vinculoRaw) ? vinculoRaw : (txt(body.vinculo, 40)?.toUpperCase() ?? 'OUTRO');
  let cpf: string | null = null;
  if (txt(body.cpf, 20)) {
    if (!cpfValido(body.cpf)) throw new PaErro('CPF_INVALIDO', 'CPF do participante inválido (dígito verificador não confere)', 422);
    cpf = formatarCpf(body.cpf);
  }
  const telefone = txt(body.telefone, 60);
  const tel = normalizarTelefone(telefone);
  avisos.push(...tel.avisos.filter((a) => a !== 'telefone não informado'));
  const nascRaw = txt(body.nascimento, 10);
  const nascimento = nascRaw ? (/^\d{4}-\d{2}-\d{2}$/.test(nascRaw) ? nascRaw : dataBrParaIso(nascRaw)) : null;
  const email = txt(body.email, 160);
  if (email && !emailValido(email)) throw new PaErro('CAMPO_INVALIDO', 'E-mail inválido', 422);
  const g = String(body.grupo_whatsapp_manual ?? '').toUpperCase();
  return {
    dados: {
      nome: nome.toUpperCase(), vinculo, cpf, rg: txt(body.rg, 80), nascimento, telefone, telefone_e164: tel.e164, email,
      responsavel_campo: body.responsavel_campo === true || body.responsavel_campo === 'true' || body.responsavel_campo === 1 || body.responsavel_campo === '1' ? 1 : 0,
      grupo_whatsapp_manual: g === 'SIM' || g === 'NAO' ? g : null, obs: txt(body.obs, 255),
    },
    avisos,
  };
}

export async function listarParticipantes(aid: number): Promise<Participante[]> {
  const r = await rows(pool, 'SELECT * FROM pa_participantes WHERE associado_id = ? AND ativo = 1 ORDER BY responsavel_campo DESC, id', [aid]);
  return r.map(mapParticipante);
}

async function projetoDoAssociado(aid: number): Promise<number> {
  const a = await one(pool, 'SELECT projeto_id FROM pa_associados WHERE id = ?', [aid]);
  if (!a) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não encontrado', 404);
  return num(a.projeto_id);
}

export async function criarParticipante(aid: number, body: Record<string, unknown>, usuario: string | null) {
  const projetoId = await projetoDoAssociado(aid);
  const { dados, avisos } = lerParticipante(body);
  const r = await exec(pool, `INSERT INTO pa_participantes (associado_id, nome, vinculo, cpf, rg, nascimento, telefone, telefone_e164, email, responsavel_campo, grupo_whatsapp_manual, obs, criado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [aid, dados.nome, dados.vinculo, dados.cpf, dados.rg, dados.nascimento, dados.telefone, dados.telefone_e164, dados.email, dados.responsavel_campo, dados.grupo_whatsapp_manual, dados.obs, usuario]);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: aid, usuario, tipo: 'PARTICIPANTE_INCLUIDO', dados: { id: r.insertId, nome: dados.nome, vinculo: dados.vinculo } });
  return { participante: (await listarParticipantes(aid)).find((p) => p.id === r.insertId)!, avisos };
}

export async function atualizarParticipante(pid: number, body: Record<string, unknown>, usuario: string | null) {
  const atual = await one(pool, 'SELECT * FROM pa_participantes WHERE id = ? AND ativo = 1', [pid]);
  if (!atual) throw new PaErro('PARTICIPANTE_NAO_ENCONTRADO', 'Participante não encontrado', 404);
  const { dados, avisos } = lerParticipante({ ...mapParticipante(atual), ...body });
  await exec(pool, `UPDATE pa_participantes SET nome = ?, vinculo = ?, cpf = ?, rg = ?, nascimento = ?, telefone = ?, telefone_e164 = ?, email = ?, responsavel_campo = ?, grupo_whatsapp_manual = ?, obs = ? WHERE id = ?`,
    [dados.nome, dados.vinculo, dados.cpf, dados.rg, dados.nascimento, dados.telefone, dados.telefone_e164, dados.email, dados.responsavel_campo, dados.grupo_whatsapp_manual, dados.obs, pid]);
  const aid = num(atual.associado_id);
  await registrarEvento(pool, { projeto_id: await projetoDoAssociado(aid), associado_id: aid, usuario, tipo: 'PARTICIPANTE_ALTERADO', dados: { id: pid, nome: dados.nome } });
  return { participante: (await listarParticipantes(aid)).find((p) => p.id === pid)!, avisos };
}

export async function removerParticipante(pid: number, usuario: string | null) {
  const atual = await one(pool, 'SELECT associado_id, nome FROM pa_participantes WHERE id = ? AND ativo = 1', [pid]);
  if (!atual) throw new PaErro('PARTICIPANTE_NAO_ENCONTRADO', 'Participante não encontrado', 404);
  await exec(pool, 'UPDATE pa_participantes SET ativo = 0 WHERE id = ?', [pid]);
  const aid = num(atual.associado_id);
  await registrarEvento(pool, { projeto_id: await projetoDoAssociado(aid), associado_id: aid, usuario, tipo: 'PARTICIPANTE_REMOVIDO', dados: { id: pid, nome: atual.nome } });
  return { ok: true };
}

// ─── Grupo do WhatsApp ────────────────────────────────────────────────────
export type OrigemGrupo = 'SINCRONIZADO' | 'MANUAL' | null;
export interface PessoaGrupo { tipo: 'TITULAR' | 'PARTICIPANTE'; id: number; nome: string; vinculo: string | null; telefone: string | null; no_grupo: boolean; origem: OrigemGrupo; manual: 'SIM' | 'NAO' | null }
export interface LoteGrupo { associado_id: number; lote: string; numero: string; nome: string; pessoas: PessoaGrupo[]; algum_no_grupo: boolean }

/**
 * Cruza os membros do grupo com titulares e participantes. Marcação manual
 * "NAO" vence a sincronização (ex.: número antigo que ficou no grupo); "SIM"
 * vale quando o grupo não pode ser lido pela instância.
 */
export function cruzarGrupo(
  lotes: Array<{ associado_id: number; lote: string; numero: string; nome: string; telefone_e164: string | null; manual: 'SIM' | 'NAO' | null; participantes: Participante[] }>,
  membros: string[],
) {
  const noGrupo = new Set<string>();
  for (const m of membros) for (const v of variantesTelefone(m)) noGrupo.add(v);
  const usados = new Set<string>();
  const estado = (tel: string | null, manual: 'SIM' | 'NAO' | null): { no_grupo: boolean; origem: OrigemGrupo } => {
    const vs = tel ? variantesTelefone(tel) : [];
    const sinc = vs.some((v) => noGrupo.has(v));
    if (sinc) vs.forEach((v) => usados.add(v));
    if (manual === 'NAO') return { no_grupo: false, origem: 'MANUAL' };
    if (sinc) return { no_grupo: true, origem: 'SINCRONIZADO' };
    if (manual === 'SIM') return { no_grupo: true, origem: 'MANUAL' };
    return { no_grupo: false, origem: null };
  };
  const out: LoteGrupo[] = lotes.map((l) => {
    const pessoas: PessoaGrupo[] = [
      { tipo: 'TITULAR', id: l.associado_id, nome: l.nome, vinculo: null, telefone: l.telefone_e164, manual: l.manual, ...estado(l.telefone_e164, l.manual) },
      ...l.participantes.map((p) => ({ tipo: 'PARTICIPANTE' as const, id: p.id, nome: p.nome, vinculo: p.vinculo, telefone: p.telefone_e164, manual: p.grupo_whatsapp_manual, ...estado(p.telefone_e164, p.grupo_whatsapp_manual) })),
    ];
    return { associado_id: l.associado_id, lote: l.lote, numero: l.numero, nome: l.nome, pessoas, algum_no_grupo: pessoas.some((p) => p.no_grupo) };
  });
  const desconhecidos = [...new Set(membros.map((m) => variantesTelefone(m)[0] || m))].filter((m) => !variantesTelefone(m).some((v) => usados.has(v)));
  return { lotes: out, desconhecidos };
}

export async function situacaoGrupo(projetoId: number) {
  const p = await buscarProjeto(projetoId);
  const cfg = await one(pool, 'SELECT whatsapp_grupo_id, whatsapp_grupo_nome, whatsapp_grupo_sync_em FROM pa_projetos WHERE id = ?', [projetoId]);
  const as = await rows(pool, `
    SELECT a.id, a.numero, a.nome, a.telefone_e164, a.grupo_whatsapp_manual, lt.numero AS lote
    FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY CAST(lt.numero AS UNSIGNED), lt.numero`, [projetoId]);
  const parts = await rows(pool, `SELECT pt.* FROM pa_participantes pt JOIN pa_associados a ON a.id = pt.associado_id WHERE a.projeto_id = ? AND a.ativo = 1 AND pt.ativo = 1 ORDER BY pt.id`, [projetoId]);
  const porAssoc = new Map<number, Participante[]>();
  for (const r of parts) { const x = mapParticipante(r); if (!porAssoc.has(x.associado_id)) porAssoc.set(x.associado_id, []); porAssoc.get(x.associado_id)!.push(x); }
  const membrosRows = await rows(pool, 'SELECT telefone, admin FROM pa_whatsapp_grupo_membros WHERE projeto_id = ?', [projetoId]);
  const membros = membrosRows.map((m) => String(m.telefone));
  const { lotes, desconhecidos } = cruzarGrupo(as.map((a) => ({
    associado_id: num(a.id), lote: String(a.lote), numero: String(a.numero), nome: String(a.nome), telefone_e164: (a.telefone_e164 as string) ?? null,
    manual: (a.grupo_whatsapp_manual as 'SIM' | 'NAO' | null) ?? null, participantes: porAssoc.get(num(a.id)) ?? [],
  })), membros);
  const pessoas = lotes.flatMap((l) => l.pessoas);
  return {
    projeto: { id: p.id, nome: p.nome },
    grupo: { id: (cfg?.whatsapp_grupo_id as string) ?? null, nome: (cfg?.whatsapp_grupo_nome as string) ?? null, sincronizado_em: isoDateTime(cfg?.whatsapp_grupo_sync_em) },
    totais: {
      membros_no_grupo: membros.length, lotes: lotes.length, lotes_com_alguem_no_grupo: lotes.filter((l) => l.algum_no_grupo).length,
      lotes_fora: lotes.filter((l) => !l.algum_no_grupo).length, pessoas_cadastradas: pessoas.length, pessoas_no_grupo: pessoas.filter((x) => x.no_grupo).length,
      sem_telefone: pessoas.filter((x) => !x.telefone).length, desconhecidos: desconhecidos.length, participantes: parts.length,
    },
    lotes, desconhecidos,
  };
}

export async function configurarGrupo(projetoId: number, grupoId: string | null, nome: string | null, usuario: string | null) {
  await buscarProjeto(projetoId);
  const id = txt(grupoId, 60);
  await exec(pool, 'UPDATE pa_projetos SET whatsapp_grupo_id = ?, whatsapp_grupo_nome = ? WHERE id = ?', [id, txt(nome, 160), projetoId]);
  if (!id) await exec(pool, 'DELETE FROM pa_whatsapp_grupo_membros WHERE projeto_id = ?', [projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'WHATSAPP_GRUPO_CONFIG', dados: { grupo: id, nome } });
  return situacaoGrupo(projetoId);
}

/** Lê os membros do grupo pela Z-API e guarda a fotografia. */
export async function sincronizarGrupo(projetoId: number, usuario: string | null) {
  const cfg = await one(pool, 'SELECT whatsapp_grupo_id FROM pa_projetos WHERE id = ?', [projetoId]);
  const gid = (cfg?.whatsapp_grupo_id as string) ?? null;
  if (!gid) throw new PaErro('GRUPO_NAO_CONFIGURADO', 'Escolha o grupo do WhatsApp do PA primeiro', 409);
  const wa = await import('../../integrations/whatsapp');
  let r: Awaited<ReturnType<typeof wa.membrosGrupoWhatsApp>>;
  try { r = await wa.membrosGrupoWhatsApp(gid); } catch (e) {
    throw new PaErro('ZAPI_INDISPONIVEL', `Não consegui ler o grupo pela Z-API (o número do sistema precisa estar no grupo e conectado): ${(e as Error).message}`.slice(0, 400), 502);
  }
  await exec(pool, 'DELETE FROM pa_whatsapp_grupo_membros WHERE projeto_id = ?', [projetoId]);
  if (r.membros.length) {
    await exec(pool, `INSERT INTO pa_whatsapp_grupo_membros (projeto_id, telefone, admin) VALUES ${r.membros.map(() => '(?, ?, ?)').join(',')}`,
      r.membros.flatMap((m) => [projetoId, m.telefone.slice(0, 20), m.admin ? 1 : 0]));
  }
  await exec(pool, 'UPDATE pa_projetos SET whatsapp_grupo_nome = ?, whatsapp_grupo_sync_em = NOW() WHERE id = ?', [r.nome.slice(0, 160), projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'WHATSAPP_GRUPO_SYNC', dados: { membros: r.membros.length } });
  return situacaoGrupo(projetoId);
}

/** Marcação manual (quando o grupo não pode ser lido, ou para corrigir). valor null = automático. */
export async function marcarGrupoManual(tipo: 'TITULAR' | 'PARTICIPANTE', id: number, valor: 'SIM' | 'NAO' | null, usuario: string | null) {
  if (tipo === 'TITULAR') {
    const r = await exec(pool, 'UPDATE pa_associados SET grupo_whatsapp_manual = ? WHERE id = ?', [valor, id]);
    if (!r.affectedRows) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não encontrado', 404);
    await registrarEvento(pool, { projeto_id: await projetoDoAssociado(id), associado_id: id, usuario, tipo: 'WHATSAPP_GRUPO_MANUAL', dados: { tipo, valor } });
  } else {
    const p = await one(pool, 'SELECT associado_id FROM pa_participantes WHERE id = ? AND ativo = 1', [id]);
    if (!p) throw new PaErro('PARTICIPANTE_NAO_ENCONTRADO', 'Participante não encontrado', 404);
    await exec(pool, 'UPDATE pa_participantes SET grupo_whatsapp_manual = ? WHERE id = ?', [valor, id]);
    await registrarEvento(pool, { projeto_id: await projetoDoAssociado(num(p.associado_id)), associado_id: num(p.associado_id), usuario, tipo: 'WHATSAPP_GRUPO_MANUAL', dados: { tipo, id, valor } });
  }
  return { ok: true };
}
