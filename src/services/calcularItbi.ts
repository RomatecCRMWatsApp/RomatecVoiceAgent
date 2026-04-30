// v1.50.0 — Calculadora de ITBI (Imposto sobre Transmissão de Bens Imóveis).
//
// Base: ITBI é municipal (Constituição art. 156-II). Cada cidade tem lei própria
// definindo alíquota, base de cálculo e isenções. A tabela abaixo é AUTORITATIVA
// só pra Açailândia/MA — outras cidades aceitamos como entrada mas com aviso.
//
// Fórmula geral: ITBI = max(valor_venda, valor_venal) × alíquota
// SFH primeiro imóvel: alíquota reduzida (varia por município — Açailândia: 0,5%).
// Imóvel rural NÃO paga ITBI — paga ITR (federal). Tool retorna aviso e calcula 0.

export type ItbiTipoOperacao = 'compra_venda' | 'sfh_primeiro_imovel' | 'permuta' | 'doacao';

interface MunicipioItbi {
  nome:                 string;
  uf:                   string;
  aliquota_padrao:      number;  // ex: 0.02 (2%)
  aliquota_sfh:         number;  // ex: 0.005 (0,5%)
  fonte_legal:          string;
  observacoes?:         string;
}

// Tabela municípios — fonte: leis municipais. Açailândia validada, outras
// são fallback razoável e devem ser confirmadas com o municipio antes de
// declarar ITBI.
const MUNICIPIOS_VALIDADOS: Record<string, MunicipioItbi> = {
  // chave = slug minúsculo sem acento
  'acailandia-ma': {
    nome: 'Açailândia', uf: 'MA',
    aliquota_padrao: 0.02,
    aliquota_sfh:    0.005,
    fonte_legal:     'Lei Municipal nº 234/2008',
    observacoes:     'Alíquota reduzida 0,5% pra primeiro imóvel SFH financiado.',
  },
};

// Alíquotas de fallback se cidade não estiver na tabela (média BR).
const FALLBACK = {
  aliquota_padrao: 0.02,
  aliquota_sfh:    0.005,
};

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ItbiInput {
  valor_venda:    number;
  valor_venal?:   number;          // se omitido, usa valor_venda
  municipio:      string;          // ex: "Açailândia"
  uf?:            string;          // ex: "MA"
  tipo_operacao?: ItbiTipoOperacao; // default: compra_venda
  imovel_rural?:  boolean;
}

export interface ItbiOutput {
  valor_itbi:        number;
  base_calculo:      number;
  aliquota:          number;
  aliquota_pct:      string;
  municipio:         string;
  uf:                string;
  fonte_legal:       string;
  tipo_operacao:     ItbiTipoOperacao;
  formula:           string;
  observacoes:       string[];
  validado:          boolean; // true se cidade está na tabela; false se usou fallback
}

export function calcularItbi(input: ItbiInput): ItbiOutput {
  const observacoes: string[] = [];

  if (!input.municipio?.trim()) throw new Error('municipio é obrigatório.');
  if (input.valor_venda == null || input.valor_venda <= 0) {
    throw new Error('valor_venda deve ser > 0.');
  }

  const valorVenda = Number(input.valor_venda);
  const valorVenal = input.valor_venal != null ? Number(input.valor_venal) : valorVenda;
  const tipo = input.tipo_operacao ?? 'compra_venda';

  // Imóvel rural não paga ITBI (paga ITR federal).
  if (input.imovel_rural) {
    observacoes.push(
      '⚠️ Imóvel rural NÃO paga ITBI (que é municipal). Paga ITR (Imposto Territorial Rural, federal — Lei 9.393/96), declarado anualmente à Receita Federal. Use a alíquota progressiva por área e grau de utilização.',
    );
    return {
      valor_itbi:    0,
      base_calculo:  Math.max(valorVenda, valorVenal),
      aliquota:      0,
      aliquota_pct:  '0%',
      municipio:     input.municipio,
      uf:            input.uf ?? '',
      fonte_legal:   'Constituição art. 156, II — ITBI é só urbano',
      tipo_operacao: tipo,
      formula:       'N/A (imóvel rural)',
      observacoes,
      validado:      true,
    };
  }

  // Doação não paga ITBI — paga ITCMD (estadual).
  if (tipo === 'doacao') {
    observacoes.push(
      '⚠️ Doação NÃO paga ITBI. Paga ITCMD (Imposto sobre Transmissão Causa Mortis e Doação, estadual). No MA: alíquota progressiva 1-7%. Confirme valores com a SEFAZ-MA.',
    );
    return {
      valor_itbi:    0,
      base_calculo:  Math.max(valorVenda, valorVenal),
      aliquota:      0,
      aliquota_pct:  '0%',
      municipio:     input.municipio,
      uf:            input.uf ?? '',
      fonte_legal:   'Constituição art. 155, I — ITCMD substitui ITBI em doação',
      tipo_operacao: tipo,
      formula:       'N/A (doação → ITCMD)',
      observacoes,
      validado:      true,
    };
  }

  // Lookup do município
  const slug = slugify(input.municipio + '-' + (input.uf ?? ''));
  const slugSemUf = slugify(input.municipio);
  const m = MUNICIPIOS_VALIDADOS[slug] ?? MUNICIPIOS_VALIDADOS[slugSemUf + '-ma'];
  const validado = !!m;
  if (!validado) {
    observacoes.push(
      `⚠️ Município "${input.municipio}/${input.uf ?? '?'}" NÃO está na tabela validada da ZAYRA. Aplicado fallback (2% padrão / 0,5% SFH) — confirme com a Prefeitura local antes de recolher.`,
    );
  }

  const aliqPadrao = m?.aliquota_padrao ?? FALLBACK.aliquota_padrao;
  const aliqSfh    = m?.aliquota_sfh    ?? FALLBACK.aliquota_sfh;

  const aliquota = tipo === 'sfh_primeiro_imovel' ? aliqSfh : aliqPadrao;
  if (tipo === 'sfh_primeiro_imovel') {
    observacoes.push(
      `Alíquota reduzida ${(aliqSfh * 100).toFixed(2)}% aplicada (1º imóvel financiado pelo SFH). Comprovante: declaração de adquirente + CCB + extrato FGTS se aplicável.`,
    );
  }

  const base = Math.max(valorVenda, valorVenal);
  const valorItbi = base * aliquota;

  if (valorVenal > valorVenda) {
    observacoes.push(
      `Base de cálculo = valor venal (${formatBRL(valorVenal)}) por ser maior que o valor de venda (${formatBRL(valorVenda)}). É como a Prefeitura calcula — você não pode "declarar menos" pra pagar menos ITBI.`,
    );
  }

  return {
    valor_itbi:    Math.round(valorItbi * 100) / 100,
    base_calculo:  base,
    aliquota,
    aliquota_pct:  (aliquota * 100).toFixed(2) + '%',
    municipio:     m?.nome ?? input.municipio,
    uf:            m?.uf ?? input.uf ?? '',
    fonte_legal:   m?.fonte_legal ?? 'Tabela ZAYRA fallback (média BR 2%)',
    tipo_operacao: tipo,
    formula:       `max(${formatBRL(valorVenda)}, ${formatBRL(valorVenal)}) × ${(aliquota * 100).toFixed(2)}% = ${formatBRL(valorItbi)}`,
    observacoes,
    validado,
  };
}

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Tabela pra exibir ao Chefe se ele perguntar "quais cidades você sabe?"
export function listarMunicipiosValidados(): MunicipioItbi[] {
  return Object.values(MUNICIPIOS_VALIDADOS);
}
