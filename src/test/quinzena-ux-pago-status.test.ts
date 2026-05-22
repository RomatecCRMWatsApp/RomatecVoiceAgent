// v3.23.11: smoke tests da UI nova do modal de marcacao de dias (quinzena).
//
// 3 mudancas testadas via leitura do HTML/CSS (sem render real — jsdom puro):
// 1. Botao X removido, substituido por 2 botoes "◀ Voltar" (header + rodape)
// 2. Render de celulas com 4 estados (pendente verde/amarelo, pago azul, cancelado cinza)
// 3. Legenda atualizada com 4 itens (incluindo Pago e Cancelado)
//
// Backend: SQL do listarDiasFuncionario faz LEFT JOIN com folha_fechamento_itens.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const obrasHtml = readFileSync(join(REPO_ROOT, 'src', 'public', 'obras.html'), 'utf8');
const obrasTs = readFileSync(join(REPO_ROOT, 'src', 'integrations', 'obras.ts'), 'utf8');

describe('Mudanca 1 — botao X removido, Voltar adicionado', () => {
  it('o X antigo (#calClose) NAO existe mais no DOM do modal', () => {
    // Era um <button id="calClose">×</button> com area de toque ~16px
    expect(obrasHtml).not.toMatch(/<button[^>]*id=["']calClose["']/);
  });

  it('existe Voltar no header (#calVoltarTop)', () => {
    expect(obrasHtml).toMatch(/<button[^>]*id=["']calVoltarTop["'][^>]*class=["']cal-voltar-btn["']/);
    expect(obrasHtml).toMatch(/aria-label=["']Voltar para lista["']/);
  });

  it('existe Voltar no rodape (#calVoltarBottom) — mobile-friendly', () => {
    expect(obrasHtml).toMatch(/<button[^>]*id=["']calVoltarBottom["']/);
  });

  it('CSS .cal-voltar-btn tem min 44x44 (iOS HIG tap target)', () => {
    const css = obrasHtml.match(/\.cal-voltar-btn\s*\{[^}]+\}/);
    expect(css, 'CSS .cal-voltar-btn nao encontrado').not.toBeNull();
    expect(css![0]).toMatch(/min-height:\s*44px/);
    expect(css![0]).toMatch(/min-width:\s*88px/);
  });

  it('handler unificado _calFechar atende: 2 botoes + ESC + click overlay', () => {
    expect(obrasHtml).toMatch(/function _calFechar\(\)/);
    expect(obrasHtml).toMatch(/getElementById\(['"]calVoltarTop['"]\)\.onclick = _calFechar/);
    expect(obrasHtml).toMatch(/getElementById\(['"]calVoltarBottom['"]\)\.onclick = _calFechar/);
    // ESC handler
    expect(obrasHtml).toMatch(/addEventListener\(['"]keydown['"][\s\S]+?Escape[\s\S]+?_calFechar/);
    // Overlay click handler
    expect(obrasHtml).toMatch(/getElementById\(['"]calOverlay['"]\)\.onclick[\s\S]+?_calFechar/);
  });
});

describe('Mudanca 2 — backend retorna status do fechamento', () => {
  it('listarDiasFuncionario faz LEFT JOIN com folha_fechamento_itens', () => {
    expect(obrasTs).toMatch(/LEFT JOIN folha_fechamento_itens/);
    expect(obrasTs).toMatch(/fi\.fechamento_id = d\.fechamento_id/);
    expect(obrasTs).toMatch(/fi\.funcionario_id = d\.funcionario_id/);
  });

  it('payload de cada dia inclui fechamento_id, status_fechamento, data_pagamento', () => {
    // Extracao por anchor — pega do header da funcao ate proximo export
    const idxStart = obrasTs.indexOf('export async function listarDiasFuncionario');
    const idxEnd = obrasTs.indexOf('\nexport ', idxStart + 50);
    expect(idxStart).toBeGreaterThan(0);
    expect(idxEnd).toBeGreaterThan(idxStart);
    const body = obrasTs.slice(idxStart, idxEnd);
    expect(body).toMatch(/fechamento_id:[\s\S]+?\?\s*Number\(r\.fechamento_id\)\s*:\s*null/);
    // v3.24.3: status_fechamento agora usa variavel statusEfetivo (que considera
    // legado via recibos_envios). O campo final no payload e' status_fechamento: statusEfetivo
    expect(body).toMatch(/status_fechamento:\s*statusEfetivo/);
    expect(body).toMatch(/data_pagamento:/);
  });
});

describe('Mudanca 3 — render frontend com 4 estados', () => {
  it('CSS define classes .cal-cell.pago-integral / pago-manha / pago-tarde / cancelado', () => {
    expect(obrasHtml).toMatch(/\.cal-cell\.pago-integral\s*\{[^}]+border-color:\s*#3b82f6/);
    expect(obrasHtml).toMatch(/\.cal-cell\.pago-manha\s*\{[^}]+border-color:\s*#60a5fa/);
    expect(obrasHtml).toMatch(/\.cal-cell\.pago-tarde\s*\{[^}]+border-color:\s*#60a5fa/);
    expect(obrasHtml).toMatch(/\.cal-cell\.cancelado\s*\{[^}]+text-decoration:\s*line-through/);
  });

  it('checkmark ✓ aparece em celulas pagas (canto inferior direito)', () => {
    expect(obrasHtml).toMatch(/\.cal-cell\.pago-integral::after[\s\S]+?content:\s*['"]✓['"]/);
  });

  it('legenda atualizada com 4 estados (Pago + Cancelado adicionados)', () => {
    const legenda = obrasHtml.match(/<div class="cal-legend">[\s\S]+?<\/div>/);
    expect(legenda).not.toBeNull();
    expect(legenda![0]).toMatch(/Integral pendente/);
    expect(legenda![0]).toMatch(/Meia \(manhã\)/);
    expect(legenda![0]).toMatch(/Meia \(tarde\)/);
    expect(legenda![0]).toMatch(/🔵 Pago/);
    expect(legenda![0]).toMatch(/⚫ Cancelado/);
  });

  it('desenharCalendario constroi statusPorData a partir do status_fechamento', () => {
    const fn = obrasHtml.match(/function desenharCalendario\(\)[\s\S]+?grid\.innerHTML = html;/);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/const statusPorData = \{\}/);
    expect(body).toMatch(/d\.status_fechamento/);
    expect(body).toMatch(/const rankStatus = \{ ['"]paga['"]:\s*3,\s*['"]cancelada['"]:\s*2,\s*['"]aberta['"]:\s*1\s*\}/);
  });

  it('loop de render usa status pra aplicar classe pago/cancelado/pendente', () => {
    const fn = obrasHtml.match(/function desenharCalendario\(\)[\s\S]+?grid\.innerHTML = html;/);
    const body = fn![0];
    expect(body).toMatch(/status === ['"]cancelada['"]/);
    expect(body).toMatch(/status === ['"]paga['"]/);
    expect(body).toMatch(/cls = ['"]pago-integral['"]/);
    expect(body).toMatch(/cls = ['"]pago-manha['"]/);
    expect(body).toMatch(/cls = ['"]pago-tarde['"]/);
    expect(body).toMatch(/cls = ['"]cancelado['"]/);
  });
});
