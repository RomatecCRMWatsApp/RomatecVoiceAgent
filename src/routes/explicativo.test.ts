import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../database/connection', () => ({
  default: { query: vi.fn(), execute: vi.fn() },
}));
vi.mock('../services/textoExplicativoService', () => ({
  gerarTextoExplicativo: vi.fn(),
  calcularBaseLegal: vi.fn(),
}));
vi.mock('../services/textoExplicativoEnvio', () => ({
  enviarTextoExplicativo: vi.fn(),
}));

import pool from '../database/connection';
import { gerarTextoExplicativo } from '../services/textoExplicativoService';
import { enviarTextoExplicativo } from '../services/textoExplicativoEnvio';
import explicativoRouter from './explicativo';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/explicativo', explicativoRouter);
  return app;
}

const queryMock = pool.query as ReturnType<typeof vi.fn>;
const executeMock = pool.execute as ReturnType<typeof vi.fn>;
const gerarMock = gerarTextoExplicativo as ReturnType<typeof vi.fn>;
const enviarMock = enviarTextoExplicativo as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe('POST /api/explicativo/preview', () => {
  it('retorna texto renderizado', async () => {
    gerarMock.mockResolvedValueOnce('TEXTO PREVIEW');
    const r = await request(buildApp())
      .post('/api/explicativo/preview')
      .send({ tipoServico: 'remembramento', clienteNome: 'Maria' });
    expect(r.status).toBe(200);
    expect(r.body.texto).toBe('TEXTO PREVIEW');
  });

  it('400 quando service lança', async () => {
    gerarMock.mockRejectedValueOnce(new Error('Template não encontrado'));
    const r = await request(buildApp())
      .post('/api/explicativo/preview')
      .send({ tipoServico: 'remembramento', clienteNome: 'X' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/Template/);
  });
});

describe('POST /api/explicativo/enviar-avulso', () => {
  it('envia e retorna ok=true', async () => {
    enviarMock.mockResolvedValueOnce({ ok: true, messageId: 'ABC' });
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-avulso')
      .send({
        dados: { tipoServico: 'remembramento', clienteNome: 'Maria' },
        numeroDestino: '5598999999999',
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(enviarMock).toHaveBeenCalledWith(
      expect.objectContaining({ modoEnvio: 'avulso' }),
    );
  });
});

describe('POST /api/explicativo/enviar-com-proposta/:id', () => {
  it('404 quando proposta não existe', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-com-proposta/99')
      .send({});
    expect(r.status).toBe(404);
  });

  it('retorna pulou=true quando toggle desligado', async () => {
    queryMock.mockResolvedValueOnce([
      [{
        id: 7, cliente_id: 3, cliente_nome: 'Maria', telefone: '5598999999999',
        subtipo_consultoria: 'remembramento', dados_imovel: '{}',
        enviar_explicativo_junto: 0,
      }],
    ]);
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-com-proposta/7')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.pulou).toBe(true);
    expect(enviarMock).not.toHaveBeenCalled();
  });

  it('envia quando toggle ligado e proposta válida', async () => {
    queryMock.mockResolvedValueOnce([
      [{
        id: 7, cliente_id: 3, cliente_nome: 'Maria', telefone: '5598999999999',
        subtipo_consultoria: 'remembramento',
        dados_imovel: JSON.stringify({
          imoveis: [{ ordem: 1 }, { ordem: 2 }],
          tipo_zona: 'urbana', municipio: 'Açailândia', uf: 'MA',
        }),
        enviar_explicativo_junto: 1,
      }],
    ]);
    enviarMock.mockResolvedValueOnce({ ok: true, messageId: 'ZZ' });
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-com-proposta/7')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(enviarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modoEnvio: 'com_proposta',
        propostaId: 7,
        dados: expect.objectContaining({
          tipoServico: 'remembramento',
          clienteNome: 'Maria',
          quantidadeImoveis: 2,
          municipio: 'Açailândia',
          uf: 'MA',
          tipoImovel: 'urbano',
        }),
      }),
    );
  });
});

describe('GET /api/explicativo/templates', () => {
  it('lista templates ativos', async () => {
    queryMock.mockResolvedValueOnce([
      [
        { id: 1, tipo_servico: 'remembramento', titulo: 'T1', ativo: 1 },
        { id: 2, tipo_servico: 'desmembramento', titulo: 'T2', ativo: 1 },
      ],
    ]);
    const r = await request(buildApp()).get('/api/explicativo/templates');
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
  });
});

describe('PUT /api/explicativo/templates/:tipo', () => {
  it('atualiza template e retorna ok', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const r = await request(buildApp())
      .put('/api/explicativo/templates/remembramento')
      .send({ template_texto: 'NOVO {{cliente_nome}}', titulo: 'Atualizado' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('400 quando tipo inválido', async () => {
    const r = await request(buildApp())
      .put('/api/explicativo/templates/foo')
      .send({ template_texto: 'X' });
    expect(r.status).toBe(400);
  });
});

describe('POST /api/explicativo/enviar-avulso — validação de número', () => {
  it('400 quando numeroDestino contém só ruído', async () => {
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-avulso')
      .send({
        dados: { tipoServico: 'remembramento', clienteNome: 'X' },
        numeroDestino: 'abc',
      });
    expect(r.status).toBe(400);
    expect(enviarMock).not.toHaveBeenCalled();
  });

  it('aceita número com máscara e normaliza para dígitos', async () => {
    enviarMock.mockResolvedValueOnce({ ok: true, messageId: 'OK' });
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-avulso')
      .send({
        dados: { tipoServico: 'remembramento', clienteNome: 'Maria' },
        numeroDestino: '(98) 99999-9999',
      });
    expect(r.status).toBe(200);
    expect(enviarMock).toHaveBeenCalledWith(
      expect.objectContaining({ numeroDestino: '98999999999' }),
    );
  });
});

describe('POST /api/explicativo/enviar-com-proposta/:id — validação de telefone', () => {
  it('400 quando telefone do cliente é inválido', async () => {
    queryMock.mockResolvedValueOnce([
      [{
        id: 7, cliente_id: 3, cliente_nome: 'Maria',
        telefone: 'lixo',
        subtipo_consultoria: 'remembramento',
        dados_imovel: '{}',
        enviar_explicativo_junto: 1,
      }],
    ]);
    const r = await request(buildApp())
      .post('/api/explicativo/enviar-com-proposta/7')
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/[Tt]elefone/);
    expect(enviarMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/explicativo/templates/:tipo — affectedRows', () => {
  it('404 quando UPDATE não afeta nenhuma linha', async () => {
    executeMock.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const r = await request(buildApp())
      .put('/api/explicativo/templates/desmembramento')
      .send({ template_texto: 'X' });
    expect(r.status).toBe(404);
  });
});
