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
export function textoProgramacao(tipo: TipoBoletimDia, dia: string, itens: ItemProg[], projetoNome: string, totalPA: { medidos: number; lotes: number }): string {
  const L: string[] = [];
  const r = resumoProg(itens);
  if (tipo === 'programacao') {
    L.push(`📍 *PROGRAMAÇÃO DE CAMPO — ${projetoNome.toUpperCase()}*`);
    L.push(`📅 ${dbr(dia)} (${semana(dia)})`);
    L.push('');
    L.push(`🚜 *Lotes que a equipe vai medir hoje (${itens.length}):*`);
    for (const x of itens) L.push(`${x.ordem}. ${linhaLote(x)}`);
    L.push('');
    L.push('🙏 Associados desses lotes: se possível, acompanhem a equipe no lote para indicar as divisas e os marcos.');
    L.push('🗺️ Mapa com os lotes do dia no PDF em anexo. No fim do dia enviamos a confirmação dos lotes medidos.');
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

export function htmlProgramacao(cab: DadosMapaPA, tipo: TipoBoletimDia, dia: string, itens: ItemProg[], mapa: string, totalPA: { medidos: number; lotes: number }): string {
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
    <h2>${prog ? `Lotes programados para ${dbr(dia)} (${r.total})` : `Programados para ${dbr(dia)} — situação no fim do dia`}</h2>
    ${itens.length ? `<table><thead><tr><th class="n">Nº</th><th>Lote</th><th>Associado</th><th>Chácara</th><th class="n">Área</th>${prog ? '' : '<th>Situação</th>'}</tr></thead><tbody>
      ${itens.map((x) => `<tr><td class="n"><b>${x.ordem}</b></td><td><b>LT-${esc(x.lote)}</b>${x.lote_vila ? `<div style="color:#777;font-size:6.8pt">vila ${esc(x.lote_vila)}</div>` : ''}</td><td><b>${esc(x.associado ?? 'sem associado vinculado')}</b></td><td>${esc(x.chacara ?? '—')}</td><td class="n">${ha(x.area_ha)} ha</td>${prog ? '' : `<td>${sit(x)}</td>`}</tr>`).join('')}
    </tbody></table>` : '<div class="nota">Nenhum lote programado para este dia.</div>'}
    ${prog ? '<div class="nota">Associados desses lotes: se possível, acompanhem a equipe no lote para indicar as divisas e os marcos. No fim do dia enviamos a confirmação dos lotes medidos.</div>' : (r.pendentes.length || r.em_medicao.length ? '<div class="nota">Os lotes pendentes e em medição ficam para o próximo dia de campo.</div>' : '')}
    <div class="rod"><span>Responsável técnico: ${esc(cab.rt.nome)} · ${esc(cab.rt.registro)}</span><span>Romatec Consultoria Total · gerado em ${esc(cab.data)}</span></div>
  </body></html>`;
}

// ─── banco ────────────────────────────────────────────────────────────────
async function lotesDoDia(projetoId: number, dia: string): Promise<string[]> {
  const r = await rows(pool, 'SELECT lote FROM pa_campo_programacao WHERE projeto_id = ? AND dia = ? ORDER BY ordem, id', [projetoId, dia]);
  return r.map((x) => String(x.lote));
}

/** Programação do dia + sugestão (não medidos do último dia programado antes deste). */
export async function buscarProgramacao(projetoId: number, diaQ: unknown) {
  const dia = diaValido(diaQ) ?? hojeBrasil();
  const e = await estadoCampo(projetoId);
  const lotes = await lotesDoDia(projetoId, dia);
  const ant = await rows(pool, 'SELECT MAX(dia) AS d FROM pa_campo_programacao WHERE projeto_id = ? AND dia < ?', [projetoId, dia]);
  const diaAnt = ant[0]?.d ? isoDate(ant[0].d) : null;
  const itensAnt = diaAnt ? montarProgramacao(e.lotes as unknown as LoteBoletim[], await lotesDoDia(projetoId, diaAnt)) : [];
  return {
    dia, lotes, itens: montarProgramacao(e.lotes as unknown as LoteBoletim[], lotes),
    anterior: diaAnt ? { dia: diaAnt, pendentes: itensAnt.filter((x) => x.situacao !== 'MEDIDO').map((x) => x.lote) } : null,
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
  const itens = montarProgramacao(lotes, await lotesDoDia(projetoId, dia));
  if (!itens.length) throw new PaErro('SEM_PROGRAMACAO', `Nenhum lote programado para ${dbr(dia)} — escolha os lotes e salve a programação`, 409);
  const totalPA = { medidos: lotes.filter((l) => l.fechado).length, lotes: lotes.length };
  return { tipo, dia, p, lotes, itens, totalPA };
}
const nomeArq = (codigo: string, tipo: TipoBoletimDia, dia: string) => `${tipo === 'programacao' ? 'PROGRAMACAO' : 'CONFIRMACAO'}-CAMPO-${codigo}-${dia}.pdf`;

export async function textoDia(projetoId: number, tipoQ: unknown, diaQ: unknown) {
  const { tipo, dia, p, itens, totalPA } = await dadosDia(projetoId, tipoQ, diaQ);
  return { texto: textoProgramacao(tipo, dia, itens, p.nome, totalPA), nome: nomeArq(p.codigo, tipo, dia) };
}

export async function pdfDia(projetoId: number, tipoQ: unknown, diaQ: unknown, base: BaseMapa): Promise<{ pdf: Buffer; nome: string }> {
  const { tipo, dia, p, lotes, itens, totalPA } = await dadosDia(projetoId, tipoQ, diaQ);
  const geo = (await geojsonSubdivisao(projetoId).catch(() => ({ features: [] }))) as unknown as { features: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> };
  const { html: mapa } = await htmlMapaLotes(geo, temaProgramacao(tipo, itens, lotes), { base, H: 520 });
  return { pdf: await pdfDeHtml(htmlProgramacao(dadosCabecalho(p), tipo, dia, itens, mapa, totalPA)), nome: nomeArq(p.codigo, tipo, dia) };
}
