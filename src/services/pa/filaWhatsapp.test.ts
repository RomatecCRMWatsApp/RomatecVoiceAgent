// v3.146.1 — Fila de envio em lote: um por vez, intervalo sorteado, para em falha da Z-API.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), num: Number, registrarEvento: vi.fn(async () => undefined) }));

import { iniciarFila, estadoFila, pararFila, RITMO, variarSaudacao, sorteio } from './paWhatsapp';
import { PaErro } from './erros';

const esperarFim = async () => { for (let i = 0; i < 200 && estadoFila()?.status === 'RODANDO'; i++) await new Promise((r) => setTimeout(r, 10)); };

describe('fila de envio (anti-bloqueio)', () => {
  it('envia um por vez com intervalo sorteado dentro da faixa', async () => {
    RITMO.entreAssociadosMs = [40, 60];
    const horas: number[] = [];
    iniciarFila(1, [1, 2, 3].map((n) => ({ associado_id: n, nome: 'A' + n, lancamento_ids: [n] })), 'u', async () => { horas.push(Date.now()); });
    await esperarFim();
    const f = estadoFila()!;
    expect(f.status).toBe('CONCLUIDA');
    expect(f.enviados).toBe(3);
    for (let i = 1; i < horas.length; i++) expect(horas[i] - horas[i - 1]).toBeGreaterThanOrEqual(38);
  });
  it('não deixa abrir 2 filas ao mesmo tempo e o Parar interrompe', async () => {
    RITMO.entreAssociadosMs = [200, 200];
    iniciarFila(1, [1, 2, 3, 4].map((n) => ({ associado_id: n, nome: 'A' + n, lancamento_ids: [n] })), 'u', async () => undefined);
    expect(() => iniciarFila(1, [{ associado_id: 9, nome: 'X', lancamento_ids: [9] }], 'u', async () => undefined)).toThrow(/em andamento/);
    await new Promise((r) => setTimeout(r, 30));
    pararFila();
    await esperarFim();
    expect(estadoFila()!.status).toBe('PARADA');
    expect(estadoFila()!.enviados).toBeLessThan(4);
  });
  it('falha da Z-API (número bloqueado/desconectado) para a fila na hora', async () => {
    RITMO.entreAssociadosMs = [5, 5];
    let n = 0;
    iniciarFila(1, [1, 2, 3].map((k) => ({ associado_id: k, nome: 'A' + k, lancamento_ids: [k] })), 'u', async () => { n++; throw new PaErro('ZAPI_INDISPONIVEL', 'bloqueado', 502); });
    await esperarFim();
    expect(estadoFila()!.status).toBe('ERRO');
    expect(n).toBe(1);
  });
  it('saudação varia e sorteio respeita a faixa', () => {
    const t = variarSaudacao('Olá, Cícero! Aqui é a Zayra');
    expect(t).toMatch(/^(Olá|Oi|Bom dia|Boa tarde|Boa noite), Cícero!/);
    for (let i = 0; i < 50; i++) { const v = sorteio(30_000, 60_000); expect(v).toBeGreaterThanOrEqual(30_000); expect(v).toBeLessThanOrEqual(60_000); }
  });
});
