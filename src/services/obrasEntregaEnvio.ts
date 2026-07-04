// src/services/obrasEntregaEnvio.ts
// v3.81.0 — Envio do PDF do Relatório de Entrega via Z-API (mesmo cliente do
// projeto). Envia o documento e, em seguida, a legenda como texto (o endpoint
// de documento da Z-API não aceita caption). Espelha vtoChecklistEnvio.
import { sendDocument, sendReply } from '../integrations/whatsapp';

export async function enviarEntregaWhatsapp(params: {
  telefone: string;
  pdf: Buffer;
  nomeArquivo: string;
  legenda: string;
}): Promise<{ ok: boolean; messageId?: string }> {
  const base64 = params.pdf.toString('base64');
  const doc = await sendDocument(params.telefone, base64, params.nomeArquivo, 'pdf');
  try {
    if (params.legenda?.trim()) await sendReply(params.telefone, params.legenda);
  } catch (err) {
    console.warn('[obrasEntregaEnvio] legenda falhou (documento OK):', (err as Error).message.slice(0, 140));
  }
  return { ok: true, messageId: doc.messageId };
}
