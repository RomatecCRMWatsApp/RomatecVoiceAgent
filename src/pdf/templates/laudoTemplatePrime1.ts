// v3.x — Template Prime I (Dark Premium verde/dourado) para Laudos de Demarcacao.
// Cabecalho institucional com barra gradiente verde, numero em badge dourado,
// tabelas de vertices/lados, box de area, croqui, responsabilidade tecnica,
// assinatura e bloco de validacao (QR + hash + url).
// buildHtml e' PURO (recebe o QR ja gerado); gerar*Pdf cria QR + renderiza.

import type { PDFOptions } from 'puppeteer';
import { LaudoDados } from '../../types/templateTypes';
import { htmlToPdf } from '../htmlToPdf';
import {
  CORES,
  FONTS_PRIME1,
  escapeHtml,
  gerarQrCodeBase64,
  blocoAssinaturaHtml,
} from '../sharedHtml';

// FOOTER FIX — header/footer nativo do puppeteer, margem lateral 0 (o body tem
// padding proprio de 12mm), margem inferior 18mm pra nao sobrepor o conteudo.
const OPCOES_FOOTER_PRIME1: Partial<PDFOptions> = {
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  margin: { top: '0', right: '0', bottom: '18mm', left: '0' },
  preferCSSPageSize: false,
  footerTemplate:
    '<div style="width:100%;font-size:7pt;font-family:Arial,sans-serif;color:#555;' +
    'display:flex;justify-content:space-between;align-items:center;padding:0 12mm;' +
    'border-top:1px solid #ccc;">' +
    '<span>Romatec Consultoria Total · CFT/MA 01209185369 · CNAI 031161 · CRECI/MA 4.705</span>' +
    '<span>Pág. <span class="pageNumber"></span> de <span class="totalPages"></span></span>' +
    '</div>',
};

function linhaVertice(v: LaudoDados['vertices'][number]): string {
  return `<tr>
    <td>${escapeHtml(v.rotulo)}</td>
    <td>${v.tipoMarco ? escapeHtml(v.tipoMarco) : '—'}</td>
    <td class="mono">${escapeHtml(v.utmE)}</td>
    <td class="mono">${escapeHtml(v.utmN)}</td>
    <td class="mono">${v.lat ? escapeHtml(v.lat) : '—'}</td>
    <td class="mono">${v.long ? escapeHtml(v.long) : '—'}</td>
  </tr>`;
}

function linhaLado(l: LaudoDados['lados'][number]): string {
  return `<tr>
    <td>${escapeHtml(l.lado)}</td>
    <td class="mono">${escapeHtml(l.azimute)}</td>
    <td class="mono">${escapeHtml(l.distancia)}</td>
  </tr>`;
}

function croquiHtml(dados: LaudoDados): string {
  if (dados.croquiSvg) {
    return `<div class="croqui-wrap">${dados.croquiSvg}</div>`;
  }
  if (dados.croquiImgBase64) {
    return `<div class="croqui-wrap"><img class="croqui-img" src="${escapeHtml(dados.croquiImgBase64)}" alt="Croqui da poligonal"/></div>`;
  }
  return `<div class="croqui-wrap croqui-vazio">(croqui não disponível)</div>`;
}

export function buildLaudoPrime1Html(dados: LaudoDados, qrDataUrl: string): string {
  const vertices = dados.vertices.map(linhaVertice).join('');
  const lados = dados.lados.map(linhaLado).join('');
  const cred = dados.tecnico.credenciais.map((c) => escapeHtml(c)).join(' · ');

  const linhasImovel: Array<[string, string | undefined]> = [
    ['Denominação', dados.imovel.denominacao],
    ['Matrícula', dados.imovel.matricula],
    ['Município', dados.imovel.municipio],
    ['UF', dados.imovel.uf],
    ['Localização', dados.imovel.localizacao],
  ];
  const imovelKv = linhasImovel
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v!)}</span></div>`,
    )
    .join('');

  const contatoCliente = [dados.contratante.telefone, dados.contratante.email]
    .filter(Boolean)
    .map((c) => escapeHtml(c!))
    .join(' · ');

  const rt =
    dados.art || dados.trt
      ? `<div class="rt-box">
           ${dados.art ? `<div class="rt-item"><span class="k">ART</span><span class="v">${escapeHtml(dados.art)}</span></div>` : ''}
           ${dados.trt ? `<div class="rt-item"><span class="k">TRT</span><span class="v">${escapeHtml(dados.trt)}</span></div>` : ''}
         </div>`
      : `<p class="texto">Responsabilidade técnica do profissional habilitado abaixo identificado, na forma da legislação aplicável.</p>`;

  const areaExtra = [dados.area.ha, dados.area.alqueires, dados.area.perimetro ? `Perímetro: ${dados.area.perimetro}` : undefined]
    .filter(Boolean)
    .map((s) => escapeHtml(s!))
    .join(' &nbsp;·&nbsp; ');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
${FONTS_PRIME1}
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#ffffff; color:#1c1c1c; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:10pt; line-height:1.5; padding:0 12mm; }
.bloco { padding:14px 0; }
.tabela tr, .area-box, .croqui-wrap, .rt-box, .assina-wrap, .validacao-bloco, .kv, .vertice-cab { break-inside:avoid; page-break-inside:avoid; }

/* cabecalho institucional */
.header { background:linear-gradient(135deg,#0B6E4F 0%,#1F4E2E 100%); color:#fff; padding:22px 24px; border-radius:6px; margin-top:14px; display:flex; justify-content:space-between; align-items:center; }
.header .logo { font-size:1.5rem; font-weight:700; letter-spacing:.5px; }
.header .logo span { color:${CORES.douradoBrilho}; }
.header .empresa-sub { color:#dfe9e3; font-size:.72rem; margin-top:4px; }
.header .registros { color:#cfe5db; font-size:.66rem; margin-top:6px; }
.header-right { text-align:right; }
.laudo-badge { display:inline-block; background:${CORES.dourado}; color:#1c1c1c; font-weight:700; padding:8px 16px; border-radius:4px; font-size:1.05rem; letter-spacing:.5px; }
.laudo-badge-label { color:#dfe9e3; font-size:.66rem; letter-spacing:2px; text-transform:uppercase; margin-bottom:6px; }

/* titulos de secao */
h2.secao { color:#0B6E4F; font-size:10pt; font-weight:700; text-transform:uppercase; letter-spacing:1px; border-left:4px solid #0B6E4F; padding-left:10px; margin:8px 0; }
.texto { color:#333; }

/* identificacao + grids */
.ident-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.ident-card { border:1px solid #d8e4de; border-radius:5px; padding:12px 14px; background:#F0F7F4; }
.ident-card .k { color:#0B6E4F; font-size:.66rem; letter-spacing:1px; text-transform:uppercase; }
.ident-card .v { font-weight:700; margin-top:4px; }

.kv { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #ececec; }
.kv:last-child { border-bottom:none; }
.kv .k { color:#666; } .kv .v { font-weight:600; text-align:right; }

/* tabelas */
table.tabela { width:100%; border-collapse:collapse; margin-top:6px; }
table.tabela th { background:#0B6E4F; color:#fff; text-align:left; padding:8px 10px; font-size:.72rem; letter-spacing:.5px; }
table.tabela td { padding:7px 10px; border-bottom:1px solid #e4e4e4; }
table.tabela tbody tr:nth-child(even) { background:#F0F7F4; }
.mono { font-family:'Courier New',monospace; font-size:9pt; }

/* box de area */
.area-box { border:2px solid #0B6E4F; background:#F0F7F4; border-radius:6px; padding:18px 22px; text-align:center; margin-top:6px; }
.area-box .area-valor { font-size:16pt; font-weight:700; color:#0B6E4F; }
.area-box .area-extra { font-size:10pt; color:#444; margin-top:6px; }

/* croqui */
.croqui-wrap { border:1px solid #d8e4de; border-radius:6px; padding:12px; text-align:center; margin-top:6px; background:#fff; }
.croqui-wrap svg, .croqui-img { max-width:100%; max-height:360px; }
.croqui-vazio { color:#999; font-style:italic; padding:40px 12px; }

/* responsabilidade tecnica */
.rt-box { display:flex; gap:16px; margin-top:6px; }
.rt-item { flex:1; border:1px solid #d8e4de; background:#F0F7F4; border-radius:5px; padding:12px 16px; }
.rt-item .k { color:#0B6E4F; font-weight:700; letter-spacing:1px; }
.rt-item .v { font-family:'Courier New',monospace; margin-top:4px; }

/* assinatura */
.assina-wrap { margin-top:30px; text-align:center; }
.assina-img-area { display:flex; justify-content:center; align-items:flex-end; min-height:64px; }
.assina-linha { border-top:1px solid #1c1c1c; width:300px; margin:8px auto 6px; }
.assina-nome { font-weight:700; }
.assina-cargo { color:#0B6E4F; font-size:.85rem; }
.assina-cred { color:#666; font-size:.72rem; margin-top:4px; }

/* validacao */
.validacao-bloco { display:flex; gap:20px; align-items:center; background:#F0F7F4; border:1px solid #0B6E4F; border-radius:6px; padding:16px 20px; margin-top:18px; }
.val-qr img { display:block; width:104px; height:104px; background:#fff; padding:5px; border-radius:4px; }
.val-info { flex:1; }
.val-label { color:#0B6E4F; font-weight:700; letter-spacing:1px; text-transform:uppercase; font-size:.72rem; }
.val-hash { font-family:'Courier New',monospace; color:#444; font-size:.72rem; word-break:break-all; margin-top:6px; }
.val-url { color:#0B6E4F; font-size:.78rem; margin-top:6px; word-break:break-all; }
</style></head><body>

<!-- 1 CABECALHO INSTITUCIONAL -->
<div class="header">
  <div>
    <div class="logo">Romatec <span>Consultoria Total</span></div>
    <div class="empresa-sub">${escapeHtml(dados.tecnico.empresa)} · ${escapeHtml(dados.tecnico.municipio)}</div>
    <div class="registros">CFT/MA 01209185369 · CNAI 031161 · CRECI/MA 4.705 · INCRA: FQNS</div>
  </div>
  <div class="header-right">
    <div class="laudo-badge-label">Laudo de Demarcação</div>
    <div class="laudo-badge">${escapeHtml(dados.numero)}</div>
  </div>
</div>

<!-- 2 IDENTIFICACAO -->
<div class="bloco">
  <h2 class="secao">Identificação do Laudo</h2>
  <div class="ident-grid">
    <div class="ident-card"><div class="k">Número</div><div class="v">${escapeHtml(dados.numero)}</div></div>
    <div class="ident-card"><div class="k">Data de Emissão</div><div class="v">${escapeHtml(dados.dataEmissao)}</div></div>
    <div class="ident-card"><div class="k">Tipo de Imóvel</div><div class="v">${escapeHtml(dados.tipoImovel)}</div></div>
  </div>
</div>

<!-- 3 CONTRATANTE -->
<div class="bloco">
  <h2 class="secao">Contratante</h2>
  <div class="kv"><span class="k">Nome</span><span class="v">${escapeHtml(dados.contratante.nome)}</span></div>
  <div class="kv"><span class="k">CPF/CNPJ</span><span class="v">${escapeHtml(dados.contratante.cpfCnpj)}</span></div>
  ${contatoCliente ? `<div class="kv"><span class="k">Contato</span><span class="v">${contatoCliente}</span></div>` : ''}
</div>

<!-- 4 IMOVEL -->
<div class="bloco">
  <h2 class="secao">Imóvel</h2>
  ${imovelKv || '<p class="texto">Dados do imóvel não informados.</p>'}
</div>

<!-- 5 FINALIDADE -->
<div class="bloco">
  <h2 class="secao">Finalidade</h2>
  <p class="texto">${escapeHtml(dados.finalidade)}</p>
</div>

<!-- 6 VERTICES -->
<div class="bloco">
  <h2 class="secao">Tabela de Vértices</h2>
  <table class="tabela">
    <thead class="vertice-cab"><tr><th>Nº</th><th>Marco</th><th>UTM E</th><th>UTM N</th><th>Latitude</th><th>Longitude</th></tr></thead>
    <tbody>${vertices || '<tr><td colspan="6">Nenhum vértice cadastrado.</td></tr>'}</tbody>
  </table>
</div>

<!-- 7 LADOS -->
<div class="bloco">
  <h2 class="secao">Tabela de Lados</h2>
  <table class="tabela">
    <thead><tr><th>Lado</th><th>Azimute</th><th>Distância</th></tr></thead>
    <tbody>${lados || '<tr><td colspan="3">Nenhum lado calculado.</td></tr>'}</tbody>
  </table>
</div>

<!-- 8 AREA -->
<div class="bloco">
  <h2 class="secao">Área e Perímetro</h2>
  <div class="area-box">
    <div class="area-valor">${escapeHtml(dados.area.m2)}</div>
    ${areaExtra ? `<div class="area-extra">${areaExtra}</div>` : ''}
  </div>
</div>

<!-- 9 CROQUI -->
<div class="bloco">
  <h2 class="secao">Croqui da Poligonal</h2>
  ${croquiHtml(dados)}
</div>

<!-- 10 RESPONSABILIDADE TECNICA -->
<div class="bloco">
  <h2 class="secao">Responsabilidade Técnica</h2>
  ${rt}
</div>

<!-- 11 ASSINATURA -->
<div class="bloco">
  <h2 class="secao">Assinatura do Responsável Técnico</h2>
  <div class="assina-wrap">
    <div class="assina-img-area">${blocoAssinaturaHtml(dados.assinaturaDigitalBase64, '#1c1c1c')}</div>
    <div class="assina-linha"></div>
    <div class="assina-nome">${escapeHtml(dados.tecnico.nome)}</div>
    <div class="assina-cargo">${escapeHtml(dados.tecnico.cargo)} · ${escapeHtml(dados.tecnico.empresa)}</div>
    <div class="assina-cred">${cred}</div>
  </div>
</div>

<!-- 12 VALIDACAO -->
<div class="bloco">
  <h2 class="secao">Validação de Autenticidade</h2>
  <div class="validacao-bloco">
    <div class="val-qr"><img src="${escapeHtml(qrDataUrl)}" alt="QR de validação"/></div>
    <div class="val-info">
      <div class="val-label">Verificação de Autenticidade</div>
      <div class="val-hash">${escapeHtml(dados.hashValidacao)}</div>
      <div class="val-url">${escapeHtml(dados.urlVerificacao)}</div>
    </div>
  </div>
</div>

</body></html>`;
}

export async function gerarLaudoPdfPrime1(dados: LaudoDados): Promise<Buffer> {
  const qr = await gerarQrCodeBase64(dados.urlVerificacao);
  return htmlToPdf(buildLaudoPrime1Html(dados, qr), OPCOES_FOOTER_PRIME1);
}
