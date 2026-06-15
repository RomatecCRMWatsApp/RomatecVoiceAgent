import { describe, it, expect } from 'vitest';
import { gerarPdfMemorialEletrico } from './eletricoPdfMemorial';
import { calcularResumoEletrico } from './eletricoCalculo';
import type { ExtracaoEletrica } from './eletricoExtracaoTypes';

const extracao: Pick<ExtracaoEletrica, 'circuitos' | 'pontos' | 'eletrodutos' | 'caixas'> = {
  circuitos: [
    { id: 'C2', descricao: 'Iluminação geral', tipo: 'ilum', disjuntorA: 16, polos: 1, condutorFaseMm2: 2.5, condutorProtecaoMm2: 1.5, potenciaVA: 1200, lanceMedioM: 14 },
    { id: 'C6', descricao: 'Chuveiro', tipo: 'tue', disjuntorA: 20, polos: 1, condutorFaseMm2: 6, condutorProtecaoMm2: 4, potenciaVA: 5500, lanceMedioM: 8 },
  ],
  pontos: { iluminacao: 10, tug10A: 16, tue20A: 6, interruptorSimples: 7, interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 2, tomadasPiso: 1 },
  eletrodutos: [{ tipo: 'PVC', diametro: 'Ø25', comprimentoM: 238.68 }],
  caixas: [{ tipo: '4x2', qtd: 35 }],
};
const dadosObra = { titulo: 'Resid', endereco: 'Rua X', municipio: 'Açailândia', uf: 'MA', proprietario: 'Nayara', cpfCnpj: '614.363.953-13', areaM2: 78.69, nPavimentos: 1, prancha: 'PE-05' };
const dadosUso = { tipoUso: 'residencial' as const, tensaoNominalV: 220 as const, tipoAlimentacao: 'monofasico' as const, comprimentoRamalM: 20, cargas: [] };

describe('gerarPdfMemorialEletrico', () => {
  it('gera um PDF válido a partir da extração', async () => {
    const r = calcularResumoEletrico({ dadosObra, dadosUso, extracao });
    const { buffer, filename } = await gerarPdfMemorialEletrico(r);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(2000);
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
    expect(filename).toMatch(/Memorial/i);
  });
  it('gera PDF no caminho heurístico (sem extração)', async () => {
    const r = calcularResumoEletrico({ dadosObra, dadosUso });
    const { buffer } = await gerarPdfMemorialEletrico(r);
    expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
  });
});
