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
