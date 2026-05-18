// v3.17.0: testes das funções puras de arquivosVetoriaisService.
// CRUD e queries são testadas indiretamente — focar aqui em sanitização,
// validação de magic bytes, geração de token e SHA-256.

import { describe, it, expect } from 'vitest';
import {
  sanitizarNomeArquivo,
  verificarMagicBytes,
  detectarTipoArquivo,
  gerarDownloadToken,
  calcularSha256,
} from './arquivosVetoriaisService';

describe('sanitizarNomeArquivo', () => {
  it('remove acentos e troca espaços por hífens', () => {
    const r = sanitizarNomeArquivo('Fazenda Boa Esperança.dxf', 'a'.repeat(64));
    expect(r).toMatch(/^aaaaaaaa_fazenda-boa-esperanca\.dxf$/);
  });

  it('lowercase e descarta caracteres especiais', () => {
    const r = sanitizarNomeArquivo('Mapa #42 [final].DWG', 'b'.repeat(64));
    expect(r.toLowerCase()).toBe(r);
    expect(r).toContain('mapa');
    expect(r).not.toMatch(/[#\[\]]/);
  });

  it('prefixa com 8 chars do sha256', () => {
    const sha = '1234567890abcdef'.repeat(4);
    const r = sanitizarNomeArquivo('teste.kml', sha);
    expect(r.startsWith('12345678_')).toBe(true);
  });

  it('nome vazio cai para "arquivo"', () => {
    const r = sanitizarNomeArquivo('@#$%^&*()', 'c'.repeat(64));
    expect(r).toMatch(/^cccccccc_arquivo$/);
  });
});

describe('gerarDownloadToken', () => {
  it('produz token de 64 chars hex', () => {
    const t = gerarDownloadToken();
    expect(t).toHaveLength(64);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tokens consecutivos são únicos', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => gerarDownloadToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('calcularSha256', () => {
  it('é determinístico para o mesmo conteúdo', () => {
    const buf = Buffer.from('conteudo teste');
    expect(calcularSha256(buf)).toBe(calcularSha256(buf));
  });

  it('produz hash de 64 chars hex', () => {
    const h = calcularSha256(Buffer.from('x'));
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes diferentes para conteúdos diferentes', () => {
    expect(calcularSha256(Buffer.from('a'))).not.toBe(calcularSha256(Buffer.from('b')));
  });
});

describe('verificarMagicBytes — DWG', () => {
  it('aceita AC1024 (AutoCAD 2010)', () => {
    const buf = Buffer.concat([Buffer.from('AC1024', 'ascii'), Buffer.alloc(100)]);
    expect(verificarMagicBytes('dwg', buf)).toBe(true);
  });

  it('aceita AC1032 (AutoCAD 2018)', () => {
    const buf = Buffer.concat([Buffer.from('AC1032', 'ascii'), Buffer.alloc(100)]);
    expect(verificarMagicBytes('dwg', buf)).toBe(true);
  });

  it('rejeita header desconhecido', () => {
    const buf = Buffer.concat([Buffer.from('AC9999', 'ascii'), Buffer.alloc(100)]);
    expect(verificarMagicBytes('dwg', buf)).toBe(false);
  });

  it('rejeita buffer muito pequeno', () => {
    expect(verificarMagicBytes('dwg', Buffer.from('AC10'))).toBe(false);
  });
});

describe('verificarMagicBytes — DXF', () => {
  it('aceita DXF ASCII começando com "  0\\nSECTION"', () => {
    const buf = Buffer.from('  0\nSECTION\n  2\nHEADER\n', 'utf8');
    expect(verificarMagicBytes('dxf', buf)).toBe(true);
  });

  it('aceita DXF ASCII com CRLF', () => {
    const buf = Buffer.from('  0\r\nSECTION\r\n  2\r\nHEADER\r\n', 'utf8');
    expect(verificarMagicBytes('dxf', buf)).toBe(true);
  });

  it('aceita DXF ASCII com BOM UTF-8', () => {
    const buf = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from('  0\nSECTION\n  2\nHEADER\n', 'utf8'),
    ]);
    expect(verificarMagicBytes('dxf', buf)).toBe(true);
  });

  it('aceita DXF binário', () => {
    const buf = Buffer.concat([
      Buffer.from('AutoCAD Binary DXF\r\n\x1a\x00', 'binary'),
      Buffer.alloc(50),
    ]);
    expect(verificarMagicBytes('dxf', buf)).toBe(true);
  });

  it('rejeita conteúdo não-DXF', () => {
    const buf = Buffer.from('texto aleatório qualquer', 'utf8');
    expect(verificarMagicBytes('dxf', buf)).toBe(false);
  });
});

describe('verificarMagicBytes — KML', () => {
  it('aceita XML com namespace KML', () => {
    const buf = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>', 'utf8');
    expect(verificarMagicBytes('kml', buf)).toBe(true);
  });

  it('aceita KML com BOM UTF-8', () => {
    const buf = Buffer.concat([
      Buffer.from([0xEF, 0xBB, 0xBF]),
      Buffer.from('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"/>', 'utf8'),
    ]);
    expect(verificarMagicBytes('kml', buf)).toBe(true);
  });

  it('rejeita XML sem namespace KML', () => {
    const buf = Buffer.from('<?xml version="1.0"?><root>hello</root>', 'utf8');
    expect(verificarMagicBytes('kml', buf)).toBe(false);
  });

  it('rejeita texto sem XML', () => {
    expect(verificarMagicBytes('kml', Buffer.from('not xml at all'))).toBe(false);
  });
});

describe('detectarTipoArquivo', () => {
  it('aceita .dxf com magic bytes válidos', () => {
    const buf = Buffer.from('  0\nSECTION\n  2\nHEADER\n', 'utf8');
    const r = detectarTipoArquivo('fazenda.dxf', 'application/dxf', buf);
    expect(r.tipo).toBe('dxf');
    expect(r.magicBytesOk).toBe(true);
  });

  it('aceita .dwg com magic bytes válidos', () => {
    const buf = Buffer.concat([Buffer.from('AC1024', 'ascii'), Buffer.alloc(100)]);
    const r = detectarTipoArquivo('mapa.dwg', 'application/octet-stream', buf);
    expect(r.tipo).toBe('dwg');
    expect(r.magicBytesOk).toBe(true);
  });

  it('aceita .kml com namespace correto', () => {
    const buf = Buffer.from('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"/>', 'utf8');
    const r = detectarTipoArquivo('gleba.kml', 'application/vnd.google-earth.kml+xml', buf);
    expect(r.tipo).toBe('kml');
    expect(r.magicBytesOk).toBe(true);
  });

  it('rejeita extensão não suportada', () => {
    expect(() => detectarTipoArquivo('arquivo.pdf', 'application/pdf', Buffer.alloc(10)))
      .toThrow(/Extensão.*não suportada/);
  });

  it('aceita .dxf mesmo com magic bytes inválidos (tolerância)', () => {
    const buf = Buffer.from('conteúdo qualquer não-DXF', 'utf8');
    const r = detectarTipoArquivo('teste.dxf', 'application/dxf', buf);
    expect(r.tipo).toBe('dxf');
    expect(r.magicBytesOk).toBe(false);
  });

  it('é case-insensitive na extensão', () => {
    const buf = Buffer.from('  0\nSECTION\n', 'utf8');
    const r = detectarTipoArquivo('FAZENDA.DXF', 'application/dxf', buf);
    expect(r.tipo).toBe('dxf');
  });
});
