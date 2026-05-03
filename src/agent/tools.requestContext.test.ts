import { describe, it, expect } from 'vitest';
import {
  runWithRequestContext,
  getCurrentCaller,
  getCurrentSessionId,
  setCurrentCaller,
  setCurrentSessionId,
} from './requestContext';

// v1.65.23: garante que AsyncLocalStorage isola contexto entre chains
// async — issue #2 (race condition que vazava contexto entre Telegram +
// WhatsApp + Web simultaneos). Esses testes nao tocam DB nem providers.

describe('runWithRequestContext (Issue #2)', () => {
  it('isola caller e sessionId dentro do callback', async () => {
    let captured: { caller: any; sessionId: any } = { caller: null, sessionId: null };
    await runWithRequestContext(
      { caller: { role: 'admin', nome: 'Jose' }, sessionId: 'sess-1' },
      async () => {
        captured = {
          caller: getCurrentCaller(),
          sessionId: getCurrentSessionId(),
        };
      },
    );
    expect(captured.caller).toEqual({ role: 'admin', nome: 'Jose' });
    expect(captured.sessionId).toBe('sess-1');
  });

  it('limpa contexto fora do callback', () => {
    expect(getCurrentCaller()).toBeNull();
    expect(getCurrentSessionId()).toBeNull();
  });

  it('nao vaza entre chains concorrentes', async () => {
    const results: Array<{ id: string; caller: any; sessionId: any }> = [];

    // Dispara 3 chains simultaneas com contextos diferentes. Antes do
    // AsyncLocalStorage, a ultima chamada de set sobrescrevia as outras.
    const tasks = [
      runWithRequestContext(
        { caller: { role: 'admin', nome: 'CEO' }, sessionId: 's-A' },
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          results.push({ id: 'A', caller: getCurrentCaller(), sessionId: getCurrentSessionId() });
        },
      ),
      runWithRequestContext(
        { caller: { role: 'leitura', nome: 'Daniele' }, sessionId: 's-B' },
        async () => {
          await new Promise((r) => setTimeout(r, 1));
          results.push({ id: 'B', caller: getCurrentCaller(), sessionId: getCurrentSessionId() });
        },
      ),
      runWithRequestContext(
        { caller: { role: 'comercial', nome: 'Vinicius' }, sessionId: 's-C' },
        async () => {
          await new Promise((r) => setTimeout(r, 3));
          results.push({ id: 'C', caller: getCurrentCaller(), sessionId: getCurrentSessionId() });
        },
      ),
    ];

    await Promise.all(tasks);

    const a = results.find((r) => r.id === 'A')!;
    const b = results.find((r) => r.id === 'B')!;
    const c = results.find((r) => r.id === 'C')!;

    expect(a.caller).toEqual({ role: 'admin', nome: 'CEO' });
    expect(a.sessionId).toBe('s-A');
    expect(b.caller).toEqual({ role: 'leitura', nome: 'Daniele' });
    expect(b.sessionId).toBe('s-B');
    expect(c.caller).toEqual({ role: 'comercial', nome: 'Vinicius' });
    expect(c.sessionId).toBe('s-C');
  });

  it('setCurrentCaller dentro do run muta o store', async () => {
    await runWithRequestContext(
      { caller: { role: 'leitura', nome: 'X' }, sessionId: 'orig' },
      async () => {
        setCurrentCaller({ role: 'admin', nome: 'Y' });
        expect(getCurrentCaller()).toEqual({ role: 'admin', nome: 'Y' });
        setCurrentSessionId('updated');
        expect(getCurrentSessionId()).toBe('updated');
      },
    );
  });

  it('setCurrentCaller fora do run e no-op silencioso', () => {
    setCurrentCaller({ role: 'admin', nome: 'Ghost' });
    setCurrentSessionId('fantasma');
    expect(getCurrentCaller()).toBeNull();
    expect(getCurrentSessionId()).toBeNull();
  });
});
