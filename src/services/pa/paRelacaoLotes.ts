// v3.156.0 — Relação de associados por lote rural (documento oficial para a diretoria
// conferir e assinar). Sai do vínculo lote → associado (pa_associados.parcela) e da
// subdivisão; lote sem vínculo e associado sem lote aparecem como "a confirmar".
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pool, rows, registrarEvento } from './paDb';
import { buscarProjeto, type Projeto } from './paRepo';
import { buscarSubdivisao } from './paMapas';
import { marcaArquivos } from './marcaProjeto';
import { PaErro } from './erros';

export interface LinhaRelacao { lote: string; area_ha: number | null; nome: string | null; cpf: string | null; numero: string | null; lote_vila: string | null }
export interface Relacao { linhas: LinhaRelacao[]; semLote: Array<{ nome: string; numero: string; lote_vila: string | null }> }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
/** LGPD: documento circula fora do sistema — CPF só com os 6 dígitos do meio. */
export const cpfMascarado = (cpf: string | null) => {
  const d = String(cpf ?? '').replace(/\D/g, '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '—';
};
const ha = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }));

export function montarRelacao(lotes: Array<{ lote: string; area_ha: number | null }>, associados: Array<{ nome: string; cpf: string; numero: string; parcela: string | null; lote_vila?: string | null }>): Relacao {
  const por = new Map(associados.filter((a) => a.parcela).map((a) => [a.parcela as string, a]));
  return {
    linhas: lotes.map((l) => { const a = por.get(l.lote); return { lote: l.lote, area_ha: l.area_ha, nome: a?.nome ?? null, cpf: a?.cpf ?? null, numero: a?.numero ?? null, lote_vila: a?.lote_vila ?? null }; }),
    semLote: associados.filter((a) => !a.parcela || !lotes.some((l) => l.lote === a.parcela)).map((a) => ({ nome: a.nome, numero: a.numero, lote_vila: a.lote_vila ?? null })),
  };
}

function brand(nome: string | null): string {
  if (!nome) return '';
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? `data:image/${nome.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(f).toString('base64')}` : '';
}

export function htmlRelacao(p: Projeto, r: Relacao, hoje: Date = new Date()): string {
  const bras = brand(marcaArquivos(p.codigo).brasao);
  const logo = brand('logo_romatec.jpg');
  const assoc = (p.associacao_nome || `Associação do ${p.nome}`).toUpperCase();
  const vinc = r.linhas.filter((l) => l.nome).length;
  const pend = r.linhas.length - vinc;
  const linhas = r.linhas.map((l) => `<tr${l.nome ? '' : ' class="pd"'}><td class="c"><b>${esc(l.lote)}</b></td><td class="c">${ha(l.area_ha)}</td><td class="c"><b>${esc(l.lote_vila ?? '')}</b></td>
    <td>${l.nome ? esc(l.nome) : '<b>A CONFIRMAR</b> — nome: ____________________________'}</td><td class="c">${l.nome ? esc(cpfMascarado(l.cpf)) : ''}</td>    <td class="c ck">(&nbsp;&nbsp;) Sim&nbsp; (&nbsp;&nbsp;) Não</td></tr>`).join('');
  const semLote = r.semLote.length
    ? `<h3>Associados ativos sem lote definido na relação recebida</h3><table><thead><tr><th style="width:18mm">Lote vila</th><th>Associado(a)</th><th style="width:44mm">Lote de produção (diretoria)</th></tr></thead><tbody>
      ${r.semLote.map((a) => `<tr><td class="c">${esc(a.lote_vila ?? '')}</td><td>${esc(a.nome)}</td><td></td></tr>`).join('')}</tbody></table>` : '';
  const data = hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relação por lote — ${esc(p.nome)}</title><style>
    @page { size: A4; margin: 14mm 14mm 16mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, sans-serif; font-size: 9pt; color: #111; margin: 0; }
    .cab { display: flex; align-items: center; justify-content: space-between; gap: 4mm; border-bottom: 1.2mm solid #0C3320; padding-bottom: 2.5mm; }
    .cab .bras { height: 19mm; } .cab .logo { height: 13mm; }
    .ct { text-align: center; flex: 1; } .a1 { font-weight: 800; font-size: 10.5pt; color: #0C3320; } .a2 { font-size: 8.5pt; color: #555; margin-top: 1mm; }
    .faixa { height: .7mm; background: #C9A84C; margin: 1mm 0 4mm; }
    h1 { text-align: center; font-size: 12.5pt; margin: 0 0 1mm; font-family: 'Times New Roman', serif; }
    h2 { text-align: center; font-size: 9.5pt; margin: 0 0 4mm; font-weight: 400; color: #333; }
    h3 { font-size: 10pt; color: #0C3320; margin: 6mm 0 2mm; }
    p { text-align: justify; line-height: 1.5; margin: 0 0 3mm; font-family: 'Times New Roman', serif; font-size: 10.5pt; }
    .res { display: flex; gap: 3mm; margin-bottom: 3mm; } .res div { flex: 1; border: .3mm solid #0C3320; border-radius: 1.5mm; padding: 1.5mm; text-align: center; font-size: 8pt; color: #444; } .res b { display: block; font-size: 13pt; color: #0C3320; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #0C3320; color: #fff; padding: 1.5mm 1mm; border: .25mm solid #0C3320; font-size: 8pt; }
    td { border: .25mm solid #999; padding: 1.1mm 1.4mm; font-size: 8.4pt; }
    tr:nth-child(even) td { background: #f6f3ea; } tr.pd td { background: #fff3cd; }
    td.c { text-align: center; } td.ck { white-space: nowrap; font-size: 7.8pt; }
    thead { display: table-header-group; } tr { page-break-inside: avoid; }
    .decl { page-break-inside: avoid; margin-top: 6mm; }
    .assin { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm 12mm; margin-top: 14mm; }
    .as { text-align: center; font-size: 9pt; } .as .ln { border-top: .3mm solid #111; margin-bottom: 1.2mm; } .as span { color: #444; font-size: 8.5pt; }
  </style></head><body>
    <div class="cab">${bras ? `<img class="bras" src="${bras}">` : '<span></span>'}<div class="ct"><div class="a1">${esc(assoc)}</div><div class="a2">${esc(p.municipio)}/${esc(p.uf)} · ${p.associacao_cnpj ? 'CNPJ ' + esc(p.associacao_cnpj) : 'CNPJ em homologação'}</div></div>${logo ? `<img class="logo" src="${logo}">` : '<span></span>'}</div>
    <div class="faixa"></div>
    <h1>RELAÇÃO DE ASSOCIADOS — LOTE NA VILA × LOTE DE PRODUÇÃO</h1>
    <h2>${esc(p.nome)} — documento para conferência e confirmação da Diretoria</h2>
    <p>A Romatec Consultoria Total, responsável técnica pelo levantamento georreferenciado do ${esc(p.nome)}, apresenta à Diretoria da ${esc(assoc)} a relação de associados com o <b>lote na vila</b> (moradia) e o <b>lote de produção</b> (lote rural da subdivisão levantada em campo, que será demarcado), conforme informação recebida da Associação, para que a Diretoria <b>confira e confirme</b> cada vínculo. Somente após a confirmação os nomes serão lançados de forma definitiva nos mapas e memoriais descritivos individuais dos lotes. Linhas em destaque (amarelo) indicam lote sem associado definido ou com informação a confirmar.</p>
    <div class="res"><div><b>${r.linhas.length}</b>lotes na subdivisão</div><div><b>${vinc}</b>lotes com associado</div><div><b>${pend}</b>lotes a confirmar</div><div><b>${r.semLote.length}</b>associados sem lote</div></div>
    <table><thead><tr><th style="width:19mm">Lote de produção</th><th style="width:19mm">Área (ha)</th><th style="width:15mm">Lote na vila</th><th>Associado(a)</th><th style="width:28mm">CPF</th><th style="width:28mm">Confere?</th></tr></thead><tbody>${linhas}</tbody></table>
    ${semLote}
    <div class="decl"><h3>Declaração da Diretoria</h3>
    <p>Declaramos, para os devidos fins, que conferimos a relação acima e que ela (&nbsp;&nbsp;) está correta (&nbsp;&nbsp;) está correta com as correções anotadas neste documento, correspondendo à ocupação de cada lote rural do ${esc(p.nome)} pelos respectivos associados. Observações: ________________________________________________________________________________________________________________________________________________.</p>
    <p>${esc(p.municipio)}/${esc(p.uf)}, ____ de ______________ de ________. &nbsp;&nbsp;(Documento emitido em ${esc(data)}.)</p>
    <div class="assin">
      <div class="as"><div class="ln"></div><b>Presidente</b><br><span>${esc(assoc)}</span></div>
      <div class="as"><div class="ln"></div><b>Secretário(a)</b><br><span>${esc(assoc)}</span></div>
      <div class="as"><div class="ln"></div><b>Tesoureiro(a)</b><br><span>${esc(assoc)}</span></div>
      <div class="as"><div class="ln"></div><b>Responsável Técnico</b><br><span>Romatec Consultoria Total</span></div>
    </div></div>
  </body></html>`;
}

export async function pdfRelacaoLotes(projetoId: number, usuario: string | null): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const sub = await buscarSubdivisao(projetoId);
  if (!sub) throw new PaErro('SEM_SUBDIVISAO', 'Envie primeiro o DXF da divisão dos lotes (Mapa → Lotes do PA)', 404);
  const as = await rows(pool, 'SELECT a.nome, a.cpf, a.numero, a.parcela, lt.numero AS lote_vila FROM pa_associados a LEFT JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY a.nome', [projetoId]);
  const r = montarRelacao(
    sub.parcelas.map((x) => ({ lote: x.lote, area_ha: x.perimetro.area_ha })).sort((a, b) => a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true })),
    as.map((a) => ({ nome: String(a.nome), cpf: String(a.cpf ?? ''), numero: String(a.numero ?? ''), parcela: a.parcela == null ? null : String(a.parcela), lote_vila: a.lote_vila == null ? null : String(a.lote_vila) })),
  );
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  const pdf = await htmlToPdf(htmlRelacao(p, r), {
    format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:7.5pt;font-family:Arial;color:#777;padding:0 14mm;display:flex;justify-content:space-between"><span>Relação de associados por lote — ${esc(p.nome)} · Romatec Consultoria Total</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
    margin: { top: '14mm', right: '14mm', bottom: '16mm', left: '14mm' },
  });
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'RELACAO_LOTES', dados: { lotes: r.linhas.length, sem_lote: r.semLote.length } });
  return { pdf, nome: `RELACAO-ASSOCIADOS-POR-LOTE-${p.codigo}.pdf` };
}
