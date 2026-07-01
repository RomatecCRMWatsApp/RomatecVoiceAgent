// src/services/vtoChecklistEnvio.ts
// v3.78.0 — Envio do PDF do VTO Checklist via Z-API (cliente do projeto).
// Envia o documento e, em seguida, a legenda como mensagem de texto
// (o endpoint de documento da Z-API não aceita caption).
import { sendDocument, sendReply } from '../integrations/whatsapp';

export async function enviarChecklistWhatsapp(params: {
  telefone: string;
  pdf: Buffer;
  nomeArquivo: string;
  legenda: string;
}): Promise<{ ok: boolean; messageId?: string }> {
  const base64 = params.pdf.toString('base64');
  const doc = await sendDocument(params.telefone, base64, params.nomeArquivo, 'pdf');
  // Legenda em texto — falha aqui não invalida o envio do documento.
  try {
    if (params.legenda?.trim()) await sendReply(params.telefone, params.legenda);
  } catch (err) {
    console.warn('[vtoChecklistEnvio] legenda falhou (documento OK):', (err as Error).message.slice(0, 140));
  }
  return { ok: true, messageId: doc.messageId };
}
