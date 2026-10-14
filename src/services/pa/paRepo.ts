// v3.142.0 — Projetos, lotes, associados e painel do módulo PA.
import { PaErro } from './erros';
import {
  pool, rows, one, exec, transacao, num, isoDate, isoDateTime, hojeBrasil, registrarEvento, type Db, type Row,
} from './paDb';
import {
  cpfValido, formatarCpf, normalizarTelefone, dataBrParaIso, soDigitos, emailValido,
} from './validadores';
import {
  planoPagamento, saldoLancamento, statusEfetivo, centavos,
  type StatusLancamento, type TipoLancamento,
} from './regrasFinanceiras';
import type { PerfilPa } from './lgpd';
import { marcaUrls } from './marcaProjeto';

// ─── Perfil ───────────────────────────────────────────────────────────────
export async function perfilOverride(sub: string | null): Promise<PerfilPa | null> {
  if (!sub) return null;
  try {
    const r = await one<{ perfil: PerfilPa }>(pool, 'SELECT perfil FROM pa_usuarios_perfil WHERE user_sub = ?', [sub]);
    return r?.perfil ?? null;
  } catch {
    return null; // tabela ainda não migrada → cai no role do JWT
  }
}

// ─── Projetos ─────────────────────────────────────────────────────────────
export interface Projeto {
  id: number; codigo: string; nome: string; municipio: string; uf: string;
  associacao_nome: string | null; associacao_cnpj: string | null; associacao_cnpj_status: string;
  presidente_nome: string | null; valor_lote: number; sinal_padrao: number; boleto_padrao: number;
  prazo_sinal: string | null; pix_chave: string | null; pix_favorecido: string | null; pix_cidade: string | null;
  rt_nome: string | null; rt_registro: string | null; layout_json: unknown; criado_em: string | null;
  cep_padrao: string | null; boleto_multa_pct: number; boleto_juros_mes_pct: number;
}

function mapProjeto(r: Row): Projeto {
  return {
    id: num(r.id), codigo: String(r.codigo), nome: String(r.nome), municipio: String(r.municipio), uf: String(r.uf),
    associacao_nome: (r.associacao_nome as string) ?? null, associacao_cnpj: (r.associacao_cnpj as string) ?? null,
    associacao_cnpj_status: String(r.associacao_cnpj_status ?? 'EM_HOMOLOGACAO'),
    presidente_nome: (r.presidente_nome as string) ?? null,
    valor_lote: num(r.valor_lote), sinal_padrao: num(r.sinal_padrao), boleto_padrao: num(r.boleto_padrao),
    prazo_sinal: isoDate(r.prazo_sinal), pix_chave: (r.pix_chave as string) ?? null,
    pix_favorecido: (r.pix_favorecido as string) ?? null, pix_cidade: (r.pix_cidade as string) ?? null,
    rt_nome: (r.rt_nome as string) ?? null, rt_registro: (r.rt_registro as string) ?? null,
    layout_json: r.layout_json ?? null, criado_em: isoDateTime(r.criado_em),
    cep_padrao: (r.cep_padrao as string) ?? null,
    boleto_multa_pct: r.boleto_multa_pct == null ? 2 : num(r.boleto_multa_pct),
    boleto_juros_mes_pct: r.boleto_juros_mes_pct == null ? 1 : num(r.boleto_juros_mes_pct),
  };
}

export async function listarProjetos(): Promise<Array<Projeto & { total_lotes: number; total_associados: number }>> {
  const r = await rows(pool, `
    SELECT p.*,
      (SELECT COUNT(*) FROM pa_lotes l WHERE l.projeto_id = p.id) AS total_lotes,
      (SELECT COUNT(*) FROM pa_associados a WHERE a.projeto_id = p.id AND a.ativo = 1) AS total_associados
    FROM pa_projetos p ORDER BY p.nome`);
  return r.map((x) => ({ ...mapProjeto(x), total_lotes: num(x.total_lotes), total_associados: num(x.total_associados) }));
}

export async function buscarProjeto(id: number, db: Db = pool): Promise<Projeto> {
  const r = await one(db, 'SELECT * FROM pa_projetos WHERE id = ?', [id]);
  if (!r) throw new PaErro('PROJETO_NAO_ENCONTRADO', 'Projeto não encontrado', 404);
  return mapProjeto(r);
}

function str(v: unknown, max: number): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
}
function dinheiro(v: unknown, campo: string): number {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new PaErro('CAMPO_INVALIDO', `${campo} inválido`, 400);
  return centavos(n);
}

export async function criarProjeto(body: Record<string, unknown>, usuario: string | null): Promise<Projeto> {
  const codigo = str(body.codigo, 40)?.toUpperCase().replace(/[^A-Z0-9\-]/g, '-');
  const nome = str(body.nome, 160);
  const municipio = str(body.municipio, 80);
  const uf = str(body.uf, 2)?.toUpperCase();
  if (!codigo || !nome || !municipio || !uf || uf.length !== 2) {
    throw new PaErro('CAMPO_INVALIDO', 'Informe código, nome, município e UF', 400);
  }
  const prazo = body.prazo_sinal ? (dataBrParaIso(body.prazo_sinal) ?? String(body.prazo_sinal).slice(0, 10)) : null;
  try {
    const r = await exec(pool, `
      INSERT INTO pa_projetos (codigo, nome, municipio, uf, associacao_nome, associacao_cnpj, associacao_cnpj_status,
        presidente_nome, valor_lote, sinal_padrao, boleto_padrao, prazo_sinal, pix_chave, pix_favorecido, pix_cidade,
        rt_nome, rt_registro, layout_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      codigo, nome, municipio, uf, str(body.associacao_nome, 200), str(body.associacao_cnpj, 18),
      body.associacao_cnpj_status === 'ATIVO' ? 'ATIVO' : 'EM_HOMOLOGACAO', str(body.presidente_nome, 160),
      dinheiro(body.valor_lote, 'Valor do lote'), dinheiro(body.sinal_padrao, 'Sinal padrão'),
      dinheiro(body.boleto_padrao, 'Boleto padrão'), prazo, str(body.pix_chave, 120),
      str(body.pix_favorecido, 25), str(body.pix_cidade, 15), str(body.rt_nome, 160), str(body.rt_registro, 60),
      body.layout_json ? JSON.stringify(body.layout_json) : null,
    ]);
    await registrarEvento(pool, { projeto_id: r.insertId, usuario, tipo: 'PROJETO_CRIADO', dados: { codigo } });
    return buscarProjeto(r.insertId);
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new PaErro('CODIGO_DUPLICADO', `Já existe projeto com código ${codigo}`, 409);
    throw err;
  }
}

// ─── Lançamentos (leitura) ────────────────────────────────────────────────
export interface Lancamento {
  id: number; associado_id: number; tipo: TipoLancamento; parcela: number; valor: number;
  vencimento: string | null; status: StatusLancamento; status_efetivo: StatusLancamento;
  valor_recebido: number; saldo: number; descricao: string | null;
}
export function mapLancamento(r: Row, hoje = hojeBrasil()): Lancamento {
  const base = {
    tipo: r.tipo as TipoLancamento, valor: num(r.valor), valor_recebido: num(r.valor_recebido),
    status: r.status as StatusLancamento, vencimento: isoDate(r.vencimento),
  };
  return {
    id: num(r.id), associado_id: num(r.associado_id), parcela: num(r.parcela), descricao: (r.descricao as string) ?? null,
    ...base, status_efetivo: statusEfetivo(base, hoje), saldo: saldoLancamento(base),
  };
}

// ─── Painel ───────────────────────────────────────────────────────────────
export async function painel(projetoId: number) {
  const projeto = await buscarProjeto(projetoId);
  const hoje = hojeBrasil();
  const fin = await one(pool, `
    SELECT
      COALESCE(SUM(CASE WHEN l.status <> 'CANCELADO' THEN l.valor END), 0) AS contratado,
      COALESCE(SUM(CASE WHEN l.status <> 'CANCELADO' THEN l.valor_recebido END), 0) AS recebido,
      COALESCE(SUM(CASE WHEN l.tipo = 'SINAL' AND l.status NOT IN ('PAGO','CANCELADO') THEN l.valor - l.valor_recebido END), 0) AS sinais_pendentes,
      COALESCE(SUM(CASE WHEN l.status NOT IN ('PAGO','CANCELADO') AND l.vencimento < ? THEN l.valor - l.valor_recebido END), 0) AS vencido,
      SUM(l.tipo IN ('SINAL','AVISTA') AND l.status = 'PAGO') AS sinais_pagos,
      SUM(l.tipo IN ('SINAL','AVISTA') AND l.status IN ('A_PAGAR','A_VENCER','VENCIDO')) AS sinais_a_pagar,
      SUM(l.tipo IN ('SINAL','AVISTA') AND l.status = 'PARCIAL') AS sinais_parciais,
      SUM(l.tipo = 'AVISTA' AND l.status = 'PAGO') AS quitados_avista
    FROM pa_lancamentos l
    JOIN pa_associados a ON a.id = l.associado_id AND a.ativo = 1
    WHERE a.projeto_id = ?`, [hoje, projetoId]);
  const contratado = num(fin?.contratado);
  const recebido = num(fin?.recebido);

  const lotes = await rows(pool, `
    SELECT tipo, status_medicao, COUNT(*) AS n FROM pa_lotes WHERE projeto_id = ? GROUP BY tipo, status_medicao`, [projetoId]);
  const porMedicao: Record<string, number> = { PENDENTE: 0, AGENDADA: 0, MEDIDO: 0, PROCESSADO: 0 };
  const porTipo: Record<string, number> = { ASSOCIADO: 0, INSTITUCIONAL: 0, VAGO: 0 };
  for (const r of lotes) {
    porMedicao[String(r.status_medicao)] = (porMedicao[String(r.status_medicao)] ?? 0) + num(r.n);
    porTipo[String(r.tipo)] = (porTipo[String(r.tipo)] ?? 0) + num(r.n);
  }

  const assoc = await one(pool, `
    SELECT COUNT(*) AS total, SUM(contrato_status = 'ASSINADO') AS assinados,
      SUM(carteirinha_emitida_em IS NOT NULL) AS carteirinhas
    FROM pa_associados WHERE projeto_id = ? AND ativo = 1`, [projetoId]);

  const entregas = await rows(pool, `
    SELECT e.status, COUNT(*) AS n FROM pa_entregas e JOIN pa_associados a ON a.id = e.associado_id
    WHERE a.projeto_id = ? GROUP BY e.status`, [projetoId]);

  const porDia = await rows(pool, `
    SELECT DATE(pago_em) AS dia, SUM(valor) AS total, COUNT(*) AS n
    FROM pa_pagamentos WHERE projeto_id = ? GROUP BY DATE(pago_em) ORDER BY dia`, [projetoId]);
  const porForma = await rows(pool, `
    SELECT forma, SUM(valor) AS total, COUNT(*) AS n FROM pa_pagamentos WHERE projeto_id = ? GROUP BY forma`, [projetoId]);

  // v3.145.0: previsão de recebimento por mês de vencimento, boletos e cadastro.
  const meses = await rows(pool, `
    SELECT DATE_FORMAT(l.vencimento, '%Y-%m') AS mes,
      SUM(l.valor) AS valor, SUM(l.valor_recebido) AS recebido, SUM(l.valor - l.valor_recebido) AS saldo
    FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id AND a.ativo = 1
    WHERE a.projeto_id = ? AND l.status <> 'CANCELADO' AND l.vencimento IS NOT NULL
    GROUP BY mes ORDER BY mes`, [projetoId]);
  let boletosResumo: Record<string, number> = {};
  try {
    const bs = await rows(pool, "SELECT status, COUNT(*) AS n, SUM(valor) AS total FROM pa_boletos WHERE projeto_id = ? AND status <> 'CANCELADO' GROUP BY status", [projetoId]);
    boletosResumo = Object.fromEntries(bs.map((r) => [String(r.status), num(r.n)]));
  } catch { boletosResumo = {}; }
  const cadastro = await pendenciasCadastrais(projetoId);

  return {
    projeto,
    marca: marcaUrls(projeto.codigo),
    previsao_mensal: meses.map((r) => ({ mes: String(r.mes), valor: num(r.valor), recebido: num(r.recebido), saldo: num(r.saldo) })),
    boletos: boletosResumo,
    cadastro,
    posicao_em: hoje,
    financeiro: {
      contratado, recebido, a_receber: centavos(contratado - recebido),
      sinais_pendentes: num(fin?.sinais_pendentes), vencido: num(fin?.vencido),
      sinais: { pagos: num(fin?.sinais_pagos), a_pagar: num(fin?.sinais_a_pagar), parciais: num(fin?.sinais_parciais), quitados_avista: num(fin?.quitados_avista) },
      recebido_por_dia: porDia.map((r) => ({ dia: isoDate(r.dia), total: num(r.total), n: num(r.n) })),
      recebido_por_forma: porForma.map((r) => ({ forma: String(r.forma), total: num(r.total), n: num(r.n) })),
    },
    lotes: { total: Object.values(porTipo).reduce((s, n) => s + n, 0), por_tipo: porTipo, por_status_medicao: porMedicao },
    associados: { total: num(assoc?.total), contratos_assinados: num(assoc?.assinados), carteirinhas_emitidas: num(assoc?.carteirinhas) },
    entregas: Object.fromEntries(entregas.map((r) => [String(r.status), num(r.n)])),
  };
}

// ─── v3.145.0: pendências cadastrais (o que falta em cada associado) ───────
export const ITENS_CADASTRO: Record<string, string> = {
  telefone: 'Telefone', whatsapp: 'WhatsApp', email: 'E-mail', nascimento: 'Nascimento', rg: 'RG',
  foto: 'Foto 3×4', documento: 'Documento de identidade', conjuge: 'CPF do cônjuge', contrato: 'Contrato assinado',
  observacao: 'Pendência anotada',
};

export async function pendenciasCadastrais(projetoId: number) {
  const as = await rows(pool, `
    SELECT a.id, a.numero, a.nome, a.telefone, a.telefone_e164, a.email, a.nascimento, a.rg, a.estado_civil,
      a.conjuge_cpf, a.contrato_status, a.pendencias, a.whatsapp_status, l.numero AS lote,
      (SELECT COUNT(*) FROM pa_documentos d WHERE d.associado_id = a.id AND d.tipo = 'FOTO_3X4' AND d.arquivo_presente = 1) AS fotos,
      (SELECT COUNT(*) FROM pa_documentos d WHERE d.associado_id = a.id AND d.tipo = 'DOC_IDENTIFICACAO' AND d.arquivo_presente = 1) AS docs
    FROM pa_associados a JOIN pa_lotes l ON l.id = a.lote_id
    WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY CAST(l.numero AS UNSIGNED)`, [projetoId]);
  const resumo: Record<string, number> = Object.fromEntries(Object.keys(ITENS_CADASTRO).map((k) => [k, 0]));
  const lista: Array<{ id: number; numero: string; nome: string; lote: string; telefone: string | null; faltando: string[]; observacao: string | null }> = [];
  for (const a of as) {
    const f: string[] = [];
    if (!a.telefone_e164) f.push('telefone');
    if (a.telefone_e164 && a.whatsapp_status !== 'VALIDO') f.push('whatsapp');
    if (!a.email || !emailValido(a.email)) f.push('email');
    if (!a.nascimento) f.push('nascimento');
    if (!a.rg) f.push('rg');
    if (num(a.fotos) === 0) f.push('foto');
    if (num(a.docs) === 0) f.push('documento');
    if (/casad/i.test(String(a.estado_civil ?? '')) && !a.conjuge_cpf) f.push('conjuge');
    if (a.contrato_status !== 'ASSINADO') f.push('contrato');
    if (a.pendencias && String(a.pendencias).trim()) f.push('observacao');
    for (const k of f) resumo[k]++;
    if (f.length) lista.push({ id: num(a.id), numero: String(a.numero), nome: String(a.nome), lote: String(a.lote), telefone: (a.telefone as string) ?? null, faltando: f, observacao: (a.pendencias as string) ?? null });
  }
  // Cadastro completo = só falta o que não depende do associado (contrato/WhatsApp ainda não verificado).
  const completos = as.length - lista.filter((x) => x.faltando.some((k) => !['contrato', 'whatsapp', 'observacao'].includes(k))).length;
  lista.sort((x, y) => y.faltando.length - x.faltando.length || Number(x.lote) - Number(y.lote));
  return { total: as.length, completos, itens: ITENS_CADASTRO, resumo, lista };
}

// ─── Lotes ────────────────────────────────────────────────────────────────
export async function listarLotes(projetoId: number) {
  await buscarProjeto(projetoId);
  const hoje = hojeBrasil();
  const ls = await rows(pool, `
    SELECT l.*, a.id AS associado_id, a.numero AS associado_numero, a.nome AS associado_nome,
      a.denominacao_terra, a.contrato_status
    FROM pa_lotes l LEFT JOIN pa_associados a ON a.lote_id = l.id AND a.ativo = 1
    WHERE l.projeto_id = ?
    ORDER BY CAST(l.numero AS UNSIGNED), l.numero`, [projetoId]);
  const lanc = await rows(pool, `
    SELECT l.* FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id
    WHERE a.projeto_id = ? AND a.ativo = 1`, [projetoId]);
  const porAssoc = new Map<number, Lancamento[]>();
  for (const r of lanc) {
    const m = mapLancamento(r, hoje);
    if (!porAssoc.has(m.associado_id)) porAssoc.set(m.associado_id, []);
    porAssoc.get(m.associado_id)!.push(m);
  }
  return ls.map((l) => {
    const aid = l.associado_id == null ? null : num(l.associado_id);
    const ll = aid ? porAssoc.get(aid) ?? [] : [];
    const sinal = ll.find((x) => x.tipo === 'SINAL' || x.tipo === 'AVISTA') ?? null;
    const saldo = centavos(ll.reduce((s, x) => s + x.saldo, 0));
    let situacao: 'SEM_ASSOCIADO' | 'QUITADO' | 'EM_DIA' | 'SINAL_PENDENTE' | 'SINAL_PARCIAL' | 'VENCIDO' = 'SEM_ASSOCIADO';
    if (aid) {
      if (saldo === 0) situacao = 'QUITADO';
      else if (ll.some((x) => x.status_efetivo === 'VENCIDO')) situacao = 'VENCIDO';
      else if (sinal?.status === 'PARCIAL') situacao = 'SINAL_PARCIAL';
      else if (sinal && sinal.status !== 'PAGO') situacao = 'SINAL_PENDENTE';
      else situacao = 'EM_DIA';
    }
    return {
      id: num(l.id), numero: String(l.numero), tipo: String(l.tipo),
      largura_m: l.largura_m == null ? null : num(l.largura_m), profundidade_m: l.profundidade_m == null ? null : num(l.profundidade_m),
      area_projeto_m2: l.area_projeto_m2 == null ? null : num(l.area_projeto_m2),
      area_medida_m2: l.area_medida_m2 == null ? null : num(l.area_medida_m2),
      perimetro_m: l.perimetro_m == null ? null : num(l.perimetro_m),
      croqui_xy: l.croqui_xy ?? null, geom_sirgas: l.geom_sirgas ?? null,
      status_medicao: String(l.status_medicao), data_medicao: isoDate(l.data_medicao),
      equipe: (l.equipe as string) ?? null, base_gnss: (l.base_gnss as string) ?? null,
      associado: aid ? {
        id: aid, numero: String(l.associado_numero), nome: String(l.associado_nome),
        denominacao_terra: (l.denominacao_terra as string) ?? null, contrato_status: String(l.contrato_status),
      } : null,
      financeiro: aid ? { saldo, situacao, sinal_status: sinal?.status ?? null } : { saldo: 0, situacao, sinal_status: null },
    };
  });
}

const STATUS_MEDICAO = ['PENDENTE', 'AGENDADA', 'MEDIDO', 'PROCESSADO'];

/** Normaliza vértices [{E,N,h}] ou [[E,N,h]] — rejeita lixo antes de gravar. */
function validarGeom(v: unknown): Array<{ E: number; N: number; h: number | null }> | null {
  if (v == null || v === '') return null;
  const arr = typeof v === 'string' ? JSON.parse(v) : v;
  if (!Array.isArray(arr) || arr.length < 3) throw new PaErro('GEOM_INVALIDA', 'Geometria precisa de ao menos 3 vértices', 400);
  return arr.map((p, i) => {
    const E = Number(Array.isArray(p) ? p[0] : (p as Record<string, unknown>).E ?? (p as Record<string, unknown>).e);
    const N = Number(Array.isArray(p) ? p[1] : (p as Record<string, unknown>).N ?? (p as Record<string, unknown>).n);
    const hRaw = Array.isArray(p) ? p[2] : (p as Record<string, unknown>).h ?? (p as Record<string, unknown>).H;
    if (!Number.isFinite(E) || !Number.isFinite(N)) throw new PaErro('GEOM_INVALIDA', `Vértice ${i + 1} sem E/N numéricos`, 400);
    const h = hRaw == null || hRaw === '' ? null : Number(hRaw);
    return { E, N, h: h != null && Number.isFinite(h) ? h : null };
  });
}

export async function atualizarLote(projetoId: number, numero: string, body: Record<string, unknown>, usuario: string | null) {
  const lote = await one(pool, 'SELECT * FROM pa_lotes WHERE projeto_id = ? AND numero = ?', [projetoId, numero]);
  if (!lote) throw new PaErro('LOTE_NAO_ENCONTRADO', `Lote ${numero} não encontrado`, 404);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const mudou: Record<string, unknown> = {};
  const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); mudou[col] = v; };

  if ('status_medicao' in body) {
    const s = String(body.status_medicao).toUpperCase();
    if (!STATUS_MEDICAO.includes(s)) throw new PaErro('CAMPO_INVALIDO', 'status_medicao inválido', 400);
    put('status_medicao', s);
  }
  if ('tipo' in body) {
    const t = String(body.tipo).toUpperCase();
    if (!['ASSOCIADO', 'INSTITUCIONAL', 'VAGO'].includes(t)) throw new PaErro('CAMPO_INVALIDO', 'tipo inválido', 400);
    put('tipo', t);
  }
  if ('data_medicao' in body) {
    const d = body.data_medicao ? (dataBrParaIso(body.data_medicao) ?? String(body.data_medicao).slice(0, 10)) : null;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new PaErro('CAMPO_INVALIDO', 'data_medicao inválida', 400);
    put('data_medicao', d);
  }
  if ('equipe' in body) put('equipe', str(body.equipe, 160));
  if ('base_gnss' in body) put('base_gnss', str(body.base_gnss, 60));
  for (const c of ['area_medida_m2', 'perimetro_m'] as const) {
    if (c in body) {
      const n = body[c] == null || body[c] === '' ? null : Number(String(body[c]).replace(',', '.'));
      if (n != null && (!Number.isFinite(n) || n < 0)) throw new PaErro('CAMPO_INVALIDO', `${c} inválido`, 400);
      put(c, n);
    }
  }
  if ('geom_sirgas' in body) {
    const g = validarGeom(body.geom_sirgas);
    sets.push('geom_sirgas = ?'); vals.push(g ? JSON.stringify(g) : null); mudou.geom_sirgas = g ? `${g.length} vértices` : null;
  }
  if (!sets.length) throw new PaErro('NADA_A_ATUALIZAR', 'Nenhum campo válido para atualizar', 400);
  await exec(pool, `UPDATE pa_lotes SET ${sets.join(', ')} WHERE id = ?`, [...vals, lote.id]);
  const assoc = await one(pool, 'SELECT id FROM pa_associados WHERE lote_id = ? AND ativo = 1', [lote.id]);
  await registrarEvento(pool, {
    projeto_id: projetoId, associado_id: assoc ? num(assoc.id) : null, usuario,
    tipo: 'status_medicao' in mudou ? 'LOTE_MEDICAO' : 'LOTE_ATUALIZADO', dados: { lote: numero, ...mudou },
  });
  const todos = await listarLotes(projetoId);
  return todos.find((l) => l.numero === numero)!;
}

// ─── Associados ───────────────────────────────────────────────────────────
export function mapAssociado(r: Row) {
  return {
    id: num(r.id), projeto_id: num(r.projeto_id), lote_id: num(r.lote_id), lote: (r.lote_numero as string) ?? null,
    numero: String(r.numero), nome: String(r.nome), cpf: String(r.cpf), rg: (r.rg as string) ?? null,
    nascimento: isoDate(r.nascimento), estado_civil: (r.estado_civil as string) ?? null,
    conjuge_nome: (r.conjuge_nome as string) ?? null, conjuge_cpf: (r.conjuge_cpf as string) ?? null,
    telefone: (r.telefone as string) ?? null, telefone_e164: (r.telefone_e164 as string) ?? null,
    email: (r.email as string) ?? null, denominacao_terra: (r.denominacao_terra as string) ?? null,
    endereco: (r.endereco as string) ?? null, dia_vencimento: r.dia_vencimento == null ? null : num(r.dia_vencimento),
    contrato_status: String(r.contrato_status), contrato_assinado_em: isoDateTime(r.contrato_assinado_em),
    carteirinha_emitida_em: isoDateTime(r.carteirinha_emitida_em), pendencias: (r.pendencias as string) ?? null,
    acervo_pasta: (r.acervo_pasta as string) ?? null, ativo: num(r.ativo) === 1,
    asaas_customer_id: (r.asaas_customer_id as string) ?? null,
    asaas_ambiente: (r.asaas_ambiente as string) ?? null,
    whatsapp_status: String(r.whatsapp_status ?? 'NAO_VERIFICADO'),
    whatsapp_numero: (r.whatsapp_numero as string) ?? null,
    whatsapp_verificado_em: isoDateTime(r.whatsapp_verificado_em),
  };
}
export type Associado = ReturnType<typeof mapAssociado>;

export async function listarAssociados(projetoId: number, q?: string) {
  await buscarProjeto(projetoId);
  const hoje = hojeBrasil();
  const params: unknown[] = [projetoId];
  let filtro = '';
  if (q && q.trim()) {
    const termo = `%${q.trim()}%`;
    const dig = soDigitos(q);
    filtro = ' AND (a.nome LIKE ? OR a.numero LIKE ? OR l.numero = ? OR a.denominacao_terra LIKE ?' + (dig.length >= 3 ? " OR REPLACE(REPLACE(a.cpf, '.', ''), '-', '') LIKE ? OR a.telefone_e164 LIKE ?" : '') + ')';
    params.push(termo, termo, q.trim().padStart(2, '0'), termo);
    if (dig.length >= 3) params.push(`%${dig}%`, `%${dig}%`);
  }
  const as = await rows(pool, `
    SELECT a.*, l.numero AS lote_numero FROM pa_associados a JOIN pa_lotes l ON l.id = a.lote_id
    WHERE a.projeto_id = ? AND a.ativo = 1${filtro}
    ORDER BY CAST(l.numero AS UNSIGNED), l.numero`, params);
  const ids = as.map((a) => num(a.id));
  const lanc = ids.length ? await rows(pool, `SELECT * FROM pa_lancamentos WHERE associado_id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  const docs = ids.length ? await rows(pool, `SELECT associado_id, COUNT(*) AS n, SUM(arquivo_presente) AS presentes, SUM(tipo = 'FOTO_3X4' AND arquivo_presente = 1) AS fotos FROM pa_documentos WHERE associado_id IN (${ids.map(() => '?').join(',')}) GROUP BY associado_id`, ids) : [];
  const docMap = new Map(docs.map((d) => [num(d.associado_id), { total: num(d.n), com_arquivo: num(d.presentes), tem_foto: num(d.fotos) > 0 }]));
  return as.map((a) => {
    const ll = lanc.filter((l) => num(l.associado_id) === num(a.id)).map((l) => mapLancamento(l, hoje));
    return {
      ...mapAssociado(a),
      financeiro: {
        contratado: centavos(ll.filter((l) => l.status !== 'CANCELADO').reduce((s, l) => s + l.valor, 0)),
        recebido: centavos(ll.reduce((s, l) => s + l.valor_recebido, 0)),
        saldo: centavos(ll.reduce((s, l) => s + l.saldo, 0)),
        sinal_status: (ll.find((l) => l.tipo === 'SINAL' || l.tipo === 'AVISTA')?.status_efetivo) ?? null,
        vencidos: ll.filter((l) => l.status_efetivo === 'VENCIDO').length,
      },
      documentos: docMap.get(num(a.id)) ?? { total: 0, com_arquivo: 0, tem_foto: false },
    };
  });
}

export async function buscarAssociado(aid: number, db: Db = pool) {
  const a = await one(db, `
    SELECT a.*, l.numero AS lote_numero FROM pa_associados a JOIN pa_lotes l ON l.id = a.lote_id WHERE a.id = ?`, [aid]);
  if (!a) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não encontrado', 404);
  return mapAssociado(a);
}

export async function detalheAssociado(aid: number) {
  const associado = await buscarAssociado(aid);
  const hoje = hojeBrasil();
  const lanc = (await rows(pool, `SELECT * FROM pa_lancamentos WHERE associado_id = ? ORDER BY FIELD(tipo,'SINAL','AVISTA','BOLETO','AJUSTE'), parcela`, [aid]))
    .map((l) => mapLancamento(l, hoje));
  const pags = await rows(pool, `
    SELECT p.*, r.lancamento_id, r.valor AS valor_rateio
    FROM pa_pagamento_rateio r JOIN pa_pagamentos p ON p.id = r.pagamento_id
    JOIN pa_lancamentos l ON l.id = r.lancamento_id
    WHERE l.associado_id = ? ORDER BY p.pago_em, p.id`, [aid]);
  const pagamentos = new Map<number, Record<string, unknown>>();
  for (const p of pags) {
    const id = num(p.id);
    if (!pagamentos.has(id)) {
      const outros = await one(pool, `
        SELECT COUNT(DISTINCT l.associado_id) AS n FROM pa_pagamento_rateio r JOIN pa_lancamentos l ON l.id = r.lancamento_id
        WHERE r.pagamento_id = ?`, [id]);
      pagamentos.set(id, {
        id, forma: p.forma, valor: num(p.valor), pago_em: isoDateTime(p.pago_em), id_transacao: p.id_transacao ?? null,
        pagador_nome: p.pagador_nome ?? null, pagador_cpf_parcial: p.pagador_cpf_parcial ?? null,
        pagador_instituicao: p.pagador_instituicao ?? null, vinculo_pagador: p.vinculo_pagador ?? null,
        url_recibo: p.url_recibo ?? null, comprovante_doc_id: p.comprovante_doc_id == null ? null : num(p.comprovante_doc_id),
        obs: p.obs ?? null, pagamento_compartilhado: num(outros?.n) > 1, rateio: [] as Array<{ lancamento_id: number; valor: number }>,
      });
    }
    (pagamentos.get(id)!.rateio as Array<{ lancamento_id: number; valor: number }>).push({ lancamento_id: num(p.lancamento_id), valor: num(p.valor_rateio) });
  }
  const documentos = (await rows(pool, `
    SELECT id, tipo, versao, caminho, nome_original, mime, sha256, tamanho, arquivo_presente, assinaturas_json, criado_em
    FROM pa_documentos WHERE associado_id = ? ORDER BY tipo, versao`, [aid])).map((d) => ({
    id: num(d.id), tipo: String(d.tipo), versao: num(d.versao), caminho: String(d.caminho), nome_original: d.nome_original ?? null,
    mime: d.mime ?? null, sha256: d.sha256 ?? null, tamanho: d.tamanho == null ? null : num(d.tamanho),
    arquivo_presente: num(d.arquivo_presente) === 1, assinaturas: d.assinaturas_json ?? null, criado_em: isoDateTime(d.criado_em),
  }));
  const entregas = (await rows(pool, 'SELECT * FROM pa_entregas WHERE associado_id = ? ORDER BY id', [aid])).map((e) => ({
    id: num(e.id), protocolo: String(e.protocolo), itens: e.itens_json, status: String(e.status),
    entregue_em: isoDateTime(e.entregue_em), recebedor_nome: e.recebedor_nome ?? null, recebedor_cpf: e.recebedor_cpf ?? null, forma: e.forma ?? null,
  }));
  const eventos = (await rows(pool, 'SELECT * FROM pa_eventos WHERE associado_id = ? ORDER BY id DESC LIMIT 100', [aid])).map((e) => ({
    id: num(e.id), tipo: String(e.tipo), usuario: e.usuario_id ?? null, dados: e.dados ?? null, criado_em: isoDateTime(e.criado_em),
  }));
  return {
    associado,
    lancamentos: lanc,
    resumo: {
      contratado: centavos(lanc.filter((l) => l.status !== 'CANCELADO').reduce((s, l) => s + l.valor, 0)),
      recebido: centavos(lanc.reduce((s, l) => s + l.valor_recebido, 0)),
      saldo: centavos(lanc.reduce((s, l) => s + l.saldo, 0)),
    },
    pagamentos: [...pagamentos.values()],
    documentos, entregas, eventos,
  };
}

/** PASM a partir de "PA-SALETE-MORENO": PA + iniciais das demais palavras. */
export function prefixoProjeto(codigo: string): string {
  const partes = codigo.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!partes.length) return 'PA';
  const [primeira, ...resto] = partes;
  return (primeira.slice(0, 2) + resto.map((p) => p[0]).join('')).slice(0, 10);
}

/** Avisos de telefone repetido (regra §5.8: avisar, não bloquear). */
async function avisosTelefone(db: Db, projetoId: number, e164: string | null, ignorarId: number | null): Promise<string[]> {
  if (!e164) return [];
  const dups = await rows(db, 'SELECT numero, nome FROM pa_associados WHERE projeto_id = ? AND telefone_e164 = ? AND ativo = 1 AND id <> ?', [projetoId, e164, ignorarId ?? 0]);
  return dups.map((d) => `telefone igual ao de ${d.numero} (${d.nome})`);
}

export interface ResultadoAssociado {
  detalhe: Awaited<ReturnType<typeof detalheAssociado>>;
  avisos: string[];
}

export async function criarAssociado(projetoId: number, body: Record<string, unknown>, usuario: string | null): Promise<ResultadoAssociado> {
  const avisos: string[] = [];
  const aid = await transacao(async (c) => {
    const projeto = await buscarProjeto(projetoId, c);
    const nome = str(body.nome, 160);
    if (!nome) throw new PaErro('CAMPO_INVALIDO', 'Nome é obrigatório', 400);
    if (!cpfValido(body.cpf)) throw new PaErro('CPF_INVALIDO', 'CPF inválido (dígito verificador não confere)', 422);
    const cpf = formatarCpf(body.cpf);
    if (await one(c, 'SELECT id FROM pa_associados WHERE projeto_id = ? AND cpf = ?', [projetoId, cpf])) {
      throw new PaErro('CPF_DUPLICADO', `CPF ${cpf} já cadastrado neste projeto`, 409);
    }
    const numLote = String(body.lote ?? '').trim().padStart(2, '0');
    const lote = await one(c, 'SELECT * FROM pa_lotes WHERE projeto_id = ? AND numero = ? FOR UPDATE', [projetoId, numLote]);
    if (!lote) throw new PaErro('LOTE_NAO_ENCONTRADO', `Lote ${numLote} não existe no projeto`, 404);
    if (lote.tipo === 'INSTITUCIONAL') throw new PaErro('LOTE_INSTITUCIONAL', `Lote ${numLote} é área institucional`, 409);
    const ocupado = await one(c, 'SELECT numero, nome FROM pa_associados WHERE lote_id = ?', [lote.id]);
    if (ocupado) throw new PaErro('LOTE_OCUPADO', `Lote ${numLote} já pertence a ${ocupado.numero} (${ocupado.nome})`, 409);

    let conjugeCpf: string | null = null;
    if (body.conjuge_cpf) {
      if (!cpfValido(body.conjuge_cpf)) throw new PaErro('CPF_INVALIDO', 'CPF do cônjuge inválido', 422);
      conjugeCpf = formatarCpf(body.conjuge_cpf);
    }
    const tel = normalizarTelefone(body.telefone);
    avisos.push(...tel.avisos, ...(await avisosTelefone(c, projetoId, tel.e164, null)));
    if (body.email && !emailValido(body.email)) avisos.push('e-mail com formato estranho (mantido como informado)');
    const dia = body.dia_vencimento == null || body.dia_vencimento === '' ? null : Number(body.dia_vencimento);
    if (dia != null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) throw new PaErro('CAMPO_INVALIDO', 'dia_vencimento deve ser 1–31', 400);
    const numero = str(body.numero, 20) ?? `${prefixoProjeto(projeto.codigo)}-${numLote.padStart(3, '0')}`;

    let ins;
    try {
      ins = await exec(c, `
        INSERT INTO pa_associados (projeto_id, lote_id, numero, nome, cpf, rg, nascimento, estado_civil, conjuge_nome,
          conjuge_cpf, telefone, telefone_e164, email, denominacao_terra, endereco, dia_vencimento, pendencias, acervo_pasta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        projetoId, lote.id, numero, nome.toUpperCase(), cpf, str(body.rg, 80),
        body.nascimento ? dataBrParaIso(body.nascimento) ?? String(body.nascimento).slice(0, 10) : null,
        str(body.estado_civil, 60), str(body.conjuge_nome, 160), conjugeCpf, str(body.telefone, 60), tel.e164,
        str(body.email, 160), str(body.denominacao_terra, 120), str(body.endereco, 255), dia, str(body.pendencias, 5000),
        str(body.acervo_pasta, 160),
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new PaErro('NUMERO_DUPLICADO', `Número ${numero} já existe no projeto`, 409);
      throw err;
    }
    if (lote.tipo === 'VAGO') await exec(c, "UPDATE pa_lotes SET tipo = 'ASSOCIADO' WHERE id = ?", [lote.id]);

    const sinal = body.sinal == null || body.sinal === '' ? projeto.sinal_padrao : dinheiro(body.sinal, 'Sinal');
    const plano = planoPagamento(projeto, sinal, dia, hojeBrasil());
    for (const p of plano) {
      await exec(c, 'INSERT INTO pa_lancamentos (associado_id, tipo, parcela, valor, vencimento, status) VALUES (?, ?, ?, ?, ?, ?)', [
        ins.insertId, p.tipo, p.parcela, p.valor, p.vencimento, p.tipo === 'BOLETO' ? 'A_VENCER' : 'A_PAGAR',
      ]);
    }
    await registrarEvento(c, {
      projeto_id: projetoId, associado_id: ins.insertId, usuario, tipo: 'ASSOCIADO_CRIADO',
      dados: { numero, lote: numLote, sinal, plano: plano.map((p) => `${p.tipo}${p.parcela || ''}=${p.valor}`), avisos },
    });
    return ins.insertId;
  });
  return { detalhe: await detalheAssociado(aid), avisos };
}

const CAMPOS_EDITAVEIS: Record<string, number> = {
  nome: 160, rg: 80, estado_civil: 60, conjuge_nome: 160, telefone: 60, email: 160,
  denominacao_terra: 120, endereco: 255, pendencias: 5000, acervo_pasta: 160,
};

export async function atualizarAssociado(aid: number, body: Record<string, unknown>, usuario: string | null): Promise<ResultadoAssociado> {
  const atual = await buscarAssociado(aid);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const avisos: string[] = [];
  const mudou: Record<string, unknown> = {};
  const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); mudou[col] = col === 'cpf' || col === 'conjuge_cpf' ? '(alterado)' : v; };

  for (const [c, max] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (c in body) put(c, c === 'nome' ? str(body[c], max)?.toUpperCase() ?? null : str(body[c], max));
  }
  if ('nome' in body && !str(body.nome, 160)) throw new PaErro('CAMPO_INVALIDO', 'Nome não pode ficar vazio', 400);
  if ('telefone' in body) {
    const tel = normalizarTelefone(body.telefone);
    put('telefone_e164', tel.e164);
    // v3.143.0: telefone mudou → a verificação de WhatsApp antiga não vale mais.
    sets.push("whatsapp_status = 'NAO_VERIFICADO'", 'whatsapp_numero = NULL', 'whatsapp_verificado_em = NULL');
    avisos.push(...tel.avisos, ...(await avisosTelefone(pool, atual.projeto_id, tel.e164, aid)));
  }
  if ('email' in body && body.email && !emailValido(body.email)) avisos.push('e-mail com formato estranho (mantido como informado)');
  if ('cpf' in body) {
    if (!cpfValido(body.cpf)) throw new PaErro('CPF_INVALIDO', 'CPF inválido (dígito verificador não confere)', 422);
    const cpf = formatarCpf(body.cpf);
    if (cpf !== atual.cpf && await one(pool, 'SELECT id FROM pa_associados WHERE projeto_id = ? AND cpf = ? AND id <> ?', [atual.projeto_id, cpf, aid])) {
      throw new PaErro('CPF_DUPLICADO', `CPF ${cpf} já cadastrado neste projeto`, 409);
    }
    put('cpf', cpf);
  }
  if ('conjuge_cpf' in body) {
    if (body.conjuge_cpf && !cpfValido(body.conjuge_cpf)) throw new PaErro('CPF_INVALIDO', 'CPF do cônjuge inválido', 422);
    put('conjuge_cpf', body.conjuge_cpf ? formatarCpf(body.conjuge_cpf) : null);
  }
  if ('nascimento' in body) put('nascimento', body.nascimento ? dataBrParaIso(body.nascimento) ?? String(body.nascimento).slice(0, 10) : null);
  if ('dia_vencimento' in body) {
    const d = body.dia_vencimento == null || body.dia_vencimento === '' ? null : Number(body.dia_vencimento);
    if (d != null && (!Number.isInteger(d) || d < 1 || d > 31)) throw new PaErro('CAMPO_INVALIDO', 'dia_vencimento deve ser 1–31', 400);
    put('dia_vencimento', d);
  }
  if ('contrato_status' in body) {
    const s = String(body.contrato_status).toUpperCase();
    if (!['GERADO', 'ENVIADO', 'ASSINADO'].includes(s)) throw new PaErro('CAMPO_INVALIDO', 'contrato_status inválido', 400);
    put('contrato_status', s);
    if (s === 'ASSINADO' && !atual.contrato_assinado_em) { sets.push('contrato_assinado_em = NOW()'); }
  }
  if (!sets.length) throw new PaErro('NADA_A_ATUALIZAR', 'Nenhum campo válido para atualizar', 400);
  try {
    await exec(pool, `UPDATE pa_associados SET ${sets.join(', ')} WHERE id = ?`, [...vals, aid]);
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new PaErro('CPF_DUPLICADO', 'CPF já cadastrado neste projeto', 409);
    throw err;
  }
  await registrarEvento(pool, { projeto_id: atual.projeto_id, associado_id: aid, usuario, tipo: 'ASSOCIADO_ATUALIZADO', dados: { campos: mudou, avisos } });
  return { detalhe: await detalheAssociado(aid), avisos };
}

/**
 * Regra §5.4 — sinal diferente do padrão: refaz SINAL + BOLETOS a partir do novo
 * sinal. Só permitido enquanto nenhum boleto recebeu valor (senão o histórico
 * de pagamento ficaria inconsistente).
 */
export async function recalcularPlano(aid: number, sinalInformado: unknown, usuario: string | null) {
  await transacao(async (c) => {
    const a = await buscarAssociado(aid, c);
    const projeto = await buscarProjeto(a.projeto_id, c);
    const sinal = dinheiro(sinalInformado, 'Sinal');
    const atuais = await rows(c, 'SELECT * FROM pa_lancamentos WHERE associado_id = ? FOR UPDATE', [aid]);
    const recebidoSinal = atuais.filter((l) => l.tipo === 'SINAL' || l.tipo === 'AVISTA').reduce((s, l) => s + num(l.valor_recebido), 0);
    if (atuais.some((l) => l.tipo === 'BOLETO' && num(l.valor_recebido) > 0)) {
      throw new PaErro('PLANO_COM_BOLETO_PAGO', 'Já existe boleto com valor recebido — ajuste manual (lançamento AJUSTE) necessário', 409);
    }
    if (recebidoSinal > sinal + 0.009) {
      throw new PaErro('SINAL_MENOR_QUE_RECEBIDO', `Já foram recebidos R$ ${recebidoSinal.toFixed(2)} de sinal`, 409);
    }
    const plano = planoPagamento(projeto, sinal, a.dia_vencimento, hojeBrasil());
    const sinalAntigo = atuais.find((l) => l.tipo === 'SINAL' || l.tipo === 'AVISTA');
    // Rateios do sinal antigo migram pro novo lançamento de entrada.
    await exec(c, "DELETE FROM pa_lancamentos WHERE associado_id = ? AND tipo = 'BOLETO'", [aid]);
    for (const p of plano) {
      if (p.tipo === 'SINAL' || p.tipo === 'AVISTA') {
        const recebido = centavos(recebidoSinal);
        const status: StatusLancamento = recebido >= p.valor - 0.009 ? 'PAGO' : recebido > 0 ? 'PARCIAL' : 'A_PAGAR';
        if (sinalAntigo) {
          await exec(c, 'UPDATE pa_lancamentos SET tipo = ?, valor = ?, vencimento = ?, status = ?, valor_recebido = ? WHERE id = ?', [
            p.tipo, p.valor, p.vencimento, status, recebido, sinalAntigo.id,
          ]);
        } else {
          await exec(c, 'INSERT INTO pa_lancamentos (associado_id, tipo, parcela, valor, vencimento, status, valor_recebido) VALUES (?, ?, 0, ?, ?, ?, ?)', [
            aid, p.tipo, p.valor, p.vencimento, status, recebido,
          ]);
        }
      } else {
        await exec(c, "INSERT INTO pa_lancamentos (associado_id, tipo, parcela, valor, vencimento, status) VALUES (?, 'BOLETO', ?, ?, ?, 'A_VENCER')", [
          aid, p.parcela, p.valor, p.vencimento,
        ]);
      }
    }
    await registrarEvento(c, {
      projeto_id: a.projeto_id, associado_id: aid, usuario, tipo: 'PLANO_RECALCULADO',
      dados: { sinal, plano: plano.map((p) => `${p.tipo}${p.parcela || ''}=${p.valor}@${p.vencimento ?? '-'}`) },
    });
  });
  return detalheAssociado(aid);
}

export async function desativarAssociado(aid: number, usuario: string | null, motivo: string | null) {
  const a = await buscarAssociado(aid);
  const pagos = await one(pool, 'SELECT COALESCE(SUM(valor_recebido),0) AS r FROM pa_lancamentos WHERE associado_id = ?', [aid]);
  if (num(pagos?.r) > 0) throw new PaErro('ASSOCIADO_COM_PAGAMENTO', 'Associado tem pagamentos lançados — não pode ser excluído', 409);
  // Sem pagamento = cadastro feito por engano: remove de vez (LGPD — não fica
  // dado pessoal órfão) e o lote volta a VAGO. Com pagamento, nunca.
  await transacao(async (c) => {
    await exec(c, 'DELETE f FROM pa_documentos_arquivos f JOIN pa_documentos d ON d.id = f.documento_id WHERE d.associado_id = ?', [aid]);
    await exec(c, 'DELETE FROM pa_documentos WHERE associado_id = ?', [aid]);
    await exec(c, 'DELETE FROM pa_entregas WHERE associado_id = ?', [aid]);
    await exec(c, 'DELETE FROM pa_lancamentos WHERE associado_id = ?', [aid]);
    await exec(c, "UPDATE pa_lotes SET tipo = 'VAGO' WHERE id = ? AND tipo = 'ASSOCIADO'", [a.lote_id]);
    await exec(c, 'DELETE FROM pa_associados WHERE id = ?', [aid]);
    await registrarEvento(c, { projeto_id: a.projeto_id, associado_id: null, usuario, tipo: 'ASSOCIADO_EXCLUIDO', dados: { numero: a.numero, nome: a.nome, lote: a.lote, motivo } });
  });
}
