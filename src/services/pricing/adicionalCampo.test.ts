// v3.33.0: testes do engine de adicional de insalubridade/periculosidade
// com cenarios estruturados. Modulo standalone — le do pricing-params.json real.

import { describe, it, expect } from 'vitest';
import {
  calcularAdicionalCampo,
  validarCombinacao,
  listarCenarios,
} from './adicionalCampo';

describe('adicionalCampo — validarCombinacao', () => {
  it('1. periculosidade + grau != unico -> throw', () => {
    expect(() => validarCombinacao({ cenario: 'rodovia_faixa_dominio', tipo: 'periculosidade', grau: 'medio' }))
      .toThrow(/Periculosidade.*unico/);
  });
  it('2. insalubridade + grau = unico -> throw', () => {
    expect(() => validarCombinacao({ cenario: 'mata_densa_animais', tipo: 'insalubridade', grau: 'unico' }))
      .toThrow(/Insalubridade.*unico/);
  });
  it('3. cenario mata_densa_animais + tipo=periculosidade -> throw', () => {
    expect(() => validarCombinacao({ cenario: 'mata_densa_animais', tipo: 'periculosidade', grau: 'unico' }))
      .toThrow(/mata_densa_animais.*insalubridade/);
  });
  it('4. cenario rodovia_faixa_dominio + tipo=insalubridade -> throw', () => {
    expect(() => validarCombinacao({ cenario: 'rodovia_faixa_dominio', tipo: 'insalubridade', grau: 'medio' }))
      .toThrow(/rodovia_faixa_dominio.*periculosidade/);
  });
});

describe('adicionalCampo — calculo', () => {
  it('5. ativo=false -> output zerado, percentual=0', () => {
    const r = calcularAdicionalCampo({ ativo: false });
    expect(r.ativo).toBe(false);
    expect(r.percentual).toBe(0);
    expect(r.cenario).toBeNull();
    expect(r.bloco_fundamento_legal).toBe('');
    // Snapshot da norma vem mesmo zerado (auditoria)
    expect(r.norma_vigente_congelada.data_snapshot).toBeTruthy();
  });

  it('6. cenario mata_densa_animais -> tipo=insalubridade, grau=medio, %=20', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'mata_densa_animais' });
    expect(r.tipo).toBe('insalubridade');
    expect(r.grau).toBe('medio');
    expect(r.percentual).toBe(20);
    expect(r.bloco_fundamento_legal).toMatch(/CLT.*art\. 192.*inciso II/);
    expect(r.bloco_fundamento_legal).toMatch(/NR-15/);
    expect(r.bloco_fundamento_legal).toMatch(/Anexo 14/);
  });

  it('7. cenario rodovia_faixa_dominio -> tipo=periculosidade, grau=unico, %=30', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'rodovia_faixa_dominio' });
    expect(r.tipo).toBe('periculosidade');
    expect(r.grau).toBe('unico');
    expect(r.percentual).toBe(30);
    expect(r.bloco_fundamento_legal).toMatch(/Lei 12\.997\/2014/);
  });

  it('8. cenario eletricidade_alta_tensao -> %=30 + NR-16 Anexo 4 + SEP', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'eletricidade_alta_tensao' });
    expect(r.percentual).toBe(30);
    expect(r.bloco_fundamento_legal).toMatch(/NR-16.*Anexo 4/);
    expect(r.bloco_fundamento_legal).toMatch(/Sistema Eletrico de Potencia|SEP/);
  });

  it('9. cenario pedreira_explosivos -> %=30 + NR-19', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'pedreira_explosivos' });
    expect(r.percentual).toBe(30);
    expect(r.bloco_fundamento_legal).toMatch(/NR-19/);
  });

  it('10. cenario produtos_quimicos + grau=minimo -> %=10', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'produtos_quimicos', grau: 'minimo' });
    expect(r.percentual).toBe(10);
    expect(r.bloco_enquadramento_tecnico).toMatch(/Grau Minimo \(10%\)/);
  });

  it('11. cenario produtos_quimicos + grau=medio -> %=20 + Anexo 13', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'produtos_quimicos', grau: 'medio' });
    expect(r.percentual).toBe(20);
    expect(r.bloco_enquadramento_tecnico).toMatch(/Grau Medio \(20%\)/);
    expect(r.bloco_enquadramento_tecnico).toMatch(/Anexo 13/);
  });

  it('12. cenario produtos_quimicos + grau=maximo -> %=40 + benzeno/asbesto', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'produtos_quimicos', grau: 'maximo' });
    expect(r.percentual).toBe(40);
    expect(r.bloco_enquadramento_tecnico).toMatch(/Grau Maximo \(40%\)/);
    expect(r.bloco_enquadramento_tecnico).toMatch(/benzeno|asbesto|amianto/);
  });

  it('13. bloco 2 editado pelo tecnico -> bloco_2_customizado=true', () => {
    const r = calcularAdicionalCampo({
      ativo: true,
      cenario: 'mata_densa_animais',
      bloco_enquadramento_tecnico_editado: 'Texto totalmente customizado pelo tecnico',
    });
    expect(r.bloco_2_customizado).toBe(true);
    expect(r.bloco_enquadramento_tecnico).toBe('Texto totalmente customizado pelo tecnico');
    expect(r.bloco_3_customizado).toBe(false); // bloco 3 nao foi editado
  });

  it('14. bloco 2 com so espacos/vazio -> usa padrao, bloco_2_customizado=false', () => {
    const r = calcularAdicionalCampo({
      ativo: true,
      cenario: 'mata_densa_animais',
      bloco_enquadramento_tecnico_editado: '   \n\t   ',
    });
    expect(r.bloco_2_customizado).toBe(false);
    expect(r.bloco_enquadramento_tecnico).toMatch(/georreferenciamento, demarcacao/);
  });

  it('15. observacao adicional > 500 chars -> truncada para 500', () => {
    const longa = 'x'.repeat(800);
    const r = calcularAdicionalCampo({
      ativo: true,
      cenario: 'mata_densa_animais',
      observacao_adicional: longa,
    });
    expect(r.observacao_adicional.length).toBe(500);
  });

  it('16. norma_vigente_congelada com data_snapshot do pricing-params', () => {
    const r = calcularAdicionalCampo({ ativo: true, cenario: 'mata_densa_animais' });
    expect(r.norma_vigente_congelada.data_snapshot).toBe('2026-01-15');
    expect(r.norma_vigente_congelada.versao_referencia).toMatch(/CLT.*NR-15.*NR-16/);
  });

  it('17. ativo=true sem cenario -> throw (defesa em profundidade)', () => {
    expect(() => calcularAdicionalCampo({ ativo: true } as Parameters<typeof calcularAdicionalCampo>[0]))
      .toThrow(/cenario obrigatorio/);
  });

  it('18. listarCenarios retorna 5 cenarios com tipo/grau/percentual_padrao', () => {
    const cenarios = listarCenarios();
    expect(cenarios).toHaveLength(5);
    const slugs = cenarios.map((c) => c.slug);
    expect(slugs).toContain('mata_densa_animais');
    expect(slugs).toContain('rodovia_faixa_dominio');
    expect(slugs).toContain('eletricidade_alta_tensao');
    expect(slugs).toContain('pedreira_explosivos');
    expect(slugs).toContain('produtos_quimicos');
    const quim = cenarios.find((c) => c.slug === 'produtos_quimicos');
    expect(quim?.graus_disponiveis).toEqual(['minimo', 'medio', 'maximo']);
    const mata = cenarios.find((c) => c.slug === 'mata_densa_animais');
    expect(mata?.percentual_padrao).toBe(20);
  });
});
