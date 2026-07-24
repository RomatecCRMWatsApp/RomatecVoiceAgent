// src/services/prontuario/prontuarioTemplates.ts
// v3.126.0 — Templates de etapas do "Prontuário do Escritório (Multi-Serviços)".
//
// Núcleo PURO do módulo: nenhuma dependência de banco, de Express ou de env.
// É a fonte única da verdade das categorias, dos sub-tipos e das etapas que
// nascem automaticamente quando um serviço é cadastrado no prontuário.
//
// Por que em código e não em tabela de configuração: o roteiro de cada serviço
// é regra de negócio do escritório (muda por decisão do CEO, não por operação
// do dia a dia) e precisa entrar em produção revisado e versionado. Alterar um
// roteiro aqui NÃO reescreve prontuários já abertos — as etapas são copiadas
// para prontuario_etapas no momento da criação, exatamente como o cronograma
// da obra. Prontuário aberto mantém o roteiro que tinha quando foi aberto.
//
// Convenção das chaves: snake_case ASCII, estáveis (viram valor de coluna).
// O rótulo humano (com acento) vive no campo `nome` e pode ser reescrito sem
// migração.

export type StatusEtapa = 'pendente' | 'em_andamento' | 'concluido';
export type StatusDocumento = 'ok' | 'pendente';

/** Documento exigido dentro de uma etapa (checklist). */
export interface DocumentoTemplate {
  doc: string;
}

/** Etapa do roteiro — `ordem` é atribuída na geração (1..N). */
export interface EtapaTemplate {
  ordem: number;
  nome: string;
  checklist_documentos?: DocumentoTemplate[];
}

export interface SubTipoTemplate {
  chave: string;
  nome: string;
  /** Roteiro próprio deste sub-tipo. Ausente = herda o roteiro da categoria. */
  etapas?: string[] | EtapaTemplate[];
}

export interface CategoriaTemplate {
  chave: string;
  nome: string;
  /** Roteiro padrão da categoria (vale para todo sub-tipo sem roteiro próprio). */
  etapas: Array<string | EtapaTemplate>;
  subTipos: SubTipoTemplate[];
}

// ── CAT 5 — checklist de documentos obrigatórios da Avaliação ────────────────
// Único checklist exigido nominalmente pela spec do módulo.
const DOCS_AVALIACAO: DocumentoTemplate[] = [
  { doc: 'Certidão de Matrícula Atualizada' },
  { doc: 'CND de IPTU' },
  { doc: 'Extrato BCI (Boletim de Cadastro Imobiliário)' },
  { doc: 'RG/CPF do proprietário' },
];

// ── CAT 3 — checklist derivado do próprio nome da etapa ─────────────────────
// A etapa "Atualização do CCIR/ITR/CAR" já enumera três documentos distintos;
// virar checklist evita marcar a etapa inteira como concluída com um deles
// pendente. Para remover, basta apagar o `checklist_documentos` da etapa 8.
const DOCS_RURAL_CADASTROS: DocumentoTemplate[] = [
  { doc: 'CCIR atualizado' },
  { doc: 'ITR do exercício' },
  { doc: 'CAR (Cadastro Ambiental Rural)' },
];

/**
 * Catálogo dos serviços do escritório. A ordem do array é a ordem exibida na
 * tela; a ordem das etapas é a ordem do roteiro (1..N).
 */
export const CATEGORIAS: readonly CategoriaTemplate[] = [
  {
    chave: 'projetos',
    nome: 'Projetos de Arquitetura & Engenharia',
    etapas: [
      'Contratação & Briefing',
      'Estudo Preliminar / Anteprojeto',
      'Projeto Arquitetônico',
      'Projeto Elétrico',
      'Projeto Hidráulico',
      'Projeto Sanitário',
      'Compatibilização & Aprovativo Municipal',
      'Emissão de ART/RRT',
      'Conclusão & Entrega do Pacote Executivo',
    ],
    subTipos: [
      { chave: 'arquitetonico_completo', nome: 'Projeto Arquitetônico Completo' },
      { chave: 'complementares', nome: 'Projetos Complementares' },
    ],
  },
  {
    chave: 'topografia_urbana',
    nome: 'Topografia & Regularização Urbana',
    etapas: [
      'Levantamento Topográfico de Campo',
      'Processamento & Desenho do Mapa/Planta',
      'Memorial Descritivo',
      'Emissão e Pagamento de ART/RRT',
      'Coleta de Assinaturas (Confrontantes/Requerente)',
      'Montagem de Requerimentos e Pasta Técnica',
      'Protocolo Prefeitura / Superintendência de Habitação / REURB',
      'Protocolo e Acompanhamento no Cartório (RI)',
      'Emissão da Matrícula/Certidão & Entrega Final',
    ],
    subTipos: [
      { chave: 'desmembramento', nome: 'Desmembramento' },
      { chave: 'remembramento', nome: 'Remembramento' },
      { chave: 'retificacao_area', nome: 'Retificação de Área' },
      { chave: 'usucapiao_urbana', nome: 'Usucapião Urbana' },
      { chave: 'reurb', nome: 'REURB' },
    ],
  },
  {
    chave: 'agrimensura_rural',
    nome: 'Agrimensura & Georreferenciamento Rural',
    etapas: [
      'Levantamento de Campo GNSS/RTK & Rastreio',
      'Processamento e Cálculo de Coordenadas (UTM/SIRGAS 2000)',
      'Planta e Memorial Descritivo',
      'Emissão e Baixa de ART/TRT/RRT',
      'Assinatura de Anuência dos Confrontantes (se aplicável)',
      'Certificação e Envio ao SIGEF/INCRA',
      'Protocolo no Cartório (CRI)',
      { ordem: 8, nome: 'Atualização do CCIR/ITR/CAR', checklist_documentos: DOCS_RURAL_CADASTROS },
      'Entrega do Dossiê do Imóvel Rural',
    ],
    subTipos: [
      { chave: 'geosimples', nome: 'GeoSimples' },
      { chave: 'desmembramento_rural', nome: 'Desmembramento Rural' },
      { chave: 'remembramento_rural', nome: 'Remembramento Rural' },
      { chave: 'retificacao_rural', nome: 'Retificação Rural' },
    ],
  },
  {
    chave: 'assessoria_registral',
    nome: 'Assessoria Registral e Contratos',
    // Categoria SEM roteiro comum: cada sub-tipo tem o seu (6 e 5 etapas).
    // O fallback abaixo só é usado se algum dia surgir sub-tipo sem roteiro.
    etapas: [
      'Análise da Documentação',
      'Providências Cartorárias',
      'Entrega ao Cliente',
    ],
    subTipos: [
      {
        chave: 'registro_transferencia',
        nome: 'Assessoria p/ Registro e Transferência de Imóveis',
        etapas: [
          'Análise da Documentação',
          'Emissão de Certidões Negativas e Matrícula Atualizada',
          'Cálculo e Encaminhamento de Impostos (ITBI/ITCMD)',
          'Agendamento e Coleta de Assinaturas da Escritura Pública',
          'Protocolo de Registro no Cartório',
          'Retirada da Matrícula Registrada & Entrega',
        ],
      },
      {
        chave: 'contratos',
        nome: 'Elaboração de Contratos (Compra e Venda, Promessa, Cessão de Direitos)',
        etapas: [
          'Coleta de Dados das Partes e Objeto',
          'Minuta para Revisão',
          'Redação Final e Ajustes',
          'Coleta de Assinaturas (física/digital) e Reconhecimento de Firma',
          'Entrega das Vias Assinadas',
        ],
      },
    ],
  },
  {
    chave: 'avaliacoes',
    nome: 'Avaliações Imobiliárias',
    etapas: [
      'Vistoria Presencial & Relatório Fotográfico',
      { ordem: 2, nome: 'Coleta da Documentação Obrigatória', checklist_documentos: DOCS_AVALIACAO },
      'Pesquisa de Amostragem e Mercadológica',
      'Tratamento Estatístico e Cálculo do Valor',
      'Redação do Laudo',
      'Emissão da ART/RRT',
      'Assinatura do RT & Entrega',
    ],
    subTipos: [
      { chave: 'laudo_avaliacao', nome: 'Laudo de Avaliação Mercadológica' },
      { chave: 'parecer_mercadologico', nome: 'Parecer Técnico de Avaliação Mercadológica' },
    ],
  },
] as const;

// ── Consultas ao catálogo ────────────────────────────────────────────────────

export function obterCategoria(chave: string): CategoriaTemplate | null {
  return CATEGORIAS.find((c) => c.chave === chave) ?? null;
}

export function obterSubTipo(categoria: string, subTipo: string): SubTipoTemplate | null {
  const cat = obterCategoria(categoria);
  if (!cat) return null;
  return cat.subTipos.find((s) => s.chave === subTipo) ?? null;
}

/** Estrutura enxuta para alimentar os selects da tela (sem repetir etapas). */
export function listarCategorias(): Array<{
  chave: string;
  nome: string;
  subTipos: Array<{ chave: string; nome: string; total_etapas: number }>;
}> {
  return CATEGORIAS.map((c) => ({
    chave: c.chave,
    nome: c.nome,
    subTipos: c.subTipos.map((s) => ({
      chave: s.chave,
      nome: s.nome,
      total_etapas: etapasDoTemplate(c.chave, s.chave).length,
    })),
  }));
}

/** Rótulo humano do serviço contratado ("Categoria — Sub-tipo"). */
export function rotuloServico(categoria: string, subTipo?: string | null): string {
  const cat = obterCategoria(categoria);
  if (!cat) return categoria;
  const sub = subTipo ? obterSubTipo(categoria, subTipo) : null;
  return sub ? `${cat.nome} — ${sub.nome}` : cat.nome;
}

function normalizarEtapas(brutas: Array<string | EtapaTemplate>): EtapaTemplate[] {
  return brutas.map((e, i) => {
    if (typeof e === 'string') return { ordem: i + 1, nome: e };
    // `ordem` do literal é ignorada de propósito: a posição no array manda,
    // pra que inserir uma etapa no meio não exija renumerar o arquivo inteiro.
    return {
      ordem: i + 1,
      nome: e.nome,
      ...(e.checklist_documentos?.length
        ? { checklist_documentos: e.checklist_documentos.map((d) => ({ doc: d.doc })) }
        : {}),
    };
  });
}

/**
 * Roteiro de etapas de um serviço. Sub-tipo com roteiro próprio vence; sem
 * roteiro próprio, herda o da categoria. Categoria desconhecida → [] (o
 * chamador decide se isso é 400 ou silêncio — a rota devolve 400).
 */
export function etapasDoTemplate(categoria: string, subTipo?: string | null): EtapaTemplate[] {
  const cat = obterCategoria(categoria);
  if (!cat) return [];
  const sub = subTipo ? obterSubTipo(categoria, subTipo) : null;
  const brutas = (sub?.etapas as Array<string | EtapaTemplate> | undefined) ?? cat.etapas;
  return normalizarEtapas([...brutas]);
}

// ── Progresso ────────────────────────────────────────────────────────────────

export interface ResumoProgresso {
  total: number;
  concluidas: number;
  em_andamento: number;
  pendentes: number;
  percentual: number;
}

/**
 * Percentual do prontuário = etapas concluídas / total (arredondado).
 * Etapa "em andamento" NÃO conta meio ponto de propósito: o cliente pergunta
 * "quantas das N etapas já saíram", e meia etapa não sai.
 */
export function calcularProgresso(etapas: Array<{ status: StatusEtapa }>): ResumoProgresso {
  const total = etapas.length;
  const concluidas = etapas.filter((e) => e.status === 'concluido').length;
  const emAndamento = etapas.filter((e) => e.status === 'em_andamento').length;
  return {
    total,
    concluidas,
    em_andamento: emAndamento,
    pendentes: total - concluidas - emAndamento,
    percentual: total === 0 ? 0 : Math.round((concluidas / total) * 100),
  };
}

// ── Normalização da atualização de etapa ─────────────────────────────────────

const STATUS_VALIDOS: readonly StatusEtapa[] = ['pendente', 'em_andamento', 'concluido'];

export function ehStatusEtapa(v: unknown): v is StatusEtapa {
  return typeof v === 'string' && (STATUS_VALIDOS as readonly string[]).includes(v);
}

export function ehStatusDocumento(v: unknown): v is StatusDocumento {
  return v === 'ok' || v === 'pendente';
}

export interface AtualizacaoEtapaEntrada {
  status?: unknown;
  data_conclusao?: unknown;
  responsavel?: unknown;
  observacoes?: unknown;
}

export interface AtualizacaoEtapaNormalizada {
  status?: StatusEtapa;
  data_conclusao?: string | null;
  responsavel?: string | null;
  observacoes?: string | null;
}

function dataIso(v: unknown): string | null {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Regras de data de conclusão (puras, pra ficarem testáveis fora do banco):
 *   - concluir sem informar data → carimba `hoje`;
 *   - concluir informando data → respeita a data informada;
 *   - voltar para pendente/em_andamento → limpa a data (etapa reaberta não
 *     pode continuar exibindo "concluída em ..." no histórico da tela).
 * Campos ausentes no corpo continuam ausentes (undefined = não mexe).
 */
export function normalizarAtualizacaoEtapa(
  entrada: AtualizacaoEtapaEntrada,
  hojeIso: string,
): AtualizacaoEtapaNormalizada {
  const out: AtualizacaoEtapaNormalizada = {};

  if (entrada.status !== undefined) {
    if (!ehStatusEtapa(entrada.status)) {
      throw new Error(`Status inválido: use ${STATUS_VALIDOS.join(', ')}.`);
    }
    out.status = entrada.status;
  }

  const dataInformada = entrada.data_conclusao !== undefined ? dataIso(entrada.data_conclusao) : undefined;

  if (out.status === 'concluido') {
    out.data_conclusao = dataInformada ?? hojeIso;
  } else if (out.status === 'pendente' || out.status === 'em_andamento') {
    out.data_conclusao = null;
  } else if (dataInformada !== undefined) {
    // Sem mudança de status, mas ajustando a data (correção de lançamento).
    out.data_conclusao = dataInformada;
  }

  if (entrada.responsavel !== undefined) {
    const s = String(entrada.responsavel ?? '').trim();
    out.responsavel = s ? s.slice(0, 255) : null;
  }
  if (entrada.observacoes !== undefined) {
    const s = String(entrada.observacoes ?? '').trim();
    out.observacoes = s || null;
  }
  return out;
}

// ── Número do prontuário ─────────────────────────────────────────────────────
/**
 * PRN-AAAA-NNN (mesmo espírito do INV-AAAA-NNNN e do RE-AAAA-NNNN). Atribuído
 * pós-insert, a partir do id — sequência global, não por ano; o ano no meio é
 * o de abertura. Puro/testável.
 */
export function formatarNumeroProntuario(id: number, ano: number): string {
  return `PRN-${ano}-${String(id).padStart(3, '0')}`;
}
