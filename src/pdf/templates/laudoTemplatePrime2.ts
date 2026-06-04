// v3.x — Template Prime II (Executivo Premium) para Laudos de Demarcacao.
// Paleta azul-escuro/verde-zayra, tipografia serif (corpo) + Helvetica (titulos)
// + Courier (coordenadas). Cabecalho split, secoes numeradas, box de area
// centralizado, croqui, responsabilidade tecnica, assinatura e validacao (QR).
// buildHtml e' PURO (recebe o QR ja gerado); gerar*Pdf cria QR + renderiza.

import type { PDFOptions } from 'puppeteer';
import { LaudoDados } from '../../types/templateTypes';
import { htmlToPdf } from '../htmlToPdf';
import { FONTS_PRIME2, escapeHtml, gerarQrCodeBase64, blocoAssinaturaHtml } from '../sharedHtml';

// FOOTER FIX — rodape escuro com paginacao em verde-zayra, margem lateral 0
// (body com padding 12mm), margem inferior 18mm.
const OPCOES_FOOTER_PRIME2: Partial<PDFOptions> = {
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  margin: { top: '0', right: '0', bottom: '18mm', left: '0' },
  preferCSSPageSize: false,
  footerTemplate:
    '<div style="width:100%;font-size:7pt;font-family:Arial,sans-serif;color:#fff;' +
    'background:#1A1A2E;display:flex;justify-content:space-between;align-items:center;' +
    'padding:5px 12mm;">' +
    '<span>Romatec Consultoria Total · CFT/MA 01209185369 · CNAI 031161 · CRECI/MA 4.705</span>' +
    '<span style="color:#00ff88;"><span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
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
    <td class="mono">${v.alt ? escapeHtml(v.alt) : '—'}</td>
  </tr>`;
}

function linhaLado(l: LaudoDados['lados'][number]): string {
  return `<tr>
    <td>${escapeHtml(l.lado)}</td>
    <td class="mono">${escapeHtml(l.azimute)}</td>
    <td class="mono">${escapeHtml(l.distancia)}</td>
  </tr>`;
}

function metodologiaHtml(dados: LaudoDados, numero: string): string {
  if (!dados.metodologia?.length) return '';
  const itens = dados.metodologia
    .map(
      (etapa, i) =>
        `<div class="metodo-etapa">
          <span class="metodo-num">${i + 1}</span>
          <span class="metodo-texto">${escapeHtml(etapa)}</span>
        </div>`,
    )
    .join('');
  return `<!-- METODOLOGIA -->
<div class="bloco">
  <h2 class="secao">${escapeHtml(numero)} Metodologia Técnica Aplicada</h2>
  <div class="metodo-lista">${itens}</div>
</div>`;
}

function equipamentosHtml(dados: LaudoDados, numero: string): string {
  const e = dados.equipamentos;
  const linha = (k: string, v: string) =>
    `<div class="equip-item"><span class="equip-k">${escapeHtml(k)}</span><span class="equip-v">${escapeHtml(v)}</span></div>`;
  return `<!-- EQUIPAMENTOS -->
<div class="bloco">
  <h2 class="secao">${escapeHtml(numero)} Equipamentos Utilizados</h2>
  <div class="equip-lista">
    ${linha('Base GNSS', e.base)}
    ${linha('Rover GNSS', e.rover)}
    ${linha('Coletor', e.coletor)}
    ${linha('Acessórios', e.acessorios)}
    ${linha('Software', e.software)}
  </div>
</div>`;
}

function memorialHtml(dados: LaudoDados, numero: string): string {
  const texto = (dados.memorialTexto ?? '').trim();
  if (!texto) return '';
  return `<!-- MEMORIAL -->
<div class="bloco">
  <h2 class="secao">${escapeHtml(numero)} Memorial Descritivo</h2>
  <p class="texto memorial-texto">${escapeHtml(texto)}</p>
</div>`;
}

function pagamentoHtml(dados: LaudoDados, numero: string): string {
  const pg = dados.pagamento;
  if (!pg) return '';
  const kv = (k: string, v?: string) =>
    v ? `<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>` : '';
  const contaInfo = [
    pg.banco ? `Banco ${pg.banco}` : '',
    pg.agencia ? `Ag. ${pg.agencia}` : '',
    pg.conta ? `Conta ${pg.conta}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<!-- PAGAMENTO -->
<div class="bloco">
  <h2 class="secao">${escapeHtml(numero)} Dados para Pagamento</h2>
  <div class="pgto-wrap">
    <div class="pgto-info">
      ${kv('Titular', pg.titular)}
      ${kv('Documento', pg.documento)}
      ${kv('Chave PIX', pg.pix)}
      ${contaInfo ? kv('Conta', contaInfo) : ''}
      ${kv('Valor', pg.valorFormatado)}
      <div class="pgto-copia">
        <span class="pgto-copia-label">PIX Copia e Cola</span>
        <code class="pgto-brcode">${escapeHtml(pg.brCode)}</code>
      </div>
    </div>
    <div class="pgto-qr"><img src="${escapeHtml(pg.qrDataUrl)}" alt="QR Code PIX"/></div>
  </div>
</div>`;
}

function fotosHtml(dados: LaudoDados, numero: string): string {
  if (!dados.fotos?.length) return '';
  const cards = dados.fotos
    .map(
      (f) =>
        `<div class="foto-card">
          <img class="foto-img" src="${escapeHtml(f.dataUri)}" alt="Foto do laudo"/>
          ${f.legenda ? `<div class="foto-legenda">${escapeHtml(f.legenda)}</div>` : ''}
        </div>`,
    )
    .join('');
  return `<!-- RELATORIO FOTOGRAFICO -->
<div class="bloco">
  <h2 class="secao">${escapeHtml(numero)} Relatório Fotográfico</h2>
  <div class="foto-grid">${cards}</div>
</div>`;
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

export function buildLaudoPrime2Html(dados: LaudoDados, qrDataUrl: string): string {
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

  // Dados pessoais extra (CPF formatado, RG, nacionalidade, estado civil).
  const dadosPessoais = [
    dados.contratante.cpfCnpj && dados.contratante.cpfCnpj !== '—'
      ? `CPF/CNPJ: ${dados.contratante.cpfCnpj}`
      : '',
    dados.contratante.rg ? `RG: ${dados.contratante.rg}` : '',
    dados.contratante.nacionalidade || '',
    dados.contratante.estadoCivil || '',
  ]
    .filter(Boolean)
    .map((c) => escapeHtml(c))
    .join(' · ');

  const rt =
    dados.art || dados.trt
      ? `<div class="rt-box">
           ${dados.art ? `<div class="rt-item"><span class="k">ART</span><span class="v">${escapeHtml(dados.art)}</span></div>` : ''}
           ${dados.trt ? `<div class="rt-item"><span class="k">TRT</span><span class="v">${escapeHtml(dados.trt)}</span></div>` : ''}
         </div>`
      : `<p class="texto">Responsabilidade técnica do profissional habilitado abaixo identificado, na forma da legislação aplicável.</p>`;

  const conversoes = [dados.area.ha, dados.area.alqueires, dados.area.perimetro ? `Perímetro: ${dados.area.perimetro}` : undefined]
    .filter(Boolean)
    .map((s) => escapeHtml(s!))
    .join(' &nbsp;·&nbsp; ');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
${FONTS_PRIME2}
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#ffffff; color:#222; font-family:Georgia,'Times New Roman',serif; font-size:10pt; line-height:1.55; padding:0 12mm; }
.bloco { padding:14px 0; }
.tabela tr, .area-box, .croqui-wrap, .rt-box, .assina-wrap, .validacao-bloco, .kv, .vertice-cab { break-inside:avoid; page-break-inside:avoid; }

/* cabecalho split */
.header { display:flex; justify-content:space-between; align-items:stretch; margin-top:14px; gap:18px; }
.header-left { flex:1; }
.header-left .logo { font-family:Helvetica,Arial,sans-serif; font-weight:700; font-size:14pt; color:#1A1A2E; }
.header-left .logo span { color:#00aa66; }
.header-left .dados { font-size:8pt; color:#888; margin-top:6px; line-height:1.4; }
.header-right { background:#1A1A2E; border:2px solid #00ff88; border-radius:6px; padding:14px 20px; text-align:right; min-width:200px; }
.header-right .laudo-label { color:#bbb; font-size:7.5pt; letter-spacing:2px; text-transform:uppercase; font-family:Helvetica,Arial,sans-serif; }
.header-right .laudo-num { color:#00ff88; font-size:13pt; font-weight:700; font-family:Helvetica,Arial,sans-serif; margin-top:4px; }
.header-right .laudo-tipo { color:#fff; font-size:9pt; margin-top:6px; }
.header-right .laudo-data { color:#aaa; font-size:8pt; margin-top:3px; }

/* titulos numerados */
h2.secao { font-family:Helvetica,Arial,sans-serif; font-weight:700; font-size:10.5pt; color:#1A1A2E; background:#F5F5F5; padding:8px 12px; border-bottom:2px solid #00ff88; margin:8px 0; }
.texto { color:#333; }

/* identificacao + grids */
.ident-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.ident-card { background:#F5F5F5; border-radius:5px; padding:12px 14px; }
.ident-card .k { color:#888; font-family:Helvetica,Arial,sans-serif; font-size:7.5pt; letter-spacing:1px; text-transform:uppercase; }
.ident-card .v { font-weight:700; margin-top:4px; }

.kv { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #ececec; }
.kv:last-child { border-bottom:none; }
.kv .k { color:#888; } .kv .v { font-weight:600; text-align:right; }

/* tabelas */
table.tabela { width:100%; border-collapse:collapse; margin-top:6px; font-family:Helvetica,Arial,sans-serif; }
table.tabela th { background:#1A1A2E; color:#fff; text-align:left; padding:8px 10px; font-size:8pt; letter-spacing:.5px; }
table.tabela td { padding:7px 10px; border-bottom:1px solid #e4e4e4; font-size:9pt; }
.mono { font-family:'Courier New',monospace; font-size:8.5pt; }

/* box de area centralizado */
.area-box { width:60%; margin:8px auto 0; background:#1A1A2E; border-radius:8px; padding:22px 24px; text-align:center; }
.area-box .area-valor { font-size:20pt; font-weight:700; color:#00ff88; font-family:Helvetica,Arial,sans-serif; }
.area-box .area-unidade { font-size:12pt; color:#fff; margin-top:2px; }
.area-box .area-sep { border-top:1px solid #00ff88; margin:14px auto 10px; width:70%; }
.area-box .area-conv { font-size:9pt; color:#AAAAAA; }

/* croqui */
.croqui-wrap { border:1px solid #ddd; border-radius:6px; padding:12px; text-align:center; margin-top:6px; background:#fff; }
.croqui-wrap svg, .croqui-img { max-width:100%; max-height:360px; }
.croqui-vazio { color:#999; font-style:italic; padding:40px 12px; }

/* responsabilidade tecnica */
.rt-box { display:flex; gap:16px; margin-top:6px; }
.rt-item { flex:1; background:#F5F5F5; border-radius:5px; padding:12px 16px; }
.rt-item .k { color:#1A1A2E; font-family:Helvetica,Arial,sans-serif; font-weight:700; letter-spacing:1px; }
.rt-item .v { font-family:'Courier New',monospace; margin-top:4px; }

/* assinatura */
.assina-wrap { margin-top:30px; text-align:center; }
.assina-img-area { display:flex; justify-content:center; align-items:flex-end; min-height:64px; }
.assina-linha { border-top:1px solid #1A1A2E; width:300px; margin:8px auto 6px; }
.assina-nome { font-family:Helvetica,Arial,sans-serif; font-weight:700; }
.assina-cargo { color:#00aa66; font-size:.85rem; }
.assina-cred { color:#888; font-size:.72rem; margin-top:4px; }

/* validacao */
.validacao-bloco { display:flex; gap:20px; align-items:center; background:#F5F5F5; border-left:4px solid #00ff88; border-radius:6px; padding:16px 20px; margin-top:18px; }
.val-qr img { display:block; width:104px; height:104px; background:#fff; padding:5px; border-radius:4px; }
.val-info { flex:1; }
.val-label { color:#1A1A2E; font-family:Helvetica,Arial,sans-serif; font-weight:700; letter-spacing:1px; text-transform:uppercase; font-size:8pt; }
.val-hash { font-family:'Courier New',monospace; color:#444; font-size:8pt; word-break:break-all; margin-top:6px; }
.val-url { color:#00aa66; font-size:.78rem; margin-top:6px; word-break:break-all; }

/* metodologia */
.metodo-lista { margin-top:6px; }
.metodo-etapa { display:flex; gap:12px; align-items:flex-start; padding:8px 0; border-bottom:1px solid #ececec; break-inside:avoid; page-break-inside:avoid; }
.metodo-etapa:last-child { border-bottom:none; }
.metodo-num { flex:none; width:24px; height:24px; border-radius:4px; background:#1A1A2E; color:#00ff88; font-weight:700; font-size:.8rem; font-family:Helvetica,Arial,sans-serif; display:flex; align-items:center; justify-content:center; }
.metodo-texto { color:#333; }

/* equipamentos */
.equip-lista { margin-top:6px; }
.equip-item { padding:8px 0; border-bottom:1px solid #ececec; break-inside:avoid; page-break-inside:avoid; }
.equip-item:last-child { border-bottom:none; }
.equip-k { display:block; color:#1A1A2E; font-family:Helvetica,Arial,sans-serif; font-size:7.5pt; letter-spacing:1px; text-transform:uppercase; font-weight:700; margin-bottom:2px; }
.equip-v { color:#333; }

/* memorial */
.memorial-texto { text-align:justify; }

/* pagamento */
.pgto-wrap { display:flex; gap:20px; align-items:flex-start; background:#F5F5F5; border-left:4px solid #00ff88; border-radius:6px; padding:16px 20px; margin-top:6px; break-inside:avoid; page-break-inside:avoid; }
.pgto-info { flex:1; }
.pgto-qr img { display:block; width:118px; height:118px; background:#fff; padding:5px; border-radius:4px; }
.pgto-copia { margin-top:10px; }
.pgto-copia-label { display:block; color:#1A1A2E; font-family:Helvetica,Arial,sans-serif; font-size:7.5pt; letter-spacing:1px; text-transform:uppercase; font-weight:700; margin-bottom:4px; }
.pgto-brcode { display:block; font-family:'Courier New',monospace; font-size:7.5pt; color:#444; background:#fff; border:1px solid #ddd; border-radius:4px; padding:8px; word-break:break-all; white-space:pre-wrap; }

/* relatorio fotografico */
.foto-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; margin-top:6px; }
.foto-card { border:1px solid #ddd; border-radius:6px; padding:8px; background:#fff; break-inside:avoid; page-break-inside:avoid; }
.foto-img { width:100%; max-height:220px; object-fit:cover; border-radius:4px; }
.foto-legenda { color:#555; font-size:.74rem; margin-top:6px; text-align:center; font-family:Helvetica,Arial,sans-serif; }
</style></head><body>

<!-- 1 CABECALHO SPLIT -->
<div class="header">
  <div class="header-left">
    <div class="logo">Romatec <span>Consultoria Total</span></div>
    <div class="dados">${escapeHtml(dados.tecnico.empresa)} · ${escapeHtml(dados.tecnico.municipio)}<br/>CFT/MA 01209185369 · CNAI 031161 · CRECI/MA 4.705 · INCRA: FQNS</div>
  </div>
  <div class="header-right">
    <div class="laudo-label">Laudo de Demarcação</div>
    <div class="laudo-num">${escapeHtml(dados.numero)}</div>
    <div class="laudo-tipo">${escapeHtml(dados.tipoImovel)}</div>
    <div class="laudo-data">${escapeHtml(dados.dataEmissao)}</div>
  </div>
</div>

<!-- 2 IDENTIFICACAO -->
<div class="bloco">
  <h2 class="secao">1. Identificação do Laudo</h2>
  <div class="ident-grid">
    <div class="ident-card"><div class="k">Número</div><div class="v">${escapeHtml(dados.numero)}</div></div>
    <div class="ident-card"><div class="k">Data de Emissão</div><div class="v">${escapeHtml(dados.dataEmissao)}</div></div>
    <div class="ident-card"><div class="k">Tipo de Imóvel</div><div class="v">${escapeHtml(dados.tipoImovel)}</div></div>
  </div>
</div>

<!-- 3 CONTRATANTE -->
<div class="bloco">
  <h2 class="secao">2. Contratante</h2>
  <div class="kv"><span class="k">Nome</span><span class="v">${escapeHtml(dados.contratante.nome)}</span></div>
  <div class="kv"><span class="k">CPF/CNPJ</span><span class="v">${escapeHtml(dados.contratante.cpfCnpj)}</span></div>
  ${dadosPessoais ? `<div class="kv"><span class="k">Qualificação</span><span class="v">${dadosPessoais}</span></div>` : ''}
  ${contatoCliente ? `<div class="kv"><span class="k">Contato</span><span class="v">${contatoCliente}</span></div>` : ''}
</div>

<!-- 4 IMOVEL -->
<div class="bloco">
  <h2 class="secao">3. Imóvel</h2>
  ${imovelKv || '<p class="texto">Dados do imóvel não informados.</p>'}
</div>

${dados.objeto ? `<!-- OBJETO DA DEMARCACAO -->
<div class="bloco">
  <h2 class="secao">4. Objeto da Demarcação</h2>
  <p class="texto">${escapeHtml(dados.objeto)}</p>
</div>` : ''}

<!-- 5 FINALIDADE -->
<div class="bloco">
  <h2 class="secao">5. Finalidade</h2>
  <p class="texto">${escapeHtml(dados.finalidade)}</p>
</div>

${metodologiaHtml(dados, '6.')}

${equipamentosHtml(dados, '7.')}

<!-- 8 VERTICES -->
<div class="bloco">
  <h2 class="secao">8. Tabela de Vértices</h2>
  <table class="tabela">
    <thead class="vertice-cab"><tr><th>Nº</th><th>Marco</th><th>UTM E</th><th>UTM N</th><th>Latitude</th><th>Longitude</th><th>Alt.</th></tr></thead>
    <tbody>${vertices || '<tr><td colspan="7">Nenhum vértice cadastrado.</td></tr>'}</tbody>
  </table>
</div>

<!-- 9 LADOS -->
<div class="bloco">
  <h2 class="secao">9. Tabela de Lados</h2>
  <table class="tabela">
    <thead><tr><th>Lado</th><th>Azimute</th><th>Distância</th></tr></thead>
    <tbody>${lados || '<tr><td colspan="3">Nenhum lado calculado.</td></tr>'}</tbody>
  </table>
</div>

<!-- 10 AREA -->
<div class="bloco">
  <h2 class="secao">10. Área e Perímetro</h2>
  <div class="area-box">
    <div class="area-valor">${escapeHtml(dados.area.m2)}</div>
    <div class="area-unidade">Área total</div>
    ${conversoes ? `<div class="area-sep"></div><div class="area-conv">${conversoes}</div>` : ''}
  </div>
</div>

${memorialHtml(dados, '11.')}

<!-- 12 CROQUI -->
<div class="bloco">
  <h2 class="secao">12. Croqui da Poligonal</h2>
  ${croquiHtml(dados)}
</div>

${pagamentoHtml(dados, '13.')}

<!-- 14 RESPONSABILIDADE TECNICA -->
<div class="bloco">
  <h2 class="secao">14. Responsabilidade Técnica</h2>
  ${rt}
</div>

<!-- 15 ASSINATURA -->
<div class="bloco">
  <h2 class="secao">15. Assinatura do Responsável Técnico</h2>
  <div class="assina-wrap">
    <div class="assina-img-area">${blocoAssinaturaHtml(dados.assinaturaDigitalBase64, '#1A1A2E')}</div>
    <div class="assina-linha"></div>
    <div class="assina-nome">${escapeHtml(dados.tecnico.nome)}</div>
    <div class="assina-cargo">${escapeHtml(dados.tecnico.cargo)} · ${escapeHtml(dados.tecnico.empresa)}</div>
    <div class="assina-cred">${cred}</div>
  </div>
</div>

${fotosHtml(dados, '16.')}

<!-- 17 VALIDACAO -->
<div class="bloco">
  <h2 class="secao">17. Validação de Autenticidade</h2>
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

export async function gerarLaudoPdfPrime2(dados: LaudoDados): Promise<Buffer> {
  const qr = await gerarQrCodeBase64(dados.urlVerificacao);
  return htmlToPdf(buildLaudoPrime2Html(dados, qr), OPCOES_FOOTER_PRIME2);
}
