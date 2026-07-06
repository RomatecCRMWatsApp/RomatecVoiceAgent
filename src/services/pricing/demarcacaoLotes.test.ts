// v3.27.0: testes do engine de Demarcacao de Lotes (Urbana e Rural).
// Cobre validacoes, cenarios canonicos, guard de fechamento, opcionais e
// runtime read de SALARIO_MINIMO_VIGENTE.

import { describe, it, expect } from 'vitest';
import { calcularDemarcacaoLotes } from './demarcacaoLotes';
import type { InputDemarcacaoLotes, MarcoDiscriminado } from './types';

const SM_2026 = 1621.0; // pricing-params.salario_minimo_2026

function marcoConcreto(qtd: number): MarcoDiscriminado {
  return { tipo: 'concreto', quantidade: qtd, valor_unitario_congelado: 120.0 };
}
function marcoTubo(qtd: number): MarcoDiscriminado {
  return { tipo: 'tubo_galvanizado', quantidade: qtd, valor_unitario_congelado: 85.0 };
}
function marcoMadeira(qtd: number): MarcoDiscriminado {
  return { tipo: 'madeira', quantidade: qtd, valor_unitario_congelado: 35.0 };
}

const baseUrbana: InputDemarcacaoLotes = {
  subtipo: 'demarcacao_urbana',
  finalidade: 'demarcacao_inicial',
  municipio: 'Acailandia',
  uf: 'MA',
  area_m2: 500,
  num_vertices: 8,
  servico_piqueteamento: true,
  marcos: [marcoConcreto(8)],
  diarias_equipe: 2,
  km_deslocamento: 30,
  complexidade: 'media',
};

const baseRural: InputDemarcacaoLotes = {
  subtipo: 'demarcacao_rural',
  finalidade: 'demarcacao_inicial',
  municipio: 'Acailandia',
  uf: 'MA',
  area_hectares: 5,
  num_vertices: 12,
  servico_piqueteamento: true,
  marcos: [marcoConcreto(8), marcoMadeira(4)],
  diarias_equipe: 2,
  km_deslocamento: 60,
  complexidade: 'alta',
};

describe('calcularDemarcacaoLotes — validacoes', () => {
  it('1. Urbana valida (area_m2 preenchida, area_hectares undefined)', () => {
    const r = calcularDemarcacaoLotes(baseUrbana);
    expect(r.honorarios_romatec.total).toBeGreaterThan(0);
  });

  it('2. Rural valida (area_hectares preenchida, area_m2 undefined)', () => {
    const r = calcularDemarcacaoLotes(baseRural);
    expect(r.honorarios_romatec.total).toBeGreaterThan(0);
  });

  it('3. Ambas areas preenchidas (urbana) -> throw', () => {
    expect(() => calcularDemarcacaoLotes({ ...baseUrbana, area_hectares: 1 } as InputDemarcacaoLotes))
      .toThrow(/nao deve informar area_hectares/);
  });

  it('4. Rural sem area_hectares -> throw', () => {
    const bad = { ...baseRural, area_hectares: undefined } as unknown as InputDemarcacaoLotes;
    expect(() => calcularDemarcacaoLotes(bad)).toThrow(/area_hectares/);
  });

  it('5. piqueteamento=true + Σmarcos=num_vertices -> aceita', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      num_vertices: 10,
      marcos: [marcoConcreto(6), marcoTubo(4)],
    });
    expect(r.honorarios_romatec.marcos_subtotal).toBeCloseTo(6 * 120 + 4 * 85, 2);
  });

  it('6. piqueteamento=true + Σmarcos ≠ num_vertices -> throw', () => {
    expect(() => calcularDemarcacaoLotes({
      ...baseUrbana,
      num_vertices: 8,
      marcos: [marcoConcreto(5)],
    })).toThrow(/servico_piqueteamento=true exige/);
  });

  it('7. piqueteamento=false + marcos=[] -> aceita', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      servico_piqueteamento: false,
      marcos: [],
    });
    expect(r.honorarios_romatec.marcos_subtotal).toBe(0);
  });

  it('8. piqueteamento=false + marcos com Σ != vertices -> aceita', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      servico_piqueteamento: false,
      num_vertices: 8,
      marcos: [marcoConcreto(3)],
    });
    expect(r.honorarios_romatec.marcos_subtotal).toBeCloseTo(360, 2);
  });
});

describe('calcularDemarcacaoLotes — calculo principal', () => {
  it('9. Marcos discriminados: 3 tipos diferentes -> subtotais separados', () => {
    const r = calcularDemarcacaoLotes({
      ...baseRural,
      num_vertices: 12,
      marcos: [marcoConcreto(4), marcoTubo(3), marcoMadeira(5)],
    });
    const md = r.honorarios_romatec.marcos_discriminados;
    expect(md).toHaveLength(3);
    const concreto = md.find((m) => m.tipo === 'concreto');
    const tubo = md.find((m) => m.tipo === 'tubo_galvanizado');
    const madeira = md.find((m) => m.tipo === 'madeira');
    expect(concreto?.subtotal).toBeCloseTo(4 * 120, 2);
    expect(tubo?.subtotal).toBeCloseTo(3 * 85, 2);
    expect(madeira?.subtotal).toBeCloseTo(5 * 35, 2);
    expect(r.honorarios_romatec.marcos_subtotal).toBeCloseTo(4 * 120 + 3 * 85 + 5 * 35, 2);
  });

  it('10. Cenario canonico urbano: 500m² · 8 vertices · 8 concreto · 2 diarias · 30km · media · 10% desc', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, desconto_pct: 10 });
    const h = r.honorarios_romatec;
    expect(h.trt_cft).toBe(68.17);
    expect(h.tecnicos_campo).toBeCloseTo(2 * SM_2026 * 0.42, 2);
    expect(h.marcos_subtotal).toBeCloseTo(960, 2);
    expect(h.deslocamento).toBeCloseTo(105, 2);
    expect(h.area_servico).toBeCloseTo(750, 2);
    expect(h.complexidade_multiplicador).toBe(1.3);
    // total fecha com guard interno; teste auto-consistente
    expect(h.total).toBeGreaterThan(0);
  });

  it('11. Cenario canonico rural: 5ha · 12 vertices · 8 concreto + 4 madeira · alta', () => {
    const r = calcularDemarcacaoLotes(baseRural);
    const h = r.honorarios_romatec;
    expect(h.complexidade_multiplicador).toBe(1.6);
    expect(h.area_servico).toBeCloseTo(5 * 80, 2);
    expect(h.marcos_subtotal).toBeCloseTo(8 * 120 + 4 * 35, 2);
    expect(h.total).toBeGreaterThan(0);
  });

  it('12. Guard de fechamento em simples/media/alta', () => {
    for (const complexidade of ['simples', 'media', 'alta'] as const) {
      const r = calcularDemarcacaoLotes({ ...baseUrbana, complexidade });
      const soma = r.parcelas.reduce((s, p) => s + p.valor, 0);
      expect(Math.abs(soma - r.honorarios_romatec.total)).toBeLessThan(0.02);
    }
  });

  it('13. Minimo garantido (2 SM) aplicado sobre CORE quando calculo fica abaixo (extras somam por cima)', () => {
    // v3.40.0: kit GNSS e' fixo (default 1 diaria=250). Minimo aplica sobre core,
    // depois kit (e laudo se contratado) somam.
    const r = calcularDemarcacaoLotes({
      subtipo: 'demarcacao_urbana',
      finalidade: 'piqueteamento_apenas',
      municipio: 'X',
      uf: 'MA',
      area_m2: 0.01,
      num_vertices: 3,
      servico_piqueteamento: false,
      marcos: [],
      diarias_equipe: 1,
      km_deslocamento: 0,
      complexidade: 'simples',
      locacao_kit_gnss: { qtd_diarias: 0 }, // edge: sem kit pra reproduzir comportamento original
    });
    const minimo = 2 * SM_2026;
    expect(r.honorarios_romatec.total).toBe(Math.round(minimo * 100) / 100);
  });

  it('13b. Minimo + kit fixo (default qtd=1): total = minimo + 250', () => {
    const r = calcularDemarcacaoLotes({
      subtipo: 'demarcacao_urbana',
      finalidade: 'piqueteamento_apenas',
      municipio: 'X',
      uf: 'MA',
      area_m2: 0.01,
      num_vertices: 3,
      servico_piqueteamento: false,
      marcos: [],
      diarias_equipe: 1,
      km_deslocamento: 0,
      complexidade: 'simples',
    });
    const minimo = 2 * SM_2026;
    expect(r.honorarios_romatec.total).toBe(Math.round((minimo + 250) * 100) / 100);
  });

  it('14. Desconto 0% nao altera valor', () => {
    const r0 = calcularDemarcacaoLotes({ ...baseUrbana, desconto_pct: 0 });
    const rDef = calcularDemarcacaoLotes(baseUrbana);
    expect(r0.honorarios_romatec.total).toBe(rDef.honorarios_romatec.total);
    expect(r0.honorarios_romatec.desconto_valor).toBe(0);
  });

  it('15. Desconto 31% -> throw', () => {
    expect(() => calcularDemarcacaoLotes({ ...baseUrbana, desconto_pct: 31 }))
      .toThrow(/desconto_pct invalido/);
  });

  it('16. Override de valor_unitario_area substitui o default', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, valor_unitario_area: 5 });
    expect(r.honorarios_romatec.area_servico).toBeCloseTo(500 * 5, 2);
  });

  it('17. R$/km lido de pricing-params, nao hardcoded', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, km_deslocamento: 100 });
    // valor_km_deslocamento default = 3.50 (pricing-params)
    expect(r.honorarios_romatec.deslocamento).toBeCloseTo(100 * 3.5, 2);
  });
});

describe('calcularDemarcacaoLotes — opcionais', () => {
  it('18. Opcionais: 3 linhas (v3.63.5 — alinhamento virou item direto)', () => {
    const r = calcularDemarcacaoLotes(baseUrbana);
    expect(r.secao_opcionais_demarcacao.linhas).toHaveLength(3);
    expect(r.secao_opcionais_demarcacao.subtotal).toBe(0);
    const rotulos = r.secao_opcionais_demarcacao.linhas.map((l) => l.rotulo).join(' | ');
    expect(rotulos).not.toMatch(/Laudo/i);
    expect(rotulos).not.toMatch(/Alinhamento/i); // saiu dos opcionais (vira item direto)
    expect(rotulos).toMatch(/Croqui/i);
    expect(rotulos).toMatch(/Acompanhamento/i);
    expect(rotulos).toMatch(/Juridica/i);
  });

  it('19. alinhamento_cerca metros=120 × 4.5 -> entra em honorarios e SOMA no total (v3.63.5)', () => {
    const sem = calcularDemarcacaoLotes(baseUrbana);
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: { alinhamento_cerca: { contratado: true, metros: 120, valor_unitario: 4.5 } },
    });
    expect(r.honorarios_romatec.alinhamento_cerca.contratado).toBe(true);
    expect(r.honorarios_romatec.alinhamento_cerca.valor).toBeCloseTo(120 * 4.5, 2);
    expect(r.honorarios_romatec.total).toBeCloseTo(sem.honorarios_romatec.total + 120 * 4.5, 2);
    expect(r.secao_opcionais_demarcacao.linhas.find((l) => /Alinhamento/i.test(l.rotulo))).toBeUndefined();
  });

  it('20. consultoria_juridica = "sob_orcamento" (string literal)', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: { consultoria_juridica: { contratado: true, valor: 'sob_orcamento' } },
    });
    const linha = r.secao_opcionais_demarcacao.linhas.find((l) => /Juridica/i.test(l.rotulo));
    expect(linha?.valor).toBe('sob_orcamento');
    expect(linha?.contratado).toBe(true);
  });

  it('21. Croqui/acomp/juridica NAO somam; alinhamento SOMA no total (v3.63.5)', () => {
    const semOpc = calcularDemarcacaoLotes(baseUrbana);
    const comCroqui = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: { croqui_assinado: { contratado: true, valor_unitario: 180 } },
    });
    expect(comCroqui.honorarios_romatec.total).toBe(semOpc.honorarios_romatec.total);
    expect(comCroqui.secao_opcionais_demarcacao.subtotal).toBeGreaterThan(0);

    const comAlinh = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: { alinhamento_cerca: { contratado: true, metros: 100, valor_unitario: 0.42 } },
    });
    expect(comAlinh.honorarios_romatec.total).toBeCloseTo(semOpc.honorarios_romatec.total + 100 * 0.42, 2);
  });

  it('22. SALARIO_MINIMO_VIGENTE mudado em runtime -> novo calculo reflete', () => {
    const r1 = calcularDemarcacaoLotes(baseUrbana, { salarioMinimoOverride: 1500 });
    const r2 = calcularDemarcacaoLotes(baseUrbana, { salarioMinimoOverride: 2000 });
    expect(r1.honorarios_romatec.tecnicos_campo).toBeCloseTo(2 * 1500 * 0.42, 2);
    expect(r2.honorarios_romatec.tecnicos_campo).toBeCloseTo(2 * 2000 * 0.42, 2);
    expect(r2.honorarios_romatec.tecnicos_campo).toBeGreaterThan(r1.honorarios_romatec.tecnicos_campo);
    expect(r1.salario_minimo_usado).toBe(1500);
    expect(r2.salario_minimo_usado).toBe(2000);
  });
});

// ────────────────────────────────────────────────────────────────────────
// v3.38.0 — alinhamento a PROP-2026-0028-R1 (gold standard aprovado pelo CEO)
// ────────────────────────────────────────────────────────────────────────

describe('v3.38.0 — adicional de campo (insal/peric) na base', () => {
  it('23. adicional_campo_pct=0 (default) — output zerado, total nao muda', () => {
    const semAd = calcularDemarcacaoLotes(baseUrbana);
    const comAd = calcularDemarcacaoLotes({ ...baseUrbana, adicional_campo_pct: 0 });
    expect(comAd.honorarios_romatec.adicional_campo.aplicavel).toBe(false);
    expect(comAd.honorarios_romatec.adicional_campo.valor).toBe(0);
    expect(comAd.honorarios_romatec.total).toBe(semAd.honorarios_romatec.total);
  });

  it('24. adicional=20% incide SOMENTE sobre tecnicos_campo (CLT 192/II)', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, adicional_campo_pct: 20 });
    const ad = r.honorarios_romatec.adicional_campo;
    const expectado = r.honorarios_romatec.tecnicos_campo * 0.20;
    expect(ad.aplicavel).toBe(true);
    expect(ad.pct).toBe(20);
    expect(ad.valor).toBeCloseTo(expectado, 2);
  });

  it('25. adicional entra na base ANTES da complexidade (multiplicado por x1.3 etc)', () => {
    const r0 = calcularDemarcacaoLotes({ ...baseUrbana, adicional_campo_pct: 0 });
    const r20 = calcularDemarcacaoLotes({ ...baseUrbana, adicional_campo_pct: 20 });
    const delta = r20.honorarios_romatec.subtotal_apos_complexidade - r0.honorarios_romatec.subtotal_apos_complexidade;
    const tec = r20.honorarios_romatec.tecnicos_campo;
    // delta = adicional × complexidade (= 20% × tec × 1.3 para 'media')
    expect(delta).toBeCloseTo(tec * 0.20 * 1.3, 1);
  });

  it('26. adicional_campo_pct invalido (-1 ou 41) -> throw', () => {
    expect(() => calcularDemarcacaoLotes({ ...baseUrbana, adicional_campo_pct: -1 }))
      .toThrow(/adicional_campo_pct/);
    expect(() => calcularDemarcacaoLotes({ ...baseUrbana, adicional_campo_pct: 41 }))
      .toThrow(/adicional_campo_pct/);
  });
});

describe('v3.38.0 — Laudo Tecnico de Demarcacao (item direto)', () => {
  it('27. laudo_tecnico_direto.contratado=true -> soma 1 SM ao total, fora da complexidade', () => {
    const sem = calcularDemarcacaoLotes(baseUrbana);
    const com = calcularDemarcacaoLotes({
      ...baseUrbana,
      laudo_tecnico_direto: { contratado: true },
    });
    expect(com.honorarios_romatec.laudo_tecnico_direto.contratado).toBe(true);
    expect(com.honorarios_romatec.laudo_tecnico_direto.valor).toBeCloseTo(SM_2026 * 1.0, 2);
    // Diferenca exata = laudo (sem complexidade nem assessoria nem desconto)
    expect(com.honorarios_romatec.total - sem.honorarios_romatec.total).toBeCloseTo(SM_2026, 2);
  });

  it('28. Retrocompat: opcionais.laudo_tecnico.contratado=true migra pra item direto', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      opcionais: { laudo_tecnico: { contratado: true, valor_unitario_sm_multiplicador: 1.0 } },
    });
    expect(r.honorarios_romatec.laudo_tecnico_direto.contratado).toBe(true);
    expect(r.honorarios_romatec.laudo_tecnico_direto.valor).toBeCloseTo(SM_2026, 2);
  });

  it('29. Sem contratacao -> laudo_tecnico_direto.contratado=false, valor=0', () => {
    const r = calcularDemarcacaoLotes(baseUrbana);
    expect(r.honorarios_romatec.laudo_tecnico_direto.contratado).toBe(false);
    expect(r.honorarios_romatec.laudo_tecnico_direto.valor).toBe(0);
  });
});

describe('v3.40.0 — Locacao Kit GNSS (item FIXO — sempre presente)', () => {
  // v3.40.0: kit deixa de ser opcional. Default qtd_diarias=1, diaria=250.
  // User pode passar qtd_diarias=0 explicitamente pra desativar (edge case).
  it('30. input sem locacao_kit_gnss -> default qtd=1, contratado=true, valor=250 (gold standard)', () => {
    const r = calcularDemarcacaoLotes(baseUrbana);
    expect(r.honorarios_romatec.locacao_kit_gnss.contratado).toBe(true);
    expect(r.honorarios_romatec.locacao_kit_gnss.qtd_diarias).toBe(1);
    expect(r.honorarios_romatec.locacao_kit_gnss.diaria).toBeCloseTo(250, 2);
    expect(r.honorarios_romatec.locacao_kit_gnss.valor).toBeCloseTo(250, 2);
  });

  it('30b. qtd_diarias=0 explicito -> contratado=false, valor=0 (edge case: projeto sem campo)', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, locacao_kit_gnss: { qtd_diarias: 0 } });
    expect(r.honorarios_romatec.locacao_kit_gnss.contratado).toBe(false);
    expect(r.honorarios_romatec.locacao_kit_gnss.valor).toBe(0);
  });

  it('31. qtd_diarias=1, diaria default (250) -> valor=250 (diferenca vs qtd=0)', () => {
    const sem = calcularDemarcacaoLotes({ ...baseUrbana, locacao_kit_gnss: { qtd_diarias: 0 } });
    const com = calcularDemarcacaoLotes({ ...baseUrbana, locacao_kit_gnss: { qtd_diarias: 1 } });
    expect(com.honorarios_romatec.locacao_kit_gnss.contratado).toBe(true);
    expect(com.honorarios_romatec.locacao_kit_gnss.qtd_diarias).toBe(1);
    expect(com.honorarios_romatec.locacao_kit_gnss.diaria).toBeCloseTo(250, 2);
    expect(com.honorarios_romatec.locacao_kit_gnss.valor).toBeCloseTo(250, 2);
    expect(com.honorarios_romatec.total - sem.honorarios_romatec.total).toBeCloseTo(250, 2);
  });

  it('32. Meia diaria (0.5) e multiplas (3) aceitas — fora da complexidade', () => {
    const meia = calcularDemarcacaoLotes({ ...baseUrbana, locacao_kit_gnss: { qtd_diarias: 0.5 } });
    expect(meia.honorarios_romatec.locacao_kit_gnss.valor).toBeCloseTo(125, 2);
    const tres = calcularDemarcacaoLotes({ ...baseUrbana, locacao_kit_gnss: { qtd_diarias: 3 } });
    expect(tres.honorarios_romatec.locacao_kit_gnss.valor).toBeCloseTo(750, 2);
  });

  it('33. Diaria custom override (R$ 300) preserva qtd × diaria', () => {
    const r = calcularDemarcacaoLotes({
      ...baseUrbana,
      locacao_kit_gnss: { qtd_diarias: 2, diaria: 300 },
    });
    expect(r.honorarios_romatec.locacao_kit_gnss.diaria).toBe(300);
    expect(r.honorarios_romatec.locacao_kit_gnss.valor).toBeCloseTo(600, 2);
  });

  it('34. Descritivo do kit (equipamentos discriminados) presente no output', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, locacao_kit_gnss: { qtd_diarias: 1 } });
    expect(r.honorarios_romatec.locacao_kit_gnss.descritivo).toMatch(/ComNav S6/);
    expect(r.honorarios_romatec.locacao_kit_gnss.descritivo).toMatch(/T30 Plus/);
    expect(r.honorarios_romatec.locacao_kit_gnss.descritivo).toMatch(/R80/);
  });
});

describe('v3.38.0 — Parcelas 2x (50/50) vs 3x (40/30/30)', () => {
  it('35. num_parcelas omitido -> 3 parcelas (retrocompat)', () => {
    const r = calcularDemarcacaoLotes(baseUrbana);
    expect(r.parcelas).toHaveLength(3);
    expect(r.parcelas[0].percentual).toBe(40);
  });

  it('36. num_parcelas=2 -> 2 parcelas (50/50: sinal + entrega final)', () => {
    const r = calcularDemarcacaoLotes({ ...baseUrbana, num_parcelas: 2 });
    expect(r.parcelas).toHaveLength(2);
    expect(r.parcelas[0].percentual).toBe(50);
    expect(r.parcelas[1].percentual).toBe(50);
    expect(r.parcelas[0].rotulo).toMatch(/[Aa]ssinatura|[Ss]inal/);
    expect(r.parcelas[1].rotulo).toMatch(/[Ee]ntrega/);
    // Soma exata
    const soma = r.parcelas.reduce((s, p) => s + p.valor, 0);
    expect(Math.abs(soma - r.honorarios_romatec.total)).toBeLessThan(0.02);
  });

  it('37. num_parcelas=2 com total impar -> ultima parcela absorve residuo', () => {
    // total propositalmente impar via diarias estranho
    const r = calcularDemarcacaoLotes({ ...baseRural, num_parcelas: 2 });
    const t = r.honorarios_romatec.total;
    const p1 = r.parcelas[0].valor;
    const p2 = r.parcelas[1].valor;
    expect(Math.abs(p1 + p2 - t)).toBeLessThan(0.02);
  });
});

describe('v3.38.0 — Cenario canonico PROP-2026-0028-R1 (gold standard)', () => {
  // CONSTRUSUL CONSTRUCOES LTDA — Parte da Fazenda Gloria, Acailandia/MA
  // Matricula 29.689, CCIR 110.027.001.708-6
  // 29,04 ha · 4 vertices · perimetro 2.190,78 m
  // 1 diaria · 30 km · 4 marcos madeira · insal 20% · complexidade media · 2 parcelas
  // Kit GNSS 1 diaria (R$ 250) + Laudo Tecnico (R$ 1.621) = R$ 6.619,26 esperado
  const propInput: InputDemarcacaoLotes = {
    subtipo: 'demarcacao_rural',
    finalidade: 'demarcacao_inicial',
    municipio: 'Acailandia',
    uf: 'MA',
    matricula: '29.689',
    cri: 'Cartorio 03.018-9',
    denominacao_imovel: 'Parte da Fazenda Gloria',
    ccir: '110.027.001.708-6',
    area_hectares: 29.04,
    perimetro_m: 2190.78,
    num_vertices: 4,
    servico_piqueteamento: true,
    marcos: [marcoMadeira(4)],
    diarias_equipe: 1,
    km_deslocamento: 30,
    complexidade: 'media',
    adicional_campo_pct: 20,
    laudo_tecnico_direto: { contratado: true },
    locacao_kit_gnss: { qtd_diarias: 1, diaria: 250 },
    num_parcelas: 2,
  };

  it('38. Linhas individuais: TRT 68,17 · Tec 680,82 · Insal 136,16 · Marcos 140 · Desloc 105 · Area 2323,20', () => {
    const r = calcularDemarcacaoLotes(propInput);
    const h = r.honorarios_romatec;
    expect(h.trt_cft).toBeCloseTo(68.17, 2);
    expect(h.tecnicos_campo).toBeCloseTo(680.82, 2);
    expect(h.adicional_campo.valor).toBeCloseTo(136.16, 2);
    expect(h.marcos_subtotal).toBeCloseTo(140.00, 2);
    expect(h.deslocamento).toBeCloseTo(105.00, 2);
    expect(h.area_servico).toBeCloseTo(2323.20, 2);
  });

  it('39. Complexidade (×1,3): subtotal_apos = 4.489,36', () => {
    const r = calcularDemarcacaoLotes(propInput);
    const h = r.honorarios_romatec;
    expect(h.complexidade_multiplicador).toBe(1.3);
    expect(h.subtotal_apos_complexidade).toBeCloseTo(4489.36, 1);
  });

  it('40. Assessoria 5%: 224,47', () => {
    const r = calcularDemarcacaoLotes(propInput);
    expect(r.honorarios_romatec.assessoria).toBeCloseTo(224.47, 1);
  });

  it('41. Kit GNSS 1× R$ 250 + Laudo R$ 1.621 (itens diretos)', () => {
    const r = calcularDemarcacaoLotes(propInput);
    const h = r.honorarios_romatec;
    expect(h.locacao_kit_gnss.valor).toBeCloseTo(250.00, 2);
    expect(h.laudo_tecnico_direto.valor).toBeCloseTo(1621.00, 2);
  });

  it('42. VALOR TOTAL DA PROPOSTA = R$ 6.584,83', () => {
    const r = calcularDemarcacaoLotes(propInput);
    expect(r.honorarios_romatec.total).toBeCloseTo(6584.83, 1);
  });

  it('43. Parcelas 2× = R$ 3.292,42 cada (50/50)', () => {
    const r = calcularDemarcacaoLotes(propInput);
    expect(r.parcelas).toHaveLength(2);
    expect(r.parcelas[0].valor).toBeCloseTo(3292.42, 1);
    expect(r.parcelas[1].valor).toBeCloseTo(3292.42, 1);
  });

  it('44. Alinhamento R$ 0,42/m × 2.190,78 m = R$ 920,13 — SOMA no total (v3.63.5)', () => {
    const r = calcularDemarcacaoLotes({
      ...propInput,
      opcionais: {
        alinhamento_cerca: { contratado: true, metros: 2190.78, valor_unitario: 0.42 },
      },
    });
    expect(r.honorarios_romatec.alinhamento_cerca.valor).toBeCloseTo(920.13, 1);
    // v3.63.5: Alinhamento agora SOMA ao total Romatec (era opcional que nao somava).
    const r0 = calcularDemarcacaoLotes(propInput);
    expect(r.honorarios_romatec.total).toBeCloseTo(r0.honorarios_romatec.total + 920.13, 1);
  });
});
