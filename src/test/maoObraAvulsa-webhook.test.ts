// v3.92.0 — Webhook de confirmação de Mão de Obra Avulsa. Garante que NÃO há
// colisão com o vale: só trata quando existe recibo pendente tipo='mao_obra_avulsa'
// pra aquele telefone E a mensagem é uma confirmação. Caso contrário devolve
// handled=false (deixa o fluxo do vale/ZAYRA seguir).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const buscarReciboPendentePorPhone = vi.fn();
const responderRecibo = vi.fn();
const buscarReciboPorId = vi.fn();

vi.mock('../integrations/recibos', () => ({
  buscarReciboPendentePorPhone: (...a: unknown[]) => buscarReciboPendentePorPhone(...a),
  responderRecibo: (...a: unknown[]) => responderRecibo(...a),
  buscarReciboPorId: (...a: unknown[]) => buscarReciboPorId(...a),
}));
vi.mock('../integrations/maoObraAvulsa', () => ({
  buscarPorReciboId: vi.fn().mockResolvedValue(null), // pula reenvio do contra-recibo
  comprovanteB64: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/maoObraAvulsaPdf', () => ({ gerarPdfMaoObraAvulsa: vi.fn().mockResolvedValue(Buffer.from('%PDF')) }));
vi.mock('../integrations/whatsapp', () => ({ sendReply: vi.fn().mockResolvedValue({}), sendDocument: vi.fn().mockResolvedValue({}) }));

import { processarConfirmacaoMaoObra } from '../services/maoObraAvulsaWebhook';

describe('processarConfirmacaoMaoObra — cross-lookup sem colisão (v3.92.0)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sem recibo avulso pendente → handled=false (não sequestra vale/ZAYRA)', async () => {
    buscarReciboPendentePorPhone.mockResolvedValue(null);
    const r = await processarConfirmacaoMaoObra({ phone: '5599999999999', text: 'CONFIRMAR' });
    expect(r.handled).toBe(false);
    expect(responderRecibo).not.toHaveBeenCalled();
  });

  it('recibo avulso pendente + "CONFIRMAR" → confirma (handled=true)', async () => {
    buscarReciboPendentePorPhone.mockResolvedValue({ id: 7, token: 'tok123', destinatario_phone: '5599999999999' });
    responderRecibo.mockResolvedValue({});
    buscarReciboPorId.mockResolvedValue(null); // pula reenvio
    const r = await processarConfirmacaoMaoObra({ phone: '5599999999999', text: 'CONFIRMAR recebi' });
    expect(r.handled).toBe(true);
    expect(r.acao).toBe('confirmou_mao_obra');
    expect(responderRecibo).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok123', acao: 'confirma' }));
  });

  it('recibo avulso pendente MAS mensagem não é confirmação → handled=false', async () => {
    buscarReciboPendentePorPhone.mockResolvedValue({ id: 7, token: 'tok', destinatario_phone: '5599999999999' });
    const r = await processarConfirmacaoMaoObra({ phone: '5599999999999', text: 'quanto foi mesmo?' });
    expect(r.handled).toBe(false);
    expect(responderRecibo).not.toHaveBeenCalled();
  });

  it('lookup usa o tipo mao_obra_avulsa (não colide com vale)', async () => {
    buscarReciboPendentePorPhone.mockResolvedValue(null);
    await processarConfirmacaoMaoObra({ phone: '5599999999999', text: 'ok' });
    expect(buscarReciboPendentePorPhone).toHaveBeenCalledWith('5599999999999', 'mao_obra_avulsa');
  });
});
