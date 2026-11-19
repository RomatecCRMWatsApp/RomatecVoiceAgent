// v3.177.0 — Programação diária de campo.
// Manhã: o escritório escolhe (pelo nome do associado, chácara ou lote) os lotes que a equipe
// vai medir no dia → texto + PDF com o mapa para o grupo do PA.
// Fim do dia: confirmação — dos programados, quais foram medidos (lote fechado em campo),
// quais ficaram em medição e quais ficaram pendentes; os não medidos vêm sugeridos para o
// dia seguinte. Tudo para o grupo: sem valores nem situação de pagamento.
import { PaErro } from './erros';
import { pool, rows, exec, transacao, isoDate, hojeBrasil, registrarEvento } from './paDb';
import { buscarProjeto } from './paRepo';
import { geojsonSubdivisao, dadosCabecalho } from './paMapas';
import { cabecalho, pdfDeHtml, type DadosMapaPA } from './mapasPdf';
import { htmlMapaLotes, type BaseMapa, type RotuloLote } from './mapaTiles';
import { estadoCampo, diaBrasilia } from './paCampo';
import type { LoteBoletim } from './paCampoBoletim';

export type TipoBoletimDia = 'programacao' | 'confirmacao';
export type SituacaoProg = 'MEDIDO' | 'EM_MEDICAO' | 'PENDENTE';
export interface ItemProg {
  ordem: number; lote: string; associado: string | null; chacara: string | null; lote_vila: string | null; area_ha: number;
  situacao: SituacaoProg; medido_em: string | null; marcados: number; exigidos: number;
}

const diaValido = (v: unknown) => { const t = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const numLote = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });

/** Situação de cada lote programado (pura — testável). */
export function montarProgramacao(lotes: LoteBoletim[], programados: string[]): ItemProg[] {
  const por = new Map(lotes.map((l) => [l.lote, l]));
  return programados.map((lt, i) => {
    const l = por.get(lt);
    const medido = l?.fechado ? diaBrasilia(l.fechado.concluido_em) : null;
    return {
      ordem: i + 1, lote: lt, associado: l?.associado?.nome ?? null, chacara: l?.associado?.denominacao ?? null, lote_vila: l?.associado?.lote_vila ?? null,
      area_ha: l?.area_ha ?? 0, situacao: l?.fechado ? 'MEDIDO' : l && l.marcados > 0 ? 'EM_MEDICAO' : 'PENDENTE',
      medido_em: medido, marcados: l?.marcados ?? 0, exigidos: l?.exigidos.length ?? 0,
    };
  });
}

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const dbr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const semana = (d: string) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
const nb = (v: number, c = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
const linhaLote = (x: ItemProg) => `LT-${x.lote} — ${x.associado ?? 'sem associado vinculado'}${x.chacara ? ` (${x.chacara})` : ''}`;

export function resumoProg(itens: ItemProg[]) {
  return { total: itens.length, medidos: itens.filter((x) => x.situacao === 'MEDIDO'), em_medicao: itens.filter((x) => x.situacao === 'EM_MEDICAO'), pendentes: itens.filter((x) => x.situacao === 'PENDENTE') };
}

/** Texto para o grupo (manhã: programação; fim do dia: confirmação). */
export type Previsao = Array<{ dia: string; itens: ItemProg[] }>;
export function textoProgramacao(tipo: TipoBoletimDia, dia: string, itens: ItemProg[], projetoNome: string, totalPA: { medidos: number; lotes: number }, previsao: Previsao = [], ultimo: { dia: string; itens: ItemProg[] } | null = null): string {
  const L: string[] = [];
  const r = resumoProg(itens);
  if (tipo === 'programacao') {
    L.push(`📍 *PROGRAMAÇÃO DE CAMPO — ${projetoNome.toUpperCase()}*`);
    L.push(`📅 ${dbr(dia)} (${semana(dia)})`);
    if (ultimo && ultimo.itens.length) {
      L.push('');
      L.push(`✅ *Medidos em ${dbr(ultimo.dia)} (${semana(ultimo.dia)}) — ${ultimo.itens.length} lote(s):*`);
      for (const x of ultimo.itens) L.push(`• ${linhaLote(x)} ✅`);
      L.push(`📊 Total do PA: ${totalPA.medidos} de ${totalPA.lotes} lotes medidos (${nb(totalPA.lotes ? (totalPA.medidos / totalPA.lotes) * 100 : 0)}%).`);
    }
    L.push('');
    L.push(`🚜 *Lotes que a equipe vai medir hoje (${itens.length}):*`);
    for (const x of itens) L.push(`${x.ordem}. ${linhaLote(x)}`);
    L.push('');
    L.push('🙏 Associados desses lotes: se possível, acompanhem a equipe no lote para indicar as divisas e os marcos.');
    L.push('🗺️ Mapa com os lotes do dia no PDF em anexo. No fim do dia enviamos a confirmação dos lotes medidos.');
    // v3.190.0: previsão de medição dos quitados nos próximos dias
    if (previsao.length) {
      L.push('');
      L.push(`🗓️ *Previsão de medição — associados quitados (${previsao.reduce((n, p) => n + p.itens.length, 0)} lotes):*`);
      for (const p of previsao) { L.push(`*${dbr(p.dia)} (${semana(p.dia)}):*`); for (const x of p.itens) L.push(`• ${linhaLote(x)}`); }
      L.push('_Previsão sujeita a chuva e ao andamento do campo; a ordem segue a data da quitação._');
    }
  } else {
    L.push(`✅ *CONFIRMAÇÃO DO DIA — ${projetoNome.toUpperCase()}*`);
    L.push(`📅 ${dbr(dia)} (${semana(dia)})`);
    L.push('');
    L.push(`📋 Programados: ${r.total} · ✅ Medidos: ${r.medidos.length} · 🚧 Em medição: ${r.em_medicao.length} · ⏳ Pendentes: ${r.pendentes.length}`);
    if (r.medidos.length) { L.push(''); L.push('✅ *Medidos — associado com o lote OK:*'); for (const x of r.medidos) L.push(`• ${linhaLote(x)} ✅`); }
    if (r.em_medicao.length) { L.push(''); L.push('🚧 *Em medição (continua no próximo dia):*'); for (const x of r.em_medicao) L.push(`• ${linhaLote(x)} — ${x.marcados}/${x.exigidos} marcos`); }
    if (r.pendentes.length) { L.push(''); L.push('⏳ *Pendentes (ficam para o próximo dia):*'); for (const x of r.pendentes) L.push(`• ${linhaLote(x)}`); }
    if (!r.em_medicao.length && !r.pendentes.length && r.total) { L.push(''); L.push('🏁 Todos os lotes programados para hoje foram medidos!'); }
    L.push('');
    L.push(`📊 Total do PA: ${totalPA.medidos} de ${totalPA.lotes} lotes medidos (${nb(totalPA.lotes ? (totalPA.medidos / totalPA.lotes) * 100 : 0)}%).`);
    L.push('🗺️ Mapa de confirmação no PDF em anexo.');
  }
  L.push('');
  L.push('_Romatec Consultoria Total — Resp. técnico José Romário_');
  return L.join('\n');
}

const curto = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : n.trim(); };
export const COR_PROG = { programado: '#5DA9E9', medido: '#2E9D4F', em_medicao: '#5DA9E9', pendente: '#F2994A', ja_medido: '#A9D8B8' };

/** Mapa: todo branco; programados em destaque (manhã: azul; fim do dia: verde/azul/laranja); outros já medidos em verde-claro. */
export function temaProgramacao(tipo: TipoBoletimDia, itens: ItemProg[], lotes: LoteBoletim[]): Record<string, RotuloLote> {
  const prog = new Map(itens.map((x) => [x.lote, x]));
  return Object.fromEntries(lotes.map((l) => {
    const x = prog.get(l.lote);
    const nome = l.associado ? curto(l.associado.nome) : null;
    if (x && tipo === 'programacao') return [l.lote, { cor: COR_PROG.programado, opac: 0.85, destaque: true, rotulo: `${x.ordem}. LT-${l.lote}`, sub: nome ?? 'hoje' }];
    if (x) {
      if (x.situacao === 'MEDIDO') return [l.lote, { cor: COR_PROG.medido, opac: 0.85, destaque: true, rotulo: `LT-${l.lote} ✓`, sub: nome ? `${nome} — OK` : 'medido' }];
      if (x.situacao === 'EM_MEDICAO') return [l.lote, { cor: COR_PROG.em_medicao, opac: 0.85, destaque: true, rotulo: `LT-${l.lote}`, sub: `em medição ${x.marcados}/${x.exigidos}` }];
      return [l.lote, { cor: COR_PROG.pendente, opac: 0.85, destaque: true, rotulo: `LT-${l.lote}`, sub: 'pendente' }];
    }
    if (l.fechado) return [l.lote, { cor: COR_PROG.ja_medido, opac: 0.7, rotulo: `LT-${l.lote} ✓` }];
    return [l.lote, { cor: '#FFFFFF', opac: 0.72, rotulo: `LT-${l.lote}` }];
  }));
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const ha = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function htmlProgramacao(cab: DadosMapaPA, tipo: TipoBoletimDia, dia: string, itens: ItemProg[], mapa: string, totalPA: { medidos: number; lotes: number }, previsao: Previsao = [], ultimo: { dia: string; itens: ItemProg[] } | null = null): string {
  const r = resumoProg(itens);
  const prog = tipo === 'programacao';
  const sit = (x: ItemProg) => x.situacao === 'MEDIDO' ? '<span class="tag ok">✓ MEDIDO — OK</span>' : x.situacao === 'EM_MEDICAO' ? `<span class="tag em">em medição ${x.marcados}/${x.exigidos}</span>` : '<span class="tag pe">pendente → próximo dia</span>';
  const leg = prog
    ? `<span><i style="background:#fff"></i>Outros lotes</span><span><i style="background:${COR_PROG.programado}"></i>Programado para hoje (nº = ordem)</span><span><i style="background:${COR_PROG.ja_medido}"></i>Já medido antes</span>`
    : `<span><i style="background:${COR_PROG.medido}"></i>Medido hoje — OK</span><span><i style="background:${COR_PROG.em_medicao}"></i>Em medição</span><span><i style="background:${COR_PROG.pendente}"></i>Pendente → próximo dia</span><span><i style="background:${COR_PROG.ja_medido}"></i>Já medido antes</span><span><i style="background:#fff"></i>Não programado</span>`;
  const k = (rot: string, v: string, s: string, cls = '') => `<div class="k ${cls}"><span>${rot}</span><b>${v}</b><i>${s}</i></div>`;
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${prog ? 'Programação' : 'Confirmação'} de campo — ${esc(cab.projeto.nome)}</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:'Liberation Sans',Arial,sans-serif;color:#1C1C18;font-size:8.6pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
    .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}.cab .lg img{height:11mm}.cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
    .cab h1{margin:0;font-size:13pt}.cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}.cab .t{flex:1}
    .data{display:flex;justify-content:space-between;margin:2.5mm 0 2mm;font-size:9.5pt}.data b{color:#0C3320}
    .ks{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.k{border:1px solid #C9C2AE;border-radius:2mm;padding:1.6mm 2.4mm;background:#FBFAF5}
    .k span{display:block;color:#6A6656;font-size:6.6pt;text-transform:uppercase;font-weight:700}.k b{display:block;font-size:13pt;color:#0C3320;margin:.4mm 0}.k i{font-style:normal;color:#555;font-size:7pt}
    .k.ok{border-color:#2E7D4F;background:#EEF6EF}.k.pe{border-color:#F2994A;background:#FFF4EA}
    .mapa{border:1px solid #C9C2AE;border-radius:2mm;overflow:hidden;background:#fff;margin-top:2mm;width:718px;max-width:100%}
    .legg{display:flex;flex-wrap:wrap;gap:1.5mm 4mm;font-size:8pt;margin:1.5mm 0}.legg i{display:inline-block;width:4mm;height:4mm;border-radius:.8mm;vertical-align:middle;margin-right:1.2mm;border:1px solid #0C3320}
    h2{color:#0C3320;font-size:10.5pt;margin:3mm 0 1.6mm;border-bottom:1.2px solid #C9A84C;padding-bottom:.8mm}
    table{width:100%;border-collapse:collapse;font-size:8.2pt}th{background:#0C3320;color:#fff;padding:1.3mm 1.2mm;text-align:left;font-size:7pt}td{border-bottom:1px solid #E5DFCD;padding:1.3mm 1.2mm}
    tr:nth-child(even) td{background:#FAF7EE}td.n,th.n{text-align:right;white-space:nowrap}
    .tag{display:inline-block;border-radius:2mm;padding:.3mm 1.6mm;font-size:6.8pt;font-weight:700}.tag.ok{background:#1E7B34;color:#fff}.tag.em{background:#5DA9E9;color:#fff}.tag.pe{background:#F2994A;color:#3d2200}
    .nota{font-size:7.4pt;color:#555;margin-top:2mm}
    .rod{margin-top:3mm;font-size:7pt;color:#555;display:flex;justify-content:space-between;border-top:1px solid #C9A84C;padding-top:1.5mm}
    thead{display:table-header-group}tr{page-break-inside:avoid}
  </style></head><body>
    ${cabecalho(cab, prog ? 'PROGRAMAÇÃO DE CAMPO — LOTES DO DIA' : 'CONFIRMAÇÃO DO DIA — LOTES MEDIDOS')}
    <div class="data"><span>Data: <b>${dbr(dia)}</b> · ${semana(dia)}</span><span>Medição e cravação dos marcos — SIRGAS 2000 · NBR 13133</span></div>
    <div class="ks">${prog
      ? `${k('Programados hoje', String(r.total), 'lotes para a equipe medir', 'ok')}${k('Área a medir', `${ha(itens.reduce((s, x) => s + x.area_ha, 0))} ha`, 'soma dos lotes do dia')}${k('Já medidos no PA', `${totalPA.medidos}/${totalPA.lotes}`, `${nb(totalPA.lotes ? (totalPA.medidos / totalPA.lotes) * 100 : 0)}% do PA`)}${k('Faltam no PA', String(totalPA.lotes - totalPA.medidos), 'lotes')}`
      : `${k('Medidos hoje', `${r.medidos.length}/${r.total}`, 'dos programados', 'ok')}${k('Em medição', String(r.em_medicao.length), 'continuam no próximo dia')}${k('Pendentes', String(r.pendentes.length), 'vão para o próximo dia', 'pe')}${k('Total do PA', `${totalPA.medidos}/${totalPA.lotes}`, `${nb(totalPA.lotes ? (totalPA.medidos / totalPA.lotes) * 100 : 0)}% medido`)}`}</div>
    <div class="mapa">${mapa}</div>
    <div class="legg">${leg}</div>
    ${prog && ultimo && ultimo.itens.length ? `<h2>Medidos em ${dbr(ultimo.dia)} (${semana(ultimo.dia)}) — ${ultimo.itens.length} lote(s) ✅</h2>
    <table><thead><tr><th>Lote</th><th>Associado</th><th>Chácara</th><th class="n">Área</th><th>Situação</th></tr></thead><tbody>
      ${ultimo.itens.map((x) => `<tr><td><b>LT-${esc(x.lote)}</b>${x.lote_vila ? `<div style="color:#777;font-size:6.8pt">vila ${esc(x.lote_vila)}</div>` : ''}</td><td><b>${esc(x.associado ?? '—')}</b></td><td>${esc(x.chacara ?? '—')}</td><td class="n">${ha(x.area_ha)} ha</td><td><span class="tag ok">✓ MEDIDO — OK</span></td></tr>`).join('')}
    </tbody></table>` : ''}
    <h2>${prog ? `Lotes programados para ${dbr(dia)} (${r.total})` : `Programados para ${dbr(dia)} — situação no fim do dia`}</h2>
    ${itens.length ? `<table><thead><tr><th class="n">Nº</th><th>Lote</th><th>Associado</th><th>Chácara</th><th class="n">Área</th>${prog ? '' : '<th>Situação</th>'}</tr></thead><tbody>
      ${itens.map((x) => `<tr><td class="n"><b>${x.ordem}</b></td><td><b>LT-${esc(x.lote)}</b>${x.lote_vila ? `<div style="color:#777;font-size:6.8pt">vila ${esc(x.lote_vila)}</div>` : ''}</td><td><b>${esc(x.associado ?? 'sem associado vinculado')}</b></td><td>${esc(x.chacara ?? '—')}</td><td class="n">${ha(x.area_ha)} ha</td>${prog ? '' : `<td>${sit(x)}</td>`}</tr>`).join('')}
    </tbody></table>` : '<div class="nota">Nenhum lote programado para este dia.</div>'}
    ${prog ? '<div class="nota">Associados desses lotes: se possível, acompanhem a equipe no lote para indicar as divisas e os marcos. No fim do dia enviamos a confirmação dos lotes medidos.</div>' : (r.pendentes.length || r.em_medicao.length ? '<div class="nota">Os lotes pendentes e em medição ficam para o próximo dia de campo.</div>' : '')}
    ${prog && previsao.length ? `<h2 style="page-break-before:auto">Previsão de medição — associados quitados (${previsao.reduce((n, p) => n + p.itens.length, 0)} lotes)</h2>
    <table><thead><tr><th>Data prevista</th><th class="n">Nº</th><th>Lote</th><th>Associado</th><th>Chácara</th><th class="n">Área</th></tr></thead><tbody>
      ${previsao.map((p) => p.itens.map((x, i) => `<tr><td>${i === 0 ? `<b>${dbr(p.dia)}</b><div style="color:#777;font-size:6.8pt">${semana(p.dia)}</div>` : ''}</td><td class="n">${x.ordem}</td><td><b>LT-${esc(x.lote)}</b>${x.lote_vila ? `<div style="color:#777;font-size:6.8pt">vila ${esc(x.lote_vila)}</div>` : ''}</td><td>${esc(x.associado ?? '—')}</td><td>${esc(x.chacara ?? '—')}</td><td class="n">${ha(x.area_ha)} ha</td></tr>`).join('')).join('')}
    </tbody></table>
    <div class="nota">Previsão sujeita a chuva e ao andamento do campo. A ordem segue a data da quitação: quem quitou antes mede antes; novos quitados entram no fim da fila.</div>` : ''}
    <div class="rod"><span>Responsável técnico: ${esc(cab.rt.nome)} · ${esc(cab.rt.registro)}</span><span>Romatec Consultoria Total · gerado em ${esc(cab.data)}</span></div>
  </body></html>`;
}

// ─── banco ────────────────────────────────────────────────────────────────
/** v3.190.1: lotes do dia = programados + os medidos (fechados) naquele dia que não estavam na lista. */
function comMedidosDoDia(lotes: LoteBoletim[], programados: string[], dia: string): string[] {
  const med = lotes.filter((l) => l.fechado && diaBrasilia(l.fechado.concluido_em) === dia && !programados.includes(l.lote)).map((l) => l.lote).sort(numLote);
  return [...programados, ...med];
}
/** v3.190.1: último dia de campo antes de `dia` com lote medido, e os lotes medidos nele. */
function medidosUltimoDia(lotes: LoteBoletim[], dia: string): { dia: string; itens: ItemProg[] } | null {
  const dias = lotes.filter((l) => l.fechado).map((l) => diaBrasilia(l.fechado!.concluido_em)).filter((d) => d < dia).sort();
  const d = dias[dias.length - 1];
  if (!d) return null;
  const ls = lotes.filter((l) => l.fechado && diaBrasilia(l.fechado.concluido_em) === d).map((l) => l.lote).sort(numLote);
  return { dia: d, itens: montarProgramacao(lotes, ls) };
}
export async function lotesDoDia(projetoId: number, dia: string): Promise<string[]> {
  const r = await rows(pool, 'SELECT lote FROM pa_campo_programacao WHERE projeto_id = ? AND dia = ? ORDER BY ordem, id', [projetoId, dia]);
  return r.map((x) => String(x.lote));
}

/** Programação do dia + sugestão (não medidos do último dia programado antes deste). */
export async function buscarProgramacao(projetoId: number, diaQ: unknown) {
  const dia = diaValido(diaQ) ?? hojeBrasil();
  const e = await estadoCampo(projetoId);
  const lotes = comMedidosDoDia(e.lotes as unknown as LoteBoletim[], await lotesDoDia(projetoId, dia), dia);
  const ant = await rows(pool, 'SELECT MAX(dia) AS d FROM pa_campo_programacao WHERE projeto_id = ? AND dia < ?', [projetoId, dia]);
  const diaAnt = ant[0]?.d ? isoDate(ant[0].d) : null;
  const jaAgendados = new Set((await rows(pool, 'SELECT DISTINCT lote FROM pa_campo_programacao WHERE projeto_id = ? AND dia >= ?', [projetoId, dia])).map((r) => String(r.lote)));
  const itensAnt = diaAnt ? montarProgramacao(e.lotes as unknown as LoteBoletim[], await lotesDoDia(projetoId, diaAnt)) : [];
  return {
    dia, lotes, itens: montarProgramacao(e.lotes as unknown as LoteBoletim[], lotes),
    // v3.189.0: pendentes do dia anterior que a relocação já pôs em outro dia (hoje ou adiante) não aparecem de novo
    anterior: diaAnt ? { dia: diaAnt, pendentes: itensAnt.filter((x) => x.situacao !== 'MEDIDO' && !jaAgendados.has(x.lote)).map((x) => x.lote) } : null,
    relocacao: { automatica: await agendaAutomatica(projetoId), hora: HORA_RELOCACAO, por_dia: lotesPorDia(), dias_uteis: diasUteis() },
  };
}

export async function salvarProgramacao(projetoId: number, diaQ: unknown, lotesQ: unknown, usuario: string | null) {
  const dia = diaValido(diaQ);
  if (!dia) throw new PaErro('CAMPO_INVALIDO', 'Informe o dia da programação', 400);
  if (!Array.isArray(lotesQ)) throw new PaErro('CAMPO_INVALIDO', 'Informe a lista de lotes', 400);
  const e = await estadoCampo(projetoId);
  const existe = new Set(e.lotes.map((l) => l.lote));
  const lotes = [...new Set(lotesQ.map((x) => String(x).trim()).filter(Boolean))];
  const fora = lotes.filter((l) => !existe.has(l));
  if (fora.length) throw new PaErro('LOTE_INVALIDO', `Lote(s) fora da subdivisão: ${fora.join(', ')}`, 400);
  await transacao(async (c) => {
    await exec(c, 'DELETE FROM pa_campo_programacao WHERE projeto_id = ? AND dia = ?', [projetoId, dia]);
    for (const [i, l] of lotes.entries()) await exec(c, 'INSERT INTO pa_campo_programacao (projeto_id, dia, lote, ordem, criado_por) VALUES (?, ?, ?, ?, ?)', [projetoId, dia, l, i + 1, usuario]);
  });
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'CAMPO_PROGRAMACAO', dados: { dia, lotes } });
  return buscarProgramacao(projetoId, dia);
}

async function dadosDia(projetoId: number, tipoQ: unknown, diaQ: unknown) {
  const tipo: TipoBoletimDia = tipoQ === 'confirmacao' ? 'confirmacao' : 'programacao';
  const dia = diaValido(diaQ) ?? hojeBrasil();
  const p = await buscarProjeto(projetoId);
  const e = await estadoCampo(projetoId);
  const lotes = e.lotes as unknown as LoteBoletim[];
  const itens = montarProgramacao(lotes, comMedidosDoDia(lotes, await lotesDoDia(projetoId, dia), dia));
  if (!itens.length) throw new PaErro('SEM_PROGRAMACAO', `Nenhum lote programado para ${dbr(dia)} — escolha os lotes e salve a programação`, 409);
  const totalPA = { medidos: lotes.filter((l) => l.fechado).length, lotes: lotes.length };
  const previsao: Previsao = [];
  if (tipo === 'programacao') {
    const fut = await rows(pool, 'SELECT dia, lote FROM pa_campo_programacao WHERE projeto_id = ? AND dia > ? AND dia <= ? + INTERVAL 60 DAY ORDER BY dia, ordem, id', [projetoId, dia, dia]);
    const por: Record<string, string[]> = {};
    for (const r of fut) (por[isoDate(r.dia)!] ??= []).push(String(r.lote));
    for (const d of Object.keys(por).sort()) { const its = montarProgramacao(lotes, por[d]).filter((x) => x.situacao !== 'MEDIDO'); if (its.length) previsao.push({ dia: d, itens: its.map((x, i) => ({ ...x, ordem: i + 1 })) }); }
  }
  const ultimo = tipo === 'programacao' ? medidosUltimoDia(lotes, dia) : null;
  return { tipo, dia, p, lotes, itens, totalPA, previsao, ultimo };
}
const nomeArq = (codigo: string, tipo: TipoBoletimDia, dia: string) => `${tipo === 'programacao' ? 'PROGRAMACAO' : 'CONFIRMACAO'}-CAMPO-${codigo}-${dia}.pdf`;

export async function textoDia(projetoId: number, tipoQ: unknown, diaQ: unknown) {
  const { tipo, dia, p, itens, totalPA, previsao, ultimo } = await dadosDia(projetoId, tipoQ, diaQ);
  return { texto: textoProgramacao(tipo, dia, itens, p.nome, totalPA, previsao, ultimo), nome: nomeArq(p.codigo, tipo, dia) };
}

export async function pdfDia(projetoId: number, tipoQ: unknown, diaQ: unknown, base: BaseMapa): Promise<{ pdf: Buffer; nome: string }> {
  const { tipo, dia, p, lotes, itens, totalPA, previsao, ultimo } = await dadosDia(projetoId, tipoQ, diaQ);
  const geo = (await geojsonSubdivisao(projetoId).catch(() => ({ features: [] }))) as unknown as { features: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> };
  const { html: mapa } = await htmlMapaLotes(geo, temaProgramacao(tipo, itens, lotes), { base, H: 520 });
  return { pdf: await pdfDeHtml(htmlProgramacao(dadosCabecalho(p), tipo, dia, itens, mapa, totalPA, previsao, ultimo)), nome: nomeArq(p.codigo, tipo, dia) };
}

// ─── v3.189.0/v3.190.0: agenda automática de campo (só lotes QUITADOS) ─────
// Automática (padrão; o CEO pode passar para manual na tela):
//  • durante o dia: quem quitar entra no FINAL da fila (ordem de quitação — quem pagou antes mede antes)
//    e os dias seguintes são refeitos, até N lotes por dia (padrão 6), pulando sábado e domingo;
//  • às 21 h (Brasília): o que estava no dia e não foi medido passa para o próximo dia útil, na frente
//    (em medição primeiro), e o excedente cascateia. O dia de hoje nunca é mexido durante o dia.
// Só entram lotes quitados (ou já em medição). Lote não quitado programado à mão não é relocado.
export const HORA_RELOCACAO = 21;
export const lotesPorDia = () => Math.max(1, Math.min(30, Number(process.env.PA_CAMPO_LOTES_DIA) || 6));
/** Dias da semana com campo (0 = domingo … 6 = sábado). Padrão: segunda a sexta. */
export const diasUteis = (): number[] => {
  const v = String(process.env.PA_CAMPO_DIAS_UTEIS ?? '1,2,3,4,5').split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return v.length ? [...new Set(v)] : [1, 2, 3, 4, 5];
};
const somaDia = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
export function proximoDiaUtil(d: string, uteis: number[] = diasUteis()): string {
  let x = somaDia(d, 1);
  for (let i = 0; i < 14 && !uteis.includes(diaSemana(x)); i++) x = somaDia(x, 1);
  return x;
}

export interface LoteAgenda { lote: string; fechado: boolean; marcados: number; quitado: boolean; quitado_em: string | null }
/** Fila dos quitados a medir: quem quitou antes vem antes; empate pelo nº do lote (pura). */
export function filaQuitados(lotes: LoteAgenda[]): string[] {
  return lotes.filter((l) => !l.fechado && l.quitado)
    .sort((a, b) => (a.quitado_em ?? '').localeCompare(b.quitado_em ?? '') || numLote(a.lote, b.lote)).map((l) => l.lote);
}
/**
 * Plano dos dias depois de `dia` (pura — testável).
 * `carry`: lotes do `dia` que não foram medidos (fechamento das 21 h) — vão na frente. `excluir`: lotes que ficam
 * no próprio `dia` (atualização durante o dia). `manuais`: dias futuros fora dos dias úteis com programação à mão
 * (mantidos). Todos os quitados a medir são distribuídos, `porDia` por dia útil.
 */
export function planejarAgenda(dia: string, lotes: LoteAgenda[], carry: string[], excluir: string[] = [], manuais: Record<string, string[]> = {}, porDia = lotesPorDia(), uteis = diasUteis()): Record<string, string[]> {
  const st = new Map(lotes.map((l) => [l.lote, l]));
  const ok = (lt: string) => { const l = st.get(lt); return !!l && !l.fechado && (l.quitado || l.marcados > 0); };
  const fora = new Set(excluir);
  const out: Record<string, string[]> = {};
  for (const [d, ls] of Object.entries(manuais)) if (d > dia && !uteis.includes(diaSemana(d))) { out[d] = ls.filter(ok); out[d].forEach((x) => fora.add(x)); }
  const fila: string[] = [];
  const pôr = (lt: string) => { if (ok(lt) && !fora.has(lt) && !fila.includes(lt)) fila.push(lt); };
  lotes.filter((l) => !l.fechado && l.marcados > 0).sort((a, b) => numLote(a.lote, b.lote)).forEach((l) => pôr(l.lote)); // em medição na frente
  carry.forEach(pôr);
  filaQuitados(lotes).forEach(pôr);
  let d = proximoDiaUtil(dia, uteis);
  while (fila.length) { out[d] = fila.splice(0, porDia); d = proximoDiaUtil(d, uteis); }
  for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
  return out;
}

export async function lotesAgenda(projetoId: number): Promise<LoteAgenda[]> {
  const e = await estadoCampo(projetoId);
  return e.lotes.map((l) => ({ lote: l.lote, fechado: !!l.fechado, marcados: l.marcados, quitado: !!l.pagamento?.quitado, quitado_em: l.pagamento?.quitado_em ?? null }));
}
export async function futuroAtual(projetoId: number, dia: string): Promise<Record<string, string[]>> {
  const fut = await rows(pool, 'SELECT dia, lote FROM pa_campo_programacao WHERE projeto_id = ? AND dia > ? ORDER BY dia, ordem, id', [projetoId, dia]);
  const f: Record<string, string[]> = {};
  for (const r of fut) (f[isoDate(r.dia)!] ??= []).push(String(r.lote));
  return f;
}
const mesmoPlano = (a: Record<string, string[]>, b: Record<string, string[]>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
async function gravarFuturo(projetoId: number, dia: string, plano: Record<string, string[]>, usuario: string | null) {
  await transacao(async (c) => {
    await exec(c, 'DELETE FROM pa_campo_programacao WHERE projeto_id = ? AND dia > ?', [projetoId, dia]);
    for (const [d, lotes] of Object.entries(plano)) for (const [i, l] of lotes.entries())
      await exec(c, 'INSERT INTO pa_campo_programacao (projeto_id, dia, lote, ordem, criado_por) VALUES (?, ?, ?, ?, ?)', [projetoId, d, l, i + 1, usuario ?? 'agenda-automatica']);
  });
}

/** Fecha o dia `dia` (21 h): não medidos do dia vão na frente do próximo dia útil; refaz os dias seguintes. */
export async function relocarProgramacao(projetoId: number, diaQ: unknown, usuario: string | null, fechamento = false) {
  const dia = diaValido(diaQ) ?? hojeBrasil();
  const lotes = await lotesAgenda(projetoId);
  const medido = new Set(lotes.filter((l) => l.fechado).map((l) => l.lote));
  // v3.190.1: carry = não medidos do dia (e sobras de dias anteriores), na ordem dos dias
  const ant = await rows(pool, 'SELECT dia, lote FROM pa_campo_programacao WHERE projeto_id = ? AND dia <= ? AND dia >= ? - INTERVAL 60 DAY ORDER BY dia DESC, ordem, id', [projetoId, dia, dia]);
  const carry = [...new Set(ant.map((r) => String(r.lote)).filter((lt) => !medido.has(lt)))];
  const plano = planejarAgenda(dia, lotes, carry, [], await futuroAtual(projetoId, dia));
  await gravarFuturo(projetoId, dia, plano, usuario);
  // v3.190.1: no dia (e nos anteriores) ficam SÓ os medidos — os não medidos saíram para os próximos dias
  const sair = carry.filter((lt) => Object.values(plano).some((x) => x.includes(lt)) || !lotes.find((l) => l.lote === lt)?.quitado);
  if (sair.length) await exec(pool, `DELETE FROM pa_campo_programacao WHERE projeto_id = ? AND dia <= ? AND dia >= ? - INTERVAL 60 DAY AND lote IN (${sair.map(() => '?').join(',')})`, [projetoId, dia, dia, ...sair]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: fechamento ? 'CAMPO_FECHAMENTO_DIA' : 'CAMPO_RELOCACAO', dados: { dia, plano, retirados: sair } });
  return { dia, plano, retirados: sair };
}
/** Durante o dia: novos quitados entram no fim da fila; refaz só os dias depois de hoje (hoje não muda). */
export async function atualizarAgenda(projetoId: number, hoje = hojeBrasil()) {
  const lotes = await lotesAgenda(projetoId);
  const atual = await futuroAtual(projetoId, hoje);
  const plano = planejarAgenda(hoje, lotes, [], await lotesDoDia(projetoId, hoje), atual);
  if (mesmoPlano(plano, atual)) return { mudou: false, plano };
  await gravarFuturo(projetoId, hoje, plano, null);
  await registrarEvento(pool, { projeto_id: projetoId, usuario: null, tipo: 'CAMPO_AGENDA_ATUALIZADA', dados: { dia: hoje, plano } });
  return { mudou: true, plano };
}

// modo automático por projeto (padrão: ligado)
export async function agendaAutomatica(projetoId: number): Promise<boolean> {
  const r = await rows(pool, 'SELECT campo_agenda_auto FROM pa_projetos WHERE id = ?', [projetoId]).catch(() => []);
  return r.length ? Number(r[0].campo_agenda_auto ?? 1) === 1 : true;
}
export async function definirAgendaAutomatica(projetoId: number, ligado: unknown, usuario: string | null) {
  const v = ligado === true || ligado === 1 || ligado === '1' || ligado === 'true';
  await exec(pool, 'UPDATE pa_projetos SET campo_agenda_auto = ? WHERE id = ?', [v ? 1 : 0, projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'CAMPO_AGENDA_MODO', dados: { automatica: v } });
  if (v) await atualizarAgenda(projetoId).catch((e) => console.warn('[pa-agenda] ao ligar:', (e as Error).message));
  return { automatica: v };
}

/** Vigia (a cada 10 min): projetos com agenda automática — fecha o dia às 21 h (uma vez) e mantém os dias seguintes em dia. */
export async function rodarAgendaAutomatica(agora = new Date()): Promise<number> {
  if (process.env.PA_CAMPO_RELOCACAO === '0') return 0;
  const hBr = (agora.getUTCHours() + 21) % 24;
  const hoje = hojeBrasil(agora);
  const ontem = somaDia(hoje, -1);
  const ps = await rows(pool, 'SELECT id FROM pa_projetos WHERE COALESCE(campo_agenda_auto, 1) = 1 AND subdivisao_json IS NOT NULL').catch(() => []);
  let n = 0;
  for (const p of ps) {
    const pid = Number(p.id);
    try {
      // v3.190.1: só o fechamento automático das 21 h conta — o "Relocar" manual durante o dia não bloqueia mais o das 21 h
      const fechado = async (d: string) => (await rows(pool, "SELECT id FROM pa_eventos WHERE projeto_id = ? AND tipo = 'CAMPO_FECHAMENTO_DIA' AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.dia')) = ? LIMIT 1", [pid, d])).length > 0;
      if (hBr >= HORA_RELOCACAO) {
        if (!(await fechado(hoje))) { await relocarProgramacao(pid, hoje, null, true); n++; console.log(`[pa-agenda] projeto ${pid}: dia ${hoje} fechado e relocado`); }
        else if ((await atualizarAgenda(pid, hoje)).mudou) n++;
      } else {
        // servidor fora às 21 h de ontem → fecha ontem na volta (até o meio-dia; depois disso o dia de hoje não é mexido)
        if (!(await fechado(ontem)) && (await lotesDoDia(pid, ontem)).length) {
          if (hBr < 12) { await relocarProgramacao(pid, ontem, null, true); n++; console.log(`[pa-agenda] projeto ${pid}: dia ${ontem} fechado na volta do servidor`); }
          else await registrarEvento(pool, { projeto_id: pid, usuario: null, tipo: 'CAMPO_FECHAMENTO_DIA', dados: { dia: ontem, recuperado: false } });
        }
        if ((await atualizarAgenda(pid, hoje)).mudou) n++;
      }
    } catch (err) { console.error(`[pa-agenda] projeto ${pid}:`, (err as Error).message); }
  }
  return n;
}
let vigiaAgenda: NodeJS.Timeout | null = null;
export function iniciarRelocacaoAutomatica(): void {
  if (vigiaAgenda || process.env.PA_CAMPO_RELOCACAO === '0') return;
  const rodar = () => { rodarAgendaAutomatica().catch((e) => console.error('[pa-agenda] vigia:', (e as Error).message)); };
  setTimeout(rodar, 90_000);
  vigiaAgenda = setInterval(rodar, 10 * 60_000);
  vigiaAgenda.unref?.();
}
