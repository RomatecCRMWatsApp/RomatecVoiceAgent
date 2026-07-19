// v3.108.1: as rotas de escrita da galeria sairam do X-CEO-Token e passaram a
// usar requireAuth (cookie zayra_auth).
//
// Motivo: o token de CEO travava excluir/mover pra qualquer pessoa que nao fosse
// o proprio CEO, e em campo isso aparecia como "botao nao responde". A troca NAO
// abre nada pra internet — continua exigindo estar logado; so deixa de exigir que
// o usuario logado seja especificamente o CEO.
//
// Escopo deliberado: SO a galeria. As outras ~90 rotas do sistema seguem com
// requireCeoToken; mexer nelas e decisao separada.
//
// A pegadinha que este teste protege: requireAuth le COOKIE. Todo fetch de escrita
// no front precisa de credentials:'include' — sem isso o upload de foto quebra com
// 401 e a captura para de funcionar em campo.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const serverTs = readFileSync(join(SRC, 'server.ts'), 'utf8');
const obrasHtml = readFileSync(join(SRC, 'public', 'obras.html'), 'utf8');

/** Linhas que registram rota de escrita da galeria. */
function rotasEscritaGaleria(): string[] {
  return serverTs
    .split('\n')
    .filter((l) => /^app\.(post|put|delete)\('\/api\/galeria/.test(l.trim()));
}

/** v3.109.0: leitura tambem passou a exigir sessao. */
function rotasLeituraGaleria(): string[] {
  return serverTs
    .split('\n')
    .filter((l) => /^app\.get\('\/api\/galeria/.test(l.trim()));
}

describe('galeria — auth por cookie no lugar do token de CEO', () => {
  it('1. nenhuma rota de escrita da galeria usa requireCeoToken', () => {
    const comToken = rotasEscritaGaleria().filter((l) => l.includes('requireCeoToken'));
    expect(comToken, `ainda usam requireCeoToken:\n${comToken.join('\n')}`).toEqual([]);
  });

  it('2. as rotas de escrita da galeria continuam autenticadas (nao ficaram abertas)', () => {
    // download-zip e publica de proposito (mesmo nivel dos GETs abertos); as demais nao.
    const desprotegidas = rotasEscritaGaleria()
      .filter((l) => !l.includes('/api/galeria/download-zip'))
      .filter((l) => !l.includes('requireAuth'));
    expect(desprotegidas, `sem auth nenhuma:\n${desprotegidas.join('\n')}`).toEqual([]);
  });

  it('3. encontrou as rotas esperadas (o teste nao esta passando por vacuidade)', () => {
    const rotas = rotasEscritaGaleria();
    expect(rotas.length).toBeGreaterThanOrEqual(6);
    for (const alvo of ['/api/galeria\'', '/api/galeria/:id\'', '/api/galeria/mover-obra']) {
      expect(rotas.some((l) => l.includes(alvo)), `faltou registrar ${alvo}`).toBe(true);
    }
  });

  it('4. o front nao manda mais X-CEO-Token nas chamadas da galeria', () => {
    // Recorta a regiao do modulo da galeria em obras.html.
    const ini = obrasHtml.indexOf('const GALERIA_DB_NAME');
    const fim = obrasHtml.indexOf('v3.25.0: Aba CONFIGURACOES');
    const regiao = obrasHtml.slice(ini, fim);
    // Sobram mencoes em comentario; o que nao pode e header de verdade.
    expect(regiao).not.toMatch(/'X-CEO-Token'\s*:/);
  });

  it('5. todo fetch de escrita da galeria envia credentials include (senao 401)', () => {
    const ini = obrasHtml.indexOf('const GALERIA_DB_NAME');
    const fim = obrasHtml.indexOf('v3.25.0: Aba CONFIGURACOES');
    const regiao = obrasHtml.slice(ini, fim);
    // Cada fetch pra /api/galeria com method de escrita deve ter credentials perto.
    const re = /fetch\(\s*[`'"][^`'"]*\/api\/galeria[^`'"]*[`'"]\s*,\s*\{([\s\S]{0,320}?)\}\s*\)/g;
    const semCookie: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(regiao))) {
      const corpo = m[1];
      if (!/method:\s*'(POST|PUT|DELETE)'/.test(corpo)) continue;
      if (!/credentials:\s*'include'/.test(corpo)) semCookie.push(corpo.slice(0, 90));
    }
    expect(semCookie, `fetch de escrita sem cookie:\n${semCookie.join('\n---\n')}`).toEqual([]);
  });

  // v3.109.0 — leitura fechada. Antes GET /api/galeria, /arquivo e /download eram
  // abertos: quem soubesse a URL listava e baixava as fotos das obras sem login.
  it('6. as rotas de LEITURA da galeria tambem exigem sessao', () => {
    const abertas = rotasLeituraGaleria().filter((l) => !l.includes('requireAuth'));
    expect(abertas, `GET sem auth:\n${abertas.join('\n')}`).toEqual([]);
    expect(rotasLeituraGaleria().length).toBeGreaterThanOrEqual(3);
  });

  it('7. os fetch de LEITURA da galeria mandam cookie (senao a galeria some)', () => {
    const ini = obrasHtml.indexOf('const GALERIA_DB_NAME');
    const fim = obrasHtml.indexOf('v3.25.0: Aba CONFIGURACOES');
    const regiao = obrasHtml.slice(ini, fim);
    // fetch(urlLista, {...}) e fetch('/api/galeria?...', {...}) — sem method = GET.
    const re = /fetch\(\s*(?:urlLista|[`'"][^`'"]*\/api\/galeria[^`'"]*[`'"])\s*,\s*\{([\s\S]{0,200}?)\}\s*\)/g;
    const semCookie: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(regiao))) {
      const corpo = m[1];
      if (/method:\s*'(POST|PUT|DELETE)'/.test(corpo)) continue; // ja coberto no teste 5
      if (!/credentials:\s*'include'/.test(corpo)) semCookie.push(corpo.slice(0, 90));
    }
    expect(semCookie, `fetch de leitura sem cookie:\n${semCookie.join('\n---\n')}`).toEqual([]);
  });
});
