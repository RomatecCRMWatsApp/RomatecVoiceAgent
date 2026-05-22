// v3.24.8: tests dos novos campos do Projeto Executivo:
// - area_terreno + taxa_ocupacao_percentual + validacao
// - Programa de Necessidades (catalogo de comodos)

import { describe, it, expect } from 'vitest';
import {
  calcularProjetoExecutivo,
  calcularTaxaOcupacao,
} from '../services/pricing/projetoExecutivo';
import {
  COMODOS_CATALOGO,
  buscarComodo,
  listarComodosPorCategoria,
  CATEGORIAS_LABEL,
  ORDEM_CATEGORIAS,
} from '../constants/comodosEdificacao';
import type { InputProjetoExecutivo } from '../services/pricing/types';

function inputBase(over: Partial<InputProjetoExecutivo> = {}): InputProjetoExecutivo {
  return {
    endereco_obra: 'Rua Teste, 123',
    cidade_obra: 'Acailandia',
    uf_obra: 'MA',
    tipo_edificacao: 'residencial',
    area_construir: 100,
    valor_m2: 25,
    forma_pagamento_tag: 'integral',
    alvara_incluir: false,
    alvara_valor: 0,
    placa_incluir: false,
    placa_valor: 0,
    ...over,
  };
}

describe('calcularTaxaOcupacao (helper puro)', () => {
  it('71 / 220 = 32.27%', () => {
    expect(calcularTaxaOcupacao(71, 220)).toBe(32.27);
  });
  it('100 / 100 = 100%', () => {
    expect(calcularTaxaOcupacao(100, 100)).toBe(100);
  });
  it('undefined quando area_terreno ausente/0/negativo', () => {
    expect(calcularTaxaOcupacao(71)).toBeUndefined();
    expect(calcularTaxaOcupacao(71, 0)).toBeUndefined();
    expect(calcularTaxaOcupacao(71, -1)).toBeUndefined();
  });
  it('arredonda HALF_UP em 2 casas (round2)', () => {
    expect(calcularTaxaOcupacao(100, 333.33)).toBe(30);
  });
});

describe('Engine: area_terreno + taxa_ocupacao_percentual', () => {
  it('calcula taxa de ocupacao quando area_terreno informada', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 71, area_terreno: 220,
    }));
    expect(r.projeto_executivo.honorarios.area_terreno).toBe(220);
    expect(r.projeto_executivo.honorarios.taxa_ocupacao_percentual).toBe(32.27);
  });

  it('omite taxa quando area_terreno ausente', async () => {
    const r = await calcularProjetoExecutivo(inputBase());
    expect(r.projeto_executivo.honorarios.area_terreno).toBeUndefined();
    expect(r.projeto_executivo.honorarios.taxa_ocupacao_percentual).toBeUndefined();
  });

  it('rejeita area_construir > area_terreno', async () => {
    await expect(calcularProjetoExecutivo(inputBase({
      area_construir: 300, area_terreno: 220,
    }))).rejects.toThrow(/maior que a area do terreno/i);
  });

  it('aceita area_construir = area_terreno (taxa 100%)', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      area_construir: 100, area_terreno: 100,
    }));
    expect(r.projeto_executivo.honorarios.taxa_ocupacao_percentual).toBe(100);
  });
});

describe('Catalogo de Comodos', () => {
  it('tem pelo menos 40 comodos cadastrados', () => {
    expect(COMODOS_CATALOGO.length).toBeGreaterThanOrEqual(40);
  });

  it('todos os codigos sao unicos', () => {
    const codigos = COMODOS_CATALOGO.map(c => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('busca por codigo retorna comodo correto', () => {
    const c = buscarComodo('suite_master');
    expect(c?.nome).toBe('Suite Master');
    expect(c?.categoria).toBe('intimo');
    expect(c?.nome_plural).toBe('Suites Master');
  });

  it('busca por codigo inexistente retorna undefined', () => {
    expect(buscarComodo('inexistente_xyz')).toBeUndefined();
  });

  it('agrupa por categoria sem perder itens', () => {
    const g = listarComodosPorCategoria();
    const totalAgrupado = Object.values(g).reduce((s, arr) => s + arr.length, 0);
    expect(totalAgrupado).toBe(COMODOS_CATALOGO.length);
  });

  it('todos tem ordem_pdf > 0 (crescente dentro de cada categoria)', () => {
    const grupos = listarComodosPorCategoria();
    for (const arr of Object.values(grupos)) {
      expect(arr.every(c => typeof c.ordem_pdf === 'number' && c.ordem_pdf > 0)).toBe(true);
      // Dentro da categoria, ordem_pdf cresce
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i].ordem_pdf).toBeGreaterThanOrEqual(arr[i - 1].ordem_pdf);
      }
    }
  });

  it('todas as categorias tem label definida + estao em ORDEM_CATEGORIAS', () => {
    for (const cat of ORDEM_CATEGORIAS) {
      expect(CATEGORIAS_LABEL[cat]).toBeDefined();
      expect(CATEGORIAS_LABEL[cat].length).toBeGreaterThan(2);
    }
    expect(ORDEM_CATEGORIAS).toHaveLength(6);
  });

  it('comodos com observacao_padrao tem texto > 0', () => {
    const com_obs = COMODOS_CATALOGO.filter(c => c.observacao_padrao);
    expect(com_obs.length).toBeGreaterThan(0);
    for (const c of com_obs) {
      expect(c.observacao_padrao!.length).toBeGreaterThan(3);
    }
  });

  it('plural e diferente do singular pra todos os itens', () => {
    for (const c of COMODOS_CATALOGO) {
      expect(c.nome_plural).not.toBe(c.nome);
      expect(c.nome_plural.length).toBeGreaterThan(c.nome.length - 2);
    }
  });
});

describe('Engine: programa_necessidades persistido', () => {
  it('aceita lista de comodos no input', async () => {
    const r = await calcularProjetoExecutivo(inputBase({
      programa_necessidades: [
        { codigo: 'suite_master', nome: 'Suite Master', nome_plural: 'Suites Master', categoria: 'intimo', ordem_pdf: 20, quantidade: 1 },
        { codigo: 'quarto', nome: 'Quarto', nome_plural: 'Quartos', categoria: 'intimo', ordem_pdf: 25, quantidade: 2 },
      ],
    }));
    // Nao impacta o calculo financeiro — soh persiste pra renderizacao do PDF
    expect(r.projeto_executivo.honorarios.valor_projetos).toBe(2500);
  });

  it('valor_projetos nao depende de programa_necessidades', async () => {
    const r1 = await calcularProjetoExecutivo(inputBase({ programa_necessidades: [] }));
    const r2 = await calcularProjetoExecutivo(inputBase());
    expect(r1.projeto_executivo.honorarios.valor_projetos)
      .toBe(r2.projeto_executivo.honorarios.valor_projetos);
  });
});

describe('Smoke — endpoint catalogo + UI form', () => {
  it('server.ts registra GET /api/.../comodos-catalogo', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
    expect(src).toContain("/api/propostas-consultoria/projeto-executivo/comodos-catalogo");
  });

  it('obras.html renderiza Programa de Necessidades + Taxa de Ocupacao', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'obras.html'), 'utf8');
    // Bloco Taxa de Ocupacao
    expect(src).toMatch(/id="peAreaTer"/);
    expect(src).toMatch(/id="peTaxaOcupBox"/);
    expect(src).toMatch(/atualizarTaxaOcupacaoPE/);
    // Bloco Programa de Necessidades
    expect(src).toMatch(/id="peComodosCategorias"/);
    expect(src).toMatch(/carregarCatalogoComodosPE/);
    expect(src).toMatch(/coletarProgramaNecessidades/);
  });

  it('PDF renderiza area do terreno + taxa quando informadas', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'integrations', 'propostasConsultoria.ts'), 'utf8');
    expect(src).toMatch(/Area do terreno/);
    expect(src).toMatch(/Taxa de ocupacao/);
    expect(src).toMatch(/Programa de Necessidades/);
    expect(src).toMatch(/Plano Diretor/);
  });
});
