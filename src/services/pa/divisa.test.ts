import { describe, it, expect } from 'vitest';
import { calcularDivisa, dividirPorLinha, divisaDeDxf, dxfDivisa, type DivisaSalva } from './divisa';
import { areaAssinada } from './limpezaLotes';

import { DIVISA_SALETE_MORENO } from './seeds/divisaSaleteMoreno';

const seed: DivisaSalva = DIVISA_SALETE_MORENO;
const per = seed.perimetro_pdf!.map(([x, y]) => ({ x, y }));

describe('divisa municipal — PA Salete Moreno (MT-03)', () => {
  it('reproduz o quadro de áreas do MT-03 (Açailândia × Itinga)', () => {
    const r = calcularDivisa(per, seed);
    const m = Object.fromEntries(r.municipios.map((x) => [x.nome, x]));
    expect(m['Açailândia/MA'].area_ha).toBeCloseTo(557.8593, 1);
    expect(m['Itinga do Maranhão/MA'].area_ha).toBeCloseTo(1745.7648, 1);
    expect(m['Açailândia/MA'].pct).toBeCloseTo(24.22, 1);
    expect(r.extensao_m).toBeCloseTo(4279.99, 0);
    // D-01 e D-02 do quadro do MT-03 (±0,5 m: vetor do PDF)
    expect(r.pontos).toHaveLength(2);
    expect(Math.hypot(r.pontos[0].E - 254190.612, r.pontos[0].N - 9511442.709)).toBeLessThan(0.5);
    expect(Math.hypot(r.pontos[1].E - 251163.187, r.pontos[1].N - 9509320.876)).toBeLessThan(0.5);
  });
  it('soma das partes = área do PA', () => {
    const r = calcularDivisa(per, seed);
    expect(r.municipios.reduce((s, m) => s + m.area_m2, 0)).toBeCloseTo(Math.abs(areaAssinada(per)), 0);
  });
  it('divide polígono que a linha cruza 4 vezes', () => {
    const q = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const pcs = dividirPorLinha(q, [{ x: -10, y: 30 }, { x: 50, y: 30 }, { x: 50, y: 70 }, { x: 110, y: 70 }]);
    expect(pcs).toHaveLength(2);
    expect(pcs.reduce((s, p) => s + Math.abs(areaAssinada(p)), 0)).toBeCloseTo(10000, 6);
    const pcs2 = dividirPorLinha(q, [{ x: -10, y: 30 }, { x: 110, y: 30 }, { x: 110, y: 70 }, { x: -10, y: 70 }]);
    expect(pcs2).toHaveLength(3);
  });
  it('reparte área comunitária que está sobre a divisa', () => {
    // retângulo de 200×100 m centrado em D-02 — metade de cada lado (aprox.)
    const c = [{ x: 251063, y: 9509270 }, { x: 251263, y: 9509270 }, { x: 251263, y: 9509370 }, { x: 251063, y: 9509370 }];
    const r = calcularDivisa(per, seed, { comunitarias: [{ rotulo: 'AC-TESTE', pts: c }] });
    const v = r.comunitarias[0].por_municipio;
    expect(v[0] + v[1]).toBeCloseTo(20000, 0);
    expect(Math.min(...v)).toBeGreaterThan(1000);
  });
  it('áreas comunitárias por município iguais ao componente do MT-03 (Açailândia 9,4311 · Itinga 23,9730 ha)', () => {
    const ACS: Record<string, Array<[number, number]>> = {"AC-01": [[251257.58, 9509513.36], [251197.32, 9509447.73], [251191.69, 9509442.03], [251155.99, 9509405.19], [251137.59, 9509429.62], [250955.89, 9509716.49], [251250.5, 9509907.5], [251356.72, 9509739.79], [251257.58, 9509513.36]], "AC-02": [[250809.06, 9509532.39], [250891.84, 9509593.19], [250910.57, 9509564.89], [250999.62, 9509614.58], [250868.95, 9509839.97], [250687.3, 9509722.38], [250809.06, 9509532.39]], "AC-03": [[251250.5, 9509907.5], [251157.69, 9510058.59], [251101.65, 9510163.93], [251051.14, 9510200.75], [250776.63, 9510004.35], [250608.1, 9509847.04], [250687.3, 9509722.38], [250868.95, 9509839.97], [250944.4, 9509709.83], [250955.89, 9509716.49], [251250.5, 9509907.5]], "AC-04": [[250689.79, 9512806.93], [250592.13, 9512854.42], [250656.98, 9513057.65], [250688.22, 9513043.33], [250654.21, 9512939.95], [250724.77, 9512914.08], [250689.79, 9512806.93]]};
    const comunitarias = Object.entries(ACS).map(([rotulo, p]) => ({ rotulo, pts: p.map(([x, y]) => ({ x, y })) }));
    const r = calcularDivisa(per, seed, { comunitarias });
    const iIt = r.municipios.findIndex((m) => /Itinga/.test(m.nome)), iAc = 1 - iIt;
    const soma = (i: number) => r.comunitarias.reduce((s, c) => s + c.por_municipio[i], 0) / 1e4;
    expect(soma(iAc)).toBeCloseTo(9.4311, 3);
    expect(soma(iIt)).toBeCloseTo(23.9730, 2);
    const vila = r.comunitarias.find((c) => c.rotulo === 'AC-01')!.por_municipio;
    expect(vila[iAc] / 1e4).toBeCloseTo(9.4033, 3); // nota 3 do MT-03
    expect(vila[iIt] / 1e4).toBeCloseTo(1.2170, 3);
  });
  it('DXF exportado volta pela leitura (linha + municípios)', () => {
    const r = calcularDivisa(per, seed);
    const dxf = dxfDivisa(per, seed, r);
    const d2 = divisaDeDxf(dxf);
    expect(d2.linha.length).toBe(seed.linha.length);
    const r2 = calcularDivisa(per, { ...d2, municipios: d2.municipios.map((m, i) => ({ ...m, nome: r.municipios[i].nome })) });
    expect(r2.municipios.map((m) => m.area_ha).sort()).toEqual(r.municipios.map((m) => m.area_ha).sort());
  });
});
