// v3.35.0: catalogo de perguntas do wizard por disciplina. Estatico e tipado.
// Frontend lê via /api/memoriais/:disciplina/wizard.

import type { DisciplinaMemorial } from './types';

export type WizardCampoTipo = 'select' | 'multiselect' | 'number' | 'text' | 'boolean' | 'confirm_or_correct' | 'date';

export interface WizardCampo {
  id: string;
  label: string;
  tipo: WizardCampoTipo;
  required?: boolean;
  opcoes?: string[];
  min?: number;
  max?: number;
  default?: unknown;
  placeholder?: string;
  fonte?: string;          // referencia ao pdf_extracted_data
  visivel_se?: string;     // expressao simples (eval no front)
  hint?: string;
  aplicavel_disciplinas?: DisciplinaMemorial[];
}

const PERGUNTAS_COMUNS: WizardCampo[] = [
  {
    id: 'uso_edificacao',
    label: 'Uso da edificacao',
    tipo: 'select',
    opcoes: ['Residencial unifamiliar', 'Residencial multifamiliar', 'Comercial', 'Industrial', 'Misto', 'Institucional'],
    default: 'Residencial unifamiliar',
    required: true,
  },
  {
    id: 'num_pessoas',
    label: 'Quantas pessoas vao residir/usar o imovel?',
    tipo: 'number',
    min: 1,
    max: 200,
    aplicavel_disciplinas: ['hidraulico', 'sanitario'],
    required: true,
  },
  {
    id: 'confirma_area_construida',
    label: 'Confirma area construida de {AREA_DETECTADA} m²?',
    tipo: 'confirm_or_correct',
    fonte: 'pdf_extracted_data.area_construida_m2',
    required: true,
  },
  {
    id: 'num_pavimentos',
    label: 'Numero de pavimentos',
    tipo: 'number',
    min: 1,
    max: 30,
    default: 1,
    required: true,
  },
  {
    id: 'incluir_trt',
    label: 'Vincular TRT/ART a este memorial?',
    tipo: 'boolean',
    default: false,
  },
  {
    id: 'trt_numero',
    label: 'Numero da TRT/ART',
    tipo: 'text',
    placeholder: 'ex: CFT2605843459',
    visivel_se: 'incluir_trt == true',
  },
  {
    id: 'trt_data',
    label: 'Data da TRT/ART',
    tipo: 'date',
    visivel_se: 'incluir_trt == true',
  },
];

const PERGUNTAS_HIDRAULICO: WizardCampo[] = [
  ...PERGUNTAS_COMUNS,
  {
    id: 'fonte_alimentacao',
    label: 'Fonte de alimentacao de agua',
    tipo: 'select',
    opcoes: ['Rede publica (SAAE)', 'Poco artesiano', 'Cisterna + bomba', 'Mista'],
    required: true,
  },
  {
    id: 'volume_reservatorio_L',
    label: 'Volume do reservatorio (L) — deixe 0 pra calcular automaticamente',
    tipo: 'number',
    default: 0,
    min: 0,
    max: 50000,
  },
  {
    id: 'tem_aquecimento',
    label: 'Possui aquecimento de agua?',
    tipo: 'select',
    opcoes: ['Nao', 'Eletrico (chuveiro/boiler)', 'Gas', 'Solar'],
    default: 'Eletrico (chuveiro/boiler)',
  },
  {
    id: 'tem_maquina_lavar',
    label: 'Possui ponto pra maquina de lavar?',
    tipo: 'boolean',
    default: true,
  },
  {
    id: 'tem_limpeza_externa',
    label: 'Possui ponto de limpeza externa (mangueira/jardim)?',
    tipo: 'boolean',
    default: true,
  },
];

// v3.48.0 — Fase 2: Sanitario (NBR 8160 + 10844), Eletrico (NBR 5410), Estrutural (NBR 6118)
const PERGUNTAS_SANITARIO: WizardCampo[] = [
  ...PERGUNTAS_COMUNS,
  {
    id: 'area_cobertura_m2',
    label: 'Area de cobertura (telhado/laje) contribuinte para aguas pluviais (m²)',
    tipo: 'number', min: 1, required: true,
  },
  {
    id: 'intensidade_pluv_mmh',
    label: 'Intensidade pluviometrica (mm/h) — default Acailandia/MA = 150',
    tipo: 'number', default: 150, min: 50, max: 300,
  },
  {
    id: 'destino_efluente',
    label: 'Destino do efluente',
    tipo: 'select',
    opcoes: ['Rede publica', 'Fossa + sumidouro', 'Fossa + filtro anaerobio', 'ETA compacta'],
    required: true,
  },
  {
    id: 'tem_caixa_gordura',
    label: 'Possui caixa de gordura?',
    tipo: 'boolean', default: true,
  },
];

const PERGUNTAS_ELETRICO: WizardCampo[] = [
  ...PERGUNTAS_COMUNS,
  {
    id: 'tensao_nominal_v',
    label: 'Tensao nominal da entrada (V)',
    tipo: 'select',
    opcoes: ['127', '220', '380'],
    default: '220', required: true,
  },
  {
    id: 'tipo_alimentacao',
    label: 'Tipo de alimentacao',
    tipo: 'select',
    opcoes: ['Monofasico', 'Bifasico', 'Trifasico'],
    default: 'Bifasico', required: true,
  },
  {
    id: 'comprimento_ramal_m',
    label: 'Comprimento do ramal de entrada (m) — distancia padrao a' + ' rede',
    tipo: 'number', min: 1, default: 30, required: true,
  },
  {
    id: 'fator_demanda',
    label: 'Padrao de demanda',
    tipo: 'select',
    opcoes: ['Residencial', 'Comercial'],
    default: 'Residencial', required: true,
  },
];

const PERGUNTAS_ESTRUTURAL: WizardCampo[] = [
  ...PERGUNTAS_COMUNS,
  {
    id: 'vao_medio_pilares_m',
    label: 'Vao medio entre pilares (m)',
    tipo: 'number', min: 2, max: 12, default: 4, required: true,
  },
  {
    id: 'classe_concreto',
    label: 'Classe de concreto',
    tipo: 'select',
    opcoes: ['C20', 'C25', 'C30', 'C35'],
    default: 'C25', required: true,
  },
  {
    id: 'tipo_solo',
    label: 'Tipo de solo (laudo geotecnico ou estimativa regional)',
    tipo: 'select',
    opcoes: ['Argiloso mole', 'Argiloso medio', 'Arenoso compacto', 'Rocha'],
    default: 'Arenoso compacto', required: true,
  },
  {
    id: 'laje_tipo',
    label: 'Tipo de laje',
    tipo: 'select',
    opcoes: ['Macica', 'Nervurada', 'Pre-moldada'],
    default: 'Macica', required: true,
  },
  {
    id: 'tem_subsolo',
    label: 'Tem subsolo?',
    tipo: 'boolean', default: false,
  },
  {
    id: 'carga_acidental_kn_m2',
    label: 'Carga acidental (kN/m²) — NBR 6120: residencial 1,5 · comercial 2,5',
    tipo: 'number', min: 1, max: 10, default: 1.5,
  },
];

// Placeholder pra disciplinas ainda nao implementadas
const PLACEHOLDER_EM_BREVE: WizardCampo[] = [
  ...PERGUNTAS_COMUNS,
  {
    id: '_em_breve',
    label: 'Disciplina em desenvolvimento — disponivel em release futura.',
    tipo: 'text',
    placeholder: 'Disciplina ainda nao implementada.',
  },
];

export function obterWizardDisciplina(disciplina: DisciplinaMemorial): {
  disciplina: DisciplinaMemorial;
  campos: WizardCampo[];
  disponivel: boolean;
} {
  if (disciplina === 'hidraulico') return { disciplina, campos: PERGUNTAS_HIDRAULICO, disponivel: true };
  if (disciplina === 'sanitario') return { disciplina, campos: PERGUNTAS_SANITARIO, disponivel: true };
  if (disciplina === 'eletrico')  return { disciplina, campos: PERGUNTAS_ELETRICO,  disponivel: true };
  if (disciplina === 'estrutural') return { disciplina, campos: PERGUNTAS_ESTRUTURAL, disponivel: true };
  return { disciplina, campos: PLACEHOLDER_EM_BREVE, disponivel: false };
}

export function listarDisciplinasDisponiveis(): Array<{ slug: DisciplinaMemorial; rotulo: string; icone: string; norma: string; disponivel: boolean }> {
  return [
    { slug: 'arquitetonico', rotulo: 'Arquitetonico', icone: '[A]', norma: 'NBR/SINAPI',  disponivel: false },
    { slug: 'eletrico',      rotulo: 'Eletrico',      icone: '[E]', norma: 'NBR 5410',    disponivel: true  },
    { slug: 'hidraulico',    rotulo: 'Hidraulico',    icone: '[H]', norma: 'NBR 5626',    disponivel: true  },
    { slug: 'sanitario',     rotulo: 'Sanitario',     icone: '[S]', norma: 'NBR 8160',    disponivel: true  },
    { slug: 'estrutural',    rotulo: 'Estrutural',    icone: '[Es]', norma: 'NBR 6118',   disponivel: true  },
    { slug: 'pci',           rotulo: 'PCI',           icone: '[P]', norma: 'NBR 9077',    disponivel: false },
  ];
}
