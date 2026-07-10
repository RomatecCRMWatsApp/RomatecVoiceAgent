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
import { azimuteParaDMS } from '../services/geometria';

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
    pendente: i.pendente || undefined,
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
  opts?: { assinaturaIcp?: PropostaDados['assinaturaIcp'] }, // v3.93.0
): PropostaDados {
  const custos = p.custos_calculados ?? null;
  const subtipo = p.subtipo ?? '';
  const di = (p.dados_imovel ?? {}) as Record<string, unknown>;
  const validadeDias = p.validade_dias ?? 30;

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

  // v3.91.3: nomenclatura por modalidade — urbano é "Desdobramento" (Lei 6.766/79),
  // rural é "Desmembramento". Antes o Prime mostrava sempre "Desmembramento".
  const modalidadeImovel = String(di.modalidade ?? di.tipo_zona ?? '');
  let tipoServicoLabel = SUBTIPO_LABEL[subtipo] || 'Servico Tecnico de Consultoria';
  if (subtipo === 'desmembramento') {
    tipoServicoLabel = modalidadeImovel === 'urbana'
      ? 'Desdobramento de Lote Urbano'
      : modalidadeImovel === 'rural' ? 'Desmembramento de Imóvel Rural' : 'Desmembramento';
  }

  // v3.93.1 — Seções de paridade com o PDF tradicional (só quando há dado).
  const programaNecessidades = mapProgramaNecessidades(di);
  const horaTecnica =
    subtipo === 'projeto_executivo' ? mapHoraTecnica(di) : undefined;
  const documentos = (custos?.secao_4_checklist ?? []).map((d) => ({
    texto: d.texto,
    imprescindivel: d.imprescindivel || undefined,
    opcional: d.obrigatorio ? undefined : true,
  }));
  const avisos = (custos?.avisos ?? []).filter((a) => str(a));
  const cidadeForo =
    str(di.cidade_obra) ?? str(di.municipio) ?? str(p.cliente.cidade) ?? 'Açailândia';
  const ufForo = str(di.uf_obra) ?? str(di.uf) ?? str(di.estado) ?? str(p.cliente.estado) ?? 'MA';
  const foro =
    `Fica eleito o Foro da Comarca de ${cidadeForo}/${ufForo} para dirimir quaisquer ` +
    `questões oriundas desta proposta, com renúncia expressa a qualquer outro, por mais ` +
    `privilegiado que seja. Esta proposta tem validade de ${validadeDias} ` +
    `(${validadeDias === 1 ? 'um' : String(validadeDias)}) dia(s) a contar da data de emissão.`;

  return {
    numero: p.numero,
    dataEmissao: fmtDataExtenso(p.data_proposta),
    validade: `${validadeDias} dias`,
    tipoServico: tipoServicoLabel,
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
    assinaturaIcp: opts?.assinaturaIcp, // v3.93.0
    // v3.93.1 — paridade com o tradicional
    programaNecessidades: programaNecessidades.length ? programaNecessidades : undefined,
    horaTecnica,
    documentos: documentos.length ? documentos : undefined,
    avisos: avisos.length ? avisos : undefined,
    foro,
  };
}

// ── v3.93.1: helpers das seções de paridade (Prime = Tradicional) ───────────

/** Rótulos e ordem das categorias do Programa de Necessidades (espelha o PDF padrão). */
const PROG_CAT_LABEL: Record<string, string> = {
  social: 'Área Social', intimo: 'Área Íntima', servico: 'Área de Serviço',
  externo: 'Área Externa', comercial: 'Área Comercial', tecnico: 'Áreas Técnicas',
};
const PROG_CAT_ORDER = ['social', 'intimo', 'servico', 'externo', 'comercial', 'tecnico'];

/** Monta o Programa de Necessidades agrupado por categoria a partir do dados_imovel. */
function mapProgramaNecessidades(
  di: Record<string, unknown>,
): NonNullable<PropostaDados['programaNecessidades']> {
  const raw = Array.isArray(di.programa_necessidades)
    ? (di.programa_necessidades as Array<{
        nome: string; nome_plural?: string; categoria: string;
        ordem_pdf?: number; quantidade: number; observacao?: string | null;
      }>)
    : [];
  if (!raw.length) return [];
  const grupos: Record<string, typeof raw> = {};
  for (const item of [...raw].sort((a, b) => (a.ordem_pdf ?? 0) - (b.ordem_pdf ?? 0))) {
    (grupos[item.categoria] ??= []).push(item);
  }
  const out: NonNullable<PropostaDados['programaNecessidades']> = [];
  for (const cat of PROG_CAT_ORDER) {
    const items = grupos[cat];
    if (!items?.length) continue;
    out.push({
      categoria: PROG_CAT_LABEL[cat] ?? cat,
      itens: items.map((it) => {
        const nome = it.quantidade > 1 ? (it.nome_plural || it.nome) : it.nome;
        return `${String(it.quantidade).padStart(2, '0')} × ${nome}` +
          (it.observacao ? ` — ${it.observacao}` : '');
      }),
    });
  }
  return out;
}

/** Monta a Etapa Preliminar / Hora Técnica (box R$ informativo) do projeto executivo. */
function mapHoraTecnica(
  di: Record<string, unknown>,
): NonNullable<PropostaDados['horaTecnica']> {
  const taxa = Number(di.taxa_esboco) || 750;
  const valorFormatado = taxa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return {
    valorFormatado,
    paragrafo:
      'A etapa preliminar consiste no desenvolvimento do ESBOÇO ARQUITETÔNICO (anteprojeto) e do ' +
      'CROQUI DE ESTUDO, atividade técnica que precede e fundamenta toda a documentação executiva ' +
      'subsequente. Compreende:',
    itens: [
      'a) Análise técnica do terreno e levantamento das condicionantes legais (Plano Diretor, Lei de ' +
        'Uso e Ocupação do Solo, recuos obrigatórios, taxa de ocupação e coeficiente de aproveitamento);',
      'b) Reuniões de briefing com o CONTRATANTE para captação do programa de necessidades e ' +
        'setorização funcional dos ambientes;',
      'c) Elaboração do partido arquitetônico e estudos volumétricos preliminares;',
      'd) Confecção do CROQUI ARQUITETÔNICO em planta baixa, com layout, áreas aproximadas e ' +
        'implantação no lote, observando insolação e ventilação;',
      'e) Apresentação e ajustes do anteprojeto até a aprovação do CONTRATANTE para deflagrar a fase executiva.',
    ],
    condicoes: [
      `Caso o CONTRATANTE, após a entrega e aprovação do esboço, PROSSIGA com a contratação integral ` +
        `dos projetos executivos descritos nesta proposta, o valor de ${valorFormatado} NÃO SERÁ COBRADO, ` +
        `sendo absorvido pelo valor global do contrato.`,
      `Caso o CONTRATANTE OPTE POR NÃO PROSSEGUIR com a fase executiva após a entrega do anteprojeto, ` +
        `fica acordado o pagamento da Hora Técnica de ${valorFormatado}, que remunera exclusivamente o ` +
        `tempo técnico empregado na elaboração do croqui e estudos preliminares.`,
    ],
    nota:
      'Este valor NÃO está incluído no VALOR TOTAL desta proposta, sendo mencionado apenas para clareza contratual.',
  };
}

// ── Mapper: Laudo (+ entidades) → LaudoDados ────────────────────────────────

/** Texto padrao da finalidade quando o laudo nao tem campo proprio. */
const FINALIDADE_PADRAO_LAUDO =
  'Demarcação e materialização de vértices da poligonal do imóvel para fins de ' +
  'regularização fundiária, conforme NBR 13133 e sistemática INCRA/NTGIR.';

/**
 * Formata CPF/CNPJ com mascara a partir dos digitos.
 * - 11 digitos → CPF (000.000.000-00)
 * - 14 digitos → CNPJ (00.000.000/0000-00)
 * - qualquer outro tamanho → retorna o valor original (sem mascara)
 */
export function formatarCpfCnpj(v: string): string {
  const original = String(v ?? '');
  const d = original.replace(/\D/g, '');
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
  }
  return original;
}

/** 6 etapas EXATAS da metodologia tecnica aplicada (NTGIR/INCRA). */
const METODOLOGIA_PADRAO_LAUDO: string[] = [
  'PLANEJAMENTO E RECONHECIMENTO DE CAMPO — vistoria preliminar do imóvel para identificação dos limites, confrontantes e melhor estratégia de implantação dos marcos.',
  'MATERIALIZAÇÃO DOS VÉRTICES — implantação física dos marcos (piquetes) em todos os vértices da poligonal, com identificação sequencial (P1, P2, …) e registro fotográfico individual de cada vértice no local.',
  'RASTREAMENTO GNSS EM MODO RTK — coleta das coordenadas geodésicas de cada vértice por meio de receptor GNSS de dupla frequência operando em modo Real-Time Kinematic (RTK), com tempo mínimo de fixação até obtenção de solução fixa centimétrica. Sistema geodésico de referência: SIRGAS 2000 (oficial Brasil — IBGE/INCRA), projeção UTM, zona 23 Sul, meridiano central -45°.',
  'CAMINHAMENTO DA POLIGONAL — coleta sequencial dos vértices percorrendo o perímetro do imóvel no sentido horário, com fechamento angular e linear sobre o vértice inicial (P1) para verificação de consistência.',
  'PROCESSAMENTO E DESENHO TÉCNICO — pós-processamento dos dados brutos em escritório utilizando os softwares Topcon Tools e MetricaTOPO, geração da poligonal final, cálculo de área pelo método de Gauss (Shoelace), perímetro pelo somatório das distâncias planas e azimutes calculados segmento a segmento em DMS (graus, minutos e segundos).',
  'EMISSÃO DAS PEÇAS TÉCNICAS — produção do memorial descritivo conforme Norma Técnica de Georreferenciamento (NTGIR/INCRA), planilha de coordenadas, croqui georreferenciado e o presente laudo técnico.',
];

/** Descricoes padrao dos equipamentos (usadas quando o laudo nao informa). */
const EQUIP_BASE_PADRAO =
  'Receptor GNSS RTK S6 ComNAV — estação de referência fixa montada sobre tripé com base niveladora.';
const EQUIP_ROVER_PADRAO =
  'Receptor GNSS RTK T30 Laser Plus (SinoGNSS) — receptor móvel multibanda com rastreio simultâneo das constelações ativas (GPS, BeiDou, GLONASS, Galileo).';
const EQUIP_COLETOR_PADRAO =
  'Coletor de dados R60 (SinoGNSS) — controlador robusto e ergonômico para o levantamento topográfico em campo.';
const EQUIP_ACESSORIOS_PADRAO =
  'Tripé robusto para a base, bastão telescópico de 2 m para o rover, bipé estabilizador, base niveladora ótica, trena de aferição.';
const EQUIP_SOFTWARE_PADRAO = 'Topcon Tools + MetricaTOPO.';

/** Formata um numero em pt-BR com `casas` decimais; null/invalido → '—'. */
function fmtNum(v: number | null | undefined, casas: number): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/**
 * Converte um Laudo + entidades relacionadas em LaudoDados para os templates Prime.
 * @param laudo registro do laudo (integrations/laudos.buscarLaudo)
 * @param contratante contratante associado (pode ser null → fallback '—')
 * @param executante responsavel tecnico (pode ser null → fallback Romatec)
 * @param pontos vertices do laudo
 * @param lados lados calculados
 * @param baseUrl base publica para a URL de verificacao (ex: getBaseUrl())
 * @param opts dados pre-computados pela rota (croqui, memorial, pagamento, fotos)
 */
export function laudoToLaudoDados(
  laudo: Laudo,
  contratante: Contratante | null,
  executante: Executante | null,
  pontos: PontoLaudo[],
  lados: LadoLaudo[],
  baseUrl: string,
  opts?: {
    croquiSvg?: string;
    memorialTexto?: string;
    pagamento?: LaudoDados['pagamento'];
    fotos?: LaudoDados['fotos'];
    assinaturaIcp?: LaudoDados['assinaturaIcp'];
    arquivos?: LaudoDados['arquivos'];
  },
): LaudoDados {
  const base = baseUrl.replace(/\/$/, '');
  const isRural = laudo.tipo_imovel === 'RURAL';
  const croquiSvg = opts?.croquiSvg;

  // Vertices
  const vertices: LaudoVertice[] = pontos.map((p) => ({
    ordem: p.ordem,
    rotulo: p.rotulo,
    tipoMarco: p.descricao_marco ?? undefined,
    utmE: p.utm_e != null ? fmtNum(p.utm_e, 3) : '—',
    utmN: p.utm_n != null ? fmtNum(p.utm_n, 3) : '—',
    lat: p.lat_gms ?? (p.lat_decimal != null ? fmtNum(p.lat_decimal, 6) : undefined),
    long: p.long_gms ?? (p.long_decimal != null ? fmtNum(p.long_decimal, 6) : undefined),
    alt: p.altitude != null ? `${fmtNum(p.altitude, 3)} m` : '—',
  }));

  // Lados — azimute em DMS (graus, minutos, segundos)
  const ladosDados: LaudoLado[] = lados.map((l) => {
    const dist = l.medida_manual_m ?? l.distancia_m;
    return {
      lado: l.rotulo ?? `L${l.ordem}`,
      azimute: l.azimute != null ? azimuteParaDMS(Number(l.azimute)) : '—',
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

  // CPF/CNPJ com mascara (so quando ha valor).
  const cpfRaw = contratante?.cpf_cnpj?.trim() || '';
  const cpfCnpj = cpfRaw ? formatarCpfCnpj(cpfRaw) : '—';

  // Objeto da demarcacao — caracterizacao geometrica do imovel.
  const denominacaoObjeto =
    laudo.denominacao_imovel?.trim() ||
    [laudo.loteamento, laudo.quadra, laudo.numero_lote].filter(Boolean).join(' · ') ||
    'identificado neste laudo';
  const munUfObjeto =
    [laudo.municipio, laudo.uf_imovel].filter(Boolean).join('/') || 'município não informado';
  const objeto =
    `Constitui objeto do presente laudo a demarcação e materialização dos vértices ` +
    `definidores da poligonal do imóvel ${denominacaoObjeto}, situado em ${munUfObjeto}, ` +
    `com vistas à sua caracterização geométrica para fins de regularização.`;

  // Equipamentos — dinamicos a partir do laudo, com fallback padrao.
  const equipamentos: LaudoDados['equipamentos'] = {
    base: laudo.base_nome?.trim() || EQUIP_BASE_PADRAO,
    rover: laudo.rover_nome?.trim() || EQUIP_ROVER_PADRAO,
    coletor: laudo.coletor_nome?.trim() || EQUIP_COLETOR_PADRAO,
    acessorios: EQUIP_ACESSORIOS_PADRAO,
    software: EQUIP_SOFTWARE_PADRAO,
  };

  return {
    numero: laudo.numero_laudo,
    dataEmissao: fmtDataExtenso(laudo.assinado_em ?? laudo.created_at ?? new Date()),
    tipoImovel: laudo.tipo_imovel,
    finalidade: FINALIDADE_PADRAO_LAUDO,
    objeto,
    contratante: {
      nome: contratante?.nome?.trim() || '—',
      cpfCnpj,
      telefone: contratante?.telefone ?? undefined,
      email: contratante?.email ?? undefined,
      rg: contratante?.rg_ie ?? undefined,
      estadoCivil: contratante?.estado_civil ?? undefined,
      nacionalidade: contratante?.nacionalidade ?? undefined,
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
    metodologia: METODOLOGIA_PADRAO_LAUDO.slice(),
    equipamentos,
    memorialTexto: opts?.memorialTexto ?? '',
    pagamento: opts?.pagamento,
    fotos: opts?.fotos ?? [],
    assinaturaIcp: opts?.assinaturaIcp,
    arquivos: opts?.arquivos,
    croquiSvg,
    art: laudo.usa_art ? laudo.numero_art ?? undefined : undefined,
    trt: laudo.usa_trt ? laudo.numero_trt ?? undefined : undefined,
    hashValidacao: hash,
    urlVerificacao: `${base}/v/laudo/${hash}`,
    tecnico,
  };
}
