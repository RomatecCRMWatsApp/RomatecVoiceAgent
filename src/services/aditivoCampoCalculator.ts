// v3.29.0: calculator standalone do aditivo de campo (insalubridade/periculosidade).
//
// Decisoes:
//   - Base de calculo = diarias tecnico + diarias equipamento (decisao
//     comercial defensavel, documentada no texto do PDF).
//   - Insalubridade e Periculosidade sao excludentes (CLT art. 193 §2o).
//   - Templates de texto vem do DB (tabela aditivo_campo_config seedada).
//   - Observacao tecnica do tecnico e' concatenada ao texto do PDF.
//   - Snapshot: o caller persiste em propostas_aditivos_campo o texto_pdf_md
//     do MOMENTO da criacao — se admin editar template depois, propostas
//     antigas mantem o texto original (auditoria).
//
// Modulo standalone — toma o repo via injecao pra ser testavel sem mysql.

export type AditivoTipo = 'insalubridade' | 'periculosidade';
export type AditivoGrau = 'minimo' | 'medio' | 'maximo' | 'unico';

export interface AditivoConfig {
  id: number;
  tipo: AditivoTipo;
  grau: AditivoGrau;
  percentual: number;
  descricao_curta: string;
  fundamentacao_legal: string;
  texto_explicativo_md: string;
  ativo: boolean;
}

export interface AditivoCampoInput {
  tipo: AditivoTipo;
  grau: AditivoGrau;
  base_calculo: {
    diarias_tecnico_valor: number;
    diarias_equipamento_valor: number;
  };
  observacao_tecnica?: string;
}

export interface AditivoCampoResultado {
  config_id: number;
  tipo: AditivoTipo;
  grau: AditivoGrau;
  percentual: number;
  base_calculo_descricao: string;
  base_calculo_valor: number;
  valor_aditivo: number;
  descricao_curta: string;
  fundamentacao_legal: string;
  texto_pdf_md: string;
}

export interface AditivoConfigRepoLike {
  findByTipoGrau(tipo: AditivoTipo, grau: AditivoGrau): Promise<AditivoConfig | null>;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function validarCombinacao(tipo: AditivoTipo, grau: AditivoGrau): void {
  if (tipo === 'periculosidade' && grau !== 'unico') {
    throw new Error('Periculosidade so aceita grau "unico" (30%)');
  }
  if (tipo === 'insalubridade' && grau === 'unico') {
    throw new Error('Insalubridade so aceita grau minimo, medio ou maximo');
  }
}

export async function calcularAditivoCampo(
  input: AditivoCampoInput,
  repo: AditivoConfigRepoLike,
): Promise<AditivoCampoResultado> {
  validarCombinacao(input.tipo, input.grau);

  const config = await repo.findByTipoGrau(input.tipo, input.grau);
  if (!config) {
    throw new Error(`Config nao encontrada para ${input.tipo}/${input.grau}`);
  }
  if (!config.ativo) {
    throw new Error(`Config ${input.tipo}/${input.grau} esta desativada`);
  }

  const dtec = Number(input.base_calculo.diarias_tecnico_valor) || 0;
  const deq = Number(input.base_calculo.diarias_equipamento_valor) || 0;
  if (dtec < 0 || deq < 0) {
    throw new Error('base_calculo: valores nao podem ser negativos');
  }
  const base = round2(dtec + deq);
  const valor = round2((base * config.percentual) / 100);

  let texto = config.texto_explicativo_md;
  const obs = (input.observacao_tecnica ?? '').trim();
  if (obs) {
    texto += `\n\n**Observacao tecnica especifica desta proposta:**\n${obs}`;
  }

  return {
    config_id: config.id,
    tipo: input.tipo,
    grau: input.grau,
    percentual: config.percentual,
    base_calculo_descricao: 'Diarias tecnico + Diarias equipamento',
    base_calculo_valor: base,
    valor_aditivo: valor,
    descricao_curta: config.descricao_curta,
    fundamentacao_legal: config.fundamentacao_legal,
    texto_pdf_md: texto,
  };
}
