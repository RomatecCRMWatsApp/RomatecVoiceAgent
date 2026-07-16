// v3.97.0 — Relatório PDF do Inventário de Materiais por Obra.
// Pipeline HTML → puppeteer (htmlToPdf), mesma família visual da Entrega de
// Obra (verde/dourado Romatec). Conteúdo: cabeçalho da obra, tabela por etapa
// (Item | Un | Comprado | Utilizado | Saldo | V.Unit | V.Total), totalizadores,
// bloco fotográfico por item (entrega × instalação) e assinatura técnica.
// Estado é lido NA HORA (sem cache) — prestação de contas formal ao cliente.

import { htmlToPdf } from '../../pdf/htmlToPdf';
import type { dadosRelatorio } from './inventarioObraRepo';

const GREEN = '#0C3320';
const GREEN_SOFT = '#1F5C3A';
const GOLD = '#C9A84C';
const BG = '#f7f7f4';

type Dados = Awaited<ReturnType<typeof dadosRelatorio>>;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] ?? c));
}
function brl(v: unknown): string {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function qtd(v: unknown): string {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
function dataBR(d: unknown): string {
  if (!d) return '';
  const dt = new Date(String(d));
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('pt-BR');
}

interface ItemRel {
  id: number; descricao: string; unidade_medida: string;
  quantidade_comprada: number; quantidade_utilizada: number; quantidade_saldo: number;
  valor_unitario: number | null; valor_total: number | null;
  status_utilizacao: string; confianca_baixa: number;
  fotos: Array<{ tipo_foto: string; mime: string; legenda: string | null; criado_em: unknown; data_base64: string }>;
}

function linhaItem(i: ItemRel): string {
  const vUtil = i.valor_unitario != null ? Number(i.quantidade_utilizada) * Number(i.valor_unitario) : null;
  return `<tr>
    <td>${esc(i.descricao)}${i.confianca_baixa ? ' <span class="flag">⚠ revisar</span>' : ''}</td>
    <td class="c">${esc(i.unidade_medida)}</td>
    <td class="n">${qtd(i.quantidade_comprada)}</td>
    <td class="n">${qtd(i.quantidade_utilizada)}</td>
    <td class="n ${Number(i.quantidade_saldo) <= 0.0005 ? 'zero' : ''}">${qtd(i.quantidade_saldo)}</td>
    <td class="n">${i.valor_unitario != null ? brl(i.valor_unitario) : '—'}</td>
    <td class="n">${vUtil != null ? brl(vUtil) : '—'}</td>
  </tr>`;
}

function blocoFotosItem(i: ItemRel): string {
  if (!i.fotos?.length) return '';
  const TIPO_LABEL: Record<string, string> = {
    entrega: '📦 Entrega', instalacao: '🔧 Instalação', avaria: '⚠ Avaria', outro: 'Foto',
  };
  const fotos = i.fotos.map((f) => {
    const b64 = String(f.data_base64).replace(/^data:[^,]+,/, '');
    return `<figure>
      <img src="data:${esc(f.mime || 'image/jpeg')};base64,${b64}" />
      <figcaption>${esc(TIPO_LABEL[f.tipo_foto] ?? f.tipo_foto)}${f.legenda ? ' — ' + esc(f.legenda) : ''} · ${dataBR(f.criado_em)}</figcaption>
    </figure>`;
  }).join('');
  return `<div class="fotos-item">
    <div class="fotos-titulo">${esc(i.descricao)}</div>
    <div class="fotos-grid">${fotos}</div>
  </div>`;
}

function tabelaEtapa(titulo: string, itens: ItemRel[], agregado?: { valor_comprado?: number; valor_utilizado?: number; valor_saldo?: number; pct_utilizado?: number }): string {
  if (!itens.length) return '';
  const totC = agregado?.valor_comprado ?? itens.reduce((s, i) => s + Number(i.quantidade_comprada) * Number(i.valor_unitario ?? 0), 0);
  const totU = agregado?.valor_utilizado ?? itens.reduce((s, i) => s + Number(i.quantidade_utilizada) * Number(i.valor_unitario ?? 0), 0);
  const totS = agregado?.valor_saldo ?? (totC - totU);
  return `
  <section class="etapa">
    <h2>${esc(titulo)}${agregado?.pct_utilizado != null ? `<span class="pct">${agregado.pct_utilizado}% utilizado</span>` : ''}</h2>
    <table>
      <thead><tr><th>Item</th><th>Un.</th><th>Comprado</th><th>Utilizado</th><th>Saldo</th><th>V. Unit.</th><th>V. Utilizado</th></tr></thead>
      <tbody>${itens.map(linhaItem).join('')}</tbody>
      <tfoot><tr><td colspan="5">Totais da etapa</td><td class="n">${brl(totC)}</td><td class="n">${brl(totU)}</td></tr>
      <tr class="saldo"><td colspan="6">Valor em estoque na obra (saldo)</td><td class="n">${brl(totS)}</td></tr></tfoot>
    </table>
  </section>`;
}

export function renderInventarioHtml(dados: Dados): string {
  const obra = dados.obra;
  const agora = new Date();
  const secoes: string[] = [];
  const fotosSecoes: string[] = [];

  for (const e of dados.etapas) {
    const itens = (e as unknown as { itens: ItemRel[] }).itens ?? [];
    secoes.push(tabelaEtapa(String((e as unknown as { titulo: string }).titulo), itens, e as unknown as { valor_comprado: number; valor_utilizado: number; valor_saldo: number; pct_utilizado: number }));
    fotosSecoes.push(...itens.map(blocoFotosItem).filter(Boolean));
  }
  if (dados.sem_etapa.length) {
    secoes.push(tabelaEtapa('Itens sem etapa', dados.sem_etapa as unknown as ItemRel[]));
    fotosSecoes.push(...(dados.sem_etapa as unknown as ItemRel[]).map(blocoFotosItem).filter(Boolean));
  }

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size:10.5pt; color:#1c211d; background:${BG}; }
  .page { padding: 34px 40px; }
  header { background:${GREEN}; color:#fff; padding:22px 40px; display:flex; justify-content:space-between; align-items:center; }
  header .logo { font-size:1.25rem; font-weight:700; } header .logo span { color:${GOLD}; }
  header .doc { text-align:right; font-size:.72rem; color:#cfe5db; }
  header .doc b { display:block; font-size:.95rem; color:${GOLD}; letter-spacing:1px; }
  .obra-card { background:#fff; border-left:4px solid ${GOLD}; box-shadow:0 1px 6px rgba(0,0,0,.07); padding:14px 18px; margin:18px 0; }
  .obra-card .nome { font-weight:700; font-size:1.05rem; color:${GREEN}; }
  .obra-card .meta { color:#555; font-size:.82rem; margin-top:3px; }
  .resumo { display:flex; gap:12px; margin:14px 0 20px; }
  .kpi { flex:1; background:#fff; border-top:3px solid ${GREEN_SOFT}; box-shadow:0 1px 6px rgba(0,0,0,.06); padding:12px 14px; text-align:center; break-inside:avoid; }
  .kpi .v { font-weight:700; font-size:1.05rem; color:${GREEN}; } .kpi .l { color:#777; font-size:.68rem; text-transform:uppercase; letter-spacing:1px; margin-top:2px; }
  .kpi.gold .v { color:#a2803a; }
  section.etapa { margin-bottom:20px; break-inside:avoid-page; }
  h2 { color:${GREEN}; font-size:1rem; border-bottom:2px solid ${GOLD}; padding-bottom:4px; margin-bottom:8px; }
  h2 .pct { float:right; font-size:.72rem; color:#a2803a; font-weight:600; }
  table { width:100%; border-collapse:collapse; background:#fff; box-shadow:0 1px 5px rgba(0,0,0,.05); }
  th { background:${GREEN_SOFT}; color:#fff; font-size:.72rem; text-transform:uppercase; letter-spacing:.5px; padding:7px 8px; text-align:left; }
  td { padding:6px 8px; border-bottom:1px solid #ecebe4; font-size:.82rem; }
  td.n { text-align:right; white-space:nowrap; } td.c { text-align:center; }
  td.zero { color:#b91c1c; font-weight:700; }
  .flag { color:#b45309; font-size:.68rem; font-weight:700; }
  tfoot td { font-weight:700; background:#f2f1ea; }
  tfoot tr.saldo td { background:#eafff3; color:${GREEN_SOFT}; }
  .fotos-h { margin:24px 0 8px; }
  .fotos-item { break-inside:avoid; background:#fff; box-shadow:0 1px 5px rgba(0,0,0,.05); padding:10px 12px; margin-bottom:12px; }
  .fotos-titulo { font-weight:700; color:${GREEN}; font-size:.85rem; margin-bottom:6px; }
  .fotos-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
  figure { break-inside:avoid; } figure img { width:100%; height:150px; object-fit:cover; border-radius:4px; border:1px solid #ddd; }
  figcaption { font-size:.66rem; color:#666; margin-top:2px; }
  .assinatura { margin-top:34px; text-align:center; break-inside:avoid; }
  .assinatura .linha { width:300px; border-top:1px solid #333; margin:0 auto 6px; }
  .assinatura .nome { font-weight:700; } .assinatura .cargo { font-size:.78rem; color:#555; }
  footer { margin-top:26px; padding-top:8px; border-top:1px solid #ddd; color:#888; font-size:.66rem; display:flex; justify-content:space-between; }
  </style></head><body>

  <header>
    <div class="logo">Romatec <span>Consultoria Total</span></div>
    <div class="doc"><b>INVENTÁRIO ${esc(dados.numero_inventario || '')}</b>Relatório de prestação de contas · gerado em ${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR').slice(0, 5)}</div>
  </header>

  <div class="page">
    <div class="obra-card">
      <div class="nome">${esc(obra?.nome ?? 'Obra')}</div>
      <div class="meta">
        ${obra?.cliente ? 'Cliente: ' + esc(obra.cliente) + ' · ' : ''}
        ${obra?.endereco ? esc(obra.endereco) + (obra?.cidade ? ' — ' + esc(obra.cidade) : '') : esc(obra?.cidade ?? '')}
      </div>
    </div>

    <div class="resumo">
      <div class="kpi"><div class="v">${brl(dados.resumo.valor_comprado)}</div><div class="l">Total comprado</div></div>
      <div class="kpi"><div class="v">${brl(dados.resumo.valor_utilizado)}</div><div class="l">Total utilizado</div></div>
      <div class="kpi gold"><div class="v">${brl(dados.resumo.valor_saldo)}</div><div class="l">Em estoque na obra</div></div>
      <div class="kpi"><div class="v">${dados.resumo.pct_utilizado}%</div><div class="l">Consumo</div></div>
    </div>

    ${secoes.join('') || '<p style="color:#777;">Nenhum item lançado no inventário.</p>'}

    ${fotosSecoes.length ? `<h2 class="fotos-h">Relatório Fotográfico (entrega × instalação)</h2>${fotosSecoes.join('')}` : ''}

    ${dados.notas && dados.notas.length ? `<h2 class="fotos-h">Anexos — Notas Fiscais</h2>
    <table><thead><tr><th>Anexo</th><th>NF nº</th><th>Fornecedor</th><th>Emissão</th><th>Valor</th></tr></thead><tbody>
    ${dados.notas.map((n, ix) => `<tr>
      <td><b>Anexo ${ix + 1}</b></td>
      <td>${esc(n.numero_nota ?? '—')}</td>
      <td>${esc(n.fornecedor_nome ?? '—')}</td>
      <td class="c">${dataBR(n.data_emissao)}</td>
      <td class="n">${n.valor_total != null ? brl(n.valor_total) : '—'}</td>
    </tr>`).join('')}
    </tbody></table>
    <p style="font-size:.7rem;color:#777;margin-top:4px">Os documentos originais seguem anexados na ordem acima, ao final deste relatório.</p>` : ''}

    <div class="assinatura">
      <div class="linha"></div>
      <div class="nome">José Romário Pinto Bezerra</div>
      <div class="cargo">Técnico em Edificações · Técnico em Agrimensura — CFT/MA 01209185369 · INCRA FQNS<br/>Romatec Consultoria Total — Açailândia/MA</div>
    </div>

    <footer>
      <div>Romatec Consultoria Total · CNPJ 17.261.987/0001-09</div>
      <div>Documento gerado pelo ZAYRA — estado do inventário no momento da emissão</div>
    </footer>
  </div>
  </body></html>`;
}

export async function gerarInventarioPdf(dados: Dados): Promise<Buffer> {
  return htmlToPdf(renderInventarioHtml(dados));
}

// ── v3.100.0: Relatório + ANEXOS ENUMERADOS (arquivos originais das notas) ───
// Cada nota vira "ANEXO N — NOTA FISCAL Nº X": página separadora (pdf-lib) e,
// na sequência, o documento original (PDF mesclado página a página; imagem em
// página A4; XML só a separadora com a chave — o XML não tem forma visual).
// Falha em UM anexo não derruba o relatório (pula e loga, padrão mesclarAnexos).
export async function gerarInventarioPdfComAnexos(dados: Dados): Promise<Buffer> {
  const principal = await gerarInventarioPdf(dados);
  const notas = dados.notas ?? [];
  if (!notas.length) return principal;

  const { PDFDocument: PDFLib, StandardFonts, rgb } = await import('pdf-lib');
  const merged = await PDFLib.create();
  const fontBold = await merged.embedFont(StandardFonts.HelveticaBold);
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const A4_W = 595.28, A4_H = 841.89;
  const verde = rgb(0.047, 0.2, 0.125);
  const dourado = rgb(0.788, 0.659, 0.298);

  const principalDoc = await PDFLib.load(principal);
  (await merged.copyPages(principalDoc, principalDoc.getPageIndices())).forEach(p => merged.addPage(p));

  const texto = (s: unknown) => String(s ?? '').replace(/[^\x20-\xff]/g, ' '); // WinAnsi-safe

  for (let ix = 0; ix < notas.length; ix++) {
    const n = notas[ix];
    try {
      // Página separadora do anexo
      const sep = merged.addPage([A4_W, A4_H]);
      sep.drawRectangle({ x: 0, y: A4_H - 90, width: A4_W, height: 90, color: verde });
      sep.drawText(`ANEXO ${ix + 1}`, { x: 48, y: A4_H - 58, size: 26, font: fontBold, color: dourado });
      sep.drawText(`NOTA FISCAL N° ${texto(n.numero_nota ?? '—')}`, { x: 48, y: A4_H - 82, size: 12, font: fontBold, color: rgb(1, 1, 1) });
      const linhas = [
        n.fornecedor_nome ? `Fornecedor: ${texto(n.fornecedor_nome)}${n.fornecedor_cnpj ? ' - CNPJ ' + texto(n.fornecedor_cnpj) : ''}` : '',
        n.data_emissao ? `Emissao: ${dataBR(n.data_emissao)}` : '',
        n.valor_total != null ? `Valor total: ${brl(n.valor_total)}` : '',
        n.chave_acesso ? `Chave de acesso: ${texto(n.chave_acesso)}` : '',
        `Arquivo: ${texto(n.arquivo_nome)}`,
      ].filter(Boolean);
      linhas.forEach((l, i) => {
        sep.drawText(String(l), { x: 48, y: A4_H - 140 - i * 20, size: 10.5, font, color: rgb(0.15, 0.18, 0.16) });
      });
      if (n.arquivo_tipo === 'xml_nfe') {
        sep.drawText('Documento eletronico (XML NFe) arquivado no sistema; itens lancados', { x: 48, y: A4_H - 140 - linhas.length * 20 - 14, size: 9, font, color: rgb(0.4, 0.42, 0.4) });
        sep.drawText('automaticamente neste inventario a partir do arquivo original.', { x: 48, y: A4_H - 140 - linhas.length * 20 - 27, size: 9, font, color: rgb(0.4, 0.42, 0.4) });
        continue; // XML não tem forma visual — separadora basta
      }

      const buf = Buffer.from(String(n.arquivo_b64).replace(/^data:[^,]+,/, ''), 'base64');
      if (n.arquivo_tipo === 'pdf_danfe') {
        const anexoDoc = await PDFLib.load(buf);
        (await merged.copyPages(anexoDoc, anexoDoc.getPageIndices())).forEach(p => merged.addPage(p));
      } else {
        // imagem (foto da nota) — página A4 com aspecto preservado
        const mime = String(n.arquivo_mime ?? '').toLowerCase();
        const img = mime.includes('png') ? await merged.embedPng(buf) : await merged.embedJpg(buf);
        const margem = 30;
        const maxW = A4_W - 2 * margem, maxH = A4_H - 2 * margem;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const pg = merged.addPage([A4_W, A4_H]);
        pg.drawImage(img, {
          x: (A4_W - img.width * scale) / 2, y: (A4_H - img.height * scale) / 2,
          width: img.width * scale, height: img.height * scale,
        });
      }
    } catch (err) {
      console.warn(`[inventario-pdf] anexo ${ix + 1} (nota ${n.id}) pulado: ${(err as Error).message}`);
    }
  }

  return Buffer.from(await merged.save());
}
