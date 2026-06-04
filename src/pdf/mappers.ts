// v1.99.16 — Mappers DB → shape limpo dos templates Prime.
//
// Convertem as estruturas internas do ZAYRA (Recibo, retorno de
// buscarPropostaConsultoria) para PropostaDados / ReciboDados consumidos pelos
// geradores Prime. Sao funcoes PURAS (sem I/O) — usam apenas `import type` das
// estruturas existentes, sem arrastar DB/pdfkit em runtime.

import type { Recibo, StatusRecibo } from '../integrations/recibos';
import type { CustosCalculados, ItemCusto } from '../services/pricing/types';
import type { Laudo, PontoLaudo, LadoLaudo } from '../integrations/laudos';
import type { Contratante } from '../integrations/contratantes';
import type { Executante } from '../integrations/executantes';
import {
  type PropostaDados,
  type ReciboDados,
  type PropostaServicoItem,
  type PropostaTecnico,
  type ReciboTecnico,
  type LaudoDados,
  type LaudoTecnico,
  type LaudoVertice,
  type LaudoLado,
} from '../types/templateTypes';
import { valorPorExtenso } from './sharedHtml';

// ── Constantes da identidade tecnica Romatec ────────────────────────────────
export const TECNICO_ROMATEC_PROPOSTA: PropostaTecnico = {
  nome: 'Jose Romario Pinto Bezerra',
  cargo: 'Tecnico em Agrimensura · Avaliador CNAI',
  credenciais: [
    'CFT/MA n. 01209185369 (INCRA: FQNS)',
    'CNAI 031161',
    'CRECI/MA 4.705',
  ],
  empresa: 'Romatec Consultoria Total',
  municipio: 'Acailandia/MA',
};

export const TECNICO_ROMATEC_RECIBO: ReciboTecnico = {
  nome: TECNICO_ROMATEC_PROPOSTA.nome,
  cargo: TECNICO_ROMATEC_PROPOSTA.cargo,
  credenciais: TECNICO_ROMATEC_PROPOSTA.credenciais,
};

export const TECNICO_ROMATEC_LAUDO: LaudoTecnico = {
  nome: 'José Romário Pinto Bezerra',
  cargo: 'Técnico em Agrimensura · Avaliador CNAI',
  credenciais: ['CFT/MA 01209185369', 'CNAI 031161', 'CRECI/MA 4.705', 'INCRA: FQNS'],
  empresa: 'Romatec Consultoria Total',
  municipio: 'Açailândia/MA',
};

const SUBTIPO_LABEL: Record<string, string> = {
  averbacao_residencial: 'Averbacao Residencial',
  averbacao_comercial: 'Averbacao Comercial',
  georreferenciamento_rural: 'Georreferenciamento de Imovel Rural',
  desmembramento: 'Desmembramento',
  remembramento: 'Remembramento',
  retificacao_area: 'Retificacao de Area',
  avaliacao_ptam: 'Avaliacao de Imoveis (PTAM)',
  projeto_executivo: 'Projeto Executivo',
  demarcacao_urbana: 'Demarcacao de Lote Urbano',
  demarcacao_rural: 'Demarcacao de Imovel Rural',
};

const STATUS_RECIBO_LABEL: Record<StatusRecibo, string> = {
  rascunho: 'Rascunho',
  aguardando_envio: 'Aguardando envio',
  enviado: 'Enviado',
  entregue: 'Entregue',
  lido: 'Lido',
  respondido: 'Respondido',
  confirmado: 'Confirmado',
  contestado: 'Contestado',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
};

// ── Formatadores de data ────────────────────────────────────────────────────
const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Normaliza para Date sem drift de fuso: strings "YYYY-MM-DD" sao tratadas como
 * data local (e nao UTC), evitando recuo de 1 dia em fusos negativos.
 */
function parseData(d: Date | string): Date | null {
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

/** Date|string|null → "02 de junho de 2025" (pt-BR por extenso). */
export function fmtDataExtenso(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = parseData(d);
  if (!dt) return String(d);
  return `${String(dt.getDate()).padStart(2, '0')} de ${MESES[dt.getMonth()]} de ${dt.getFullYear()}`;
}

/** Date|string|null → "dd/mm/aaaa". */
export function fmtDataCurta(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = parseData(d);
  if (!dt) return String(d);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

// ── Mapper: Recibo → ReciboDados ────────────────────────────────────────────
/**
 * Converte um Recibo do banco em ReciboDados para os templates Prime.
 * @param recibo registro de recibo (ja mapeado por integrations/recibos.mapRow)
 * @param baseUrl base publica para a URL de validacao (ex: getBaseUrl())
 * @param tecnico identidade tecnica (default: Romatec)
 */
export function reciboToReciboDados(
  recibo: Recibo,
  baseUrl: string,
  tecnico: ReciboTecnico = TECNICO_ROMATEC_RECIBO,
): ReciboDados {
  const valor = recibo.valor ?? 0;
  const base = baseUrl.replace(/\/$/, '');
  return {
    numero: recibo.numero,
    dataEmissao: fmtDataExtenso(recibo.enviado_em ?? recibo.created_at),
    hashValidacao: recibo.hash_validacao,
    urlVerificacao: `${base}/v/${recibo.hash_validacao}`,
    status: STATUS_RECIBO_LABEL[recibo.status] ?? recibo.status,
    confirmado: recibo.status === 'confirmado',
    cliente: {
      nome: recibo.destinatario_nome,
      cpfCnpj: recibo.destinatario_doc ?? '—',
    },
    servico: recibo.descricao_servico ?? recibo.categoria_servico ?? 'Servico Romatec',
    valorTotal: valor,
    valorTotalExtenso: valorPorExtenso(valor),
    tecnico,
    observacoes: recibo.resposta_obs ?? undefined,
  };
}

// ── Mapper: Proposta Consultoria → PropostaDados ────────────────────────────
/** Subconjunto do retorno de buscarPropostaConsultoria que o mapper consome. */
export interface PropostaConsultoriaView {
  numero: string;
  subtipo?: string | null;
  cliente: {
    nome?: string | null;
    cpf_cnpj?: string | null;
    endereco?: string | null;
    cidade?: string | null;
    estado?: string | null;
  };
  endereco_imovel?: string | null;
  data_proposta?: Date | string | null;
  validade_dias?: number | null;
  valor_total: number;
  observacoes?: string | null;
  gestor_nome?: string | null;
  gestor_cargo?: string | null;
  dados_imovel?: Record<string, unknown> | null;
  custos_calculados?: CustosCalculados | null;
}

function itemCustoToServico(i: ItemCusto): PropostaServicoItem {
  return {
    descricao: i.descricao,
    valor: i.pendente ? null : i.valor,
  };
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/**
 * Converte o retorno de buscarPropostaConsultoria em PropostaDados (Prime).
 */
export function propostaConsultoriaToPropostaDados(
  p: PropostaConsultoriaView,
  tecnico: PropostaTecnico = TECNICO_ROMATEC_PROPOSTA,
): PropostaDados {
  const custos = p.custos_calculados ?? null;
  const subtipo = p.subtipo ?? '';
  const di = (p.dados_imovel ?? {}) as Record<string, unknown>;

  // Servicos = honorarios Romatec + custos de terceiros (taxas).
  const servicos: PropostaServicoItem[] = [];
  if (custos?.secao_3_honorarios?.length) {
    servicos.push(...custos.secao_3_honorarios.map(itemCustoToServico));
  }
  if (custos?.secao_2_taxas?.length) {
    servicos.push(...custos.secao_2_taxas.map(itemCustoToServico));
  }

  // Total do documento (várias fontes possíveis, na ordem de confiança).
  const valorTotal = Number(
    p.valor_total ?? custos?.secao_5_total ?? custos?.honorarios_romatec?.total ?? 0,
  );

  // Parcelas a partir das condicoes de pagamento.
  // v1.99.15 GUARD (mesmo espírito da v3.23.8/v3.24.16 do POST/PUT): se alguma
  // parcela vier com valor 0/inválido e houver total > 0, recomputa o valor —
  // por percentual extraído do rótulo/descrição quando possível, senão em
  // partes iguais. Também protege o toLocaleString contra valor undefined
  // (que antes virava "R$ 0,00" silenciosamente ou lançava TypeError).
  const fmtMoeda = (v: number) =>
    (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const cps = custos?.condicoes_pagamento ?? [];
  const algumZero = cps.some((cp) => !Number.isFinite(Number(cp.valor)) || Number(cp.valor) === 0);
  const precisaRecompor = algumZero && valorTotal > 0 && cps.length > 0;
  const parcelas = cps.map((c) => {
    let valor = Number(c.valor);
    if (precisaRecompor && (!Number.isFinite(valor) || valor === 0)) {
      const m = /(\d{1,3})\s*%/.exec(`${c.rotulo} ${c.descricao}`);
      valor = m ? (valorTotal * Number(m[1])) / 100 : valorTotal / cps.length;
    }
    return {
      label: c.rotulo,
      descricao: `${c.descricao} — ${fmtMoeda(valor)}`,
    };
  });

  // Etapas (metodologia) derivadas do escopo (secao_1_projetos).
  const etapas = (custos?.secao_1_projetos ?? []).map((titulo, idx) => ({
    numero: String(idx + 1).padStart(2, '0'),
    titulo: titulo.length > 60 ? `${titulo.slice(0, 57)}...` : titulo,
    texto: titulo,
  }));

  const enderecoCliente =
    str(p.cliente.endereco) ||
    [str(p.cliente.cidade), str(p.cliente.estado)].filter(Boolean).join(' / ') ||
    undefined;

  return {
    numero: p.numero,
    dataEmissao: fmtDataExtenso(p.data_proposta),
    validade: `${p.validade_dias ?? 30} dias`,
    tipoServico: SUBTIPO_LABEL[subtipo] || 'Servico Tecnico de Consultoria',
    cliente: {
      nome: str(p.cliente.nome) ?? 'Contratante',
      cpfCnpj: str(p.cliente.cpf_cnpj) ?? '—',
      endereco: enderecoCliente,
    },
    imovel: {
      nome: str(di.nome) ?? str(di.denominacao) ?? str(di.imovel),
      municipio: str(di.municipio) ?? str(p.cliente.cidade) ?? str(p.endereco_imovel),
      uf: str(di.uf) ?? str(di.estado) ?? str(p.cliente.estado),
      areaHa: str(di.area_ha) ?? str(di.area) ?? str(di.areaHa),
      matricula: str(di.matricula),
    },
    servicos,
    valorTotal,
    valorTotalExtenso: valorPorExtenso(valorTotal),
    parcelas,
    etapas,
    prazos: [
      { valor: String(p.validade_dias ?? 30), unidade: 'Dias', descricao: 'Validade da proposta' },
    ],
    drlIncluida: subtipo === 'georreferenciamento_rural',
    observacoes: str(p.observacoes),
    tecnico: {
      ...tecnico,
      nome: str(p.gestor_nome) ?? tecnico.nome,
      cargo: str(p.gestor_cargo) ?? tecnico.cargo,
    },
  };
}

// ── Mapper: Laudo (+ entidades) → LaudoDados ────────────────────────────────

/** Texto padrao da finalidade quando o laudo nao tem campo proprio. */
const FINALIDADE_PADRAO_LAUDO =
  'Demarcação e materialização de vértices da poligonal do imóvel para fins de ' +
  'regularização fundiária, conforme NBR 13133 e sistemática INCRA/NTGIR.';

/** Formata um numero em pt-BR com `casas` decimais; null/invalido → '—'. */
function fmtNum(v: number | null | undefined, casas: number): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/** Formata o azimute do lado (graus decimais) em pt-BR; aceita string crua. */
function fmtAzimute(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}°`;
}

/**
 * Converte um Laudo + entidades relacionadas em LaudoDados para os templates Prime.
 * @param laudo registro do laudo (integrations/laudos.buscarLaudo)
 * @param contratante contratante associado (pode ser null → fallback '—')
 * @param executante responsavel tecnico (pode ser null → fallback Romatec)
 * @param pontos vertices do laudo
 * @param lados lados calculados
 * @param baseUrl base publica para a URL de verificacao (ex: getBaseUrl())
 * @param croquiSvg SVG do croqui ja gerado (opcional)
 */
export function laudoToLaudoDados(
  laudo: Laudo,
  contratante: Contratante | null,
  executante: Executante | null,
  pontos: PontoLaudo[],
  lados: LadoLaudo[],
  baseUrl: string,
  croquiSvg?: string,
): LaudoDados {
  const base = baseUrl.replace(/\/$/, '');
  const isRural = laudo.tipo_imovel === 'RURAL';

  // Vertices
  const vertices: LaudoVertice[] = pontos.map((p) => ({
    ordem: p.ordem,
    rotulo: p.rotulo,
    tipoMarco: p.descricao_marco ?? undefined,
    utmE: p.utm_e != null ? fmtNum(p.utm_e, 3) : '—',
    utmN: p.utm_n != null ? fmtNum(p.utm_n, 3) : '—',
    lat: p.lat_gms ?? (p.lat_decimal != null ? fmtNum(p.lat_decimal, 6) : undefined),
    long: p.long_gms ?? (p.long_decimal != null ? fmtNum(p.long_decimal, 6) : undefined),
  }));

  // Lados
  const ladosDados: LaudoLado[] = lados.map((l) => {
    const dist = l.medida_manual_m ?? l.distancia_m;
    return {
      lado: l.rotulo ?? `L${l.ordem}`,
      azimute: fmtAzimute(l.azimute),
      distancia: dist != null ? `${fmtNum(dist, 3)} m` : '—',
    };
  });

  // Area + conversoes. Alqueire do norte/MA (Maranhao) = 4,84 ha.
  const ALQUEIRE_NORTE_HA = 4.84;
  const areaM2 = laudo.area_total_m2;
  const haNum = areaM2 != null ? areaM2 / 10000 : null;
  const area = {
    m2: areaM2 != null ? `${fmtNum(areaM2, 2)} m²` : '—',
    ha: isRural && haNum != null ? `${fmtNum(haNum, 4)} ha` : undefined,
    alqueires:
      isRural && haNum != null
        ? `${fmtNum(haNum / ALQUEIRE_NORTE_HA, 4)} alq. (norte/MA)`
        : undefined,
    perimetro: laudo.perimetro_m != null ? `${fmtNum(laudo.perimetro_m, 3)} m` : undefined,
  };

  // Localizacao do imovel (logradouro/municipio compostos)
  const localizacao =
    [laudo.endereco_imovel, laudo.municipio, laudo.uf_imovel]
      .map((s) => (s ? String(s).trim() : ''))
      .filter(Boolean)
      .join(' · ') || undefined;

  // Tecnico: monta a partir do executante, com fallback Romatec quando faltar.
  const credenciaisExec = [
    executante?.registro_cft ? `CFT/MA ${executante.registro_cft}` : null,
    executante?.registro_crea ? `CREA ${executante.registro_crea}` : null,
    executante?.cadastro_incra ? `INCRA: ${executante.cadastro_incra}` : null,
  ].filter((c): c is string => Boolean(c));
  const tecnico: LaudoTecnico = {
    nome: executante?.nome?.trim() || TECNICO_ROMATEC_LAUDO.nome,
    cargo: executante?.qualificacao?.trim() || TECNICO_ROMATEC_LAUDO.cargo,
    credenciais: credenciaisExec.length ? credenciaisExec : TECNICO_ROMATEC_LAUDO.credenciais,
    empresa: TECNICO_ROMATEC_LAUDO.empresa,
    municipio: TECNICO_ROMATEC_LAUDO.municipio,
  };

  const hash = laudo.hash_validacao ?? '';

  return {
    numero: laudo.numero_laudo,
    dataEmissao: fmtDataExtenso(laudo.assinado_em ?? laudo.created_at ?? new Date()),
    tipoImovel: laudo.tipo_imovel,
    finalidade: FINALIDADE_PADRAO_LAUDO,
    contratante: {
      nome: contratante?.nome?.trim() || '—',
      cpfCnpj: contratante?.cpf_cnpj?.trim() || '—',
      telefone: contratante?.telefone ?? undefined,
      email: contratante?.email ?? undefined,
    },
    imovel: {
      denominacao: laudo.denominacao_imovel ?? undefined,
      matricula: laudo.matricula ?? undefined,
      municipio: laudo.municipio ?? undefined,
      uf: laudo.uf_imovel ?? undefined,
      localizacao,
    },
    vertices,
    lados: ladosDados,
    area,
    croquiSvg,
    art: laudo.usa_art ? laudo.numero_art ?? undefined : undefined,
    trt: laudo.usa_trt ? laudo.numero_trt ?? undefined : undefined,
    hashValidacao: hash,
    urlVerificacao: `${base}/v/laudo/${hash}`,
    tecnico,
  };
}
