// ZAYRA modo Engenheira Avaliadora — v1.43.0 (Frente F)
//
// Conjunto de capacidades especializadas em avaliação imobiliária baseadas
// em NBR 14653 (todas as partes), tabela TVI Romatec e jurisprudência.
//
// Pipeline padrão: query → RAG busca chunks relevantes da norma indexada →
// Claude usa esse contexto pra responder de forma fundamentada (cita parte
// da norma, item específico, página).

import Anthropic from '@anthropic-ai/sdk';
import { buscarMemoria, formatarContexto } from './ragSearch';

const CLAUDE_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-sonnet-4-5';
const _claude = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// ── 1. CONSULTAR NORMA ───────────────────────────────────────────────────────
export async function consultarNormaImobiliaria(input: {
  query:          string;
  categoria?:     string;        // ex: 'nbr14653', 'tvi', 'jurisprudencia'
  top_k?:         number;
}): Promise<{
  query: string; total_chunks: number;
  contexto_formatado: string;
  fontes: Array<{ titulo: string; categoria: string | null; pagina: number | null; relevancia_pct: number }>;
}> {
  const chunks = await buscarMemoria(input.query, {
    top_k:     input.top_k ?? 5,
    min_sim:   0.55,
    categoria: input.categoria,
  });
  return {
    query:              input.query,
    total_chunks:       chunks.length,
    contexto_formatado: formatarContexto(chunks),
    fontes:             chunks.map(c => ({
      titulo:         c.titulo,
      categoria:      c.categoria,
      pagina:         c.pagina,
      relevancia_pct: Math.round(c.similarity * 100),
    })),
  };
}

// ── 2. RASCUNHO DE PTAM (Parecer Técnico de Avaliação Mercadológica) ─────────
export interface RascunhoPtamInput {
  finalidade:           string;       // 'compra_venda', 'garantia', 'judicial', 'inventario'
  tipo_imovel:          string;       // 'urbano_residencial', 'urbano_comercial', 'rural', 'terreno'
  endereco:             string;
  area_terreno?:        number;       // m²
  area_construida?:     number;       // m²
  caracteristicas?:     string;       // descrição livre (idade, padrão, conservação)
  comparativos?:        Array<{ endereco: string; area: number; valor: number; data?: string }>;
  metodologia_sugerida?: 'comparativo_dados_mercado' | 'evolutivo' | 'involutivo' | 'renda' | 'custo';
  observacoes?:         string;
}

export async function gerarRascunhoPtam(input: RascunhoPtamInput): Promise<{
  texto_rascunho: string;
  metodologia_usada: string;
  fundamentos_nbr: string[];
  proximas_acoes: string[];
}> {
  if (!_claude) throw new Error('ANTHROPIC_API_KEY não configurada');

  // 1. Busca contexto da NBR 14653 relevante pro caso
  const queryRag = `${input.tipo_imovel} ${input.finalidade} avaliação metodologia NBR 14653`;
  const ctx = await buscarMemoria(queryRag, { top_k: 8, min_sim: 0.5 });
  const contextoNbr = formatarContexto(ctx);

  // 2. Decide metodologia se não foi sugerida
  const metodologia = input.metodologia_sugerida || (
    input.comparativos && input.comparativos.length >= 3 ? 'comparativo_dados_mercado'
    : input.tipo_imovel.includes('terreno') ? 'comparativo_dados_mercado'
    : 'evolutivo'
  );

  const compTxt = (input.comparativos || []).length === 0
    ? '_(sem comparativos fornecidos — usar pesquisa de mercado da região)_'
    : (input.comparativos || []).map((c, i) =>
        `[Comp ${i+1}] ${c.endereco} · ${c.area}m² · R$ ${c.valor.toLocaleString('pt-BR')} ${c.data ? '(' + c.data + ')' : ''}`,
      ).join('\n');

  const prompt = `Você é uma engenheira avaliadora da Romatec Consultoria, redigindo um RASCUNHO de PTAM (Parecer Técnico de Avaliação Mercadológica) em conformidade com a NBR 14653 (todas as partes aplicáveis).

CONTEXTO DA NBR (chunks indexados na biblioteca):
${contextoNbr}

DADOS DO CASO:
- Finalidade: ${input.finalidade}
- Tipo de imóvel: ${input.tipo_imovel}
- Endereço: ${input.endereco}
- Área terreno: ${input.area_terreno ?? '—'} m²
- Área construída: ${input.area_construida ?? '—'} m²
- Características: ${input.caracteristicas ?? '_(não informadas)_'}
- Metodologia escolhida: ${metodologia}
- Observações: ${input.observacoes ?? '_(nenhuma)_'}

COMPARATIVOS FORNECIDOS:
${compTxt}

REDIJA o RASCUNHO seguindo a estrutura padrão:

1. IDENTIFICAÇÃO DO IMÓVEL E SOLICITANTE
2. OBJETIVO E FINALIDADE DA AVALIAÇÃO
3. PRESSUPOSTOS, RESSALVAS E FATORES LIMITANTES
4. METODOLOGIA APLICADA (cite a parte da NBR 14653 que fundamenta)
5. CARACTERIZAÇÃO DO IMÓVEL E DA REGIÃO
6. PESQUISA DE MERCADO E TRATAMENTO DE DADOS (se comparativo)
   - Se houver comparativos fornecidos, monte tabela e calcule valor médio/m²
   - Se não houver, indique que precisa pesquisa de mercado real
7. ESTIMATIVA DO VALOR DE MERCADO
   - Calcule com base nos dados disponíveis
   - Aplique fatores de homogeneização básicos (idade, área, padrão)
8. ENQUADRAMENTO CONFORME NBR 14653 (Grau de Fundamentação)
9. CONCLUSÃO E VALOR FINAL
10. ANEXOS NECESSÁRIOS (lista o que falta — fotos, matrícula, etc)

IMPORTANTE:
- Esse é RASCUNHO. Sinalize claramente "[RASCUNHO — REVISAR]" no topo.
- Use linguagem técnica adequada (perito).
- Cite NBR 14653-X (parte específica) quando aplicável.
- NÃO invente comparativos ausentes — se faltam dados, descreva o que falta.
- No final, liste explicitamente as PRÓXIMAS AÇÕES que o engenheiro humano precisa fazer (vistoria in loco, fotos, certidões, ART, etc).

Retorne APENAS o texto do rascunho. Nada de markdown ao redor, nada de explicação prévia.`;

  const r = await _claude.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 6000,
    messages:   [{ role: 'user', content: prompt }],
  });
  const textBlock = r.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  const texto = (textBlock?.text || '').trim();

  return {
    texto_rascunho:    texto,
    metodologia_usada: metodologia,
    fundamentos_nbr:   ctx.slice(0, 5).map(c => `${c.titulo}${c.pagina ? ' p.' + c.pagina : ''}`),
    proximas_acoes:    [
      'Vistoria técnica in loco com registro fotográfico',
      'Certidão de matrícula atualizada (até 30 dias)',
      'IPTU do imóvel',
      'Pesquisa de mercado de pelo menos 5 comparativos reais',
      'Aplicação de fatores de homogeneização específicos da NBR 14653-2',
      'Emissão de ART CREA-MA do responsável técnico',
      'Revisão técnica do laudo final pelo engenheiro avaliador',
    ],
  };
}

// ── 3. VALIDAR LAUDO (review automático) ─────────────────────────────────────
export async function validarLaudoAvaliacao(input: {
  texto_laudo: string;
}): Promise<{
  conformidades:   string[];
  divergencias:    Array<{ severidade: 'critica'|'alta'|'media'|'baixa'; item: string; recomendacao: string }>;
  pontuacao:       number;        // 0-100
  parecer_geral:   string;
}> {
  if (!_claude) throw new Error('ANTHROPIC_API_KEY não configurada');
  if (!input.texto_laudo || input.texto_laudo.length < 200) {
    throw new Error('Texto do laudo muito curto pra revisão (<200 chars)');
  }

  const ctx = await buscarMemoria('NBR 14653 grau de fundamentação requisitos obrigatórios laudo', { top_k: 6, min_sim: 0.5 });
  const contextoNbr = formatarContexto(ctx);

  const prompt = `Você é uma engenheira avaliadora sênior revisando um LAUDO de outro perito conforme NBR 14653.

CONTEXTO DA NBR:
${contextoNbr}

LAUDO PRA REVISAR:
${input.texto_laudo.slice(0, 12000)}

Faça revisão crítica e retorne JSON ESTRUTURADO (sem markdown, apenas o objeto):

{
  "conformidades": ["item conforme com NBR 1", "item 2", ...],
  "divergencias": [
    { "severidade": "critica|alta|media|baixa", "item": "o que está errado/faltando", "recomendacao": "como corrigir" }
  ],
  "pontuacao": número de 0 a 100 baseado em conformidade NBR,
  "parecer_geral": "parágrafo único sintetizando se o laudo está aceitável ou precisa correções"
}

CRITÉRIOS DE AVALIAÇÃO (verificar TODOS):
1. Identificação completa do imóvel, solicitante, finalidade, data
2. Metodologia adequada e justificada (NBR 14653-1 e parte específica)
3. Pesquisa de mercado consistente (qtd elementos, fatores)
4. Tratamento estatístico dos dados (média, mediana, desvio)
5. Fatores de homogeneização aplicados e fundamentados
6. Cálculo da estimativa final transparente
7. Grau de fundamentação declarado (I, II ou III)
8. Grau de precisão declarado
9. Pressupostos, ressalvas e fatores limitantes claros
10. Anexos esperados (matrícula, fotos, ART)

Severidades:
- critica: impede uso do laudo (faltou ART, finalidade, metodologia)
- alta: precisa refazer seções (pesquisa fraca, sem fatores)
- media: ajuste textual (linguagem, redação)
- baixa: cosmético

Retorne APENAS o JSON.`;

  const r = await _claude.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 3000,
    messages:   [{ role: 'user', content: prompt }],
  });
  const textBlock = r.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  let raw = (textBlock?.text || '').trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(raw) as Awaited<ReturnType<typeof validarLaudoAvaliacao>>;
  } catch {
    throw new Error(`Claude retornou JSON inválido na validação. Início: ${raw.slice(0, 200)}…`);
  }
}

// ── 4. SUGERIR METODOLOGIA ───────────────────────────────────────────────────
export async function sugerirMetodologiaAvaliacao(input: {
  tipo_imovel:  string;
  finalidade:   string;
  tem_comparativos?: boolean;
  tem_renda_locativa?: boolean;
  caracteristicas?: string;
}): Promise<{
  metodologia_principal: string;
  metodologia_secundaria?: string;
  parte_nbr:    string;
  justificativa: string;
}> {
  // Lógica determinística simples + RAG pra fundamentação
  const tipo = input.tipo_imovel.toLowerCase();
  let principal = 'comparativo_dados_mercado';
  let parte = 'NBR 14653-1 (geral) + NBR 14653-2 (urbanos)';
  let just  = 'Método preferencial sempre que houver dados de mercado suficientes (recomendado pela NBR).';

  if (tipo.includes('rural')) {
    parte = 'NBR 14653-3';
    just  = 'Imóvel rural — aplicar NBR 14653-3 que trata de avaliação rural específica.';
  } else if (tipo.includes('semovente') || tipo.includes('rebanho')) {
    principal = 'comparativo_dados_mercado';
    parte = 'NBR 14653-6';
    just  = 'Semoventes (gado, etc) — NBR 14653-6.';
  } else if (input.tem_renda_locativa) {
    principal = 'renda';
    parte = 'NBR 14653-1 / NBR 14653-2';
    just  = 'Imóvel com renda locativa estabelecida — método da renda apropriado quando há dados consistentes de receita líquida.';
  } else if (!input.tem_comparativos) {
    principal = 'evolutivo';
    parte = 'NBR 14653-1 + NBR 14653-2';
    just  = 'Sem comparativos — método evolutivo (custo de reprodução depreciado + valor da terra).';
  }

  return {
    metodologia_principal: principal,
    metodologia_secundaria: principal === 'comparativo_dados_mercado' ? 'evolutivo (suporte)' : 'comparativo (validação)',
    parte_nbr:    parte,
    justificativa: just,
  };
}

// ── 5. ANALISAR COMPARATIVOS (homogeneização) ────────────────────────────────
export interface Comparativo {
  endereco: string;
  area:     number;       // m²
  valor:    number;       // R$
  data?:    string;
  fator_idade?:    number;   // 0.95 = 5% desconto por mais antigo
  fator_padrao?:   number;
  fator_conservacao?: number;
}

export function analisarComparativos(input: {
  comparativos: Comparativo[];
  area_subjeito: number;
  data_referencia?: string;
}): {
  total_amostras:    number;
  valor_m2_min:      number;
  valor_m2_max:      number;
  valor_m2_medio:    number;
  valor_m2_mediano:  number;
  desvio_padrao:     number;
  coeficiente_variacao: number;     // %
  valor_estimado_imovel: number;
  observacoes:       string[];
} {
  const c = input.comparativos.filter(x => x.area > 0 && x.valor > 0);
  if (c.length < 2) throw new Error('Mínimo 2 comparativos pra análise (NBR exige 3+ pra fundamentação grau II).');

  const valoresM2 = c.map(x => {
    const fator = (x.fator_idade ?? 1) * (x.fator_padrao ?? 1) * (x.fator_conservacao ?? 1);
    return (x.valor / x.area) * fator;
  });
  valoresM2.sort((a, b) => a - b);

  const min     = valoresM2[0];
  const max     = valoresM2[valoresM2.length - 1];
  const media   = valoresM2.reduce((s, v) => s + v, 0) / valoresM2.length;
  const mediana = valoresM2.length % 2 === 0
    ? (valoresM2[valoresM2.length/2 - 1] + valoresM2[valoresM2.length/2]) / 2
    : valoresM2[Math.floor(valoresM2.length/2)];
  const variancia = valoresM2.reduce((s, v) => s + Math.pow(v - media, 2), 0) / valoresM2.length;
  const desvio    = Math.sqrt(variancia);
  const cv        = (desvio / media) * 100;

  const obs: string[] = [];
  if (c.length < 3) obs.push('⚠️ Apenas 2 comparativos — abaixo do mínimo NBR 14653-2 pra grau de fundamentação II (5+) ou III (3+).');
  if (cv > 30) obs.push(`⚠️ Coef. de variação ${cv.toFixed(1)}% > 30% — amostra muito dispersa, recomenda-se buscar mais dados ou aplicar fatores de homogeneização adicionais.`);
  if (cv < 10) obs.push(`✅ Coef. de variação ${cv.toFixed(1)}% < 10% — amostra muito homogênea, alta confiança no resultado.`);

  return {
    total_amostras:    c.length,
    valor_m2_min:      Math.round(min * 100) / 100,
    valor_m2_max:      Math.round(max * 100) / 100,
    valor_m2_medio:    Math.round(media * 100) / 100,
    valor_m2_mediano:  Math.round(mediana * 100) / 100,
    desvio_padrao:     Math.round(desvio * 100) / 100,
    coeficiente_variacao: Math.round(cv * 100) / 100,
    valor_estimado_imovel: Math.round(media * input.area_subjeito * 100) / 100,
    observacoes:       obs,
  };
}
