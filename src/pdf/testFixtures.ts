// v1.99.16 — Fixtures de teste para os templates Prime (nao e' suite *.test.ts).
import type { PropostaDados, ReciboDados, LaudoDados } from '../types/templateTypes';

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

export const dadosMockLaudo: LaudoDados = {
  numero: 'LAUDO-2025-0042',
  dataEmissao: '02 de junho de 2025',
  tipoImovel: 'RURAL',
  finalidade:
    'Demarcação e materialização de vértices da poligonal do imóvel para fins de ' +
    'regularização fundiária, conforme NBR 13133 e sistemática INCRA/NTGIR.',
  objeto:
    'Constitui objeto do presente laudo a demarcação e materialização dos vértices ' +
    'definidores da poligonal do imóvel Fazenda Teste, situado em Acailandia/MA, com ' +
    'vistas à sua caracterização geométrica para fins de regularização.',
  contratante: {
    nome: 'Cliente Teste Silva',
    cpfCnpj: '000.516.313-77',
    telefone: '99999-0000',
    email: 'cliente@example.com',
    rg: '1234567 SSP/MA',
    estadoCivil: 'Viúvo(a)',
    nacionalidade: 'brasileiro(a)',
  },
  imovel: {
    denominacao: 'Fazenda Teste',
    matricula: 'M-1234',
    municipio: 'Acailandia',
    uf: 'MA',
    localizacao: 'Zona Rural · Acailandia · MA',
  },
  vertices: [
    { ordem: 1, rotulo: 'P1', tipoMarco: 'Marco de concreto', utmE: '200.000,000', utmN: '9.500.000,000', lat: '04°30\'00"S', long: '47°30\'00"W', alt: '245,300 m' },
    { ordem: 2, rotulo: 'P2', tipoMarco: 'Marco de concreto', utmE: '200.100,000', utmN: '9.500.000,000', lat: '04°30\'00"S', long: '47°29\'56"W', alt: '246,100 m' },
    { ordem: 3, rotulo: 'P3', tipoMarco: 'Marco de concreto', utmE: '200.100,000', utmN: '9.500.100,000', lat: '04°29\'56"S', long: '47°29\'56"W', alt: '247,000 m' },
  ],
  lados: [
    { lado: 'P1-P2', azimute: '90°13\'52"', distancia: '100,000 m' },
    { lado: 'P2-P3', azimute: '0°00\'00"', distancia: '100,000 m' },
    { lado: 'P3-P1', azimute: '225°00\'00"', distancia: '141,421 m' },
  ],
  area: {
    m2: '10.000,00 m²',
    ha: '1,0000 ha',
    alqueires: '0,2066 alq. (norte/MA)',
    perimetro: '341,421 m',
  },
  metodologia: [
    'PLANEJAMENTO E RECONHECIMENTO DE CAMPO — vistoria preliminar do imóvel para identificação dos limites, confrontantes e melhor estratégia de implantação dos marcos.',
    'MATERIALIZAÇÃO DOS VÉRTICES — implantação física dos marcos (piquetes) em todos os vértices da poligonal, com identificação sequencial (P1, P2, …) e registro fotográfico individual de cada vértice no local.',
    'RASTREAMENTO GNSS EM MODO RTK — coleta das coordenadas geodésicas de cada vértice por meio de receptor GNSS de dupla frequência operando em modo Real-Time Kinematic (RTK), com tempo mínimo de fixação até obtenção de solução fixa centimétrica. Sistema geodésico de referência: SIRGAS 2000 (oficial Brasil — IBGE/INCRA), projeção UTM, zona 23 Sul, meridiano central -45°.',
    'CAMINHAMENTO DA POLIGONAL — coleta sequencial dos vértices percorrendo o perímetro do imóvel no sentido horário, com fechamento angular e linear sobre o vértice inicial (P1) para verificação de consistência.',
    'PROCESSAMENTO E DESENHO TÉCNICO — pós-processamento dos dados brutos em escritório utilizando os softwares Topcon Tools e MetricaTOPO, geração da poligonal final, cálculo de área pelo método de Gauss (Shoelace), perímetro pelo somatório das distâncias planas e azimutes calculados segmento a segmento em DMS (graus, minutos e segundos).',
    'EMISSÃO DAS PEÇAS TÉCNICAS — produção do memorial descritivo conforme Norma Técnica de Georreferenciamento (NTGIR/INCRA), planilha de coordenadas, croqui georreferenciado e o presente laudo técnico.',
  ],
  equipamentos: {
    base: 'Receptor GNSS RTK S6 ComNAV — estação de referência fixa montada sobre tripé com base niveladora.',
    rover: 'Receptor GNSS RTK T30 Laser Plus (SinoGNSS) — receptor móvel multibanda com rastreio simultâneo das constelações ativas (GPS, BeiDou, GLONASS, Galileo).',
    coletor: 'Coletor de dados R60 (SinoGNSS) — controlador robusto e ergonômico para o levantamento topográfico em campo.',
    acessorios: 'Tripé robusto para a base, bastão telescópico de 2 m para o rover, bipé estabilizador, base niveladora ótica, trena de aferição.',
    software: 'Topcon Tools + MetricaTOPO.',
  },
  memorialTexto:
    'Inicia-se a descrição deste perímetro no vértice P1, definido pelas coordenadas ' +
    'N=9.500.000,000 m e E=200.000,000 m; deste segue com azimute de 90°13\'52" e ' +
    'distância de 100,00 m, até atingir o vértice P2, fechando o perímetro no vértice ' +
    'P1 (ponto inicial), totalizando uma área de 1,0000 ha.',
  pagamento: {
    titular: 'ROMATEC CONSULTORIA',
    documento: '12.345.678/0001-90',
    pix: 'romateccrm@gmail.com',
    banco: 'Nubank',
    agencia: '0001',
    conta: '123456-7',
    valorFormatado: 'R$ 3.000,00',
    brCode:
      '00020126360014BR.GOV.BCB.PIX0114romateccrm@gmail5204000053039865802BR5919ROMATEC CONSULTORIA6009ACAILANDIA62070503***6304ABCD',
    qrDataUrl: 'data:image/png;base64,QRPIX',
  },
  fotos: [
    { dataUri: 'data:image/jpeg;base64,FOTO1', legenda: 'Vértice P1 — marco de concreto implantado.' },
    { dataUri: 'data:image/jpeg;base64,FOTO2', legenda: 'Vértice P2 — vista geral da poligonal.' },
  ],
  croquiSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#0B6E4F"/></svg>',
  art: 'ART-12345',
  trt: 'TRT-67890',
  hashValidacao: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  urlVerificacao: 'https://romatec.example/v/laudo/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  tecnico: {
    nome: 'José Romário Pinto Bezerra',
    cargo: 'Técnico em Agrimensura · Avaliador CNAI',
    credenciais: ['CFT/MA 01209185369', 'CNAI 031161', 'CRECI/MA 4.705', 'INCRA: FQNS'],
    empresa: 'Romatec Consultoria Total',
    municipio: 'Açailândia/MA',
  },
};

/** So o essencial — valida que o builder nao quebra sem croqui/art/trt. */
export const dadosMinimosLaudo: LaudoDados = {
  numero: 'LAUDO-MIN-001',
  dataEmissao: '03 de junho de 2026',
  tipoImovel: 'URBANO',
  finalidade: 'Demarcação de lote urbano.',
  contratante: { nome: 'Fulano', cpfCnpj: '—' },
  imovel: {},
  vertices: [],
  lados: [],
  area: { m2: '—' },
  metodologia: [],
  equipamentos: { base: '—', rover: '—', coletor: '—', acessorios: '—', software: '—' },
  memorialTexto: '',
  fotos: [],
  hashValidacao: 'deadbeef',
  urlVerificacao: 'https://romatec.example/v/laudo/deadbeef',
  tecnico: {
    nome: 'José Romário',
    cargo: 'Técnico',
    credenciais: [],
    empresa: 'Romatec',
    municipio: 'Açailândia/MA',
  },
};
