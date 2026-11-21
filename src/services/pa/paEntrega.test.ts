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
