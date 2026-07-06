// v1.99.16 — Template Prime II (Clean Editorial) para Propostas.
// Fundo off-white, triangulos verde+dourado na capa, DM Serif (titulos italico)
// + DM Sans + Space Mono. Exporta buildHtml (puro) + gerarPropostaPdfPrime2.

import type { PropostaDados, PropostaServicoItem } from '../../types/templateTypes';
import { htmlToPdf } from '../htmlToPdf';
import { CORES, FONTS_PRIME2, fmtBRL, escapeHtml } from '../sharedHtml';

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

export function buildPropostaPrime2Html(dados: PropostaDados): string {
  const servicos = dados.servicos.map(linhaServico).join('');
  const cards = dados.servicos
    .map(
      (s) => `
      <div class="serv-card">
        <div class="serv-titulo">${escapeHtml(s.descricao)}</div>
        <div class="serv-desc">${s.pendente ? 'A confirmar' : (s.valor == null ? 'Incluso no escopo' : fmtBRL(s.valor))}</div>
      </div>`,
    )
    .join('');
  const etapas = dados.etapas
    .map(
      (e) => `
      <div class="etapa">
        <div class="etapa-num">${escapeHtml(e.numero)}</div>
        <div class="etapa-titulo">${escapeHtml(e.titulo)}</div>
        <div class="etapa-texto">${escapeHtml(e.texto)}</div>
        ${e.prazo ? `<div class="etapa-prazo">Prazo: ${escapeHtml(e.prazo)}</div>` : ''}
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
         <div class="drl-titulo">DRL — Declaração de Respeito de Limite</div>
         <div class="drl-texto">A coleta das DRLs junto aos confrontantes é obrigação do proprietário. A Romatec orienta o procedimento e a averbação em cartório conforme exigência do INCRA (Lei 10.267/2001).</div>
       </div>`
    : '';
  const cred = dados.tecnico.credenciais.map((c) => escapeHtml(c)).join(' · ');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
${FONTS_PRIME2}
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#fafaf8; color:#2a2620; font-family:'DM Sans',sans-serif; font-size:11pt; line-height:1.55; }
/* v1.99.16: paginacao FLUIDA — so a capa e' folha fixa; o resto flui e enche
   cada A4. Blocos atomicos nunca quebram no meio (corrige card cortado) e nao
   sobram folhas em branco. */
.page { width:210mm; position:relative; }
.capa { page-break-after:always; }
.serv-card, .etapa, .invest-total-card, .parcela, .prazo-box, .drl-warning,
.assina, .card-imovel, .cli-strip, table.invest tr {
  break-inside:avoid; page-break-inside:avoid;
}
.invest-total-card, .parcelas, .assinaturas, .faixa-dourada { break-before:avoid; }
h2.secao, .secao-n { break-after:avoid; page-break-after:avoid; }
.bloco { padding:46px 60px; position:relative; }
.secao-n { font-family:'DM Serif Display',serif; font-size:5rem; color:#e0ddd5; line-height:1; position:absolute; top:28px; right:48px; }
h2.secao { font-family:'DM Serif Display',serif; font-size:2rem; color:#2a2620; }
h2.secao em { font-style:italic; color:${CORES.verde}; }
.label { font-family:'Space Mono',monospace; letter-spacing:2px; text-transform:uppercase; font-size:.68rem; color:#8a857a; }

/* CAPA */
.capa { min-height:297mm; display:flex; flex-direction:column; justify-content:space-between; padding:54px 60px; }
.capa::before { content:''; position:absolute; top:0; right:0; width:380px; height:380px; background:${CORES.verde}; clip-path:polygon(100% 0,100% 100%,0 0); }
.capa::after { content:''; position:absolute; top:0; right:0; width:160px; height:160px; background:${CORES.dourado}; clip-path:polygon(100% 0,100% 100%,0 0); }
.capa-header { display:flex; justify-content:space-between; align-items:flex-start; position:relative; z-index:2; }
.logo { font-family:'DM Serif Display',serif; font-size:1.5rem; }
.logo em { font-style:italic; color:${CORES.verde}; }
.capa-num { font-family:'Space Mono',monospace; font-size:.8rem; color:#fff; text-align:right; }
.capa-body { position:relative; z-index:2; }
.badge { width:60px; height:3px; background:${CORES.dourado}; margin-bottom:22px; }
.capa-h1 { font-family:'DM Serif Display',serif; font-size:4rem; line-height:1.05; color:#2a2620; }
.capa-h1 em { font-style:italic; color:${CORES.verde}; }
.capa-sub { color:#6a655c; margin-top:18px; max-width:70%; }
.cli-strip { background:${CORES.verdeEscuro}; color:#fff; padding:20px 26px; margin-top:32px; border-radius:4px; max-width:75%; }
.cli-strip .nome { font-size:1.2rem; font-weight:700; }
.cli-strip .doc { color:#cfe5db; font-size:.85rem; }
.capa-footer { display:flex; justify-content:space-between; position:relative; z-index:2; color:#8a857a; font-size:.75rem; font-family:'Space Mono',monospace; }

/* faixa dourada */
.faixa-dourada { background:${CORES.dourado}; color:#fff; padding:16px 60px; font-family:'Space Mono',monospace; letter-spacing:2px; font-size:.78rem; }

/* objeto */
.obj-wrap { display:flex; gap:34px; margin-top:18px; }
.obj-texto { flex:2; color:#4a463d; }
.card-imovel { flex:1; background:#fff; border-top:3px solid ${CORES.verde}; box-shadow:0 1px 8px rgba(0,0,0,.05); padding:22px 24px; }
.kv { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid #efece4; }
.kv:last-child { border-bottom:none; }
.kv .k { color:#8a857a; font-size:.85rem; } .kv .v { font-weight:700; font-size:.85rem; }

/* servicos */
.cinza { background:#f1efe9; }
.serv-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-top:18px; }
.serv-card { background:#fff; padding:22px 18px; border-radius:6px; box-shadow:0 1px 6px rgba(0,0,0,.04); }
.serv-titulo { font-weight:700; }
.serv-desc { color:#8a857a; font-size:.84rem; margin-top:6px; }

/* etapas 2x2 */
.etapa-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:24px; margin-top:18px; }
.etapa { position:relative; padding:20px 22px; background:#fff; border-radius:6px; box-shadow:0 1px 6px rgba(0,0,0,.04); overflow:visible; }
.etapa-num { font-family:'DM Serif Display',serif; font-size:3.4rem; color:#eceae2; position:absolute; top:6px; right:16px; line-height:1; }
.etapa-titulo { font-weight:700; position:relative; }
.etapa-texto { color:#6a655c; font-size:.86rem; margin-top:6px; position:relative; }
.etapa-prazo { color:${CORES.verde}; font-family:'Space Mono',monospace; font-size:.72rem; margin-top:8px; }

/* investimento verde */
.invest-bg { background:${CORES.verdeEscuro}; color:#fff; }
.invest-bg h2.secao, .invest-bg h2.secao em { color:#fff; }
.invest-bg .secao-n { color:rgba(255,255,255,.12); }
.invest-bg .label { color:rgba(255,255,255,.6); }
table.invest { width:100%; border-collapse:collapse; margin-top:18px; }
table.invest td { padding:11px 4px; border-bottom:1px solid rgba(255,255,255,.14); }
table.invest td.val { text-align:right; color:${CORES.douradoBrilho}; font-weight:700; white-space:nowrap; }
.invest-total-card { background:${CORES.dourado}; color:#fff; text-align:center; padding:30px; margin-top:22px; border-radius:6px; }
.invest-total-card .total { font-family:'DM Serif Display',serif; font-size:2.8rem; line-height:1.1; }
.invest-total-card .extenso { font-style:italic; font-size:.85rem; opacity:.9; }
.parcelas { display:flex; gap:12px; margin-top:18px; }
.parcela { flex:1; border:1px solid ${CORES.dourado}; padding:14px 16px; border-radius:5px; }
.parcela .p-label { display:block; color:${CORES.douradoBrilho}; font-family:'Space Mono',monospace; font-weight:700; }
.parcela .p-desc { color:#dfe9e3; font-size:.82rem; }
.drl-warning { background:rgba(255,255,255,.08); border-left:4px solid ${CORES.douradoBrilho}; padding:16px 20px; margin-top:20px; border-radius:0 4px 4px 0; }
.drl-titulo { color:${CORES.douradoBrilho}; font-weight:700; }
.drl-texto { color:#e7efe9; font-size:.84rem; margin-top:6px; }

/* prazos */
.prazo-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:18px; }
.prazo-box { background:#fff; padding:20px 14px; text-align:center; border-radius:6px; box-shadow:0 1px 6px rgba(0,0,0,.04); }
.prazo-val { font-family:'DM Serif Display',serif; font-size:2.6rem; color:${CORES.verde}; line-height:1; }
.prazo-uni { color:#8a857a; text-transform:uppercase; font-family:'Space Mono',monospace; font-size:.68rem; }
.prazo-desc { color:#6a655c; font-size:.82rem; margin-top:8px; }

/* assinatura */
.assinaturas { display:flex; gap:0; margin-top:54px; }
.assina { flex:1; padding:0 30px; }
.assina:first-child { border-right:1px solid #d8d4ca; }
.assina .linha { border-top:1px solid #2a2620; margin-bottom:8px; }
.assina .nome { font-weight:700; }
.assina .cargo { color:${CORES.verde}; font-size:.85rem; }
.assina .cred { color:#8a857a; font-size:.72rem; margin-top:4px; }

/* rodape preto */
.rodape { background:#1a1714; color:#cfcabf; padding:22px 60px; display:flex; justify-content:space-between; align-items:center; font-family:'Space Mono',monospace; font-size:.72rem; }
.rodape .logo { font-family:'DM Serif Display',serif; color:#fff; font-size:1.05rem; }
</style></head><body>

<!-- CAPA -->
<div class="page capa">
  <div class="capa-header">
    <div class="logo">Romatec <em>Consultoria Total</em></div>
    <div class="capa-num">PROPOSTA<br/>${escapeHtml(dados.numero)}</div>
  </div>
  <div class="capa-body">
    <div class="badge"></div>
    <div class="label">Proposta técnica e comercial</div>
    <h1 class="capa-h1">${escapeHtml(dados.tipoServico)}</h1>
    <div class="capa-sub">Elaborada conforme as normas técnicas vigentes (NBR 13133 / NBR 14653) e legislação aplicável ao objeto.</div>
    <div class="cli-strip">
      <div class="label" style="color:#cfe5db">Contratante</div>
      <div class="nome">${escapeHtml(dados.cliente.nome)}</div>
      <div class="doc">${escapeHtml(dados.cliente.cpfCnpj)}${dados.cliente.endereco ? ` · ${escapeHtml(dados.cliente.endereco)}` : ''}</div>
    </div>
  </div>
  <div class="capa-footer">
    <div>Romatec Consultoria Total · ${escapeHtml(dados.tecnico.municipio)} · romateccrm@gmail.com</div>
    <div>Emissão ${escapeHtml(dados.dataEmissao)} · Validade ${escapeHtml(dados.validade)}</div>
  </div>
</div>

<div class="faixa-dourada">ROMATEC CONSULTORIA TOTAL &nbsp;|&nbsp; ${escapeHtml(dados.tecnico.municipio)}</div>

<!-- 01 OBJETO + 02 SERVICOS -->
<div class="page">
  <div class="bloco">
    <div class="secao-n">01</div>
    <h2 class="secao">Objeto da <em>Proposta</em></h2>
    <div class="obj-wrap">
      <p class="obj-texto">A presente proposta tem por objeto a execução dos serviços de <strong>${escapeHtml(dados.tipoServico)}</strong>, abrangendo as atividades técnicas descritas a seguir, com a respectiva responsabilidade técnica registrada no conselho competente (CFT/CREA).</p>
      ${cardImovel(dados)}
    </div>
  </div>
  <div class="bloco cinza">
    <div class="secao-n" style="color:#e0ddd5">02</div>
    <h2 class="secao">Serviços <em>Inclusos</em></h2>
    <div class="serv-grid">${cards}</div>
  </div>
</div>

<!-- 03 ETAPAS -->
<div class="page">
  <div class="bloco">
    <div class="secao-n">03</div>
    <h2 class="secao">Metodologia e <em>Etapas</em></h2>
    <div class="etapa-grid">${etapas}</div>
  </div>
  <!-- 04 INVESTIMENTO -->
  <div class="bloco invest-bg">
    <div class="secao-n">04</div>
    <h2 class="secao">Investimento</h2>
    <table class="invest">${servicos}</table>
    <div class="invest-total-card">
      <div class="label" style="color:rgba(255,255,255,.85)">Valor total dos serviços</div>
      <div class="total">${fmtBRL(dados.valorTotal)}</div>
      <div class="extenso">(${escapeHtml(dados.valorTotalExtenso)})</div>
    </div>
    <div class="parcelas">${parcelas}</div>
    ${drl}
  </div>
</div>

<!-- 05 PRAZO + 06 ASSINATURA -->
<div class="page">
  <div class="bloco cinza">
    <div class="secao-n" style="color:#e0ddd5">05</div>
    <h2 class="secao">Prazo &amp; <em>Cronograma</em></h2>
    <div class="prazo-grid">${prazos}</div>
  </div>
  <div class="bloco">
    <div class="secao-n">06</div>
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
    ${dados.observacoes ? `<p class="obj-texto" style="margin-top:30px;font-size:.85rem;">${escapeHtml(dados.observacoes)}</p>` : ''}
  </div>
  <div class="rodape">
    <div class="logo">Romatec <em style="color:${CORES.douradoBrilho}">Consultoria Total</em></div>
    <div>${escapeHtml(dados.numero)}</div>
  </div>
</div>

</body></html>`;
}

export async function gerarPropostaPdfPrime2(dados: PropostaDados): Promise<Buffer> {
  return htmlToPdf(buildPropostaPrime2Html(dados));
}
