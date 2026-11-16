// v3.169.0 — Produção de campo: o funcionário marca no mapa cada marco que locou
// (data/hora, quem, GPS do celular). Quando todos os vértices de um lote estão
// marcados, o lote fecha sozinho como MEDIDO (área, perímetro e associado do lote).
// Produção por dia e por funcionário: pontos, lotes fechados e horas em campo
// (do primeiro ao último ponto do dia).
import { PaErro } from './erros';
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

/** Produção por dia e funcionário (pura — testável). Horas = do primeiro ao último ponto do dia. */
export function producaoPorDia(marcas: Array<{ marcado_em: string; usuario_nome: string | null }>, fechados: Array<{ concluido_em: string; usuario_nome: string | null }>) {
  const dia = (iso: string) => iso.slice(0, 10);
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

export async function estadoCampo(projetoId: number) {
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
  const ben = await vinculosParcelas(projetoId).catch(() => ({} as Awaited<ReturnType<typeof vinculosParcelas>>));
  return {
    pontos: d.pontos.map((p) => ({ nome: p.nome, E: p.E, N: p.N, lat: p.lat, lon: p.lon, tipo: p.tipo, lotes: p.lotes, existente: !!p.existente, implantar_com: p.implantar_com ?? null, marca: porPonto.get(p.nome) ?? null })),
    lotes: d.lotes.map((l) => {
      const vs = [...new Set(l.vertices)];
      const imp = exigidos(vs, existentes); // marcos a cravar (o perímetro já existe)
      const b = ben[l.lote];
      return { lote: l.lote, area_ha: l.area_ha, vertices: vs, exigidos: imp, a_implantar: vs.filter((v) => !existentes.has(v)).length, existentes: vs.filter((v) => existentes.has(v)).length, marcados: imp.filter((v) => porPonto.has(v)).length, fechado: fech.get(l.lote) ?? null,
        associado: b ? { nome: b.nome, lote_vila: b.lote_vila, denominacao: b.denominacao ?? null } : null };
    }),
    producao: producaoPorDia(marcas, fechados),
    equipamentos: EQUIPAMENTOS_PADRAO,
    totais: { pontos: d.pontos.length, a_implantar: d.pontos.filter((p) => !p.existente && p.origem === 'LOTE').length, existentes: existentes.size, marcados: marcas.filter((m) => !existentes.has(m.ponto)).length, lotes: d.lotes.length, fechados: fechados.length },
  };
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
  // lotes que fecharam agora
  const marcados = new Set((await rows(pool, 'SELECT ponto FROM pa_campo_pontos WHERE projeto_id = ?', [projetoId])).map((r) => String(r.ponto)));
  const jaFechados = new Set((await rows(pool, 'SELECT lote FROM pa_campo_lotes WHERE projeto_id = ?', [projetoId])).map((r) => String(r.lote)));
  const existentes = new Set(d.pontos.filter((x) => x.existente).map((x) => x.nome));
  const candidatos = d.lotes.filter((l) => p.lotes.includes(l.lote) && !jaFechados.has(l.lote)).map((l) => ({ ...l, vertices: exigidos(l.vertices, existentes) }));
  const novos = lotesCompletos(candidatos, marcados);
  const fechados: Array<{ lote: string; area_ha: number; associado: string | null }> = [];
  if (novos.length) {
    const sub = await buscarSubdivisao(projetoId);
    const ben = await vinculosParcelas(projetoId).catch(() => ({} as Awaited<ReturnType<typeof vinculosParcelas>>));
    for (const lote of novos) {
      const pc = sub?.parcelas.find((x) => x.lote === lote);
      const vs = d.lotes.find((x) => x.lote === lote)!.vertices; const vsEx = exigidos(vs, existentes);
      const ini = await one(pool, `SELECT MIN(marcado_em) m FROM pa_campo_pontos WHERE projeto_id = ? AND ponto IN (${vsEx.map(() => '?').join(',')})`, [projetoId, ...vsEx]);
      await exec(pool, `INSERT IGNORE INTO pa_campo_lotes (projeto_id, lote, concluido_em, usuario_id, usuario_nome, inicio_em, pontos, area_ha, perimetro_m, associado_id, base_gnss, rover_gnss)
        VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [projetoId, lote, u.id, u.nome, ini?.m ?? null, new Set(vs).size, pc?.perimetro.area_ha ?? null, pc?.perimetro.perimetro_m ?? null, ben[lote]?.associado_id ?? null, base, rover]);
      await registrarEvento(pool, { projeto_id: projetoId, associado_id: ben[lote]?.associado_id ?? null, usuario: u.id, tipo: 'CAMPO_LOTE_MEDIDO', dados: { lote, pontos: new Set(vs).size, area_ha: pc?.perimetro.area_ha ?? null } });
      fechados.push({ lote, area_ha: pc?.perimetro.area_ha ?? 0, associado: ben[lote]?.nome ?? null });
      // v3.169.0: lote medido → dossiê de pronta entrega (aguarda pagamento/autorização do CEO)
      if (ben[lote]) { try { const dz = await import('./paDossie'); await dz.criarDossie(projetoId, lote, u.id); void dz.enviarProntos(projetoId, [ben[lote].associado_id]).catch(() => undefined); } catch (e) { console.warn('[pa-campo] dossiê:', (e as Error).message); } }
    }
  }
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
  if (lotes.length) await exec(pool, `DELETE FROM pa_campo_lotes WHERE projeto_id = ? AND lote IN (${lotes.map(() => '?').join(',')})`, [projetoId, ...lotes]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario: u.id, tipo: 'CAMPO_PONTO_DESMARCADO', dados: { ponto, lotes_reabertos: lotes } });
  return { ponto, lotes_reabertos: lotes };
}
