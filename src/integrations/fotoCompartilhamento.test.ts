// v3.28.0: testes do orquestrador de compartilhamento multi-canal.
// Standalone — zero deps externas (sem mysql/pdfkit/voyageai).
// Repositorio e senders sao mockados via injecao de dependencia.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  compartilharFoto,
  resetEstadoCompartilhamento,
  truncarDestinatario,
  montarLegenda,
  __internals,
  type FotoArquivo,
  type LogRepo,
  type Senders,
  type CompartilharInput,
} from './fotoCompartilhamento';

interface LogEntry {
  id: number;
  foto_id: number;
  canal: string;
  user_id: number;
  destinatario: string | null;
  idempotency_key: string | null;
  status: 'pendente' | 'sucesso' | 'erro';
  zapi_message_id?: string | null;
  telegram_message_id?: number | null;
  mensagem_erro?: string;
}

function makeFakeRepo() {
  const entries: LogEntry[] = [];
  let nextId = 1;
  const repo: LogRepo = {
    async registrarPendente(input) {
      const id = nextId++;
      entries.push({
        id, ...input, destinatario: input.destinatario ?? null,
        idempotency_key: input.idempotency_key ?? null,
        status: 'pendente',
      });
      return id;
    },
    async registrarSucesso(id, fields) {
      const e = entries.find((x) => x.id === id);
      if (e) {
        e.status = 'sucesso';
        if (fields.zapi_message_id !== undefined) e.zapi_message_id = fields.zapi_message_id;
        if (fields.telegram_message_id !== undefined) e.telegram_message_id = fields.telegram_message_id;
      }
    },
    async registrarErro(id, msg) {
      const e = entries.find((x) => x.id === id);
      if (e) {
        e.status = 'erro';
        e.mensagem_erro = msg;
      }
    },
    async buscarPorIdempotencyKey() {
      return null;
    },
  };
  return { repo, entries };
}

function fotoFake(sizeBytes = 100_000): FotoArquivo {
  return {
    id: 42,
    mime: 'image/jpeg',
    buffer: Buffer.alloc(sizeBytes, 0xff),
    lat: -4.69916,
    lng: -47.49593,
    capturada_em: '2026-05-27T19:12:00.000Z',
  };
}

function sendersFake(overrides?: Partial<Senders>) {
  const senders: Senders = {
    whatsapp: vi.fn(async () => ({ messageId: 'msg-wa-1' })),
    telegram: vi.fn(async () => ({ messageId: 999001 })),
    ...overrides,
  };
  return senders;
}

beforeEach(() => {
  resetEstadoCompartilhamento();
});

describe('fotoCompartilhamento — orquestracao (v3.28.0)', () => {
  it('1. Dispara apenas WhatsApp quando so whatsapp e pedido', async () => {
    const { repo } = makeFakeRepo();
    const senders = sendersFake();
    const input: CompartilharInput = {
      foto_id: 42, user_id: 1, canais: ['whatsapp'],
      destinatario_whatsapp: '5598999999999',
    };
    const r = await compartilharFoto(input, fotoFake(), {
      log: repo, senders, delayMs: async () => {},
    });
    expect(senders.whatsapp).toHaveBeenCalledTimes(1);
    expect(senders.telegram).not.toHaveBeenCalled();
    expect(r[0].canal).toBe('whatsapp');
    expect(r[0].status).toBe('sucesso');
  });

  it('2. Dispara WhatsApp + Telegram em paralelo', async () => {
    const { repo } = makeFakeRepo();
    const senders = sendersFake();
    const input: CompartilharInput = {
      foto_id: 42, user_id: 1, canais: ['whatsapp', 'telegram'],
      destinatario_whatsapp: '5598999999999',
      destinatario_telegram: '@romatec_obras',
    };
    const r = await compartilharFoto(input, fotoFake(), {
      log: repo, senders, delayMs: async () => {},
    });
    expect(senders.whatsapp).toHaveBeenCalledTimes(1);
    expect(senders.telegram).toHaveBeenCalledTimes(1);
    expect(r.map((x) => x.canal).sort()).toEqual(['telegram', 'whatsapp']);
    expect(r.every((x) => x.status === 'sucesso')).toBe(true);
  });

  it('3. Falha em WhatsApp NAO derruba Telegram (Promise.allSettled)', async () => {
    const { repo, entries } = makeFakeRepo();
    const senders = sendersFake({
      whatsapp: vi.fn(async () => { throw new Error('Z-API timeout'); }),
    });
    const r = await compartilharFoto({
      foto_id: 42, user_id: 1, canais: ['whatsapp', 'telegram'],
      destinatario_whatsapp: '5598999999999',
      destinatario_telegram: '@romatec_obras',
    }, fotoFake(), { log: repo, senders, delayMs: async () => {} });
    const wa = r.find((x) => x.canal === 'whatsapp');
    const tg = r.find((x) => x.canal === 'telegram');
    expect(wa?.status).toBe('erro');
    expect(wa?.erro).toMatch(/Z-API timeout/);
    expect(tg?.status).toBe('sucesso');
    // Log audita ambas tentativas
    expect(entries.filter((e) => e.canal === 'whatsapp')[0].status).toBe('erro');
    expect(entries.filter((e) => e.canal === 'telegram')[0].status).toBe('sucesso');
  });

  it('4. Registra cada tentativa em fotos_envios_log', async () => {
    const { repo, entries } = makeFakeRepo();
    const senders = sendersFake();
    await compartilharFoto({
      foto_id: 42, user_id: 1, canais: ['whatsapp', 'telegram', 'celular_download'],
      destinatario_whatsapp: '5598999999999',
      destinatario_telegram: '@romatec_obras',
    }, fotoFake(), { log: repo, senders, delayMs: async () => {} });
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.canal).sort()).toEqual(['celular_download', 'telegram', 'whatsapp']);
    expect(entries.every((e) => e.status === 'sucesso')).toBe(true);
  });

  it('5. Formata legenda default com coords e timestamp', () => {
    const foto = fotoFake();
    const leg = montarLegenda(undefined, foto);
    expect(leg).toMatch(/Romatec/);
    expect(leg).toMatch(/-4\.69916/);
    expect(leg).toMatch(/-47\.49593/);
    expect(leg).toMatch(/2026/);
    // Legenda fornecida tem precedencia
    expect(montarLegenda('  Vistoria X  ', foto)).toBe('Vistoria X');
  });

  it('6. Resize aplicado quando imagem > 4 MB', async () => {
    const { repo } = makeFakeRepo();
    const senders = sendersFake();
    let resizeFoiChamado = false;
    const resizer = vi.fn(async (buffer: Buffer, mime: string) => {
      resizeFoiChamado = true;
      return { buffer: Buffer.alloc(1024), mime };
    });
    const fotoGigante: FotoArquivo = { ...fotoFake(5 * 1024 * 1024) };
    await compartilharFoto(
      { foto_id: 42, user_id: 1, canais: ['whatsapp'], destinatario_whatsapp: '5598999999999' },
      fotoGigante,
      { log: repo, senders, resizer, delayMs: async () => {} },
    );
    expect(resizeFoiChamado).toBe(true);
    expect(resizer).toHaveBeenCalledWith(fotoGigante.buffer, 'image/jpeg');
  });

  it('7. Resize NAO aplicado quando imagem <= 4 MB (resizer recebe mas decide passar)', async () => {
    const { repo } = makeFakeRepo();
    const senders = sendersFake();
    // O resizer default (sharp) checa o tamanho internamente. O contrato:
    // se buffer <= RESIZE_LIMIT_BYTES, retorna o mesmo buffer/mime.
    const fotoPequena = fotoFake(100_000);
    const r = await __internals.resizerSharp(fotoPequena.buffer, fotoPequena.mime);
    expect(r.buffer).toBe(fotoPequena.buffer);
    expect(r.mime).toBe('image/jpeg');
    // Smoke: o caller nao precisa logar nada
    await compartilharFoto(
      { foto_id: 42, user_id: 1, canais: ['whatsapp'], destinatario_whatsapp: '5598999999999' },
      fotoPequena,
      { log: repo, senders, delayMs: async () => {} },
    );
  });

  it('8. Rate limit Z-API: 2 envios consecutivos tem 2s de delay', async () => {
    const { repo } = makeFakeRepo();
    const senders = sendersFake();
    const delays: number[] = [];
    const delayMs = async (ms: number) => { delays.push(ms); };
    // Primeiro envio — sem delay
    await compartilharFoto(
      { foto_id: 42, user_id: 1, canais: ['whatsapp'], destinatario_whatsapp: '5598999999999' },
      fotoFake(),
      { log: repo, senders, delayMs },
    );
    expect(delays).toEqual([]); // primeiro envio nao espera
    // Segundo envio imediato — deve esperar perto de 2000ms
    await compartilharFoto(
      { foto_id: 43, user_id: 1, canais: ['whatsapp'], destinatario_whatsapp: '5598999999999' },
      fotoFake(),
      { log: repo, senders, delayMs },
    );
    expect(delays.length).toBe(1);
    expect(delays[0]).toBeGreaterThan(1500);
    expect(delays[0]).toBeLessThanOrEqual(2000);
  });

  it('9. Idempotency-Key repetida em 60s retorna mesmo resultado', async () => {
    const { repo } = makeFakeRepo();
    const senders = sendersFake();
    const input: CompartilharInput = {
      foto_id: 42, user_id: 1, canais: ['whatsapp'],
      destinatario_whatsapp: '5598999999999',
      idempotency_key: 'abc-123',
    };
    const r1 = await compartilharFoto(input, fotoFake(), { log: repo, senders, delayMs: async () => {} });
    const r2 = await compartilharFoto(input, fotoFake(), { log: repo, senders, delayMs: async () => {} });
    expect(r2).toBe(r1); // mesma referencia (cache)
    expect(senders.whatsapp).toHaveBeenCalledTimes(1); // segundo nao re-enviou
  });

  it('10. Idempotency-Key apos 60s permite novo envio', async () => {
    vi.useFakeTimers();
    try {
      const { repo } = makeFakeRepo();
      const senders = sendersFake();
      const input: CompartilharInput = {
        foto_id: 42, user_id: 1, canais: ['whatsapp'],
        destinatario_whatsapp: '5598999999999',
        idempotency_key: 'abc-old',
      };
      await compartilharFoto(input, fotoFake(), { log: repo, senders, delayMs: async () => {} });
      vi.advanceTimersByTime(61_000);
      await compartilharFoto(input, fotoFake(), { log: repo, senders, delayMs: async () => {} });
      expect(senders.whatsapp).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('11. Destinatario truncado em log de aplicacao (+55****07840)', () => {
    expect(truncarDestinatario('5599991507840')).toBe('+55****07840');
    expect(truncarDestinatario('@romatec_obras')).toBe('@rom****');
    expect(truncarDestinatario('@x')).toBe('@x'); // muito curto fica intacto
    expect(truncarDestinatario('')).toBe('');
  });

  it('12. Destinatario completo persistido em fotos_envios_log', async () => {
    const { repo, entries } = makeFakeRepo();
    const senders = sendersFake();
    await compartilharFoto({
      foto_id: 42, user_id: 1, canais: ['whatsapp', 'telegram'],
      destinatario_whatsapp: '5599991507840',
      destinatario_telegram: '@romatec_obras',
    }, fotoFake(), { log: repo, senders, delayMs: async () => {} });
    const wa = entries.find((e) => e.canal === 'whatsapp');
    const tg = entries.find((e) => e.canal === 'telegram');
    expect(wa?.destinatario).toBe('5599991507840'); // completo, sem mascara
    expect(tg?.destinatario).toBe('@romatec_obras');
  });
});
