// v3.95.0 — Levantamento Planialtimetrico (nuvem de pontos) como ITEM DIRETO na
// Proposta de Demarcacao. Contagem de pontos vem do motor de geometria
// (contarNuvemPontos sobre a poligonal) com fallback area/perimetro. Preco =
// total_pontos × R$/ponto (piso tecnico), somando no total FORA de complexidade.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { calcularDemarcacaoLotes } from '../services/pricing/demarcacaoLotes';
import { contarNuvemPontos } from '../services/geometria';
import type { InputDemarcacaoLotes } from '../services/pricing/types';

// Quadrado 60×60 m (SIRGAS/UTM ficticio) — 4 vertices, area 3600 m², perimetro 240 m.
const QUADRADO = [
  { utmE: 0, utmN: 0 },
  { utmE: 60, utmN: 0 },
  { utmE: 60, utmN: 60 },
  { utmE: 0, utmN: 60 },
];

const baseUrbana: InputDemarcacaoLotes = {
  subtipo: 'demarcacao_urbana', finalidade: 'demarcacao_inicial',
  municipio: 'Acailandia', uf: 'MA', area_m2: 3600, perimetro_m: 240,
  num_vertices: 4, servico_piqueteamento: false, marcos: [],
  diarias_equipe: 2, km_deslocamento: 30, complexidade: 'simples',
};

describe('contarNuvemPontos (motor de geometria)', () => {
  it('conta contorno + interior sobre o poligono', () => {
    const r = contarNuvemPontos(QUADRADO.map((p) => ({ e: p.utmE, n: p.utmN })), 20);
    expect(r).not.toBeNull();
    expect(r!.perimetro).toBe(Math.ceil(240 / 20)); // 12
    expect(r!.interno).toBeGreaterThan(0);
    expect(r!.total).toBe(r!.perimetro + r!.interno);
  });

  it('poligono invalido (<3 pontos) → null (fallback)', () => {
    expect(contarNuvemPontos([{ e: 0, n: 0 }, { e: 10, n: 0 }], 20)).toBeNull();
  });

  it('malha gigante além do teto → null (fallback de seguranca)', () => {
    const enorme = [{ e: 0, n: 0 }, { e: 1e6, n: 0 }, { e: 1e6, n: 1e6 }, { e: 0, n: 1e6 }];
    expect(contarNuvemPontos(enorme, 1)).toBeNull();
  });
});

describe('Planialtimetria no engine de demarcacao (v3.95.0)', () => {
  it('nao contratado → nao soma nada e fonte "nenhuma"', () => {
    const semPlani = calcularDemarcacaoLotes(baseUrbana);
    const comPlaniOff = calcularDemarcacaoLotes({
      ...baseUrbana, planialtimetrico: { contratado: false },
    });
    expect(comPlaniOff.honorarios_romatec.planialtimetrico.valor).toBe(0);
    expect(comPlaniOff.honorarios_romatec.planialtimetrico.fonte_contagem).toBe('nenhuma');
    expect(comPlaniOff.honorarios_romatec.total).toBe(semPlani.honorarios_romatec.total);
  });

  it('com poligono → conta pelo motor (fonte "poligono") e soma no total', () => {
    const base = calcularDemarcacaoLotes(baseUrbana);
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      pontos: QUADRADO,
      planialtimetrico: { contratado: true, espacamento_m: 20 },
    });
    const pl = r.honorarios_romatec.planialtimetrico;
    expect(pl.fonte_contagem).toBe('poligono');
    expect(pl.total_pontos).toBe(pl.pontos_perimetro + pl.pontos_interno);
    expect(pl.pontos_perimetro).toBe(12);
    // valor/ponto urbano default = 35; subtotal = pontos × 35 (ou piso)
    expect(pl.valor_ponto).toBe(35);
    const esperado = Math.max(pl.total_pontos * 35, 450);
    expect(pl.valor).toBeCloseTo(esperado, 2);
    // soma no total
    expect(r.honorarios_romatec.total).toBeCloseTo(base.honorarios_romatec.total + pl.valor, 2);
  });

  it('sem poligono → fallback area/perimetro (fonte "aproximacao")', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana, // area_m2=3600, perimetro_m=240, sem pontos
      planialtimetrico: { contratado: true, espacamento_m: 20 },
    });
    const pl = r.honorarios_romatec.planialtimetrico;
    expect(pl.fonte_contagem).toBe('aproximacao');
    expect(pl.pontos_perimetro).toBe(Math.ceil(240 / 20)); // 12
    expect(pl.pontos_interno).toBe(Math.ceil((3600 / (20 * 20)) * 0.7)); // ceil(9*0.7)=7
    expect(pl.total_pontos).toBe(19);
  });

  it('piso tecnico de mobilizacao quando subtotal < R$450', () => {
    // Lote pequeno: perimetro 40 m, esp 20 → 2 pontos contorno; sem area interna.
    const r = calcularDemarcacaoLotes({
      ...baseUrbana, area_m2: 1, perimetro_m: 40,
      planialtimetrico: { contratado: true, espacamento_m: 20 },
    });
    const pl = r.honorarios_romatec.planialtimetrico;
    expect(pl.subtotal).toBeLessThan(450);
    expect(pl.minimo_aplicado).toBe(true);
    expect(pl.valor).toBe(450);
  });

  it('complexidade NAO afeta a planialtimetria (item direto)', () => {
    const simples = calcularDemarcacaoLotes({
      ...baseUrbana, complexidade: 'simples', pontos: QUADRADO,
      planialtimetrico: { contratado: true, espacamento_m: 20 },
    });
    const alta = calcularDemarcacaoLotes({
      ...baseUrbana, complexidade: 'alta', pontos: QUADRADO,
      planialtimetrico: { contratado: true, espacamento_m: 20 },
    });
    // a base muda com complexidade, mas o valor da planialtimetria e' identico
    expect(alta.honorarios_romatec.planialtimetrico.valor)
      .toBe(simples.honorarios_romatec.planialtimetrico.valor);
  });

  it('valor/ponto editavel sobrepoe o default do subtipo', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana, pontos: QUADRADO,
      planialtimetrico: { contratado: true, espacamento_m: 20, valor_ponto: 50 },
    });
    expect(r.honorarios_romatec.planialtimetrico.valor_ponto).toBe(50);
  });

  it('rural usa valor/ponto R$22 default (area em hectares → m² p/ fallback)', () => {
    const r = calcularDemarcacaoLotes({
      subtipo: 'demarcacao_rural', finalidade: 'demarcacao_inicial',
      municipio: 'Acailandia', uf: 'MA', area_hectares: 1, perimetro_m: 400,
      num_vertices: 4, servico_piqueteamento: false, marcos: [],
      diarias_equipe: 2, km_deslocamento: 60, complexidade: 'simples',
      planialtimetrico: { contratado: true, espacamento_m: 20 },
    });
    expect(r.honorarios_romatec.planialtimetrico.valor_ponto).toBe(22);
    expect(r.honorarios_romatec.planialtimetrico.fonte_contagem).toBe('aproximacao');
  });
});

describe('Wire-up de fonte — UI + PDF + config (v3.95.0)', () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');
  const OBRAS = read('public', 'obras.html');
  const PDF = read('integrations', 'propostasConsultoria.ts');
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config', 'pricing-params.json'), 'utf8'));

  it('config tem bloco planialtimetrico com valores de referencia', () => {
    const pl = cfg.demarcacao_lotes_2026.planialtimetrico;
    expect(pl.valor_ponto_rural).toBe(22);
    expect(pl.valor_ponto_urbano).toBe(35);
    expect(pl.minimo_tecnico).toBe(450);
    expect(pl.espacamento_default_m).toBe(20);
  });

  it('obras.html tem o bloco de UI e envia planialtimetrico no montarDadosImovel', () => {
    expect(OBRAS).toMatch(/id="dmPlaniAtiva"/);
    expect(OBRAS).toMatch(/id="dmPlaniEsp"/);
    expect(OBRAS).toMatch(/id="dmPlaniVP"/);
    expect(OBRAS).toMatch(/planialtimetrico:\s*document\.getElementById\('dmPlaniAtiva'\)/);
    // pontos do croqui viajam pro backend (contagem exata)
    expect(OBRAS).toMatch(/dados\.pontos\s*=\s*pts/);
  });

  it('PDF renderiza a subseção 4.4c e o item de escopo condicional', () => {
    expect(PDF).toMatch(/4\.4c Levantamento Planialtimetrico/);
    expect(PDF).toMatch(/Levantamento planialtimetrico por nuvem de pontos/);
    expect(PDF).toMatch(/planiHr\.fonte_contagem === 'aproximacao'/);
  });
});
