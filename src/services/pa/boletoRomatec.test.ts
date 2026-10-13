// v3.144.0 — Boleto Romatec: código de barras FEBRABAN, mapa fiel sem nomes (LGPD) e HTML.
import { describe, it, expect } from 'vitest';
import { linhaParaCodigoBarras, codigoBarrasValido, formatarLinhaDigitavel, svgCodigoBarras, dvCodigoBarras } from './boletoCodigo';
import { svgLayoutPA } from './mapaSvg';
import { desenhoDoProjeto } from './layoutDesenho';
import { htmlBoletoRomatec, type DadosBoletoRomatec } from './boletoRomatec';

// Linha digitável de um boleto sandbox real do Asaas (lote 01, R$ 300,00, venc. 13/10/2026).
const LINHA = '46191.11000 00000.000000 13555.124018 5 15980000030000';

describe('código de barras', () => {
  it('linha digitável → 44 dígitos com DV geral válido, valor e fator no lugar certo', () => {
    const c = linhaParaCodigoBarras(LINHA);
    expect(c).toBe('46195159800000300001110000000000001355512401');
    expect(codigoBarrasValido(c)).toBe(true);
    expect(c.slice(9, 19)).toBe('0000030000'); // R$ 300,00
    expect(dvCodigoBarras(c)).toBe(5);
  });
  it('rejeita linha com DV adulterado ou tamanho errado', () => {
    expect(() => linhaParaCodigoBarras(LINHA.replace(' 5 ', ' 6 '))).toThrow();
    expect(() => linhaParaCodigoBarras('123')).toThrow();
  });
  it('formata e desenha ITF com ~103 mm de largura', () => {
    expect(formatarLinhaDigitavel(LINHA.replace(/\D/g, ''))).toBe(LINHA);
    const svg = svgCodigoBarras(linhaParaCodigoBarras(LINHA));
    const w = Number(svg.match(/width="([\d.]+)mm"/)![1]);
    expect(w).toBeGreaterThan(102.5);
    expect(w).toBeLessThan(103.5);
    expect((svg.match(/<rect/g) || []).length).toBe(2 + 22 * 5 + 2); // início 2 barras + 44 dígitos (5 barras/par) + fim 2
  });
});

const lotes = [
  { numero: '01', xy: [[180, 0], [200, 0], [200, 40], [180, 40]] },
  { numero: '02', xy: [[200, 0], [220, 0], [220, 40], [200, 40]] },
  { numero: '03', xy: [[220, 0], [240, 0], [240, 40], [220, 40]], institucional: true },
];

describe('mapa fiel (LGPD)', () => {
  it('desenha vias/praça/rótulos, destaca o lote e não traz nomes', () => {
    const s = svgLayoutPA({ lotes, desenho: desenhoDoProjeto('PA-SALETE-MORENO', null), destaque: '01' });
    expect(s).toContain('PRAÇA CENTRAL');
    expect(s).toContain('RUA 08 (DIAGONAL)');
    expect(s).toContain('#C9A84C'); // destaque
    expect(s).toContain('INSTITUCIONAL');
    expect(s).toMatch(/>01</);
    expect(s).not.toMatch(/MARIA|JOSÉ|Associado/);
  });
  it('sem desenho do projeto ainda mostra os lotes', () => {
    const s = svgLayoutPA({ lotes, desenho: null, destaque: '02' });
    expect(s).toMatch(/>02</);
    expect(s).not.toContain('PRAÇA');
  });
});

function dados(): DadosBoletoRomatec {
  return {
    banco: { codigo: '461', nome: 'Asaas IP' },
    beneficiario: { nome: 'Romatec Consultoria Total', documento: '17.261.987/0001-09', endereco: 'Açailândia/MA', agencia_codigo: '0001 / 1-1' },
    pagador: { nome: 'FULANA TESTE', cpf: '529.982.247-25', endereco: 'PA Teste, Lote 01' },
    projeto: { nome: 'PA Teste', municipio: 'Açailândia', uf: 'MA' },
    lote: { numero: '01', area_m2: 800, largura_m: 20, profundidade_m: 40, terra: 'Chácara X', associado_numero: 'PAT-001', xy: lotes[0].xy },
    parcela: { rotulo: 'Parcela 1/2', valor: 350, vencimento: '2026-11-10', multa_valor: 7, juros_mes_pct: 1 },
    descricao: 'PA Teste – Lote 01 – Parcela 1/2', linha_digitavel: LINHA, nosso_numero: '123', numero_documento: '456', data_documento: '2026-10-13',
    pix_copia_cola: '00020126330014br.gov.bcb.pix0111teste@x.com5204000053039865802BR5907ROMATEC6009ACAILANDI62070503***6304ABCD',
    url_fatura: null, responsavel_tecnico: { nome: 'José Romário Pinto Bezerra', registro: 'CFT 01209185369' },
    parcelas: [{ rotulo: 'Sinal', valor: 300, vencimento: '2026-10-13', status: 'PAGO' }, { rotulo: 'Parcela 1/2', valor: 350, vencimento: '2026-11-10', status: 'A_VENCER' }],
    mapa: { lotes, desenho: null }, ambiente_teste: true,
  };
}

describe('HTML do boleto', () => {
  it('modelo carta: ficha de compensação, linha, valor, QR Pix, marca de teste', async () => {
    const h = await htmlBoletoRomatec(dados(), 'carta');
    expect(h).toContain('FICHA DE COMPENSAÇÃO');
    expect(h).toContain(LINHA);
    expect(h).toMatch(/350,00/);
    expect(h).toContain('Pague com Pix');
    expect(h).toContain('BOLETO DE TESTE');
    expect(h).toContain('multa de R$');
  });
  it('modelo carnê: linha do tempo e progresso do lote', async () => {
    const h = await htmlBoletoRomatec({ ...dados(), ambiente_teste: false }, 'carne');
    expect(h).toContain('CARNÊ DO LOTE');
    expect(h).toMatch(/Pago até agora: <b>R\$\s300,00<\/b>/);
    expect(h).not.toContain('BOLETO DE TESTE');
  });
});
