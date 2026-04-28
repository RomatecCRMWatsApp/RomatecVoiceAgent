// Segmentacao semantica de contratos via Claude Sonnet — v1.27.1
// Recebe texto bruto extraido de PDF/DOCX e devolve cada clausula como
// unidade autonoma reutilizavel. NAO usa cascata IA — Claude direto pq
// instruction following preciso eh critico aqui (Cerebras 8B nao serve).

import Anthropic from '@anthropic-ai/sdk';

const SEGMENTER_MODEL = process.env.CONTRATO_SEGMENTER_MODEL || 'claude-sonnet-4-5';

let _client: Anthropic | null = null;
function claude(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export interface ClausulaSegmentada {
  ordem:           number;
  secao:           string;        // ex: 'partes', 'objeto', 'preco', 'prazo', 'rescisao', 'foro', 'outros'
  titulo_clausula: string;        // titulo curto descritivo
  texto:           string;        // texto integral da clausula
}

export interface ResultadoSegmentacao {
  resumo:    string;              // resumo executivo do contrato (1-3 frases)
  tipo:      string;              // ex: 'compra_venda', 'locacao', 'prestacao_servicos', 'comodato'...
  clausulas: ClausulaSegmentada[];
}

const SYSTEM_PROMPT = `Você é um especialista em redação de contratos imobiliários brasileiros.
Sua tarefa é segmentar o contrato fornecido em CLÁUSULAS AUTÔNOMAS REUTILIZÁVEIS.

REGRAS CRÍTICAS:
1. Cada cláusula deve ser uma UNIDADE COMPLETA que faça sentido sozinha.
2. NÃO invente texto — extraia EXATAMENTE como está no contrato (preserve numeração, parágrafos, redação).
3. Identifique a SEÇÃO de cada cláusula usando esta taxonomia fechada:
   - "partes"        : qualificação das partes (contratante/contratada)
   - "objeto"        : descrição do objeto contratado
   - "preco"         : preço, forma de pagamento, reajuste
   - "prazo"         : prazo de vigência, início, término
   - "obrigacoes"    : obrigações das partes
   - "garantias"     : garantias, fiança, caução
   - "rescisao"      : hipóteses de rescisão, multa
   - "foro"          : foro de eleição
   - "disposicoes_gerais" : disposições finais, comunicações, sucessão
   - "outros"        : qualquer coisa que não se enquadre acima
4. Cada cláusula recebe um TÍTULO CURTO (3-7 palavras) descritivo do conteúdo.
5. Identifique o TIPO geral do contrato em snake_case PT-BR (ex: 'compra_venda',
   'locacao_residencial', 'prestacao_servicos', 'permuta', 'doacao', 'comodato',
   'concessao_uso', 'corretagem_imobiliaria', 'exclusividade_venda').
6. Gere um RESUMO executivo de 1 a 3 frases que descreva o contrato.

RESPOSTA: APENAS JSON válido, sem markdown, sem texto antes ou depois, no formato:
{
  "resumo": "...",
  "tipo": "...",
  "clausulas": [
    { "ordem": 1, "secao": "partes", "titulo_clausula": "...", "texto": "..." },
    ...
  ]
}`;

export async function segmentarContrato(textoBruto: string): Promise<ResultadoSegmentacao> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY ausente — segmentacao precisa de Claude.');
  }
  // Trunca textos muito grandes (Claude Sonnet aceita 200k input mas custa caro)
  const MAX_CHARS = 80000;
  const texto = textoBruto.length > MAX_CHARS
    ? textoBruto.slice(0, MAX_CHARS) + '\n\n[...texto truncado pra segmentacao]'
    : textoBruto;

  const r = await claude().messages.create({
    model:      SEGMENTER_MODEL,
    max_tokens: 8000,
    system:     SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: `Segmente o contrato abaixo em cláusulas conforme as regras.\n\n---CONTRATO---\n${texto}\n---FIM---`,
    }],
  });

  const block = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const raw   = (block?.text ?? '').trim();
  if (!raw) throw new Error('Claude retornou resposta vazia');

  // Robusto contra eventual markdown fence
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: ResultadoSegmentacao;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`JSON invalido do segmentador: ${(err as Error).message}\nResposta crua: ${raw.slice(0, 300)}`);
  }

  if (!Array.isArray(parsed.clausulas) || parsed.clausulas.length === 0) {
    throw new Error('Segmentador retornou clausulas vazias');
  }
  // Sanity: garante ordem sequencial e secao dentro da taxonomia
  const SECOES_VALIDAS = new Set([
    'partes', 'objeto', 'preco', 'prazo', 'obrigacoes',
    'garantias', 'rescisao', 'foro', 'disposicoes_gerais', 'outros',
  ]);
  parsed.clausulas = parsed.clausulas.map((c, i) => ({
    ordem:           c.ordem ?? (i + 1),
    secao:           SECOES_VALIDAS.has(c.secao) ? c.secao : 'outros',
    titulo_clausula: c.titulo_clausula || `Cláusula ${i + 1}`,
    texto:           c.texto || '',
  })).filter(c => c.texto.trim().length > 20);

  return {
    resumo:    parsed.resumo || '',
    tipo:      parsed.tipo   || 'outro',
    clausulas: parsed.clausulas,
  };
}
