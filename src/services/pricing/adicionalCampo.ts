// v3.33.0 (= v3.27.1 do prompt): adicional de insalubridade/periculosidade
// REFACTOR — substitui select(tipo, grau) livre por wizard estruturado de
// CENARIO (enum fechado, 5 opcoes). Cada cenario carrega automaticamente:
//   1. Bloco Fundamento Legal     — citacao literal de norma (NAO editavel)
//   2. Bloco Enquadramento Tecnico — texto editavel pelo tecnico
//   3. Bloco Justificativa Cliente — texto editavel pelo tecnico
//
// Sensibilidade juridica: textos vao para PDF que cliente recebe e podem ser
// questionados em juizo. Por isso:
//   - Textos congelados em pricing-params.json
//   - Snapshot da norma vigente gravado em cada proposta (data + versao)
//   - Bump de revisao NAO atualiza textos (mantem redacao da epoca)
//   - PDF tem hash SHA-256 que inclui os 3 blocos
//
// Substitui aditivoCampoCalculator.ts da v3.29.0 (mantido por compat retro).
// Modulo standalone — sem deps de mysql/pdfkit/express.

import { getParams } from './params';

export type CenarioAdicional =
  | 'mata_densa_animais'
  | 'rodovia_faixa_dominio'
  | 'eletricidade_alta_tensao'
  | 'pedreira_explosivos'
  | 'produtos_quimicos';

export type AdicionalTipo = 'insalubridade' | 'periculosidade';
export type AdicionalGrau = 'minimo' | 'medio' | 'maximo' | 'unico';

export interface NormaSnapshot {
  fonte: string;
  versao_referencia: string;
  data_snapshot: string;
}

export interface AdicionalCalcInput {
  ativo: boolean;
  cenario?: CenarioAdicional;
  tipo?: AdicionalTipo;
  grau?: AdicionalGrau;
  bloco_enquadramento_tecnico_editado?: string;
  bloco_justificativa_cliente_editado?: string;
  observacao_adicional?: string;
}

export interface AdicionalCalcOutput {
  ativo: boolean;
  percentual: number;
  cenario: CenarioAdicional | null;
  tipo: AdicionalTipo | null;
  grau: AdicionalGrau | null;
  norma_vigente_congelada: NormaSnapshot;
  bloco_fundamento_legal: string;
  bloco_enquadramento_tecnico: string;
  bloco_justificativa_cliente: string;
  bloco_2_customizado: boolean;
  bloco_3_customizado: boolean;
  observacao_adicional: string;
}

const CENARIOS_PERICULOSOS = new Set<CenarioAdicional>([
  'rodovia_faixa_dominio',
  'eletricidade_alta_tensao',
  'pedreira_explosivos',
]);

const CENARIOS_INSALUBRES = new Set<CenarioAdicional>([
  'mata_densa_animais',
  'produtos_quimicos',
]);

export function validarCombinacao(input: {
  cenario: CenarioAdicional;
  tipo: AdicionalTipo;
  grau: AdicionalGrau;
}): void {
  // Periculosidade so admite grau='unico'
  if (input.tipo === 'periculosidade' && input.grau !== 'unico') {
    throw new Error("Periculosidade so admite grau 'unico' (30%) — CLT art. 193");
  }
  // Insalubridade nao admite grau='unico'
  if (input.tipo === 'insalubridade' && input.grau === 'unico') {
    throw new Error("Insalubridade nao admite grau 'unico' — escolha minimo/medio/maximo (CLT art. 192)");
  }
  // Cenarios fixos por tipo
  if (CENARIOS_PERICULOSOS.has(input.cenario) && input.tipo !== 'periculosidade') {
    throw new Error(`Cenario '${input.cenario}' so admite tipo='periculosidade'`);
  }
  if (input.cenario === 'mata_densa_animais' && input.tipo !== 'insalubridade') {
    throw new Error("Cenario 'mata_densa_animais' so admite tipo='insalubridade'");
  }
  // produtos_quimicos aceita insalubridade em qualquer grau
}

function calcularPercentual(tipo: AdicionalTipo, grau: AdicionalGrau, cfgPercentuais: NonNullable<ReturnType<typeof getParams>['adicional_campo_2026']>['percentuais']): number {
  if (tipo === 'insalubridade') return cfgPercentuais.insalubridade[grau as 'minimo' | 'medio' | 'maximo'];
  if (tipo === 'periculosidade') return cfgPercentuais.periculosidade.unico;
  throw new Error(`Tipo desconhecido: ${tipo}`);
}

function outputZerado(snapshot: NormaSnapshot): AdicionalCalcOutput {
  return {
    ativo: false,
    percentual: 0,
    cenario: null,
    tipo: null,
    grau: null,
    norma_vigente_congelada: snapshot,
    bloco_fundamento_legal: '',
    bloco_enquadramento_tecnico: '',
    bloco_justificativa_cliente: '',
    bloco_2_customizado: false,
    bloco_3_customizado: false,
    observacao_adicional: '',
  };
}

export function calcularAdicionalCampo(input: AdicionalCalcInput): AdicionalCalcOutput {
  const params = getParams();
  const cfg = params.adicional_campo_2026;
  if (!cfg) throw new Error('Bloco adicional_campo_2026 ausente em pricing-params.json');

  const snapshot: NormaSnapshot = {
    fonte: cfg.norma_vigente.versao_referencia_geral.split(' + ')[0] || cfg.norma_vigente.versao_referencia_geral,
    versao_referencia: cfg.norma_vigente.versao_referencia_geral,
    data_snapshot: cfg.norma_vigente.data_snapshot,
  };

  if (!input.ativo) {
    return outputZerado(snapshot);
  }

  if (!input.cenario) {
    throw new Error('cenario obrigatorio quando ativo=true');
  }
  const cenarioCfg = cfg.cenarios[input.cenario];
  if (!cenarioCfg) {
    throw new Error(`Cenario desconhecido: ${input.cenario}`);
  }

  // Determinar tipo e grau (default vem do cenario; produtos_quimicos permite grau variavel)
  const tipo: AdicionalTipo = (input.tipo ?? cenarioCfg.tipo_padrao) as AdicionalTipo;
  const grau: AdicionalGrau = (input.grau ?? cenarioCfg.grau_padrao) as AdicionalGrau;

  validarCombinacao({ cenario: input.cenario, tipo, grau });

  // Bloco 1: SEMPRE do pricing-params (nao editavel)
  const bloco1 = cenarioCfg.bloco_fundamento_legal;

  // Bloco 2: padrao depende do cenario (produtos_quimicos varia por grau)
  let bloco2Padrao: string;
  const cenarioQuimicos = cenarioCfg as unknown as { bloco_enquadramento_tecnico_por_grau?: Record<string, string> };
  if (input.cenario === 'produtos_quimicos' && cenarioQuimicos.bloco_enquadramento_tecnico_por_grau) {
    bloco2Padrao = cenarioQuimicos.bloco_enquadramento_tecnico_por_grau[grau];
  } else {
    bloco2Padrao = cenarioCfg.bloco_enquadramento_tecnico;
  }
  const bloco2Editado = (input.bloco_enquadramento_tecnico_editado ?? '').trim();
  const bloco2Final = bloco2Editado || bloco2Padrao;
  const bloco_2_customizado = bloco2Final !== bloco2Padrao;

  // Bloco 3: padrao do cenario
  const bloco3Padrao = cenarioCfg.bloco_justificativa_cliente;
  const bloco3Editado = (input.bloco_justificativa_cliente_editado ?? '').trim();
  const bloco3Final = bloco3Editado || bloco3Padrao;
  const bloco_3_customizado = bloco3Final !== bloco3Padrao;

  const percentual = calcularPercentual(tipo, grau, cfg.percentuais);

  // Observacao adicional limitada
  const limite = cfg.limite_observacao_adicional_chars ?? 500;
  const obs = (input.observacao_adicional ?? '').substring(0, limite);

  return {
    ativo: true,
    percentual,
    cenario: input.cenario,
    tipo,
    grau,
    norma_vigente_congelada: snapshot,
    bloco_fundamento_legal: bloco1,
    bloco_enquadramento_tecnico: bloco2Final,
    bloco_justificativa_cliente: bloco3Final,
    bloco_2_customizado,
    bloco_3_customizado,
    observacao_adicional: obs,
  };
}

// Listagem dos cenarios pra UI (frontend usa esse endpoint pra montar select).
export function listarCenarios(): Array<{
  slug: CenarioAdicional;
  rotulo: string;
  tipo_padrao: AdicionalTipo;
  grau_padrao: AdicionalGrau;
  percentual_padrao: number;
  icone: string;
  graus_disponiveis?: AdicionalGrau[];
}> {
  const cfg = getParams().adicional_campo_2026;
  if (!cfg) return [];
  return Object.entries(cfg.cenarios).map(([slug, c]) => ({
    slug: slug as CenarioAdicional,
    rotulo: c.rotulo,
    tipo_padrao: c.tipo_padrao as AdicionalTipo,
    grau_padrao: c.grau_padrao as AdicionalGrau,
    percentual_padrao: c.percentual_padrao,
    icone: c.icone,
    graus_disponiveis: (c as unknown as { graus_disponiveis?: AdicionalGrau[] }).graus_disponiveis,
  }));
}
