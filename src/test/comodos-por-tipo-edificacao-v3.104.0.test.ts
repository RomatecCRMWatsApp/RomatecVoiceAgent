// v3.104.0 — Programa de Necessidades adapta os cômodos ao TIPO de edificação:
// comercial (galpão) mostra Galpão/Salas/Depósito/Banheiros F-M/Vestiário/Doca…
// e esconde Suíte/Cozinha; residencial mantém o conjunto residencial.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COMODOS_CATALOGO, buscarComodo } from '../constants/comodosEdificacao';

const codigos = new Set(COMODOS_CATALOGO.map((c) => c.codigo));

describe('Catálogo de cômodos por tipo (v3.104.0)', () => {
  it('cômodos comerciais de galpão foram adicionados', () => {
    ['galpao', 'showroom', 'sala_administrativa', 'sala_generica', 'camara_fria',
     'refeitorio', 'vestiario', 'banheiro_feminino', 'banheiro_masculino',
     'doca', 'patio_manobra', 'estacionamento', 'guarita'].forEach((cod) => {
      expect(codigos.has(cod), `faltou ${cod}`).toBe(true);
    });
  });

  it('residenciais só aparecem em residencial/misto', () => {
    ['suite_master', 'quarto', 'cozinha', 'piscina', 'sala_estar'].forEach((cod) => {
      const c = buscarComodo(cod)!;
      expect(c.tipos).toBeDefined();
      expect(c.tipos).toContain('residencial');
      expect(c.tipos).not.toContain('comercial');
    });
  });

  it('comerciais aparecem em comercial/industrial/institucional/misto, nunca residencial puro', () => {
    ['galpao', 'doca', 'banheiro_feminino', 'vestiario', 'showroom'].forEach((cod) => {
      const c = buscarComodo(cod)!;
      expect(c.tipos).toContain('comercial');
      expect(c.tipos).not.toContain('residencial');
    });
  });

  it('universais (sem tipos) aparecem em todos — escritório, recepção, técnicos, banheiro PNE', () => {
    ['escritorio', 'hall_entrada', 'lavabo', 'copa', 'banheiro_pne',
     'circulacao', 'escada', 'reservatorio', 'casa_maquinas'].forEach((cod) => {
      expect(buscarComodo(cod)!.tipos, `${cod} deveria ser universal`).toBeUndefined();
    });
  });

  it('filtro por tipo: comercial não traz Suíte, residencial não traz Galpão', () => {
    const aplica = (c: { tipos?: string[] }, tipo: string) => !Array.isArray(c.tipos) || c.tipos.indexOf(tipo) !== -1;
    const comercial = COMODOS_CATALOGO.filter((c) => aplica(c, 'comercial')).map((c) => c.codigo);
    const residencial = COMODOS_CATALOGO.filter((c) => aplica(c, 'residencial')).map((c) => c.codigo);
    expect(comercial).toContain('galpao');
    expect(comercial).not.toContain('suite_master');
    expect(residencial).toContain('suite_master');
    expect(residencial).not.toContain('galpao');
    // universais nos dois
    expect(comercial).toContain('escritorio');
    expect(residencial).toContain('escritorio');
  });
});

describe('Front filtra e re-renderiza ao trocar o tipo (v3.104.0)', () => {
  const OBRAS = readFileSync(join(process.cwd(), 'src', 'public', 'obras.html'), 'utf8');
  it('renderComodosFiltrado usa peTipo e o select re-renderiza on change', () => {
    expect(OBRAS).toMatch(/function renderComodosFiltrado/);
    expect(OBRAS).toMatch(/c\.tipos\.indexOf\(tipo\) !== -1/);
    expect(OBRAS).toMatch(/selTipo\.addEventListener\('change'/);
    expect(OBRAS).toMatch(/state\.peComodos\.delete\(cod\)/); // dropa cômodo inaplicável
  });
});
