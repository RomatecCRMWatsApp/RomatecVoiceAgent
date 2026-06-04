// v3.x — Testes do Template Prime I (laudo, dark premium verde/dourado).
import { describe, it, expect } from 'vitest';
import { buildLaudoPrime1Html } from './laudoTemplatePrime1';
import { dadosMockLaudo, dadosMinimosLaudo } from '../testFixtures';

const QR_FAKE = 'data:image/png;base64,QR';

describe('Laudo Template Prime I — HTML (puro)', () => {
  it('contem o numero do laudo', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('LAUDO-2025-0042');
  });
  it('contem o nome do contratante', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('Cliente Teste Silva');
  });
  it('contem um rotulo de vertice (P1)', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('P1');
  });
  it('contem o valor de area', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('10.000,00 m²');
  });
  it('contem o texto da finalidade', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('regularização fundiária');
  });
  it('usa a cor-chave verde Romatec (#0B6E4F)', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('#0B6E4F');
  });
  it('inclui bloco de validacao (hash + url + QR)', () => {
    const html = buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE);
    expect(html).toContain(dadosMockLaudo.hashValidacao);
    expect(html).toContain(dadosMockLaudo.urlVerificacao);
    expect(html).toContain(QR_FAKE);
  });
  it('escapa HTML do contratante (anti-injection)', () => {
    const html = buildLaudoPrime1Html(
      { ...dadosMockLaudo, contratante: { ...dadosMockLaudo.contratante, nome: '<script>x</script>' } },
      QR_FAKE,
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('exibe "(croqui não disponível)" quando sem croqui', () => {
    const html = buildLaudoPrime1Html(dadosMinimosLaudo, QR_FAKE);
    expect(html).toContain('(croqui não disponível)');
  });
  it('nao quebra com dados minimos', () => {
    expect(() => buildLaudoPrime1Html(dadosMinimosLaudo, QR_FAKE)).not.toThrow();
  });
  it('contem a secao de Objeto da Demarcacao', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('Objeto');
  });
  it('contem a secao de Metodologia', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('Metodologia');
  });
  it('contem a secao de Equipamentos', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('Equipamentos');
  });
  it('contem a secao de Memorial', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('Memorial');
  });
  it('contem a coluna Alt. na tabela de vertices', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('Alt.');
  });
  it('contem azimute em formato DMS', () => {
    // azimute em DMS; escapeHtml converte ' e " para &#39; e &quot; no HTML
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toMatch(/\d+°\d+&#39;\d+&quot;/);
  });
  it('contem a secao de Pagamento e o brCode PIX', () => {
    const html = buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE);
    expect(html).toContain('Pagamento');
    expect(html).toContain(dadosMockLaudo.pagamento!.brCode);
  });
  it('contem o Relatorio Fotografico', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('Fotográfico');
  });
  it('contem o CPF com mascara', () => {
    expect(buildLaudoPrime1Html(dadosMockLaudo, QR_FAKE)).toContain('000.516.313-77');
  });
  it('omite Memorial quando memorialTexto vazio', () => {
    const html = buildLaudoPrime1Html(dadosMinimosLaudo, QR_FAKE);
    expect(html).not.toContain('Memorial Descritivo');
  });
  it('omite Pagamento quando sem dados de pagamento', () => {
    const html = buildLaudoPrime1Html(dadosMinimosLaudo, QR_FAKE);
    expect(html).not.toContain('Dados para Pagamento');
  });
});
