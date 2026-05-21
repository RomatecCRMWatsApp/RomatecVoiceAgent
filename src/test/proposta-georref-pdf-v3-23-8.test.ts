// v3.23.8: smoke tests dos 3 fixes do PDF Georref (regressao da v3.23.7).
//
// Bug A: footer com bufferedPageRange criava 6 paginas em branco extras porque
//        text() em y=812 disparava auto-pagebreak (page.height - margins.bottom = 794).
// Bug B: secoes 7 e 8 cortavam texto a direita (doc.x deslocado de tabela anterior).
// Bug C: P1 e P2 com R$ 0,00 quando custos_override aplicava (spread `...ov` apagava
//        condicoes_pagamento).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const src = readFileSync(
  join(REPO_ROOT, 'src', 'integrations', 'propostasConsultoria.ts'),
  'utf8',
);

describe('Bug A — footer com bufferedPageRange nao cria paginas extras', () => {
  it('loop do footer zera margins.bottom temporariamente', () => {
    // Sem isso, text() em y=812 (page.height-30) com bottom default=48 dispara
    // auto-pagebreak. Cada chamada text() empurrava o doc pra nova pagina.
    const loop = src.match(
      /const range = doc\.bufferedPageRange\(\)[\s\S]+?doc\.font\('Helvetica'\)\.fillColor\('#111'\);/,
    );
    expect(loop, 'loop bufferedPageRange nao encontrado').not.toBeNull();
    const body = loop![0];

    // Preserva valor original
    expect(body).toMatch(/const origBottom = doc\.page\.margins\.bottom/);
    // Zera durante o text()
    expect(body).toMatch(/doc\.page\.margins\.bottom = 0/);
    // Restaura no finally
    expect(body).toMatch(/finally[\s\S]+?doc\.page\.margins\.bottom = origBottom/);
  });

  it('footer usa try/finally pra garantir restore mesmo se text() lancar', () => {
    // Captura desde o "for (let i = range.start" ate o restore na clausula finally
    const loopStart = src.indexOf('for (let i = range.start');
    const restoreIdx = src.indexOf('doc.page.margins.bottom = origBottom', loopStart);
    expect(loopStart, 'loop nao encontrado').toBeGreaterThan(0);
    expect(restoreIdx, 'restore margins.bottom nao encontrado').toBeGreaterThan(loopStart);

    const loopSrc = src.slice(loopStart, restoreIdx + 100);
    expect(loopSrc).toMatch(/try\s*\{/);
    expect(loopSrc).toMatch(/\}\s*finally\s*\{/);
  });
});

describe('Bug B — secoes 7 e 8 com reset de doc.x + coords explicitas', () => {
  it('secao 7 (Documentos) reseta doc.x antes do header e por iteracao', () => {
    const idx7 = src.indexOf('7. Documentos a Serem Fornecidos');
    const idx8 = src.indexOf('8. Avisos e Condicoes Tecnicas');
    const secao7 = src.slice(idx7, idx8);

    // Reset explicito do x antes do header
    expect(secao7).toMatch(/doc\.x\s*=\s*COL_X_INI/);
    // Cada item usa coords absolutas (COL_X_INI + 8) em vez de indent
    expect(secao7).toMatch(/COL_X_INI \+ 8,\s*doc\.y/);
    // continued: false explicito (evita herancia de continued anterior)
    expect(secao7).toMatch(/continued:\s*false/);
  });

  it('secao 8 (Avisos) tambem reseta doc.x e usa coords explicitas', () => {
    const idx8 = src.indexOf('8. Avisos e Condicoes Tecnicas');
    const idxFinal = src.indexOf('renderAvisoDRL(doc, finalidadeDRL', idx8);
    const secao8 = src.slice(idx8, idxFinal);

    expect(secao8).toMatch(/doc\.x\s*=\s*COL_X_INI/);
    expect(secao8).toMatch(/COL_X_INI \+ 8,\s*doc\.y/);
  });
});

describe('Bug C — condicoes_pagamento preservadas/re-derivadas em custos_override', () => {
  it('override usa fallback ?? pra campos derivados (nao sobrescreve com undefined)', () => {
    // Captura o bloco do override em criarPropostaConsultoria
    const idxOv = src.indexOf('if (input.custos_override)');
    expect(idxOv).toBeGreaterThan(0);
    const idxFimOv = src.indexOf('  const numero = await gerarNumeroProposta()', idxOv);
    const blocoOv = src.slice(idxOv, idxFimOv);

    // Campos derivados: condicoes_pagamento e honorarios_romatec usam variavel
    // intermediaria (xxxFinal) que ja consolidou o fallback no let acima
    expect(blocoOv).toMatch(/let condicoesPagamentoFinal\s*=\s*ov\.condicoes_pagamento\s*\?\?\s*calculado\.condicoes_pagamento/);
    expect(blocoOv).toMatch(/let honorariosRomatecFinal\s*=\s*ov\.honorarios_romatec\s*\?\?\s*calculado\.honorarios_romatec/);
    // Demais campos fallback direto no objeto
    expect(blocoOv).toMatch(/base_calculo:\s*ov\.base_calculo\s*\?\?\s*calculado\.base_calculo/);
    expect(blocoOv).toMatch(/avisos:\s*ov\.avisos\s*\?\?\s*calculado\.avisos/);
    expect(blocoOv).toMatch(/secao_opcionais_georref:\s*ov\.secao_opcionais_georref\s*\?\?\s*calculado\.secao_opcionais_georref/);
  });

  it('override re-deriva condicoes_pagamento pra georref quando 3 linhas de honorarios', () => {
    const idxOv = src.indexOf('if (input.custos_override)');
    const idxFimOv = src.indexOf('  const numero = await gerarNumeroProposta()', idxOv);
    const blocoOv = src.slice(idxOv, idxFimOv);

    // So pra georref
    expect(blocoOv).toMatch(/subtipo === 'georreferenciamento_rural'/);
    // Identifica linhas por keyword (mais robusto que ordem)
    expect(blocoOv).toMatch(/\/trt\|tec\\\.\?\\s\*responsabilidade\|cft\/i/);
    expect(blocoOv).toMatch(/\/honorarios\\s\+tecnicos\|levantamento\\s\+topografico\|memorial\/i/);
    expect(blocoOv).toMatch(/\/assessoria\/i/);
    // Aplica formula p1 = trt + tec*0.5 + ass*0.5; p2 = tec*0.5; p3 = ass*0.5
    expect(blocoOv).toMatch(/p1\s*=\s*round2\(trt \+ tec \* 0\.5 \+ ass \* 0\.5\)/);
    expect(blocoOv).toMatch(/p2\s*=\s*round2\(tec \* 0\.5\)/);
    expect(blocoOv).toMatch(/p3\s*=\s*round2\(ass \* 0\.5\)/);
  });
});
