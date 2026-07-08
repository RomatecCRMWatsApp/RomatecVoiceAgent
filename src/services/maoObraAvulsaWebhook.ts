// src/services/maoObraAvulsaWebhook.ts
// v3.92.0 — Confirmação de recibo de Mão de Obra Avulsa via WhatsApp. O prestador
// responde "CONFIRMAR" → acha o recibo (tipo='mao_obra_avulsa') pendente pelo
// telefone, marca confirmado (responderRecibo), regenera o PDF COM selo diagonal
// "✓ CONFIRMADO" e reenvia (contra-recibo). Espelha o auto-reenvio do vale.
import { responderRecibo, buscarReciboPorId, buscarReciboPendentePorPhone } from '../integrations/recibos';
import { buscarPorReciboId, comprovanteB64 } from '../integrations/maoObraAvulsa';
import { gerarPdfMaoObraAvulsa } from './maoObraAvulsaPdf';
import { sendReply, sendDocument } from '../integrations/whatsapp';

const REGEX_CONFIRMA = /(^|\s)(confirm\w*|sim|ok|recebi\w*|de\s*acordo|ta\s*ok|tudo\s*certo|👍|✅)(\s|$|[.!])/i;

export interface RespostaWebhook { handled: boolean; acao?: string }

export async function processarConfirmacaoMaoObra(input: { phone: string; text: string; messageId?: string }): Promise<RespostaWebhook> {
  // Recibo de mão de obra avulsa pendente pra esse telefone (normalização interna).
  const pend = await buscarReciboPendentePorPhone(input.phone, 'mao_obra_avulsa');
  if (!pend) return { handled: false };

  const text = String(input.text || '');
  if (!REGEX_CONFIRMA.test(text.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    // É um recibo avulso pendente, mas a resposta não é confirmação — não trata.
    return { handled: false };
  }

  const phone = pend.destinatario_phone;
  try {
    await responderRecibo({ token: pend.token, acao: 'confirma', obs: `[WhatsApp] ${text.slice(0, 200)}` });
  } catch (e) {
    // Já confirmado antes ou erro — considera tratado (idempotente) sem reenviar.
    console.warn('[mao-obra webhook] responderRecibo:', (e as Error).message.slice(0, 140));
    return { handled: true, acao: 'ja_confirmado_mao_obra' };
  }

  // Contra-recibo: regenera com selo + reenvia (best-effort)
  try {
    const recibo = await buscarReciboPorId(pend.id);
    const det = await buscarPorReciboId(pend.id);
    if (recibo && det) {
      const comp = await comprovanteB64(det.id);
      let pdf = await gerarPdfMaoObraAvulsa(recibo, det, { comprovante: comp });
      try {
        const { getCertForSigning } = await import('./signingCertificates');
        const cert = await getCertForSigning('pj');
        if (cert) {
          const { signPdfBuffer } = await import('./pdfSigner');
          pdf = await signPdfBuffer(pdf, cert.pfx, cert.senha, {
            name: cert.meta.subject_cn ?? 'ROMATEC CONSULTORIA TOTAL',
            reason: `Contra-recibo ${recibo.numero}`, location: 'Açailândia/MA',
            contactInfo: cert.meta.subject_doc ?? '',
          });
        }
      } catch { /* segue sem assinar */ }
      await sendReply(phone, `✅ Recebimento confirmado! Segue o recibo assinado de ${recibo.numero}. Obrigado, ${det.nome_prestador}. — Romatec`);
      await sendDocument(phone, pdf.toString('base64'), `Recibo-${recibo.numero}-confirmado.pdf`);
    }
  } catch (e) {
    console.warn('[mao-obra webhook] reenvio contra-recibo falhou (confirmação registrada):', (e as Error).message.slice(0, 140));
  }
  return { handled: true, acao: 'confirmou_mao_obra' };
}
