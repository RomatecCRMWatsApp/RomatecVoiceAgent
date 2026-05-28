// v3.43.0: helper standalone (sem deps de mysql/voyageai/pdfkit) para enforçar
// a obrigatoriedade do adicional de campo (insalubridade/periculosidade) em
// demarcacao_rural.
//
// Motivacao: trabalho em mata rural SEMPRE expoe a riscos biologicos previstos
// no Anexo 14 da NR-15 (animais peconhentos, vetores de doencas tropicais,
// microrganismos). O adicional nao e' discricionario — e' exigencia legal
// (CLT art. 192). A nao-aplicacao caracterizaria infracao trabalhista e
// exporia contratante e contratado a passivos legais.
//
// Para demarcacao_urbana o adicional continua opcional (lote urbano nao expoe
// equipe a mata densa, apenas a riscos pontuais — eletricidade, transito, etc).

export interface AdicionalEfetivo {
  ativo: boolean;
  cenario: string;
  tipo: string;
  grau: string;
  bloco_enquadramento_tecnico_editado?: string;
  bloco_justificativa_cliente_editado?: string;
  observacao_adicional?: string;
}

export interface AdicionalInput {
  ativo?: boolean;
  cenario?: string;
  tipo?: string;
  grau?: string;
  bloco_enquadramento_tecnico_editado?: string;
  bloco_justificativa_cliente_editado?: string;
  observacao_adicional?: string;
}

/**
 * - Se o caller enviou `adicional.ativo=true` com cenario/tipo/grau completos
 *   (user escolheu via wizard), respeita o que veio.
 * - Se NAO enviou OU enviou inativo/incompleto em `demarcacao_rural`, FORCA
 *   default `mata_densa_animais` + `insalubridade` Grau Medio (20%).
 * - Para `demarcacao_urbana`, retorna `null` quando nao ativo (opcional).
 * - Para outros subtipos, retorna `null` (nao se aplica).
 */
export function aplicarAdicionalObrigatorioDemarcacao(
  subtipo: string,
  adicional: AdicionalInput | undefined | null,
): AdicionalEfetivo | null {
  // User explicitamente escolheu cenario completo — respeita
  if (adicional?.ativo && adicional.cenario && adicional.tipo && adicional.grau) {
    return {
      ativo: true,
      cenario: adicional.cenario,
      tipo: adicional.tipo,
      grau: adicional.grau,
      bloco_enquadramento_tecnico_editado: adicional.bloco_enquadramento_tecnico_editado,
      bloco_justificativa_cliente_editado: adicional.bloco_justificativa_cliente_editado,
      observacao_adicional: adicional.observacao_adicional,
    };
  }
  // Demarcacao rural — OBRIGATORIO. Aplica default (mata densa + insal medio).
  if (subtipo === 'demarcacao_rural') {
    return {
      ativo: true,
      cenario: 'mata_densa_animais',
      tipo: 'insalubridade',
      grau: 'medio',
    };
  }
  // Demarcacao urbana — opcional. Se ativo, completa fallback com Grau Minimo.
  if (subtipo === 'demarcacao_urbana' && adicional?.ativo) {
    return {
      ativo: true,
      cenario: adicional.cenario || 'mata_densa_animais',
      tipo: adicional.tipo || 'insalubridade',
      grau: adicional.grau || 'minimo',
    };
  }
  return null;
}
