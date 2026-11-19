// v3.192.0 — foto do usuário: só imagem de verdade, tamanho limitado.
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, one: vi.fn(), exec: vi.fn() }));
import { lerImagemDataUrl } from './paUsuarioFoto';
import { permissaoDaRota } from './paEquipe';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
describe('foto do usuário', () => {
  it('aceita JPEG válido', () => {
    const r = lerImagemDataUrl(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    expect(r.mime).toBe('image/jpeg'); expect(r.buf.length).toBe(8);
  });
  it('recusa conteúdo que não é imagem, tipo fora da lista e arquivo grande', () => {
    expect(() => lerImagemDataUrl(`data:image/jpeg;base64,${Buffer.from('<script>').toString('base64')}`)).toThrow(/não é uma imagem/);
    expect(() => lerImagemDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toThrow(/JPG, PNG ou WebP/);
    expect(() => lerImagemDataUrl(`data:image/jpeg;base64,${Buffer.concat([jpeg, Buffer.alloc(700 * 1024)]).toString('base64')}`)).toThrow(/muito grande/);
  });
  it('qualquer pessoa da equipe cuida da própria foto', () => {
    expect(permissaoDaRota('GET', '/eu/foto')).toBe('*');
    expect(permissaoDaRota('PUT', '/eu/foto')).toBe('*');
    expect(permissaoDaRota('DELETE', '/eu/foto')).toBe('*');
  });
});
