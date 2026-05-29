// v3.49.0: testes do modulo recibos_anexos.
//
// Cobre:
//  - sanitizarNomeArquivo (NFD, lowercase, sha8 prefix, extensao preservada)
//  - calcularSha256 / gerarDownloadToken (formato esperado)
//  - validarMimeEExtensao (positivos + negativos)
//  - constantes publicas (MAX_TAMANHO_BYTES, MAX_ANEXOS_POR_RECIBO, MIMES_PERMITIDOS)
//  - migration idempotente (importavel, expor funcao runRecibosAnexosMigrations)
//  - server.ts: endpoints e wiring de migration estao registrados
//  - integration.recibos: enviarReciboWhatsApp chama listarAnexosComBlob

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  sanitizarNomeArquivo,
  calcularSha256,
  gerarDownloadToken,
  validarMimeEExtensao,
  MAX_ANEXOS_POR_RECIBO,
  MAX_TAMANHO_BYTES,
  MIMES_PERMITIDOS,
} from '../integrations/recibosAnexos';

describe('recibosAnexos — helpers puros (v3.49.0)', () => {
  describe('sanitizarNomeArquivo', () => {
    it('prefixa com 8 chars do sha256', () => {
      const sha = 'abcdef1234567890'.repeat(4); // 64 chars
      const out = sanitizarNomeArquivo('CCIR Atualizado.pdf', sha);
      expect(out).toMatch(/^abcdef12_/);
    });

    it('normaliza acentos e espacos', () => {
      const sha = 'a'.repeat(64);
      const out = sanitizarNomeArquivo('Declaração ITR-2026.pdf', sha);
      expect(out).toBe('aaaaaaaa_declaracao-itr-2026.pdf');
    });

    it('fallback para "arquivo" se nome sanitizado vira vazio', () => {
      const sha = 'b'.repeat(64);
      const out = sanitizarNomeArquivo('@@@@', sha);
      expect(out).toMatch(/^bbbbbbbb_arquivo/);
    });

    it('mantem caracteres ja seguros', () => {
      const sha = 'c'.repeat(64);
      const out = sanitizarNomeArquivo('comprovante_incra-2026.pdf', sha);
      expect(out).toBe('cccccccc_comprovante_incra-2026.pdf');
    });
  });

  describe('calcularSha256', () => {
    it('retorna 64 chars hex', () => {
      const sha = calcularSha256(Buffer.from('teste'));
      expect(sha).toMatch(/^[a-f0-9]{64}$/);
    });

    it('eh deterministico — mesmo input gera mesmo hash', () => {
      const a = calcularSha256(Buffer.from('CCIR'));
      const b = calcularSha256(Buffer.from('CCIR'));
      expect(a).toBe(b);
    });

    it('inputs diferentes geram hashes diferentes', () => {
      const a = calcularSha256(Buffer.from('CCIR'));
      const b = calcularSha256(Buffer.from('ITR'));
      expect(a).not.toBe(b);
    });
  });

  describe('gerarDownloadToken', () => {
    it('retorna 64 chars hex', () => {
      const tok = gerarDownloadToken();
      expect(tok).toMatch(/^[a-f0-9]{64}$/);
    });

    it('gera tokens unicos a cada chamada', () => {
      const a = gerarDownloadToken();
      const b = gerarDownloadToken();
      expect(a).not.toBe(b);
    });
  });

  describe('validarMimeEExtensao', () => {
    it('aceita PDF/JPG/PNG/WebP', () => {
      expect(validarMimeEExtensao('a.pdf', 'application/pdf')).toBe('pdf');
      expect(validarMimeEExtensao('b.jpg', 'image/jpeg')).toBe('jpg');
      expect(validarMimeEExtensao('c.JPEG', 'image/jpeg')).toBe('jpeg');
      expect(validarMimeEExtensao('d.png', 'image/png')).toBe('png');
      expect(validarMimeEExtensao('e.webp', 'image/webp')).toBe('webp');
    });

    it('rejeita extensoes nao permitidas', () => {
      expect(() => validarMimeEExtensao('malware.exe', 'application/x-msdownload')).toThrow(/nao permitida/i);
      expect(() => validarMimeEExtensao('doc.docx', 'application/octet-stream')).toThrow(/nao permitida/i);
      expect(() => validarMimeEExtensao('sheet.xlsx', 'application/octet-stream')).toThrow(/nao permitida/i);
    });

    it('rejeita arquivo sem extensao', () => {
      expect(() => validarMimeEExtensao('semextensao', 'application/pdf')).toThrow(/nao permitida/i);
    });

    it('tolera MIME inesperado se extensao for OK (octet-stream)', () => {
      // Navegadores variam — extensao manda
      expect(validarMimeEExtensao('foo.pdf', 'application/octet-stream')).toBe('pdf');
    });
  });

  describe('constantes publicas', () => {
    it('MAX_ANEXOS_POR_RECIBO eh 5 (regra de negocio)', () => {
      expect(MAX_ANEXOS_POR_RECIBO).toBe(5);
    });

    it('MAX_TAMANHO_BYTES eh 10 MB', () => {
      expect(MAX_TAMANHO_BYTES).toBe(10 * 1024 * 1024);
    });

    it('MIMES_PERMITIDOS contem os 4 tipos esperados', () => {
      expect(MIMES_PERMITIDOS).toContain('application/pdf');
      expect(MIMES_PERMITIDOS).toContain('image/jpeg');
      expect(MIMES_PERMITIDOS).toContain('image/png');
      expect(MIMES_PERMITIDOS).toContain('image/webp');
    });
  });
});

describe('recibos_anexos — migration (v3.49.0)', () => {
  it('arquivo migrations-recibos-anexos.ts existe e exporta runRecibosAnexosMigrations', async () => {
    const mod = await import('../database/migrations-recibos-anexos');
    expect(typeof mod.runRecibosAnexosMigrations).toBe('function');
  });

  it('SQL da migration cria tabela com LONGBLOB, FK CASCADE e UK token', () => {
    const sqlText = readFileSync(
      join(__dirname, '..', 'database', 'migrations-recibos-anexos.ts'),
      'utf8',
    );
    expect(sqlText).toContain('CREATE TABLE recibos_anexos');
    expect(sqlText).toContain('LONGBLOB');
    expect(sqlText).toContain('FOREIGN KEY (recibo_id)');
    expect(sqlText).toContain('REFERENCES recibos(id) ON DELETE CASCADE');
    expect(sqlText).toContain('uk_ra_token');
    expect(sqlText).toContain('CHAR(64) NOT NULL'); // sha256
    expect(sqlText).toContain('VARCHAR(64) NOT NULL'); // download_token
  });

  it('eh idempotente — captura "already exists" e segue', () => {
    const code = readFileSync(
      join(__dirname, '..', 'database', 'migrations-recibos-anexos.ts'),
      'utf8',
    );
    expect(code).toMatch(/already exists\|Duplicate/i);
  });
});

describe('server.ts — wiring dos endpoints e migration (v3.49.0)', () => {
  const serverTs = readFileSync(
    join(__dirname, '..', 'server.ts'),
    'utf8',
  );

  it('migration recibos-anexos eh chamada na sequencia de boot', () => {
    expect(serverTs).toContain("await import('./database/migrations-recibos-anexos')");
    expect(serverTs).toContain('runRecibosAnexosMigrations()');
  });

  it('endpoint POST /api/recibos/:id/anexos esta registrado', () => {
    expect(serverTs).toMatch(/app\.post\(\s*['"]\/api\/recibos\/:id\/anexos['"]/);
  });

  it('endpoint GET /api/recibos/:id/anexos esta registrado', () => {
    expect(serverTs).toMatch(/app\.get\(\s*['"]\/api\/recibos\/:id\/anexos['"]/);
  });

  it('endpoint GET /api/recibos/anexos/:anexo_id/download esta registrado e protegido', () => {
    expect(serverTs).toMatch(/app\.get\(\s*['"]\/api\/recibos\/anexos\/:anexo_id\/download['"]\s*,\s*requireCeoToken/);
  });

  it('endpoint DELETE /api/recibos/anexos/:anexo_id esta registrado e protegido', () => {
    expect(serverTs).toMatch(/app\.delete\(\s*['"]\/api\/recibos\/anexos\/:anexo_id['"]\s*,\s*requireCeoToken/);
  });

  it('endpoint publico GET /a/:token (download via token) esta registrado', () => {
    expect(serverTs).toMatch(/app\.get\(\s*['"]\/a\/:token['"]/);
  });

  it('multer config aceita 5 arquivos e 10 MB cada', () => {
    expect(serverTs).toContain('RECIBO_ANEXO_MAX_BYTES = 10 * 1024 * 1024');
    expect(serverTs).toContain('RECIBO_ANEXO_MAX_FILES = 5');
  });
});

describe('integrations/recibos.ts — anexos enviados apos PDF (v3.49.0)', () => {
  const reciboTs = readFileSync(
    join(__dirname, '..', 'integrations', 'recibos.ts'),
    'utf8',
  );

  it('enviarReciboWhatsApp chama listarAnexosComBlob', () => {
    expect(reciboTs).toContain("await import('./recibosAnexos')");
    expect(reciboTs).toContain('listarAnexosComBlob');
  });

  it('itera sobre anexos e chama sendDocument com nome_original', () => {
    expect(reciboTs).toMatch(/for\s*\(\s*const\s+anexo\s+of\s+anexos\s*\)/);
    expect(reciboTs).toContain('anexo.conteudo_blob.toString(\'base64\')');
    expect(reciboTs).toContain('anexo.nome_original');
  });

  it('registra evento attachments_sent quando anexos sao enviados', () => {
    expect(reciboTs).toContain("'attachments_sent'");
  });

  it('aplica delay de 1s entre anexos pra evitar rate limit Z-API', () => {
    expect(reciboTs).toMatch(/setTimeout\(resolve,\s*1000\)/);
  });
});

describe('catalogo-servicos — 3 servicos IMOB para anexos (v3.49.0)', () => {
  const catalogoJs = readFileSync(
    join(__dirname, '..', 'public', 'js', 'catalogo-servicos.js'),
    'utf8',
  );

  it('inclui CCIR atualizacao com base legal correta', () => {
    expect(catalogoJs).toContain("id: 'imob-ccir'");
    expect(catalogoJs).toContain('Atualização de CCIR');
    expect(catalogoJs).toContain('Lei nº 4.947/1966');
    expect(catalogoJs).toContain('IN INCRA nº 95/2010');
  });

  it('inclui ITR/NIRF atualizacao com base legal correta', () => {
    expect(catalogoJs).toContain("id: 'imob-itr-nirf'");
    expect(catalogoJs).toContain('NIRF');
    expect(catalogoJs).toContain('Lei nº 9.393/1996');
    expect(catalogoJs).toContain('IN RFB nº 1.877/2019');
  });

  it('inclui CAR/SICAR/AMBIS com base legal correta', () => {
    expect(catalogoJs).toContain("id: 'imob-car-sicar'");
    expect(catalogoJs).toContain('SICAR/AMBIS');
    expect(catalogoJs).toContain('Lei nº 12.651/2012');
    expect(catalogoJs).toContain('IN MMA nº 2/2014');
  });
});

describe('frontend/obras.html — UI de anexos no form de recibo (v3.49.0)', () => {
  const obrasHtml = readFileSync(
    join(__dirname, '..', 'public', 'obras.html'),
    'utf8',
  );

  it('secao de anexos esta presente no form de recibo', () => {
    expect(obrasHtml).toContain('id="recAnexosSection"');
    expect(obrasHtml).toContain('id="recAnexosInput"');
    expect(obrasHtml).toContain('id="recAnexosAddBtn"');
    expect(obrasHtml).toContain('id="recAnexosLista"');
  });

  it('input file aceita os MIMEs corretos', () => {
    expect(obrasHtml).toContain('accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"');
  });

  it('limites client-side batem com servidor (5 arquivos, 10 MB)', () => {
    expect(obrasHtml).toContain('ANEXO_MAX_BYTES = 10 * 1024 * 1024');
    expect(obrasHtml).toContain('ANEXO_MAX_FILES = 5');
  });

  it('estado do form inclui anexosPendentes e anexosExistentes', () => {
    expect(obrasHtml).toContain('anexosPendentes: []');
    expect(obrasHtml).toContain('anexosExistentes: []');
  });

  it('uploadAnexosPendentes POSTa multipart em /api/recibos/:id/anexos', () => {
    expect(obrasHtml).toContain("'/api/recibos/' + reciboId + '/anexos'");
    expect(obrasHtml).toMatch(/fd\.append\(\s*['"]files['"]\s*,\s*a\.file/);
    expect(obrasHtml).toMatch(/fd\.append\(\s*['"]descricoes['"]/);
  });

  it('ao editar recibo existente carrega anexos via GET', () => {
    expect(obrasHtml).toContain("api('/api/recibos/' + r.id + '/anexos')");
  });

  it('renderAnexosBox monta link de download e botao de exclusao', () => {
    expect(obrasHtml).toContain('/api/recibos/anexos/');
    expect(obrasHtml).toContain('data-anexo-del-id');
    expect(obrasHtml).toContain('data-anexo-rm-idx');
  });
});
