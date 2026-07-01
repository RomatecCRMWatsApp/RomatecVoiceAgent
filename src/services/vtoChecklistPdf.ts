// src/services/vtoChecklistPdf.ts
// v3.78.0 — PDF do VTO Checklist. Reproduz o protótipo aprovado
// (vto_checklist_atividades_prototipo.html) como HTML estático e converte via
// o motor HTML→PDF do projeto (src/pdf/htmlToPdf — puppeteer, A4, printBackground).
import { htmlToPdf } from '../pdf/htmlToPdf';
import { calcularPercentual } from './vtoChecklistCalc';
import type { VtoChecklist, VtoChecklistItem, PercentualResultado, VtoStatus } from '../types/vtoChecklist';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}

function fmtData(d?: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return esc(d);
  return `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
}

/** Qual das caixas (I / EA / C) fica marcada para o status. */
function boxes(status: VtoStatus): { I: boolean; EA: boolean; C: boolean } {
  return {
    I: status === 'iniciado',
    EA: status === 'em_andamento',
    C: status === 'concluido',
  };
}

function celulaTexto(v?: string | number | null): string {
  const t = v == null || v === '' ? '' : esc(v);
  return t ? `<span class="ativ">${t}</span>` : '<div class="wl"></div>';
}

function linhaItem(it: VtoChecklistItem): string {
  const b = boxes(it.status);
  const box = (on: boolean, lbl: string) =>
    `<span class="cell"><span class="b${on ? ' on' : ''}"></span><span>${lbl}</span></span>`;
  const m2 = it.metros_quadrados == null ? '' : Number(it.metros_quadrados).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `
    <tr>
      <td class="ativ">${esc(it.atividade)}</td>
      <td class="cell-write">${celulaTexto(it.comodo_local)}</td>
      <td class="cell-write">${celulaTexto(m2)}</td>
      <td class="status-cell"><div class="tri">${box(b.I, 'I')}${box(b.EA, 'EA')}${box(b.C, 'C')}</div></td>
      <td class="cell-write">${celulaTexto(it.observacao)}</td>
    </tr>`;
}

function secaoDisciplina(ordem: number, nome: string, itens: VtoChecklistItem[], pct: number): string {
  const rows = itens
    .slice()
    .sort((a, b) => a.atividade_ordem - b.atividade_ordem)
    .map(linhaItem)
    .join('');
  return `
    <div class="disc">
      <div class="disc-head">
        <span class="n">${String(ordem).padStart(2, '0')}</span>
        <h3>${esc(nome)}</h3>
        <span class="pct">${Math.round(pct)}%</span>
      </div>
      <table>
        <thead>
          <tr>
            <th class="col-ativ">Atividade</th>
            <th class="col-local">Cômodo / Local</th>
            <th class="col-m2">m² concl.</th>
            <th class="col-status" style="text-align:center;">Status</th>
            <th class="col-obs">Observação</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function blocoTexto(valor?: string | null, minH = 60): string {
  const t = (valor ?? '').trim();
  if (t) return `<div class="filled" style="min-height:${minH}px">${esc(t).replace(/\n/g, '<br>')}</div>`;
  return `<div class="ruled" style="height:${minH}px"></div>`;
}

/** HTML estático (server-side) fiel ao protótipo aprovado. */
export function renderChecklistHtml(doc: VtoChecklist, percent: PercentualResultado): string {
  // Agrupa os itens por disciplina, preservando a ordem.
  const grupos = new Map<number, { nome: string; itens: VtoChecklistItem[] }>();
  for (const it of doc.itens || []) {
    if (!grupos.has(it.disciplina_ordem)) grupos.set(it.disciplina_ordem, { nome: it.disciplina_nome, itens: [] });
    grupos.get(it.disciplina_ordem)!.itens.push(it);
  }
  const ordens = [...grupos.keys()].sort((a, b) => a - b);
  const disciplinasHtml = ordens
    .map((o) => secaoDisciplina(o, grupos.get(o)!.nome, grupos.get(o)!.itens, percent.porDisciplina[o] ?? 0))
    .join('');

  const geral = percent.geral;
  const hashCurto = doc.hash_validacao ? esc(doc.hash_validacao.slice(0, 12)) : '';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>VTO — Checklist de Atividades | Romatec</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--green:#0C3320;--green-2:#14472B;--gold:#C9A84C;--gold-soft:#E3D19A;--paper:#FBFAF6;--ink:#1C1C18;--muted:#6A6656;--line:#D8D3C4;--line-strong:#B9B39F;--write:#B4AE99;}
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{background:#fff;color:var(--ink);font-family:'Inter',system-ui,sans-serif;font-size:12px;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .sheet{background:var(--paper);padding:0;}
  .head{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;border-bottom:3px solid var(--green);padding-bottom:10px;}
  .mark{width:46px;height:46px;border-radius:10px;background:linear-gradient(140deg,var(--gold) 0%,#B4913A 100%);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);}
  .mark svg{width:26px;height:26px;}
  .brand h1{font-family:'Playfair Display',serif;font-weight:800;font-size:20px;letter-spacing:.06em;color:var(--green);margin:0;line-height:1;}
  .brand p{margin:3px 0 0;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);}
  .doc-tag{text-align:right;}
  .doc-tag .badge{display:inline-block;background:var(--green);color:#fff;font-weight:700;font-size:11px;letter-spacing:.12em;padding:5px 12px;border-radius:5px;}
  .doc-tag small{display:block;margin-top:5px;color:var(--muted);font-size:9.5px;letter-spacing:.08em;}
  .doc-title{font-family:'Playfair Display',serif;font-weight:700;font-size:15px;color:var(--green-2);margin:12px 0 2px;letter-spacing:.01em;}
  .doc-sub{font-size:10px;color:var(--muted);margin:0 0 12px;letter-spacing:.03em;}
  .ident{display:grid;grid-template-columns:repeat(12,1fr);gap:8px 14px;margin-bottom:14px;}
  .fld{grid-column:span 6;}.fld.c3{grid-column:span 3;}.fld.c4{grid-column:span 4;}.fld.c8{grid-column:span 8;}.fld.c12{grid-column:span 12;}
  .fld label{display:block;font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--green);margin-bottom:1px;}
  .fld .val{min-height:18px;border-bottom:1px solid var(--write);font-size:12px;color:var(--ink);padding:2px 1px;}
  .legend{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;background:#F1EEE3;border:1px solid var(--line);border-left:4px solid var(--gold);padding:7px 12px;border-radius:4px;margin-bottom:12px;font-size:10px;}
  .legend b{color:var(--green);letter-spacing:.06em;font-size:9.5px;text-transform:uppercase;}
  .legend .lg{display:inline-flex;align-items:center;gap:5px;}
  .legend .box{width:13px;height:13px;border:1.6px solid var(--green);border-radius:3px;display:inline-block;}
  .legend .box.a{border-color:#B4913A;background:repeating-linear-gradient(45deg,transparent,transparent 2px,var(--gold-soft) 2px,var(--gold-soft) 4px);}
  .legend .box.c{background:var(--green);}
  .disc{margin-bottom:10px;break-inside:avoid;}
  .disc-head{display:flex;align-items:center;gap:10px;background:var(--green);color:#fff;padding:6px 10px;border-radius:5px 5px 0 0;}
  .disc-head .n{font-family:'Playfair Display',serif;font-weight:700;font-size:14px;color:var(--gold);min-width:26px;text-align:center;border-right:1px solid rgba(255,255,255,.25);padding-right:8px;line-height:1;}
  .disc-head h3{margin:0;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
  .disc-head .pct{margin-left:auto;background:var(--gold);color:var(--green);font-weight:700;font-size:11px;letter-spacing:.02em;padding:2px 9px;border-radius:20px;min-width:44px;text-align:center;}
  .progress{display:flex;align-items:center;gap:12px;background:var(--green);color:#fff;border-radius:5px;padding:8px 14px;margin-bottom:12px;}
  .progress .lbl{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-soft);white-space:nowrap;}
  .progress .bar{flex:1;height:12px;background:rgba(255,255,255,.15);border-radius:8px;overflow:hidden;}
  .progress .bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),#E3D19A);}
  .progress .val{font-family:'Playfair Display',serif;font-weight:800;font-size:18px;color:var(--gold);min-width:52px;text-align:right;}
  table{width:100%;border-collapse:collapse;}
  thead th{background:#EDEADE;color:var(--green);font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 6px;border:1px solid var(--line);text-align:left;}
  .col-ativ{width:34%;}.col-local{width:16%;}.col-m2{width:9%;}.col-status{width:16%;}.col-obs{width:25%;}
  tbody td{border:1px solid var(--line);padding:2px 6px;height:30px;vertical-align:middle;}
  tbody tr:nth-child(even) td{background:#FCFBF7;}
  tbody tr:nth-child(odd) td{background:#F7F5EC;}
  .ativ{font-size:11px;font-weight:500;color:var(--ink);}
  .cell-write .wl{border-bottom:1px dotted var(--write);height:16px;}
  .status-cell{padding:0 4px;}
  .tri{display:flex;gap:8px;justify-content:center;align-items:center;}
  .tri .cell{display:flex;flex-direction:column;align-items:center;gap:2px;}
  .tri .cell span:last-child{font-size:7px;font-weight:700;letter-spacing:.04em;color:var(--muted);text-transform:uppercase;}
  .tri .b{width:15px;height:15px;border:1.6px solid var(--line-strong);border-radius:3px;background:var(--paper);position:relative;display:inline-block;}
  .tri .b.on{border-color:var(--green);background:var(--green);}
  .tri .b.on::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg);}
  .obs-block{margin-top:16px;break-inside:avoid;}
  .obs-block h3{font-family:'Playfair Display',serif;font-weight:700;font-size:13px;color:var(--green-2);margin:0 0 6px;padding-bottom:4px;border-bottom:2px solid var(--gold);letter-spacing:.02em;}
  .ruled{border:1px solid var(--line);border-radius:4px;background:repeating-linear-gradient(transparent,transparent 27px,var(--line) 27px,var(--line) 28px);background-position:0 8px;}
  .filled{border:1px solid var(--line);border-radius:4px;padding:8px 10px;font-size:11px;color:var(--ink);white-space:pre-wrap;}
  .sign{display:grid;grid-template-columns:1.4fr 1fr;gap:26px;margin-top:22px;break-inside:avoid;}
  .sign .line{border-top:1px solid var(--line-strong);padding-top:5px;text-align:center;}
  .sign .line .who{font-weight:700;font-size:11px;color:var(--green);}
  .sign .line .role{font-size:9px;color:var(--muted);line-height:1.5;margin-top:2px;}
  .sign .art{font-size:9px;color:var(--muted);}
  .sign .art .lane{border-bottom:1px solid var(--write);min-height:16px;margin:2px 0 8px;padding:2px 1px;font-size:11px;color:var(--ink);}
  .footer{margin-top:16px;padding-top:8px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:8px;color:var(--muted);letter-spacing:.04em;}
  @page{size:A4;margin:9mm;}
  thead{display:table-header-group;}
  .disc,.obs-block,.sign,tr{break-inside:avoid;}
</style></head>
<body><div class="sheet">
  <div class="head">
    <div class="mark"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2L21 20H15.4L12 12.6L8.6 20H3L12 2ZM12 8.2L10.2 12H13.8L12 8.2Z" fill="#0C3320"/></svg></div>
    <div class="brand"><h1>ROMATEC</h1><p>Consultoria Total · Engenharia &amp; Agrimensura</p></div>
    <div class="doc-tag"><span class="badge">VTO</span><small>Vistoria Técnica de Obra</small></div>
  </div>
  <div class="doc-title">Checklist de Atividades da Obra</div>
  <p class="doc-sub">Acompanhamento de execução por disciplina — ABNT NBR 12722 / NBR 6118 / NBR 8160 — Módulo Gestão de Obra</p>

  <div class="ident">
    <div class="fld c8"><label>Obra / Empreendimento</label><div class="val">${esc(doc.obra_nome)}</div></div>
    <div class="fld c4"><label>Nº VTO</label><div class="val">${esc(doc.numero_vto)}</div></div>
    <div class="fld c6"><label>Cliente / Contratante</label><div class="val">${esc(doc.cliente)}</div></div>
    <div class="fld c6"><label>Endereço da Obra</label><div class="val">${esc(doc.endereco)}</div></div>
    <div class="fld c4"><label>Cidade / UF</label><div class="val">${esc(doc.cidade_uf)}</div></div>
    <div class="fld c4"><label>Data da Vistoria</label><div class="val">${fmtData(doc.data_vistoria)}</div></div>
    <div class="fld c4"><label>Etapa / % Físico Estimado</label><div class="val">${esc(doc.etapa)}</div></div>
    <div class="fld c8"><label>Responsável Técnico</label><div class="val">${esc(doc.responsavel_tecnico || 'José Romário Pinto Bezerra — Téc. Edificações / Agrimensura')}</div></div>
    <div class="fld c4"><label>ART / TRT nº</label><div class="val">${esc(doc.art_trt)}</div></div>
  </div>

  <div class="legend">
    <b>Status:</b>
    <span class="lg"><span class="box"></span> I — Iniciado</span>
    <span class="lg"><span class="box a"></span> EA — Em andamento</span>
    <span class="lg"><span class="box c"></span> C — Concluído</span>
  </div>

  <div class="progress">
    <span class="lbl">Avanço Físico Geral · automático</span>
    <span class="bar"><i style="width:${geral}%"></i></span>
    <span class="val">${Math.round(geral)}%</span>
  </div>

  ${disciplinasHtml || '<p class="doc-sub">Nenhuma atividade registrada nesta vistoria.</p>'}

  <div class="obs-block">
    <h3>Observações Gerais da Vistoria</h3>
    ${blocoTexto(doc.observacoes_gerais, 90)}
  </div>

  <div class="sign">
    <div>
      <div class="art">Pendências / providências solicitadas ao contratante:</div>
      <div class="art"><div class="lane">${esc(doc.pendencias)}</div></div>
      <div class="art">Próxima vistoria prevista para: <div class="lane">${esc(doc.proxima_vistoria)}</div></div>
    </div>
    <div class="line">
      <div style="height:34px"></div>
      <div class="who">José Romário Pinto Bezerra</div>
      <div class="role">Técnico em Edificações · Técnico em Agrimensura<br>CFT/MA 01209185369 · INCRA FQNS<br>Romatec Consultoria Total — Açailândia/MA</div>
    </div>
  </div>

  <div class="footer">
    <span>Romatec Consultoria Total · J R P Bezerra Ltda · CNPJ 17.261.987/0001-09${hashCurto ? ` · Validação /v/${hashCurto}…` : ''}</span>
    <span>Documento gerado pelo Sistema ZAYRA — Gestão de Obra</span>
  </div>
</div></body></html>`;
}

/** Renderiza o HTML e converte para PDF (A4). Se `percent` não vier, recalcula. */
export async function gerarChecklistPdf(doc: VtoChecklist, percent?: PercentualResultado): Promise<Buffer> {
  const pct = percent ?? calcularPercentual(doc.itens || []);
  const html = renderChecklistHtml(doc, pct);
  return htmlToPdf(html);
}
