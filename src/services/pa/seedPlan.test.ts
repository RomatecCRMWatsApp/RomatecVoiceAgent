// v3.142.0 — Plano do seed: rateio do Pix único (lotes 63/64), à vista,
// parcial, espécie sem ID e rejeições de CPF. Mini-seed com dados FICTÍCIOS.
//
// O seed real (dados pessoais de 63 associados) NÃO fica no repositório. Para
// conferir os KPIs de aceite contra ele: PA_SEED_PATH=<seed.json> npx vitest run src/services/pa
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { planejarSeed, parseConjuge, parsePagadorTerceiro, normalizarIdTransacao, formaPorTexto, type SeedJson } from './seedPlan';

function mini(): SeedJson {
  return {
    projeto: {
      codigo: 'PA-TESTE', nome: 'PA Teste', municipio: 'Açailândia', uf: 'MA', valor_lote: 1000, sinal_padrao: 300, boleto_padrao: 350,
      prazo_sinal: '2026-10-13', pix: { chave: 'romatec-consultoria-256@jim.com', favorecido: 'ROMATEC CONSULTORIA TOTAL', cidade: 'ACAILANDIA' },
      associacao: { nome: 'Associação Teste', cnpj: null, cnpj_status: 'EM_HOMOLOGACAO' },
    },
    lotes: ['46', '48', '63', '64', '67'].map((n) => ({
      numero: n, tipo: n === '67' ? 'INSTITUCIONAL' : 'ASSOCIADO', largura_m: 20, profundidade_m: 40, area_m2: 800,
      croqui_xy_m: [[0, 0], [20, 0], [20, 40], [0, 40]], status_medicao: 'PENDENTE',
    })),
    associados: [
      { numero: 'PAT-046', lote: '46', nome: 'FULANA PARCIAL', cpf: '529.982.247-25', telefone: '(99) 9 9000-0001', dia_vencimento: '10', conjuge: 'BELTRANO – CPF 111.444.777-35' },
      { numero: 'PAT-048', lote: '48', nome: 'CICLANO AVISTA', cpf: '123.456.789-09', telefone: '(99) 9 9000-0002', dia_vencimento: null },
      { numero: 'PAT-063', lote: '63', nome: 'PESSOA SESSENTA E TRES', cpf: '935.411.347-80', telefone: '(99) 9 9000-0003', dia_vencimento: '10' },
      { numero: 'PAT-064', lote: '64', nome: 'PESSOA SESSENTA E QUATRO', cpf: '111.444.777-35', telefone: '(99) 9 9000-0003', dia_vencimento: '10' },
      { numero: 'PAT-099', lote: '67', nome: 'CPF RUIM', cpf: '123.456.789-00' },
      { numero: 'PAT-098', lote: '67', nome: 'CPF REPETIDO', cpf: '529.982.247-25' },
    ],
    pagamentos: [
      { lote: '46', tipo: 'SINAL', valor: 300, status: 'PARCIAL', forma: 'Espécie (parcial)', descricao: 'PARCIAL 11/10/2026 · R$ 200,00 em espécie', data: null, id_transacao: null, valor_recebido: 200 },
      { lote: '46', tipo: 'BOLETO_1', valor: 350, status: 'A VENCER', vencimento: '10/11/2026' },
      { lote: '46', tipo: 'BOLETO_2', valor: 350, status: 'A VENCER', vencimento: '10/12/2026' },
      { lote: '48', tipo: 'SINAL', valor: 1000, status: 'PAGO', forma: 'À vista – Pix', descricao: 'QUITADO', data: '10/10/2026 às 10:50:02 (BRT)', id_transacao: 'E10573521202610101349WXZn6fZ7cE3', valor_recebido: 1000 },
      { lote: '63', tipo: 'SINAL', valor: 300, status: 'PAGO', forma: 'Pix', pagador_terceiro: 'Leandro Teste', data: '11/10/2026 às 12:55', id_transacao: 'E18236120202610111555s14a95cc49a', valor_recebido: 300 },
      { lote: '63', tipo: 'BOLETO_1', valor: 350, status: 'A VENCER', vencimento: '10/11/2026' },
      { lote: '63', tipo: 'BOLETO_2', valor: 350, status: 'A VENCER', vencimento: '10/12/2026' },
      { lote: '64', tipo: 'SINAL', valor: 300, status: 'PAGO', forma: 'Pix', pagador_terceiro: null, data: '11/10/2026 às 12:55', id_transacao: 'E18236120202610111555s14a95cc49a', valor_recebido: 300 },
      { lote: '64', tipo: 'BOLETO_1', valor: 350, status: 'A VENCER', vencimento: '10/11/2026' },
      { lote: '64', tipo: 'BOLETO_2', valor: 350, status: 'A VENCER', vencimento: '10/12/2026' },
    ],
    documentos: [
      { lote: '63', tipo: 'FOTO_3X4', arquivo: 'LOTE-63-Pessoa/01-foto-3x4.jpg' },
      { lote: '64', tipo: 'PROCESSO_ASSINADO', arquivo: 'LOTE-64-Pessoa/05-processo-ASSINADO.pdf' },
      { lote: '64', tipo: 'OUTRO', arquivo: '../../etc/passwd' },
    ],
  };
}

describe('planejarSeed', () => {
  const p = planejarSeed(mini());

  it('rejeita CPF inválido e CPF duplicado no projeto', () => {
    expect(p.associados.map((a) => a.numero)).toEqual(['PAT-046', 'PAT-048', 'PAT-063', 'PAT-064']);
    expect(p.erros.join('\n')).toMatch(/PAT-099.*CPF .* inválido/);
    expect(p.erros.join('\n')).toMatch(/PAT-098.*(duplicado|já tem associado)/);
  });

  it('Pix único p/ 2 lotes → UM pagamento de R$ 600 rateado 300/300', () => {
    const pix = p.pagamentos.filter((x) => x.id_transacao === 'E18236120202610111555s14a95cc49a');
    expect(pix).toHaveLength(1);
    expect(pix[0].valor).toBe(600);
    expect(pix[0].rateio).toEqual([
      { lote: '63', tipo: 'SINAL', parcela: 0, valor: 300 },
      { lote: '64', tipo: 'SINAL', parcela: 0, valor: 300 },
    ]);
    expect(pix[0].pagador_nome).toBe('Leandro Teste');
    expect(pix[0].pago_em).toBe('2026-10-11 12:55:00');
  });

  it('à vista vira AVISTA; parcial mantém o recebido; espécie sem ID usa seed_chave', () => {
    expect(p.lancamentos.find((l) => l.lote === '48')).toMatchObject({ tipo: 'AVISTA', parcela: 0, valor: 1000, status: 'PAGO' });
    const parcial = p.pagamentos.find((x) => x.rateio[0].lote === '46')!;
    expect(parcial).toMatchObject({ forma: 'ESPECIE', valor: 200, id_transacao: null, seed_chave: 'seed:PA-TESTE:PAT-046:SINAL:0', pago_em: '2026-10-11 00:00:00' });
    expect(p.lancamentos.filter((l) => l.lote === '46').map((l) => l.status)).toEqual(['PARCIAL', 'A_VENCER', 'A_VENCER']);
  });

  it('KPIs do mini-seed', () => {
    const contratado = p.lancamentos.reduce((s, l) => s + l.valor, 0);
    const recebido = p.pagamentos.reduce((s, x) => s + x.valor, 0);
    expect(contratado).toBe(4000);
    expect(recebido).toBe(1800);
  });

  it('avisa telefone repetido, cônjuge parseado, croqui → perímetro', () => {
    expect(p.avisos.join('\n')).toMatch(/PAT-064.*telefone igual ao de PAT-063/);
    expect(p.associados[0]).toMatchObject({ conjuge_nome: 'BELTRANO', conjuge_cpf: '111.444.777-35', telefone_e164: '+5599990000001', dia_vencimento: 10 });
    expect(p.lotes[0].perimetro_m).toBe(120);
  });

  it('documentos: caminho lógico e bloqueio de path traversal', () => {
    expect(p.documentos.map((d) => d.caminho)).toEqual(['PA-TESTE/LOTE-63-Pessoa/01-foto-3x4.jpg', 'PA-TESTE/LOTE-64-Pessoa/05-processo-ASSINADO.pdf']);
    expect(p.documentos[1].mime).toBe('application/pdf');
    expect(p.erros.join('\n')).toMatch(/passwd: caminho inválido/);
  });
});

describe('parsers auxiliares', () => {
  it('cônjuge, pagador terceiro, id de transação, forma', () => {
    expect(parseConjuge('RONE TESTE – CPF 011.968.993-62')).toEqual({ nome: 'RONE TESTE', cpf: '011.968.993-62' });
    expect(parsePagadorTerceiro('Rosa Teste (genitora')).toEqual({ nome: 'Rosa Teste', vinculo: 'genitora' });
    expect(parsePagadorTerceiro('Rosa Teste')).toEqual({ nome: 'Rosa Teste', vinculo: null });
    expect(normalizarIdTransacao('Não se aplica – pagamento em espécie (recibo abaixo)')).toBeNull();
    expect(normalizarIdTransacao('Pix E60701190202610101718DY5SVYIR0O6')).toBe('E60701190202610101718DY5SVYIR0O6');
    expect(formaPorTexto('Misto (espécie + Pix)')).toBe('MISTO');
    expect(formaPorTexto('Cartão de débito')).toBe('CARTAO_DEBITO');
    expect(formaPorTexto('À vista – Pix')).toBe('PIX');
  });
});

// Critério de aceite §10 contra o seed REAL (posição 11/10/2026), só quando informado.
const SEED = process.env.PA_SEED_PATH;
describe.skipIf(!SEED || !existsSync(SEED))('seed real PA Salete Moreno (PA_SEED_PATH)', () => {
  it('70 lotes / 63 associados / 325 documentos e KPIs da TABELA-GERAL', () => {
    const p = planejarSeed(JSON.parse(readFileSync(SEED!, 'utf8')) as SeedJson);
    expect(p.erros).toEqual([]);
    expect([p.lotes.length, p.associados.length, p.documentos.length]).toEqual([70, 63, 325]);
    const contratado = p.lancamentos.reduce((s, l) => s + l.valor, 0);
    const recebido = p.pagamentos.reduce((s, x) => s + x.valor, 0);
    expect(contratado).toBe(63000);
    expect(recebido).toBe(18650);
    expect(contratado - recebido).toBe(44350);
    const entradas = p.lancamentos.filter((l) => l.tipo === 'SINAL' || l.tipo === 'AVISTA');
    const pendSinal = p.lancamentos.filter((l) => l.tipo === 'SINAL' && l.status !== 'PAGO').reduce((s, l) => {
      const rec = p.pagamentos.flatMap((x) => x.rateio).filter((r) => r.lote === l.lote && r.tipo === 'SINAL').reduce((a, r) => a + r.valor, 0);
      return s + l.valor - rec;
    }, 0);
    expect(pendSinal).toBe(2800);
    expect(entradas.filter((l) => l.status === 'PAGO')).toHaveLength(53);
    expect(entradas.filter((l) => l.status === 'A_PAGAR')).toHaveLength(9);
    expect(entradas.filter((l) => l.status === 'PARCIAL')).toHaveLength(1);
    const pix6364 = p.pagamentos.find((x) => x.id_transacao === 'E18236120202610111555s14a95cc49a')!;
    expect(pix6364.valor).toBe(600);
    expect(pix6364.rateio.map((r) => [r.lote, r.valor])).toEqual([['63', 300], ['64', 300]]);
    expect(p.associados.filter((a) => a.contrato_status === 'ASSINADO').map((a) => a.lote)).toEqual(['08', '33', '35', '59']);
    expect(p.lotes.filter((l) => l.tipo === 'INSTITUCIONAL').map((l) => l.numero)).toEqual(['03', '04', '09', '18', '67', '68', '70']);
  });
});
