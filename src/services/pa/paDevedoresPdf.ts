// v3.200.0 — Lista dos associados com saldo em aberto (para o grupo do PA), em PDF A4.
// Mesmos números do Extrato por associado (paCaixa.extratoAssociados): saldo das parcelas do contrato
// (sinal, parcelas, ajustes), taxa de marcos em aberto e total devedor; marca quem está com parcela vencida.
// Filtro: todos com saldo (padrão) ou só os em atraso.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pool, rows, num } from './paDb';
import { extratoAssociados } from './paCaixa';
import { centavos } from './regrasFinanceiras';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dbr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export interface LinhaDevedor {
  lote_producao: string | null; lote_vila: string; nome: string; numero: string; denominacao: string | null;
  parcelas: number; parcelas_qtd: number; marcos: number; marcos_lancados: boolean; total: number; vencido: number;
}
export interface ListaDevedores { projeto: string; posicao_em: string; so_atraso: boolean; itens: LinhaDevedor[]; totais: { associados: number; parcelas: number; marcos: number; total: number; vencido: number; em_atraso: number } }

type Extrato = Awaited<ReturnType<typeof extratoAssociados>>;
/** Monta a lista (pura — testável). */
export function montarDevedores(e: Extrato, extra: Map<number, { parcela: string | null; denominacao: string | null }>, soAtraso = false): ListaDevedores {
  const nLt = (s: string | null) => (s ? parseInt(s, 10) || 9999 : 9999);
  const itens: LinhaDevedor[] = e.lista
    .filter((x) => x.em_aberto > 0.009 && (!soAtraso || x.vencido > 0.009))
    .map((x) => {
      const ab = x.parcelas.filter((p) => p.saldo > 0.009);
      const parc = ab.filter((p) => p.tipo !== 'MARCO'), marc = ab.filter((p) => p.tipo === 'MARCO');
      const ex = extra.get(x.associado_id);
      return {
        lote_producao: ex?.parcela ?? null, lote_vila: x.lote, nome: x.nome, numero: x.numero, denominacao: ex?.denominacao ?? null,
        parcelas: centavos(parc.reduce((s, p) => s + p.saldo, 0)), parcelas_qtd: parc.length,
        marcos: centavos(marc.reduce((s, p) => s + p.saldo, 0)), marcos_lancados: x.parcelas.some((p) => p.tipo === 'MARCO'),
        total: x.em_aberto, vencido: x.vencido,
      };
    })
    .sort((a, b) => nLt(a.lote_producao) - nLt(b.lote_producao) || (parseInt(a.lote_vila, 10) || 0) - (parseInt(b.lote_vila, 10) || 0));
  const s = (k: 'parcelas' | 'marcos' | 'total' | 'vencido') => centavos(itens.reduce((t, x) => t + x[k], 0));
  return { projeto: e.projeto.nome, posicao_em: e.posicao_em, so_atraso: soAtraso, itens,
    totais: { associados: itens.length, parcelas: s('parcelas'), marcos: s('marcos'), total: s('total'), vencido: s('vencido'), em_atraso: itens.filter((x) => x.vencido > 0.009).length } };
}

function img(rel: string, mime: string): string {
  const f = [path.resolve(__dirname, '../../public', rel), path.resolve(process.cwd(), 'src/public', rel), path.resolve(process.cwd(), 'dist/public', rel)].find((c) => existsSync(c));
  return f ? `data:${mime};base64,${readFileSync(f).toString('base64')}` : '';
}

export function htmlDevedores(d: ListaDevedores): string {
  const logo = img('brand/pa/logo_romatec.jpg', 'image/jpeg'), bras = img('brand/pa/capa_brasao_salete_moreno.png', 'image/png');
  const linhas = d.itens.map((x, i) => `<tr class="${x.vencido > 0.009 ? 'atr' : ''}">
    <td class="n">${i + 1}</td>
    <td class="lt"><b>${x.lote_producao ? `LT-${esc(x.lote_producao)}` : '—'}</b><div class="mi">vila ${esc(x.lote_vila)}</div></td>
    <td><b>${esc(x.nome)}</b><div class="mi">${esc(x.numero)}</div></td>
    <td>${esc(x.denominacao ?? '—')}</td>
    <td class="v">${x.parcelas > 0.009 ? `${brl(x.parcelas)}<div class="mi">${x.parcelas_qtd} em aberto</div>` : '<span class="ok">quitadas</span>'}</td>
    <td class="v">${x.marcos > 0.009 ? `${brl(x.marcos)}<div class="mi">em aberto</div>` : x.marcos_lancados ? '<span class="ok">paga</span>' : '<span class="mi">não lançada</span>'}</td>
    <td class="v tot">${brl(x.total)}${x.vencido > 0.009 ? `<div class="tg">em atraso ${brl(x.vencido)}</div>` : '<div class="mi">a vencer</div>'}</td>
  </tr>`).join('');
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Associados com saldo em aberto</title><style>
  @page{size:A4;margin:9mm 9mm 10mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#1C1C18;font-size:8.6pt}
  .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:2.6mm 4mm;border-bottom:1.2mm solid #C9A84C}
  .cab img.l{height:12mm;background:#fff;border-radius:1.5mm;padding:.8mm}.cab img.b{height:14mm;width:auto;margin-left:auto}
  .cab small{color:#E8D9A8;letter-spacing:1.3px;font-size:7pt;text-transform:uppercase}.cab h1{margin:.6mm 0 .3mm;font-size:13.5pt}.cab p{margin:0;color:#d9e6dd;font-size:8.4pt}
  .res{display:flex;gap:2.5mm;margin:2.6mm 0}.res div{flex:1;border:.3mm solid #E3DCC6;border-radius:2mm;padding:1.6mm 2.4mm;background:#FBF8EE}
  .res span{display:block;font-size:6.8pt;color:#6A6656;text-transform:uppercase;font-weight:700;letter-spacing:.3px}.res b{font-size:11.5pt;color:#0C3320}.res .r b{color:#B3261E}
  table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid}
  th{background:#0C3320;color:#fff;font-size:7.4pt;text-align:left;padding:1.4mm 1.6mm;text-transform:uppercase;letter-spacing:.3px}th.v{text-align:right}
  td{padding:1.2mm 1.6mm;border-bottom:.2mm solid #E6E1D0;vertical-align:top}tr:nth-child(even) td{background:#FBFAF5}
  td.n{width:6mm;color:#6A6656;text-align:center}td.lt{width:15mm}td.v{text-align:right;white-space:nowrap;width:25mm}td.tot{font-weight:700;width:29mm}
  .mi{font-size:7pt;color:#6A6656;font-weight:400}.ok{color:#1E7A3A;font-weight:700;font-size:7.6pt}
  .tg{display:inline-block;margin-top:.6mm;font-size:6.8pt;font-weight:700;color:#B3261E;background:#FDECEA;border-radius:1mm;padding:.2mm 1.2mm}
  tr.atr td.lt b{color:#B3261E}
  tr.tot-l td{background:#F1EBD6 !important;font-weight:700;border-top:.5mm solid #C9A84C} /* v3.200.1: total só no fim (tfoot repetia em cada página) */
  .nota{margin-top:2.6mm;font-size:7.6pt;color:#3F3B2E;background:#F4F6F2;border-left:1.2mm solid #0C3320;padding:1.6mm 2.4mm;border-radius:1mm}
  .rod{margin-top:2mm;font-size:6.8pt;color:#6A6656;text-align:center}
  </style></head><body>
  <div class="cab">${logo ? `<img class="l" src="${logo}">` : ''}<div><small>Romatec Consultoria Total · ${esc(d.projeto)}</small><h1>${d.so_atraso ? 'Associados com parcela em atraso' : 'Associados com saldo em aberto'}</h1><p>Parcelas do contrato e taxa dos marcos de concreto · posição em ${dbr(d.posicao_em)}</p></div>${bras ? `<img class="b" src="${bras}">` : ''}</div>
  <div class="res"><div><span>Associados</span><b>${d.totais.associados}</b></div><div><span>Parcelas em aberto</span><b>${brl(d.totais.parcelas)}</b></div><div><span>Taxa de marcos em aberto</span><b>${brl(d.totais.marcos)}</b></div><div><span>Total em aberto</span><b>${brl(d.totais.total)}</b></div><div class="r"><span>Em atraso (${d.totais.em_atraso})</span><b>${brl(d.totais.vencido)}</b></div></div>
  <table><thead><tr><th>#</th><th>Lote</th><th>Associado(a)</th><th>Denominação</th><th class="v">Parcelas</th><th class="v">Taxa de marcos</th><th class="v">Total devedor</th></tr></thead>
  <tbody>${linhas || '<tr><td colspan="7" style="text-align:center;padding:6mm">Nenhum associado com saldo em aberto. 🎉</td></tr>'}
  ${d.itens.length ? `<tr class="tot-l"><td></td><td colspan="3">TOTAL · ${d.totais.associados} associado(s)</td><td class="v">${brl(d.totais.parcelas)}</td><td class="v">${brl(d.totais.marcos)}</td><td class="v">${brl(d.totais.total)}</td></tr>` : ''}</tbody></table>
  <div class="nota">A medição e a entrega do dossiê seguem a ordem de quitação: <b>1º quitados</b> → <b>2º em dia</b> → <b>3º com parcela em atraso</b>. Para regularizar ou pedir a 2ª via do boleto, fale com a Romatec: (99) 99181-1246.</div>
  <div class="rod">Romatec Consultoria Total · J R P BEZERRA LTDA · CNPJ 17.261.987/0001-09 · Açailândia/MA — gerado pelo sistema ZAYRA</div>
  </body></html>`;
}

export async function dadosDevedores(projetoId: number, soAtraso = false): Promise<ListaDevedores> {
  const e = await extratoAssociados(projetoId);
  const ex = await rows(pool, 'SELECT id, parcela, denominacao_terra FROM pa_associados WHERE projeto_id = ? AND ativo = 1', [projetoId]);
  const extra = new Map(ex.map((r) => [num(r.id), { parcela: r.parcela ? String(r.parcela) : null, denominacao: r.denominacao_terra ? String(r.denominacao_terra).trim() || null : null }]));
  return montarDevedores(e, extra, soAtraso);
}
export async function pdfDevedores(projetoId: number, soAtraso = false): Promise<{ pdf: Buffer; nome: string }> {
  const d = await dadosDevedores(projetoId, soAtraso);
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  const pdf = await htmlToPdf(htmlDevedores(d), { format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, preferCSSPageSize: true });
  return { pdf, nome: `${soAtraso ? 'Associados_em_atraso' : 'Associados_saldo_em_aberto'}_${dbr(d.posicao_em).replace(/\//g, '-')}.pdf` };
}
