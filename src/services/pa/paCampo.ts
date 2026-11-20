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

/**
 * Marcos que o lote exige para fechar a poligonal.
 * v3.188.3: TODOS os vértices do lote — inclusive os de perímetro que já existem no chão. A equipe só crava os
 * internos, mas tem que marcar (confirmar) todos os pontos para o lote fechar como MEDIDO; lote de perímetro não
 * fecha mais sozinho só porque os marcos a cravar foram feitos por um vizinho. `existentes` fica só informativo.
 */
export function exigidos(vertices: string[], _existentes?: Set<string>): string[] {
  return [...new Set(vertices)];
}

// ─── v3.194.0: bloqueio de lote ────────────────────────────────────────────
/** Lotes bloqueados pelo ADMIN (lote "05" → motivo). */
export async function lotesBloqueados(projetoId: number): Promise<Map<string, string | null>> {
  const r = await rows(pool, 'SELECT codigo, bloqueio_motivo FROM pa_lotes_producao WHERE projeto_id = ? AND bloqueado = 1', [projetoId]).catch(() => []);
  return new Map(r.map((x) => [String(x.codigo).replace(/^LT-/i, ''), (x.bloqueio_motivo as string) ?? null]));
}
/** Marco só pode ser marcado se for vértice de ao menos um lote NÃO bloqueado (pura — testável). */
export function marcoLiberado(lotesDoMarco: string[], bloqueados: Set<string> | Map<string, unknown>): boolean {
  return !lotesDoMarco.length || lotesDoMarco.some((l) => !bloqueados.has(l));
}
export async function bloquearLote(projetoId: number, loteQ: unknown, bloquear: unknown, motivoQ: unknown, u: Usuario) {
  const m = /^\s*(?:LT[\s-]*)?(\d{1,4}[A-Z]?)\s*$/i.exec(String(loteQ ?? ''));
  if (!m) throw new PaErro('CAMPO_INVALIDO', 'Lote inválido', 400);
  const lote = m[1].replace(/^(\d)$/, '0$1').toUpperCase();
  const sim = bloquear === true || bloquear === 1 || bloquear === '1' || bloquear === 'true';
  const motivo = sim ? (String(motivoQ ?? '').trim().slice(0, 200) || null) : null;
  await exec(pool, `INSERT INTO pa_lotes_producao (projeto_id, codigo, bloqueado, bloqueio_motivo, bloqueado_em, bloqueado_por) VALUES (?, ?, ?, ?, ${sim ? 'NOW()' : 'NULL'}, ?)
    ON DUPLICATE KEY UPDATE bloqueado = VALUES(bloqueado), bloqueio_motivo = VALUES(bloqueio_motivo), bloqueado_em = VALUES(bloqueado_em), bloqueado_por = VALUES(bloqueado_por)`, [projetoId, `LT-${lote}`, sim ? 1 : 0, motivo, sim ? u.nome : null]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario: u.id, tipo: sim ? 'CAMPO_LOTE_BLOQUEADO' : 'CAMPO_LOTE_DESBLOQUEADO', dados: { lote, motivo } });
  return { lote, bloqueado: sim, motivo };
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
export interface PagamentoLote { parcelas: number; pagas: number; pct: number; quitado: boolean; marcos_lancados: boolean; marcos_pago: boolean; quitado_em?: string | null }
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
      SUM(l.tipo = 'MARCO' AND ${sqlLancamentoQuitado('l')}) AS marcos_pagos,
      -- v3.190.0: data da quitação = último pagamento rateado nas parcelas do contrato (ordem da agenda de campo)
      (SELECT MAX(pg.pago_em) FROM pa_lancamentos l2 JOIN pa_pagamento_rateio rt ON rt.lancamento_id = l2.id JOIN pa_pagamentos pg ON pg.id = rt.pagamento_id
        WHERE l2.associado_id = l.associado_id AND l2.tipo <> 'MARCO' AND l2.status <> 'CANCELADO') AS ultimo_pagamento
    FROM pa_lancamentos l JOIN pa_associados a ON a.id = l.associado_id
    WHERE a.projeto_id = ? AND a.ativo = 1 AND l.status <> 'CANCELADO' GROUP BY l.associado_id`, [projetoId]);
  return new Map(r.map((x) => {
    const parcelas = num(x.parcelas), pagas = num(x.pagas), marcos = num(x.marcos);
    return [num(x.associado_id), { parcelas, pagas, pct: parcelas ? Math.round((pagas / parcelas) * 1000) / 10 : 0, quitado: parcelas > 0 && pagas >= parcelas, marcos_lancados: marcos > 0, marcos_pago: marcos > 0 && num(x.marcos_pagos) >= marcos,
      quitado_em: parcelas > 0 && pagas >= parcelas ? (isoDateTime(x.ultimo_pagamento) ?? null) : null }];
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
    aviso_enviado_em: r.aviso_enviado_em ? dt(r.aviso_enviado_em) : null, aviso_erro: (r.aviso_erro as string) ?? null, aviso_tentativas: r.aviso_tentativas != null ? num(r.aviso_tentativas) : 0,
    base: (r.base_gnss as string) ?? null, rover: (r.rover_gnss as string) ?? null, pontos: num(r.pontos), area_ha: r.area_ha != null ? num(r.area_ha) : null, perimetro_m: r.perimetro_m != null ? num(r.perimetro_m) : null,
  }));
  const porPonto = new Map(marcas.map((x) => [x.ponto, x]));
  const existentes = new Set(d.pontos.filter((p) => p.existente).map((p) => p.nome));
  const fech = new Map(fechados.map((f) => [f.lote, f]));
  const ben = await vinculosParcelas(projetoId).catch((e) => { console.warn('[pa-campo] vínculos lote→associado indisponíveis:', (e as Error).message); return {} as Awaited<ReturnType<typeof vinculosParcelas>>; });
  const pags = await pagamentosPorAssociado(projetoId).catch((e) => { console.warn('[pa-campo] situação de pagamento indisponível:', (e as Error).message); return new Map<number, PagamentoLote>(); });
  // v3.191.2: situação do dossiê do lote (cor própria no mapa: medido ≠ dossiê enviado ≠ quitado)
  const dossies = new Map((await rows(pool, 'SELECT lote, status FROM pa_dossies WHERE projeto_id = ?', [projetoId]).catch(() => [])).map((r) => [String(r.lote), String(r.status)]));
  const bloq = await lotesBloqueados(projetoId); // v3.194.0
  return {
    pontos: d.pontos.map((p) => ({ nome: p.nome, E: p.E, N: p.N, lat: p.lat, lon: p.lon, tipo: p.tipo, lotes: p.lotes, existente: !!p.existente, implantar_com: p.implantar_com ?? null, marca: porPonto.get(p.nome) ?? null, bloqueado: !marcoLiberado(p.lotes, bloq) })),
    lotes: ordemServico(d.lotes.map((l) => {
      const vs = [...new Set(l.vertices)];
      const imp = exigidos(vs); // v3.188.3: todos os vértices (cravar + confirmar os que já existem)
      const b = ben[l.lote];
      return { lote: l.lote, area_ha: l.area_ha, vertices: vs, exigidos: imp, a_implantar: vs.filter((v) => !existentes.has(v)).length, existentes: vs.filter((v) => existentes.has(v)).length, marcados: imp.filter((v) => porPonto.has(v)).length, fechado: fech.get(l.lote) ?? null,
        associado: b ? { nome: b.nome, lote_vila: b.lote_vila, denominacao: b.denominacao ?? null } : null, dossie: dossies.get(l.lote) ?? null, bloqueado: bloq.has(l.lote), bloqueio_motivo: bloq.get(l.lote) ?? null,
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
  const bloq = await lotesBloqueados(projetoId); // v3.194.0: bloqueado nunca fecha
  const candidatos = d.lotes.filter((l) => (!soLotes || soLotes.includes(l.lote)) && !jaFechados.has(l.lote) && !bloq.has(l.lote)).map((l) => ({ ...l, vertices: exigidos(l.vertices, existentes) }));
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
    void avisarLoteDemarcado(projetoId, lote).catch((e) => console.warn('[pa-campo] aviso CEO:', (e as Error).message));
  }
  return fechados;
}

/**
 * v3.188.1/v3.188.5: mensagem ao CEO "lote demarcado" + libera o dossiê (o PDF de revisão vem logo em seguida, se quitado).
 * Persistente: reserva a linha (um envio por vez), grava aviso_enviado_em no sucesso e aviso_erro na falha —
 * o vigia tenta de novo (até 6x, nas 12 h seguintes ao fechamento) se a Z-API falhar ou o servidor reiniciar.
 */
export async function avisarLoteDemarcado(projetoId: number, lote: string, forcar = false): Promise<{ enviado: boolean; erro?: string }> {
  const reserva = await exec(pool, `UPDATE pa_campo_lotes SET aviso_reservado_em = NOW(), aviso_tentativas = aviso_tentativas + 1
    WHERE projeto_id = ? AND lote = ? AND (aviso_enviado_em IS NULL OR ?) AND (aviso_reservado_em IS NULL OR aviso_reservado_em < NOW() - INTERVAL 3 MINUTE)`, [projetoId, lote, forcar ? 1 : 0]);
  if (!reserva.affectedRows) return { enviado: false, erro: 'já enviado ou envio em andamento' };
  const cl = await one(pool, 'SELECT * FROM pa_campo_lotes WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  try {
    const dz = await import('./paDossie');
    const wa = await import('./paWhatsapp');
    const d = await pontosColetora(projetoId);
    const marcos = [...new Set(d.lotes.find((x) => x.lote === lote)?.vertices ?? [])];
    const ben = (await vinculosParcelas(projetoId).catch(() => ({} as Awaited<ReturnType<typeof vinculosParcelas>>)))[lote] ?? null;
    let situacao = '⚠️ Lote sem associado vinculado — dossiê não gerado.';
    if (ben) {
      try {
        const r = await dz.criarDossie(projetoId, lote, null);
        const pend = r.status === 'PRONTO' ? null : (await dz.listarDossies(projetoId)).find((x) => x.lote === lote)?.pendencia ?? null;
        situacao = r.status === 'PRONTO' ? '📦 *Dossiê liberado* — o PDF chega a seguir para você revisar e tocar em *✅ Aprovar e enviar*.'
          : `📦 Dossiê criado, *aguardando pagamento*${pend ? ` (${pend})` : ''} — libera sozinho quando quitar.`;
      } catch (e) { situacao = `⚠️ Dossiê não gerado: ${(e as Error).message}`; }
    }
    const area = cl?.area_ha != null ? num(cl.area_ha) : null, per = cl?.perimetro_m != null ? num(cl.perimetro_m) : null;
    const txt = [`✅ *LT-${lote} DEMARCADO*`, ben ? `👤 ${ben.nome} · vila ${ben.lote_vila}${ben.denominacao ? ` · ${ben.denominacao}` : ''}` : null,
      `📍 Poligonal fechada: ${marcos.length} vértices (${marcos.join(', ')})${area != null ? ` · ${area.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha` : ''}${per != null ? ` · ${per.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m` : ''}`,
      cl?.usuario_nome ? `👷 Fechado por ${cl.usuario_nome}` : null, situacao].filter(Boolean).join('\n');
    await wa.enviarWhatsAppNumero(dz.numeroCeo(), txt);
    await exec(pool, 'UPDATE pa_campo_lotes SET aviso_enviado_em = NOW(), aviso_reservado_em = NULL, aviso_erro = NULL WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
    await registrarEvento(pool, { projeto_id: projetoId, associado_id: ben?.associado_id ?? null, usuario: null, tipo: 'CAMPO_AVISO_CEO', dados: { lote, ok: true } });
    if (ben) await dz.enviarProntos(projetoId, [ben.associado_id]).catch((e) => console.warn('[pa-campo] dossiê revisão:', (e as Error).message));
    return { enviado: true };
  } catch (e) {
    const bruto = (e as Error).message;
    // v3.188.6: WhatsApp da instância desconectado na Z-API → não gasta tentativa (o vigia segue tentando até reconectar)
    const desconectado = /disconnected|desconectad|not connected/i.test(bruto);
    const msg = (desconectado ? 'WhatsApp do sistema DESCONECTADO na Z-API — reconecte a instância (QR code no painel da Z-API); o aviso sai sozinho depois' : bruto).slice(0, 250);
    console.warn(`[pa-campo] aviso LT-${lote} falhou:`, bruto.slice(0, 250));
    await exec(pool, `UPDATE pa_campo_lotes SET aviso_reservado_em = NULL, aviso_erro = ?${desconectado ? ', aviso_tentativas = GREATEST(aviso_tentativas - 1, 0)' : ''} WHERE projeto_id = ? AND lote = ?`, [msg, projetoId, lote]).catch(() => undefined);
    return { enviado: false, erro: msg };
  }
}

/** v3.188.5: vigia — reenvia avisos de lote demarcado que não saíram (até 6 tentativas, nas 12 h seguintes). */
export async function processarAvisosPendentes(): Promise<number> {
  const ps = await rows(pool, `SELECT projeto_id, lote FROM pa_campo_lotes WHERE aviso_enviado_em IS NULL AND aviso_tentativas < 6
    AND concluido_em >= NOW() - INTERVAL 12 HOUR AND (aviso_reservado_em IS NULL OR aviso_reservado_em < NOW() - INTERVAL 3 MINUTE) ORDER BY concluido_em LIMIT 10`);
  for (const p of ps) await avisarLoteDemarcado(num(p.projeto_id), String(p.lote)).catch(() => undefined);
  return ps.length;
}
let vigiaAvisos: NodeJS.Timeout | null = null;
export function iniciarVigiaAvisosCampo(): void {
  if (vigiaAvisos) return;
  const rodar = () => { processarAvisosPendentes().catch((e) => console.error('[pa-campo] vigia avisos:', (e as Error).message)); };
  setTimeout(rodar, 45_000);
  vigiaAvisos = setInterval(rodar, 2 * 60_000);
  vigiaAvisos.unref?.();
}

/** Marca um ponto como locado. Fecha (como MEDIDO) todo lote que ficar completo com ele. */
export async function marcarPonto(projetoId: number, ponto: string, entrada: { gps?: { lat?: unknown; lon?: unknown; precisao?: unknown } | null; obs?: unknown; base?: unknown; rover?: unknown }, u: Usuario) {
  const base = eqp(entrada.base, EQUIPAMENTOS_PADRAO.base), rover = eqp(entrada.rover, EQUIPAMENTOS_PADRAO.rover);
  const d = await pontosColetora(projetoId);
  const p = d.pontos.find((x) => x.nome === ponto);
  if (!p) throw new PaErro('PONTO_NAO_ENCONTRADO', `Ponto ${ponto} não existe no levantamento`, 404);
  { const bloq = await lotesBloqueados(projetoId); if (!marcoLiberado(p.lotes, bloq)) throw new PaErro('LOTE_BLOQUEADO', `${ponto} é só do ${p.lotes.map((l) => 'LT-' + l).join('/')}, que está BLOQUEADO${bloq.get(p.lotes[0]) ? ` (${bloq.get(p.lotes[0])})` : ''} — não pode ser marcado`, 409); }
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

/** v3.188.4: marca vários vértices de uma vez (checklist do lote) e fecha a poligonal no fim. */
export async function marcarPontos(projetoId: number, pontosRaw: unknown, entrada: { obs?: unknown; base?: unknown; rover?: unknown }, u: Usuario) {
  const nomes = [...new Set((Array.isArray(pontosRaw) ? pontosRaw : []).map((x) => String(x ?? '').trim().slice(0, 40)).filter(Boolean))].slice(0, 60);
  if (!nomes.length) throw new PaErro('CAMPO_INVALIDO', 'Selecione ao menos um marco', 400);
  const base = eqp(entrada.base, EQUIPAMENTOS_PADRAO.base), rover = eqp(entrada.rover, EQUIPAMENTOS_PADRAO.rover);
  const obs = entrada.obs ? String(entrada.obs).trim().slice(0, 255) || null : null;
  const d = await pontosColetora(projetoId);
  const desconhecidos = nomes.filter((n) => !d.pontos.some((p) => p.nome === n));
  if (desconhecidos.length) throw new PaErro('PONTO_NAO_ENCONTRADO', `Marco(s) fora do levantamento: ${desconhecidos.join(', ')}`, 404);
  const bloq = await lotesBloqueados(projetoId);
  const travados = nomes.filter((n) => !marcoLiberado(d.pontos.find((p) => p.nome === n)!.lotes, bloq));
  if (travados.length) throw new PaErro('LOTE_BLOQUEADO', `Marco(s) só de lote BLOQUEADO — não podem ser marcados: ${travados.join(', ')}`, 409);
  const ja = new Set((await rows(pool, `SELECT ponto FROM pa_campo_pontos WHERE projeto_id = ? AND ponto IN (${nomes.map(() => '?').join(',')})`, [projetoId, ...nomes])).map((r) => String(r.ponto)));
  const marcados: string[] = []; const lotes = new Set<string>();
  for (const n of nomes) {
    const p = d.pontos.find((x) => x.nome === n)!;
    p.lotes.forEach((l) => lotes.add(l));
    if (ja.has(n)) continue;
    const ins = await exec(pool, `INSERT IGNORE INTO pa_campo_pontos (projeto_id, ponto, e, n, marcado_em, usuario_id, usuario_nome, base_gnss, rover_gnss, gps_lat, gps_lon, gps_precisao, obs)
      VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, NULL, NULL, NULL, ?)`, [projetoId, n, p.E, p.N, u.id, u.nome, base, rover, obs]);
    if (ins.affectedRows) marcados.push(n);
  }
  if (marcados.length) await registrarEvento(pool, { projeto_id: projetoId, usuario: u.id, tipo: 'CAMPO_PONTO_MARCADO', dados: { pontos: marcados, lotes: [...lotes], em_lote: true } });
  const fechados = await fecharCompletos(projetoId, u, base, rover, [...lotes]);
  return { marcados, ja_marcados: [...ja], lotes_fechados: fechados };
}
