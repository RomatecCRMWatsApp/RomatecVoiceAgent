// v3.37.0: testes de regressao do hotfix do 401 em /api/memoriais/hidraulico/calcular
// + fallback UI quando /api/memoriais?limite=50 retorna 401.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SERVER_TS = fs.readFileSync(path.join(process.cwd(), 'src', 'server.ts'), 'utf-8');
const OBRAS_HTML = fs.readFileSync(path.join(process.cwd(), 'src', 'public', 'obras.html'), 'utf-8');

describe('HOTFIX v3.37.0 — memoriais /calcular publico', () => {
  it('1. POST /api/memoriais/hidraulico/calcular NAO usa requireAuth (publico)', () => {
    const m = SERVER_TS.match(/app\.post\('\/api\/memoriais\/hidraulico\/calcular',\s*(\w+|async)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('async');
    expect(m![1]).not.toBe('requireAuth');
  });

  it('2. Comentario de hotfix presente em server.ts (rastreabilidade)', () => {
    expect(SERVER_TS).toMatch(/v3\.37\.0 HOTFIX: \/calcular tornado PUBLICO/);
  });

  it('3. GET /api/memoriais/disciplinas continua publico (regressao)', () => {
    const m = SERVER_TS.match(/app\.get\('\/api\/memoriais\/disciplinas',\s*(\w+|async)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('async');
  });

  it('4. GET /api/memoriais/:disciplina/wizard continua publico (regressao)', () => {
    const m = SERVER_TS.match(/app\.get\('\/api\/memoriais\/:disciplina\/wizard',\s*(\w+|async)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('async');
  });

  it('5. Endpoints que persistem MANTEM requireAuth (defesa em profundidade)', () => {
    // POST /upload-pdf (auth — lida com arquivo do user)
    expect(SERVER_TS).toMatch(/app\.post\('\/api\/memoriais\/upload-pdf',\s*requireAuth/);
    // POST /:disciplina/criar (persiste)
    expect(SERVER_TS).toMatch(/app\.post\('\/api\/memoriais\/:disciplina\/criar',\s*requireAuth/);
    // GET /:id (dado da proposta)
    expect(SERVER_TS).toMatch(/app\.get\('\/api\/memoriais\/:id\(\\\\d\+\)',\s*requireAuth/);
    // GET / (listar do user)
    expect(SERVER_TS).toMatch(/app\.get\('\/api\/memoriais',\s*requireAuth/);
  });
});

describe('v3.37.0 UI — fallback amigavel quando /api/memoriais retorna 401', () => {
  it('6. renderMemoriaisQuantitativos detecta 401 do /api/memoriais', () => {
    expect(OBRAS_HTML).toMatch(/historicoUnauthorized\s*=\s*false/);
    expect(OBRAS_HTML).toMatch(/hResp\.status === 401/);
  });

  it('7. UX clara: "Sessao expirada ou nao autenticada"', () => {
    expect(OBRAS_HTML).toMatch(/Sess[ãa]o expirada ou n[ãa]o autenticada/i);
    expect(OBRAS_HTML).toMatch(/Faça login pra ver|Faca login pra ver/i);
  });

  it('8. Mensagem "Nenhum memorial" so aparece quando autorizado (nao confunde 401 com lista vazia)', () => {
    // Verifica que a mensagem "Nenhum memorial gerado ainda" e' o segundo branch do ternario
    expect(OBRAS_HTML).toMatch(/historicoUnauthorized[\s\S]*?Sess[ãa]o expirada[\s\S]*?:\s*historico\.length === 0/);
  });
});
