// v3.29.0: testes do calculator de aditivo de campo (insalubridade/periculosidade).
// Standalone — usa repo mock em memoria, sem deps de mysql/pdfkit.

import { describe, it, expect } from 'vitest';
import {
  calcularAditivoCampo,
  validarCombinacao,
  type AditivoConfig,
  type AditivoConfigRepoLike,
  type AditivoTipo,
  type AditivoGrau,
} from './aditivoCampoCalculator';
import { defaultParaSubtipo, ADITIVO_DEFAULTS } from './aditivoCampoDefaults';

function fakeRepo(configs: AditivoConfig[]): AditivoConfigRepoLike {
  return {
    async findByTipoGrau(tipo, grau) {
      return configs.find((c) => c.tipo === tipo && c.grau === grau) ?? null;
    },
  };
}

const TEMPLATES: AditivoConfig[] = [
  { id: 1, tipo: 'insalubridade', grau: 'minimo',  percentual: 10, descricao_curta: 'Insal min',  fundamentacao_legal: 'CLT 192 NR-15', texto_explicativo_md: '## Insalubridade minimo\n\nTexto base.', ativo: true },
  { id: 2, tipo: 'insalubridade', grau: 'medio',   percentual: 20, descricao_curta: 'Insal med',  fundamentacao_legal: 'CLT 192 NR-15', texto_explicativo_md: '## Insalubridade medio\n\nTexto base.', ativo: true },
  { id: 3, tipo: 'insalubridade', grau: 'maximo',  percentual: 40, descricao_curta: 'Insal max',  fundamentacao_legal: 'CLT 192 NR-15', texto_explicativo_md: '## Insalubridade maximo\n\nTexto base.', ativo: true },
  { id: 4, tipo: 'periculosidade', grau: 'unico',  percentual: 30, descricao_curta: 'Peric',      fundamentacao_legal: 'CLT 193 NR-16', texto_explicativo_md: '## Periculosidade\n\nTexto base.', ativo: true },
];

describe('aditivoCampoCalculator — validarCombinacao', () => {
  it('1. periculosidade + grau != unico -> throw', () => {
    expect(() => validarCombinacao('periculosidade', 'medio' as AditivoGrau)).toThrow(/Periculosidade so aceita grau "unico"/);
  });
  it('2. insalubridade + grau = unico -> throw', () => {
    expect(() => validarCombinacao('insalubridade', 'unico')).toThrow(/Insalubridade so aceita/);
  });
  it('3. insalubridade + grau minimo/medio/maximo -> ok', () => {
    for (const g of ['minimo', 'medio', 'maximo'] as AditivoGrau[]) {
      expect(() => validarCombinacao('insalubridade', g)).not.toThrow();
    }
  });
  it('4. periculosidade + unico -> ok', () => {
    expect(() => validarCombinacao('periculosidade', 'unico')).not.toThrow();
  });
});

describe('aditivoCampoCalculator — calculo', () => {
  it('5. insalubridade grau medio (20%) sobre R$ 1.800 = R$ 360', async () => {
    const r = await calcularAditivoCampo({
      tipo: 'insalubridade', grau: 'medio',
      base_calculo: { diarias_tecnico_valor: 1200, diarias_equipamento_valor: 600 },
    }, fakeRepo(TEMPLATES));
    expect(r.percentual).toBe(20);
    expect(r.base_calculo_valor).toBe(1800);
    expect(r.valor_aditivo).toBe(360);
    expect(r.config_id).toBe(2);
  });

  it('6. periculosidade (30%) sobre R$ 1.800 = R$ 540', async () => {
    const r = await calcularAditivoCampo({
      tipo: 'periculosidade', grau: 'unico',
      base_calculo: { diarias_tecnico_valor: 1200, diarias_equipamento_valor: 600 },
    }, fakeRepo(TEMPLATES));
    expect(r.valor_aditivo).toBe(540);
  });

  it('7. insalubridade grau minimo (10%) e maximo (40%) — arredondamento HALF_UP', async () => {
    const repo = fakeRepo(TEMPLATES);
    const min = await calcularAditivoCampo({
      tipo: 'insalubridade', grau: 'minimo',
      base_calculo: { diarias_tecnico_valor: 333.33, diarias_equipamento_valor: 166.67 },
    }, repo);
    // base = 500.00, 10% = 50.00
    expect(min.valor_aditivo).toBeCloseTo(50, 2);
    const max = await calcularAditivoCampo({
      tipo: 'insalubridade', grau: 'maximo',
      base_calculo: { diarias_tecnico_valor: 250, diarias_equipamento_valor: 250 },
    }, repo);
    expect(max.valor_aditivo).toBe(200);
  });

  it('8. config inativa -> throw', async () => {
    const inativa = [{ ...TEMPLATES[1], ativo: false }];
    await expect(
      calcularAditivoCampo({
        tipo: 'insalubridade', grau: 'medio',
        base_calculo: { diarias_tecnico_valor: 100, diarias_equipamento_valor: 0 },
      }, fakeRepo(inativa)),
    ).rejects.toThrow(/desativada/);
  });

  it('9. config inexistente -> throw', async () => {
    await expect(
      calcularAditivoCampo({
        tipo: 'insalubridade', grau: 'medio',
        base_calculo: { diarias_tecnico_valor: 100, diarias_equipamento_valor: 0 },
      }, fakeRepo([])),
    ).rejects.toThrow(/nao encontrada/);
  });

  it('10. concatena observacao tecnica no texto_pdf_md', async () => {
    const r = await calcularAditivoCampo({
      tipo: 'insalubridade', grau: 'medio',
      base_calculo: { diarias_tecnico_valor: 100, diarias_equipamento_valor: 100 },
      observacao_tecnica: 'Imovel em mata fechada com presenca de jararaca',
    }, fakeRepo(TEMPLATES));
    expect(r.texto_pdf_md).toContain('Observacao tecnica especifica');
    expect(r.texto_pdf_md).toContain('mata fechada com presenca de jararaca');
  });

  it('11. observacao tecnica vazia/somente espacos NAO concatena', async () => {
    const r = await calcularAditivoCampo({
      tipo: 'insalubridade', grau: 'medio',
      base_calculo: { diarias_tecnico_valor: 100, diarias_equipamento_valor: 0 },
      observacao_tecnica: '   ',
    }, fakeRepo(TEMPLATES));
    expect(r.texto_pdf_md).not.toContain('Observacao tecnica especifica');
  });

  it('12. base de calculo negativa -> throw', async () => {
    await expect(
      calcularAditivoCampo({
        tipo: 'insalubridade', grau: 'medio',
        base_calculo: { diarias_tecnico_valor: -10, diarias_equipamento_valor: 100 },
      }, fakeRepo(TEMPLATES)),
    ).rejects.toThrow(/negativos/);
  });

  it('13. rejeita periculosidade com grau medio (defesa em profundidade)', async () => {
    await expect(
      calcularAditivoCampo({
        tipo: 'periculosidade', grau: 'medio' as AditivoGrau,
        base_calculo: { diarias_tecnico_valor: 100, diarias_equipamento_valor: 100 },
      }, fakeRepo(TEMPLATES)),
    ).rejects.toThrow(/Periculosidade so aceita/);
  });
});

describe('aditivoCampoDefaults — ADITIVO_DEFAULTS por subtipo', () => {
  it('14. demarcacao_rural / georreferenciamento_rural -> grau medio habilitado', () => {
    expect(ADITIVO_DEFAULTS.demarcacao_rural).toEqual({ habilitado: true, tipo: 'insalubridade', grau: 'medio' });
    expect(ADITIVO_DEFAULTS.georreferenciamento_rural).toEqual({ habilitado: true, tipo: 'insalubridade', grau: 'medio' });
  });

  it('15. demarcacao_urbana / averbacoes / desm/rem/retif -> grau minimo habilitado', () => {
    const subs = ['demarcacao_urbana', 'averbacao_residencial', 'averbacao_comercial', 'desmembramento', 'remembramento', 'retificacao_area'];
    for (const s of subs) {
      expect(ADITIVO_DEFAULTS[s]).toEqual({ habilitado: true, tipo: 'insalubridade', grau: 'minimo' });
    }
  });

  it('16. avaliacao_ptam / projeto_executivo -> desabilitado por default', () => {
    expect(ADITIVO_DEFAULTS.avaliacao_ptam.habilitado).toBe(false);
    expect(ADITIVO_DEFAULTS.projeto_executivo.habilitado).toBe(false);
  });

  it('17. defaultParaSubtipo de subtipo desconhecido retorna minimo+desabilitado', () => {
    expect(defaultParaSubtipo('subtipo_inventado')).toEqual({ habilitado: false, tipo: 'insalubridade', grau: 'minimo' });
    expect(defaultParaSubtipo(null)).toEqual({ habilitado: false, tipo: 'insalubridade', grau: 'minimo' });
    expect(defaultParaSubtipo(undefined)).toEqual({ habilitado: false, tipo: 'insalubridade', grau: 'minimo' });
  });
});
