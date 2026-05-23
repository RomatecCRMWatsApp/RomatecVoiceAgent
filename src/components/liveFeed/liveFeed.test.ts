/**
 * Live Feed Universal — testes do service + router
 * ZAYRA v1.99.15
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';
import { LiveFeedService } from './liveFeedService';
import { createLiveFeedRouter } from './liveFeedRouter';

function makePool(rows: Record<string, unknown>[]): Pool {
  return {
    query: vi.fn().mockResolvedValue([rows, []]),
    execute: vi.fn().mockResolvedValue([rows, []]),
  } as unknown as Pool;
}

describe('LiveFeedService', () => {
  it('retorna estrutura valida para folha mensal', async () => {
    const pool = makePool([
      {
        id: 1,
        nome: 'João Pereira',
        funcao: 'Pedreiro',
        valor_dia: 170,
        obra_nome: 'GBOX PRIME',
        dias_equivalentes: 11,
        total_a_receber: 1870,
      },
    ]);
    const service = new LiveFeedService(pool);
    const result = await service.fetch('folha', { obraId: 1, ano: 2026, mes: 5 });

    expect(result.tab).toBe('folha');
    expect(result.theme).toBe('orange');
    expect(result.counterValue).toBe(1);
    expect(result.title).toContain('Maio');
    expect(result.cards).toBeInstanceOf(Array);
    expect(result.cards[0]).toMatchObject({
      title: 'João Pereira',
      avatar: 'JP',
      metrics: expect.arrayContaining([
        expect.objectContaining({ label: 'Diária' }),
        expect.objectContaining({ label: 'Dias' }),
        expect.objectContaining({ label: 'A Receber' }),
      ]),
    });
  });

  it('rejeita folha sem obraId', async () => {
    const service = new LiveFeedService(makePool([]));
    await expect(service.fetch('folha', {})).rejects.toThrow(/obrigatório/i);
  });

  it('rejeita aba desconhecida', async () => {
    const service = new LiveFeedService(makePool([]));
    // @ts-expect-error testando entrada invalida
    await expect(service.fetch('inexistente', {})).rejects.toThrow(/desconhecida/i);
  });

  it('aplica limit no resultado', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      nome: `Cliente ${i + 1}`,
      cpf_cnpj: null,
      telefone: null,
      cidade: 'Açailândia',
      estado: 'MA',
      qtd_propostas: 0,
      valor_total: 0,
    }));
    const service = new LiveFeedService(makePool(rows));
    const result = await service.fetch('clientes', { limit: 3 });
    expect(result.cards.length).toBe(3);
  });

  it('inclui filtros no retorno', async () => {
    const service = new LiveFeedService(makePool([]));
    const result = await service.fetch('despesas', { obraId: 42 });
    expect(result.filters).toEqual({ obraId: 42 });
  });

  it('passa por todas as 14 abas sem erro', async () => {
    const service = new LiveFeedService(makePool([]));
    const tabs = [
      'painel', 'obras', 'despesas', 'materiais', 'financeiro',
      'clientes', 'colaboradores', 'contratos', 'vales', 'laudos',
      'diarias', 'demarcacoes', 'certs',
    ] as const;
    for (const tab of tabs) {
      const result = await service.fetch(tab, { obraId: 1 });
      expect(result.tab).toBe(tab);
      expect(Array.isArray(result.cards)).toBe(true);
    }
  });

  it('avatar gera iniciais corretas', async () => {
    const pool = makePool([
      { id: 1, nome: 'Ana Maria Silva', funcao: 'Engenheira', valor_dia: 200, telefone: null, tipo_contrato: 'clt', qtd_obras: 2, dias_30d: 15 },
    ]);
    const service = new LiveFeedService(pool);
    const result = await service.fetch('colaboradores');
    expect(result.cards[0].avatar).toBe('AS');
  });

  it('formata BRL no metric value', async () => {
    const pool = makePool([
      { id: 1, nome: 'Obra X', cliente: 'João', cidade: 'Açailândia', orcamento: 1500, valor_contrato: null, consumo: 0, qtd_etapas_atrasadas: 0 },
    ]);
    const service = new LiveFeedService(pool);
    const result = await service.fetch('painel');
    const orcMetric = result.cards[0].metrics.find((m) => m.label === 'Orçamento');
    expect(orcMetric?.value).toMatch(/R\$\s*1\.500,00/);
  });
});

describe('LiveFeedRouter', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use('/api/live-feed', createLiveFeedRouter(makePool([])));
  });

  it('GET aba valida retorna 200 + JSON', async () => {
    const res = await request(app).get('/api/live-feed/painel');
    expect(res.status).toBe(200);
    expect(res.body.tab).toBe('painel');
    expect(Array.isArray(res.body.cards)).toBe(true);
  });

  it('aba invalida retorna 404', async () => {
    const res = await request(app).get('/api/live-feed/foo');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/desconhecida/i);
  });

  it('folha sem obraId retorna 400', async () => {
    const res = await request(app).get('/api/live-feed/folha');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/obrigatório/i);
  });

  it('aceita filtros via query string', async () => {
    const res = await request(app).get('/api/live-feed/folha?obraId=1&ano=2026&mes=5');
    expect(res.status).toBe(200);
    expect(res.body.filters).toMatchObject({ obraId: 1, ano: 2026, mes: 5 });
  });

  it('headers no-cache', async () => {
    const res = await request(app).get('/api/live-feed/obras');
    expect(res.headers['cache-control']).toContain('no-cache');
  });
});
