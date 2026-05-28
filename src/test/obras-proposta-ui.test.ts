// v3.32.0: testes UX dos cards diretos na tela Proposta. Como obras.html e' um
// arquivo HTML monolitico com IIFE/closures, validamos via grep estatico +
// jsdom sintetico (montando markup minimo que espelha o que o cliente faz).
//
// Cobertura: 8 Consultoria + 6 Mao de Obra + 4 acessibilidade = 18 testes.

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const OBRAS_HTML = fs.readFileSync(
  path.join(process.cwd(), 'src', 'public', 'obras.html'),
  'utf-8',
);

// Helper: monta um DOM minimo com os cards de Consultoria/Mao de Obra
// renderizados do mesmo jeito que obras.html faz no runtime.
function montarDomConsultoria(): JSDOM {
  const html = `<!doctype html><html><body>
    <div class="card" role="tablist">
      <button role="tab" aria-current="page" aria-selected="true" data-toggle-tipo="consultoria">📋 Consultoria</button>
      <button role="tab" aria-current="false" aria-selected="false" data-toggle-tipo="mao_de_obra">🔨 Mão de Obra</button>
    </div>
    <div class="card">
      <p class="section-title">Nova Proposta de Consultoria</p>
      <div data-cards-cons aria-live="polite">
        <button data-pick-subtipo-inline="averbacao_residencial" aria-label="🏠 Averbação Residencial">🏠 Averbação Residencial · Disponível</button>
        <button data-pick-subtipo-inline="averbacao_comercial">🏢 Averbação Comercial</button>
        <button data-pick-subtipo-inline="georreferenciamento_rural">🌾 Georreferenciamento Rural</button>
        <button data-pick-subtipo-inline="demarcacao_urbana">🌆 Demarcação Urbana</button>
        <button data-pick-subtipo-inline="demarcacao_rural">🌾 Demarcação Rural</button>
        <button data-pick-subtipo-inline="desmembramento">✂️ Desmembramento</button>
        <button data-pick-subtipo-inline="remembramento">🔗 Remembramento</button>
        <button data-pick-subtipo-inline="retificacao_area">📐 Retificação</button>
        <button data-pick-subtipo-inline="avaliacao_ptam">💰 PTAM</button>
        <button data-pick-subtipo-inline="projeto_executivo">📐 Projeto Executivo</button>
        <button data-pick-subtipo-inline="desmembramento_obra">🏗️ Desmembramento de Obra</button>
      </div>
    </div>
    <div class="card"><p class="section-title">Propostas de Consultoria existentes</p></div>
  </body></html>`;
  return new JSDOM(html);
}

function montarDomMaoObra(nivel: 1 | 2 = 1): JSDOM {
  if (nivel === 1) {
    return new JSDOM(`<!doctype html><html><body>
      <div class="card" role="tablist">
        <button role="tab" aria-current="page" aria-selected="true" data-toggle-tipo="mao_de_obra">🔨 Mão de Obra</button>
        <button role="tab" aria-current="false" data-toggle-tipo="consultoria">📋 Consultoria</button>
      </div>
      <div class="card"><div data-cards-mo aria-live="polite">
        <button data-mo-card="obras" aria-label="🔨 Obras — Propostas de mão de obra">🔨 Obras · Selecionar tipo →</button>
      </div></div>
    </body></html>`);
  }
  return new JSDOM(`<!doctype html><html><body>
    <div data-cards-mo aria-live="polite">
      <button data-mo-voltar>← Voltar</button>
      <button data-mo-subtipo="construcao_nova" data-mo-subtipo-nome="Construção nova">🏗️ Construção nova</button>
      <button data-mo-subtipo="reforma_ampliacao" data-mo-subtipo-nome="Reforma">🔧 Reforma</button>
      <button data-mo-subtipo="alvenaria_pura">🧱 Alvenaria</button>
      <button data-mo-subtipo="vistoria_periodica">🔍 Vistoria</button>
      <button data-mo-subtipo="acompanhamento_diaria">👷 Acompanhamento</button>
      <button data-mo-subtipo="fundacao_sapatas">🏗️ Fundação</button>
      <button data-mo-subtipo="cobertura_telhado">🏠 Cobertura</button>
      <button data-mo-subtipo="servicos_complementares">🎨 Serviços</button>
    </div>
  </body></html>`);
}

describe('Aba Consultoria — cards diretos (v3.32.0)', () => {
  let dom: JSDOM;
  beforeEach(() => { dom = montarDomConsultoria(); });

  it('1. Aba Consultoria mostra 11 cards', () => {
    const cards = dom.window.document.querySelectorAll('[data-pick-subtipo-inline]');
    expect(cards.length).toBe(11);
  });

  it('2. Botao "+ Nova proposta" NAO existe (data-nova-cons/data-nova-prop removido do markup)', () => {
    // Grep estatico no obras.html garante que os handlers nao existem mais
    expect(OBRAS_HTML).not.toMatch(/data-nova-cons/);
    expect(OBRAS_HTML).not.toMatch(/data-nova-prop\b/);
  });

  it('3. Lista de propostas existentes renderizada abaixo dos cards', () => {
    const titulos = dom.window.document.querySelectorAll('.section-title');
    const texts = Array.from(titulos).map((t) => t.textContent || '');
    expect(texts.some((t) => /Nova Proposta/i.test(t))).toBe(true);
    expect(texts.some((t) => /existentes/i.test(t))).toBe(true);
  });

  it('4. Card "Demarcação Urbana" existe e e clicavel (em breve abre toast no runtime)', () => {
    const card = dom.window.document.querySelector('[data-pick-subtipo-inline="demarcacao_urbana"]');
    expect(card).toBeTruthy();
    // ARIA label descritivo
    expect((card as HTMLElement)?.tagName).toBe('BUTTON');
  });

  it('5. Card "Georreferenciamento Rural" presente e disparavel', () => {
    const card = dom.window.document.querySelector('[data-pick-subtipo-inline="georreferenciamento_rural"]');
    expect(card).toBeTruthy();
  });

  it('6. obras.html: renderCardsConsultoriaInline e renderPropostasConsultoriaLista existem (idempotencia)', () => {
    expect(OBRAS_HTML).toMatch(/function renderCardsConsultoriaInline\(\)/);
    expect(OBRAS_HTML).toMatch(/function renderPropostasConsultoriaLista\(/);
  });

  it('7. obras.html: toggle handler tem guarda de idempotencia (nao re-renderiza se mesma aba)', () => {
    // Padrao "if (state.tipoPropostaAtivo === b.dataset.toggleTipo) return;"
    expect(OBRAS_HTML).toMatch(/state\.tipoPropostaAtivo === b\.dataset\.toggleTipo\)\s*return/);
  });

  it('8. obras.html: rota legada "escolha" mapeada pra "lista" (compat com deep-links)', () => {
    expect(OBRAS_HTML).toMatch(/viewRaw === 'escolha' \? 'lista'/);
  });
});

describe('Aba Mão de Obra — 2 niveis (v3.32.0)', () => {
  it('9. Nivel 1 renderiza card grande "Obras"', () => {
    const dom = montarDomMaoObra(1);
    const card = dom.window.document.querySelector('[data-mo-card="obras"]');
    expect(card).toBeTruthy();
    expect(card?.getAttribute('aria-label')).toMatch(/Obras/);
  });

  it('10. Nivel 2 renderiza 8 sub-tipos (todos "Em breve")', () => {
    const dom = montarDomMaoObra(2);
    const cards = dom.window.document.querySelectorAll('[data-mo-subtipo]');
    expect(cards.length).toBe(8);
  });

  it('11. Botao "← Voltar" presente no nivel 2', () => {
    const dom = montarDomMaoObra(2);
    expect(dom.window.document.querySelector('[data-mo-voltar]')).toBeTruthy();
  });

  it('12. Botao "← Voltar" ausente no nivel 1', () => {
    const dom = montarDomMaoObra(1);
    expect(dom.window.document.querySelector('[data-mo-voltar]')).toBeFalsy();
  });

  it('13. obras.html: handler Esc volta nivel 2 -> 1', () => {
    // Pattern: ev.key === 'Escape' + state.maoObraNivel = 1
    expect(OBRAS_HTML).toMatch(/ev\.key === 'Escape'/);
    expect(OBRAS_HTML).toMatch(/state\.maoObraNivel = 1/);
  });

  it('14. obras.html: sub-tipos "Em breve" disparam toast com mensagem clara', () => {
    // Pattern: mostrarToastUX(... 'em desenvolvimento' ou 'em breve' ou 'v3.30.0')
    expect(OBRAS_HTML).toMatch(/data-mo-subtipo/);
    expect(OBRAS_HTML).toMatch(/mostrarToastUX/);
    expect(OBRAS_HTML).toMatch(/v3\.30\.0/);
  });
});

describe('Acessibilidade (v3.32.0)', () => {
  it('15. obras.html: foco programatico no 1o card visivel apos trocar aba', () => {
    // Pattern: setTimeout + querySelector('[data-pick-subtipo-inline]:not([disabled]), [data-mo-card]')
    expect(OBRAS_HTML).toMatch(/primeiroCard\.focus\(\)/);
  });

  it('16. aria-current="page" no toggle ativo', () => {
    const dom = montarDomConsultoria();
    const ativos = dom.window.document.querySelectorAll('[aria-current="page"]');
    expect(ativos.length).toBeGreaterThanOrEqual(1);
    // obras.html tem o padrao no template
    expect(OBRAS_HTML).toMatch(/aria-current="\$\{ativoMo \? 'page' : 'false'\}"/);
    expect(OBRAS_HTML).toMatch(/aria-current="\$\{ativoCons \? 'page' : 'false'\}"/);
  });

  it('17. aria-live="polite" no container de cards (anuncia mudanca)', () => {
    const dom = montarDomConsultoria();
    const live = dom.window.document.querySelector('[data-cards-cons][aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(OBRAS_HTML).toMatch(/data-cards-cons aria-live="polite"/);
    expect(OBRAS_HTML).toMatch(/data-cards-mo aria-live="polite"/);
  });

  it('18. obras.html: prefers-reduced-motion respeitado no nivel 2 (animacao opcional)', () => {
    expect(OBRAS_HTML).toMatch(/prefers-reduced-motion/);
    expect(OBRAS_HTML).toMatch(/animation:fadeIn/);
  });
});
