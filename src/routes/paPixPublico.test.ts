import { describe, it, expect } from 'vitest';
import { htmlPaginaPix } from './paPixPublico';

const base = { nome: 'MARIA DAS GRAÇAS', lote: '12', projeto: 'PA Salete Moreno', rotulo: 'Parcela 3/12', valor: 400, vencimento: '2026-11-10', status: 'PENDENTE', pago_em: null, pix: '00020101021226820014br.gov.bcb.pix<script>6304ABCD', url_pdf: 'https://x/pa/boleto/T' };

describe('página pública do Pix do boleto', () => {
  it('botão copiar, código, passo a passo, QR e só o primeiro nome', async () => {
    const h = await htmlPaginaPix(base);
    expect(h).toContain('id="copiar"');
    expect(h).toContain('Copiar código Pix');
    expect(h).toContain('Pix Copia e Cola');
    expect(h).toContain('<svg');
    expect(h).toContain('Maria · Lote 12 · Parcela 3/12');
    expect(h).not.toContain('DAS GRAÇAS');
    expect(h).toContain('&lt;script&gt;'); // código escapado
    expect(h).toContain('1 dia útil');
  });
  it('boleto pago não mostra Pix; sem Pix manda pro código de barras', async () => {
    const pago = await htmlPaginaPix({ ...base, status: 'PAGO', pago_em: '2026-11-06' });
    expect(pago).toContain('já foi pago em 06/11/2026');
    expect(pago).not.toContain('id="copiar"');
    const sem = await htmlPaginaPix({ ...base, pix: null });
    expect(sem).toContain('Pix deste boleto não está disponível');
    expect(sem).not.toContain('id="copiar"');
  });
});
