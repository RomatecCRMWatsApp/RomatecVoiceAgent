// v3.36.0: testes de regressao do hotfix do 401 + UI CRUD de clientes.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SERVER_TS = fs.readFileSync(path.join(process.cwd(), 'src', 'server.ts'), 'utf-8');
const OBRAS_HTML = fs.readFileSync(path.join(process.cwd(), 'src', 'public', 'obras.html'), 'utf-8');

describe('HOTFIX v3.36.0 — adicional-campo/calcular publico', () => {
  it('1. POST /api/adicional-campo/calcular NAO usa requireAuth (publico)', () => {
    // Pattern especifico do registro do endpoint
    const m = SERVER_TS.match(/app\.post\('\/api\/adicional-campo\/calcular',\s*(\w+|async)/);
    expect(m).not.toBeNull();
    // O 2o argumento deve ser `async` direto (sem requireAuth)
    expect(m![1]).toBe('async');
    expect(m![1]).not.toBe('requireAuth');
  });

  it('2. Comentario de hotfix presente em server.ts (rastreabilidade)', () => {
    expect(SERVER_TS).toMatch(/v3\.36\.0 HOTFIX: endpoint \/calcular tornado PUBLICO/);
  });

  it('3. GET /api/adicional-campo/cenarios continua publico (regressao)', () => {
    const m = SERVER_TS.match(/app\.get\('\/api\/adicional-campo\/cenarios',\s*(\w+|async)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('async');
  });
});

describe('v3.36.0 UI — CRUD de clientes em obras.html', () => {
  it('4. abrirCadastroClienteModal aceita clienteExistente (modo edicao)', () => {
    expect(OBRAS_HTML).toMatch(/function abrirCadastroClienteModal\(subtipoParaVoltar,\s*clienteExistente/);
    expect(OBRAS_HTML).toMatch(/isEdit\s*=\s*!!clienteExistente/);
  });

  it('5. Modo edicao usa PUT em vez de POST', () => {
    expect(OBRAS_HTML).toMatch(/api\(`\/api\/propostas-clientes\/\$\{c\.id\}`,\s*\{ method: 'PUT'/);
  });

  it('6. Funcao abrirGerenciarClientes existe e renderiza lista', () => {
    expect(OBRAS_HTML).toMatch(/async function abrirGerenciarClientes\(\)/);
    expect(OBRAS_HTML).toMatch(/state\.propostasClientes \|\| \[\]/);
  });

  it('7. Cada cliente tem botoes Editar e Excluir com data-cli-edit/data-cli-del', () => {
    expect(OBRAS_HTML).toMatch(/data-cli-edit="\$\{c\.id\}"/);
    expect(OBRAS_HTML).toMatch(/data-cli-del="\$\{c\.id\}"/);
  });

  it('8. Excluir pede confirm() PT-BR com nome do cliente', () => {
    expect(OBRAS_HTML).toMatch(/confirm\(`Excluir "\$\{nome\}"\?/);
  });

  it('9. Excluir chama DELETE /api/propostas-clientes/:id', () => {
    expect(OBRAS_HTML).toMatch(/api\(`\/api\/propostas-clientes\/\$\{id\}`,\s*\{ method: 'DELETE'/);
  });

  it('10. Toggle da aba Proposta tem botao [data-gerenciar-clientes]', () => {
    expect(OBRAS_HTML).toMatch(/data-gerenciar-clientes/);
    expect(OBRAS_HTML).toMatch(/📇 Gerenciar Clientes/);
  });

  it('11. Handler global delegate no DOMContentLoaded (evita duplicar em 10+ renders)', () => {
    expect(OBRAS_HTML).toMatch(/document\.body\.addEventListener\('click'.*data-gerenciar-clientes/s);
    expect(OBRAS_HTML).toMatch(/abrirGerenciarClientes\(\)/);
  });

  it('12. Mensagem amigavel ao excluir explica soft-delete', () => {
    expect(OBRAS_HTML).toMatch(/soft-delete/);
    expect(OBRAS_HTML).toMatch(/Propostas existentes desse cliente continuam visiveis|Propostas existentes desse cliente continuam vis[íi]veis/i);
  });
});
