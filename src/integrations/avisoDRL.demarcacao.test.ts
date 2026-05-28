// v3.27.0: testes do aviso DRL adaptado para Demarcacao de Lotes (Urbana e Rural).
// Cobre as 4 finalidades + reforco condicional + estrutura consistente.

import { describe, it, expect } from 'vitest';
import { montarAvisoDRL, type FinalidadeDemarcacaoDRL } from './avisoDRL';

function plainText(bloco: ReturnType<typeof montarAvisoDRL>): string {
  return bloco.paragrafos.map((p) => p.fragmentos.map((f) => f.text).join('')).join('\n');
}

describe('avisoDRL — Demarcacao de Lotes (v3.27.0)', () => {
  it('1. demarcacao_inicial -> base de 3 paragrafos, sem reforco', () => {
    const b = montarAvisoDRL('demarcacao_inicial');
    expect(b.paragrafos).toHaveLength(3);
    expect(b.paragrafos.every((p) => !p.reforco)).toBe(true);
  });

  it('2. redemarcacao -> base, sem reforco', () => {
    const b = montarAvisoDRL('redemarcacao');
    expect(b.paragrafos).toHaveLength(3);
    expect(b.paragrafos.every((p) => !p.reforco)).toBe(true);
  });

  it('3. piqueteamento_apenas -> base, sem reforco', () => {
    const b = montarAvisoDRL('piqueteamento_apenas');
    expect(b.paragrafos).toHaveLength(3);
    expect(b.paragrafos.every((p) => !p.reforco)).toBe(true);
  });

  it('4. subdivisao_lote -> base + reforco marcado reforco:true', () => {
    const b = montarAvisoDRL('subdivisao_lote');
    expect(b.paragrafos).toHaveLength(4);
    const reforcos = b.paragrafos.filter((p) => p.reforco);
    expect(reforcos).toHaveLength(1);
  });

  it('5. Texto base cita "DRL" e "RECONHECIMENTO DE FIRMA EM CARTORIO"', () => {
    const t = plainText(montarAvisoDRL('demarcacao_inicial'));
    expect(t).toMatch(/DRL/);
    expect(t).toMatch(/RECONHECIMENTO DE FIRMA EM CARTORIO/);
  });

  it('6. Reforco subdivisao menciona "abertura de novas matriculas"', () => {
    const b = montarAvisoDRL('subdivisao_lote');
    const reforco = b.paragrafos.find((p) => p.reforco);
    const t = reforco?.fragmentos.map((f) => f.text).join('') || '';
    expect(t).toMatch(/abertura de novas matriculas/i);
  });

  it('7. Estrutura { titulo, paragrafos[] } consistente entre finalidades', () => {
    const finalidades: FinalidadeDemarcacaoDRL[] = [
      'demarcacao_inicial',
      'redemarcacao',
      'subdivisao_lote',
      'piqueteamento_apenas',
    ];
    for (const f of finalidades) {
      const b = montarAvisoDRL(f);
      expect(typeof b.titulo).toBe('string');
      expect(b.titulo).toMatch(/DRL/);
      expect(Array.isArray(b.paragrafos)).toBe(true);
      expect(b.paragrafos.length).toBeGreaterThan(0);
      for (const p of b.paragrafos) {
        expect(Array.isArray(p.fragmentos)).toBe(true);
        for (const frag of p.fragmentos) {
          expect(typeof frag.text).toBe('string');
        }
      }
    }
  });

  it('8. Sem deps externas (importavel standalone)', async () => {
    // Garante que o modulo importa sem arrastar pdfkit/mysql/voyageai.
    const mod = await import('./avisoDRL');
    expect(typeof mod.montarAvisoDRL).toBe('function');
    // Smoke: monta o bloco e nao explode em runtime sem pool/db.
    const b = mod.montarAvisoDRL('demarcacao_inicial');
    expect(b.titulo.length).toBeGreaterThan(0);
  });
});
