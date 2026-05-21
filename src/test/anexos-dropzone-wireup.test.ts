// v3.23.4: smoke test do fix do dropzone de anexos quebrado em Nova Proposta.
//
// Bug: clicar no dropzone "Clique ou arraste arquivos" em Desmembramento/Desdobro/
// Remembramento/Retificacao/PTAM nao abria o file picker. Causa: o HTML do dropzone
// (#cnsDropZone + #cnsAnexoInput) era renderizado por 5 funcoes diferentes de form,
// mas o wireup (dropZone.onclick = () => fileInput.click()) so existia em
// renderConsultoriaFormInline (Averbacao). Os outros 4 forms emitem o markup mas
// nao anexavam handlers — dropzone ficava inerte.
//
// Fix: extrair pra funcao reutilizavel wireUpAnexosDropzone() e chamar de todos
// os 5 render functions. Esse teste garante que ninguem regrida no futuro
// removendo uma das chamadas.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const obrasHtml = readFileSync(
  join(__dirname, '..', 'public', 'obras.html'),
  'utf8',
);

describe('obras.html — dropzone de anexos wired em todos os forms de Nova Proposta (v3.23.4)', () => {
  it('define a funcao wireUpAnexosDropzone exatamente uma vez', () => {
    const matches = obrasHtml.match(/function wireUpAnexosDropzone\s*\(/g) || [];
    expect(matches.length).toBe(1);
  });

  it('o helper attacha onclick no dropzone que dispara fileInput.click()', () => {
    // Pega o corpo da funcao
    const fnMatch = obrasHtml.match(
      /function wireUpAnexosDropzone\s*\([^)]*\)\s*\{[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    // O handler critico: clique no dropZone aciona fileInput.click
    expect(body).toMatch(/dropZone\.onclick\s*=\s*\(\)\s*=>\s*fileInput\.click\(\)/);
    // Drag/drop tambem
    expect(body).toMatch(/dropZone\.ondrop\s*=/);
    expect(body).toMatch(/fileInput\.onchange\s*=/);
  });

  it('chama wireUpAnexosDropzone em TODAS as 5 funcoes de render de form de proposta', () => {
    // Funcoes esperadas (cada uma renderiza seu proprio <label id="cnsDropZone">)
    const renderFns = [
      'renderConsultoriaFormInline',        // Averbacao + dispatcher
      'renderConsultoriaFormGeoRural',      // Georref Rural
      'renderConsultoriaFormDesmRem',       // Desmembramento + Remembramento
      'renderConsultoriaFormRetificacao',   // Retificacao de area
      'renderConsultoriaFormPTAM',          // Avaliacao PTAM
    ];

    for (const fnName of renderFns) {
      // Captura o corpo da funcao (do nome ate proxima declaracao top-level)
      const re = new RegExp(
        String.raw`(async\s+)?function\s+${fnName}\s*\([^)]*\)\s*\{[\s\S]*?\n(?=(async\s+)?function\s+\w)`,
      );
      const m = obrasHtml.match(re);
      expect(m, `nao encontrei a funcao ${fnName}`).not.toBeNull();
      expect(
        m![0],
        `funcao ${fnName} nao chama wireUpAnexosDropzone — dropzone vai ficar inerte`,
      ).toContain('wireUpAnexosDropzone(');
    }
  });

  it('numero de dropzones (#cnsDropZone) bate com numero de chamadas wireUp', () => {
    // 5 forms renderizam o dropzone -> precisa de 5 chamadas (1 por form)
    const dropzones = (obrasHtml.match(/<label id="cnsDropZone"/g) || []).length;
    // Conta so invocacoes reais (terminam com ;) — exclui a definicao e mencoes em comentarios
    const invocations = (obrasHtml.match(/wireUpAnexosDropzone\(subtipo\)\s*;/g) || []).length;
    expect(dropzones).toBe(5);
    expect(invocations).toBe(5);
  });
});
