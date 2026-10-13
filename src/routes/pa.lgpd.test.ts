// v3.142.0 — Rotas /api/pa: perfis LGPD (Direção só lê, CPF mascarado, sem
// documentos; exclusão só ADMIN) e mapeamento de PaErro → HTTP. Banco mockado.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/pa/paRepo', () => ({
  perfilOverride: vi.fn(async () => null),
  listarAssociados: vi.fn(async () => [{
    id: 7, nome: 'FULANA TESTE', cpf: '529.982.247-25', rg: '529.982.247-25 SSP/MA (CIN)', conjuge_cpf: '111.444.777-35',
    telefone: '(99) 9 9000-0001', financeiro: { saldo: 700 }, documentos: { total: 3, com_arquivo: 3 },
  }]),
  criarAssociado: vi.fn(async () => ({ detalhe: {}, avisos: [] })),
  buscarAssociado: vi.fn(async () => ({ id: 7, projeto_id: 1 })),
  desativarAssociado: vi.fn(async () => undefined),
  painel: vi.fn(async () => { const { PaErro } = await import('../services/pa/erros'); throw new PaErro('PROJETO_NAO_ENCONTRADO', 'Projeto não encontrado', 404); }),
}));
vi.mock('../services/pa/paFinanceiro', () => ({}));
vi.mock('../services/pa/seedRun', () => ({}));
vi.mock('../services/pa/paDocumentos', () => ({
  baixarDocumento: vi.fn(async () => ({ conteudo: Buffer.from('%PDF-1.4 teste'), mime: 'application/pdf', nome: 'ficha.pdf' })),
}));

import paRouter from './pa';
import * as repo from '../services/pa/paRepo';
import * as docs from '../services/pa/paDocumentos';

function app(role: string) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { (req as unknown as { user: unknown }).user = { sub: 'u1', role, tenant_id: 1, equipe_id: null, name: 'T', jti: 'j' }; next(); });
  a.use('/api/pa', paRouter);
  return a;
}

describe('/api/pa — perfis LGPD', () => {
  beforeEach(() => vi.clearAllMocks());

  it('/eu reflete o perfil derivado do role', async () => {
    expect((await request(app('owner')).get('/api/pa/eu')).body).toMatchObject({ perfil: 'ADMIN', pode_excluir: true });
    expect((await request(app('financeiro')).get('/api/pa/eu')).body).toMatchObject({ perfil: 'OPERADOR', pode_escrever: true, pode_excluir: false });
    expect((await request(app('viewer')).get('/api/pa/eu')).body).toMatchObject({ perfil: 'DIRECAO_ASSOCIACAO', pode_escrever: false, ve_documentos: false });
  });

  it('override em pa_usuarios_perfil prevalece sobre o role', async () => {
    vi.mocked(repo.perfilOverride).mockResolvedValueOnce('DIRECAO_ASSOCIACAO');
    expect((await request(app('admin')).get('/api/pa/eu')).body.perfil).toBe('DIRECAO_ASSOCIACAO');
  });

  it('Direção recebe CPF mascarado e sem RG; operador vê completo', async () => {
    const d = await request(app('viewer')).get('/api/pa/projetos/1/associados');
    expect(d.status).toBe(200);
    expect(d.body.associados[0].cpf).toBe('***.982.247-**');
    expect(d.body.associados[0].conjuge_cpf).toBe('***.444.777-**');
    expect(d.body.associados[0].rg).toBeNull();
    expect(JSON.stringify(d.body)).not.toContain('529.982.247-25');
    const o = await request(app('gestor')).get('/api/pa/projetos/1/associados');
    expect(o.body.associados[0].cpf).toBe('529.982.247-25');
  });

  it('Direção não escreve', async () => {
    const r = await request(app('viewer')).post('/api/pa/projetos/1/associados').send({ nome: 'X' });
    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe('SEM_PERMISSAO');
    expect(repo.criarAssociado).not.toHaveBeenCalled();
  });

  it('Direção não acessa documentos; ADMIN baixa (download auditado no serviço)', async () => {
    const r = await request(app('viewer')).get('/api/pa/documentos/5');
    expect(r.status).toBe(403);
    expect(docs.baixarDocumento).not.toHaveBeenCalled();
    const ok = await request(app('admin')).get('/api/pa/documentos/5');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.headers['cache-control']).toContain('no-store');
    expect(docs.baixarDocumento).toHaveBeenCalledWith(5, 'u1', expect.anything());
  });

  it('exclusão só ADMIN (operador recebe 403)', async () => {
    expect((await request(app('financeiro')).delete('/api/pa/projetos/1/associados/7')).status).toBe(403);
    expect(repo.desativarAssociado).not.toHaveBeenCalled();
    expect((await request(app('admin')).delete('/api/pa/projetos/1/associados/7')).status).toBe(200);
  });

  it('PaErro vira status + código; id inválido vira 400', async () => {
    const r = await request(app('admin')).get('/api/pa/projetos/9/painel');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ codigo: 'PROJETO_NAO_ENCONTRADO' });
    expect((await request(app('admin')).get('/api/pa/projetos/abc/associados')).status).toBe(400);
  });
});
