// v1.66.0: tipos compartilhados do motor de calculo de Proposta de Consultoria.
// 5 secoes do PDF: projetos (escopo) + taxas terceiros + honorarios + checklist + total.

export type SubtipoConsultoria =
  | 'averbacao_residencial'
  | 'averbacao_comercial'
  | 'georreferenciamento_rural'
  | 'desmembramento'
  | 'remembramento'
  | 'retificacao_area'
  | 'avaliacao_ptam'
  | 'projeto_executivo';

export type PadraoConstrutivo = 'popular' | 'normal' | 'alto';
export type ResponsavelObra = 'PF' | 'PJ_com_contabilidade' | 'PJ_sem_contabilidade';
export type AnotacaoTecnica = 'art_crea' | 'rrt_cau' | 'trt_cft';

export interface ItemCusto {
  ordem: number;
  descricao: string;
  valor: number;
  observacao?: string;
  pendente?: boolean; // true quando valor nao confirmado (ex: Habite-se Prefeitura)
  // v1.66.17: quando o usuario edita o valor no preview, guardamos o valor
  // calculado pelo motor pra mostrar "Desconto" / "Acrescimo" no PDF.
  valor_original?: number;
}

export interface DocumentoChecklist {
  texto: string;
  obrigatorio: boolean;
  imprescindivel?: boolean; // destaque vermelho (IPTU em desm/rem)
}

export interface CondicaoPagamento {
  rotulo: string;
  descricao: string;
  valor: number;
}

export interface BaseCalculo {
  rotulo: string;
  formula: string;
  valor_resultado: number;
}

export interface CustosCalculados {
  secao_1_projetos: string[];               // lista descritiva dos projetos a confeccionar
  secao_2_taxas: ItemCusto[];                // emolumentos, INSS, ART, taxas Prefeitura
  secao_3_honorarios: ItemCusto[];           // sempre 2 linhas: projeto + assessoria
  // v1.66.11: Condicoes de Pagamento (abaixo da Secao 3 Honorarios) +
  // Base de Calculo explicita da Receita Federal.
  condicoes_pagamento?: CondicaoPagamento[];
  // v3.23.0: despesas administrativas (estimativa) — exibidas em seção separada no PDF, NÃO somam ao secao_5_total.
  despesas_administrativas?: {
    valor: number;
    descritivo: string;
  };
  // Base de Cálculo: memória de cálculo Romatec (fórmula explícita por item).
  // Não há consulta à Receita Federal; o termo "Base" refere-se à derivação interna dos honorários.
  base_calculo?: BaseCalculo[];
  secao_4_checklist: DocumentoChecklist[];   // documentos do cliente
  secao_5_total: number;                     // soma das secoes 2 + 3
  avisos: string[];                          // ex: aviso SERO, aviso Prefeitura
  // v3.23.5: subtotais explicitos para o PDF (Georref Rural PROP-2026-0011-R1).
  // Quando presentes, o PDF separa visualmente "Honorarios Romatec" (trt + tecnicos
  // + assessoria) de "Custos de Terceiros" (emolumentos, SIGEF, outros).
  // Tambem usado pra validar fechamento p1 + p2 + p3 === total_romatec.
  honorarios_romatec?: {
    trt: number;
    tecnicos: number;
    assessoria: number;
    total: number;                           // trt + tecnicos + assessoria
  };
  // v3.23.5: seccao 6 informativa com servicos opcionais (CCIR/CAR/ITR/anuencia/retif).
  // NAO soma ao secao_5_total — exibida em tabela separada no PDF, mesmo quando vazia.
  secao_opcionais_georref?: {
    itens: Array<{
      chave: 'ccir' | 'car' | 'itr' | 'anuencia' | 'retificacao';
      rotulo: string;
      contratado: boolean;
      quantidade?: number;
      valor_unitario?: number | 'sob_orcamento';
      subtotal: number | 'sob_orcamento';
    }>;
    subtotal: number;                        // soma dos contratados (excl. retificacao)
  };
  // v3.23.5: historico de revisoes (incremento -R{N} quando PUT apos status ENVIADA).
  // Logado aqui em vez de tabela separada (decisao: tabela propostas_historico nao existe
  // ainda; mantemos em JSON por enquanto, migration futura pode extrair).
  historico_revisoes?: Array<{
    revisao: number;                         // R{N}
    timestamp: string;                       // ISO
    autor?: string;
    motivo?: string;
  }>;
}

export interface FontesConsulta {
  tjma?: { fonte: 'scraping' | 'fallback'; consultadoEm: string };
  cub?:  { valor: number; padrao: PadraoConstrutivo; mes_referencia: string };
  sero?: { fonte: string; aviso: string };
  prefeitura?: { itens_pendentes: string[] };
}

// ── Inputs por subtipo ──────────────────────────────────────────────────────

export interface InputAverbacao {
  modalidade: 'residencial' | 'comercial';
  area_construida: number;
  valor_venal_imovel: number;
  padrao_construtivo: PadraoConstrutivo;
  responsavel: ResponsavelObra;
  municipio?: string;
  apresentar_projetos_complementares?: boolean; // residencial only
  tem_alvara_construcao: boolean;
  tem_habite_se: boolean;
  iptu_em_dia: boolean;
  cnd_receita_emitida: boolean;
  certidao_inteiro_teor_atualizada: boolean;
  anotacao_tecnica?: AnotacaoTecnica; // default 'art_crea' (CREA-MA)
  // v1.66.6: opcao de parcelamento INSS/SERO (cliente pode dividir em ate 60x)
  parcelar_inss?: boolean;
  numero_parcelas_inss?: number; // 2..60
}

// v3.23.5: Finalidade do servico — controla o box dourado no PDF e
// se adiciona linha de "Emolumentos — encerramento/abertura de matricula"
// nos Custos de Terceiros (quando DESMEMBRAMENTO/REMEMBRAMENTO).
export type FinalidadeGeorref =
  | 'CERTIFICACAO'
  | 'DESMEMBRAMENTO'
  | 'REMEMBRAMENTO'
  | 'RETIFICACAO';

// v3.23.5: opcionais nao somam ao total Romatec — ficam em seccao informativa
// propria com subtotal proprio (ver propostasConsultoria.ts secao 6 do PDF).
// valor_unitario congelado no momento da criacao da proposta (decisao tomada
// na resposta as 6 perguntas — se eu reajustar daqui 6 meses, propostas
// antigas nao mudam retroativamente).
export interface OpcionaisGeorref {
  ccir: { contratado: boolean; valor_unitario: number };
  car:  { contratado: boolean; valor_unitario: number };
  itr:  { contratado: boolean; quantidade: number; valor_unitario: number };
  anuencia: { contratado: boolean; quantidade: number; valor_unitario: number };
  // Retificacao e "sob orcamento" — nao soma; valor literal usado pra evitar
  // misturar string/numero no mesmo campo de valor.
  retificacao: { contratado: boolean; valor: 'sob_orcamento' };
}

export interface InputGeorreferenciamento {
  area_hectares: number;
  numero_vertices: number;
  distancia_km: number;
  valor_por_hectare: number;
  valor_por_vertice: number;
  valor_diaria_campo: number;
  numero_diarias: number;
  valor_km_deslocamento: number;
  valor_outros_servicos: number;
  municipio: string;
  estado: string;
  tem_matricula: boolean;
  complexidade: 'simples' | 'media' | 'alta';

  // v3.23.5: campos novos do alinhamento ao modelo aprovado PROP-2026-0011-R1.
  // Todos opcionais por retrocompat — propostas antigas em dados_imovel JSON
  // continuam carregando sem esses campos.
  finalidade?: FinalidadeGeorref;
  matricula?: string;             // matricula atual (texto livre)
  cri?: string;                   // Cartorio do Registro de Imoveis (texto livre)
  perimetro_m?: number;           // perimetro da poligonal em metros
  validade_dias?: number;         // override da validade (default 15 no backend)
  opcionais?: OpcionaisGeorref;   // servicos adicionais que entram em seccao informativa
}

export interface InputDesmembramento {
  tipo: 'desmembramento' | 'remembramento';
  area_total_m2: number;
  numero_lotes_resultantes?: number;
  numero_lotes_origem?: number;
  valor_venal_total: number;
  tipo_zona: 'urbana' | 'rural';
  iptu_em_dia: boolean;
  // Legado v3.22.0 — mantido obrigatório por compatibilidade de tipo (callers existentes não quebram).
  // Quando modo_precificacao está presente, este valor é IGNORADO pela engine.
  // Front-ends novos podem passar qualquer valor válido (default sugerido: 1.0).
  honorario_projeto_sm: 0.5 | 1.0;

  // ─── Remembramento detalhado (opcionais — quando informados, sobrescrevem a engine paramétrica)
  // Quando imoveis[] presente, area_total_m2 e numero_lotes_origem podem ser derivados (validados).
  imoveis?: Array<{
    ordem: number;
    area_m2: number;
    endereco: string;
    matricula: string;
    // v3.22.0 — campos novos
    livro?: string;             // ex: '2-AA' (livro de transcrição/registro)
    folha?: string;             // ex: '101' (folha do livro)
    cri?: string;               // legado: nome livre do CRI (mantido p/ retrocompat)
    cri_cns?: string;           // v3.22.0: CNS do cartório (FK natural para cartorios.cns)
    cri_denominacao?: string;   // v3.22.0: snapshot do nome do cartório no momento da proposta
  }>;

  // Modo de cálculo dos honorários:
  //   'auto'   → engine paramétrica (default — SM × fator × num matrículas)
  //   'manual' → lista livre de "Mapas" + Assessoria Jurídica opcional
  modo_calculo?: 'auto' | 'manual';
  mapas?: Array<{
    numero: number;
    descricao?: string;
    valor: number;
  }>;
  assessoria_juridica?: {
    incluir: boolean;
    valor?: number;
  };

  // v3.22.0: status obrigatório de documentação. Quando undefined cai no checklist
  // legado (secao_4). Quando presente, a engine valida: CND/BCI anexados (bool) e
  // certidão de inteiro teor com no máximo 30 dias desde a emissão.
  // Sobrepõe semanticamente iptu_em_dia: o flag continua existindo, mas em v3.22.0
  // a evidência (anexo) tem precedência sobre o boolean simples.
  status_documentacao?: {
    cnd_iptu_anexada: boolean;
    bci_anexado: boolean;
    certidao_inteiro_teor_data: string;   // ISO YYYY-MM-DD
  };

  // v3.22.0: Assessoria Técnica — para remembramento, substitui assessoria_juridica.
  // Quando habilitada=true, vira linha em secao_3_honorarios (descricao começa com
  // "Assessoria Técnica"). Os dois campos coexistem por retrocompat.
  assessoria_tecnica?: {
    habilitada: boolean;
    valor?: number;
  };

  // v3.23.0: modo de precificação substitui o pacote SM legado.
  //   'por_imovel'    → valor_por_imovel × imoveis.length
  //   'por_lote'      → soma de valores_por_lote[]
  //   'personalizado' → valor fechado + descritivo
  // Quando ausente, cai no comportamento v3.22.0 (modo_calculo auto/manual + honorario_projeto_sm).
  modo_precificacao?: 'por_imovel' | 'por_lote' | 'personalizado';

  valor_por_imovel?: number;            // usado quando modo_precificacao='por_imovel'

  valores_por_lote?: Array<{            // usado quando modo_precificacao='por_lote'
    ordem: number;
    valor: number;
    descricao?: string;                 // ex: "Lote 03 — Quadra 7"
  }>;

  honorarios_personalizados?: {         // usado quando modo_precificacao='personalizado'
    valor_total: number;
    descritivo: string;
  };

  // v3.23.0: despesas administrativas (estimativa). Quando habilitada, vai em seção
  // separada no PDF — NÃO soma aos honorários técnicos. Por ora valor manual; tabela
  // automática (≈R$68 / 10% VRM por imóvel) virá em fase posterior.
  despesas_administrativas?: {
    habilitada: boolean;
    valor: number;
    descritivo: string;
  };

  // v3.22.0: estado civil do cliente (espelhado aqui pra validação de docs do cônjuge no PDF)
  cliente_estado_civil?: 'solteiro' | 'casado' | 'divorciado' | 'viuvo' | 'uniao_estavel';

  // Peças técnicas a entregar (default: mapa + memorial + art + requerimentos)
  // Validação: pelo menos uma de { art, trt } deve estar marcada.
  pecas_tecnicas?: {
    mapa: boolean;
    memorial: boolean;
    art: boolean;
    trt: boolean;
    requerimentos: boolean;
  };

  // ─── Desmembramento (rural) / Desdobro (urbano) detalhado — opcionais
  // Quando 'modalidade' presente, refina o PDF (Lei 5.868/72 vs Lei 6.766/79).
  //   'rural'  → unidade_area implícita 'ha' (PDF: "DESMEMBRAMENTO DE IMÓVEL RURAL")
  //   'urbana' → unidade_area implícita 'm2' (PDF: "DESDOBRO DE LOTE URBANO")
  modalidade?: 'rural' | 'urbana';
  unidade_area?: 'ha' | 'm2';

  // Dados detalhados do imóvel matriz (quando informados, complementam area_total_m2)
  matriz?: {
    matricula: string;
    cri?: string;
    endereco: string;
    denominacao?: string;     // só rural — ex: "Fazenda Bom Jesus", "Gleba 03"
    municipio?: string;       // para texto do PDF em desdobro urbano
  };

  // Frações resultantes (substitui mapas[] no modo manual quando é desmembramento/desdobro)
  // Cada fração tem área (na unidade_area) + valor cobrado + descrição.
  // Validação: soma das áreas ≤ matriz_area (tolerância: 0.01 ha ou 1 m²).
  fracoes?: Array<{
    numero: number;
    area: number;
    valor: number;
    descricao?: string;
  }>;
}

export interface InputRetificacao {
  area_atual_matricula: number;
  area_real_levantada: number;
  valor_venal: number;
  tipo_retificacao: 'administrativa' | 'judicial';
  tem_anuencia_confrontantes: boolean;
  honorario_projeto_sm?: number; // default 1.0
}

export interface InputAvaliacaoPTAM {
  tipo_imovel: 'urbano_residencial' | 'urbano_comercial' | 'rural' | 'glebas' | 'industrial';
  area_terreno: number;
  area_construida: number;
  localizacao: { municipio: string; bairro?: string };
  finalidade: 'judicial' | 'bancaria' | 'particular' | 'inventario';
  nivel_precisao: 'expedita' | 'normal' | 'rigorosa';
  faixa_honorario: '1_lote_urbano' | '2_sitio_proximo' | '3_rural_medio' | '4_fazenda_grande' | 'outro';
  valor_outro?: number;
}

export interface ResultadoCalculo {
  custos: CustosCalculados;
  fontes: FontesConsulta;
}

// v3.24.5: subtipo Projeto Executivo. Confeccao de projetos arquitetonicos
// + complementares (hidraulico, sanitario, eletrico, estrutural, PCI, mapa
// de situacao). Calculo simples: area × R$/m² + ART/TRT auto por area
// + alvara opcional + placa opcional. Taxa esboco (R$750) e' INFORMATIVA —
// nao soma ao total (so cobrada se cliente desistir apos esboco).

export type CodigoProjetoExecutivo =
  | 'mapa_situacao'
  | 'arquitetonico'
  | 'hidraulico'
  | 'sanitario'
  | 'eletrico'
  | 'estrutural'
  | 'pci';

export type TipoEdificacao =
  | 'residencial'
  | 'comercial'
  | 'misto'
  | 'industrial'
  | 'institucional';

export interface ProjetoSelecionado {
  codigo: CodigoProjetoExecutivo;
  nome: string;
  ordem: number;
  selecionado: boolean;
  detalhamento_entrega: string;
}

export interface InputProjetoExecutivo {
  // Imovel/obra
  endereco_obra: string;
  cidade_obra?: string;        // default Acailandia
  uf_obra?: string;            // default MA
  tipo_edificacao: TipoEdificacao;

  // Calculo principal
  area_construir: number;       // m²
  valor_m2: number;             // R$/m² (default 25)

  // ART/TRT — auto por area (>80m² ART) com override manual
  responsabilidade_auto?: boolean;       // default true
  responsabilidade_tipo?: 'ART' | 'TRT'; // so usado se auto=false
  responsabilidade_valor?: number;       // override do default da config

  // Itens opcionais (cada um pode ser desligado)
  alvara_incluir: boolean;
  alvara_valor: number;
  placa_incluir: boolean;
  placa_valor: number;

  // Taxa de esboco (R$750 default) — INFORMATIVA, fora do total
  taxa_esboco?: number;

  // Descontos/desbloqueios manuais
  desconto?: number;

  // Projetos selecionados (lista vinda do front; defaults aplicados quando vazio)
  projetos_selecionados?: ProjetoSelecionado[];

  // Cliente — usado so na preview/rendering, nao no calculo
  prazo_entrega_dias?: number;
  forma_pagamento?: string;
  observacoes?: string;
}
