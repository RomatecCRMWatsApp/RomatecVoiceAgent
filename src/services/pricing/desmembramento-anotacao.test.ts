// v3.90.1 — Anotação técnica por processo (desmembramento): valor unitário ×
// quantidade, uma linha por tipo marcado (ART e/ou TRT). Sem pecas_tecnicas,
// mantém 1 ART (legado).
import { describe, it, expect } from 'vitest';
import { calcularDesmembramento } from './desmembramento';
import { anotacaoTecnica } from './params';
import type { InputDesmembramento, ResultadoCalculo } from './types';

const baseDesm: InputDesmembramento = {
  tipo: 'desmembramento',
  area_total_m2: 1000,
  valor_venal_total: 200000,
  tipo_zona: 'urbana',
  iptu_em_dia: true,
  honorario_projeto_sm: 1.0,
  numero_lotes_resultantes: 4,
};

const artRotulo = anotacaoTecnica('art_crea').rotulo;
const trtRotulo = anotacaoTecnica('trt_cft').rotulo;
const linha = (out: ResultadoCalculo, rotulo: string) =>
  out.custos.secao_2_taxas.find(i => i.descricao.startsWith(rotulo));

describe('desmembramento — anotação técnica por processo (v3.90.1)', () => {
  it('ART com valor + quantidade → valor × qtd', async () => {
    const out = await calcularDesmembramento({
      ...baseDesm,
      pecas_tecnicas: { mapa: true, memorial: true, art: true, trt: false, requerimentos: true, art_valor: 150, art_quantidade: 4 },
    });
    const l = linha(out, artRotulo);
    expect(l).toBeDefined();
    expect(l!.valor).toBe(600);
    expect(l!.descricao).toMatch(/4 ×/);
    expect(linha(out, trtRotulo)).toBeUndefined();
  });

  it('ART + TRT marcados → duas linhas (cada uma valor × qtd)', async () => {
    const out = await calcularDesmembramento({
      ...baseDesm,
      pecas_tecnicas: { mapa: true, memorial: true, art: true, trt: true, requerimentos: true, art_valor: 150, art_quantidade: 4, trt_valor: 200, trt_quantidade: 4 },
    });
    expect(linha(out, artRotulo)!.valor).toBe(600);
    expect(linha(out, trtRotulo)!.valor).toBe(800);
  });

  it('só TRT marcado → linha TRT, sem ART', async () => {
    const out = await calcularDesmembramento({
      ...baseDesm,
      pecas_tecnicas: { mapa: true, memorial: true, art: false, trt: true, requerimentos: true, trt_valor: 200, trt_quantidade: 3 },
    });
    expect(linha(out, trtRotulo)!.valor).toBe(600);
    expect(linha(out, artRotulo)).toBeUndefined();
  });

  it('sem quantidade → qtd 1 (valor unitário)', async () => {
    const out = await calcularDesmembramento({
      ...baseDesm,
      pecas_tecnicas: { mapa: true, memorial: true, art: true, trt: false, requerimentos: true, art_valor: 150 },
    });
    expect(linha(out, artRotulo)!.valor).toBe(150);
  });

  it('sem pecas_tecnicas → mantém 1 ART com valor do params (legado)', async () => {
    const out = await calcularDesmembramento({ ...baseDesm });
    const l = linha(out, artRotulo);
    expect(l).toBeDefined();
    expect(l!.valor).toBe(anotacaoTecnica('art_crea').valor);
  });
});
