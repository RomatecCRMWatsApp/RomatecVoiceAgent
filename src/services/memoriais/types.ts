// v3.35.0: tipos compartilhados do modulo Memoriais de Calculo.

export type DisciplinaMemorial =
  | 'arquitetonico'
  | 'eletrico'
  | 'hidraulico'
  | 'sanitario'
  | 'estrutural'
  | 'pci';

export type StatusMemorial =
  | 'rascunho'
  | 'extraindo_pdf'
  | 'aguardando_wizard'
  | 'gerando_previa'
  | 'aguardando_revisao'
  | 'finalizado'
  | 'assinado'
  | 'enviado'
  | 'arquivado';

// Wizard input comum (todas as disciplinas)
export interface WizardComum {
  uso_edificacao: string;
  num_pessoas?: number;
  num_pavimentos: number;
  area_construida_m2: number;
  incluir_trt?: boolean;
  trt_numero?: string;
  trt_data?: string;
}

// Wizard especifico Hidraulico (NBR 5626)
export interface WizardHidraulico extends WizardComum {
  num_pessoas: number;
  fonte_alimentacao: 'rede_publica' | 'poco_artesiano' | 'cisterna_bomba' | 'mista';
  volume_reservatorio_L?: number;     // 0 = auto-calcular
  tem_aquecimento: 'nao' | 'eletrico' | 'gas' | 'solar';
  tem_maquina_lavar: boolean;
  tem_limpeza_externa: boolean;
  // Pesos relativos (NBR 5626 — aparelhos detectados na planta)
  aparelhos: Array<{
    tipo: AparelhoHidraulico;
    quantidade: number;
  }>;
}

export type AparelhoHidraulico =
  | 'bacia_caixa_acoplada'
  | 'lavatorio'
  | 'chuveiro'
  | 'ducha_higienica'
  | 'pia_cozinha'
  | 'tanque'
  | 'maquina_lavar'
  | 'torneira_geral';

// ─────────────────────────────────────────────────────────────────────────
// v3.48.0 — Sanitario (NBR 8160:1999 Esgoto + NBR 10844:1989 Aguas Pluviais)
// ─────────────────────────────────────────────────────────────────────────

export type AparelhoSanitario =
  | 'bacia_sanitaria'      // UHC = 6
  | 'lavatorio'            // UHC = 1
  | 'chuveiro'             // UHC = 2
  | 'pia_cozinha'          // UHC = 3
  | 'tanque'               // UHC = 3
  | 'maquina_lavar'        // UHC = 3
  | 'ralo_sifonado'        // UHC = 1
  | 'ralo_seco';           // UHC = 1

export interface WizardSanitario extends WizardComum {
  num_pessoas: number;
  // Esgoto (NBR 8160)
  aparelhos: Array<{ tipo: AparelhoSanitario; quantidade: number }>;
  // Aguas pluviais (NBR 10844)
  area_cobertura_m2: number;          // area de telhado/laje contribuinte
  intensidade_pluv_mmh?: number;      // default Acailandia: 150 mm/h (T=5 anos)
  inclinacao_calha_pct?: number;      // default 0.5%
  // Solucao de destino final
  destino_efluente: 'rede_publica' | 'fossa_sumidouro' | 'fossa_filtro_anaerobio' | 'eta_compacta';
  tem_caixa_gordura: boolean;
}

export interface MemorialSanitarioOutput {
  esgoto: {
    soma_uhc: number;
    detalhamento_uhc: Array<{ tipo: AparelhoSanitario; qtd: number; uhc_unit: number; uhc_total: number }>;
    dimensionamento_ramais: { DN_mm: number; descricao: string };  // ramal de descarga primario
    dimensionamento_tubo_queda: { DN_mm: number; descricao: string };
    dimensionamento_coletor_predial: { DN_mm: number; declividade_min_pct: number };
  };
  aguas_pluviais: {
    area_contribuinte_m2: number;
    intensidade_mmh: number;
    vazao_projeto_Lmin: number;             // Q = (i × A) / 60
    dimensionamento_calha: { DN_mm: number; capacidade_Lmin: number; status: 'OK' | 'AJUSTAR' };
    dimensionamento_condutor_vertical: { DN_mm: number; quantidade: number; status: 'OK' | 'AJUSTAR' };
  };
  fossa_sumidouro?: {
    volume_camara_decantacao_L: number;   // NBR 7229
    volume_camara_digestao_L: number;
    volume_total_L: number;
    area_sumidouro_m2: number;            // K = 50 L/m²/dia
  };
  parametros_aplicados: {
    contribuicao_per_capita_L_dia: number;
    tempo_detencao_h: number;
    coef_runoff_pluvial: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// v3.48.0 — Eletrico (NBR 5410:2004 Instalacoes Eletricas BT)
// ─────────────────────────────────────────────────────────────────────────

export type CargaEletrica =
  | 'iluminacao_tug'         // pontos de tomada uso geral + ilum
  | 'tue_chuveiro'           // tomada uso especifico — chuveiro
  | 'tue_aquecedor'          // boiler eletrico
  | 'tue_ar_condicionado'    // split
  | 'tue_maquina_lavar'      // m. lavar / lava-loucas
  | 'tue_forno_micro'        // forno + microondas
  | 'tue_outros';            // outros aparelhos especificos

export interface WizardEletrico extends WizardComum {
  area_construida_m2: number;
  // Cargas (NBR 5410 Anexo C - residencial)
  cargas: Array<{ tipo: CargaEletrica; potencia_w: number; quantidade: number }>;
  fator_demanda: 'residencial' | 'comercial';
  tensao_nominal_v: 127 | 220 | 380;          // entrada da concessionaria
  tipo_alimentacao: 'monofasico' | 'bifasico' | 'trifasico';
  comprimento_ramal_m: number;                // distancia do padrao a' rede
}

export interface MemorialEletricoOutput {
  carga_total_instalada_w: number;
  carga_demandada_kw: number;
  corrente_projeto_A: number;
  detalhamento_cargas: Array<{ tipo: CargaEletrica; pot_total_w: number; fator_demanda_pct: number; pot_demandada_w: number }>;
  dimensionamento_ramal: {
    secao_condutor_mm2: number;             // bitola do condutor de entrada
    queda_tensao_pct: number;
    disjuntor_geral_A: number;
    status: 'OK' | 'AJUSTAR';
  };
  protecao: {
    dr_obrigatorio: boolean;                // sempre true em residencial NBR 5410
    dps_obrigatorio: boolean;
    aterramento_tipo: 'TT' | 'TN-S' | 'TN-C-S';
  };
  parametros_aplicados: {
    iluminacao_va_m2: number;
    tug_padrao_va: number;
    fator_potencia: number;
    queda_max_pct: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// v3.48.0 — Estrutural (NBR 6118:2014 Concreto Armado + NBR 6122:2019 Fund.)
// ─────────────────────────────────────────────────────────────────────────

export interface WizardEstrutural extends WizardComum {
  area_construida_m2: number;
  num_pavimentos: number;
  vao_medio_pilares_m: number;              // distancia media entre pilares
  carga_acidental_kn_m2?: number;           // NBR 6120 — residencial 1,5
  classe_concreto: 'C20' | 'C25' | 'C30' | 'C35';
  tipo_solo: 'argiloso_mole' | 'argiloso_medio' | 'arenoso_compacto' | 'rocha';
  // Pre-dimensionamento parametrico
  tem_subsolo: boolean;
  laje_tipo: 'macica' | 'nervurada' | 'pre_moldada';
}

export interface MemorialEstruturalOutput {
  pre_dimensionamento: {
    pilar_secao_min_cm: { b: number; h: number };        // 14×30 mínimo NBR 6118
    pilar_area_concreto_cm2: number;
    viga_secao_min_cm: { b: number; h: number };
    viga_altura_recomendada_cm: number;                  // h ≈ vao/12
    laje_espessura_min_cm: number;                       // ≥ 8 cm macica
  };
  cargas_estimadas: {
    peso_proprio_estrutura_kn_m2: number;
    carga_alvenaria_kn_m: number;
    carga_acidental_kn_m2: number;
    carga_total_pavimento_kn_m2: number;
  };
  fundacao_sugerida: {
    tipo: 'sapata_corrida' | 'sapata_isolada' | 'radier' | 'estaca_helice' | 'estaca_pre_moldada';
    tensao_admissivel_solo_kpa: number;
    area_minima_sapata_m2: number;
    profundidade_minima_m: number;
  };
  concreto: {
    classe: 'C20' | 'C25' | 'C30' | 'C35';
    fck_mpa: number;
    cobrimento_minimo_mm: number;                        // classe agressividade ambiental
    consumo_estimado_m3: number;                         // volume total
  };
  aco: {
    taxa_kg_m3_concreto: number;                         // residencial ~80 kg/m³
    consumo_estimado_kg: number;
  };
  parametros_aplicados: {
    coef_seguranca_solo: number;
    fator_redutor_carga: number;
  };
}

// Saida do calculator hidraulico
export interface MemorialHidraulicoOutput {
  consumo_diario_L: number;
  reservatorio: {
    volume_minimo_L: number;       // 2× consumo diario
    volume_recomendado_L: number;  // arredondado pra cima em 250 L
  };
  pesos: {
    soma_pesos: number;
    vazao_total_Ls: number;        // 0.3 × √(soma_pesos)
    detalhamento: Array<{ tipo: AparelhoHidraulico; qtd: number; peso_unit: number; peso_total: number }>;
  };
  dimensionamento_barrilete?: {
    DN_mm: number;
    velocidade_ms: number;
    status: 'OK' | 'AJUSTAR';
  };
  parametros_aplicados: {
    consumo_per_capita_L_dia: number;
    incremento_maq_lavar_L: number;
    incremento_limpeza_L: number;
    reserva_pct: number;
  };
}

// Saidas tipadas — uniao das 4 disciplinas (Fase 1+2 v3.35.0+v3.48.0).
export type MemorialOutput =
  | MemorialHidraulicoOutput
  | MemorialSanitarioOutput
  | MemorialEletricoOutput
  | MemorialEstruturalOutput;

// Snapshot extraido do PDF da planta (Revit). Heuristica pra metadados.
export interface PdfExtractionResult {
  rawText: string;
  metadados: {
    proprietario?: string;
    cpf_cnpj?: string;
    endereco?: string;
    municipio?: string;
    uf?: string;
    area_lote_m2?: number;
    area_construida_m2?: number;
    taxa_ocupacao_pct?: number;
    coef_aproveitamento?: number;
    num_pavimentos?: number;
    prancha_codigo?: string;       // PH-03, PS-04, PE-05, etc.
    prancha_titulo?: string;
    quadra?: string;
    lote?: string;
  };
  tabelas: TabelaExtraida[];
  produtos_inexistentes: ProdutoInexistente[];
  observacoes_extracao: string[];
  confianca: number;               // 0.0 a 1.0
}

export interface TabelaExtraida {
  titulo: string;
  cabecalho: string[];
  linhas: string[][];
  num_linhas: number;
}

export interface ProdutoInexistente {
  contexto: string;                // ~200 chars antes/depois do match
  quantidade: number;
}
