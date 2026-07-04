// src/services/obrasEntregaPdf.ts
// v3.81.0 — PDF do "Relatório de Entrega de Obra" (RE). Tema dark green/gold
// Romatec, renderizado como HTML e convertido pelo motor htmlToPdf (puppeteer),
// mesmo pipeline do VTO Checklist. Fotos/NF vêm em base64 (LONGTEXT no banco).
import { htmlToPdf } from '../pdf/htmlToPdf';
import { montarBlocoAvatarHtml } from './colaborador-avatar-helpers';
import type { ObraEntrega, EntregaFoto, EntregaFotoTipo } from '../types/obrasEntrega';

// Paleta Romatec (mesma do VTO Checklist / reforma-piso).
const GREEN = '#0C3320';
const GREEN2 = '#14472B';
const GOLD = '#C9A84C';
const GOLD_SOFT = '#E3D19A';
const PAPER = '#FBFAF6';
const INK = '#1C1C18';
const MUTED = '#6A6656';
const LINE = '#D8D3C4';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}

function fmtData(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return esc(d);
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
}

function fmtDataHora(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return esc(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

function fmtBRL(v?: number | null): string {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte markdown mínimo (negrito, listas, parágrafos) em HTML seguro. */
function markdownLeve(md?: string | null): string {
  const t = (md ?? '').trim();
  if (!t) return `<p class="muted">Sem descrição de execução registrada.</p>`;
  const linhas = t.split(/\r?\n/);
  const out: string[] = [];
  let emLista = false;
  for (const raw of linhas) {
    const l = raw.trim();
    if (!l) { if (emLista) { out.push('</ul>'); emLista = false; } continue; }
    let html = esc(l).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    if (/^[-*]\s+/.test(l)) {
      if (!emLista) { out.push('<ul>'); emLista = true; }
      out.push(`<li>${html.replace(/^[-*]\s+/, '')}</li>`);
    } else if (/^#{1,3}\s+/.test(l)) {
      if (emLista) { out.push('</ul>'); emLista = false; }
      out.push(`<h4>${html.replace(/^#{1,3}\s+/, '')}</h4>`);
    } else {
      if (emLista) { out.push('</ul>'); emLista = false; }
      out.push(`<p>${html}</p>`);
    }
  }
  if (emLista) out.push('</ul>');
  return out.join('');
}

function fotosDoTipo(fotos: EntregaFoto[], tipo: EntregaFotoTipo): EntregaFoto[] {
  return (fotos || []).filter((f) => f.tipo === tipo);
}

function imgTag(f: EntregaFoto): string {
  return `<img class="foto" src="data:${esc(f.mime || 'image/jpeg')};base64,${f.data_base64}" alt="${esc(f.legenda || '')}" />`;
}

function blocoFoto(f: EntregaFoto): string {
  return `
    <figure class="fig">
      ${imgTag(f)}
      ${f.legenda ? `<figcaption>${esc(f.legenda)}</figcaption>` : ''}
    </figure>`;
}

function grade(fotos: EntregaFoto[]): string {
  if (!fotos.length) return '';
  return `<div class="grade">${fotos.map(blocoFoto).join('')}</div>`;
}

/** Seção "antes → depois" lado a lado, pareando por índice quando possível. */
function comparativoAntesDepois(antes: EntregaFoto[], depois: EntregaFoto[]): string {
  const n = Math.max(antes.length, depois.length);
  if (!n) return '';
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = antes[i];
    const d = depois[i];
    rows.push(`
      <div class="par">
        <div class="par-col">
          <span class="par-lbl">ANTES</span>
          ${a ? imgTag(a) : '<div class="par-vazio">—</div>'}
          ${a?.legenda ? `<small>${esc(a.legenda)}</small>` : ''}
        </div>
        <div class="par-seta">→</div>
        <div class="par-col">
          <span class="par-lbl gold">DEPOIS</span>
          ${d ? imgTag(d) : '<div class="par-vazio">—</div>'}
          ${d?.legenda ? `<small>${esc(d.legenda)}</small>` : ''}
        </div>
      </div>`);
  }
  return `<div class="pares">${rows.join('')}</div>`;
}

export function renderEntregaHtml(doc: ObraEntrega, opts?: { linkPublico?: string | null }): string {
  const antes = fotosDoTipo(doc.fotos || [], 'antes');
  const execucao = fotosDoTipo(doc.fotos || [], 'execucao');
  const depois = fotosDoTipo(doc.fotos || [], 'depois');
  const sobraFotos = fotosDoTipo(doc.fotos || [], 'sobra_material');
  const materiais = doc.materiais_sobra || [];

  const respNome = doc.responsavel_nome || 'José Romário Pinto Bezerra';
  const respCargo = doc.responsavel_cargo || 'Téc. Edificações / Agrimensura — Romatec';
  const avatar = montarBlocoAvatarHtml({
    nome: respNome,
    fotoBase64: doc.responsavel_foto_base64
      ? (doc.responsavel_foto_base64.startsWith('data:')
        ? doc.responsavel_foto_base64
        : `data:image/jpeg;base64,${doc.responsavel_foto_base64}`)
      : null,
    size: 72,
  });

  // Nota fiscal: embute se for imagem; se for PDF/outro, referencia como anexo.
  let nfBloco = '';
  if (doc.nota_fiscal_base64) {
    if ((doc.nota_fiscal_mime || '').startsWith('image/')) {
      nfBloco = `<img class="foto nf" src="data:${esc(doc.nota_fiscal_mime)};base64,${doc.nota_fiscal_base64}" alt="Nota Fiscal" />`;
    } else {
      nfBloco = `<div class="nf-doc">📎 Nota Fiscal anexada: <strong>${esc(doc.nota_fiscal_nome || 'nota-fiscal')}</strong> <span class="muted">(${esc(doc.nota_fiscal_mime || 'arquivo')})</span></div>`;
    }
  } else {
    nfBloco = `<div class="muted">Nenhuma nota fiscal anexada.</div>`;
  }

  const recebimento = doc.recebimento_confirmado_em
    ? `<div class="confirmado">✓ Recebimento confirmado pelo cliente em ${fmtDataHora(doc.recebimento_confirmado_em)}</div>`
    : '';

  const linhasMateriais = materiais.length
    ? materiais.map((m) => `
        <tr>
          <td>${esc(m.material)}</td>
          <td class="c">${m.quantidade == null ? '—' : Number(m.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="c">${esc(m.unidade || '—')}</td>
          <td>${esc(m.observacao || '')}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="muted c">Nenhum material de sobra registrado.</td></tr>`;

  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; color: ${INK}; background: ${PAPER}; font-size: 12px; }
  .page { padding: 28px 34px; }
  .muted { color: ${MUTED}; }
  .c { text-align: center; }

  /* Capa */
  .capa { background: linear-gradient(135deg, ${GREEN} 0%, ${GREEN2} 100%); color: #fff; padding: 46px 40px; }
  .capa .kicker { color: ${GOLD_SOFT}; letter-spacing: 3px; font-size: 11px; text-transform: uppercase; margin: 0 0 8px; }
  .capa h1 { margin: 0 0 6px; font-size: 30px; font-weight: 800; letter-spacing: .5px; }
  .capa .num { color: ${GOLD}; font-weight: 700; font-size: 15px; }
  .capa .meta { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 26px; }
  .capa .meta div { border-left: 3px solid ${GOLD}; padding-left: 10px; }
  .capa .meta span { display: block; font-size: 10px; color: ${GOLD_SOFT}; text-transform: uppercase; letter-spacing: 1px; }
  .capa .meta b { font-size: 14px; font-weight: 600; }
  .capa .selo { margin-top: 24px; display: inline-block; background: ${GOLD}; color: ${GREEN}; font-weight: 800; padding: 6px 16px; border-radius: 20px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; }

  h2 { color: ${GREEN}; font-size: 16px; margin: 26px 0 4px; padding-bottom: 6px; border-bottom: 2px solid ${GOLD}; }
  h2 .n { display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; background: ${GREEN}; color: ${GOLD}; border-radius: 6px; font-size: 12px; margin-right: 8px; }
  h4 { color: ${GREEN2}; margin: 10px 0 4px; font-size: 13px; }
  p { margin: 4px 0; line-height: 1.5; }
  ul { margin: 4px 0 4px 18px; padding: 0; } li { margin: 2px 0; line-height: 1.45; }

  .grade { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 10px; }
  .fig { margin: 0; }
  .foto { width: 100%; height: auto; border-radius: 8px; border: 1px solid ${LINE}; object-fit: cover; }
  figcaption { font-size: 10px; color: ${MUTED}; margin-top: 3px; }

  .pares { display: flex; flex-direction: column; gap: 12px; margin-top: 10px; }
  .par { display: grid; grid-template-columns: 1fr 24px 1fr; align-items: center; gap: 8px; background: #fff; border: 1px solid ${LINE}; border-radius: 10px; padding: 10px; }
  .par-col { display: flex; flex-direction: column; gap: 4px; }
  .par-col small { font-size: 10px; color: ${MUTED}; }
  .par-lbl { font-size: 10px; font-weight: 800; letter-spacing: 1px; color: ${MUTED}; }
  .par-lbl.gold { color: ${GOLD}; }
  .par-seta { text-align: center; font-size: 20px; color: ${GOLD}; font-weight: 800; }
  .par-vazio { background: #f0eee6; border: 1px dashed ${LINE}; border-radius: 8px; text-align: center; padding: 24px 0; color: ${MUTED}; }

  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  th { background: ${GREEN}; color: ${GOLD_SOFT}; text-align: left; padding: 7px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  td { padding: 7px 10px; border-bottom: 1px solid ${LINE}; }

  .valor-box { display: flex; justify-content: space-between; align-items: center; background: ${GREEN}; color: #fff; border-radius: 12px; padding: 18px 24px; margin-top: 12px; }
  .valor-box .lbl { color: ${GOLD_SOFT}; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  .valor-box .val { color: ${GOLD}; font-size: 26px; font-weight: 800; }
  .valor-box .orc { text-align: right; font-size: 11px; color: ${GOLD_SOFT}; }

  .nf { max-width: 60%; margin-top: 10px; }
  .nf-doc { margin-top: 10px; padding: 12px; background: #fff; border: 1px solid ${LINE}; border-radius: 8px; }

  .assinatura { margin-top: 34px; display: flex; align-items: center; gap: 16px; border-top: 2px solid ${GOLD}; padding-top: 18px; }
  .assinatura .quem b { display: block; font-size: 14px; color: ${GREEN}; }
  .assinatura .quem span { font-size: 11px; color: ${MUTED}; }

  .confirmado { margin-top: 14px; background: rgba(16,185,129,.12); border: 1px solid #10b981; color: #0f7a52; border-radius: 8px; padding: 10px 14px; font-weight: 600; }
  .rodape { margin-top: 26px; padding-top: 12px; border-top: 1px solid ${LINE}; font-size: 10px; color: ${MUTED}; display: flex; justify-content: space-between; }
  .link { color: ${GREEN2}; }
</style></head>
<body>
  <div class="capa">
    <p class="kicker">Romatec Consultoria Total</p>
    <h1>Relatório de Entrega de Obra</h1>
    <div class="num">${esc(doc.numero || `RE-${doc.id}`)}</div>
    <div class="meta">
      <div><span>Obra / Título</span><b>${esc(doc.titulo || '—')}</b></div>
      <div><span>Cliente</span><b>${esc(doc.cliente || '—')}</b></div>
      <div><span>Endereço</span><b>${esc(doc.endereco_obra || '—')}</b></div>
      <div><span>Cidade/UF</span><b>${esc(doc.cidade_uf || '—')}</b></div>
      <div><span>Data de execução</span><b>${fmtData(doc.data_execucao)}</b></div>
      <div><span>Data de entrega</span><b>${fmtDataHora(doc.data_entrega)}</b></div>
    </div>
    <div class="selo">${esc((doc.status || 'rascunho').replace('_', ' '))}</div>
  </div>

  <div class="page">
    <h2><span class="n">1</span>Resumo da proposta original</h2>
    ${doc.resumo_proposta ? `<p>${esc(doc.resumo_proposta).replace(/\n/g, '<br>')}</p>` : '<p class="muted">Sem resumo da proposta.</p>'}
    ${antes.length ? `<h4>Situação inicial (antes)</h4>${grade(antes)}` : ''}

    <h2><span class="n">2</span>Execução dos serviços</h2>
    ${markdownLeve(doc.descricao_execucao)}
    ${execucao.length ? `<h4>Registro de execução</h4>${grade(execucao)}` : ''}
    ${antes.length && depois.length ? `<h4>Comparativo antes → depois</h4>${comparativoAntesDepois(antes, depois)}` : (depois.length ? `<h4>Resultado final (depois)</h4>${grade(depois)}` : '')}

    <h2><span class="n">3</span>Materiais que sobraram</h2>
    <table>
      <thead><tr><th>Material</th><th class="c">Qtd.</th><th class="c">Un.</th><th>Observação</th></tr></thead>
      <tbody>${linhasMateriais}</tbody>
    </table>
    ${sobraFotos.length ? grade(sobraFotos) : ''}

    <h2><span class="n">4</span>Valor a receber &amp; Nota Fiscal</h2>
    <div class="valor-box">
      <div><div class="lbl">Valor a receber</div><div class="val">${fmtBRL(doc.valor_receber)}</div></div>
      <div class="orc">Orçado na proposta<br><b>${fmtBRL(doc.valor_orcado)}</b></div>
    </div>
    ${nfBloco}

    <div class="assinatura">
      ${avatar}
      <div class="quem">
        <b>${esc(respNome)}</b>
        <span>${esc(respCargo)}</span>
        <span>Responsável pela execução e entrega</span>
      </div>
    </div>
    ${recebimento}

    <div class="rodape">
      <span>Romatec Consultoria Total — Açailândia/MA</span>
      ${opts?.linkPublico ? `<span class="link">Validação: ${esc(opts.linkPublico)}</span>` : ''}
    </div>
  </div>
</body></html>`;
}

export async function gerarEntregaPdf(doc: ObraEntrega, opts?: { linkPublico?: string | null }): Promise<Buffer> {
  const html = renderEntregaHtml(doc, opts);
  return htmlToPdf(html);
}
