// v1.70.0 — Templates de mensagem WhatsApp por tipo de recibo.
//
// Cada template recebe (recibo, tenant, linkResposta) e retorna texto pronto
// pra Z-API. Markdown leve do WhatsApp: *negrito*, _italico_, ~tachado~,
// ```mono```. Emojis sao OK (utf-8).

import type { Recibo } from '../integrations/recibos';

export interface TenantBrief {
  brand_name?: string | null;
  primary_color?: string | null;
  cnpj?: string | null;
}

const fmtBRL = (n: number | null | undefined): string =>
  n == null ? ''
    : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function brandSig(t: TenantBrief): string {
  return `_${t.brand_name || 'Romatec Consultoria Imobiliária'}_`;
}

export function montarMensagem(
  r: Recibo,
  tenant: TenantBrief,
  link: string
): string {
  const sig = brandSig(tenant);
  const valor = r.valor != null ? fmtBRL(r.valor) : '';

  switch (r.tipo) {
    case 'funcionario':
      return [
        `Olá *${r.destinatario_nome}*!`,
        ``,
        `Segue seu recibo de pagamento ${valor ? `de *${valor}*` : ''}${r.forma_pagamento ? ` via *${r.forma_pagamento.toUpperCase()}*` : ''}.`,
        ``,
        `📄 Recibo *${r.numero}*`,
        `✅ Para confirmar o recebimento:`,
        link,
        ``,
        sig,
      ].join('\n');

    case 'parcela':
      return [
        `Boa tarde, *${r.destinatario_nome}*!`,
        ``,
        `Comprovante de parcela ${valor ? `de *${valor}*` : ''} disponível.`,
        ``,
        `📄 Recibo *${r.numero}*`,
        `🔗 Conferir e confirmar:`,
        link,
        ``,
        `Caso identifique alguma divergência, é só clicar em *Contestar* na página.`,
        ``,
        sig,
      ].join('\n');

    case 'despesa':
      return [
        `*${r.destinatario_nome}*,`,
        ``,
        `Recibo de reembolso ${valor ? `de *${valor}*` : ''} ${r.descricao_servico ? `referente a "${r.descricao_servico}"` : ''}.`,
        ``,
        `📄 ${r.numero}`,
        `🔗 ${link}`,
        ``,
        sig,
      ].join('\n');

    case 'proposta':
      return [
        `Olá *${r.destinatario_nome}*,`,
        ``,
        `Sua proposta está pronta. Para *aceitar e formalizar*, basta tocar no link:`,
        ``,
        `📑 ${r.numero}`,
        `👉 ${link}`,
        ``,
        `_O link tem validade de 7 dias._`,
        ``,
        sig,
      ].join('\n');

    case 'vistoria':
      return [
        `*${r.destinatario_nome}*,`,
        ``,
        `Sua vistoria foi concluída e o relatório está disponível.`,
        ``,
        `📋 *${r.numero}*`,
        `🔗 Conferir e dar ciência:`,
        link,
        ``,
        `Eventuais pendências estão marcadas no documento.`,
        ``,
        sig,
      ].join('\n');

    case 'etapa':
      return [
        `Olá *${r.destinatario_nome}*!`,
        ``,
        `Uma etapa da sua obra foi concluída e está pronta pro seu aceite.`,
        ``,
        `🏗️ *${r.numero}*${r.descricao_servico ? ` — ${r.descricao_servico}` : ''}`,
        `🔗 Conferir e aceitar:`,
        link,
        ``,
        `O aceite libera a continuidade do cronograma.`,
        ``,
        sig,
      ].join('\n');

    case 'chaves':
      return [
        `*ENTREGA DE CHAVES* 🔑`,
        ``,
        `Olá *${r.destinatario_nome}*!`,
        ``,
        `Termo de entrega de chaves disponível para seu aceite final.`,
        ``,
        `📑 *${r.numero}*`,
        `🔗 ${link}`,
        ``,
        `Parabéns! 🎉`,
        ``,
        sig,
      ].join('\n');

    case 'custom':
    default:
      return [
        `*${r.destinatario_nome}*,`,
        ``,
        `Recibo *${r.numero}*${valor ? ` — *${valor}*` : ''}.`,
        ``,
        `🔗 ${link}`,
        ``,
        sig,
      ].join('\n');
  }
}
