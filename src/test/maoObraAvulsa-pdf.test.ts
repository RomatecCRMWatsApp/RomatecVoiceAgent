// v3.92.0 — Geração do PDF de recibo de Mão de Obra Avulsa (PDFKit real).
// Cobre: PDF válido (%PDF) com dados completos; selo quando status='confirmado'.
//
// v3.123.0 — passou a verificar o TEOR do documento, não só o magic %PDF.
// Motivo: o recibo saía sem nenhuma declaração de quem recebeu e assinado só
// pelo pagador, então lia-se como se a Romatec tivesse RECEBIDO do prestador —
// exatamente o inverso do fato. Os testes antigos (só `%PDF`) passavam felizes
// com o documento errado.
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { gerarPdfMaoObraAvulsa } from '../services/maoObraAvulsaPdf';
import type { Recibo } from '../integrations/recibos';
import type { MaoObraAvulsa } from '../integrations/maoObraAvulsa';

function fakeRecibo(over: Partial<Recibo> = {}): Recibo {
  return {
    id: 10, numero: 'REC-MAO-2026-0001', tipo: 'mao_obra_avulsa',
    hash_validacao: 'a'.repeat(64), token: 'b'.repeat(64), status: 'enviado',
    valor: 300, destinatario_nome: 'Zé', destinatario_phone: '5599999999999',
    ...over,
  } as unknown as Recibo;
}
function fakeDet(over: Partial<MaoObraAvulsa> = {}): MaoObraAvulsa {
  return {
    id: 5, obra_id: 1, recibo_id: 10, nome_prestador: 'José Pedreiro',
    telefone_whatsapp: '5599999999999', cpf: '123.456.789-00',
    tipo_servico: 'Assentamento de piso', descricao_servico: '120m² porcelanato',
    valor_pago: 300, forma_pagamento: 'pix', data_pagamento: '2026-07-04',
    comprovante_nome: null, comprovante_mime: null,
    created_at: '2026-07-04', updated_at: '2026-07-04', obra_nome: 'GBOX PRIME',
    ...over,
  } as MaoObraAvulsa;
}

/**
 * Extrai o texto visível de um PDF gerado pelo PDFKit.
 *
 * Detalhes que importam pra este extrator funcionar:
 *  - os content streams vêm deflatados (FlateDecode);
 *  - o PDFKit NÃO usa literais `(texto)`: escreve arrays `[<hex> kern <hex>] TJ`,
 *    onde cada `<hex>` é um pedaço da MESMA palavra separado por ajuste de
 *    kerning. Por isso os pedaços de um mesmo TJ são concatenados sem separador
 *    (senão "ROMATEC" viraria "R OMA TEC") e só operadores TJ distintos são
 *    separados por espaço;
 *  - os bytes são WinAnsi, que bate com latin1 nos acentos que usamos (ã, ç, á).
 *
 * Como `align:'justify'` quebra o parágrafo em vários TJ, as asserções olham
 * TOKENS (palavras) e não frases inteiras.
 */
function textoDoPdf(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const streams: string[] = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let inflado: string;
    try { inflado = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); }
    catch { inflado = m[1]; }
    // só content streams (os de fonte/imagem são binário e não têm operador de texto)
    if (/\bTf\b/.test(inflado)) streams.push(inflado);
  }
  const conteudo = streams.join('\n');
  const hexPraTexto = (h: string) => Buffer.from(h.replace(/\s+/g, ''), 'hex').toString('latin1');

  const trechos: string[] = [];
  for (const arr of conteudo.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    let s = '';
    for (const h of arr[1].matchAll(/<([0-9A-Fa-f\s]*)>/g)) s += hexPraTexto(h[1]);
    for (const l of arr[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)) s += l[1].replace(/\\([()\\])/g, '$1');
    if (s) trechos.push(s);
  }
  // Tj solto (fora de array), por robustez
  for (const t of conteudo.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) trechos.push(hexPraTexto(t[1]));
  return trechos.join(' ');
}

describe('v3.123.0 — teor do recibo: quem recebeu x quem pagou', () => {
  it('declara que o PRESTADOR recebeu, e da Romatec (perfil PJ)', () => {
    return gerarPdfMaoObraAvulsa(fakeRecibo({ emitente_perfil: 'romatec_pj' }), fakeDet())
      .then(pdf => {
        const t = textoDoPdf(pdf);
        // núcleo da declaração de quitação
        expect(t).toMatch(/DECLARO/);
        expect(t).toMatch(/RECEBI/);
        expect(t).toMatch(/quita/i);          // "quitação" (acentuação WinAnsi)
        // quem recebeu = prestador; quem pagou = Romatec
        expect(t).toMatch(/Pedreiro/);        // nome do prestador
        expect(t).toMatch(/ROMATEC/);
        expect(t).toMatch(/17\.261\.987/);    // CNPJ do pagador
        // papéis explicitados no bloco de assinatura
        expect(t).toMatch(/Recebedor/i);
        expect(t).toMatch(/Emitente/i);
      });
  });

  it('perfil PF troca o pagador pra José Romário (CPF), não Romatec', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(
      fakeRecibo({ emitente_perfil: 'jose_romario_pf' }), fakeDet(),
    );
    const t = textoDoPdf(pdf);
    expect(t).toMatch(/Rom.rio/);            // "Romário"
    expect(t).toMatch(/012\.091\.853-69/);   // CPF do emitente PF
    expect(t).not.toMatch(/17\.261\.987/);   // CNPJ da PJ não aparece
  });

  it('perfil ausente/desconhecido cai em PJ (retrocompat dos recibos antigos)', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo({ emitente_perfil: '' }), fakeDet());
    expect(textoDoPdf(pdf)).toMatch(/ROMATEC/);
  });

  it('o valor aparece por extenso na declaração', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo(), fakeDet({ valor_pago: 300 }));
    const t = textoDoPdf(pdf);
    expect(t).toMatch(/trezentos/);
    expect(t).toMatch(/reais/);
  });

  it('sem CPF do prestador o documento ainda sai coerente', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo(), fakeDet({ cpf: null }));
    const t = textoDoPdf(pdf);
    expect(t).toMatch(/DECLARO/);
    expect(t).toMatch(/Prestador do servi/);  // fallback do rótulo da assinatura
  });
});

describe('gerarPdfMaoObraAvulsa (v3.92.0)', () => {
  it('gera um PDF válido (assinatura %PDF) com dados completos', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo(), fakeDet());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('gera PDF com selo quando status=confirmado (contra-recibo)', async () => {
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo({ status: 'confirmado' }), fakeDet());
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('embute comprovante quando é imagem base64', async () => {
    const img1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pdf = await gerarPdfMaoObraAvulsa(fakeRecibo(), fakeDet(), { comprovante: { mime: 'image/png', base64: img1x1 } });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
