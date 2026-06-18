// v3.53.0: garante que o subtipo "Construção nova (residencial/comercial)" da
// aba Proposta > Mão de Obra esteja ATIVADO — card "Disponível" e clique abrindo
// o form real (setMaoObraView('novo')), em vez do toast "Em breve".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const obrasHtml = readFileSync(join(__dirname, '..', 'public', 'obras.html'), 'utf8');

describe('obras.html — Mão de Obra "Construção nova" ativada (v3.53.0)', () => {
  it('construcao_nova está marcado como disponivel no catálogo', () => {
    const linha = obrasHtml.match(/slug:\s*'construcao_nova'[^\n]*/);
    expect(linha).not.toBeNull();
    expect(linha![0]).toMatch(/disponivel:\s*true/);
  });

  it('os demais subtipos NÃO estão disponíveis (continuam "Em breve")', () => {
    // v3.69.0: reforma_ampliacao saiu desta lista (ativado, abre módulo Reforma de Piso).
    for (const slug of ['alvenaria_pura', 'vistoria_periodica',
      'acompanhamento_diaria', 'fundacao_sapatas', 'cobertura_telhado', 'servicos_complementares']) {
      const linha = obrasHtml.match(new RegExp(`slug:\\s*'${slug}'[^\\n]*`));
      expect(linha, slug).not.toBeNull();
      expect(linha![0], slug).not.toMatch(/disponivel:\s*true/);
    }
  });

  // v3.69.0: reforma_ampliacao ativado e roteia para o módulo de Reforma de Piso.
  it('reforma_ampliacao está disponível e abre o módulo Reforma de Piso', () => {
    const linha = obrasHtml.match(/slug:\s*'reforma_ampliacao'[^\n]*/);
    expect(linha).not.toBeNull();
    expect(linha![0]).toMatch(/disponivel:\s*true/);
    const bloco = obrasHtml.match(/querySelectorAll\('\[data-mo-subtipo\]'\)[\s\S]{0,1200}?\}\);/);
    expect(bloco).not.toBeNull();
    expect(bloco![0]).toContain("moSubtipo === 'reforma_ampliacao'");
    expect(bloco![0]).toMatch(/state\.currentTab\s*=\s*'reforma'/);
  });

  it('o card renderiza estado por s.disponivel (Disponível vs Em breve)', () => {
    expect(obrasHtml).toMatch(/data-mo-disponivel="\$\{s\.disponivel \? '1' : ''\}"/);
    expect(obrasHtml).toContain("'● Disponível'");
  });

  it('o handler do subtipo disponível abre o form real (setMaoObraView novo)', () => {
    // bloco do handler data-mo-subtipo (até o fechamento do forEach).
    // v3.75.1: janela ampliada (o branch de reforma_ampliacao cresceu o handler).
    const bloco = obrasHtml.match(/querySelectorAll\('\[data-mo-subtipo\]'\)[\s\S]{0,1800}?\}\);/);
    expect(bloco).not.toBeNull();
    expect(bloco![0]).toMatch(/dataset\.moDisponivel\s*===\s*'1'/);
    expect(bloco![0]).toContain("setMaoObraView('novo')");
  });
});
