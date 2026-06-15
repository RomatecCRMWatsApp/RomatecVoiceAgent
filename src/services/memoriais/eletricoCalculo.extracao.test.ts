import { describe, it, expect } from 'vitest';
import { calcularResumoEletrico } from './eletricoCalculo';
import type { ExtracaoEletrica } from './eletricoExtracaoTypes';

const extracao: Pick<ExtracaoEletrica, 'circuitos' | 'pontos' | 'eletrodutos' | 'caixas'> = {
  circuitos: [
    { id: 'C1', descricao: 'TUEs — MP', tipo: 'tue', disjuntorA: 10, polos: 1, condutorFaseMm2: 2.5, condutorProtecaoMm2: 2.5, potenciaVA: 1000, lanceMedioM: 10 },
    { id: 'C2', descricao: 'Iluminação geral', tipo: 'ilum', disjuntorA: 16, polos: 1, condutorFaseMm2: 2.5, condutorProtecaoMm2: 1.5, potenciaVA: 1200, lanceMedioM: 14 },
    { id: 'C6', descricao: 'Chuveiro', tipo: 'tue', disjuntorA: 20, polos: 1, condutorFaseMm2: 6, condutorProtecaoMm2: 4, potenciaVA: 5500, lanceMedioM: 8 },
  ],
  pontos: { iluminacao: 10, tug10A: 16, tue20A: 6, interruptorSimples: 7, interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 2, tomadasPiso: 1 },
  eletrodutos: [{ tipo: 'PVC corrugado', diametro: 'Ø25', comprimentoM: 238.68 }],
  caixas: [{ tipo: '4x2', qtd: 35 }, { tipo: '4x4', qtd: 20 }, { tipo: 'octogonal', qtd: 3 }],
};

const dadosObra = { titulo: 'Resid', endereco: '', municipio: 'Açailândia', uf: 'MA', proprietario: 'Nayara', cpfCnpj: '', areaM2: 78.69, nPavimentos: 1, prancha: 'PE-05' };
const dadosUso = { tipoUso: 'residencial' as const, tensaoNominalV: 220 as const, tipoAlimentacao: 'monofasico' as const, comprimentoRamalM: 20, cargas: [] };

describe('calcularResumoEletrico com extração', () => {
  it('usa os circuitos reais: Pi soma das potências e cabos por seção', () => {
    const r = calcularResumoEletrico({ dadosObra, dadosUso, extracao });
    expect(r.saida.carga_total_instalada_w).toBeGreaterThanOrEqual(7700 - 1);
    const secoes = r.materiais.condutores.map((c) => c.descricao);
    expect(secoes.some((d) => /2\.5 mm2/.test(d) || /2,5/.test(d))).toBe(true);
    expect(secoes.some((d) => /6\.0 mm2/.test(d) || /6,0/.test(d))).toBe(true);
    expect(r.totais.pontosLuz).toBe(10);
    expect(r.totais.tugs).toBe(16);
  });

  it('mantém o caminho heurístico quando não há extração (retrocompat)', () => {
    const r = calcularResumoEletrico({ dadosObra, dadosUso });
    expect(r.materiais.condutores.length).toBeGreaterThan(0);
    expect(Array.isArray(r.materiais.caixas)).toBe(true); // caixas existe nos dois caminhos
  });
});
