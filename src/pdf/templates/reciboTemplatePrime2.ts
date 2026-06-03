// v1.99.16 — Template Prime II (Clean Editorial) para Recibos / Vales.
// Mesma linguagem da proposta Prime II. Bloco de validacao (QR+hash+url),
// assinatura digital, selo CONFIRMADO diagonal (texto verde).

import type { ReciboDados, ReciboParcela } from '../../types/templateTypes';
import { htmlToPdf } from '../htmlToPdf';
import {
  CORES,
  FONTS_PRIME2,
  fmtBRL,
  escapeHtml,
  blocoAssinaturaHtml,
  gerarQrCodeBase64,
} from '../sharedHtml';

function fmtParcela(p: ReciboParcela): string {
  return `<tr>
    <td>${escapeHtml(p.label)}</td>
    <td>${p.dataPagamento ? escapeHtml(p.dataPagamento) : '—'}</td>
    <td class="val">${fmtBRL(p.valor)}</td>
  </tr>`;
}

export function buildReciboPrime2Html(dados: ReciboDados, qrDataUrl: string): string {
  const parcelas = (dados.parcelas ?? []).map(fmtParcela).join('');
  const cred = dados.tecnico.credenciais.map((c) => escapeHtml(c)).join(' · ');
  const selo = dados.confirmado ? `<div class="selo">CONFIRMADO</div>` : '';
  const tabelaParcelas = parcelas
    ? `<table class="itens">
         <thead><tr><th>Parcela</th><th>Pagamento</th><th class="val">Valor</th></tr></thead>
         <tbody>${parcelas}</tbody>
       </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
${FONTS_PRIME2}
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#fafaf8; color:#2a2620; font-family:'DM Sans',sans-serif; font-size:11pt; line-height:1.55; }
.page { width:210mm; min-height:297mm; position:relative; }
/* v1.99.16: blocos atomicos nao quebram no meio entre paginas (recibo longo flui em vez de cortar) */
.valor-card, .dado, .servico-box, .validacao-bloco, .assina, table.itens tr {
  break-inside:avoid; page-break-inside:avoid;
}
.label { font-family:'Space Mono',monospace; letter-spacing:2px; text-transform:uppercase; font-size:.68rem; color:#8a857a; }
.bloco { padding:36px 60px; }

/* selo CONFIRMADO diagonal verde */
.selo { position:absolute; top:320px; left:50%; transform:translateX(-50%) rotate(-22deg); z-index:5;
  border:4px solid rgba(11,110,79,.18); color:rgba(11,110,79,.16);
  font-family:'DM Serif Display',serif; font-size:4.6rem; letter-spacing:4px;
  padding:8px 38px; border-radius:8px; pointer-events:none; }

/* header com triangulos */
.header { position:relative; padding:48px 60px 30px; }
.header::before { content:''; position:absolute; top:0; right:0; width:300px; height:300px; background:${CORES.verde}; clip-path:polygon(100% 0,100% 100%,0 0); }
.header::after { content:''; position:absolute; top:0; right:0; width:130px; height:130px; background:${CORES.dourado}; clip-path:polygon(100% 0,100% 100%,0 0); }
.header-inner { position:relative; z-index:2; display:flex; justify-content:space-between; align-items:flex-start; }
.logo { font-family:'DM Serif Display',serif; font-size:1.5rem; }
.logo em { font-style:italic; color:${CORES.verde}; }
.rec-num { text-align:right; color:#fff; font-family:'Space Mono',monospace; }
.rec-num .tipo { font-size:.72rem; letter-spacing:2px; }
.rec-num .numero { font-size:1.4rem; font-weight:700; }

/* valor */
.valor-card { background:${CORES.verdeEscuro}; color:#fff; text-align:center; padding:28px; border-radius:6px; }
.valor-card .total { font-family:'DM Serif Display',serif; font-size:2.8rem; line-height:1.1; color:#fff; }
.valor-card .extenso { font-style:italic; font-size:.85rem; opacity:.9; }

.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:18px; }
.dado { background:#fff; padding:15px 18px; border-radius:5px; box-shadow:0 1px 6px rgba(0,0,0,.04); }
.dado .v { font-weight:700; margin-top:3px; }
.servico-box { background:#fff; border-top:3px solid ${CORES.verde}; padding:18px 22px; border-radius:5px; margin-top:18px; box-shadow:0 1px 6px rgba(0,0,0,.04); }

table.itens { width:100%; border-collapse:collapse; margin-top:18px; background:#fff; border-radius:6px; overflow:hidden; box-shadow:0 1px 6px rgba(0,0,0,.04); }
table.itens th { text-align:left; color:#8a857a; font-family:'Space Mono',monospace; font-size:.7rem; letter-spacing:1px; padding:12px; background:#f1efe9; }
table.itens th.val, table.itens td.val { text-align:right; }
table.itens td { padding:12px; border-bottom:1px solid #f1efe9; }
table.itens td.val { color:${CORES.verde}; font-weight:700; }

.validacao-bloco { display:flex; gap:22px; align-items:center; background:#fff; border:1px solid #e7e3d9; padding:22px 24px; border-radius:6px; margin-top:24px; }
.val-qr img { display:block; width:110px; height:110px; }
.val-label { color:${CORES.verde}; letter-spacing:2px; font-family:'Space Mono',monospace; font-size:.72rem; }
.val-hash { font-family:'Space Mono',monospace; color:#6a655c; font-size:.72rem; word-break:break-all; margin-top:6px; }
.val-url { color:${CORES.dourado}; font-size:.82rem; margin-top:6px; }

.assina-wrap { margin-top:46px; display:flex; justify-content:space-between; align-items:flex-end; }
.assina { width:46%; text-align:center; }
.assina .nome { font-weight:700; margin-top:6px; }
.assina .cargo { color:${CORES.verde}; font-size:.82rem; }
.assina .cred { color:#8a857a; font-size:.7rem; margin-top:3px; }

.faixa-dourada { background:${CORES.dourado}; color:#fff; padding:14px 60px; font-family:'Space Mono',monospace; letter-spacing:2px; font-size:.74rem; margin-top:26px; display:flex; justify-content:space-between; }
</style></head><body>
<div class="page">
  ${selo}
  <div class="header">
    <div class="header-inner">
      <div class="logo">Romatec <em>Consultoria Total</em></div>
      <div class="rec-num"><div class="tipo">RECIBO</div><div class="numero">${escapeHtml(dados.numero)}</div></div>
    </div>
  </div>

  <div class="bloco">
    <div class="valor-card">
      <div class="label" style="color:rgba(255,255,255,.8)">Valor</div>
      <div class="total">${fmtBRL(dados.valorTotal)}</div>
      <div class="extenso">(${escapeHtml(dados.valorTotalExtenso)})</div>
    </div>

    <div class="grid2">
      <div class="dado"><div class="label">Cliente</div><div class="v">${escapeHtml(dados.cliente.nome)}</div></div>
      <div class="dado"><div class="label">CPF/CNPJ</div><div class="v">${escapeHtml(dados.cliente.cpfCnpj)}</div></div>
      <div class="dado"><div class="label">Emissao</div><div class="v">${escapeHtml(dados.dataEmissao)}</div></div>
      <div class="dado"><div class="label">Status</div><div class="v">${escapeHtml(dados.status)}</div></div>
    </div>

    <div class="servico-box">
      <div class="label">Referente a</div>
      <div class="v" style="margin-top:4px">${escapeHtml(dados.servico)}</div>
    </div>

    ${tabelaParcelas}
    ${dados.observacoes ? `<p style="color:#6a655c;font-size:.85rem;margin-top:18px;">${escapeHtml(dados.observacoes)}</p>` : ''}

    <div class="validacao-bloco">
      <div class="val-qr"><img src="${escapeHtml(qrDataUrl)}" alt="QR de validacao"/></div>
      <div class="val-info">
        <div class="val-label">VERIFICACAO DE AUTENTICIDADE</div>
        <div class="val-hash">${escapeHtml(dados.hashValidacao)}</div>
        <div class="val-url">${escapeHtml(dados.urlVerificacao)}</div>
      </div>
    </div>

    <div class="assina-wrap">
      <div class="assina">
        ${blocoAssinaturaHtml(undefined, '#bdb8ab')}
        <div class="nome">${escapeHtml(dados.tecnico.nome)}</div>
        <div class="cargo">${escapeHtml(dados.tecnico.cargo)}</div>
        <div class="cred">${cred}</div>
      </div>
      <div class="assina">
        ${blocoAssinaturaHtml(dados.assinaturaDigital, '#bdb8ab')}
        <div class="nome">${escapeHtml(dados.cliente.nome)}</div>
        <div class="cargo">Recebedor / Cliente</div>
        <div class="cred">${escapeHtml(dados.cliente.cpfCnpj)}</div>
      </div>
    </div>
  </div>

  <div class="faixa-dourada">
    <span>ROMATEC CONSULTORIA TOTAL · romateccrm@gmail.com</span>
    <span>${escapeHtml(dados.numero)}</span>
  </div>
</div>
</body></html>`;
}

export async function gerarReciboPdfPrime2(dados: ReciboDados): Promise<Buffer> {
  const qr = await gerarQrCodeBase64(dados.urlVerificacao);
  return htmlToPdf(buildReciboPrime2Html(dados, qr));
}
