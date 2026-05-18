// v3.20.0: Testes do gerador PIX BR Code (EMV).

import { describe, it, expect } from 'vitest';
import { gerarPixBrCode } from './pixBrCode';

describe('gerarPixBrCode', () => {
  it('gera payload PIX valido com chave email + valor + nome + cidade', () => {
    const code = gerarPixBrCode({
      chave: 'romatec.cad@hotmail.com',
      nome: 'J R P BEZERRA LTDA',
      cidade: 'ACAILANDIA',
      valor: 1500.50,
      txid: 'LAUDO001',
    });
    // Payload Format Indicator
    expect(code.startsWith('000201')).toBe(true);
    // Contem PIX merchant info
    expect(code).toContain('BR.GOV.BCB.PIX');
    expect(code).toContain('romatec.cad@hotmail.com');
    // Currency BRL
    expect(code).toContain('5303986');
    // Valor formatado com 2 casas
    expect(code).toContain('54071500.50');
    // Country code
    expect(code).toContain('5802BR');
    // Termina com CRC de 4 chars hex
    expect(code).toMatch(/6304[0-9A-F]{4}$/);
  });

  it('omite valor quando nao especificado (pagador define)', () => {
    const code = gerarPixBrCode({
      chave: '12345678901',
      nome: 'JOAO DA SILVA',
      cidade: 'SP',
    });
    // Nao contem campo 54 (transaction amount)
    expect(code).not.toMatch(/54\d{2}\d/);
    expect(code).toContain('5303986');
  });

  it('sanitiza acentos no nome e cidade', () => {
    const code = gerarPixBrCode({
      chave: 'test@example.com',
      nome: 'José Romário Pinto Bezerra',
      cidade: 'São Luís',
    });
    // Nome sem acentos
    expect(code).toContain('JOSE ROMARIO PINTO BEZERR'); // truncado em 25 chars
    expect(code).not.toContain('Á');
    expect(code).not.toContain('í');
    // Cidade sem acentos
    expect(code).toContain('SAO LUIS');
  });

  it('CRC16 calculado corretamente — payload conhecido roundtrip', () => {
    const code = gerarPixBrCode({
      chave: 'test@test.com',
      nome: 'TESTE',
      cidade: 'BRASILIA',
      valor: 10.00,
      txid: '***',
    });
    // CRC esta nos ultimos 4 chars apos '6304'
    const crcStr = code.slice(-4);
    expect(crcStr).toMatch(/^[0-9A-F]{4}$/);
    // Recalcular o CRC sobre o payload sem ele e comparar
    const sem = code.slice(0, -4);
    // CRC16-CCITT-FALSE inline
    let crc = 0xFFFF;
    for (let i = 0; i < sem.length; i++) {
      crc ^= sem.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
      }
    }
    const recalc = crc.toString(16).toUpperCase().padStart(4, '0');
    expect(crcStr).toBe(recalc);
  });

  it('txid com caracteres invalidos cai pro fallback "***"', () => {
    const code = gerarPixBrCode({
      chave: 'a@b.com',
      nome: 'X',
      cidade: 'Y',
      txid: '!@#$%',
    });
    // Quando txid vira string vazia apos sanitizacao, vira '***' (encapsulado: 62 07 0503***)
    expect(code).toContain('62070503***');
  });
});
