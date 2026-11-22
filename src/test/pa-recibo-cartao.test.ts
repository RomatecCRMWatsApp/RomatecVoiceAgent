import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseReciboHtml, validarUrlRecibo, destinoEhRomatec } from '../services/pa/infinitepay';
import { aplicarRecibo } from '../services/pa/paFinanceiro';

const html = readFileSync(path.join(__dirname, '../services/pa/__fixtures__/recibo-infinitepay-cartao.html'), 'utf8');
describe('v3.198.3 recibo InfinitePay de cartão (InfiniteTap)', () => {
  it('aceita o link do recibo de cartão (UUID do NSU) e continua aceitando o de Pix', () => {
    expect(validarUrlRecibo('https://recibo.infinitepay.io/40F85543-F788-4F8D-9B28-82D8052A3360').hostname).toBe('recibo.infinitepay.io');
    expect(validarUrlRecibo('https://recibo.infinitepay.io/statements/abc123').hostname).toBe('recibo.infinitepay.io');
    expect(() => validarUrlRecibo('https://recibo.infinitepay.io/qualquer-coisa')).toThrow();
  });
  it('lê valor, data, crédito, bandeira, final, NSU, AUT e destino Romatec', () => {
    const r = parseReciboHtml(html);
    expect(r.valor).toBe(370.34);
    expect(r.pago_em).toBe('2026-11-21 13:52:00');
    expect(r.forma).toBe('CARTAO_CREDITO');
    expect(r.cartao).toMatchObject({ bandeira: 'VISA', final: '1038', nsu: '40F85543-F788-4F8D-9B28-82D8052A3360', aut: '016670' });
    expect(r.id_transacao).toBe('NSU-40F85543-F788-4F8D-9B28-82D8052A3360');
    expect(destinoEhRomatec(r)).toBe(true);
    expect(r.origem.cpf).toBeNull();
  });
  it('lançamento pelo recibo de cartão sai como CARTAO_CREDITO (não Pix)', () => {
    const p = aplicarRecibo({ forma: 'PIX', valor: 0, pago_em: null, id_transacao: null } as never, parseReciboHtml(html));
    expect(p.forma).toBe('CARTAO_CREDITO');
    expect(p.valor).toBe(370.34);
  });
});
