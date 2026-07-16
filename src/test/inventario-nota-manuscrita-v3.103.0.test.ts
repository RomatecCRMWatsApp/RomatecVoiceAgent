// v3.103.0 — Compra sem NF (nota de venda MANUSCRITA de madeireira/depósito):
// IA aceita e extrai; manuscrito SEMPRE cai na revisão; na revisão TUDO é
// editável, inclusive valores (item e nota) pra desconto concedido; item ganha
// botão Editar; arquivo original visível na conferência.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

describe('OCR aceita nota de venda manuscrita (v3.103.0)', () => {
  const OCR = read('services', 'inventario', 'notaFiscalOcr.ts');

  it('prompt cobre nota manuscrita e proíbe rejeitar por ser à mão', () => {
    expect(OCR).toMatch(/NOTA DE VENDA\/PEDIDO\/RECIBO MANUSCRITO/);
    expect(OCR).toMatch(/NOTA MANUSCRITA E VALIDA/);
    expect(OCR).toMatch(/nota_venda_manuscrita/);
  });

  it('manuscrito nunca sai com confiança alta (sempre revisão) e total negociado é respeitado', () => {
    expect(OCR).toMatch(/Manuscrito => NO MAXIMO "media"/);
    expect(OCR).toMatch(/NEGOCIADO/);
    expect(OCR).toMatch(/NAO "corrija" a diferenca/);
  });

  it('linha só com total (ex: mão de obra) vira item com quantidade 1', () => {
    expect(OCR).toMatch(/Number\(i\.valor_total\) > 0/);
    expect(OCR).toMatch(/quantidade: Number\(i\.quantidade\) > 0 \? Number\(i\.quantidade\) : 1/);
  });
});

describe('Valores editáveis (desconto concedido) — v3.103.0', () => {
  const REPO = read('services', 'inventario', 'inventarioObraRepo.ts');
  const ROUTER = read('routes', 'inventarioObra.ts');
  const PAGE = read('public', 'inventario-obra.html');

  it('repo: revisão edita valor_total do item + cabeçalho da nota; item editável', () => {
    expect(REPO).toMatch(/valor_total\?: number \| null;[\s\S]{0,200}?\}\): Promise<void> \{\s*\n\s*const item = await obterItem/);
    expect(REPO).toMatch(/export async function atualizarNotaRevisao/);
    // quantidade de item de nota destrava enquanto confianca_baixa=1
    expect(REPO).toMatch(/item\.origem === 'nota_fiscal' && Number\(item\.confianca_baixa\) !== 1/);
  });

  it('router: revisar aceita nota{...} e serve o arquivo original', () => {
    expect(ROUTER).toMatch(/atualizarNotaRevisao\(notaId/);
    expect(ROUTER).toMatch(/\/notas\/:notaId\/arquivo/);
    expect(ROUTER).toMatch(/valor_total: it\.valor_total !== undefined/);
    expect(ROUTER).toMatch(/valor_total: b\.valor_total !== undefined/); // PATCH /itens
  });

  it('página: revisão com V.Total + cabeçalho editável + link pra nota original', () => {
    expect(PAGE).toMatch(/data-f="valor_total"/);
    expect(PAGE).toMatch(/VALOR TOTAL da nota/);
    expect(PAGE).toMatch(/Ver nota original/);
    expect(PAGE).toMatch(/\/notas\/'\+notaId\+'\/arquivo/);
  });

  it('página: botão ✎ Editar no item + flag reabre a conferência da nota', () => {
    expect(PAGE).toMatch(/data-editar/);
    expect(PAGE).toMatch(/function modalEditarItem/);
    expect(PAGE).toMatch(/desconto concedido/);
    expect(PAGE).toMatch(/data-revisar/);
    expect(PAGE).toMatch(/Reabrir a conferência da nota/);
  });
});
