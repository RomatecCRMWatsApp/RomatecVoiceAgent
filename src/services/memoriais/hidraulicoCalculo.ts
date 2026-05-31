// v3.49.2: Motor de calculo NBR 5626:2020 (Sistema Predial de Agua Fria) —
// modulo "Memoriais & Quantitativos", expansao do wizard hidraulico.
//
// Modulo NOVO, complementar ao hidraulicoCalc.ts (v3.35). Nao substitui o
// legado: aqui a API trabalha com DadosUso (per-capita / complementares /
// reserva tecnica editaveis pelo usuario no Passo 3) e adiciona verificacao
// de pressao (Fair-Whipple-Hsiao), tabela de aquisicao de tubos e o
// orquestrador calcularResumo (Passo 5).
//
// Decisao de projeto (RT Jose Romario / Romatec):
//   - Reservatorio: V = 2 x consumo diario, arredondado p/ cima em multiplos
//     de 250 L (pratica BR de reserva ~2 dias). Consistente com o motor v3.35.
//
// Standalone — sem deps de mysql/pdfkit. Todas as funcoes sao puras.

// ─────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────

export interface DadosUso {
  tipoUso: 'residencial' | 'comercial';
  nUsuarios: number;
  perCapita: number; // L/dia (padrao: 150 residencial)
  complementares: {
    lavagemRoupa: number; // L/dia (padrao: 120)
    limpezaExterna: number; // L/dia (padrao: 80)
  };
  reservaTecnicaPercent: number; // padrao: 10
  cotaFundoM?: number; // NA minimo do reservatorio acima do piso (m)
}

export interface DadosObra {
  titulo: string;
  endereco: string;
  municipio: string;
  uf: string;
  proprietario: string;
  cpfCnpj: string;
  areaM2: number;
  areaLoteM2?: number;
  nPavimentos: number;
  prancha: string;
  trtNumero?: string;
}

export interface AparelhoSanitario {
  tipo: string;
  qtd: number;
}

export interface TuboInput {
  dn_mm: number;
  comprimento_m: number;
}

export interface TrechoCalculo {
  descricao: string;
  somaPesos: number;
  vazao_ls: number;
  dn_mm: number;
  dInt_mm: number;
  velocidade_ms: number;
  status: 'OK' | 'ALERTA' | 'REPROVADO';
}

export interface PontoPressao {
  descricao: string;
  alturaEstatica_mca: number;
  perdaCarga_mca: number;
  pressaoDinamica_kPa: number;
  minNBR_kPa: number;
  status: 'OK' | 'REPROVADO';
}

export interface LinhaAquisicao {
  dn_mm: number;
  qtd_liquida_m: number;
  qtd_com_perda_m: number;
  barras_6m: number;
  total_adquirir_m: number;
}

export interface StatusNormativo {
  pressaoDinamicaOK: boolean;
  pressaoEstaticaOK: boolean;
  velocidadeOK: boolean;
  reservatorioOK: boolean;
  registrosOK: boolean;
}

export interface ResultadoCalculo {
  dadosObra: DadosObra;
  dadosUso: DadosUso;
  consumoDiario: number;
  volumeReservatorio: number;
  somaPesos: number;
  vazaoTotal_ls: number;
  vazaoTotal_m3h: number;
  aparelhos: Array<{ tipo: string; qtd: number; peso_unit: number; peso_total: number }>;
  trechos: TrechoCalculo[];
  pontosPressao: PontoPressao[];
  aquisicaoTubos: LinhaAquisicao[];
  totalTubos_m: number;
  totalTubosComPerda_m: number;
  totalConexoes: number;
  totalRegistros: number;
  totalInsumos: number;
  totalAparelhos: number;
  statusNormativo: StatusNormativo;
  alertas: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Constantes normativas
// ─────────────────────────────────────────────────────────────────────────

// Pesos relativos — Anexo A NBR 5626:2020 (subset residencial/comercial comum).
export const PESOS_RELATIVOS: Record<string, number> = {
  bacia_caixa_acoplada: 0.3,
  bacia_valvula_descarga: 0.5,
  lavatorio: 0.3,
  chuveiro: 0.4,
  ducha_higienica: 0.1,
  pia_cozinha: 0.7,
  tanque: 0.7,
  maquina_lavar: 1.0,
  torneira_geral: 0.4,
  mictorio_valvula: 0.5,
  banheira: 0.75,
};

// Diametros internos PVC Soldavel Marrom TIGRE Classe A (mm).
export const DIAMETROS_INTERNOS_MM: Record<number, number> = {
  20: 17.0,
  25: 21.6,
  32: 27.8,
  40: 35.2,
  50: 44.0,
};

const GRAVIDADE = 9.81; // kPa por m.c.a.
const VELOCIDADE_MAX_MS = 3.0; // NBR 5626:2020 item 5.3.2
const PRESSAO_ESTATICA_MAX_KPA = 400; // NBR 5626:2020 item 5.2
const PRESSAO_DINAMICA_MIN_KPA = 10; // geral
const RESERVA_MULTIPLO_L = 250;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────
// 2.1 Estimativa de consumo diario
// ─────────────────────────────────────────────────────────────────────────

export function calcularConsumoDiario(dados: DadosUso): number {
  if (!Number.isFinite(dados.nUsuarios) || dados.nUsuarios < 1) {
    throw new Error('nUsuarios deve ser >= 1');
  }
  if (!Number.isFinite(dados.perCapita) || dados.perCapita <= 0) {
    throw new Error('perCapita deve ser > 0');
  }
  const cdMoradores = dados.nUsuarios * dados.perCapita;
  const cdCompl =
    (dados.complementares?.lavagemRoupa ?? 0) +
    (dados.complementares?.limpezaExterna ?? 0);
  const subtotal = cdMoradores + cdCompl;
  const reserva = subtotal * (dados.reservaTecnicaPercent / 100);
  return Math.round(subtotal + reserva);
}

// ─────────────────────────────────────────────────────────────────────────
// 2.2 Dimensionamento do reservatorio (regra RT: 2x consumo, mult. 250 L)
// ─────────────────────────────────────────────────────────────────────────

export function dimensionarReservatorio(consumoDiario: number): number {
  if (!Number.isFinite(consumoDiario) || consumoDiario <= 0) {
    throw new Error('consumoDiario deve ser > 0');
  }
  const vMinimo = consumoDiario * 2;
  return Math.ceil(vMinimo / RESERVA_MULTIPLO_L) * RESERVA_MULTIPLO_L;
}

// ─────────────────────────────────────────────────────────────────────────
// 2.3 Pesos relativos dos aparelhos (Anexo A)
// ─────────────────────────────────────────────────────────────────────────

export function calcularSomaPesos(aparelhos: Array<{ tipo: string; qtd: number }>): number {
  return round2(
    aparelhos.reduce((soma, a) => {
      const peso = PESOS_RELATIVOS[a.tipo] ?? 0.3;
      return soma + peso * a.qtd;
    }, 0),
  );
}

export function detalharPesos(
  aparelhos: Array<{ tipo: string; qtd: number }>,
): Array<{ tipo: string; qtd: number; peso_unit: number; peso_total: number }> {
  return aparelhos
    .filter((a) => a.qtd > 0)
    .map((a) => {
      const peso_unit = PESOS_RELATIVOS[a.tipo] ?? 0.3;
      return { tipo: a.tipo, qtd: a.qtd, peso_unit, peso_total: round2(peso_unit * a.qtd) };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// 2.4 Vazao de projeto — equacao probabilistica NBR 5626 item 5.3.1.2
// ─────────────────────────────────────────────────────────────────────────

export function calcularVazaoProjeto(somaPesos: number): number {
  if (!Number.isFinite(somaPesos) || somaPesos < 0) {
    throw new Error('somaPesos deve ser >= 0');
  }
  return parseFloat((0.3 * Math.sqrt(somaPesos)).toFixed(4));
}

// ─────────────────────────────────────────────────────────────────────────
// 2.5 Dimensionamento de trechos (velocidade)
// ─────────────────────────────────────────────────────────────────────────

export function calcularVelocidade(vazao_ls: number, dInt_mm: number): number {
  if (dInt_mm <= 0) throw new Error('dInt_mm deve ser > 0');
  const area_m2 = Math.PI * Math.pow(dInt_mm / 2000, 2);
  const vazao_m3s = vazao_ls / 1000;
  return parseFloat((vazao_m3s / area_m2).toFixed(4));
}

export function validarVelocidade(v: number): 'OK' | 'ALERTA' | 'REPROVADO' {
  if (v <= 2.5) return 'OK';
  if (v <= VELOCIDADE_MAX_MS) return 'ALERTA';
  return 'REPROVADO';
}

// Escolhe o menor DN da tabela em que v <= 3,0 m/s, dada a vazao do trecho.
export function dimensionarTrecho(descricao: string, somaPesos: number): TrechoCalculo {
  const vazao_ls = calcularVazaoProjeto(somaPesos);
  const dns = Object.keys(DIAMETROS_INTERNOS_MM).map(Number).sort((a, b) => a - b);
  if (vazao_ls <= 0) {
    const dn0 = dns[0];
    return {
      descricao,
      somaPesos,
      vazao_ls,
      dn_mm: dn0,
      dInt_mm: DIAMETROS_INTERNOS_MM[dn0],
      velocidade_ms: 0,
      status: 'OK',
    };
  }
  for (const dn of dns) {
    const dInt = DIAMETROS_INTERNOS_MM[dn];
    const v = calcularVelocidade(vazao_ls, dInt);
    if (v <= VELOCIDADE_MAX_MS) {
      return { descricao, somaPesos, vazao_ls, dn_mm: dn, dInt_mm: dInt, velocidade_ms: v, status: validarVelocidade(v) };
    }
  }
  // Nenhum DN atende — retorna o maior com status REPROVADO.
  const dnMax = dns[dns.length - 1];
  const dIntMax = DIAMETROS_INTERNOS_MM[dnMax];
  const vMax = calcularVelocidade(vazao_ls, dIntMax);
  return { descricao, somaPesos, vazao_ls, dn_mm: dnMax, dInt_mm: dIntMax, velocidade_ms: vMax, status: 'REPROVADO' };
}

// ─────────────────────────────────────────────────────────────────────────
// 2.6 Verificacao de pressao (Fair-Whipple-Hsiao para PVC)
// ─────────────────────────────────────────────────────────────────────────

// Fair-Whipple-Hsiao para PVC liso (NBR 5626 / Macintyre):
//   J = (0,00178 x Q^1.75) / D^4.75  [m/m], com Q em m3/s e D em metros.
// IMPORTANTE: a vazao entra em L/s (padrao do resto do modulo) e e convertida
// internamente p/ m3/s. O coeficiente 0,00178 so e dimensionalmente coerente
// com Q em m3/s — usa-lo com L/s superestima a perda em ~10^9x.
export function perdaCargaFWH(vazao_ls: number, dInt_mm: number, comprimento_m: number): number {
  if (dInt_mm <= 0) throw new Error('dInt_mm deve ser > 0');
  const D = dInt_mm / 1000;          // m
  const Q = vazao_ls / 1000;         // m3/s
  const J = (0.00178 * Math.pow(Q, 1.75)) / Math.pow(D, 4.75); // m/m
  return parseFloat((J * comprimento_m).toFixed(4));
}

// Pd = (dh - hf) x 9,81  [kPa]
export function calcularPressaoDinamica(alturaEstatica_mca: number, perdaCarga_mca: number): number {
  return parseFloat(((alturaEstatica_mca - perdaCarga_mca) * GRAVIDADE).toFixed(1));
}

export function calcularPressaoEstatica(alturaEstatica_mca: number): number {
  return parseFloat((alturaEstatica_mca * GRAVIDADE).toFixed(1));
}

export function validarPressao(pd_kPa: number, minNBR_kPa: number): 'OK' | 'REPROVADO' {
  return pd_kPa >= minNBR_kPa ? 'OK' : 'REPROVADO';
}

// ─────────────────────────────────────────────────────────────────────────
// 2.7 Tabela de barras para aquisicao (10% perda, barras de 6 m)
// ─────────────────────────────────────────────────────────────────────────

export function calcularAquisicaoTubos(
  tubos: Array<{ dn_mm: number; comprimento_m: number }>,
): LinhaAquisicao[] {
  return tubos.map((t) => {
    const comPerda = t.comprimento_m * 1.1;
    const barras = Math.ceil(comPerda / 6);
    return {
      dn_mm: t.dn_mm,
      qtd_liquida_m: parseFloat(t.comprimento_m.toFixed(2)),
      qtd_com_perda_m: parseFloat(comPerda.toFixed(2)),
      barras_6m: barras,
      total_adquirir_m: barras * 6,
    };
  });
}

// Insumos de instalacao (Grupo 6 do quantitativo) — proporcionais.
export function calcularInsumos(args: {
  totalConexoes: number;
  totalTubos_m: number;
  totalRegistros: number;
}): Array<{ descricao: string; unidade: string; qtd: number }> {
  const { totalConexoes, totalTubos_m, totalRegistros } = args;
  return [
    { descricao: 'Adesivo plastico PVC 175g', unidade: 'un', qtd: Math.max(1, Math.ceil(totalConexoes / 25)) },
    { descricao: 'Solucao limpadora PVC 1.000ml', unidade: 'un', qtd: Math.max(1, Math.ceil(totalTubos_m / 50)) },
    { descricao: 'Fita veda-rosca 18mm x 50m', unidade: 'un', qtd: Math.max(1, Math.ceil(totalRegistros / 3)) },
    { descricao: 'Lixa d agua no 100', unidade: 'un', qtd: Math.max(1, Math.ceil(totalConexoes / 10)) },
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Orquestrador — Passo 5 (Revisao Final)
// ─────────────────────────────────────────────────────────────────────────

export interface EntradaResumo {
  dadosObra: DadosObra;
  dadosUso: DadosUso;
  tubulacoes: TuboInput[];
  conexoes?: Array<{ descricao?: string; dn_mm?: number; qtd: number }>;
  aparelhos?: AparelhoSanitario[];
  registros?: Array<{ descricao: string; dn_mm: number; qtd: number }>;
}

// Conjunto de aparelhos padrao (residencial Nayara Brito) quando o wizard
// nao informa a lista explicitamente.
const APARELHOS_PADRAO: AparelhoSanitario[] = [
  { tipo: 'bacia_caixa_acoplada', qtd: 2 },
  { tipo: 'lavatorio', qtd: 2 },
  { tipo: 'chuveiro', qtd: 1 },
  { tipo: 'ducha_higienica', qtd: 1 },
  { tipo: 'pia_cozinha', qtd: 1 },
  { tipo: 'tanque', qtd: 1 },
  { tipo: 'maquina_lavar', qtd: 1 },
  { tipo: 'torneira_geral', qtd: 1 },
];

export function calcularResumo(entrada: EntradaResumo): ResultadoCalculo {
  const { dadosObra, dadosUso } = entrada;
  const aparelhosLista =
    entrada.aparelhos && entrada.aparelhos.length > 0 ? entrada.aparelhos : APARELHOS_PADRAO;

  // Consumo + reservatorio
  const consumoDiario = calcularConsumoDiario(dadosUso);
  const volumeReservatorio = dimensionarReservatorio(consumoDiario);

  // Pesos + vazao
  const somaPesos = calcularSomaPesos(aparelhosLista);
  const aparelhosDet = detalharPesos(aparelhosLista);
  const vazaoTotal_ls = calcularVazaoProjeto(somaPesos);
  const vazaoTotal_m3h = parseFloat((vazaoTotal_ls * 3.6).toFixed(3));

  // Trechos — barrilete (ΣP total), colunas (50% ΣP), ramais (25% ΣP).
  const trechos: TrechoCalculo[] = [
    dimensionarTrecho('Barrilete (saida do reservatorio)', somaPesos),
    dimensionarTrecho('Coluna de distribuicao AF-1', round2(somaPesos * 0.5)),
    dimensionarTrecho('Ramal de banheiro (social)', round2(somaPesos * 0.25)),
  ];
  const velocidadeOK = trechos.every((t) => t.status !== 'REPROVADO');

  // Ponto critico = aparelho mais desfavoravel (chuveiro), alimentado por
  // ramal DN 20. Modela-se o desnivel ate a saida do chuveiro (~1,6 m do
  // piso) e a perda de carga acumulada (FWH) ao longo do comprimento
  // equivalente do ramal (real + conexoes ~ 8 m). Reproduz o criterio do
  // memorial de referencia (dh=2,40 m, hf~1,15 m -> ~12,3 kPa).
  const cotaFundo = dadosUso.cotaFundoM ?? 4.0;
  const ALTURA_CHUVEIRO_M = 1.6;
  const LEQ_CRITICO_M = 8.0;
  const dInt20 = DIAMETROS_INTERNOS_MM[20];
  const vazaoCritica_ls = calcularVazaoProjeto(PESOS_RELATIVOS.chuveiro);
  const deltaH = parseFloat((cotaFundo - ALTURA_CHUVEIRO_M).toFixed(2));
  const hfCritico = perdaCargaFWH(vazaoCritica_ls, dInt20, LEQ_CRITICO_M);
  const pdCritico = calcularPressaoDinamica(deltaH, hfCritico);
  const peBase = calcularPressaoEstatica(cotaFundo);
  const pontosPressao: PontoPressao[] = [
    {
      descricao: 'Ponto de utilizacao mais desfavoravel (chuveiro/ducha)',
      alturaEstatica_mca: deltaH,
      perdaCarga_mca: hfCritico,
      pressaoDinamica_kPa: pdCritico,
      minNBR_kPa: PRESSAO_DINAMICA_MIN_KPA,
      status: validarPressao(pdCritico, PRESSAO_DINAMICA_MIN_KPA),
    },
    {
      descricao: 'Ponto de base (pressao estatica maxima)',
      alturaEstatica_mca: cotaFundo,
      perdaCarga_mca: 0,
      pressaoDinamica_kPa: peBase,
      minNBR_kPa: PRESSAO_DINAMICA_MIN_KPA,
      status: peBase <= PRESSAO_ESTATICA_MAX_KPA ? 'OK' : 'REPROVADO',
    },
  ];
  const pressaoDinamicaOK = pdCritico >= PRESSAO_DINAMICA_MIN_KPA;
  const pressaoEstaticaOK = peBase <= PRESSAO_ESTATICA_MAX_KPA;

  // Aquisicao de tubos
  const aquisicaoTubos = calcularAquisicaoTubos(entrada.tubulacoes);
  const totalTubos_m = parseFloat(
    entrada.tubulacoes.reduce((s, t) => s + t.comprimento_m, 0).toFixed(2),
  );
  const totalTubosComPerda_m = parseFloat(
    aquisicaoTubos.reduce((s, l) => s + l.total_adquirir_m, 0).toFixed(2),
  );

  // Quantitativos
  const totalConexoes = (entrada.conexoes ?? []).reduce((s, c) => s + (c.qtd || 0), 0);
  // Registros: derivados (1 geral + por area molhada) se nao informado.
  const registros =
    entrada.registros && entrada.registros.length > 0
      ? entrada.registros
      : [
          { descricao: 'Registro de gaveta bruto (geral)', dn_mm: 25, qtd: 1 },
          { descricao: 'Registro de pressao (banheiros)', dn_mm: 20, qtd: 2 },
          { descricao: 'Registro de gaveta (cozinha/area)', dn_mm: 25, qtd: 2 },
        ];
  const totalRegistros = registros.reduce((s, r) => s + r.qtd, 0);
  const totalAparelhos = aparelhosLista.reduce((s, a) => s + a.qtd, 0);

  // Insumos (proporcionais)
  const totalInsumos = calcularInsumos({
    totalConexoes,
    totalTubos_m,
    totalRegistros,
  }).reduce((s, i) => s + i.qtd, 0);

  const reservatorioOK = volumeReservatorio >= consumoDiario;
  const registrosOK = totalRegistros >= 1;

  const alertas: string[] = [];
  trechos.forEach((t) => {
    if (t.status === 'ALERTA') alertas.push(`Velocidade no trecho "${t.descricao}" entre 2,5 e 3,0 m/s (${t.velocidade_ms} m/s).`);
    if (t.status === 'REPROVADO') alertas.push(`Velocidade REPROVADA no trecho "${t.descricao}" (${t.velocidade_ms} m/s > 3,0 m/s).`);
  });
  pontosPressao.forEach((p) => {
    if (p.status === 'REPROVADO') alertas.push(`Pressao REPROVADA em "${p.descricao}".`);
  });

  return {
    dadosObra,
    dadosUso,
    consumoDiario,
    volumeReservatorio,
    somaPesos,
    vazaoTotal_ls,
    vazaoTotal_m3h,
    aparelhos: aparelhosDet,
    trechos,
    pontosPressao,
    aquisicaoTubos,
    totalTubos_m,
    totalTubosComPerda_m,
    totalConexoes,
    totalRegistros,
    totalInsumos,
    totalAparelhos,
    statusNormativo: {
      pressaoDinamicaOK,
      pressaoEstaticaOK,
      velocidadeOK,
      reservatorioOK,
      registrosOK,
    },
    alertas,
  };
}

export const __internals = {
  GRAVIDADE,
  VELOCIDADE_MAX_MS,
  PRESSAO_ESTATICA_MAX_KPA,
  PRESSAO_DINAMICA_MIN_KPA,
  RESERVA_MULTIPLO_L,
  APARELHOS_PADRAO,
};
