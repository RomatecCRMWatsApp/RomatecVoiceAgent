// v1.99.16 — Fixtures de teste para os templates Prime (nao e' suite *.test.ts).
import type { PropostaDados, ReciboDados } from '../types/templateTypes';

export const dadosMockProposta: PropostaDados = {
  numero: 'PROP-2025-TEST-001',
  dataEmissao: '02 de junho de 2025',
  validade: '30 dias',
  tipoServico: 'Georreferenciamento de Imovel Rural',
  cliente: { nome: 'Cliente Teste Silva', cpfCnpj: '000.000.000-00', endereco: 'Acailandia/MA' },
  imovel: { nome: 'Fazenda Teste', municipio: 'Acailandia', uf: 'MA', areaHa: '100,00', matricula: 'M-1234' },
  servicos: [
    { descricao: 'Levantamento GNSS RTK', valor: 3000 },
    { descricao: 'TRT/CFT', valor: null },
  ],
  valorTotal: 3000,
  valorTotalExtenso: 'tres mil reais',
  parcelas: [
    { label: 'P1 – 40%', descricao: 'Na assinatura' },
    { label: 'P2 – 60%', descricao: 'Na entrega' },
  ],
  etapas: [
    { numero: '01', titulo: 'Campo', texto: 'Levantamento em campo.', prazo: '2 dias' },
    { numero: '02', titulo: 'Gabinete', texto: 'Processamento e peca tecnica.' },
  ],
  prazos: [
    { valor: '15', unidade: 'Dias', descricao: 'Prazo total' },
  ],
  drlIncluida: false,
  observacoes: 'Proposta sujeita a confirmacao de documentacao.',
  tecnico: {
    nome: 'Jose Romario Pinto Bezerra',
    cargo: 'Tecnico em Agrimensura',
    credenciais: ['CFT/MA n. 01209185369', 'INCRA FQNS'],
    empresa: 'Romatec Consultoria Total',
    municipio: 'Acailandia/MA',
  },
};

/** So os campos obrigatorios — valida que o builder nao quebra. */
export const dadosMinimosProposta: PropostaDados = {
  numero: 'PROP-MIN-001',
  dataEmissao: '03 de junho de 2026',
  validade: '30 dias',
  tipoServico: 'Avaliacao de Imoveis (PTAM)',
  cliente: { nome: 'Fulano', cpfCnpj: '111.111.111-11' },
  servicos: [{ descricao: 'Laudo PTAM', valor: 1500 }],
  valorTotal: 1500,
  valorTotalExtenso: 'mil e quinhentos reais',
  parcelas: [],
  etapas: [],
  prazos: [],
  drlIncluida: false,
  tecnico: {
    nome: 'Jose Romario',
    cargo: 'Avaliador CNAI',
    credenciais: ['CNAI 031161'],
    empresa: 'Romatec',
    municipio: 'Acailandia/MA',
  },
};

export const dadosMockRecibo: ReciboDados = {
  numero: 'REC-2025-0042',
  dataEmissao: '02 de junho de 2025',
  hashValidacao: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  urlVerificacao: 'https://romatec.example/v/a1b2c3d4',
  status: 'Confirmado',
  confirmado: true,
  cliente: { nome: 'Cliente Teste Silva', cpfCnpj: '000.000.000-00' },
  servico: 'Levantamento topografico — Lote 14',
  valorTotal: 3000,
  valorTotalExtenso: 'tres mil reais',
  parcelas: [
    { label: 'P1', valor: 1200, dataPagamento: '02/06/2025' },
    { label: 'P2', valor: 1800 },
  ],
  tecnico: {
    nome: 'Jose Romario Pinto Bezerra',
    cargo: 'Tecnico em Agrimensura',
    credenciais: ['CFT/MA n. 01209185369'],
  },
  observacoes: 'Pagamento via PIX.',
};

export const dadosMinimosRecibo: ReciboDados = {
  numero: 'REC-MIN-001',
  dataEmissao: '03 de junho de 2026',
  hashValidacao: 'deadbeef',
  urlVerificacao: 'https://romatec.example/v/deadbeef',
  status: 'Enviado',
  confirmado: false,
  cliente: { nome: 'Beltrano', cpfCnpj: '—' },
  servico: 'Servico Romatec',
  valorTotal: 0,
  valorTotalExtenso: 'zero reais',
  tecnico: { nome: 'Jose Romario', cargo: 'Tecnico', credenciais: [] },
};
