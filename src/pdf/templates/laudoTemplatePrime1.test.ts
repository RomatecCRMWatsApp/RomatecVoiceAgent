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
});
