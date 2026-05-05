// v1.66.0: tipos compartilhados do motor de calculo de Proposta de Consultoria.
// 5 secoes do PDF: projetos (escopo) + taxas terceiros + honorarios + checklist + total.

export type SubtipoConsultoria =
  | 'averbacao_residencial'
  | 'averbacao_comercial'
  | 'georreferenciamento_rural'
  | 'desmembramento'
  | 'remembramento'
  | 'retificacao_area'
  | 'avaliacao_ptam';

export type PadraoConstrutivo = 'popular' | 'normal' | 'alto';
export type ResponsavelObra = 'PF' | 'PJ_com_contabilidade' | 'PJ_sem_contabilidade';
export type AnotacaoTecnica = 'art_crea' | 'rrt_cau' | 'trt_cft';

export interface ItemCusto {
  ordem: number;
  descricao: string;
  valor: number;
  observacao?: string;
  pendente?: boolean; // true quando valor nao confirmado (ex: Habite-se Prefeitura)
}

export interface DocumentoChecklist {
  texto: string;
  obrigatorio: boolean;
  imprescindivel?: boolean; // destaque vermelho (IPTU em desm/rem)
}

export interface CustosCalculados {
  secao_1_projetos: string[];               // lista descritiva dos projetos a confeccionar
  secao_2_taxas: ItemCusto[];                // emolumentos, INSS, ART, taxas Prefeitura
  secao_3_honorarios: ItemCusto[];           // sempre 2 linhas: projeto + assessoria
  secao_4_checklist: DocumentoChecklist[];   // documentos do cliente
  secao_5_total: number;                     // soma das secoes 2 + 3
  avisos: string[];                          // ex: aviso SERO, aviso Prefeitura
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
}

export interface InputDesmembramento {
  tipo: 'desmembramento' | 'remembramento';
  area_total_m2: number;
  numero_lotes_resultantes?: number;
  numero_lotes_origem?: number;
  valor_venal_total: number;
  tipo_zona: 'urbana' | 'rural';
  iptu_em_dia: boolean;
  honorario_projeto_sm: 0.5 | 1.0;
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
