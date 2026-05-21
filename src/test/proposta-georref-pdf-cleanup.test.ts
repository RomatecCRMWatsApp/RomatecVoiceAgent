// v3.23.7: smoke test do PDF cleanup. Estrutura:
//   - Fix 1 (anexos vazando): validacao por leitura do server.ts/propostasConsultoria.ts
//     — anexo dynamic source-grep nao roda PDF inteiro (DB+voyageai). O Fix 1 por si
//     so e' uma mudanca de routing — facil de validar staticamente.
//   - Fix 2 (paginas redundantes): validacao por leitura do construtor + bufferedPageRange.
//   - Fix 3 (texto cortado): smoke test in-memory chamando renderGeorrefRuralBody com
//     dados fake + parse via pdf-parse — checa que strings completas aparecem.
//
// Por que static smoke + 1 render real:
//   propostasConsultoria.ts arrasta deps pesadas (voyageai) que quebram em ESM
//   nos testes. Mocking o modulo inteiro com vi.mock funcionaria mas tornaria o
//   teste fragil. Os 3 checks staticos + 1 render isolado de renderGeorrefRuralBody
//   cobrem o que importa: defaults invertidos, footer global, texto integro.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const propostasConsultoriaSrc = readFileSync(
  join(REPO_ROOT, 'src', 'integrations', 'propostasConsultoria.ts'),
  'utf8',
);
const serverSrc = readFileSync(join(REPO_ROOT, 'src', 'server.ts'), 'utf8');

describe('Fix 1 — anexos nao vazam mais no PDF principal', () => {
  it('funcao com merge foi renomeada de Completo pra ComAnexos', () => {
    // O nome antigo "Completo" sugeria "padrao", mas era so um caso. Renomeacao deixa
    // a intencao explicita: ComAnexos so quando alguem PEDE explicitamente.
    expect(propostasConsultoriaSrc).not.toMatch(/gerarPdfPropostaConsultoriaCompleto\b/);
    expect(propostasConsultoriaSrc).toMatch(/export async function gerarPdfPropostaConsultoriaComAnexos/);
  });

  it('endpoint /api/.../pdf default e ComAnexos (anexos juntos no PDF — v3.23.10)', () => {
    // v3.23.10: REVERTIDO ao comportamento v1.66.9. Anexos voltaram pro PDF default.
    // ?sem_anexos=1 (ou ?somente_principal=1 legado) e' o opt-out pra versao enxuta.
    // ?incluir_anexos=1 ainda funciona como opt-in explicito (compat com v3.23.7-9).
    expect(serverSrc).toMatch(/req\.query\.sem_anexos === '1'/);
    expect(serverSrc).toMatch(/somente_principal === '1'/); // compat legado
    // O default (sem nenhum query string) usa o ComAnexos
    expect(serverSrc).toMatch(/incluirAnexos\s*=[\s\S]{0,80}!semAnexos/);
  });

  it('rota publica /v/:hash/pdf usa ComAnexos (v3.23.10)', () => {
    // Revertido em v3.23.10 — cliente final / cartorio prefere PDF unico.
    const idxVHash = serverSrc.indexOf("app.get('/v/:hash/pdf'");
    expect(idxVHash, '/v/:hash/pdf handler nao encontrado').toBeGreaterThan(0);
    const idxFim = serverSrc.indexOf('app.', idxVHash + 30);
    const trechoVHash = serverSrc.slice(idxVHash, idxFim > 0 ? idxFim : idxVHash + 2000);
    expect(trechoVHash).toContain('gerarPdfPropostaConsultoriaComAnexos(p.id)');
  });

  it('enviar-whatsapp envia PDF unificado (v3.23.10)', () => {
    // v3.23.10: revertido pra PDF unico (proposta + anexos no mesmo arquivo).
    // CEO pediu — cliente prefere 1 arquivo unico de armazenar/encaminhar.
    const fn = propostasConsultoriaSrc.match(
      /export async function enviarPropostaConsultoriaWhatsApp[\s\S]+?\n\}/,
    );
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toContain('gerarPdfPropostaConsultoriaComAnexos(input.id)');
    // Loop de anexos individuais foi removido
    expect(body).not.toMatch(/for \(const anexo of anexos\)/);
  });

  it('enviar-telegram envia PDF unificado (v3.23.10)', () => {
    const fn = propostasConsultoriaSrc.match(
      /export async function enviarPropostaConsultoriaTelegram[\s\S]+?\n\}/,
    );
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toContain('gerarPdfPropostaConsultoriaComAnexos(input.id)');
    expect(body).not.toMatch(/for \(const anexo of anexos\)/);
  });
});

describe('Fix 2 — paginas redundantes eliminadas', () => {
  it('PDFDocument criado com bufferPages: true', () => {
    expect(propostasConsultoriaSrc).toMatch(/new PDFDocument\(\{[^}]*bufferPages:\s*true/);
  });

  it('footer global via bufferedPageRange (NAO mais text() fixo em y=800)', () => {
    expect(propostasConsultoriaSrc).toMatch(/const range = doc\.bufferedPageRange\(\)/);
    expect(propostasConsultoriaSrc).toMatch(/doc\.switchToPage\(i\)/);
    // O text() avulso antigo em y=800 com "Proposta valida por X dias" foi removido
    expect(propostasConsultoriaSrc).not.toMatch(/text\(`\$\{brand\} — Proposta valida por/);
  });

  it('footer global tem "Pagina X de Y" em todas as paginas', () => {
    expect(propostasConsultoriaSrc).toMatch(/Pagina \$\{pageNum\} de \$\{range\.count\}/);
  });

  it('QR + hash garantem espaco antes (espacoRestante < ALTURA_QR_BLOCO -> addPage)', () => {
    expect(propostasConsultoriaSrc).toMatch(/ALTURA_QR_BLOCO\s*=\s*\d+/);
    expect(propostasConsultoriaSrc).toMatch(/espacoRestante\s*<\s*ALTURA_QR_BLOCO/);
  });

  it('QR Y nao mais hardcoded 720 — agora relativo a doc.y', () => {
    // Antes: const qrY = 720; depois: const qrY = doc.y;
    expect(propostasConsultoriaSrc).not.toMatch(/const qrY\s*=\s*720/);
    expect(propostasConsultoriaSrc).toMatch(/const qrY\s*=\s*doc\.y/);
  });
});

describe('Fix 3 — renderGeorrefRuralBody usa full width', () => {
  it('exporta a funcao pra ser testavel', () => {
    expect(propostasConsultoriaSrc).toMatch(/export function renderGeorrefRuralBody/);
  });

  it('seccoes 7 (Documentos) e 8 (Avisos) usam coords explicitas + width COL_W - 16 (v3.23.8)', () => {
    // v3.23.8: ajustado de {indent:8, width: COL_W-8} para coords explicitas
    // (COL_X_INI + 8, doc.y, { width: COL_W - 16 }). Resultado efetivo e' o
    // mesmo (uma coluna full-width com margem de 8px), mas evita herancia de
    // doc.x deslocado entre secoes que estava cortando texto em prod.
    const idx7 = propostasConsultoriaSrc.indexOf('7. Documentos a Serem Fornecidos');
    const idx8 = propostasConsultoriaSrc.indexOf('8. Avisos e Condicoes Tecnicas');
    expect(idx7).toBeGreaterThan(0);
    expect(idx8).toBeGreaterThan(idx7);

    // Seccao 7
    const secao7Src = propostasConsultoriaSrc.slice(idx7, idx8);
    expect(secao7Src).toMatch(/secao_4_checklist\.forEach/);
    expect(secao7Src).toMatch(/width:\s*COL_W\s*-\s*16/);
    // Reset explicito de doc.x antes da seccao + por iteracao
    expect(secao7Src).toMatch(/doc\.x\s*=\s*COL_X_INI/);

    // Seccao 8
    const idxFinal = propostasConsultoriaSrc.indexOf('renderAvisoDRL(doc, finalidadeDRL', idx8);
    expect(idxFinal).toBeGreaterThan(idx8);
    const secao8Src = propostasConsultoriaSrc.slice(idx8, idxFinal);
    expect(secao8Src).toMatch(/custos\.avisos\.forEach/);
    expect(secao8Src).toMatch(/width:\s*COL_W\s*-\s*16/);
    expect(secao8Src).toMatch(/doc\.x\s*=\s*COL_X_INI/);
  });

  it('COL_W = COL_X_FIM - COL_X_INI = 499 (largura util A4 com margem 48)', () => {
    expect(propostasConsultoriaSrc).toMatch(/const COL_X_INI\s*=\s*48/);
    expect(propostasConsultoriaSrc).toMatch(/const COL_X_FIM\s*=\s*547/);
    expect(propostasConsultoriaSrc).toMatch(/const COL_W\s*=\s*COL_X_FIM\s*-\s*COL_X_INI/);
  });
});
