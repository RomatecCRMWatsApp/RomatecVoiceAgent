// v3.39.0: testes de regressao do hotfix do BUG 1 (401 no Memorial Hidraulico)
// + BUG 2 (RangeError: Maximum call stack size exceeded em listener de input).
//
// BUG 1 — UX padronizada: ao receber 401 em qualquer fetch de /api/memoriais/*,
// o front redireciona pro /login UMA VEZ (sentinela _memAuthRedirecting), sem
// loop. O usuario via o alert "Falha: Nao autenticado" mesmo dentro de /obras
// porque o JWT expirava e o front nao reagia adequadamente.
//
// BUG 2 — guarda de reentrancia nas mascaras (CPF/CNPJ, Tel, CEP). Mesmo que
// setar .value programaticamente NAO dispare 'input' em browsers WHATWG-
// compliant, polyfills/extensoes Chrome ja foram observados refirando o
// evento — o dataset.reentrante='1' impede o handler de processar o proprio
// efeito e estourar a stack.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const OBRAS_HTML = fs.readFileSync(path.join(process.cwd(), 'src', 'public', 'obras.html'), 'utf-8');

describe('HOTFIX v3.39.0 — BUG 1 (401 nos endpoints de memoriais)', () => {
  it('1. memFetch helper existe e usa credentials: include', () => {
    expect(OBRAS_HTML).toMatch(/async function memFetch\(url, init\s*=\s*\{\}\)/);
    expect(OBRAS_HTML).toMatch(/opts\.credentials = 'include'/);
  });

  it('2. Sentinela global _memAuthRedirecting evita redirect em loop', () => {
    expect(OBRAS_HTML).toMatch(/let _memAuthRedirecting = false/);
    expect(OBRAS_HTML).toMatch(/if \(!_memAuthRedirecting\)/);
    expect(OBRAS_HTML).toMatch(/_memAuthRedirecting = true/);
  });

  it('3. Redirect usa window.location.assign (preserva historico, nao reload em loop)', () => {
    expect(OBRAS_HTML).toMatch(/window\.location\.assign\('\/login\?next=\/obras'\)/);
    // NAO usa .reload() nem .replace() — assign e' o correto pra evitar loop
    expect(OBRAS_HTML).not.toMatch(/_memAuthRedirecting[\s\S]*?location\.reload\(\)/);
  });

  it('4. memFetch lanca NAO_AUTENTICADO em 401 (handlers podem silenciar mensagem)', () => {
    expect(OBRAS_HTML).toMatch(/err\.code = 'NAO_AUTENTICADO'/);
    expect(OBRAS_HTML).toMatch(/err\.status = 401/);
  });

  it('5. POST /api/memoriais/hidraulico/criar usa memFetch (nao fetch direto)', () => {
    expect(OBRAS_HTML).toMatch(/await memFetch\('\/api\/memoriais\/hidraulico\/criar'/);
  });

  it('6. POST /api/memoriais/upload-pdf usa memFetch (nao fetch direto)', () => {
    expect(OBRAS_HTML).toMatch(/await memFetch\('\/api\/memoriais\/upload-pdf'/);
  });

  it('7. Handlers silenciam mensagem quando NAO_AUTENTICADO (redirect ja' + " disparou)", () => {
    // Pattern: depois do catch, checar err.code === 'NAO_AUTENTICADO' e return early
    const matches = OBRAS_HTML.match(/err\.code === 'NAO_AUTENTICADO'/g);
    expect(matches).not.toBeNull();
    // Pelo menos 2: upload-pdf e criar
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('8. GET /api/memoriais (listar) mantem UX fallback (NAO redirect), preserva v3.37.0', () => {
    // /api/memoriais (lista) ainda detecta 401 e mostra "Sessao expirada"
    // SEM redirecionar — porque a tela carrega o tempo todo e nao podemos
    // redirecionar so porque o JWT expirou em background.
    expect(OBRAS_HTML).toMatch(/historicoUnauthorized\s*=\s*true/);
    expect(OBRAS_HTML).toMatch(/Sess[ãa]o expirada ou n[ãa]o autenticada/i);
  });
});

describe('HOTFIX v3.39.0 — BUG 2 (RangeError em listener de input)', () => {
  it('9. aplicarMascarasLn (CPF/CNPJ): guarda dataset.reentrante', () => {
    // Busca o bloco do handler de CPF/CNPJ dentro de aplicarMascarasLn
    const m = OBRAS_HTML.match(/data-mask="cpfcnpj"[\s\S]{0,2000}?dataset\.reentrante/);
    expect(m).not.toBeNull();
    // Pattern completo: if reentrante === '1' return; dataset.reentrante = '1' antes do set
    expect(OBRAS_HTML).toMatch(/target\.dataset\.reentrante === '1'\s*\)\s*return/);
  });

  it('10. aplicarMascarasLn (Tel): nao reescreve se valor nao mudou (otimizacao + protecao)', () => {
    // Pattern: if (formatado === target.value) return; evita reescrita desnecessaria
    const matches = OBRAS_HTML.match(/if \(formatado === target\.value\) return/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2); // CPF + Tel
  });

  it('11. CEP handler (cli_cep) tambem tem guarda de reentrancia', () => {
    expect(OBRAS_HTML).toMatch(/inpCep\.oninput[\s\S]{0,400}?inpCep\.dataset\.reentrante === '1'/);
  });

  it('12. Tel handler (cli_tel) tambem tem guarda de reentrancia', () => {
    expect(OBRAS_HTML).toMatch(/inpTel\.oninput[\s\S]{0,300}?inpTel\.dataset\.reentrante === '1'/);
  });

  it('13. Reset de reentrante em finally (nao trava se handler dispara excecao)', () => {
    const matches = OBRAS_HTML.match(/finally\s*\{[^}]*reentrante = '0'/g);
    expect(matches).not.toBeNull();
    // CPF + Tel + CEP + cli_tel = 4 ocorrencias minimo
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });
});

describe('HOTFIX v3.39.0 — regressao: endpoints de memoriais nao mudaram de auth', () => {
  const SERVER_TS = fs.readFileSync(path.join(process.cwd(), 'src', 'server.ts'), 'utf-8');

  it('14. POST /api/memoriais/hidraulico/calcular continua PUBLICO (v3.37.0 preservado)', () => {
    const m = SERVER_TS.match(/app\.post\('\/api\/memoriais\/hidraulico\/calcular',\s*(\w+|async)/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('async');
  });

  it('15. POST /api/memoriais/hidraulico/criar continua PROTEGIDO (persiste dado)', () => {
    expect(SERVER_TS).toMatch(/app\.post\('\/api\/memoriais\/:disciplina\/criar',\s*requireAuth/);
  });

  it('16. GET /api/memoriais continua PROTEGIDO (lista do user logado)', () => {
    expect(SERVER_TS).toMatch(/app\.get\('\/api\/memoriais',\s*requireAuth/);
  });
});
