// v3.191.0 — Relatório do dia de campo (fim do dia, para o grupo do PA): um PDF único + texto.
// v3.198.4: abre a qualquer hora (parcial até o fechamento) e fecha às 21 h (junto com a relocação automática). Traz, sempre nesta ordem:
//   1) lotes concluídos X/63 com a situação do dossiê (entregue → enviado → em revisão → aguardando pagamento);
//   2) medidos hoje; 3) em medição; 4) programação do próximo dia útil (ordem de quitação);
//   5) previsão de medição de todos os quitados (data a data); 6) lotes com parcelas em aberto: quantos
//      e a partir de quando começam (depois que a fila dos quitados termina).
// Sem valores em R$ nem nomes de quem está com parcelas em aberto (o grupo vê só a contagem).
import { PaErro } from './erros';
import { pool, rows, hojeBrasil } from './paDb';
import { buscarProjeto } from './paRepo';
import { geojsonSubdivisao, dadosCabecalho } from './paMapas';
import { cabecalho, pdfDeHtml, type DadosMapaPA } from './mapasPdf';
import { htmlMapaLotes, type BaseMapa, type RotuloLote } from './mapaTiles';
import { estadoCampo, diaBrasilia } from './paCampo';
import type { LoteBoletim } from './paCampoBoletim';
import { planejarAgenda, proximoDiaUtil, diasUteis, lotesPorDia, lotesAgenda, futuroAtual, lotesDoDia, HORA_RELOCACAO } from './paCampoProgramacao';

/** @deprecated v3.198.4: o relatório abre a qualquer hora; só o fechamento é às 21 h. */
export const HORA_ABRE_RELATORIO = 0;
export type SituacaoDossieRel = 'ENTREGUE' | 'ENVIADO' | 'REVISAO' | 'AGUARDANDO_PAGAMENTO' | 'SEM_DOSSIE';
export interface LinhaRel { lote: string; associado: string | null; chacara: string | null; lote_vila: string | null; area_ha: number }
export interface Relatorio {
  dia: string; fechado: boolean; total: number; medidos_total: number;
  concluidos: Array<LinhaRel & { medido_em: string; dossie: SituacaoDossieRel; dossie_em: string | null }>;
  hoje: LinhaRel[]; em_medicao: Array<LinhaRel & { marcados: number; exigidos: number }>;
  proximo: { dia: string; itens: LinhaRel[] } | null;
  previsao: Array<{ dia: string; itens: LinhaRel[] }>; quitados_a_medir: number;
  abertos: { qtd: number; inicio_previsto: string | null; em_dia?: number; atraso?: number; inicio_atraso?: string | null }; sem_associado: number;
}

const numLote = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });
const linha = (l: LoteBoletim): LinhaRel => ({ lote: l.lote, associado: l.associado?.nome ?? null, chacara: l.associado?.denominacao ?? null, lote_vila: l.associado?.lote_vila ?? null, area_ha: l.area_ha });
const ORDEM_DOSSIE: Record<SituacaoDossieRel, number> = { ENTREGUE: 0, ENVIADO: 1, REVISAO: 2, AGUARDANDO_PAGAMENTO: 3, SEM_DOSSIE: 4 };

/** Monta o relatório (pura — testável). `plano`: dias seguintes (dia → lotes), já na ordem da agenda. */
export function montarRelatorio(dia: string, lotes: LoteBoletim[], dossies: Map<string, { situacao: SituacaoDossieRel; em: string | null }>, plano: Record<string, string[]>, fechado: boolean, uteis = diasUteis()): Relatorio {
  const por = new Map(lotes.map((l) => [l.lote, l]));
  const medidos = lotes.filter((l) => l.fechado);
  const concluidos = medidos.map((l) => {
    const d = dossies.get(l.lote) ?? { situacao: 'SEM_DOSSIE' as const, em: null };
    return { ...linha(l), medido_em: diaBrasilia(l.fechado!.concluido_em), dossie: d.situacao, dossie_em: d.em };
  }).sort((a, b) => ORDEM_DOSSIE[a.dossie] - ORDEM_DOSSIE[b.dossie] || a.medido_em.localeCompare(b.medido_em) || numLote(a.lote, b.lote));
  const hoje = medidos.filter((l) => diaBrasilia(l.fechado!.concluido_em) === dia).sort((a, b) => numLote(a.lote, b.lote)).map(linha);
  // v3.198.7: marco compartilhado com o vizinho não faz o vizinho "em medição" — só conta quitado ou lote da programação
  const naProg = new Set(Object.values(plano).flat());
  const em_medicao = lotes.filter((l) => !l.fechado && l.marcados > 0 && (l.pagamento?.quitado || naProg.has(l.lote))).sort((a, b) => numLote(a.lote, b.lote)).map((l) => ({ ...linha(l), marcados: l.marcados, exigidos: l.exigidos.length }));
  const dias = Object.keys(plano).filter((d) => d > dia).sort();
  const vivo = (lt: string) => { const l = por.get(lt); return !!l && !l.fechado; };
  // programação do próximo dia: todos os lotes do dia (o grupo precisa saber quem será medido)
  const d1 = dias.find((d) => plano[d].some(vivo));
  const proximo = d1 ? { dia: d1, itens: plano[d1].filter(vivo).map((lt) => linha(por.get(lt)!)) } : null;
  // previsão: nominal só para QUITADOS (quem tem parcela em aberto aparece só na contagem — LGPD/constrangimento)
  const previsao = dias.map((d) => ({ dia: d, itens: plano[d].filter(vivo).map((lt) => por.get(lt)!).filter((l) => l.pagamento?.quitado).map(linha) })).filter((p) => p.itens.length);
  const quitados = lotes.filter((l) => !l.fechado && l.pagamento?.quitado);
  const bloq = (l: LoteBoletim) => !!(l as { bloqueado?: boolean }).bloqueado;
  const abertos = lotes.filter((l) => !l.fechado && l.associado && !l.pagamento?.quitado && !bloq(l));
  const atraso = abertos.filter((l) => (l.pagamento?.atrasadas ?? 0) > 0);
  const diaDe = (f: (l: LoteBoletim) => boolean) => dias.find((d) => plano[d].some((lt) => { const l = por.get(lt); return !!l && !l.fechado && f(l); })) ?? null;
  const ultimo = dias.length ? dias[dias.length - 1] : dia;
  return {
    dia, fechado, total: lotes.length, medidos_total: medidos.length, concluidos, hoje, em_medicao,
    proximo, previsao, quitados_a_medir: quitados.length,
    abertos: { qtd: abertos.length, em_dia: abertos.length - atraso.length, atraso: atraso.length,
      inicio_previsto: abertos.length ? (diaDe((l) => !l.pagamento?.quitado && !(l.pagamento?.atrasadas ?? 0)) ?? diaDe((l) => !l.pagamento?.quitado) ?? proximoDiaUtil(ultimo, uteis)) : null,
      inicio_atraso: atraso.length ? (diaDe((l) => (l.pagamento?.atrasadas ?? 0) > 0) ?? proximoDiaUtil(ultimo, uteis)) : null },
    sem_associado: lotes.filter((l) => !l.fechado && !l.associado).length,
  };
}

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const dbr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const dcurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const semana = (d: string) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const nomeLote = (x: LinhaRel) => `LT-${x.lote} — ${x.associado ?? 'sem associado'}${x.chacara ? ` (${x.chacara})` : ''}`;
export const ROT_DOSSIE: Record<SituacaoDossieRel, string> = {
  ENTREGUE: '📦 dossiê ENTREGUE', ENVIADO: '📲 dossiê enviado no WhatsApp', REVISAO: '📝 dossiê em conferência',
  AGUARDANDO_PAGAMENTO: '⏳ dossiê aguardando pagamento', SEM_DOSSIE: '🗂️ dossiê em preparo',
};

/** Texto para o grupo. */
export function textoRelatorio(r: Relatorio, projetoNome: string): string {
  const L: string[] = [];
  L.push(`📋 *RELATÓRIO DO DIA DE CAMPO — ${projetoNome.toUpperCase()}*`);
  L.push(`📅 ${dbr(r.dia)} (${semana(r.dia)}) · ${r.fechado ? '✅ *FECHADO*' : `⏳ *PARCIAL* — fecha às ${HORA_RELOCACAO} h`}`);
  L.push('');
  L.push(`🏁 *LOTES CONCLUÍDOS: ${r.medidos_total} de ${r.total}* (${pct(r.medidos_total, r.total)}%)`);
  for (const x of r.concluidos) L.push(`• ${nomeLote(x)} — medido ${dcurto(x.medido_em)} · ${ROT_DOSSIE[x.dossie]}${x.dossie_em ? ` ${dcurto(x.dossie_em)}` : ''}`);
  L.push('');
  L.push(`✅ *Medidos em ${dbr(r.dia)} (${r.hoje.length}):*`);
  if (r.hoje.length) for (const x of r.hoje) L.push(`• ${nomeLote(x)} ✅`); else L.push('• nenhum lote fechado no dia');
  if (r.em_medicao.length) { L.push(''); L.push(`🚧 *Em medição — continuam no próximo dia (${r.em_medicao.length}):*`); for (const x of r.em_medicao) L.push(`• ${nomeLote(x)} — ${x.marcados}/${x.exigidos} marcos`); }
  L.push('');
  if (r.proximo) {
    L.push(`🚜 *Programação de ${dbr(r.proximo.dia)} (${semana(r.proximo.dia)}) — ${r.proximo.itens.length} lote(s):*`);
    r.proximo.itens.forEach((x, i) => L.push(`${i + 1}. ${nomeLote(x)}`));
    L.push('🙏 Associados desses lotes: se possível, acompanhem a equipe para indicar as divisas e os marcos.');
  } else L.push('🚜 *Próximo dia:* nenhum lote quitado na fila no momento.');
  const resto = r.previsao.slice(1);
  if (resto.length) {
    L.push('');
    L.push(`🗓️ *Previsão de medição — quitados na fila (${r.previsao.reduce((n, p) => n + p.itens.length, 0)} lotes, pela ordem de quitação):*`);
    for (const p of resto) { L.push(`*${dbr(p.dia)} (${semana(p.dia)}):*`); for (const x of p.itens) L.push(`• ${nomeLote(x)}`); }
  }
  if (r.abertos.qtd) {
    L.push('');
    L.push(`💳 *${r.abertos.qtd} lote(s) com parcelas em aberto* — ordem da medição: 1º quitados, 2º em dia com as parcelas${r.abertos.em_dia ? ` (${r.abertos.em_dia}${r.abertos.inicio_previsto ? `, a partir de ${dbr(r.abertos.inicio_previsto)}` : ''})` : ''}, 3º com parcela em atraso${r.abertos.atraso ? ` (${r.abertos.atraso}, no fim da fila${r.abertos.inicio_atraso ? `, a partir de ${dbr(r.abertos.inicio_atraso)}` : ''})` : ''}. Quem quita antes, mede antes.`);
    L.push('Quitou? Entra no fim da fila de medição — quem quita antes, mede antes.');
  }
  L.push('');
  L.push('_Previsão sujeita a chuva e ao andamento do campo. Romatec Consultoria Total — Resp. técnico José Romário._');
  return L.join('\n');
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const ha = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const COR_REL = { concluido: '#A9D8B8', hoje: '#1E7B34', em_medicao: '#F2C94C', proximo: '#5DA9E9', fila: '#CFE3F5' };
const curto = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : n.trim(); };

/** Cores do mapa: medidos antes (verde-claro), hoje (verde), em medição (amarelo), próximo dia (azul), fila (azul-claro). */
export function temaRelatorio(r: Relatorio, lotes: LoteBoletim[]): Record<string, RotuloLote> {
  const hoje = new Set(r.hoje.map((x) => x.lote)), em = new Set(r.em_medicao.map((x) => x.lote));
  const prox = new Map((r.proximo?.itens ?? []).map((x, i) => [x.lote, i + 1]));
  const fila = new Set(r.previsao.slice(1).flatMap((p) => p.itens.map((x) => x.lote)));
  return Object.fromEntries(lotes.map((l) => {
    const nome = l.associado ? curto(l.associado.nome) : undefined;
    if (hoje.has(l.lote)) return [l.lote, { cor: COR_REL.hoje, opac: 0.88, destaque: true, rotulo: `LT-${l.lote} ✓`, sub: nome ? `${nome} — medido` : 'medido' }];
    if (l.fechado) return [l.lote, { cor: COR_REL.concluido, opac: 0.8, rotulo: `LT-${l.lote} ✓` }];
    if (em.has(l.lote)) return [l.lote, { cor: COR_REL.em_medicao, opac: 0.85, destaque: true, rotulo: `LT-${l.lote}`, sub: 'em medição' }];
    if (prox.has(l.lote)) return [l.lote, { cor: COR_REL.proximo, opac: 0.85, destaque: true, rotulo: `${prox.get(l.lote)}. LT-${l.lote}`, sub: nome }];
    if (fila.has(l.lote)) return [l.lote, { cor: COR_REL.fila, opac: 0.8, rotulo: `LT-${l.lote}` }];
    return [l.lote, { cor: '#FFFFFF', opac: 0.72, rotulo: `LT-${l.lote}` }];
  }));
}

export function htmlRelatorio(cab: DadosMapaPA, r: Relatorio, mapa: string): string {
  const k = (rot: string, v: string, s: string, cls = '') => `<div class="k ${cls}"><span>${rot}</span><b>${v}</b><i>${s}</i></div>`;
  const tagD = (x: Relatorio['concluidos'][number]) => `<span class="tag d-${x.dossie}">${esc(ROT_DOSSIE[x.dossie].replace(/^\S+\s/, ''))}${x.dossie_em ? ` ${dcurto(x.dossie_em)}` : ''}</span>`;
  const cel = (x: LinhaRel) => `<td><b>LT-${esc(x.lote)}</b>${x.lote_vila ? `<div class="mi">vila ${esc(x.lote_vila)}</div>` : ''}</td><td><b>${esc(x.associado ?? '—')}</b></td><td>${esc(x.chacara ?? '—')}</td><td class="n">${ha(x.area_ha)} ha</td>`;
  const tab = (cols: string, corpo: string) => `<table><thead><tr>${cols}</tr></thead><tbody>${corpo}</tbody></table>`;
  const H = '<th>Lote</th><th>Associado</th><th>Chácara</th><th class="n">Área</th>';
  const resto = r.previsao.slice(1);
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Relatório do dia de campo — ${esc(cab.projeto.nome)}</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:'Liberation Sans',Arial,sans-serif;color:#1C1C18;font-size:8.4pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
    .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}.cab .lg img{height:11mm}.cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
    .cab h1{margin:0;font-size:13pt}.cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}.cab .t{flex:1}
    .data{display:flex;justify-content:space-between;align-items:center;margin:2.5mm 0 2mm;font-size:9.5pt}.data b{color:#0C3320}
    .st{border-radius:2mm;padding:.8mm 2.5mm;font-weight:700;font-size:8.5pt}.st.f{background:#1E7B34;color:#fff}.st.p{background:#F2C94C;color:#3d2a00}
    .ks{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.k{border:1px solid #C9C2AE;border-radius:2mm;padding:1.6mm 2.4mm;background:#FBFAF5}
    .k span{display:block;color:#6A6656;font-size:6.6pt;text-transform:uppercase;font-weight:700}.k b{display:block;font-size:13pt;color:#0C3320;margin:.4mm 0}.k i{font-style:normal;color:#555;font-size:7pt}
    .k.ok{border-color:#2E7D4F;background:#EEF6EF}.k.az{border-color:#5DA9E9;background:#EEF5FC}
    .barra{height:3.2mm;border-radius:2mm;background:#E5DFCD;overflow:hidden;margin:2mm 0 1mm}.barra i{display:block;height:100%;background:linear-gradient(90deg,#1E7B34,#2E9D4F)}
    .mapa{border:1px solid #C9C2AE;border-radius:2mm;overflow:hidden;background:#fff;margin-top:2mm;width:718px;max-width:100%}
    .legg{display:flex;flex-wrap:wrap;gap:1.5mm 4mm;font-size:7.8pt;margin:1.5mm 0}.legg i{display:inline-block;width:4mm;height:4mm;border-radius:.8mm;vertical-align:middle;margin-right:1.2mm;border:1px solid #0C3320}
    h2{color:#0C3320;font-size:10.2pt;margin:3mm 0 1.4mm;border-bottom:1.2px solid #C9A84C;padding-bottom:.8mm}
    table{width:100%;border-collapse:collapse;font-size:8pt}th{background:#0C3320;color:#fff;padding:1.2mm;text-align:left;font-size:6.9pt}td{border-bottom:1px solid #E5DFCD;padding:1.1mm 1.2mm;vertical-align:top}
    tr:nth-child(even) td{background:#FAF7EE}td.n,th.n{text-align:right;white-space:nowrap}.mi{color:#777;font-size:6.6pt}
    .tag{display:inline-block;border-radius:2mm;padding:.3mm 1.6mm;font-size:6.6pt;font-weight:700;white-space:nowrap}
    .d-ENTREGUE{background:#1E7B34;color:#fff}.d-ENVIADO{background:#2E9D4F;color:#fff}.d-REVISAO{background:#5DA9E9;color:#fff}.d-AGUARDANDO_PAGAMENTO{background:#F2994A;color:#3d2200}.d-SEM_DOSSIE{background:#E5DFCD;color:#333}
    .aviso{border:1px solid #C9A84C;background:#FFF8E6;border-radius:2mm;padding:2mm 3mm;margin-top:2.5mm;font-size:8.2pt}
    .nota{font-size:7.2pt;color:#555;margin-top:2mm}
    .rod{margin-top:3mm;font-size:7pt;color:#555;display:flex;justify-content:space-between;border-top:1px solid #C9A84C;padding-top:1.5mm}
    thead{display:table-header-group}tr{page-break-inside:avoid}h2{page-break-after:avoid}
  </style></head><body>
    ${cabecalho(cab, 'RELATÓRIO DO DIA DE CAMPO — MEDIÇÃO DOS LOTES')}
    <div class="data"><span>Data: <b>${dbr(r.dia)}</b> · ${semana(r.dia)}</span><span class="st ${r.fechado ? 'f' : 'p'}">${r.fechado ? 'FECHADO' : `PARCIAL — fecha às ${HORA_RELOCACAO} h`}</span></div>
    <div class="ks">${k('Lotes concluídos', `${r.medidos_total}/${r.total}`, `${pct(r.medidos_total, r.total)}% do PA`, 'ok')}${k('Medidos no dia', String(r.hoje.length), r.em_medicao.length ? `${r.em_medicao.length} em medição` : 'lotes fechados no dia')}${k('Quitados na fila', String(r.previsao.reduce((n, p) => n + p.itens.length, 0)), r.previsao.length ? `até ${dbr(r.previsao[r.previsao.length - 1].dia)}` : 'fila vazia', 'az')}${k('Parcelas em aberto', String(r.abertos.qtd), r.abertos.inicio_previsto ? `início previsto ${dbr(r.abertos.inicio_previsto)}` : '—')}</div>
    <div class="barra"><i style="width:${pct(r.medidos_total, r.total).replace(',', '.')}%"></i></div>
    <div class="mapa">${mapa}</div>
    <div class="legg"><span><i style="background:${COR_REL.hoje}"></i>Medido no dia</span><span><i style="background:${COR_REL.concluido}"></i>Concluído antes</span><span><i style="background:${COR_REL.em_medicao}"></i>Em medição</span><span><i style="background:${COR_REL.proximo}"></i>Próximo dia (nº = ordem)</span><span><i style="background:${COR_REL.fila}"></i>Quitado na fila</span><span><i style="background:#fff"></i>A quitar / sem associado</span></div>
    <h2>1. Lotes concluídos — ${r.medidos_total} de ${r.total} (${pct(r.medidos_total, r.total)}%)</h2>
    ${r.concluidos.length ? tab(`${H}<th>Medido em</th><th>Dossiê</th>`, r.concluidos.map((x) => `<tr>${cel(x)}<td>${dbr(x.medido_em)}</td><td>${tagD(x)}</td></tr>`).join('')) : '<div class="nota">Nenhum lote concluído ainda.</div>'}
    <h2>2. Medidos em ${dbr(r.dia)} (${r.hoje.length})</h2>
    ${r.hoje.length ? tab(`${H}<th>Situação</th>`, r.hoje.map((x) => `<tr>${cel(x)}<td><span class="tag d-ENTREGUE">✓ MEDIDO — OK</span></td></tr>`).join('')) : '<div class="nota">Nenhum lote fechado no dia.</div>'}
    ${r.em_medicao.length ? `<h2>3. Em medição — continuam no próximo dia (${r.em_medicao.length})</h2>${tab(`${H}<th class="n">Marcos</th>`, r.em_medicao.map((x) => `<tr>${cel(x)}<td class="n">${x.marcados}/${x.exigidos}</td></tr>`).join(''))}` : ''}
    <h2>${r.em_medicao.length ? 4 : 3}. Programação de ${r.proximo ? `${dbr(r.proximo.dia)} (${semana(r.proximo.dia)}) — ${r.proximo.itens.length} lote(s)` : 'amanhã'}</h2>
    ${r.proximo ? tab(`<th class="n">Nº</th>${H}`, r.proximo.itens.map((x, i) => `<tr><td class="n"><b>${i + 1}</b></td>${cel(x)}</tr>`).join('')) + '<div class="nota">Associados desses lotes: se possível, acompanhem a equipe no lote para indicar as divisas e os marcos.</div>' : '<div class="nota">Nenhum lote quitado na fila no momento.</div>'}
    ${resto.length ? `<h2>Previsão de medição — quitados na fila, pela ordem de quitação</h2>${tab(`<th>Data prevista</th><th class="n">Nº</th>${H}`, resto.map((p) => p.itens.map((x, i) => `<tr><td>${i === 0 ? `<b>${dbr(p.dia)}</b><div class="mi">${semana(p.dia)}</div>` : ''}</td><td class="n">${i + 1}</td>${cel(x)}</tr>`).join('')).join(''))}` : ''}
    ${r.abertos.qtd ? `<div class="aviso">💳 <b>${r.abertos.qtd} lote(s) com parcelas em aberto.</b> Ordem da medição: <b>1º quitados</b> → <b>2º em dia com as parcelas</b>${r.abertos.em_dia ? ` (${r.abertos.em_dia}${r.abertos.inicio_previsto ? `, a partir de ${dbr(r.abertos.inicio_previsto)}` : ''})` : ''} → <b>3º com parcela em atraso</b>${r.abertos.atraso ? ` (${r.abertos.atraso}, no fim da fila${r.abertos.inicio_atraso ? `, a partir de ${dbr(r.abertos.inicio_atraso)}` : ''})` : ''}. Quem quita antes, mede antes.</div>` : ''}
    <div class="nota">Previsão sujeita a chuva e ao andamento do campo; ${lotesPorDia()} lotes por dia útil. Medição e cravação dos marcos — SIRGAS 2000 · NBR 13133.</div>
    <div class="rod"><span>Responsável técnico: ${esc(cab.rt.nome)} · ${esc(cab.rt.registro)}</span><span>Romatec Consultoria Total · gerado em ${esc(cab.data)}</span></div>
  </body></html>`;
}

// ─── dados ────────────────────────────────────────────────────────────────
async function situacaoDossies(projetoId: number): Promise<Map<string, { situacao: SituacaoDossieRel; em: string | null }>> {
  const dz = await import('./paDossie');
  const ds = await dz.listarDossies(projetoId).catch(() => []);
  return new Map(ds.map((d) => {
    const x = d as typeof d & { revisao_enviada_em?: string | null };
    const s: SituacaoDossieRel = d.status === 'ENTREGUE' ? 'ENTREGUE' : d.status === 'ENVIADO' ? 'ENVIADO' : d.status === 'PRONTO' ? 'REVISAO' : 'AGUARDANDO_PAGAMENTO';
    const em = s === 'ENTREGUE' ? d.entregue_em : s === 'ENVIADO' ? d.enviado_em : s === 'REVISAO' ? (x.revisao_enviada_em ?? d.gerado_em) : null;
    return [d.lote, { situacao: s, em: em ? diaBrasilia(String(em)) : null }];
  }));
}

export async function dadosRelatorio(projetoId: number, diaQ: unknown, agora = new Date()): Promise<{ r: Relatorio; lotes: LoteBoletim[]; nome: string; codigo: string }> {
  const hoje = hojeBrasil(agora);
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(diaQ ?? '').slice(0, 10)) ? String(diaQ).slice(0, 10) : hoje;
  const hBr = (agora.getUTCHours() + 21) % 24;
  if (dia > hoje) throw new PaErro('DIA_FUTURO', 'O relatório é do dia de campo — escolha hoje ou um dia anterior', 409);
  // v3.198.4: sem trava de horário — consulta a qualquer hora; antes das 21 h sai como parcial (projeção do fechamento)
  const p = await buscarProjeto(projetoId);
  const e = await estadoCampo(projetoId);
  const lotes = e.lotes as unknown as LoteBoletim[];
  const fechado = dia < hoje || hBr >= HORA_RELOCACAO
    || (await rows(pool, "SELECT id FROM pa_eventos WHERE projeto_id = ? AND tipo = 'CAMPO_FECHAMENTO_DIA' AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.dia')) = ? LIMIT 1", [projetoId, dia])).length > 0;
  // dias seguintes: depois do fechamento, o que está gravado; antes, a projeção do fechamento (não grava nada)
  const relocado = (await rows(pool, "SELECT id FROM pa_eventos WHERE projeto_id = ? AND tipo IN ('CAMPO_FECHAMENTO_DIA','CAMPO_RELOCACAO') AND JSON_UNQUOTE(JSON_EXTRACT(dados, '$.dia')) = ? LIMIT 1", [projetoId, dia])).length > 0;
  const futuro = await futuroAtual(projetoId, dia);
  const plano = relocado ? futuro : planejarAgenda(dia, await lotesAgenda(projetoId), await lotesDoDia(projetoId, dia), [], futuro);
  return { r: montarRelatorio(dia, lotes, await situacaoDossies(projetoId), plano, fechado), lotes, nome: p.nome, codigo: p.codigo };
}

// v3.191.1: nome do arquivo = relatório + PA + data (ex.: Relatorio_Campo_PA_Salete_Moreno_19-11-2026.pdf)
export const siglaPa = (codigo: string) => codigo.split(/[-_\s]+/).filter(Boolean).map((w) => /^PA$/i.test(w) ? 'PA' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('_');
export const nomeArq = (codigo: string, dia: string) => `Relatorio_Campo_${siglaPa(codigo)}_${dia.slice(8, 10)}-${dia.slice(5, 7)}-${dia.slice(0, 4)}.pdf`;
export async function textoRelatorioDia(projetoId: number, diaQ: unknown) {
  const { r, nome, codigo } = await dadosRelatorio(projetoId, diaQ);
  return { texto: textoRelatorio(r, nome), nome: nomeArq(codigo, r.dia) };
}
export async function pdfRelatorioDia(projetoId: number, diaQ: unknown, base: BaseMapa): Promise<{ pdf: Buffer; nome: string }> {
  const { r, lotes, codigo } = await dadosRelatorio(projetoId, diaQ);
  const p = await buscarProjeto(projetoId);
  const geo = (await geojsonSubdivisao(projetoId).catch(() => ({ features: [] }))) as unknown as { features: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> };
  const { html: mapa } = await htmlMapaLotes(geo, temaRelatorio(r, lotes), { base, H: 480 });
  return { pdf: await pdfDeHtml(htmlRelatorio(dadosCabecalho(p), r, mapa)), nome: nomeArq(codigo, r.dia) };
}
