// v3.195.0 — Prancha A1 (841 × 594 mm, paisagem) do PA para impressão e apresentação aos associados:
//   • planta geral com todas as parcelas numeradas (LT-NN), perímetro, APP, estradas e córregos;
//   • quadro dos lotes: lote de produção · associado(a) · lote da vila (sem áreas);
//   • mapa de situação em imagem de satélite; mapa da vila; legenda com a área total; carimbo técnico.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PaErro } from './erros';
import { pool, rows } from './paDb';
import { buscarProjeto } from './paRepo';
import { buscarSubdivisao, buscarPerimetro, vinculosParcelas, dadosCabecalho, geojsonSubdivisao, buscarDivisa } from './paMapas';
import { svgLayoutPA, type LoteDoMapa } from './mapaSvg';
import { desenhoDoProjeto } from './layoutDesenho';
import { htmlMapaLotes, type BaseMapa, type RotuloLote } from './mapaTiles';
import { alqueiresTxt } from './unidades';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const fm = (v: number, d = 4) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const numLote = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });
function arte(nome: string, mime: string): string {
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? `data:${mime};base64,${readFileSync(f).toString('base64')}` : '';
}

export type SituacaoLote = 'ENTREGUE' | 'ENVIADO' | 'MEDIDO' | 'A_MEDIR' | 'BLOQUEADO';
export interface LinhaQuadro { lote: string; associado: string | null; lote_vila: string | null; situacao: SituacaoLote }
export const COR_SITUACAO: Record<SituacaoLote, { cor: string; rotulo: string }> = {
  ENTREGUE: { cor: '#1E9E4A', rotulo: 'Dossiê entregue' }, ENVIADO: { cor: '#3D7FC1', rotulo: 'Dossiê enviado' },
  MEDIDO: { cor: '#3D7FC1', rotulo: 'Medido' }, A_MEDIR: { cor: '#FFFFFF', rotulo: 'A medir' }, // v3.196.3: medido também em azul (pedido do CEO)
  BLOQUEADO: { cor: '#111111', rotulo: 'Bloqueado' }, // v3.196.4: lote bloqueado (preto)
};
/** Quadro dos lotes (pura — testável): todas as parcelas, ordenadas pelo nº do lote de produção, com a situação do dossiê. */
export function quadroLotes(parcelas: string[], vinc: Record<string, { nome: string; lote_vila: string }>, sit: Record<string, SituacaoLote> = {}): LinhaQuadro[] {
  return [...parcelas].sort(numLote).map((lt) => ({ lote: lt, associado: vinc[lt]?.nome ?? null, lote_vila: vinc[lt]?.lote_vila ?? null, situacao: sit[lt] ?? 'A_MEDIR' }));
}

export function htmlPrancha(o: {
  projeto: string; municipio: string; associacao: string | null; rt: { nome: string; registro: string }; data: string;
  geral: string; vila: string; divisa: string; quadro: LinhaQuadro[]; area_ha: number | null; perimetro_m: number | null; lotes: number; fuso: number; hem: string;
  municipios?: Array<{ nome: string; cor: string }>;
}): string {
  const logo = arte('logo_romatec.jpg', 'image/jpeg'), bras = arte('brasao_salete_moreno.png', 'image/png');
  const n = (k: SituacaoLote) => o.quadro.filter((x) => x.situacao === k).length;
  const tagS = (k: SituacaoLote) => k === 'BLOQUEADO' ? '<span class="tg bl">BLOQUEADO</span>' : k === 'ENTREGUE' ? '<span class="tg en">✓ ENTREGUE</span>' : k === 'ENVIADO' ? '<span class="tg ev">ENVIADO</span>' : k === 'MEDIDO' ? '<span class="tg me">medido</span>' : '';
  const tab = `<table><thead><tr><th>Lote prod.</th><th>Associado(a)</th><th>Lote vila</th><th>Dossiê</th></tr></thead><tbody>${o.quadro.map((x) => `<tr class="${x.situacao === 'ENTREGUE' ? 'okv' : x.situacao === 'BLOQUEADO' ? 'blq' : ''}"><td class="lt">LT-${esc(x.lote)}</td><td>${esc(x.associado ?? '—')}</td><td class="c">${esc(x.lote_vila ?? '—')}</td><td class="c">${tagS(x.situacao)}</td></tr>`).join('')}</tbody></table>`;
  const leg = (cor: string, txt: string, tipo: 'area' | 'linha' | 'tracejado' = 'area') => `<div class="lg"><i class="${tipo}" style="${tipo === 'area' ? `background:${cor}` : `border-color:${cor}`}"></i>${txt}</div>`;
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Planta geral — ${esc(o.projeto)}</title><style>
    @page{size:841mm 594mm;margin:0}*{box-sizing:border-box}
    html,body{margin:0;width:841mm;height:594mm;font-family:'Liberation Sans',Arial,sans-serif;color:#1C1C18;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .folha{position:absolute;inset:8mm;border:1.6mm solid #0C3320;outline:.5mm solid #C9A84C;outline-offset:-3.2mm;display:grid;grid-template-columns:150mm 1fr 178mm;gap:6mm;padding:7mm}
    .col{display:flex;flex-direction:column;gap:5mm;min-height:0;min-width:0}
    .tit{display:flex;align-items:center;gap:5mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:3mm;padding:4mm 6mm;border-bottom:1.6mm solid #C9A84C}
    .tit img{height:22mm;background:#fff;border-radius:2mm;padding:1mm}.tit h1{margin:0;font-size:26pt;letter-spacing:.5px}.tit p{margin:1.5mm 0 0;color:#E3D19A;font-size:12.5pt}
    .tit .br{margin-left:auto;height:28mm;background:none;padding:0}
    .box{border:.5mm solid #C9C2AE;border-radius:2.5mm;background:#fff;overflow:hidden;position:relative}
    .box h2{margin:0;background:#0C3320;color:#fff;font-size:12pt;padding:2.2mm 4mm;letter-spacing:.4px}
    .geral{flex:1;display:flex;align-items:center;justify-content:center;background:#DDE3D5}
    table{width:100%;border-collapse:collapse;font-size:9.4pt}th{background:#14472B;color:#fff;font-size:8.4pt;padding:1.5mm 1.8mm;text-align:left}
    td{padding:1.15mm 1.8mm;border-bottom:.3mm solid #E5DFCD}tr:nth-child(even) td{background:#FAF7EE}td.lt{font-weight:800;color:#0C3320;white-space:nowrap}td.c{text-align:center;font-weight:700;white-space:nowrap}
    tr.okv td{background:#DDF3E3 !important}tr.okv td.lt{color:#0E6B2E}
    .tg{display:inline-block;border-radius:1.5mm;padding:.3mm 1.6mm;font-size:7.4pt;font-weight:800}.tg.en{background:#1E9E4A;color:#fff}.tg.ev{background:#3D7FC1;color:#fff}.tg.me{background:#3D7FC1;color:#fff}.tg.bl{background:#111;color:#fff}tr.blq td{background:#E6E6E6 !important}tr.blq td.lt{color:#111}
    .quadro{flex:1}.res{display:flex;gap:2mm;padding:2.5mm 3mm;font-size:9.4pt;flex-wrap:wrap;border-bottom:.3mm solid #E5DFCD}.res b{color:#0C3320}
    .mini{height:150mm;display:flex;align-items:center;justify-content:center;background:#F4F1E6}.mini svg{width:100%;height:100%}
    .legs{padding:3mm 4mm;font-size:10pt;display:grid;grid-template-columns:1fr 1fr;gap:1.8mm 4mm}
    .lg{display:flex;align-items:center;gap:2.5mm}.lg i{flex:0 0 auto;width:9mm;height:5mm;border:.35mm solid #0C3320;border-radius:.8mm}
    .lg i.linha{height:0;border:0;border-top:1mm solid}.lg i.tracejado{height:0;border:0;border-top:1mm dashed}
    .areas{margin:0 4mm 3mm;border:.5mm solid #C9A84C;border-radius:2mm;background:#FFF8E6;padding:3mm 4mm;font-size:11pt}.areas b{font-size:15pt;color:#0C3320}
    .car{margin-top:auto;border:.6mm solid #0C3320;border-radius:2.5mm;overflow:hidden;font-size:9.2pt}
    .car .l1{display:flex;align-items:center;gap:4mm;padding:2.5mm 4mm;border-bottom:.4mm solid #0C3320}.car .l1 img{height:14mm}
    .car .l1 b{font-size:12pt;color:#0C3320}.car .g{display:grid;grid-template-columns:1fr 1fr}.car .g div{padding:1.6mm 3mm;border-right:.3mm solid #C9C2AE;border-bottom:.3mm solid #C9C2AE}
    .car .g span{display:block;font-size:7pt;color:#6A6656;text-transform:uppercase;font-weight:700;letter-spacing:.3px}
    .ass{padding:5mm 4mm 2.5mm;text-align:center}.ass div{border-top:.35mm solid #333;width:70%;margin:0 auto 1mm;padding-top:1mm}
  </style></head><body><div class="folha">
    <div class="col">
      <div class="box quadro"><h2>LOTES DE PRODUÇÃO — ${o.quadro.length}</h2>
        <div class="res"><span><b>${n('ENTREGUE')}</b> entregues</span>·<span><b>${n('ENVIADO')}</b> enviados</span>·<span><b>${n('MEDIDO')}</b> medidos</span>·<span><b>${n('A_MEDIR')}</b> a medir</span>${n('BLOQUEADO') ? `·<span><b>${n('BLOQUEADO')}</b> bloqueados</span>` : ''}</div>${tab}</div>
    </div>
    <div class="col">
      <div class="tit">${logo ? `<img src="${logo}">` : ''}<div><h1>PLANTA GERAL — ${esc(o.projeto.toUpperCase())}</h1><p>Parcelamento em lotes de produção · ${esc(o.municipio)}${o.associacao ? ' · ' + esc(o.associacao) : ''}</p></div>${bras ? `<img class="br" src="${bras}">` : ''}</div>
      <div class="box geral">${o.geral}</div>
    </div>
    <div class="col">
      <div class="box"><h2>VILA (NÚCLEO URBANO)</h2><div class="mini">${o.vila || '<span style="color:#888">Croqui da vila não cadastrado</span>'}</div></div>
      <div class="box"><h2>DIVISA MUNICIPAL</h2><div class="mini">${o.divisa || '<span style="color:#888">Divisa municipal não cadastrada</span>'}</div>
        ${o.municipios?.length ? `<div class="legs" style="padding:2mm 4mm">${o.municipios.map((m) => leg(m.cor, esc(m.nome))).join('')}${leg('#C62828', 'Divisa municipal', 'tracejado')}</div>` : ''}</div>
      <div class="box"><h2>LEGENDA</h2><div class="legs">
        ${leg(COR_SITUACAO.ENTREGUE.cor, 'Dossiê entregue')}${leg(COR_SITUACAO.ENVIADO.cor, 'Medido / dossiê enviado')}
        ${leg('#FFFFFF', 'Lote a medir')}${leg(COR_SITUACAO.BLOQUEADO.cor, 'Lote bloqueado')}
        ${leg('#0C3320', 'Perímetro do PA', 'tracejado')}${leg('#B3261E', 'Área da vila', 'tracejado')}
        ${leg('#8C5A2B', 'Estrada', 'linha')}${leg('#2B6CB0', 'Córrego', 'linha')}
      </div>
      <div class="areas">Área total do PA: <b>${o.area_ha != null ? `${fm(o.area_ha)} ha` : '—'}</b>${o.area_ha != null ? ` <span style="color:#555">(${esc(alqueiresTxt(o.area_ha))})</span>` : ''}<br>${o.lotes} lotes de produção${o.perimetro_m != null ? ` · perímetro ${fm(o.perimetro_m, 2)} m` : ''}</div></div>
      <div class="car">
        <div class="l1">${logo ? `<img src="${logo}">` : ''}<div><b>ROMATEC CONSULTORIA TOTAL</b><br>J R P BEZERRA LTDA · CNPJ 17.261.987/0001-09<br>Açailândia/MA · (99) 99181-1246</div></div>
        <div class="g"><div><span>Projeto</span>${esc(o.projeto)}</div><div><span>Município</span>${esc(o.municipio)}</div>
          <div><span>Sistema</span>SIRGAS 2000 · UTM ${o.fuso}${esc(o.hem)}</div><div><span>Norma</span>ABNT NBR 13133 · INCRA</div>
          <div><span>Folha</span>A1 · 01/01 · escala gráfica</div><div><span>Data</span>${esc(o.data)}</div></div>
        <div class="ass"><div>${esc(o.rt.nome)}</div>${esc(o.rt.registro)}</div>
      </div>
    </div>
  </div></body></html>`;
}

type Geo = { features: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> };
/** Situação de cada lote: dossiê entregue/enviado, medido em campo, a medir. */
export async function situacaoLotes(projetoId: number): Promise<Record<string, SituacaoLote>> {
  const out: Record<string, SituacaoLote> = {};
  for (const r of await rows(pool, 'SELECT lote FROM pa_campo_lotes WHERE projeto_id = ?', [projetoId]).catch(() => [])) out[String(r.lote)] = 'MEDIDO';
  for (const r of await rows(pool, "SELECT lote, status, vias_entregues_em FROM pa_dossies WHERE projeto_id = ? AND status IN ('ENVIADO','ENTREGUE')", [projetoId]).catch(() => [])) out[String(r.lote)] = String(r.status) === 'ENTREGUE' || r.vias_entregues_em ? 'ENTREGUE' : 'ENVIADO'; // v3.198.0: vias físicas confirmadas = entregue
  // v3.196.4: bloqueado pelo ADMIN (aba Campo) prevalece
  for (const r of await rows(pool, 'SELECT codigo FROM pa_lotes_producao WHERE projeto_id = ? AND bloqueado = 1', [projetoId]).catch(() => [])) out[String(r.codigo).replace(/^LT-/i, '')] = 'BLOQUEADO';
  return out;
}

export async function pdfPrancha(projetoId: number, base: BaseMapa = 'satelite'): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const sub = await buscarSubdivisao(projetoId);
  if (!sub?.parcelas.length) throw new PaErro('SEM_SUBDIVISAO', 'Envie a subdivisão dos lotes (DXF) antes de gerar a prancha', 409);
  const per = await buscarPerimetro(projetoId);
  const vinc = await vinculosParcelas(projetoId).catch(() => ({} as Awaited<ReturnType<typeof vinculosParcelas>>));
  const sit = await situacaoLotes(projetoId);
  const cab = dadosCabecalho(p);
  // mapa geral: o mesmo do sistema (imagem + contornos reais), lotes coloridos pela situação do dossiê
  const geo = (await geojsonSubdivisao(projetoId).catch(() => ({ features: [] }))) as unknown as Geo;
  const cores: Record<string, RotuloLote> = Object.fromEntries(sub.parcelas.map((pc) => {
    const k = sit[pc.lote] ?? 'A_MEDIR';
    return [pc.lote, { cor: COR_SITUACAO[k].cor, opac: k === 'A_MEDIR' ? 0.12 : k === 'BLOQUEADO' ? 0.78 : 0.55, rotulo: `LT-${pc.lote}${k === 'BLOQUEADO' ? ' · BLOQ.' : ''}`, destaque: k === 'ENTREGUE' || k === 'BLOQUEADO' }];
  }));
  const { html: geral } = await htmlMapaLotes(geo, cores, { base, W: 1740, H: 1660, margem: 0.02 });
  // divisa municipal: municípios coloridos + linha da divisa (mesmo desenho da aba Divisa)
  let divisa = '', municipios: Array<{ nome: string; cor: string }> = [];
  try {
    const d = await buscarDivisa(projetoId);
    if (d.divisa && d.geo) {
      const fs = (d.geo.features as unknown as Geo['features']).map((f) => f.properties.tipo === 'MUNICIPIO' ? { ...f, properties: { ...f.properties, tipo: 'LOTE', lote: String(f.properties.lote) } } : f.properties.tipo === 'LOTE_CTX' ? { ...f, properties: { ...f.properties, tipo: 'OUTRA' } } : f);
      const coresM: Record<string, RotuloLote> = Object.fromEntries(fs.filter((f) => f.properties.tipo === 'LOTE').map((f) => [String(f.properties.lote), { cor: String(f.properties.cor ?? '#ccc'), opac: 0.45, rotulo: String(f.properties.lote).includes('-') ? '' : String(f.properties.nome ?? '') }]));
      divisa = (await htmlMapaLotes({ features: fs }, coresM, { base: 'mapa', W: 650, H: 560, margem: 0.04 })).html;
      municipios = d.divisa.municipios.map((m) => ({ nome: String((m as { nome: string }).nome), cor: String((m as { cor: string }).cor) }));
    }
  } catch { /* sem divisa: quadro vazio */ }
  // vila (croqui do sistema)
  const lv = await rows(pool, 'SELECT numero, tipo, croqui_xy FROM pa_lotes WHERE projeto_id = ?', [projetoId]);
  const lotesVila: LoteDoMapa[] = lv.map((l) => ({ numero: String(l.numero), xy: (typeof l.croqui_xy === 'string' ? JSON.parse(l.croqui_xy) : l.croqui_xy) as number[][], institucional: l.tipo === 'INSTITUCIONAL' })).filter((l) => Array.isArray(l.xy));
  const vila = lotesVila.length ? svgLayoutPA({ lotes: lotesVila, desenho: desenhoDoProjeto(p.codigo, p.layout_json), destaque: null, css: 'width:100%;height:100%;display:block' }) : '';
  const html = htmlPrancha({
    projeto: p.nome, municipio: `${p.municipio}/${p.uf}`, associacao: p.associacao_nome, rt: cab.rt, data: cab.data,
    geral, vila, divisa, municipios, quadro: quadroLotes(sub.parcelas.map((pc) => pc.lote), vinc, sit), area_ha: per?.area_ha ?? null, perimetro_m: per?.perimetro_m ?? null,
    lotes: sub.parcelas.length, fuso: sub.fuso ?? 23, hem: sub.hemisferio ?? 'S',
  });
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  const pdf = await htmlToPdf(html, { width: '841mm', height: '594mm', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, preferCSSPageSize: true });
  return { pdf, nome: `Planta_Geral_A1_${p.codigo.split(/[-_\s]+/).map((w) => /^PA$/i.test(w) ? 'PA' : w.charAt(0) + w.slice(1).toLowerCase()).join('_')}.pdf` };
}
