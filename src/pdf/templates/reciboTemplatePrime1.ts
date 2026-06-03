// v1.99.16 — Template Prime I (Dark Premium) para Recibos / Vales.
// Mesma linguagem visual da proposta Prime I. Bloco de validacao (QR+hash+url),
// assinatura digital, selo CONFIRMADO diagonal (texto branco).
// buildHtml e' puro (recebe o QR ja gerado); gerar*Pdf cria QR + renderiza.

import type { ReciboDados, ReciboParcela } from '../../types/templateTypes';
import { htmlToPdf } from '../htmlToPdf';
import {
  CORES,
  FONTS_PRIME1,
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

export function buildReciboPrime1Html(dados: ReciboDados, qrDataUrl: string): string {
  const parcelas = (dados.parcelas ?? []).map(fmtParcela).join('');
  const cred = dados.tecnico.credenciais.map((c) => escapeHtml(c)).join(' · ');
  const selo = dados.confirmado
    ? `<div class="selo">✓ CONFIRMADO</div>`
    : '';
  const tabelaParcelas = parcelas
    ? `<table class="itens">
         <thead><tr><th>Parcela</th><th>Pagamento</th><th class="val">Valor</th></tr></thead>
         <tbody>${parcelas}</tbody>
       </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
${FONTS_PRIME1}
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0a; color:#f5f5f0; font-family:'Barlow',sans-serif; font-size:11pt; line-height:1.5; }
.page { width:210mm; min-height:297mm; position:relative; }
/* v1.99.16: blocos atomicos nao quebram no meio entre paginas (recibo longo flui em vez de cortar) */
.valor-card, .dado, .servico-box, .validacao-bloco, .assina, table.itens tr {
  break-inside:avoid; page-break-inside:avoid;
}
.label { font-family:'Barlow Condensed',sans-serif; letter-spacing:2px; text-transform:uppercase; color:#9a9a90; font-size:.72rem; }
.bloco { padding:40px 54px; }

/* selo CONFIRMADO diagonal */
.selo { position:absolute; top:300px; left:50%; transform:translateX(-50%) rotate(-22deg); z-index:5;
  border:4px solid rgba(255,255,255,.18); color:rgba(255,255,255,.16);
  font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:5rem; letter-spacing:6px;
  padding:10px 40px; border-radius:10px; pointer-events:none; }

/* header */
.header { position:relative; padding:54px 54px 40px; }
.header::before { content:''; position:absolute; top:0; right:0; width:55%; height:100%;
  background:linear-gradient(135deg,#074a35 0%,#0B6E4F 50%,#0a5a3f 100%);
  clip-path:polygon(18% 0,100% 0,100% 100%,0% 100%); z-index:0; }
.header::after { content:''; position:absolute; top:0; right:0; width:55%; height:5px;
  background:linear-gradient(90deg,transparent,${CORES.dourado},${CORES.douradoBrilho});
  clip-path:polygon(18% 0,100% 0,100% 100%,0% 100%); }
.header-inner { position:relative; z-index:2; display:flex; justify-content:space-between; align-items:flex-start; }
.logo { font-family:'Playfair Display',serif; font-size:1.5rem; }
.logo span { color:${CORES.douradoBrilho}; }
.rec-num { text-align:right; color:#fff; }
.rec-num .numero { font-family:'Barlow Condensed',sans-serif; font-size:2.6rem; font-weight:700; color:${CORES.douradoBrilho}; line-height:1; }
.rec-num .tipo { color:rgba(255,255,255,.8); letter-spacing:3px; font-size:.72rem; }

/* valor destaque */
.valor-card { background:linear-gradient(135deg,${CORES.verdeEscuro},${CORES.verdeEscuro}); border:1px solid ${CORES.dourado}; text-align:center; padding:30px; border-radius:6px; margin-top:8px; }
.valor-card .total { font-family:'Barlow Condensed',sans-serif; font-size:3rem; font-weight:700; color:${CORES.douradoBrilho}; line-height:1.1; }
.valor-card .extenso { color:#dfe9e3; font-style:italic; font-size:.85rem; }

/* dados */
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:8px; }
.dado { background:#141414; border:1px solid #2a2a2a; padding:16px 18px; border-radius:5px; }
.dado .v { font-weight:600; margin-top:3px; }
.servico-box { background:#141414; border:1px solid #2a2a2a; border-left:3px solid ${CORES.dourado}; padding:18px 22px; border-radius:0 5px 5px 0; margin-top:18px; }

/* itens */
table.itens { width:100%; border-collapse:collapse; margin-top:18px; }
table.itens th { text-align:left; color:#9a9a90; font-family:'Barlow Condensed',sans-serif; letter-spacing:1px; font-size:.78rem; padding:8px 4px; border-bottom:1px solid #2a2a2a; }
table.itens th.val, table.itens td.val { text-align:right; }
table.itens td { padding:10px 4px; border-bottom:1px solid #1f1f1f; }
table.itens td.val { color:${CORES.douradoClaro}; font-weight:600; }

/* validacao */
.validacao-bloco { display:flex; gap:22px; align-items:center; background:#0f1512; border:1px solid #243a30; padding:22px 24px; border-radius:6px; margin-top:24px; }
.val-qr img { display:block; width:110px; height:110px; background:#fff; padding:6px; border-radius:4px; }
.val-info { flex:1; }
.val-label { color:${CORES.douradoBrilho}; letter-spacing:2px; font-family:'Barlow Condensed',sans-serif; font-size:.8rem; }
.val-hash { font-family:'Barlow Condensed',sans-serif; color:#cfcfc7; font-size:.78rem; word-break:break-all; margin-top:6px; }
.val-url { color:${CORES.verdeClaro}; font-size:.82rem; margin-top:6px; }

/* assinatura */
.assina-wrap { margin-top:46px; display:flex; justify-content:space-between; align-items:flex-end; }
.assina { width:46%; text-align:center; }
.assina .nome { font-weight:600; margin-top:6px; }
.assina .cargo { color:${CORES.douradoClaro}; font-size:.82rem; }
.assina .cred { color:#9a9a90; font-size:.7rem; margin-top:3px; }

.rodape { background:#000; padding:18px 54px; color:#7a7a72; font-size:.72rem; display:flex; justify-content:space-between; margin-top:30px; }
</style></head><body>
<div class="page">
  ${selo}
  <div class="header">
    <div class="header-inner">
      <div class="logo">Romatec <span>Consultoria Total</span></div>
      <div class="rec-num">
        <div class="tipo">RECIBO</div>
        <div class="numero">${escapeHtml(dados.numero)}</div>
      </div>
    </div>
  </div>

  <div class="bloco">
    <div class="valor-card">
      <div class="label" style="color:rgba(255,255,255,.7)">Valor</div>
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
    ${dados.observacoes ? `<p style="color:#b8b8b0;font-size:.85rem;margin-top:18px;">${escapeHtml(dados.observacoes)}</p>` : ''}

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
        ${blocoAssinaturaHtml(undefined, '#3a3a3a')}
        <div class="nome">${escapeHtml(dados.tecnico.nome)}</div>
        <div class="cargo">${escapeHtml(dados.tecnico.cargo)}</div>
        <div class="cred">${cred}</div>
      </div>
      <div class="assina">
        ${blocoAssinaturaHtml(dados.assinaturaDigital, '#3a3a3a')}
        <div class="nome">${escapeHtml(dados.cliente.nome)}</div>
        <div class="cargo">Recebedor / Cliente</div>
        <div class="cred">${escapeHtml(dados.cliente.cpfCnpj)}</div>
      </div>
    </div>
  </div>

  <div class="rodape">
    <div>Romatec Consultoria Total · romateccrm@gmail.com</div>
    <div>${escapeHtml(dados.numero)}</div>
  </div>
</div>
</body></html>`;
}

export async function gerarReciboPdfPrime1(dados: ReciboDados): Promise<Buffer> {
  const qr = await gerarQrCodeBase64(dados.urlVerificacao);
  return htmlToPdf(buildReciboPrime1Html(dados, qr));
}
