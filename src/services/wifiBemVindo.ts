// v3.61.0: Mensagem de boas-vindas do Captive Portal Wi-Fi.
//
// Monta o texto e dispara via Z-API reusando o sender existente do projeto
// (sendReply em src/integrations/whatsapp.ts — instancia dedicada ZAYRA com
// fallback pra CRM). NAO reimplementa Z-API.
//
// O sender ja normaliza o numero (adiciona DDI 55 quando falta e valida
// 10-13 digitos), entao aceita o WhatsApp com ou sem mascara/DDI.

import { sendReply } from '../integrations/whatsapp';

// Numero de contato exibido na mensagem. Configuravel via env; default = CEO.
const CONTATO_WHATSAPP = process.env.ROMATEC_CONTATO_WHATSAPP || '(99) 99181-1246';
const CONTATO_SITE     = process.env.ROMATEC_SITE            || 'romatecavalieimob.com.br';

function montarMensagem(nome: string): string {
  const primeiro = (nome || '').trim().split(/\s+/)[0] || 'visitante';
  return [
    `Olá, ${primeiro}! 👋`,
    'Seja bem-vindo ao Wi-Fi Romatec Consultoria Total.',
    'Você já está conectado! 🌐',
    '',
    'Caso precise de serviços de avaliação imobiliária, topografia ou',
    'regularização de imóveis, estamos à disposição.',
    '',
    '📍 Açailândia/MA',
    `📞 ${CONTATO_WHATSAPP}`,
    `🌎 ${CONTATO_SITE}`,
    '',
    '— Equipe Romatec',
  ].join('\n');
}

/**
 * Envia a mensagem de boas-vindas pro lead via Z-API.
 * @returns true se a Z-API aceitou o envio; false em qualquer falha (logada).
 *          Nunca lanca — o chamador trata como best-effort (boas_vindas=0 se false).
 */
export async function enviarBoasVindasWifi(nome: string, whatsapp: string): Promise<boolean> {
  try {
    await sendReply(whatsapp, montarMensagem(nome));
    return true;
  } catch (err) {
    console.warn('[wifiBemVindo] envio falhou (ignorado):', (err as Error).message);
    return false;
  }
}
