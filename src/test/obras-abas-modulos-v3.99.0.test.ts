// v3.99.0 — Navegação da Gestão de Obras (pedido do José): os módulos
// Checklist, Entrega de Obra, Inventário e Mão de Obra saíram de DENTRO da aba
// Vistoria (VTO) e viraram ABAS PRÓPRIAS no menu do topo. O VTO ficou só com a
// vistoria de fato. Fluxos/telas reaproveitados — só mudou o ponto de entrada.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const OBRAS = readFileSync(join(process.cwd(), 'src', 'public', 'obras.html'), 'utf8');

/** Corpo de uma função top-level do script inline (até a próxima function). */
function corpoFn(nome: string): string {
  const ini = OBRAS.indexOf(`function ${nome}(`);
  expect(ini, `function ${nome} não encontrada`).toBeGreaterThan(-1);
  const fim = OBRAS.indexOf('\nfunction ', ini + 10);
  return OBRAS.slice(ini, fim > ini ? fim : undefined);
}

describe('Gestão de Obras — módulos como abas próprias (v3.99.0)', () => {
  it('menu do topo tem as 4 abas novas, depois de Vistoria (VTO) e antes de Laudo', () => {
    const pos = (s: string) => {
      const i = OBRAS.indexOf(s);
      expect(i, `${s} não encontrado`).toBeGreaterThan(-1);
      return i;
    };
    const vto = pos('data-tab="vto"');
    const checklist = pos('data-tab="checklist"');
    const entrega = pos('data-tab="entrega"');
    const inventario = pos('data-tab="inventario"');
    const maoobra = pos('data-tab="maoobra"');
    const laudos = pos('data-tab="laudos"');
    expect(vto).toBeLessThan(checklist);
    expect(checklist).toBeLessThan(entrega);
    expect(entrega).toBeLessThan(inventario);
    expect(inventario).toBeLessThan(maoobra);
    expect(maoobra).toBeLessThan(laudos);
  });

  it('cada aba nova tem view própria + entrada no dispatcher fns', () => {
    ['checklist', 'entrega', 'inventario', 'maoobra'].forEach((t) => {
      expect(OBRAS).toContain(`id="view-${t}"`);
    });
    expect(OBRAS).toMatch(/checklist:\s+async \(\) => \{ await loadObras\(\); renderChecklistTab\(\); \}/);
    expect(OBRAS).toMatch(/entrega:\s+async \(\) => \{ renderEntregaTab\(\); \}/);
    expect(OBRAS).toMatch(/inventario:\s+async \(\) => \{ await loadObras\(\); renderInventarioTab\(\); \}/);
    expect(OBRAS).toMatch(/maoobra:\s+async \(\) => \{ renderMaoObraTab\(\); \}/);
  });

  it('VTO ficou só com a vistoria: renderVto não tem mais os lançadores dos módulos', () => {
    const vto = corpoFn('renderVto');
    expect(vto).not.toContain('vto-checklist.html');
    expect(vto).not.toContain('entrega-obra.html');
    expect(vto).not.toContain('inventario-obra.html');
    expect(vto).not.toContain('mao-obra-avulsa.html');
    // e a vistoria em si continua lá (form da Nova Vistoria)
    expect(vto).toContain('vVistoriador');
  });

  it('Checklist e Inventário mantêm o seletor "Obra ativa" (deep-link com a obra)', () => {
    const chk = corpoFn('renderChecklistTab');
    expect(chk).toContain('obraSelector()');
    expect(chk).toContain('attachSel()');
    expect(chk).toContain('/vto-checklist.html?obra=');

    const inv = corpoFn('renderInventarioTab');
    expect(inv).toContain('obraSelector()');
    expect(inv).toContain('attachSel()');
    expect(inv).toContain('/inventario-obra.html?obra=');   // com obra ativa
    expect(inv).toContain(`: '/inventario-obra.html'`);     // sem obra → standalone (v3.98.0)
  });

  it('Entrega e Mão de Obra abrem seus fluxos próprios (proposta/prestador na tela)', () => {
    expect(corpoFn('renderEntregaTab')).toContain('/entrega-obra.html');
    expect(corpoFn('renderMaoObraTab')).toContain('/mao-obra-avulsa.html');
  });
});
