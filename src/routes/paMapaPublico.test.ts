import { describe, it, expect } from 'vitest';
import { tokenMapaPublico, lerTokenMapa, geoPublico, textoMapaPublico, htmlMapaPublico } from './paMapaPublico';

describe('v3.182.0 — mapa público dos lotes', () => {
  it('link assinado por projeto', () => {
    expect(lerTokenMapa(tokenMapaPublico(1))).toBe(1);
    expect(lerTokenMapa(tokenMapaPublico(1).replace(/^1-/, '2-'))).toBeNull();
    expect(lerTokenMapa('qualquer')).toBeNull();
  });
  it('só vai lote, associado, lote da vila e chácara — sem área, perímetro, CPF, telefone', () => {
    const g = geoPublico({ features: [
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { tipo: 'LOTE', lote: '43', area_ha: 30.52, area_util_ha: 30.5, perimetro_m: 2297, vertices: 15, confrontantes: ['Lote 31'],
        beneficiario: { associado_id: 9, nome: 'GAELE', cpf: '029.123.803-32', telefone: '99', numero: 'PASM-028', whatsapp_status: 'VALIDO', lote_vila: '28', denominacao: 'Chácara São José II' } } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: { tipo: 'PERIMETRO', rotulo: 'Perímetro do PA', area_ha: 2300 } },
    ] });
    expect(g.features[0].properties).toEqual({ tipo: 'LOTE', lote: '43', beneficiario: { nome: 'GAELE', lote_vila: '28', denominacao: 'Chácara São José II' } });
    expect(g.features[1].properties).toEqual({ tipo: 'PERIMETRO', rotulo: 'Perímetro do PA' });
    expect(JSON.stringify(g)).not.toMatch(/area|perimetro_m|cpf|telefone|PASM|whatsapp/i);
  });
  it('texto do grupo e página usam o motor compartilhado', () => {
    expect(textoMapaPublico('PA Salete Moreno', 'https://x/pa/mapa/1-a')).toContain('https://x/pa/mapa/1-a');
    const h = htmlMapaPublico({ nome: 'PA Salete Moreno', municipio: 'Açailândia', uf: 'MA', associacao: null, emblema: null, brasao: null }, '1-abc');
    expect(h).toContain('/js/pa-mapa-motor.js');
    expect(h).toContain('/pa/mapa/1-abc/geo.json');
    expect(h).not.toMatch(/area_ha|hectare|alqueire/i);
  });
});
