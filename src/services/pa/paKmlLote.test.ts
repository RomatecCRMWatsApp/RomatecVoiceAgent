// v3.193.0 — KML do lote (Organic Maps) e texto do passo a passo.
import { describe, it, expect, vi } from 'vitest';
vi.mock('./paDb', () => ({ pool: {}, rows: vi.fn(), one: vi.fn(), exec: vi.fn(), registrarEvento: vi.fn() }));
vi.mock('./paMapas', () => ({ buscarSubdivisao: vi.fn(), vinculosParcelas: vi.fn(), buscarPerimetro: vi.fn(), buscarVila: vi.fn(), dadosCabecalho: vi.fn() }));
vi.mock('./paRepo', () => ({ buscarProjeto: vi.fn() }));
import { kmlDoLote, textoKml, LINK_ORGANIC_ANDROID, LINK_ORGANIC_IPHONE } from './paKmlLote';

describe('KML do lote', () => {
  const k = kmlDoLote({ lote: '10', titulo: 'LT-10 — FULANA & CIA', descricao: 'teste', vertices: [{ nome: 'M-036', lat: -4.9, lon: -47.4 }, { nome: 'M-037', lat: -4.91, lon: -47.41 }, { nome: 'M-040', lat: -4.92, lon: -47.4 }] });
  it('linha fechada do limite + polígono + um ponto por vértice, com o código do marco', () => {
    expect(k).toContain('<LineString>');
    expect(k).toContain('<Polygon>');
    expect((k.match(/<Point>/g) || []).length).toBe(3);
    expect(k).toContain('<name>M-037</name>');
    const anel = /<LineString><tessellate>1<\/tessellate><coordinates>([^<]+)</.exec(k)![1].split(' ');
    expect(anel[0]).toBe(anel[anel.length - 1]); // fecha a poligonal
    expect(k).toContain('FULANA &amp; CIA'); // XML escapado
  });
  it('passo a passo com os links do Organic Maps', () => {
    const t = textoKml('TATIANE DA SILVA', '10');
    expect(t).toContain('Tatiane, o mapa do seu lote LT-10');
    expect(t).toContain(LINK_ORGANIC_ANDROID); expect(t).toContain(LINK_ORGANIC_IPHONE);
    expect(t).toMatch(/Organic Maps/);
  });
});
