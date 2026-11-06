// src/modules/assinatura/notificar.ts
// v3.152.0 — Avisa o RT (José Romário) que há um lote aguardando assinatura.
// Telegram primeiro (TELEGRAM_AUTHORIZED_USER_IDS); se vazio/falhar, fallback
// WhatsApp via Z-API (CEO_WHATSAPP_PHONE). NUNCA lança: falha de notificação não
// derruba o enfileiramento — o link de aprovação volta na resposta do upload.
import { sendMessage, escapeMd } from '../../integrations/telegram.js';
import { sendReply } from '../../integrations/whatsapp.js';
import type { DocumentoResumo } from './chatLotes.js';

function destinatariosTelegram(): string[] {
  return (process.env.TELEGRAM_AUTHORIZED_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function fmtTamanho(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export interface ResultadoNotificacao {
  canal: 'telegram' | 'whatsapp' | 'nenhum';
  erro?: string;
}

export async function notificarAprovacao(params: {
  tituloLote: string;
  documentos: DocumentoResumo[];
  linkAprovacao: string;
  expiraMinutos: number;
}): Promise<ResultadoNotificacao> {
  const docsTxt = params.documentos
    .map((d) => `• ${d.titulo} (${d.paginas || '?'} pág., ${fmtTamanho(d.tamanho)})`)
    .join('\n');

  const corpo =
    `✍️ Assinatura solicitada pelo Claude\n` +
    `${params.tituloLote}\n` +
    `${docsTxt}\n\n` +
    `Válido por ${params.expiraMinutos} min.\n` +
    `Conferir e assinar:\n${params.linkAprovacao}`;

  // 1) Telegram (escapa _*`[ nos textos; a URL vai crua — sendMessage faz retry sem markdown se precisar)
  const ids = destinatariosTelegram();
  if (ids.length > 0) {
    const textoTg =
      `✍️ *Assinatura solicitada pelo Claude*\n` +
      `${escapeMd(params.tituloLote)}\n` +
      params.documentos.map((d) => `• ${escapeMd(d.titulo)} (${d.paginas || '?'} pág., ${fmtTamanho(d.tamanho)})`).join('\n') +
      `\n\nVálido por ${params.expiraMinutos} min.\nConferir e assinar:\n${params.linkAprovacao}`;
    try {
      await Promise.all(ids.map((id) => sendMessage(id, textoTg)));
      return { canal: 'telegram' };
    } catch (e) {
      console.warn('[assinatura.notificar] Telegram falhou, tentando WhatsApp:', (e as Error).message);
    }
  }

  // 2) Fallback WhatsApp (Z-API)
  const fone = (process.env.CEO_WHATSAPP_PHONE ?? '').trim();
  if (fone) {
    try {
      await sendReply(fone, corpo);
      return { canal: 'whatsapp' };
    } catch (e) {
      console.error('[assinatura.notificar] WhatsApp também falhou:', (e as Error).message);
      return { canal: 'nenhum', erro: (e as Error).message };
    }
  }

  return { canal: 'nenhum', erro: 'Sem TELEGRAM_AUTHORIZED_USER_IDS nem CEO_WHATSAPP_PHONE configurados' };
}
