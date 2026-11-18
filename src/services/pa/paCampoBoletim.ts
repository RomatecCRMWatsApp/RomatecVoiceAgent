// v3.172.0 — Boletim de campo (PDF A4 + texto para o grupo do PA no WhatsApp):
// evolução diária da medição (lotes medidos e marcos cravados por dia, acumulado,
// ritmo e previsão) e o mapa dos lotes como no sistema.
// v3.174.0: é o boletim do GRUPO — mapa todo branco, só os lotes medidos em destaque
// (amarelo = medidos no dia) com o nome do associado e o OK. A ordem de serviço
// (pagamento/quitados/fila) é controle da equipe e não vai para o grupo.
import { buscarProjeto } from './paRepo';
import { geojsonSubdivisao, dadosCabecalho } from './paMapas';
import { cabecalho, pdfDeHtml, type DadosMapaPA } from './mapasPdf';
import { htmlMapaLotes, type BaseMapa, type RotuloLote } from './mapaTiles';
import { hojeBrasil } from './paDb';
import { estadoCampo, diaBrasilia, FAIXAS_PAGAMENTO, type PagamentoLote } from './paCampo';

export interface LoteBoletim {
  lote: string; area_ha: number; marcados: number; exigidos: string[]; prioridade: number | null; faixa: string;
  fechado: { concluido_em: string; usuario_nome: string | null } | null;
  associado: { nome: string; lote_vila: string; denominacao: string | null } | null;
  pagamento: PagamentoLote | null;
}
export interface EstadoBoletim {
  lotes: LoteBoletim[];
  producao: Array<{ dia: string; usuario: string; pontos: number; lotes: number; horas: number }>;
  totais: { a_implantar: number; marcados: number; lotes: number; fechados: number };
}
export interface DiaBoletim { dia: string; marcos: number; lotes: string[]; equipe: string[]; horas: number; acum_lotes: number; acum_marcos: number; pct: number }

const pct1 = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const quitado = (l: LoteBoletim) => !!(l.pagamento && l.pagamento.quitado);
const numLote = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });

/** Consolida o boletim (pura — testável). `hoje` = AAAA-MM-DD no fuso de Brasília. */
export function montarBoletim(e: EstadoBoletim, hoje: string) {
  const totalLotes = e.lotes.length;
  const porDia = new Map<string, { marcos: number; lotes: string[]; equipe: Set<string>; horas: number }>();
  const dia = (d: string) => { let r = porDia.get(d); if (!r) { r = { marcos: 0, lotes: [], equipe: new Set(), horas: 0 }; porDia.set(d, r); } return r; };
  for (const p of e.producao) { const r = dia(p.dia); r.marcos += p.pontos; if (p.usuario && p.usuario !== '—') r.equipe.add(p.usuario); r.horas = Math.max(r.horas, p.horas); }
  for (const l of e.lotes) if (l.fechado) dia(diaBrasilia(l.fechado.concluido_em)).lotes.push(l.lote);
  let acL = 0, acM = 0;
  const dias: DiaBoletim[] = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, r]) => {
    acL += r.lotes.length; acM += r.marcos;
    return { dia: d, marcos: r.marcos, lotes: r.lotes.sort(numLote), equipe: [...r.equipe].sort(), horas: r.horas, acum_lotes: acL, acum_marcos: acM, pct: pct1(acL, totalLotes) };
  });
  const medidos = e.lotes.filter((l) => l.fechado).length;
  const restantes = totalLotes - medidos;
  const diasCampo = dias.length;
  const mediaLotes = diasCampo ? Math.round((medidos / diasCampo) * 10) / 10 : 0;
  const mediaMarcos = diasCampo ? Math.round((e.totais.marcados / diasCampo) * 10) / 10 : 0;
  const previsaoDias = mediaLotes > 0 && restantes > 0 ? Math.ceil(restantes / mediaLotes) : null;
  const ultimo = dias.length ? dias[dias.length - 1] : null;
  const diaHoje = dias.find((d) => d.dia === hoje) ?? null;
  const quitados = e.lotes.filter(quitado);
  const aMedir = e.lotes.filter((l) => !l.fechado).sort((a, b) => (a.prioridade ?? 1e9) - (b.prioridade ?? 1e9));
  return {
    hoje, totalLotes, medidos, restantes, pct: pct1(medidos, totalLotes),
    marcos: { cravados: e.totais.marcados, total: e.totais.a_implantar, pct: pct1(e.totais.marcados, e.totais.a_implantar) },
    dias, diasCampo, mediaLotes, mediaMarcos, previsaoDias, ultimo, diaHoje,
    emAndamento: aMedir.filter((l) => l.marcados > 0).map((l) => l.lote),
    quitados: { total: quitados.length, medidos: quitados.filter((l) => l.fechado).map((l) => l.lote).sort(numLote), aMedir: quitados.filter((l) => !l.fechado).sort((a, b) => (a.prioridade ?? 1e9) - (b.prioridade ?? 1e9)).map((l) => l.lote) },
    aMedir, medidosLista: e.lotes.filter((l) => l.fechado).sort((a, b) => String(a.fechado?.concluido_em).localeCompare(String(b.fechado?.concluido_em))),
    faixas: FAIXAS_PAGAMENTO.map((f) => { const ls = e.lotes.filter((l) => l.faixa === f.id); return { ...f, aMedir: ls.filter((l) => !l.fechado).length, medidos: ls.filter((l) => l.fechado).length }; }),
  };
}
export type Boletim = ReturnType<typeof montarBoletim>;

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const dbr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const semana = (d: string) => SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()];
const nb = (v: number, c = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
const lts = (ls: string[]) => ls.map((l) => `LT-${l}`).join(', ');
const plural = (n: number, s: string, p: string) => `${nb(n)} ${n === 1 ? s : p}`;

/** Texto para o grupo do PA (WhatsApp) — vai junto com o PDF. */
export function textoBoletim(b: Boletim, projetoNome: string): string {
  const L: string[] = [];
  L.push(`📍 *BOLETIM DE CAMPO — ${projetoNome.toUpperCase()}*`);
  L.push(`📅 ${dbr(b.hoje)} (${semana(b.hoje)})`);
  L.push('');
  L.push(`✅ *Lotes medidos:* ${b.medidos} de ${b.totalLotes} (${nb(b.pct)}%)`);
  L.push(`🪨 *Marcos cravados:* ${b.marcos.cravados} de ${b.marcos.total} (${nb(b.marcos.pct)}%)`);
  if (b.diaHoje) L.push(`📆 *Hoje:* ${b.diaHoje.lotes.length ? `${plural(b.diaHoje.lotes.length, 'lote medido', 'lotes medidos')} (${lts(b.diaHoje.lotes)})` : 'nenhum lote fechado ainda'} · ${plural(b.diaHoje.marcos, 'marco cravado', 'marcos cravados')}`);
  else if (b.ultimo) L.push(`📆 *Último dia de campo:* ${dbr(b.ultimo.dia)} — ${plural(b.ultimo.lotes.length, 'lote medido', 'lotes medidos')} · ${plural(b.ultimo.marcos, 'marco', 'marcos')}`);
  if (b.emAndamento.length) L.push(`🚧 *Em medição:* ${lts(b.emAndamento)}`);
  if (b.diasCampo) L.push(`📈 *Ritmo:* média de ${plural(b.mediaLotes, 'lote', 'lotes')} por dia em ${plural(b.diasCampo, 'dia', 'dias')} de campo (${nb(b.mediaMarcos)} marcos/dia)`);
  if (b.previsaoDias) L.push(`⏳ *Previsão:* faltam ${b.restantes} lotes — cerca de ${plural(b.previsaoDias, 'dia', 'dias')} de campo no ritmo atual`);
  else if (!b.restantes) L.push('🏁 *Todos os lotes foram medidos!*');
  const ref = b.diaHoje && b.diaHoje.lotes.length ? { t: 'MEDIDOS HOJE', d: b.diaHoje } : b.ultimo && b.ultimo.lotes.length ? { t: `MEDIDOS EM ${dbr(b.ultimo.dia)}`, d: b.ultimo } : null;
  if (ref) {
    L.push('');
    L.push(`✅ *${ref.t} — associados com o lote OK:*`);
    const porLote = new Map(b.medidosLista.map((l) => [l.lote, l]));
    for (const lt of ref.d.lotes) { const l = porLote.get(lt); L.push(`• LT-${lt} — ${l?.associado ? l.associado.nome : 'sem associado vinculado'} ✅`); }
  }
  L.push('');
  L.push(`📋 Os ${b.medidos} lotes já medidos (com o nome de cada associado), o mapa e a evolução por dia estão no PDF em anexo.`);
  L.push('');
  L.push('_Romatec Consultoria Total — Resp. técnico José Romário_');
  return L.join('\n');
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const ha = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Gráfico de barras (lotes medidos por dia) + linha do acumulado (% do PA). */
function svgEvolucao(dias: DiaBoletim[], totalLotes: number): string {
  if (!dias.length) return '';
  const ds = dias.slice(-20);
  const W = 180, H = 46, x0 = 8, y0 = 4, gw = W - x0 - 10, gh = H - y0 - 10;
  const maxL = Math.max(1, ...ds.map((d) => d.lotes.length));
  const bw = gw / ds.length;
  const bars = ds.map((d, i) => {
    const h = (d.lotes.length / maxL) * gh * 0.85, x = x0 + i * bw + bw * 0.18, y = y0 + gh - h;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(bw * 0.64).toFixed(2)}" height="${h.toFixed(2)}" rx=".6" fill="#2E7D4F"/>`
      + `<text x="${(x + bw * 0.32).toFixed(2)}" y="${(y - 1).toFixed(2)}" font-size="2.6" text-anchor="middle" font-weight="700" fill="#0C3320">${d.lotes.length}</text>`
      + `<text x="${(x + bw * 0.32).toFixed(2)}" y="${(y0 + gh + 3.6).toFixed(2)}" font-size="2.3" text-anchor="middle" fill="#555">${ddmm(d.dia)}</text>`;
  }).join('');
  const pts = ds.map((d, i) => `${(x0 + i * bw + bw / 2).toFixed(2)},${(y0 + gh - (d.acum_lotes / Math.max(1, totalLotes)) * gh).toFixed(2)}`).join(' ');
  const ult = ds[ds.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" font-family="Liberation Sans, Arial, sans-serif">
    <line x1="${x0}" y1="${y0 + gh}" x2="${x0 + gw}" y2="${y0 + gh}" stroke="#999" stroke-width=".25"/>
    <line x1="${x0}" y1="${y0}" x2="${x0 + gw}" y2="${y0}" stroke="#C9A84C" stroke-width=".2" stroke-dasharray="1 1"/>
    <text x="${x0 + gw + 1}" y="${y0 + 1}" font-size="2.3" fill="#8a6d1c">100%</text>
    ${bars}<polyline points="${pts}" fill="none" stroke="#C9A84C" stroke-width=".7"/>
    ${ds.map((d, i) => `<circle cx="${(x0 + i * bw + bw / 2).toFixed(2)}" cy="${(y0 + gh - (d.acum_lotes / Math.max(1, totalLotes)) * gh).toFixed(2)}" r=".8" fill="#C9A84C"/>`).join('')}
    <text x="${x0 + gw + 1}" y="${(y0 + gh - (ult.acum_lotes / Math.max(1, totalLotes)) * gh + 1).toFixed(2)}" font-size="2.6" font-weight="700" fill="#8a6d1c">${nb(ult.pct)}%</text>
  </svg>`;
}

export function htmlBoletim(cab: DadosMapaPA, b: Boletim, mapa: string): string {
  const k = (rot: string, v: string, s: string, cls = '') => `<div class="k ${cls}"><span>${rot}</span><b>${v}</b><i>${s}</i></div>`;
  const hojeTxt = b.diaHoje ? plural(b.diaHoje.lotes.length, 'lote', 'lotes') : '—';
  const medidos = b.medidosLista.map((l) => `<tr class="${l.fechado && diaBrasilia(l.fechado.concluido_em) === b.hoje ? 'hj' : ''}"><td><b>LT-${esc(l.lote)}</b></td><td><b>${l.associado ? esc(l.associado.nome) : '—'}</b></td><td class="n">${ha(l.area_ha)} ha</td><td class="n">${l.fechado ? dbr(diaBrasilia(l.fechado.concluido_em)) : ''}</td><td><span class="tag q">✓ MEDIDO — OK</span></td></tr>`).join('');
  const refHtml = b.diaHoje && b.diaHoje.lotes.length ? { t: 'Medidos hoje', d: b.diaHoje } : b.ultimo && b.ultimo.lotes.length ? { t: `Medidos em ${dbr(b.ultimo.dia)}`, d: b.ultimo } : null;
  const diasTab = [...b.dias].reverse().map((d) => `<tr><td class="nw"><b>${dbr(d.dia)}</b><div class="m">${semana(d.dia)}</div></td><td>${esc(d.equipe.join(', ') || '—')}</td><td class="n">${d.marcos}</td>
    <td class="n"><b>${d.lotes.length}</b></td><td>${d.lotes.length ? esc(lts(d.lotes)) : '<span class="m">—</span>'}</td><td class="n">${d.acum_lotes}/${b.totalLotes}</td><td class="n"><b>${nb(d.pct)}%</b></td></tr>`).join('');
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Boletim de campo — ${esc(cab.projeto.nome)}</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:'Liberation Sans',Arial,sans-serif;color:#1C1C18;font-size:8.4pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
    .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}.cab .lg img{height:11mm}.cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
    .cab h1{margin:0;font-size:13pt;letter-spacing:.3px}.cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}.cab .t{flex:1}
    .data{display:flex;justify-content:space-between;align-items:center;margin:2.5mm 0 2mm;font-size:9pt}.data b{color:#0C3320}
    .ks{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}.k{border:1px solid #C9C2AE;border-radius:2mm;padding:1.6mm 2.4mm;background:#FBFAF5}
    .k span{display:block;color:#6A6656;font-size:6.6pt;text-transform:uppercase;font-weight:700;letter-spacing:.3px}.k b{display:block;font-size:13pt;color:#0C3320;margin:.4mm 0}.k i{font-style:normal;color:#555;font-size:7pt}
    .k.ok{border-color:#2E7D4F;background:#EEF6EF}
    .barra{height:4.5mm;border-radius:2.3mm;background:#E7E2D2;overflow:hidden;margin:2.5mm 0 1mm;position:relative}.barra i{display:block;height:100%;background:linear-gradient(90deg,#1E7B34,#3DA35D)}
    .barra em{position:absolute;inset:0;text-align:center;font-style:normal;font-weight:700;font-size:7.4pt;line-height:4.5mm;color:#0C3320}
    .mapa{border:1px solid #C9C2AE;border-radius:2mm;overflow:hidden;background:#fff;margin-top:2mm;width:718px;max-width:100%}
    .sob{display:grid;grid-template-columns:1.15fr 1fr;gap:3mm;margin-top:2mm}
    h2{color:#0C3320;font-size:10.5pt;margin:3mm 0 1.6mm;border-bottom:1.2px solid #C9A84C;padding-bottom:.8mm}
    table{width:100%;border-collapse:collapse;font-size:7.8pt}th{background:#0C3320;color:#fff;padding:1.3mm 1.2mm;text-align:left;font-size:7pt}td{border-bottom:1px solid #E5DFCD;padding:1.2mm;vertical-align:middle}
    tr:nth-child(even) td{background:#FAF7EE}td.n,th.n{text-align:right;white-space:nowrap}.nw{white-space:nowrap}.m{color:#777;font-size:6.9pt}
    thead{display:table-header-group}tr{page-break-inside:avoid}
    .leg i,.sw{display:inline-block;width:3.6mm;height:3.6mm;border-radius:.8mm;vertical-align:middle;margin-right:1.2mm;border:1px solid rgba(0,0,0,.25)}
    .sw{width:2.6mm;height:2.6mm}
    tr.hj td{background:#FFF6D6 !important}
    .legg{display:flex;flex-wrap:wrap;gap:2mm 4mm;font-size:8pt;margin-top:1mm}.legg i{display:inline-block;width:4mm;height:4mm;border-radius:.8mm;vertical-align:middle;margin-right:1.2mm;border:1px solid #0C3320}
    .ok{color:#1E7B34;font-weight:800}
    .tag{display:inline-block;border-radius:2mm;padding:.3mm 1.6mm;font-size:6.8pt;background:#EEE;color:#555;font-weight:700}.tag.q{background:#1E7B34;color:#fff}.tag.and{background:#F2C94C;color:#4a3b00}
    .regra{border:1.2px solid #1E7B34;background:#EEF6EF;border-radius:2mm;padding:2mm 3mm;font-size:8.2pt;line-height:1.45}
    .regra b{color:#0C3320}
    .nota{font-size:7pt;color:#6A6656;font-style:italic;margin-top:1.5mm}
    .rod{margin-top:3mm;font-size:7pt;color:#555;display:flex;justify-content:space-between;border-top:1px solid #C9A84C;padding-top:1.5mm}
    .quebra{page-break-before:always}
  </style></head><body>
    ${cabecalho(cab, 'BOLETIM DE CAMPO — MEDIÇÃO DOS LOTES')}
    <div class="data"><span>Data: <b>${dbr(b.hoje)}</b> · ${semana(b.hoje)}</span><span>Medição e cravação dos marcos dos lotes — SIRGAS 2000 · NBR 13133</span></div>
    <div class="ks">
      ${k('Lotes medidos', `${b.medidos}/${b.totalLotes}`, `${nb(b.pct)}% do PA · faltam ${b.restantes}`, 'ok')}
      ${k('Marcos cravados', `${b.marcos.cravados}/${b.marcos.total}`, `${nb(b.marcos.pct)}% dos marcos`)}
      ${k(b.diaHoje ? 'Hoje' : 'Último dia de campo', b.diaHoje ? hojeTxt : b.ultimo ? `${b.ultimo.lotes.length} lote(s)` : '—', b.diaHoje ? `${b.diaHoje.marcos} marcos${b.diaHoje.lotes.length ? ' · ' + lts(b.diaHoje.lotes) : ''}` : b.ultimo ? `${dbr(b.ultimo.dia)} · ${b.ultimo.marcos} marcos` : 'campo não iniciado')}
      ${k('Ritmo / previsão', b.diasCampo ? `${nb(b.mediaLotes)} lotes/dia` : '—', b.previsaoDias ? `≈ ${b.previsaoDias} dia(s) de campo p/ concluir` : b.restantes ? `${b.diasCampo} dia(s) de campo` : 'medição concluída')}
    </div>
    <div class="barra"><i style="width:${Math.min(100, b.pct)}%"></i><em>${b.medidos} de ${b.totalLotes} lotes medidos — ${nb(b.pct)}%</em></div>
    <div class="mapa">${mapa}</div>
    <div class="sob">
      <div><div class="legg"><span><i style="background:#fff"></i>Ainda não medido</span><span><i style="background:#5DA9E9"></i>Em medição</span><span><i style="background:#2E9D4F"></i>Medido — associado OK ✓</span><span><i style="background:#F2C94C"></i>Medido ${b.diaHoje ? 'hoje' : 'no último dia de campo'}</span></div>
        <div class="nota">No mapa, cada lote medido traz o nome do associado. Lista completa na página seguinte.</div></div>
      <div class="regra"><b>✅ ${refHtml ? esc(refHtml.t) : 'Lotes medidos'}</b><br>${refHtml && refHtml.d.lotes.length ? refHtml.d.lotes.map((lt) => { const l = b.medidosLista.find((x) => x.lote === lt); return `<b>LT-${esc(lt)}</b> — ${l?.associado ? esc(l.associado.nome) : 'sem associado vinculado'} <span class="ok">OK ✓</span>`; }).join('<br>') : '<span class="m">Nenhum lote medido ainda.</span>'}
        ${b.emAndamento.length ? `<br><span class="m">Em medição: ${esc(lts(b.emAndamento))}</span>` : ''}</div>
    </div>
    <div class="quebra"></div>
    ${cabecalho(cab, 'EVOLUÇÃO DIÁRIA DA MEDIÇÃO')}
    ${b.dias.length ? `<h2>Lotes medidos por dia e avanço acumulado</h2>${svgEvolucao(b.dias, b.totalLotes)}
      <div class="nota">Barras verdes: lotes medidos (fechados) no dia · linha dourada: acumulado em % do PA${b.dias.length > 20 ? ' (últimos 20 dias)' : ''}.</div>
      <h2>Produção por dia</h2><table><thead><tr><th>Dia</th><th>Equipe</th><th class="n">Marcos cravados</th><th class="n">Lotes medidos</th><th>Lotes</th><th class="n">Acumulado</th><th class="n">% do PA</th></tr></thead><tbody>${diasTab}</tbody></table>`
      : '<div class="regra">Campo ainda não iniciado — nenhum marco cravado.</div>'}
    <h2>Associados com o lote medido — OK ✓ (${b.medidosLista.length} de ${b.totalLotes})</h2>
    ${medidos ? `<table><thead><tr><th>Lote</th><th>Associado</th><th class="n">Área</th><th class="n">Medido em</th><th>Situação</th></tr></thead><tbody>${medidos}</tbody></table>` : '<div class="regra">Nenhum lote medido ainda.</div>'}
    <div class="rod"><span>Responsável técnico: ${esc(cab.rt.nome)} · ${esc(cab.rt.registro)}</span><span>Romatec Consultoria Total · gerado em ${esc(cab.data)}</span></div>
  </body></html>`;
}

const curto = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : n.trim(); };
/** Mapa do grupo: todo branco; em destaque os medidos (verde; amarelo = medidos hoje, com o nome do associado e o OK) e os em medição (azul). */
export function temaMapa(b: Boletim, lotes: LoteBoletim[]): Record<string, RotuloLote> {
  const ref = b.diaHoje ?? null;
  const doDia = new Set(ref ? ref.lotes : b.ultimo ? b.ultimo.lotes : []);
  return Object.fromEntries(lotes.map((l) => [l.lote, l.fechado
    ? { cor: doDia.has(l.lote) ? '#F2C94C' : '#2E9D4F', opac: 0.85, destaque: true, rotulo: `LT-${l.lote} ✓`, sub: l.associado ? `${curto(l.associado.nome)} — OK` : 'medido' }
    : l.marcados > 0 // v3.176.2: em medição (marcos já cravados, lote ainda não fechado)
      ? { cor: '#5DA9E9', opac: 0.8, destaque: true, rotulo: `LT-${l.lote}`, sub: `em medição ${l.marcados}/${l.exigidos.length}` }
      : { cor: '#FFFFFF', opac: 0.72, rotulo: `LT-${l.lote}` }]));
}

async function dados(projetoId: number) {
  const p = await buscarProjeto(projetoId);
  const e = await estadoCampo(projetoId);
  return { p, e, b: montarBoletim(e, hojeBrasil()) };
}

export async function textoBoletimCampo(projetoId: number) {
  const { p, b } = await dados(projetoId);
  return { texto: textoBoletim(b, p.nome), nome: nomeArquivo(p.codigo, b.hoje) };
}
const nomeArquivo = (codigo: string, hoje: string) => `BOLETIM-CAMPO-${codigo}-${hoje}.pdf`;

/** Feições do mapa de Campo do sistema: lotes, camadas do DXF (estradas, córregos, APP, áreas comunitárias), perímetro e vila. */
async function geoDoSistema(projetoId: number) {
  return (await geojsonSubdivisao(projetoId)) as unknown as { features: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> };
}

export async function pdfBoletimCampo(projetoId: number, base: BaseMapa = 'satelite'): Promise<{ pdf: Buffer; nome: string }> {
  const { p, e, b } = await dados(projetoId);
  const geo = await geoDoSistema(projetoId).catch(() => ({ features: [] }));
  const { html: mapa } = await htmlMapaLotes(geo, temaMapa(b, e.lotes), { base });
  return { pdf: await pdfDeHtml(htmlBoletim(dadosCabecalho(p), b, mapa)), nome: nomeArquivo(p.codigo, b.hoje) };
}
