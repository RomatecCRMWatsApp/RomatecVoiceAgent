// v3.108.0: deduplicacao de fotos por hash de conteudo.
//
// ALCANCE REAL (importante pra quem for mexer nisto depois):
// o carimbo e queimado no JPEG pelo CLIENTE e inclui o horario da captura
// ("🕒 dd/mm/aaaa, hh:mm:ss"). Logo, duas capturas da MESMA cena produzem bytes
// DIFERENTES e nao sao detectadas como duplicata. O que esta dedup pega e reenvio
// do mesmo arquivo: fila offline reprocessada, sync duplicado, upload repetido.
//
// Nao foi usado hash perceptual de proposito: o descarte e silencioso e sem
// confirmacao, entao um falso positivo apagaria foto legitima de vistoria sem
// ninguem perceber. Exato e conservador; parecido seria perigoso aqui.

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { calcularHashFoto } from '../integrations/galeria';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('galeria — hash de conteudo pra dedup', () => {
  it('1. hash e do BINARIO, nao do texto base64', () => {
    const conteudo = 'bytes-da-foto';
    const esperado = createHash('sha256').update(Buffer.from(conteudo, 'utf8')).digest('hex');
    expect(calcularHashFoto(b64(conteudo))).toBe(esperado);
  });

  it('2. mesmo conteudo -> mesmo hash (base para o descarte)', () => {
    expect(calcularHashFoto(b64('foto-A'))).toBe(calcularHashFoto(b64('foto-A')));
  });

  it('3. conteudo diferente -> hash diferente', () => {
    expect(calcularHashFoto(b64('foto-A'))).not.toBe(calcularHashFoto(b64('foto-B')));
  });

  it('4. 1 byte de diferenca ja muda o hash — e por isso que o carimbo com horario impede a dedup de capturas distintas', () => {
    const a = calcularHashFoto(b64('cena-identica 15:19:34'));
    const b = calcularHashFoto(b64('cena-identica 15:19:35'));
    expect(a).not.toBe(b);
  });

  it('5. formato: 64 chars hex minusculo (cabe no CHAR(64) da coluna)', () => {
    const h = calcularHashFoto(b64('qualquer'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('6. base64 com quebras de linha resolve pro mesmo binario', () => {
    const puro = b64('conteudo-teste-do-payload');
    const quebrado = puro.replace(/(.{8})/g, '$1\n');
    expect(calcularHashFoto(quebrado)).toBe(calcularHashFoto(puro));
  });

  it('7. o hash do front (crypto.subtle) tem que bater com o do backend', () => {
    // O front faz atob -> Uint8Array -> crypto.subtle.digest('SHA-256').
    // Aqui reproduzimos esse caminho e conferimos que da o mesmo digest, senao
    // a dedup local descartaria coisa que o servidor aceitaria (e vice-versa).
    const payload = b64('foto-de-campo-123');
    const bin = Buffer.from(payload, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const viaFront = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    expect(viaFront).toBe(calcularHashFoto(payload));
  });
});
