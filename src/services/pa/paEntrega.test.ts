// v3.196.0 — entrega: leitura do nº da TRT e validação das posições das assinaturas.
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, one: vi.fn(), rows: vi.fn(), exec: vi.fn(), num: Number, registrarEvento: vi.fn() }));
vi.mock('./paDossie', () => ({ pdfDossie: vi.fn(), listarDossies: vi.fn() }));
vi.mock('./paDocumentos', () => ({ uploadDocumento: vi.fn() }));
import { extrairNumeroTrt, validarPosicoes } from './paEntrega';
import { permissaoDaRota } from './paEquipe';

describe('nº da TRT lido do PDF', () => {
  it('padrão CFT (BR + dígitos)', () => { expect(extrairNumeroTrt('CONSELHO FEDERAL ...\nTRT OBRA/SERVIÇO Nº BR20261234567\n')).toBe('BR20261234567'); });
  it('"Nº da TRT: ..."', () => { expect(extrairNumeroTrt('Nº da TRT: 2026.0001234-5')).toBe('2026.0001234-5'); });
  it('sem número → null (a tela pede para digitar)', () => { expect(extrairNumeroTrt('Boleto de pagamento — valor R$ 100,00')).toBeNull(); });
});
describe('posições das assinaturas', () => {
  it('aceita frações dentro da página e do documento', () => { expect(validarPosicoes([{ pagina: 2, x: 0.6, y: 0.85 }], 5)[0]).toEqual({ pagina: 2, x: 0.6, y: 0.85, w: 0.3, h: 0.075 }); });
  it('recusa página inexistente, fora da folha ou sem posição', () => {
    expect(() => validarPosicoes([{ pagina: 9, x: 0.1, y: 0.1 }], 5)).toThrow();
    expect(() => validarPosicoes([{ pagina: 0, x: 1.4, y: 0.1 }], 5)).toThrow();
    expect(() => validarPosicoes([], 5)).toThrow();
  });
  it('certificado só para o ADMIN; vias pela permissão de dossiês', () => {
    expect(permissaoDaRota('POST', '/certificado')).toBeNull();
    expect(permissaoDaRota('GET', '/projetos/7/dossies/05/vias.pdf')).toBe('dossies');
  });
});

// v3.196.1: posicionamento automático das assinaturas
import { posicoesAutomaticas, type ItemTexto } from './paEntrega';
describe('posicionamento automático', () => {
  const pg = (pagina: number, str: string, x: number, y: number, w: number, fs = 8): ItemTexto => ({ pagina, str, x, y, w, fs, pw: 595, ph: 842 });
  const nomes = ['José Romário Pinto Bezerra'];
  it('nome com o cargo logo abaixo → selo centralizado acima do nome; rodapé e tabela ficam de fora', () => {
    const it = [
      pg(0, 'José Romário Pinto Bezerra', 247, 596, 102), pg(0, 'Técnico em Agrimensura · CFT 01209185369', 230, 586, 140, 7),
      pg(0, 'Responsável técnico: José Romário Pinto Bezerra · Técnico em Agrimensura', 28, 50, 356, 7),
      pg(1, 'JOSÉ ROMÁRIO PINTO BEZERRA', 124, 668, 116), pg(1, 'José Romário Pinto Bezerra · Técnico em Agrimensura · CFT', 25, 101, 277, 7),
    ];
    const r = posicoesAutomaticas(it, nomes);
    expect(r).toHaveLength(1);
    expect(r[0].pagina).toBe(0);
    const cx = (r[0].x + r[0].w! / 2) * 595;
    expect(Math.abs(cx - (247 + 51))).toBeLessThan(1);          // centralizado no nome
    expect((1 - r[0].y - r[0].h!) * 842).toBeGreaterThan(596);  // base do selo acima do nome
  });
  it('rótulo curto acima do nome ("CONTRATADA – …") empurra o selo para cima dele', () => {
    const r = posicoesAutomaticas([pg(0, 'CONTRATADA – J R P Bezerra Ltda (Romatec)', 333, 113, 166, 7.5), pg(0, 'José Romário Pinto Bezerra · CFT/MA 01209185369', 317, 105, 198, 6.5)], nomes);
    expect((1 - r[0].y - r[0].h!) * 842).toBeGreaterThan(113 + 7.5);
  });
});
