import { describe, it, expect } from 'vitest';

describe('migrations-explicativo module', () => {
  it('exports runMigrationsExplicativo', async () => {
    const mod = await import('./migrations-explicativo');
    expect(typeof mod.runMigrationsExplicativo).toBe('function');
  });

  it('seeds contain both templates with required markers', async () => {
    const mod = await import('./migrations-explicativo');
    const seeds = mod.SEED_TEMPLATES;
    expect(seeds).toHaveLength(2);
    const rem = seeds.find((s: { tipo_servico: string }) => s.tipo_servico === 'remembramento')!;
    const des = seeds.find((s: { tipo_servico: string }) => s.tipo_servico === 'desmembramento')!;
    expect(rem.template_texto).toContain('{{cliente_nome}}');
    expect(rem.template_texto).toContain('{{quantidade_imoveis}}');
    expect(rem.template_texto).toContain('{{municipio}}');
    expect(rem.template_texto).toContain('{{base_legal}}');
    expect(rem.template_texto).toContain('O QUE É O REMEMBRAMENTO');
    expect(des.template_texto).toContain('{{quantidade_fracoes}}');
    expect(des.template_texto).toContain('{{area_total}}');
    expect(des.template_texto).toContain('{{unidade_area}}');
    expect(des.template_texto).toContain('O QUE É O DESMEMBRAMENTO');
  });
});
