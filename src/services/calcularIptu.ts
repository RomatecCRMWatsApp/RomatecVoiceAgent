// v1.51.0 — Estimativa de IPTU (Imposto Predial e Territorial Urbano).
//
// Base: IPTU é tributo municipal anual (CF art. 156-I) sobre imóveis urbanos.
// Cada cidade tem código tributário próprio definindo:
// - Alíquotas (variam por tipo: predial/territorial e por uso: residencial/comercial)
// - Base de cálculo (valor venal apurado pela Prefeitura — quase sempre menor
//   que o valor de mercado)
// - Descontos (pagamento à vista, edificado, idoso, primeira residência)
// - Progressividade (algumas cidades aumentam pra terreno baldio)
//
// LIMITE DESSA TOOL: é uma ESTIMATIVA. O valor exato só sai do carnê emitido
// pela Prefeitura — porque ela usa Planta Genérica de Valores (PGV) com
// coeficientes de localização, idade da edificação, padrão construtivo, etc.

export type IptuTipo  = 'predial_residencial' | 'predial_comercial' | 'territorial';

interface MunicipioIptu {
  nome:                 string;
  uf:                   string;
  aliquotas:            Record<IptuTipo, number>;
  desconto_avista_pct?: number;
  fonte_legal:          string;
  validado:             boolean;
  observacoes?:         string;
}

// Tabela de alíquotas IPTU. Açailândia/MA tem valores plausíveis pra interior
// do MA mas NÃO foi validada lei a lei — marcar validado:false e avisar Chefe.
const MUNICIPIOS: Record<string, MunicipioIptu> = {
  'acailandia-ma': {
    nome: 'Açailândia', uf: 'MA',
    aliquotas: {
      predial_residencial: 0.005,  // 0,5%
      predial_comercial:   0.01,   // 1,0%
      territorial:         0.015,  // 1,5% (terreno baldio paga mais)
    },
    desconto_avista_pct: 0.10, // 10% pagamento à vista (típico)
    fonte_legal: 'Estimativa baseada em padrão MA — confirmar com Código Tributário Municipal de Açailândia',
    validado:    false,
    observacoes: 'Alíquotas não validadas com lei municipal específica. Use como ESTIMATIVA. O carnê oficial pode variar 20-40% devido a coeficientes da PGV (Planta Genérica de Valores).',
  },
};

const FALLBACK: MunicipioIptu = {
  nome: '', uf: '',
  aliquotas: {
    predial_residencial: 0.005,
    predial_comercial:   0.01,
    territorial:         0.015,
  },
  desconto_avista_pct: 0.10,
  fonte_legal: 'Padrão Brasil interior',
  validado:    false,
};

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface IptuInput {
  valor_venal:        number;     // base de cálculo (Prefeitura)
  municipio:          string;
  uf?:                string;
  tipo?:              IptuTipo;   // default: predial_residencial
  imovel_rural?:      boolean;
  ano?:               number;     // só pra exibir
}

export interface IptuOutput {
  ano:                number;
  valor_iptu_anual:   number;
  valor_iptu_avista:  number;
  desconto_avista:    number;
  parcelas_estimadas: { qtd: number; valor: number }[];
  base_calculo:       number;
  aliquota:           number;
  aliquota_pct:       string;
  tipo:               IptuTipo;
  municipio:          string;
  uf:                 string;
  fonte_legal:        string;
  validado:           boolean;
  observacoes:        string[];
}

export function calcularIptu(input: IptuInput): IptuOutput {
  const observacoes: string[] = [];

  if (!input.municipio?.trim()) throw new Error('municipio é obrigatório.');
  if (input.valor_venal == null || input.valor_venal <= 0) {
    throw new Error('valor_venal deve ser > 0.');
  }

  if (input.imovel_rural) {
    observacoes.push(
      '⚠️ Imóvel rural NÃO paga IPTU (que é municipal urbano). Paga ITR (Imposto Territorial Rural, federal — Lei 9.393/96).',
    );
    return {
      ano:                input.ano ?? new Date().getFullYear(),
      valor_iptu_anual:   0,
      valor_iptu_avista:  0,
      desconto_avista:    0,
      parcelas_estimadas: [],
      base_calculo:       Number(input.valor_venal),
      aliquota:           0,
      aliquota_pct:       '0%',
      tipo:               input.tipo ?? 'predial_residencial',
      municipio:          input.municipio,
      uf:                 input.uf ?? '',
      fonte_legal:        'CF art. 156-I — IPTU é só urbano',
      validado:           true,
      observacoes,
    };
  }

  const tipo = input.tipo ?? 'predial_residencial';
  const slug      = slugify(input.municipio + '-' + (input.uf ?? ''));
  const slugSemUf = slugify(input.municipio);
  const m = MUNICIPIOS[slug] ?? MUNICIPIOS[slugSemUf + '-ma'] ?? FALLBACK;

  if (!m.validado) {
    observacoes.push(
      `⚠️ ESTIMATIVA — alíquotas de "${input.municipio}/${input.uf ?? '?'}" não foram validadas com a lei municipal específica. Valor real pode variar ±30% devido aos coeficientes da Planta Genérica de Valores (PGV) usados pela Prefeitura.`,
    );
  }

  const aliquota = m.aliquotas[tipo];
  const base     = Number(input.valor_venal);
  const anual    = base * aliquota;

  const desconto = m.desconto_avista_pct ?? 0;
  const aVista   = anual * (1 - desconto);

  // Parcelamento típico: 10x sem desconto
  const parcelas = [
    { qtd: 1,  valor: round(aVista) },
    { qtd: 5,  valor: round(anual / 5) },
    { qtd: 10, valor: round(anual / 10) },
  ];

  if (tipo === 'territorial') {
    observacoes.push(
      'Imóvel territorial (terreno sem edificação) costuma pagar alíquota maior — Açailândia segue esse padrão. Edificar reduz a alíquota.',
    );
  }
  observacoes.push(
    `Lembrete: a Prefeitura aplica coeficientes (idade, localização, padrão) sobre o valor venal de cadastro. Valor exato vem só no carnê emitido em ${input.ano ?? new Date().getFullYear()}.`,
  );

  return {
    ano:                input.ano ?? new Date().getFullYear(),
    valor_iptu_anual:   round(anual),
    valor_iptu_avista:  round(aVista),
    desconto_avista:    round(anual - aVista),
    parcelas_estimadas: parcelas,
    base_calculo:       base,
    aliquota,
    aliquota_pct:       (aliquota * 100).toFixed(2) + '%',
    tipo,
    municipio:          m.nome || input.municipio,
    uf:                 m.uf   || input.uf || '',
    fonte_legal:        m.fonte_legal,
    validado:           m.validado,
    observacoes,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function listarMunicipiosIptu(): MunicipioIptu[] {
  return Object.values(MUNICIPIOS);
}
