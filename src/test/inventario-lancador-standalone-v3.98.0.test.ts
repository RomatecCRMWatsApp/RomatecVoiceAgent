// v3.98.0 — Inventário de Obra como MÓDULO PRÓPRIO (pedido do José):
// lançador no nível principal de obras.html + fluxo standalone (seleciona a
// obra → inicia/abre o inventário), independente da Entrega de Obra. A
// importação de sobras vira ação OPCIONAL dentro do inventário.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...f: string[]) => readFileSync(join(process.cwd(), 'src', ...f), 'utf8');

describe('Inventário de Obra — lançador standalone (v3.98.0)', () => {
  const OBRAS = read('public', 'obras.html');
  const PAGE = read('public', 'inventario-obra.html');
  const ENTREGA = read('public', 'entrega-obra.html');

  it('obras.html tem o lançador PRÓPRIO no nível principal (card + CTA sem ?obra)', () => {
    expect(OBRAS).toContain('🗃️ Inventário de Obra');
    expect(OBRAS).toContain('Iniciar inventário →');
    // CTA do lançador aponta pra tela SEM obra pré-selecionada (fluxo standalone)
    expect(OBRAS).toMatch(/<a href="\/inventario-obra\.html"/);
    // e o lançador é um card irmão dos outros módulos (Entrega continua com o dela)
    expect(OBRAS).toContain('📦 Entrega de Obra');
    expect(OBRAS).toContain('Nova entrega →');
  });

  it('atalho por obra (card da obra) continua existindo com deep-link ?obra=', () => {
    expect(OBRAS).toMatch(/inventario-obra\.html\?obra=\$\{o\.id\}/);
  });

  it('sem ?obra a tela NÃO é beco sem saída: mostra seletor de obra + Iniciar', () => {
    expect(PAGE).not.toContain('Obra não informada');
    expect(PAGE).toContain('renderSelecaoObra');
    expect(PAGE).toMatch(/fetch\('\/api\/obras'/);           // lista obras do painel
    expect(PAGE).toContain('Iniciar / abrir inventário');
    expect(PAGE).toMatch(/location\.href = '\/inventario-obra\.html\?obra='/); // navega com a obra escolhida
  });

  it('identidade própria: título 🗃️ Inventário de Obra (≠ 📦 Entrega)', () => {
    expect(PAGE).toContain('<h1>🗃️ Inventário de Obra</h1>');
  });

  it('sobras da Entrega são fonte OPCIONAL dentro do inventário (não ponto de entrada)', () => {
    expect(PAGE).toContain('modalSobras');                    // ação dentro do módulo
    expect(ENTREGA).toContain('ação opcional');               // Entrega só aponta, não abre
    expect(ENTREGA).not.toContain('não movimenta estoque nesta fase');
  });
});
