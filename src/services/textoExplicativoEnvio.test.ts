import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../database/connection', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}));
vi.mock('../integrations/whatsapp', () => ({
  sendReply: vi.fn(),
}));
vi.mock('./textoExplicativoService', () => ({
  gerarTextoExplicativo: vi.fn(),
}));

import pool from '../database/connection';
import { sendReply } from '../integrations/whatsapp';
import { gerarTextoExplicativo } from './textoExplicativoService';
import { enviarTextoExplicativo } from './textoExplicativoEnvio';

const queryMock = pool.query as ReturnType<typeof vi.fn>;
const executeMock = pool.execute as ReturnType<typeof vi.fn>;
const sendReplyMock = sendReply as ReturnType<typeof vi.fn>;
const gerarMock = gerarTextoExplicativo as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  gerarMock.mockResolvedValue('TEXTO RENDERIZADO');
});

describe('enviarTextoExplicativo — sucesso', () => {
  it('renderiza, envia via Z-API e registra status=enviado', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    sendReplyMock.mockResolvedValueOnce({ messageId: 'ZAPI-123', phone: '5598999999999' });
    executeMock.mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }]);

    const r = await enviarTextoExplicativo({
      dados: { tipoServico: 'remembramento', clienteNome: 'Maria' },
      numeroDestino: '5598999999999',
      modoEnvio: 'avulso',
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messageId).toBe('ZAPI-123');
    expect(sendReplyMock).toHaveBeenCalledWith('5598999999999', 'TEXTO RENDERIZADO');

    const insertCall = executeMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO textos_explicativos_envios'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toContain('enviado');
  });
});

describe('enviarTextoExplicativo — deduplicação 60s', () => {
  it('detecta envio recente e bloqueia, registrando status=duplicado', async () => {
    queryMock.mockResolvedValueOnce([[{ id: 99 }]]);
    executeMock.mockResolvedValueOnce([{ insertId: 2 }]);

    const r = await enviarTextoExplicativo({
      dados: { tipoServico: 'remembramento', clienteNome: 'Maria' },
      numeroDestino: '5598999999999',
      modoEnvio: 'avulso',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('duplicado_60s');
    expect(sendReplyMock).not.toHaveBeenCalled();
    const insertCall = executeMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO textos_explicativos_envios'),
    );
    expect(insertCall![1]).toContain('duplicado');
  });
});

describe('enviarTextoExplicativo — erro Z-API', () => {
  it('registra status=erro e relança a exceção', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    sendReplyMock.mockRejectedValueOnce(new Error('ZAPI 500: down'));
    executeMock.mockResolvedValueOnce([{ insertId: 3 }]);

    await expect(
      enviarTextoExplicativo({
        dados: { tipoServico: 'desmembramento', clienteNome: 'João' },
        numeroDestino: '5598888888888',
        modoEnvio: 'com_proposta',
        propostaId: 42,
      }),
    ).rejects.toThrow(/ZAPI 500/);

    const insertCall = executeMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO textos_explicativos_envios'),
    );
    expect(insertCall![1]).toContain('erro');
    expect(insertCall![1]).toContain('ZAPI 500: down');
  });
});
