// v3.92.0 — Geração do PDF de recibo de Mão de Obra Avulsa (PDFKit real).
// Cobre: PDF válido (%PDF) com dados completos; selo quando status='confirmado'.
import { describe, it, expect } from 'vitest';
import { gerarPdfMaoObraAvulsa } from '../services/maoObraAvulsaPdf';
import type { Recibo } from '../integrations/recibos';
import type { MaoObraAvulsa } from '../integrations/maoObraAvulsa';

function fakeRecibo(over: Partial<Recibo> = {}): Recibo {
  return {
    id: 10, numero: 'REC-MAO-2026-0001', tipo: 'mao_obra_avulsa',
    hash_validacao: 'a'.repeat(64), token: 'b'.repeat(64), status: 'enviado',
    valor: 300, destinatario_nome: 'Zé', destinatario_phone: '5599999999999',
    ...over,
  } as unknown as Recibo;
}
function fakeDet(over: Partial<MaoObraAvulsa> = {}): MaoObraAvulsa {
  return {
    id: 5, obra_id: 1, recibo_id: 10, nome_prestador: 'José Pedreiro',
    telefone_whatsapp: '5599999999999', cpf: '123.456.789-00',
    tipo_servico: 'Assentamento de piso', descricao_servico: '120m² porcelanato',
    valor_pago: 300, forma_pagamento: 'pix', data_pagamento: '2026-07-04',
    comprovante_nome: null, comprovante_mime: null,
    created_at: '2026-07-04', updated_at: '2026-07-04', obra_nome: 'GBOX PRIME',
    ...over,
  } as MaoObraAvulsa;
}

describe('gerarPdfMaoObraAvulsa (v3.92.0)', () => {
  it('gera um PDF válido (assinatura %PDF) com dados completos', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo(), fakeDet());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('gera PDF com selo quando status=confirmado (contra-recibo)', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo({ status: 'confirmado' }), fakeDet());
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('embute comprovante quando é imagem base64', async () => {
    const img1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo(), fakeDet(), { comprovante: { mime: 'image/png', base64: img1x1 } });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
