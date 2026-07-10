// v3.45.0: live preview ao vivo (PDF inline em iframe) pra Propostas de Consultoria.
// Espelha o padrao do Recibo (gerarPdfReciboPreview + POST /api/recibos/preview-pdf).
//
// Backend: gerarPdfPropostaConsultoriaPreview(input) aceita campos parciais,
// gera PDF placeholder sem persistir nada.
// Endpoint: POST /api/propostas-consultoria/preview-pdf -> application/pdf
// Frontend: __criarLivePreviewProposta() helper + iframe sticky + debounce 600ms

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROPOSTAS_CONS_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'integrations', 'propostasConsultoria.ts'),
  'utf-8',
);
const SERVER_TS = fs.readFileSync(
  path.join(process.cwd(), 'src', 'server.ts'),
  'utf-8',
);
const OBRAS_HTML = fs.readFileSync(
  path.join(process.cwd(), 'src', 'public', 'obras.html'),
  'utf-8',
);

describe('HOTFIX/FEAT v3.45.0 — Backend: gerarPdfPropostaConsultoriaPreview', () => {
  it('1. Funcao exportada com assinatura esperada', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/export async function gerarPdfPropostaConsultoriaPreview\(input:/);
  });

  it('2. Reusa previewCustoConsultoria pra calcular custos (mesmo engine)', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/gerarPdfPropostaConsultoriaPreview[\s\S]{0,2000}?previewCustoConsultoria\(\{/);
  });

  it('3. Tolera falha de custos (preview NAO derruba — devolve custos vazios)', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/preview-pdf\] custos falharam/);
    expect(PROPOSTAS_CONS_TS).toMatch(/secao_5_total: 0/);
  });

  it('4. Chama gerarPdfPropostaConsultoria com propostaOverride + isPreview=true', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/return gerarPdfPropostaConsultoria\('0', undefined, \{\s*\n?\s*propostaOverride,\s*\n?\s*isPreview: true/);
  });
});

describe('HOTFIX/FEAT v3.45.0 — Refactor gerarPdfPropostaConsultoria aceita override', () => {
  it('5. Assinatura ganha options.propostaOverride opcional', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/options\?: \{[\s\S]{0,300}?propostaOverride\?:/);
  });

  it('6. Assinatura ganha options.isPreview opcional', () => {
    // Match em multiline maior — comentario explicativo expandiu o trecho > 300 chars
    expect(PROPOSTAS_CONS_TS).toMatch(/options\?: \{[\s\S]{0,800}?isPreview\?: boolean/);
  });

  it('7. Bypass do buscarPropostaConsultoria quando override fornecido', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/const p = options\?\.propostaOverride \?\? await buscarPropostaConsultoria/);
  });

  it('8. Em preview, QR/hash sao SUBSTITUIDOS por placeholder textual', () => {
    expect(PROPOSTAS_CONS_TS).toMatch(/if \(isPreview\)/);
    expect(PROPOSTAS_CONS_TS).toMatch(/QR Code e hash de validacao serao gerados ao salvar/);
  });
});

describe('HOTFIX/FEAT v3.45.0 — Endpoint POST /preview-pdf', () => {
  it('9. Endpoint registrado ABERTO (sem requireAuth) — mesmo padrão do preview de recibo/vale (v3.92.5)', () => {
    // v3.92.5: removido requireAuth — exigir cookie JWT quebrava o preview quando
    // a sessão do CEO é via X-CEO-Token / JWT expirado. Preview só renderiza o
    // body enviado (não busca dado de terceiros), igual /api/recibos/preview-pdf.
    expect(SERVER_TS).toMatch(/app\.post\('\/api\/propostas-consultoria\/preview-pdf',\s*async/);
    expect(SERVER_TS).not.toMatch(/app\.post\('\/api\/propostas-consultoria\/preview-pdf',\s*requireAuth/);
  });

  it('10. Retorna application/pdf (nao json)', () => {
    expect(SERVER_TS).toMatch(/preview-pdf'[\s\S]{0,1000}?setHeader\('Content-Type', 'application\/pdf'\)/);
  });

  it('11. Cache-Control no-store (cada keystroke gera novo PDF)', () => {
    expect(SERVER_TS).toMatch(/preview-pdf'[\s\S]{0,1000}?setHeader\('Cache-Control', 'no-store'\)/);
  });

  it('12. 500 com payload de erro se gerar falhar', () => {
    expect(SERVER_TS).toMatch(/preview-pdf'[\s\S]{0,1200}?res\.status\(500\)\.json\(\{ error: 'Falha gerar preview'/);
  });
});

describe('HOTFIX/FEAT v3.45.0 — Frontend: helper __criarLivePreviewProposta', () => {
  it('13. Helper existe e e function declaration', () => {
    expect(OBRAS_HTML).toMatch(/function __criarLivePreviewProposta\(opts\) \{/);
  });

  it('14. Debounce default 600ms (mesmo do recibo)', () => {
    expect(OBRAS_HTML).toMatch(/const debounce = opts\.debounceMs \?\? 600/);
  });

  it('15. Usa POST /api/propostas-consultoria/preview-pdf com credentials include', () => {
    expect(OBRAS_HTML).toMatch(/fetch\('\/api\/propostas-consultoria\/preview-pdf'/);
    expect(OBRAS_HTML).toMatch(/__criarLivePreviewProposta[\s\S]{0,800}?credentials: 'include'/);
  });

  it('16. 401 mostra mensagem clara "Faça login" sem redirect em loop', () => {
    expect(OBRAS_HTML).toMatch(/resp\.status === 401[\s\S]{0,300}?Faça login pra ver/);
  });

  it('17. blobUrl revogado antes de gerar novo (evita memory leak)', () => {
    expect(OBRAS_HTML).toMatch(/if \(blobUrl\) URL\.revokeObjectURL\(blobUrl\)/);
  });

  it('18. inflight flag previne 2 requests simultaneos', () => {
    expect(OBRAS_HTML).toMatch(/let inflight = false/);
    expect(OBRAS_HTML).toMatch(/if \(inflight\) return/);
  });
});

describe('HOTFIX/FEAT v3.45.0 — Frontend: integracao no form de Demarcacao', () => {
  it('19. Form de demarcacao usa wrapper grid 2-cols (dmSplitGrid)', () => {
    expect(OBRAS_HTML).toMatch(/<div id="dmSplitGrid" style="display:grid;/);
  });

  it('20. Painel de preview tem #dmPreviewBox + botao refresh manual', () => {
    expect(OBRAS_HTML).toMatch(/id="dmPreviewBox"/);
    expect(OBRAS_HTML).toMatch(/id="dmRefreshPreview"/);
  });

  it('21. Setup do preview chama __criarLivePreviewProposta', () => {
    expect(OBRAS_HTML).toMatch(/const __dmPreview = __criarLivePreviewProposta\(\{/);
  });

  it('22. Bind nos inputs/selects do form via querySelectorAll', () => {
    expect(OBRAS_HTML).toMatch(/#dmSplitGrid input, #dmSplitGrid select, #dmSplitGrid textarea/);
  });

  it('23. Primeira renderizacao via setTimeout(100ms) — apos cache popular campos', () => {
    expect(OBRAS_HTML).toMatch(/setTimeout\(\(\) => __dmPreview\.atualizar\(\), 100\)/);
  });

  it('24. getDados tolera erro de montarDadosImovel (devolve subtipo + dados vazios)', () => {
    expect(OBRAS_HTML).toMatch(/catch \(_err\)[\s\S]{0,200}?subtipo, dados_imovel: \{\}/);
  });

  it('25. Media query 1100px colapsa pra 1 coluna no mobile', () => {
    expect(OBRAS_HTML).toMatch(/@media \(max-width: 1100px\)[\s\S]{0,200}?#dmSplitGrid \{ grid-template-columns: 1fr/);
  });
});
