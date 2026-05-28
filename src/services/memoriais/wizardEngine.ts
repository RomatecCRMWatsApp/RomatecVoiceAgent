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

// Sanitario / Eletrico / Arquitetonico / Estrutural / PCI ficam pra PRs futuros.
const PLACEHOLDER_EM_BREVE: WizardCampo[] = [
  ...PERGUNTAS_COMUNS,
  {
    id: '_em_breve',
    label: 'Disciplina em desenvolvimento — disponivel em release futura.',
    tipo: 'text',
    placeholder: 'Disciplina ainda nao implementada (Fase 1 cobre apenas Hidraulico).',
  },
];

export function obterWizardDisciplina(disciplina: DisciplinaMemorial): {
  disciplina: DisciplinaMemorial;
  campos: WizardCampo[];
  disponivel: boolean;
} {
  if (disciplina === 'hidraulico') {
    return { disciplina, campos: PERGUNTAS_HIDRAULICO, disponivel: true };
  }
  return { disciplina, campos: PLACEHOLDER_EM_BREVE, disponivel: false };
}

export function listarDisciplinasDisponiveis(): Array<{ slug: DisciplinaMemorial; rotulo: string; icone: string; norma: string; disponivel: boolean }> {
  return [
    { slug: 'arquitetonico', rotulo: 'Arquitetonico', icone: '🏛️', norma: 'NBR/SINAPI',  disponivel: false },
    { slug: 'eletrico',      rotulo: 'Eletrico',      icone: '⚡', norma: 'NBR 5410',    disponivel: false },
    { slug: 'hidraulico',    rotulo: 'Hidraulico',    icone: '💧', norma: 'NBR 5626',    disponivel: true  },
    { slug: 'sanitario',     rotulo: 'Sanitario',     icone: '🚽', norma: 'NBR 8160',    disponivel: false },
    { slug: 'estrutural',    rotulo: 'Estrutural',    icone: '🏗️', norma: 'NBR 6118',    disponivel: false },
    { slug: 'pci',           rotulo: 'PCI',           icone: '🔥', norma: 'NBR 9077',    disponivel: false },
  ];
}
