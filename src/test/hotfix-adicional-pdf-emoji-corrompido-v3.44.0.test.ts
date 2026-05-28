// v3.44.0: hotfix dos emojis corrompidos no PDF do Adicional de Insal/Peric.
//
// Sintoma: o user via no PDF:
//   "& ADICIONAL DE INSALUBRIDADE · +20% Cenario: ..."
//   "Ø=ÜÜ FUNDAMENTO LEGAL"
//   "Ø=Ý ENQUADRAMENTO TECNICO"
//   "Ø=Ü¬ JUSTIFICATIVA AO CLIENTE"
//
// Causa: PDFKit usa Helvetica embedded (Type1) que so' suporta Latin-1.
// Emojis Unicode (U+26A0 ⚠, U+1F4DC 📜, U+1F50D 🔍, U+1F4AC 💬, U+2B06 ⬆)
// estao fora dessa codepage — encoder fallback retorna bytes invalidos.
//
// Fix: substituir emojis por equivalentes ASCII ("!", "+") OU remover.
// A hierarquia visual e' preservada por cor + bold + estrutura do box.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROPOSTAS_CONS_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'integrations', 'propostasConsultoria.ts'),
  'utf-8',
);

describe('HOTFIX v3.44.0 — emojis decorativos removidos do PDF', () => {
  // Localiza so o trecho de funcoes de render do PDF — comentarios documentais
  // PODEM mencionar emojis (so' nao podem chegar ao doc.text()).
  function extractDocTextCalls(): string[] {
    // Captura todas as chamadas doc.text(...) e doc.text(`...`)
    const calls: string[] = [];
    const regex = /doc\.text\(\s*[`'"]([^`'"]*)[`'"]/g;
    let m;
    while ((m = regex.exec(PROPOSTAS_CONS_TS)) !== null) {
      calls.push(m[1]);
    }
    // Tambem captura strings template com ${...} no inicio que viram label
    const tplRegex = /doc\.text\(\s*`([^`]*\$\{[^`]*)`/g;
    while ((m = tplRegex.exec(PROPOSTAS_CONS_TS)) !== null) {
      calls.push(m[1]);
    }
    return calls;
  }

  const docTextCalls = extractDocTextCalls();

  it('1. Nenhuma chamada doc.text() contem ⚠ (U+26A0)', () => {
    const bugadas = docTextCalls.filter((s) => s.includes('⚠'));
    expect(bugadas).toEqual([]);
  });

  it('2. Nenhuma chamada doc.text() contem 📜 (U+1F4DC)', () => {
    const bugadas = docTextCalls.filter((s) => s.includes('\u{1F4DC}'));
    expect(bugadas).toEqual([]);
  });

  it('3. Nenhuma chamada doc.text() contem 🔍 (U+1F50D)', () => {
    const bugadas = docTextCalls.filter((s) => s.includes('\u{1F50D}'));
    expect(bugadas).toEqual([]);
  });

  it('4. Nenhuma chamada doc.text() contem 💬 (U+1F4AC)', () => {
    const bugadas = docTextCalls.filter((s) => s.includes('\u{1F4AC}'));
    expect(bugadas).toEqual([]);
  });

  it('5. Nenhuma chamada doc.text() contem ⬆ (U+2B06)', () => {
    const bugadas = docTextCalls.filter((s) => s.includes('⬆'));
    expect(bugadas).toEqual([]);
  });
});

describe('HOTFIX v3.44.0 — substituicoes aplicadas corretamente', () => {
  it('6. Titulo "ADICIONAL DE INSALUBRIDADE" usa "!" em vez de "⚠"', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/'! ADICIONAL DE INSALUBRIDADE'/);
    expect(PROPOSTAS_CONS_TS).toMatch(/'! ADICIONAL DE PERICULOSIDADE'/);
  });

  it('7. Labels FUNDAMENTO LEGAL / ENQUADRAMENTO TECNICO / JUSTIFICATIVA AO CLIENTE sem emoji', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/\.text\('FUNDAMENTO LEGAL'/);
    expect(PROPOSTAS_CONS_TS).toMatch(/\.text\('ENQUADRAMENTO TECNICO'/);
    expect(PROPOSTAS_CONS_TS).toMatch(/\.text\('JUSTIFICATIVA AO CLIENTE'/);
  });

  it('8. SERVICO NAO CONTRATADO usa "!" sem emoji', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/'! SERVIÇO NÃO CONTRATADO'/);
  });

  it('9. Aviso de Desconto usa "!" e Acrescimo usa "+"', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/! Desconto concedido:/);
    expect(PROPOSTAS_CONS_TS).toMatch(/\+ Acrescimo:/);
  });

  it('10. AdicionalCampoSnapshotPdf NAO inclui icone (emoji nao chega ao PDF via cenario)', () => {
    // Confirma que o interface nao tem o campo icone (so' usado na UI do wizard)
    const interfaceMatch = PROPOSTAS_CONS_TS.match(/interface AdicionalCampoSnapshotPdf \{[\s\S]*?\n\}/);
    expect(interfaceMatch).not.toBeNull();
    expect(interfaceMatch![0]).not.toMatch(/icone/);
  });
});
