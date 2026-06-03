// v1.99.16 — Mappers DB → shape limpo dos templates Prime.
//
// Convertem as estruturas internas do ZAYRA (Recibo, retorno de
// buscarPropostaConsultoria) para PropostaDados / ReciboDados consumidos pelos
// geradores Prime. Sao funcoes PURAS (sem I/O) — usam apenas `import type` das
// estruturas existentes, sem arrastar DB/pdfkit em runtime.

import type { Recibo, StatusRecibo } from '../integrations/recibos';
import type { CustosCalculados, ItemCusto } from '../services/pricing/types';
import {
  type PropostaDados,
  type ReciboDados,
  type PropostaServicoItem,
  type PropostaTecnico,
  type ReciboTecnico,
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

  // Parcelas a partir das condicoes de pagamento.
  const parcelas = (custos?.condicoes_pagamento ?? []).map((c) => ({
    label: c.rotulo,
    descricao: `${c.descricao} — ${c.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
  }));

  // Etapas (metodologia) derivadas do escopo (secao_1_projetos).
  const etapas = (custos?.secao_1_projetos ?? []).map((titulo, idx) => ({
    numero: String(idx + 1).padStart(2, '0'),
    titulo: titulo.length > 60 ? `${titulo.slice(0, 57)}...` : titulo,
    texto: titulo,
  }));

  const valorTotal = Number(p.valor_total ?? custos?.secao_5_total ?? 0);

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
