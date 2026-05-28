// v3.40.0: testes do hotfix dos 5 bugs identificados na proposta PROP-2026-0029-R1
// (regressao do PROP-2026-0028-R1, gold standard).
//
// BUG 1 — Finalidade voltava ao texto de rascunho hardcoded.
// BUG 2 — Linha "Locação Kit GNSS" sumia (era opcional). Agora e' FIXA.
// BUG 3 — Alinhamento de cerca sem memoria de calculo. Agora tem.
// BUG 4 — Discriminacao do kit precisa renderizar abaixo da linha (multilinha).
// BUG 5 — Perimetro 2.190,78 vs 2.190,79 (formatacao inconsistente).
//
// Tudo testavel por unit testing do engine + regex no propostasConsultoria.ts
// (PDF render). PDF visual e' difamado e' fora do escopo do CI.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  calcularDemarcacaoLotes,
} from '../services/pricing/demarcacaoLotes';
import {
  montarFinalidadeDemarcacao,
} from '../services/pdf/demarcacaoFinalidade';
import type { InputDemarcacaoLotes } from '../services/pricing/types';

const PROPOSTAS_CONS_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'integrations', 'propostasConsultoria.ts'),
  'utf-8',
);

// ──────────────────────────────────────────────────────────────────────
// BUG 1 — Finalidade rural com denominacao + NBR 13133 + SIRGAS2000
// ──────────────────────────────────────────────────────────────────────

describe('v3.40.0 — BUG 1: Finalidade rural alinhada a PROP-2026-0028-R1', () => {
  it('1. Rural com denominacao -> cita denominacao + parcela de gleba + NBR 13133 + SIRGAS2000', () => {
    const f = montarFinalidadeDemarcacao('demarcacao_inicial', 'demarcacao_rural', {
      denominacao_imovel: 'Parte da Fazenda Gloria',
    });
    expect(f).toContain('Parte da Fazenda Gloria');
    expect(f).toContain('parcela de gleba rural');
    expect(f).toContain('NTGIR 3a Ed. (INCRA)');
    expect(f).toContain('NBR 13133');
    expect(f).toContain('SIRGAS2000');
    // NAO contem o texto de rascunho antigo:
    expect(f).not.toContain('definidos em projeto');
  });

  it('2. Rural sem denominacao -> usa fallback "parte de gleba rural"', () => {
    const f = montarFinalidadeDemarcacao('demarcacao_inicial', 'demarcacao_rural', {});
    expect(f).toContain('parte de gleba rural');
  });

  it('3. Urbana -> cita loteamento/quadra/lote + NBR 13133 (sem NTGIR/SIRGAS)', () => {
    const f = montarFinalidadeDemarcacao('demarcacao_inicial', 'demarcacao_urbana', {
      loteamento_nome: 'Vila Boa',
      quadra: 'A',
      lote: '10',
    });
    expect(f).toContain('Loteamento Vila Boa');
    expect(f).toContain('Quadra A');
    expect(f).toContain('Lote 10');
    expect(f).toContain('NBR 13133');
    expect(f).not.toContain('NTGIR');
    expect(f).not.toContain('SIRGAS2000');
  });

  it('4. Outras finalidades (redemarcacao, subdivisao, piqueteamento) usam o texto legado', () => {
    const fr = montarFinalidadeDemarcacao('redemarcacao', 'demarcacao_rural', {});
    expect(fr).toMatch(/[Rr]epiqueteamento/);
    const fs2 = montarFinalidadeDemarcacao('subdivisao_lote', 'demarcacao_urbana', {});
    expect(fs2).toMatch(/desmembramento|remembramento/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// BUG 2 — Locacao Kit GNSS e' item FIXO (sempre presente)
// ──────────────────────────────────────────────────────────────────────

describe('v3.40.0 — BUG 2: Kit GNSS sempre presente nos honorarios', () => {
  const baseInput: InputDemarcacaoLotes = {
    subtipo: 'demarcacao_rural',
    finalidade: 'demarcacao_inicial',
    municipio: 'Acailandia',
    uf: 'MA',
    area_hectares: 29.04,
    perimetro_m: 2190.78,
    num_vertices: 4,
    servico_piqueteamento: true,
    marcos: [{ tipo: 'madeira', quantidade: 4, valor_unitario_congelado: 35 }],
    diarias_equipe: 1,
    km_deslocamento: 30,
    complexidade: 'media',
    adicional_campo_pct: 20,
    laudo_tecnico_direto: { contratado: true },
    num_parcelas: 2,
  };

  it('5. Input sem locacao_kit_gnss -> engine retorna kit com qtd=1, valor=250 (gold standard)', () => {
    const r = calcularDemarcacaoLotes(baseInput);
    expect(r.honorarios_romatec.locacao_kit_gnss.contratado).toBe(true);
    expect(r.honorarios_romatec.locacao_kit_gnss.qtd_diarias).toBe(1);
    expect(r.honorarios_romatec.locacao_kit_gnss.valor).toBe(250);
  });

  it('6. Total ja inclui Kit GNSS por default (PROP-2026-0028-R1 R$ 6.619,26)', () => {
    const r = calcularDemarcacaoLotes(baseInput);
    expect(r.honorarios_romatec.total).toBeCloseTo(6619.26, 1);
  });

  it('7. Engine NAO inclui Kit GNSS se user passa qtd_diarias=0 explicito (edge case)', () => {
    const r = calcularDemarcacaoLotes({ ...baseInput, locacao_kit_gnss: { qtd_diarias: 0 } });
    expect(r.honorarios_romatec.locacao_kit_gnss.contratado).toBe(false);
    expect(r.honorarios_romatec.total).toBeCloseTo(6619.26 - 250, 1);
  });

  it('8. Descritivo do Kit (equipamentos) presente no output', () => {
    const r = calcularDemarcacaoLotes(baseInput);
    const desc = r.honorarios_romatec.locacao_kit_gnss.descritivo;
    expect(desc).toMatch(/ComNav S6/);
    expect(desc).toMatch(/T30 Plus/);
    expect(desc).toMatch(/R80/);
    expect(desc).toMatch(/tripe/i);
  });

  it('9. PDF render tem subsecao 4.3 Locacao Kit GNSS (NAO inline na 4. Honorarios)', () => {
    // Kit foi promovido a subsecao propria (4.3)
    expect(PROPOSTAS_CONS_TS).toMatch(/4\.3 Locacao de Equipamentos — Kit GNSS/);
    // E' renderizado quando o output tem o campo e valor > 0
    expect(PROPOSTAS_CONS_TS).toMatch(/hr\.locacao_kit_gnss && hr\.locacao_kit_gnss\.valor > 0/);
  });

  it('10. PDF render tem subsecao 4.4 Laudo (condicional ao contratado)', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/4\.4 Laudo Tecnico de Demarcacao/);
    expect(PROPOSTAS_CONS_TS).toMatch(/hr\.laudo_tecnico_direto\.contratado/);
  });

  it('11. Ordem travada: 4.2 Marcos antes de 4.3 Locacao antes de 4.4 Laudo antes de 4.5 FQNS', () => {
    const i42 = PROPOSTAS_CONS_TS.indexOf('4.2 Marcos Discriminados');
    const i43 = PROPOSTAS_CONS_TS.indexOf('4.3 Locacao de Equipamentos');
    const i44 = PROPOSTAS_CONS_TS.indexOf('4.4 Laudo Tecnico de Demarcacao');
    const i45 = PROPOSTAS_CONS_TS.indexOf('4.5 Identificacao dos Marcos');
    expect(i42).toBeGreaterThan(0);
    expect(i43).toBeGreaterThan(i42);
    expect(i44).toBeGreaterThan(i43);
    expect(i45).toBeGreaterThan(i44);
  });

  it('12. Linhas inline da secao 4 NAO contem mais Kit/Laudo (foram movidos pra subsecoes)', () => {
    // O array linhasHon nao deve mais ter "Kit GNSS" como label inline.
    // Aceita-se comentario citando — mas nao push() com esse label.
    const matchKitInlinePush = PROPOSTAS_CONS_TS.match(
      /arr\.push\(\{[\s\S]{0,200}?label:[\s\S]{0,80}?Locacao de equipamentos — Kit GNSS/,
    );
    expect(matchKitInlinePush).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// BUG 3 — Alinhamento cerca exibe regra completa
// ──────────────────────────────────────────────────────────────────────

describe('v3.40.0 — BUG 3: Alinhamento cerca com regra de calculo', () => {
  it('13. Engine inclui `detalhe` na linha de alinhamento com vUnit + perimetro default', () => {
    const r = calcularDemarcacaoLotes({
      subtipo: 'demarcacao_rural',
      finalidade: 'demarcacao_inicial',
      municipio: 'X', uf: 'MA',
      area_hectares: 29.04,
      perimetro_m: 2190.78,
      num_vertices: 4,
      servico_piqueteamento: false,
      marcos: [],
      diarias_equipe: 1, km_deslocamento: 0,
      complexidade: 'media',
      opcionais: { alinhamento_cerca: { contratado: true, metros: 2190.78, valor_unitario: 0.42 } },
    });
    const linha = r.secao_opcionais_demarcacao.linhas.find(l => /Alinhamento/i.test(l.rotulo));
    expect(linha?.detalhe).toBeDefined();
    expect(linha!.detalhe).toMatch(/R\$ 0,42\/m/);
    expect(linha!.detalhe).toMatch(/2\.190,78 m/);
    expect(linha!.detalhe).toMatch(/editavel p\/ alinhamento parcial/i);
  });

  it('14. Engine sem perimetro_m -> detalhe ainda renderiza (sem citar default)', () => {
    const r = calcularDemarcacaoLotes({
      subtipo: 'demarcacao_urbana',
      finalidade: 'demarcacao_inicial',
      municipio: 'X', uf: 'MA',
      area_m2: 500,
      num_vertices: 4,
      servico_piqueteamento: false,
      marcos: [],
      diarias_equipe: 1, km_deslocamento: 0,
      complexidade: 'simples',
      opcionais: { alinhamento_cerca: { contratado: true, metros: 100, valor_unitario: 0.42 } },
    });
    const linha = r.secao_opcionais_demarcacao.linhas.find(l => /Alinhamento/i.test(l.rotulo));
    expect(linha?.detalhe).toMatch(/R\$ 0,42\/m/);
    expect(linha?.detalhe).not.toMatch(/default perimetro/);
  });

  it('15. PDF render exibe `detalhe` abaixo do rotulo (Helvetica-Oblique, cor #555)', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/const det = \(l as \{ detalhe\?: string \}\)\.detalhe/);
    expect(PROPOSTAS_CONS_TS).toMatch(/if \(det\)\s*\{[\s\S]{0,200}?fontSize\(8\)[\s\S]{0,100}?Helvetica-Oblique/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// BUG 4 — Discriminacao do Kit renderiza como bloco multilinha
// ──────────────────────────────────────────────────────────────────────

describe('v3.40.0 — BUG 4: Discriminacao Kit em bloco abaixo da linha', () => {
  it('16. PDF render da subsecao 4.3 inclui descritivo do kit como linha proprias', () => {
    // Apos o valor R$ X, renderiza descritivo (ComNav S6, T30 Plus, etc.) em uma linha propria
    expect(PROPOSTAS_CONS_TS).toMatch(/kg\.descritivo[\s\S]{0,300}?fontSize\(8\)[\s\S]{0,80}?text\(kg\.descritivo/);
  });

  it('17. Diaria editavel — frase clarificadora visivel no PDF', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/Diaria editavel; admite meia ou multiplas diarias/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// BUG 5 — Perimetro com fonte unica + toFixed(2) consistente
// ──────────────────────────────────────────────────────────────────────

describe('v3.40.0 — BUG 5: Perimetro com formatacao consistente (2.190,78 sempre)', () => {
  const HELPER_TS = fs.readFileSync(
    path.join(process.cwd(), 'src', 'services', 'pdf', 'demarcacaoFinalidade.ts'),
    'utf-8',
  );

  it('18. Helper formatarPerimetroBr fixa 2 casas decimais (min + max)', () => {
    expect(HELPER_TS).toMatch(/export function formatarPerimetroBr\(perimetroM: number\)/);
    expect(HELPER_TS).toMatch(/minimumFractionDigits: 2,\s*\n?\s*maximumFractionDigits: 2/);
  });

  it('18b. Funcao em runtime: 2190.78 -> "2.190,78" (formato BR)', async () => {
    const { formatarPerimetroBr } = await import('../services/pdf/demarcacaoFinalidade');
    expect(formatarPerimetroBr(2190.78)).toBe('2.190,78');
    // 2190.789 deve truncar pra 2 casas (era exatamente o bug 78 vs 79)
    expect(formatarPerimetroBr(2190.789)).toMatch(/^2\.190,7(8|9)$/);
    // 2190.785 -> banker rounding produz 2,79 em alguns engines; teste so' verifica 2 casas
    expect(formatarPerimetroBr(2190).split(',')[1]).toBe('00');
  });

  it('19. Secao 1 (Identificacao) usa formatarPerimetroBr (nao toLocaleString inline)', () => {
    // Garante que perimetro nao e' formatado inline com toLocaleString sem maximumFractionDigits
    const m = PROPOSTAS_CONS_TS.match(/Perimetro:\s*' \+ formatarPerimetroBr\(perimetro\)/);
    expect(m).not.toBeNull();
  });

  it('20. Area_m2 e area_hectares tambem usam maximumFractionDigits explicito', () => {
    // Tres ocorrencias: m2 (2 dec), hectares (4 dec) e perimetro (2 dec via helper)
    const matches = PROPOSTAS_CONS_TS.match(/maximumFractionDigits:\s*\d+/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Texto do total bate com a soma — locacao nao e' mais "quando contratado"
// ──────────────────────────────────────────────────────────────────────

describe('v3.40.0 — Texto do total coerente com soma real', () => {
  it('21. Nota do bloco verde cita "Locacao de Kit GNSS (item fixo)" — nao mais condicional', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/Locacao de Kit GNSS \(item fixo\)/);
  });

  it('22. Laudo continua marcado como "(quando contratado)"', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/Laudo Tecnico de Demarcacao \(quando contratado\)/);
  });

  it('23. NAO contem mais o texto antigo "Kit GNSS e Laudo ... (itens diretos, quando contratados)"', () => {
    expect(PROPOSTAS_CONS_TS).not.toMatch(/itens diretos, quando contratados/);
  });
});
