// v3.169.0 — Produção de campo: o funcionário marca no mapa cada marco que locou
// (data/hora, quem, GPS do celular). Quando todos os vértices de um lote estão
// marcados, o lote fecha sozinho como MEDIDO (área, perímetro e associado do lote).
// Produção por dia e por funcionário: pontos, lotes fechados e horas em campo
// (do primeiro ao último ponto do dia).
import { PaErro } from './erros';
import { sqlLancamentoQuitado } from './regrasFinanceiras';
import { pool, rows, one, exec, num, isoDateTime, registrarEvento } from './paDb';
import { pontosColetora } from './paColetora';
import { buscarSubdivisao, vinculosParcelas } from './paMapas';

export interface Usuario { id: string | null; nome: string | null }
/** v3.169.0: equipamentos padrão da Romatec (gravados em cada ponto/lote sem precisar digitar). */
export const EQUIPAMENTOS_PADRAO = { base: 'S6 Plus (base)', rover: 'Jupiter ComNav / SinoGNSS (rover)' };
const eqp = (v: unknown, padrao: string) => { const t = v == null ? '' : String(v).trim().slice(0, 80); return t || padrao; };
export interface MarcaPonto { ponto: string; marcado_em: string; usuario_nome: string | null; base: string | null; rover: string | null; usuario_id: string | null; obs: string | null; gps: { lat: number; lon: number; precisao: number | null } | null }

/** Marcos que o lote exige para fechar: os a cravar; se o lote só tem marcos já existentes (perímetro), confirma esses. */
export function exigidos(vertices: string[], existentes: Set<string>): string[] {
  const vs = [...new Set(vertices)];
  const imp = vs.filter((v) => !existentes.has(v));
  return imp.length ? imp : vs;
}

/** Lotes cujos vértices estão todos marcados (pura — testável). */
export function lotesCompletos(lotes: Array<{ lote: string; vertices: string[] }>, marcados: Set<string>): string[] {
  return lotes.filter((l) => l.vertices.length > 0 && [...new Set(l.vertices)].every((v) => marcados.has(v))).map((l) => l.lote);
}

/** v3.176.2: data/hora gravada com NOW() (UTC) → dia no horário de Brasília (UTC-3). */
export function diaBrasilia(isoUtc: string): string {
  const t = Date.parse(String(isoUtc).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(isoUtc) ? '' : 'Z'));
  return Number.isNaN(t) ? String(isoUtc).slice(0, 10) : new Date(t - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Produção por dia e funcionário (pura — testável). Horas = do primeiro ao último ponto do dia. */
export function producaoPorDia(marcas: Array<{ marcado_em: string; usuario_nome: string | null }>, fechados: Array<{ concluido_em: string; usuario_nome: string | null }>) {
  const dia = diaBrasilia;
  const m = new Map<string, { dia: string; usuario: string; pontos: number; lotes: number; primeiro: string; ultimo: string }>();
  const k = (d: string, u: string) => `${d}|${u}`;
  for (const x of marcas) {
    const u = x.usuario_nome || '—', d = dia(x.marcado_em), key = k(d, u);
    const r = m.get(key) ?? { dia: d, usuario: u, pontos: 0, lotes: 0, primeiro: x.marcado_em, ultimo: x.marcado_em };
    r.pontos++; if (x.marcado_em < r.primeiro) r.primeiro = x.marcado_em; if (x.marcado_em > r.ultimo) r.ultimo = x.marcado_em;
    m.set(key, r);
  }
  for (const f of fechados) { const r = m.get(k(dia(f.concluido_em), f.usuario_nome || '—')); if (r) r.lotes++; }
  return [...m.values()].map((r) => ({ ...r, horas: Math.round(((Date.parse(r.ultimo) - Date.parse(r.primeiro)) / 3600000) * 10) / 10 }))
    .sort((a, b) => (a.dia === b.dia ? a.usuario.localeCompare(b.usuario) : b.dia.localeCompare(a.dia)));
}

const dt = (v: unknown) => isoDateTime(v) ?? String(v);

// ─── v3.171.0: ordem de serviço de campo pelo pagamento ───────────────────
// Cor e prioridade de cada lote pela proporção de PARCELAS DO CONTRATO pagas (sem valores em R$ —
// o funcionário de campo vê só a situação). Preferência (não bloqueia): medir primeiro os quitados.
export interface PagamentoLote { parcelas: number; pagas: number; pct: number; quitado: boolean; marcos_lancados: boolean; marcos_pago: boolean }
export const FAIXAS_PAGAMENTO: ReadonlyArray<{ id: string; rotulo: string; cor: string; min: number }> = [
  { id: 'QUITADO', rotulo: 'Quitado ★', cor: '#1E7B34', min: 100 },
  { id: 'P75', rotulo: '75% a 99%', cor: '#8BC34A', min: 75 },
  { id: 'P50', rotulo: '50% a 74%', cor: '#F2C94C', min: 50 },
  { id: 'P25', rotulo: '25% a 49%', cor: '#F2994A', min: 25 },
  { id: 'P1', rotulo: '1% a 24%', cor: '#EB5757', min: 0.01 },
  { id: 'P0', rotulo: 'Nada pago', cor: '#9B1C1C', min: 0 },
  { id: 'SEM', rotulo: 'Sem associado', cor: '#B8BDB9', min: -1 },
];
export function faixaPagamento(p: PagamentoLote | null): (typeof FAIXAS_PAGAMENTO)[number] {
  if (!p || !p.parcelas) return FAIXAS_PAGAMENTO[FAIXAS_PAGAMENTO.length - 1];
  if (p.quitado) return FAIXAS_PAGAMENTO[0];
  return FAIXAS_PAGAMENTO.find((f) => f.id !== 'QUITADO' && f.id !== 'SEM' && p.pct >= f.min) ?? FAIXAS_PAGAMENTO[5];
}
/** Ordem de serviço: a medir primeiro (quitados com marcos pagos → quitados → maior % pago → sem associado), medidos no fim. */
export function ordemServico<T extends { lote: string; fechado: unknown; pagamento: PagamentoLote | null }>(lotes: T[]): T[] {
  const nota = (l: T) => {
    const p = l.pagamento;
    if (!p || !p.parcelas) return -1;
    return p.quitado ? 1000 + (p.marcos_pago ? 100 : 0) : p.pct;
  };
  return [...lotes].sort((a, b) => (a.fechado ? 1 : 0) - (b.fechado ? 1 : 0) || nota(b) - nota(a) || a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true }));
}
async function pagamentosPorAssociado(projetoId: number): Promise<Map<number, PagamentoLote>> {
  const r = await rows(pool, `SELECT l.associado_id,
      SUM(l.tipo <> 'MARCO') AS parcelas,
      SUM(l.tipo <> 'MARCO' AND ${sqlLancamentoQuitado('l')}) AS pagas,
      SUM(l.tipo = 'MARCO') AS marcos,
      SUM(l.tipo = 'MARCO' AND ${sqlLancamentoQuitado('l')}) AS marcos_pagos
    FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id
    WHERE a.projeto_id = ? AND a.ativo = 1 AND l.status <> 'CANCELADO' GROUP BY l.associado_id`, [projetoId]);
  return new Map(r.map((x) => {
    const parcelas = num(x.parcelas), pagas = num(x.pagas), marcos = num(x.marcos);
    return [num(x.associado_id), { parcelas, pagas, pct: parcelas ? Math.round((pagas / parcelas) * 1000) / 10 : 0, quitado: parcelas > 0 && pagas >= parcelas, marcos_lancados: marcos > 0, marcos_pago: marcos > 0 && num(x.marcos_pagos) >= marcos }];
  }));
}

export async function estadoCampo(projetoId: number) {
  // v3.188.1: lote que ficou completo sem um clique novo (ex.: correção dos vértices do LT-10) fecha aqui
  await fecharCompletos(projetoId, { id: null, nome: 'Sistema (revisão dos vértices)' }, EQUIPAMENTOS_PADRAO.base, EQUIPAMENTOS_PADRAO.rover).catch((e) => console.warn('[pa-campo] fechamento automático:', (e as Error).message));
  const d = await pontosColetora(projetoId);
  const marcas = (await rows(pool, 'SELECT * FROM pa_campo_pontos WHERE projeto_id = ? ORDER BY marcado_em', [projetoId])).map((r): MarcaPonto => ({
    ponto: String(r.ponto), marcado_em: dt(r.marcado_em), usuario_nome: (r.usuario_nome as string) ?? null, base: (r.base_gnss as string) ?? null, rover: (r.rover_gnss as string) ?? null, usuario_id: (r.usuario_id as string) ?? null, obs: (r.obs as string) ?? null,
    gps: r.gps_lat != null ? { lat: num(r.gps_lat), lon: num(r.gps_lon), precisao: r.gps_precisao != null ? num(r.gps_precisao) : null } : null,
  }));
  const fechados = (await rows(pool, 'SELECT * FROM pa_campo_lotes WHERE projeto_id = ? ORDER BY concluido_em', [projetoId])).map((r) => ({
    lote: String(r.lote), concluido_em: dt(r.concluido_em), inicio_em: r.inicio_em ? dt(r.inicio_em) : null, usuario_nome: (r.usuario_nome as string) ?? null,
    base: (r.base_gnss as string) ?? null, rover: (r.rover_gnss as string) ?? null, pontos: num(r.pontos), area_ha: r.area_ha != null ? num(r.area_ha) : null, perimetro_m: r.perimetro_m != null ? num(r.perimetro_m) : null,
  }));
  const porPonto = new Map(marcas.map((x) => [x.ponto, x]));
  const existentes = new Set(d.pontos.filter((p) => p.existente).map((p) => p.nome));
  const fech = new Map(fechados.map((f) => [f.lote, f]));
  const ben = await vinculosParcelas(projetoId).catch((e) => { console.warn('[pa-campo] vínculos lote→associado indisponíveis:', (e as Error).message); return {} as Awaited<ReturnType<typeof vinculosParcelas>>; });
  const pags = await pagamentosPorAssociado(projetoId).catch((e) => { console.warn('[pa-campo] situação de pagamento indisponível:', (e as Error).message); return new Map<number, PagamentoLote>(); });
  return {
    pontos: d.pontos.map((p) => ({ nome: p.nome, E: p.E, N: p.N, lat: p.lat, lon: p.lon, tipo: p.tipo, lotes: p.lotes, existente: !!p.existente, implantar_com: p.implantar_com ?? null, marca: porPonto.get(p.nome) ?? null })),
    lotes: ordemServico(d.lotes.map((l) => {
      const vs = [...new Set(l.vertices)];
      const imp = exigidos(vs, existentes); // marcos a cravar (o perímetro já existe)
      const b = ben[l.lote];
      return { lote: l.lote, area_ha: l.area_ha, vertices: vs, exigidos: imp, a_implantar: vs.filter((v) => !existentes.has(v)).length, existentes: vs.filter((v) => existentes.has(v)).length, marcados: imp.filter((v) => porPonto.has(v)).length, fechado: fech.get(l.lote) ?? null,
        associado: b ? { nome: b.nome, lote_vila: b.lote_vila, denominacao: b.denominacao ?? null } : null,
        pagamento: b ? pags.get(b.associado_id) ?? { parcelas: 0, pagas: 0, pct: 0, quitado: false, marcos_lancados: false, marcos_pago: false } : null };
    })).map((l, i) => ({ ...l, prioridade: l.fechado ? null : i + 1, faixa: faixaPagamento(l.pagamento).id })),
    faixas: FAIXAS_PAGAMENTO,
    producao: producaoPorDia(marcas, fechados),
    equipamentos: EQUIPAMENTOS_PADRAO,
    totais: { pontos: d.pontos.length, a_implantar: d.pontos.filter((p) => !p.existente && p.origem === 'LOTE').length, existentes: existentes.size, marcados: marcas.filter((m) => !existentes.has(m.ponto)).length, lotes: d.lotes.length, fechados: fechados.length },
  };
}

/**
 * Fecha (como MEDIDO) os lotes cujos marcos exigidos estão todos marcados e ainda não fecharam.
 * v3.188.1: para cada lote fechado → libera o dossiê (vai para a revisão do CEO quando quitado) e avisa
 * o CEO no WhatsApp que o lote foi demarcado. `soLotes` limita aos lotes do ponto recém-marcado.
 */
export async function fecharCompletos(projetoId: number, u: Usuario, base: string, rover: string, soLotes: string[] | null = null) {
  const d = await pontosColetora(projetoId);
  const marcados = new Set((await rows(pool, 'SELECT ponto FROM pa_campo_pontos WHERE projeto_id = ?', [projetoId])).map((r) => String(r.ponto)));
  const jaFechados = new Set((await rows(pool, 'SELECT lote FROM pa_campo_lotes WHERE projeto_id = ?', [projetoId])).map((r) => String(r.lote)));
  const existentes = new Set(d.pontos.filter((x) => x.existente).map((x) => x.nome));
  const candidatos = d.lotes.filter((l) => (!soLotes || soLotes.includes(l.lote)) && !jaFechados.has(l.lote)).map((l) => ({ ...l, vertices: exigidos(l.vertices, existentes) }));
  const novos = lotesCompletos(candidatos, marcados);
  const fechados: Array<{ lote: string; area_ha: number; associado: string | null }> = [];
  if (!novos.length) return fechados;
  const sub = await buscarSubdivisao(projetoId);
  const ben = await vinculosParcelas(projetoId).catch((e) => { console.warn('[pa-campo] vínculos lote→associado indisponíveis:', (e as Error).message); return {} as Awaited<ReturnType<typeof vinculosParcelas>>; });
  for (const lote of novos) {
    const pc = sub?.parcelas.find((x) => x.lote === lote);
    const vs = d.lotes.find((x) => x.lote === lote)!.vertices; const vsEx = exigidos(vs, existentes);
    const ini = await one(pool, `SELECT MIN(marcado_em) m, MAX(marcado_em) f FROM pa_campo_pontos WHERE projeto_id = ? AND ponto IN (${vsEx.map(() => '?').join(',')})`, [projetoId, ...vsEx]);
    const ins = await exec(pool, `INSERT IGNORE INTO pa_campo_lotes (projeto_id, lote, concluido_em, usuario_id, usuario_nome, inicio_em, pontos, area_ha, perimetro_m, associado_id, base_gnss, rover_gnss)
      VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [projetoId, lote, u.id, u.nome, ini?.m ?? null, new Set(vs).size, pc?.perimetro.area_ha ?? null, pc?.perimetro.perimetro_m ?? null, ben[lote]?.associado_id ?? null, base, rover]);
    if (!ins.affectedRows) continue; // outro pedido fechou ao mesmo tempo
    await registrarEvento(pool, { projeto_id: projetoId, associado_id: ben[lote]?.associado_id ?? null, usuario: u.id, tipo: 'CAMPO_LOTE_MEDIDO', dados: { lote, pontos: new Set(vs).size, area_ha: pc?.perimetro.area_ha ?? null } });
    fechados.push({ lote, area_ha: pc?.perimetro.area_ha ?? 0, associado: ben[lote]?.nome ?? null });
    void avisarLoteDemarcado(projetoId, lote, { area_ha: pc?.perimetro.area_ha ?? null, perimetro_m: pc?.perimetro.perimetro_m ?? null, marcos: vs, quem: u.nome, ben: ben[lote] ?? null }).catch((e) => console.warn('[pa-campo] aviso CEO:', (e as Error).message));
  }
  return fechados;
}

/** v3.188.1: mensagem ao CEO "lote demarcado" + libera o dossiê (o PDF de revisão vem logo em seguida, se quitado). */
async function avisarLoteDemarcado(projetoId: number, lote: string, o: { area_ha: number | null; perimetro_m: number | null; marcos: string[]; quem: string | null; ben: { associado_id: number; nome: string; lote_vila: string; denominacao?: string | null } | null }) {
  const dz = await import('./paDossie');
  const wa = await import('./paWhatsapp');
  let situacao = '⚠️ Lote sem associado vinculado — dossiê não gerado.';
  if (o.ben) {
    try {
      const r = await dz.criarDossie(projetoId, lote, null);
      const pend = r.status === 'PRONTO' ? null : (await dz.listarDossies(projetoId)).find((x) => x.lote === lote)?.pendencia ?? null;
      situacao = r.status === 'PRONTO' ? '📦 *Dossiê liberado* — o PDF chega a seguir para você revisar e tocar em *✅ Aprovar e enviar*.'
        : `📦 Dossiê criado, *aguardando pagamento*${pend ? ` (${pend})` : ''} — libera sozinho quando quitar.`;
    } catch (e) { situacao = `⚠️ Dossiê não gerado: ${(e as Error).message}`; }
  }
  const ha = o.area_ha != null ? `${o.area_ha.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha` : '';
  const txt = [`✅ *LT-${lote} DEMARCADO*`, o.ben ? `👤 ${o.ben.nome} · vila ${o.ben.lote_vila}${o.ben.denominacao ? ` · ${o.ben.denominacao}` : ''}` : null,
    `📍 Perímetro fechado: ${o.marcos.length} vértices (${o.marcos.join(', ')})${ha ? ` · ${ha}` : ''}${o.perimetro_m != null ? ` · ${o.perimetro_m.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m` : ''}`,
    o.quem ? `👷 Fechado por ${o.quem}` : null, situacao].filter(Boolean).join('\n');
  await wa.enviarWhatsAppNumero(dz.numeroCeo(), txt).catch((e) => console.warn('[pa-campo] WhatsApp CEO:', (e as Error).message));
  if (o.ben) await dz.enviarProntos(projetoId, [o.ben.associado_id]).catch(() => undefined);
}

/** Marca um ponto como locado. Fecha (como MEDIDO) todo lote que ficar completo com ele. */
export async function marcarPonto(projetoId: number, ponto: string, entrada: { gps?: { lat?: unknown; lon?: unknown; precisao?: unknown } | null; obs?: unknown; base?: unknown; rover?: unknown }, u: Usuario) {
  const base = eqp(entrada.base, EQUIPAMENTOS_PADRAO.base), rover = eqp(entrada.rover, EQUIPAMENTOS_PADRAO.rover);
  const d = await pontosColetora(projetoId);
  const p = d.pontos.find((x) => x.nome === ponto);
  if (!p) throw new PaErro('PONTO_NAO_ENCONTRADO', `Ponto ${ponto} não existe no levantamento`, 404);
  const g = entrada.gps && Number.isFinite(Number(entrada.gps.lat)) && Number.isFinite(Number(entrada.gps.lon)) ? entrada.gps : null;
  const obs = entrada.obs ? String(entrada.obs).trim().slice(0, 255) || null : null;
  const ja = await one(pool, 'SELECT id FROM pa_campo_pontos WHERE projeto_id = ? AND ponto = ?', [projetoId, ponto]);
  if (ja) throw new PaErro('PONTO_JA_MARCADO', `O ponto ${ponto} já está marcado`, 409);
  await exec(pool, `INSERT INTO pa_campo_pontos (projeto_id, ponto, e, n, marcado_em, usuario_id, usuario_nome, base_gnss, rover_gnss, gps_lat, gps_lon, gps_precisao, obs)
    VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)`, [projetoId, ponto, p.E, p.N, u.id, u.nome, base, rover, g ? Number(g.lat) : null, g ? Number(g.lon) : null, g && g.precisao != null && Number.isFinite(Number(g.precisao)) ? Number(g.precisao) : null, obs]);
  const fechados = await fecharCompletos(projetoId, u, base, rover, p.lotes);
  await registrarEvento(pool, { projeto_id: projetoId, usuario: u.id, tipo: 'CAMPO_PONTO_MARCADO', dados: { ponto, lotes: p.lotes, gps: !!g } });
  return { ponto, lotes_fechados: fechados };
}

/** Desfaz uma marcação: o próprio funcionário no mesmo dia, ou o ADMIN. Reabre o lote se estava fechado. */
export async function desmarcarPonto(projetoId: number, ponto: string, u: Usuario, admin: boolean) {
  const r = await one(pool, 'SELECT id, usuario_id, DATE(marcado_em) = CURDATE() AS hoje FROM pa_campo_pontos WHERE projeto_id = ? AND ponto = ?', [projetoId, ponto]);
  if (!r) throw new PaErro('PONTO_NAO_MARCADO', 'Ponto não está marcado', 404);
  if (!admin && !(String(r.usuario_id) === String(u.id) && num(r.hoje) === 1)) throw new PaErro('SEM_PERMISSAO', 'Só dá para desfazer a sua marcação do mesmo dia — peça ao escritório', 403);
  await exec(pool, 'DELETE FROM pa_campo_pontos WHERE id = ?', [r.id]);
  const d = await pontosColetora(projetoId);
  const lotes = d.pontos.find((x) => x.nome === ponto)?.lotes ?? [];
  if (lotes.length) {
    await exec(pool, `DELETE FROM pa_campo_lotes WHERE projeto_id = ? AND lote IN (${lotes.map(() => '?').join(',')})`, [projetoId, ...lotes]);
    // v3.188.2: lote reaberto → dossiê ainda não enviado ao associado volta do zero (sai de novo ao fechar)
    await exec(pool, `DELETE FROM pa_dossies WHERE projeto_id = ? AND enviado_em IS NULL AND entregue_em IS NULL AND lote IN (${lotes.map(() => '?').join(',')})`, [projetoId, ...lotes]);
  }
  await registrarEvento(pool, { projeto_id: projetoId, usuario: u.id, tipo: 'CAMPO_PONTO_DESMARCADO', dados: { ponto, lotes_reabertos: lotes } });
  return { ponto, lotes_reabertos: lotes };
}

/**
 * v3.188.2 (ADMIN): reabre um lote medido para refazer o fechamento — desfaz a última marcação de um marco
 * exigido do lote (o lote e os vizinhos que dependem desse marco voltam para "em medição") e limpa o
 * dossiê ainda não enviado. Ao marcar o marco de novo, o lote fecha e o aviso vai para o WhatsApp do CEO.
 */
export async function reabrirLote(projetoId: number, lote: string, u: Usuario) {
  const fechado = await one(pool, 'SELECT id FROM pa_campo_lotes WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  if (!fechado) throw new PaErro('LOTE_NAO_FECHADO', `LT-${lote} não está medido`, 409);
  const d = await pontosColetora(projetoId);
  const l = d.lotes.find((x) => x.lote === lote);
  if (!l) throw new PaErro('LOTE_NAO_ENCONTRADO', `LT-${lote} não está na subdivisão`, 404);
  const existentes = new Set(d.pontos.filter((x) => x.existente).map((x) => x.nome));
  const vs = exigidos(l.vertices, existentes);
  const ult = vs.length ? await one(pool, `SELECT ponto FROM pa_campo_pontos WHERE projeto_id = ? AND ponto IN (${vs.map(() => '?').join(',')}) ORDER BY marcado_em DESC, id DESC LIMIT 1`, [projetoId, ...vs]) : null;
  if (!ult) { // fechou sem marcação própria: só reabre
    await exec(pool, 'DELETE FROM pa_campo_lotes WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
    await exec(pool, 'DELETE FROM pa_dossies WHERE projeto_id = ? AND lote = ? AND enviado_em IS NULL AND entregue_em IS NULL', [projetoId, lote]);
    await registrarEvento(pool, { projeto_id: projetoId, usuario: u.id, tipo: 'CAMPO_LOTE_REABERTO', dados: { lote, ponto: null } });
    return { lote, ponto: null as string | null, lotes_reabertos: [lote] };
  }
  const r = await desmarcarPonto(projetoId, String(ult.ponto), u, true);
  await registrarEvento(pool, { projeto_id: projetoId, usuario: u.id, tipo: 'CAMPO_LOTE_REABERTO', dados: { lote, ponto: r.ponto, lotes_reabertos: r.lotes_reabertos } });
  return { lote, ponto: r.ponto as string | null, lotes_reabertos: r.lotes_reabertos };
}
