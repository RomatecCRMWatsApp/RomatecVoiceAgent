// v3.165.0 — Extrato financeiro dos associados em PDF (Financeiro → Associados — recebido × em aberto)
// e envio pelo WhatsApp. O PDF sai com o MESMO filtro da tela (busca, situação, ordem), cabeçalho da
// Romatec + brasão/emblema do PA, dados da empresa e do assentamento, e rodapé com página.
import { cabecalho, type DadosMapaPA } from './mapasPdf';

type ItemExtrato = {
  associado_id: number; numero: string; nome: string; lote: string; telefone: string | null; whatsapp_status: string;
  contratado: number; recebido: number; em_aberto: number; vencido: number; a_vencer: number; pct_pago: number;
  situacao: string; ultimo_pagamento: string | null; parciais: number;
  envio: { em_aberto: number; gerados: number; enviados: number };
  parcelas: Array<{ rotulo: string; tipo: string; valor: number; recebido: number; saldo: number; vencimento: string | null; status: string; boleto?: { enviado_em: string | null } | null }>;
};
export interface FiltroExtrato { busca?: string | null; sit?: string | null; ordem?: string | null }
export interface DadosEmpresa { nome: string; cnpj: string; cidade: string; rt: string; associacao: string | null; associacao_cnpj: string | null }

const SIT: Record<string, string> = { QUITADO: 'Quitado', EM_DIA: 'Em dia', EM_ATRASO: 'Em atraso', SEM_PLANO: 'Sem plano', PARCIAL: 'Pagou parcial', SEM_BOLETO: 'Sem boleto', NAO_ENVIADO: 'Boleto não enviado' };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dbr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/** Mesmo filtro/ordem da tela (desenharExtrato no pa.html). */
export function filtrarExtrato<T extends ItemExtrato>(lista: T[], f: FiltroExtrato): T[] {
  const q = String(f.busca ?? '').trim().toLowerCase();
  const sit = String(f.sit ?? '');
  const out = lista.filter((x) => (!sit || (sit === 'PARCIAL' ? x.parciais > 0 : sit === 'SEM_BOLETO' ? x.envio.gerados < x.envio.em_aberto : sit === 'NAO_ENVIADO' ? x.envio.enviados < x.envio.gerados : x.situacao === sit))
    && (!q || x.nome.toLowerCase().includes(q) || x.lote === q.padStart(2, '0') || x.lote === q));
  const ord: Record<string, (a: T, b: T) => number> = {
    lote: (a, b) => (parseInt(a.lote, 10) || 0) - (parseInt(b.lote, 10) || 0), nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
    aberto: (a, b) => b.em_aberto - a.em_aberto, vencido: (a, b) => b.vencido - a.vencido, recebido: (a, b) => b.recebido - a.recebido,
  };
  return [...out].sort(ord[String(f.ordem ?? 'lote')] ?? ord.lote);
}

export function descreverFiltro(f: FiltroExtrato): string {
  const p: string[] = [];
  if (f.sit) p.push(`Situação: ${SIT[f.sit] ?? f.sit}`);
  if (f.busca && String(f.busca).trim()) p.push(`Busca: “${String(f.busca).trim()}”`);
  return p.length ? p.join(' · ') : 'Todos os associados';
}

const somar = (l: ItemExtrato[], k: 'contratado' | 'recebido' | 'em_aberto' | 'vencido' | 'a_vencer') => Math.round(l.reduce((s, x) => s + x[k], 0) * 100) / 100;

/** Parcelas em aberto de um associado, em texto curto ("P1 10/11/2026 · R$ 350,00 — vencido"). */
function parcelasAbertas(x: ItemExtrato, hoje: string): string[] {
  return x.parcelas.filter((p) => p.saldo > 0.009).map((p) => {
    const venc = p.vencimento && p.vencimento < hoje;
    const rot = p.tipo === 'BOLETO' ? `P${p.rotulo.replace(/\D+/g, '')}` : p.rotulo;
    return `${rot} ${dbr(p.vencimento)} · ${brl(p.saldo)}${p.recebido > 0.009 ? ' (parcial)' : ''} — ${venc ? 'vencido' : 'a vencer'}${p.boleto ? (p.boleto.enviado_em ? ' · enviado' : ' · não enviado') : ' · sem boleto'}`;
  });
}

const CSS = `
  @page{size:A4 landscape;margin:9mm 9mm 13mm}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Liberation Sans',Arial,sans-serif;color:#1C1C18;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:8.4pt}
  .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
  .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}.cab .lg img{height:11mm}
  .cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
  .cab h1{margin:0;font-size:13pt;letter-spacing:.4px}.cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}.cab .t{flex:1}
  .id{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:2.5mm;font-size:7.6pt;color:#333}
  .id div{border:1px solid #E1D9C2;border-radius:1.8mm;padding:1.6mm 2.4mm;background:#FBF8EE}.id b{color:#0C3320}
  .kp{display:grid;grid-template-columns:repeat(5,1fr);gap:2.5mm;margin-top:2.5mm}
  .kp div{border:1px solid #C9C2AE;border-left:1.2mm solid #C9A84C;border-radius:1.8mm;padding:1.6mm 2.4mm}
  .kp span{display:block;color:#6A6656;font-size:6.6pt;text-transform:uppercase;letter-spacing:.4px;font-weight:700}
  .kp b{display:block;color:#0C3320;font-size:11pt;margin-top:.4mm}.kp .neg{border-left-color:#B3261E}.kp .neg b{color:#B3261E}.kp .ok{border-left-color:#2E7D32}
  .flt{margin:2.5mm 0 1.5mm;font-size:8pt;color:#0C3320;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:7.5pt}
  thead{display:table-header-group}tr{page-break-inside:avoid}
  th{background:#0C3320;color:#fff;padding:1.4mm 1.2mm;text-align:left;font-size:6.9pt}
  td{border-bottom:1px solid #E5DFCD;padding:1.2mm;vertical-align:top}
  tr:nth-child(even) td{background:#FAF7EE}
  td.n{text-align:right;white-space:nowrap}.neg{color:#B3261E;font-weight:700}.pos{color:#1f6b3a}
  .pc{font-size:6.9pt;line-height:1.35}.pc div{white-space:nowrap}.pc .v{color:#B3261E}
  .chip{display:inline-block;border-radius:2mm;padding:.2mm 1.6mm;font-size:6.6pt;font-weight:700;border:1px solid #DDD}
  .c-EM_ATRASO{background:#FBE9E7;color:#B3261E;border-color:#F1C2BD}.c-EM_DIA{background:#E6F4EC;color:#1f6b3a;border-color:#B9E0C9}
  .c-QUITADO{background:#E6F4EC;color:#1f6b3a;border-color:#B9E0C9}.c-SEM_PLANO{background:#F1EFE8;color:#666}
  tfoot td{font-weight:800;background:#FBF4E0 !important;border-top:1.2px solid #C9A84C}
  .nota{font-size:6.8pt;color:#6A6656;margin-top:2mm}
  .ass{margin-top:9mm;display:flex;justify-content:flex-end;font-size:7.6pt}.ass div{border-top:1px solid #333;width:80mm;text-align:center;padding-top:1mm}
`;

export function htmlExtrato(
  e: { posicao_em: string; totais: Record<string, number>; lista: ItemExtrato[] }, d: DadosMapaPA, emp: DadosEmpresa, f: FiltroExtrato, geradoEm: string,
): string {
  const lista = filtrarExtrato(e.lista, f);
  const t = { contratado: somar(lista, 'contratado'), recebido: somar(lista, 'recebido'), em_aberto: somar(lista, 'em_aberto'), vencido: somar(lista, 'vencido'), a_vencer: somar(lista, 'a_vencer') };
  const pct = t.contratado ? Math.round((t.recebido / t.contratado) * 1000) / 10 : 0;
  const linhas = lista.map((x) => `<tr>
    <td><b>${esc(x.lote)}</b></td>
    <td><b>${esc(x.nome)}</b><div class="pc">${esc(x.numero)}${x.telefone ? ' · ' + esc(x.telefone) : ''}</div></td>
    <td class="n">${brl(x.contratado)}</td><td class="n pos">${brl(x.recebido)}<div class="pc">${x.pct_pago.toLocaleString('pt-BR')}%</div></td>
    <td class="n"><b>${brl(x.em_aberto)}</b></td><td class="n ${x.vencido > 0 ? 'neg' : ''}">${x.vencido > 0 ? brl(x.vencido) : '—'}</td>
    <td class="pc">${parcelasAbertas(x, e.posicao_em).map((s) => `<div class="${/vencido/.test(s) ? 'v' : ''}">${esc(s)}</div>`).join('') || '—'}</td>
    <td><span class="chip c-${esc(x.situacao)}">${esc(SIT[x.situacao] ?? x.situacao)}</span>${x.parciais ? '<div class="pc">pagou parcial</div>' : ''}</td>
    <td class="n">${x.ultimo_pagamento ? dbr(x.ultimo_pagamento) : '<span class="pc">nunca</span>'}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Extrato financeiro — ${esc(d.projeto.nome)}</title><style>${CSS}</style></head><body>
    ${cabecalho(d, 'EXTRATO FINANCEIRO DOS ASSOCIADOS — RECEBIDO × EM ABERTO')}
    <div class="id">
      <div><b>${esc(emp.nome)}</b> · CNPJ ${esc(emp.cnpj)} · ${esc(emp.cidade)}<br>Responsável técnico: ${esc(emp.rt)}</div>
      <div><b>${esc(d.projeto.nome)}</b> · ${esc(d.projeto.municipio)}/${esc(d.projeto.uf)}${emp.associacao ? `<br>${esc(emp.associacao)}${emp.associacao_cnpj ? ' · CNPJ ' + esc(emp.associacao_cnpj) : ''}` : ''}</div>
    </div>
    <div class="kp">
      <div><span>Associados</span><b>${lista.length}</b></div>
      <div><span>Contratado</span><b>${brl(t.contratado)}</b></div>
      <div class="ok"><span>Recebido · ${pct.toLocaleString('pt-BR')}%</span><b>${brl(t.recebido)}</b></div>
      <div><span>Em aberto · a vencer ${brl(t.a_vencer)}</span><b>${brl(t.em_aberto)}</b></div>
      <div class="neg"><span>Vencido</span><b>${brl(t.vencido)}</b></div>
    </div>
    <div class="flt">${esc(descreverFiltro(f))} · posição em ${dbr(e.posicao_em)}</div>
    <table><thead><tr><th>Lote</th><th>Associado</th><th style="text-align:right">Contratado</th><th style="text-align:right">Recebido</th><th style="text-align:right">Em aberto</th><th style="text-align:right">Vencido</th><th>Parcelas em aberto — vencimento, valor e envio do boleto</th><th>Situação</th><th style="text-align:right">Últ. pagamento</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="9" style="text-align:center;padding:4mm">Nenhum associado com esse filtro.</td></tr>'}</tbody>
      <tfoot><tr><td></td><td>${lista.length} associado(s)</td><td class="n">${brl(t.contratado)}</td><td class="n">${brl(t.recebido)}</td><td class="n">${brl(t.em_aberto)}</td><td class="n">${brl(t.vencido)}</td><td colspan="3"></td></tr></tfoot></table>
    <div class="nota">Valores em reais. “Vencido” = parcelas com vencimento anterior a ${dbr(e.posicao_em)} e saldo em aberto. Documento gerado pelo sistema ZAYRA em ${esc(geradoEm)}.</div>
    <div class="ass"><div>${esc(emp.nome)}<br>${esc(emp.rt)}</div></div>
  </body></html>`;
}

/** Rodapé com paginação (Chromium). */
export const RODAPE_PDF = (texto: string) => `<div style="width:100%;font-size:7px;color:#666;padding:0 9mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>${esc(texto)}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;

/** Resumo em texto para o WhatsApp (vai junto com o PDF). */
export function textoResumoExtrato(e: { posicao_em: string; lista: ItemExtrato[] }, projeto: string, f: FiltroExtrato): string {
  const lista = filtrarExtrato(e.lista, f);
  const venc = somar(lista, 'vencido'), aberto = somar(lista, 'em_aberto');
  const linhas = lista.slice(0, 40).map((x) => {
    const vencidas = x.parcelas.filter((p) => p.saldo > 0.009 && p.vencimento && p.vencimento < e.posicao_em);
    const det = vencidas.length ? vencidas.map((p) => `${p.tipo === 'BOLETO' ? 'P' + p.rotulo.replace(/\D+/g, '') : p.rotulo} ${dbr(p.vencimento).slice(0, 5)}`).join(', ') : '';
    return `• Lote ${x.lote} — ${x.nome}: ${x.vencido > 0 ? `*${brl(x.vencido)} vencido*` : brl(x.em_aberto) + ' em aberto'}${det ? ` (${det})` : ''}${x.telefone ? ` · ${x.telefone}` : ''}`;
  });
  return [
    `📋 *${descreverFiltro(f)} — ${projeto}*`,
    `Posição em ${dbr(e.posicao_em)} · ${lista.length} associado(s)`,
    `💰 Em aberto: ${brl(aberto)} · 🔴 Vencido: *${brl(venc)}*`,
    '',
    ...linhas,
    ...(lista.length > 40 ? [`… e mais ${lista.length - 40} (lista completa no PDF)`] : []),
    '',
    'Romatec Consultoria Total',
  ].join('\n');
}
