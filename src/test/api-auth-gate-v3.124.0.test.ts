// v3.124.0 — Gate de autenticação do prefixo /api.
//
// Contexto: até a v3.123.1 a auth era rota a rota e 198 rotas /api não tinham
// nenhuma (104 delas mutações, incluindo DELETE /api/obras/:id). O gate inverte
// o padrão para "fechado por omissão".
//
// Estes testes cobrem as duas formas de a coisa dar errado:
//   1. a allowlist liberar demais (ou de menos);
//   2. alguém registrar uma rota /api ANTES do gate, escapando dele em silêncio.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ehRotaApiPublica, ROTAS_PUBLICAS_API } from '../middleware/apiAuthGate';

describe('v3.124.0 — allowlist do /api', () => {
  // Caminhos são relativos ao mount /api (é o que o Express entrega em req.path).
  it.each([
    ['POST', '/auth/login',              'login precisa rodar sem cookie'],
    ['POST', '/auth/refresh',            'refresh idem'],
    ['GET',  '/version',                 'badge de versão'],
    ['GET',  '/galeria/export',          'AvalieImob via X-API-Key'],
    ['GET',  '/galeria/foto/12',         'AvalieImob via X-API-Key'],
    ['POST', '/wifi/lead',               'captive portal: visitante não tem login'],
    ['POST', '/avalieimob/lead-webhook', 'webhook externo'],
  ])('libera %s %s (%s)', (metodo, caminho) => {
    expect(ehRotaApiPublica(metodo, caminho)).toBe(true);
  });

  it.each([
    ['GET',    '/funcionarios/9/dias'],
    ['POST',   '/funcionarios/9/dias'],
    ['DELETE', '/obras/5'],
    ['POST',   '/obras'],
    ['PUT',    '/parcelas/3'],
    ['DELETE', '/etapas/7'],
    ['POST',   '/equipe'],
    ['GET',    '/folha/saldo-aberto'],
    ['GET',    '/recibos'],
    ['POST',   '/mao-obra-avulsa/1/enviar'],
    ['GET',    '/relatorio-equipe'],
    ['GET',    '/live-feed'],
  ])('exige auth em %s %s', (metodo, caminho) => {
    expect(ehRotaApiPublica(metodo, caminho)).toBe(false);
  });

  it('a liberação por método não vaza pra outros verbos', () => {
    // /version e /wifi/lead são liberados só num método.
    expect(ehRotaApiPublica('GET', '/version')).toBe(true);
    expect(ehRotaApiPublica('DELETE', '/version')).toBe(false);
    expect(ehRotaApiPublica('POST', '/wifi/lead')).toBe(true);
    expect(ehRotaApiPublica('GET', '/wifi/lead')).toBe(false);
  });

  it('prefixo liberado não libera rota que apenas COMEÇA igual', () => {
    // '/galeria' é prefixo liberado; '/galeriax' não pode pegar carona.
    expect(ehRotaApiPublica('GET', '/galeriax/segredo')).toBe(false);
    expect(ehRotaApiPublica('GET', '/authx')).toBe(false);
    // as rotas autenticadas de galeria do painel ficam em /api/galeria mesmo,
    // servidas pelo router com requireAuth próprio — documentado na allowlist.
  });

  it('query string e barra final não driblam a checagem', () => {
    expect(ehRotaApiPublica('GET', '/obras?x=1')).toBe(false);
    expect(ehRotaApiPublica('GET', '/obras/')).toBe(false);
    expect(ehRotaApiPublica('GET', '/version/')).toBe(true);
  });

  it('toda entrada da allowlist tem motivo escrito', () => {
    expect(ROTAS_PUBLICAS_API.length).toBeGreaterThan(0);
    for (const r of ROTAS_PUBLICAS_API) {
      expect(r.motivo.trim().length, `entrada ${r.match} sem motivo`).toBeGreaterThan(15);
    }
  });
});

describe('v3.124.0 — o gate roda antes de qualquer rota /api', () => {
  const SERVER = fs.readFileSync(path.join(process.cwd(), 'src', 'server.ts'), 'utf-8');
  const linhas = SERVER.split('\n');

  it('está montado em app.use(\'/api\', apiAuthGate)', () => {
    expect(SERVER).toMatch(/app\.use\('\/api',\s*apiAuthGate\)/);
  });

  it('nenhuma rota /api é registrada acima do gate', () => {
    const idxGate = linhas.findIndex(l => /app\.use\('\/api',\s*apiAuthGate\)/.test(l));
    expect(idxGate, 'gate não encontrado no server.ts').toBeGreaterThan(-1);

    const reRota = /^\s*app\.(use|get|post|put|delete|patch)\s*\(\s*'(\/api\/[^']*)'/;
    const acima: string[] = [];
    for (let i = 0; i < idxGate; i++) {
      const m = reRota.exec(linhas[i]);
      if (m) acima.push(`linha ${i + 1}: ${m[1].toUpperCase()} ${m[2]}`);
    }
    expect(acima, `rotas /api registradas ANTES do gate escapariam dele:\n${acima.join('\n')}`)
      .toEqual([]);
  });
});
