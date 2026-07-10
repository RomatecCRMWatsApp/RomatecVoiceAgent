// v1.99.16 — Template Prime I (Dark Premium) para Propostas.
// Fundo preto, bloco diagonal verde na capa, numero dourado, Playfair+Barlow.
// Exporta buildHtml (puro/testavel) + gerarPropostaPdfPrime1 (puppeteer).

import type { PropostaDados, PropostaServicoItem } from '../../types/templateTypes';
import { htmlToPdf } from '../htmlToPdf';
import { CORES, FONTS_PRIME1, fmtBRL, escapeHtml, blocoAssinaturaHtml, assinaturaIcpHtml } from '../sharedHtml';

function linhaServico(s: PropostaServicoItem): string {
  const valor = s.pendente ? 'A confirmar' : (s.valor == null ? 'Incluso' : fmtBRL(s.valor));
  return `<tr><td>${escapeHtml(s.descricao)}</td><td class="val">${escapeHtml(valor)}</td></tr>`;
}

function cardImovel(dados: PropostaDados): string {
  const im = dados.imovel;
  if (!im) return '';
  const linhas: Array<[string, string | undefined]> = [
    ['Imovel', im.nome],
    ['Municipio/UF', [im.municipio, im.uf].filter(Boolean).join(' / ') || undefined],
    ['Area', im.areaHa ? `${im.areaHa} ha` : undefined],
    ['Matricula', im.matricula],
  ];
  const itens = linhas
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v!)}</span></div>`)
    .join('');
  if (!itens) return '';
  return `<div class="card-imovel">${itens}</div>`;
}

export function buildPropostaPrime1Html(dados: PropostaDados): string {
  const servicos = dados.servicos.map(linhaServico).join('');
  const cards = dados.servicos
    .map(
      (s) => `
      <div class="serv-card">
        <div class="serv-ico">◆</div>
        <div class="serv-titulo">${escapeHtml(s.descricao)}</div>
        <div class="serv-desc">${s.pendente ? 'A confirmar' : (s.valor == null ? 'Incluso no escopo' : fmtBRL(s.valor))}</div>
      </div>`,
    )
    .join('');
  const timeline = dados.etapas
    .map(
      (e) => `
      <div class="etapa">
        <div class="etapa-num">${escapeHtml(e.numero)}</div>
        <div class="etapa-body">
          <div class="etapa-titulo">${escapeHtml(e.titulo)}${e.prazo ? `<span class="etapa-prazo">${escapeHtml(e.prazo)}</span>` : ''}</div>
          <div class="etapa-texto">${escapeHtml(e.texto)}</div>
        </div>
      </div>`,
    )
    .join('');
  const parcelas = dados.parcelas
    .map(
      (p) => `<div class="parcela"><span class="p-label">${escapeHtml(p.label)}</span><span class="p-desc">${escapeHtml(p.descricao)}</span></div>`,
    )
    .join('');
  const prazos = dados.prazos
    .map(
      (p) => `
      <div class="prazo-box">
        <div class="prazo-val">${escapeHtml(p.valor)}</div>
        <div class="prazo-uni">${escapeHtml(p.unidade)}</div>
        <div class="prazo-desc">${escapeHtml(p.descricao)}</div>
      </div>`,
    )
    .join('');
  const drl = dados.drlIncluida
    ? `<div class="drl-warning">
         <div class="drl-titulo">⚠ DRL — Declaração de Respeito de Limite</div>
         <div class="drl-texto">A coleta das DRLs junto aos confrontantes é obrigação do proprietário. A Romatec orienta o procedimento e averbação em cartório conforme exigência do INCRA (Lei 10.267/2001 e NBR 14166).</div>
       </div>`
    : '';
  const cred = dados.tecnico.credenciais.map((c) => escapeHtml(c)).join(' · ');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
${FONTS_PRIME1}
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0a; color:#f5f5f0; font-family:'Barlow',sans-serif; font-size:11pt; line-height:1.5; }
/* v1.99.16: paginacao FLUIDA — so a capa e' folha fixa de 297mm; as seçoes
   fluem e enchem cada A4 naturalmente. Blocos atomicos nunca quebram no meio
   (corrige o card "Valor Total" cortado) e nao sobram folhas em branco. */
.page { width:210mm; position:relative; }
.capa { page-break-after:always; }
.serv-card, .etapa, .invest-total-card, .parcela, .prazo-box,
.drl-warning, .assina, .card-imovel, .capa-cli, table.invest tr {
  break-inside:avoid; page-break-inside:avoid;
}
.invest-total-card, .parcelas, .assinaturas { break-before:avoid; }
h2.secao, .secao-n { break-after:avoid; page-break-after:avoid; }
h2.secao { font-family:'Playfair Display',serif; font-size:1.9rem; color:#f5f5f0; margin-bottom:6px; }
.secao-n { font-family:'Barlow Condensed',sans-serif; color:${CORES.dourado}; letter-spacing:3px; font-size:.85rem; text-transform:uppercase; }
.bloco { padding:48px 54px; }
.label { font-family:'Barlow Condensed',sans-serif; letter-spacing:2px; text-transform:uppercase; color:#9a9a90; font-size:.72rem; }

/* CAPA */
.capa { display:flex; min-height:297mm; }
.capa::before { content:''; position:absolute; top:0; right:0; width:55%; height:100%;
  background:linear-gradient(135deg,#074a35 0%,#0B6E4F 50%,#0a5a3f 100%);
  clip-path:polygon(12% 0,100% 0,100% 100%,0% 100%); }
.capa::after { content:''; position:absolute; top:0; right:0; width:55%; height:6px;
  background:linear-gradient(90deg,transparent,${CORES.dourado},${CORES.douradoBrilho});
  clip-path:polygon(12% 0,100% 0,100% 100%,0% 100%); }
.capa-esq { position:relative; z-index:2; width:50%; padding:60px 54px; display:flex; flex-direction:column; justify-content:space-between; }
.capa-dir { position:relative; z-index:2; width:50%; padding:90px 54px 60px; color:#fff; }
.logo { font-family:'Playfair Display',serif; font-size:1.6rem; font-weight:700; color:#fff; }
.logo span { color:${CORES.douradoBrilho}; }
.capa-tipo { color:${CORES.dourado}; letter-spacing:4px; font-size:.78rem; margin-top:60px; }
.capa-titulo { font-family:'Playfair Display',serif; font-size:3rem; line-height:1.1; margin-top:14px; }
.capa-sub { color:#cfcfc7; margin-top:18px; max-width:88%; }
.capa-rodape { color:#7a7a72; font-size:.72rem; }
.numero-proposta { margin-bottom:40px; }
.numero-proposta .label { color:rgba(255,255,255,.7); }
.numero-proposta .numero { font-family:'Barlow Condensed',sans-serif; font-size:3.5rem; font-weight:700; color:${CORES.douradoBrilho}; line-height:1; }
.capa-cli { background:rgba(0,0,0,.25); border:1px solid rgba(255,255,255,.18); padding:22px 24px; border-radius:4px; }
.capa-cli .nome { font-size:1.25rem; font-weight:600; margin-top:4px; }
.capa-cli .doc { color:#dfe9e3; font-size:.85rem; margin-top:2px; }

/* SECAO objeto */
.texto-obj { color:#d8d8d0; max-width:92%; }
.card-imovel { margin-top:24px; background:#141414; border:1px solid #2a2a2a; border-left:3px solid ${CORES.dourado}; padding:24px 28px; border-radius:4px; }
.kv { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid #232323; }
.kv:last-child { border-bottom:none; }
.kv .k { color:#9a9a90; } .kv .v { color:#f5f5f0; font-weight:600; }

/* servicos grid */
.serv-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:24px; }
.serv-card { background:#141414; border:1px solid #2a2a2a; padding:22px 18px; border-radius:6px; }
.serv-ico { color:${CORES.douradoBrilho}; font-size:1.3rem; }
.serv-titulo { font-weight:600; margin-top:10px; font-size:.95rem; }
.serv-desc { color:#9a9a90; font-size:.82rem; margin-top:6px; }

/* timeline */
.timeline { margin-top:24px; border-left:2px solid #2a2a2a; padding-left:8px; }
.etapa { display:flex; gap:18px; padding:14px 0; }
.etapa-num { flex:0 0 42px; height:42px; width:42px; border-radius:50%; background:${CORES.verdeEscuro}; border:1px solid ${CORES.dourado}; color:${CORES.douradoBrilho}; display:flex; align-items:center; justify-content:center; font-family:'Barlow Condensed',sans-serif; font-weight:700; margin-left:-29px; }
.etapa-titulo { font-weight:600; }
.etapa-prazo { color:${CORES.douradoBrilho}; font-size:.75rem; margin-left:10px; border:1px solid #3a3a2a; padding:1px 8px; border-radius:10px; }
.etapa-texto { color:#b8b8b0; font-size:.86rem; margin-top:3px; }

/* investimento */
table.invest { width:100%; border-collapse:collapse; margin-top:18px; }
table.invest td { padding:11px 4px; border-bottom:1px solid #232323; }
table.invest td.val { text-align:right; color:${CORES.douradoClaro}; font-weight:600; white-space:nowrap; }
.invest-total-card { background:linear-gradient(135deg,${CORES.verdeEscuro},${CORES.verdeEscuro}); border:1px solid ${CORES.dourado}; text-align:center; padding:34px; margin-top:24px; border-radius:6px; }
.invest-total-card .label { color:rgba(255,255,255,.7); }
.invest-total-card .total { font-family:'Barlow Condensed',sans-serif; font-size:3rem; font-weight:700; color:${CORES.douradoBrilho}; line-height:1.1; }
.invest-total-card .extenso { color:#dfe9e3; font-style:italic; font-size:.85rem; }
.parcelas { display:flex; gap:12px; margin-top:18px; }
.parcela { flex:1; background:#141414; border:1px solid #2a2a2a; padding:14px 16px; border-radius:5px; }
.parcela .p-label { display:block; color:${CORES.douradoBrilho}; font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:1px; }
.parcela .p-desc { color:#b8b8b0; font-size:.82rem; }
.drl-warning { background:rgba(184,134,11,.08); border-left:4px solid ${CORES.dourado}; padding:18px 22px; margin-top:22px; border-radius:0 4px 4px 0; }
.drl-titulo { color:${CORES.douradoBrilho}; font-weight:600; }
.drl-texto { color:#cdc7b2; font-size:.85rem; margin-top:6px; }

/* prazos */
.prazo-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:24px; }
.prazo-box { background:#141414; border:1px solid #2a2a2a; padding:20px 14px; text-align:center; border-radius:6px; }
.prazo-val { font-family:'Barlow Condensed',sans-serif; font-size:2.6rem; font-weight:700; color:${CORES.douradoBrilho}; line-height:1; }
.prazo-uni { color:#9a9a90; letter-spacing:1px; text-transform:uppercase; font-size:.72rem; }
.prazo-desc { color:#cfcfc7; font-size:.82rem; margin-top:8px; }

/* assinaturas */
.assinaturas { display:flex; gap:48px; margin-top:60px; }
.assina { flex:1; }
.assina .linha { border-top:1px solid #3a3a3a; margin-bottom:8px; }
.assina .nome { font-weight:600; }
.assina .cargo { color:${CORES.douradoClaro}; font-size:.85rem; }
.assina .cred { color:#9a9a90; font-size:.72rem; margin-top:4px; }

/* rodape */
.rodape { background:#000; padding:22px 54px; display:flex; justify-content:space-between; align-items:center; color:#7a7a72; font-size:.72rem; }
.rodape .logo { font-size:1.05rem; }
</style></head><body>

<!-- CAPA -->
<div class="page capa">
  <div class="capa-esq">
    <div class="logo">Romatec <span>Consultoria Total</span></div>
    <div>
      <div class="capa-tipo">PROPOSTA TÉCNICA E COMERCIAL</div>
      <div class="capa-titulo">${escapeHtml(dados.tipoServico)}</div>
      <div class="capa-sub">Documento elaborado conforme normas técnicas vigentes (NBR 13133 / NBR 14653) e legislação aplicável.</div>
    </div>
    <div class="capa-rodape">Romatec Consultoria Total · ${escapeHtml(dados.tecnico.municipio)}<br/>Emissão: ${escapeHtml(dados.dataEmissao)} · Validade: ${escapeHtml(dados.validade)}</div>
  </div>
  <div class="capa-dir">
    <div class="numero-proposta">
      <div class="label">Proposta n.</div>
      <div class="numero">${escapeHtml(dados.numero)}</div>
    </div>
    <div class="capa-cli">
      <div class="label">Contratante</div>
      <div class="nome">${escapeHtml(dados.cliente.nome)}</div>
      <div class="doc">${escapeHtml(dados.cliente.cpfCnpj)}</div>
      ${dados.cliente.endereco ? `<div class="doc">${escapeHtml(dados.cliente.endereco)}</div>` : ''}
    </div>
  </div>
</div>

<!-- 01 OBJETO + 02 SERVICOS -->
<div class="page">
  <div class="bloco">
    <div class="secao-n">Seção 01</div>
    <h2 class="secao">Objeto da Proposta</h2>
    <p class="texto-obj">A presente proposta tem por objeto a execução dos serviços de <strong>${escapeHtml(dados.tipoServico)}</strong>, abrangendo as atividades técnicas descritas nas seções seguintes, com a respectiva responsabilidade técnica (TRT/ART) registrada no conselho competente.</p>
    ${cardImovel(dados)}
  </div>
  <div class="bloco" style="padding-top:0;">
    <div class="secao-n">Seção 02</div>
    <h2 class="secao">Serviços Inclusos</h2>
    <div class="serv-grid">${cards}</div>
  </div>
</div>

<!-- 03 METODOLOGIA + 04 INVESTIMENTO -->
<div class="page">
  <div class="bloco">
    <div class="secao-n">Seção 03</div>
    <h2 class="secao">Metodologia e Etapas</h2>
    <div class="timeline">${timeline}</div>
  </div>
  <div class="bloco" style="padding-top:0;">
    <div class="secao-n">Seção 04</div>
    <h2 class="secao">Investimento</h2>
    <table class="invest">${servicos}</table>
    <div class="invest-total-card">
      <div class="label">Valor total dos serviços</div>
      <div class="total">${fmtBRL(dados.valorTotal)}</div>
      <div class="extenso">(${escapeHtml(dados.valorTotalExtenso)})</div>
    </div>
    <div class="parcelas">${parcelas}</div>
    ${drl}
  </div>
</div>

<!-- 05 PRAZO + 06 ASSINATURAS -->
<div class="page">
  <div class="bloco">
    <div class="secao-n">Seção 05</div>
    <h2 class="secao">Prazo e Cronograma</h2>
    <div class="prazo-grid">${prazos}</div>
  </div>
  <div class="bloco" style="padding-top:0;">
    <div class="secao-n">Seção 06</div>
    <h2 class="secao">Assinaturas</h2>
    <div class="assinaturas">
      <div class="assina">
        <div class="linha"></div>
        <div class="nome">${escapeHtml(dados.tecnico.nome)}</div>
        <div class="cargo">${escapeHtml(dados.tecnico.cargo)} · ${escapeHtml(dados.tecnico.empresa)}</div>
        <div class="cred">${cred}</div>
      </div>
      <div class="assina">
        <div class="linha"></div>
        <div class="nome">${escapeHtml(dados.cliente.nome)}</div>
        <div class="cargo">Contratante</div>
        <div class="cred">${escapeHtml(dados.cliente.cpfCnpj)}</div>
      </div>
    </div>
    ${assinaturaIcpHtml(dados.assinaturaIcp)}
    ${dados.observacoes ? `<p class="texto-obj" style="margin-top:34px;font-size:.85rem;">${escapeHtml(dados.observacoes)}</p>` : ''}
  </div>
  <div class="rodape">
    <div class="logo">Romatec <span style="color:${CORES.douradoBrilho}">Consultoria Total</span></div>
    <div>${escapeHtml(dados.tecnico.municipio)} · romateccrm@gmail.com</div>
    <div>${escapeHtml(dados.numero)}</div>
  </div>
</div>

</body></html>`;
}

export async function gerarPropostaPdfPrime1(dados: PropostaDados): Promise<Buffer> {
  return htmlToPdf(buildPropostaPrime1Html(dados));
}
