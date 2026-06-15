// v3.66.0: extração elétrica multimodal (IA lê o PDF da planta) — MÓDULO ISOLADO.
// NÃO importa aiCascade/tools/think. Usa os SDKs diretamente.
// parseRespostaExtracao / validarExtracao são PUROS (testáveis sem rede).

import type {
  ExtracaoEletrica, CircuitoEletrico, PontosEletricos, TipoCircuito, TipoAlimentacao,
} from './eletricoExtracaoTypes';
import { PONTOS_ZERO, LANCE_DEFAULT_M } from './eletricoExtracaoTypes';

function num(v: unknown, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function str(v: unknown, d = ''): string { return v == null ? d : String(v); }

const PROMPT_EXTRACAO = `Você é engenheiro eletricista. Analise esta PRANCHA DE PROJETO ELÉTRICO (PE) e
extraia os dados de instalação elétrica predial. Responda APENAS com um objeto JSON válido (sem texto fora do JSON),
no schema:
{"obra":{"titulo","endereco","municipio","uf","proprietario","cpfCnpj","areaConstruidaM2","areaLoteM2","taxaOcupacaoPct","nPavimentos","prancha","dataProjeto"},
"alimentacao":{"tipo":"monofasico|bifasico|trifasico","tensaoV","ramalSecaoMm2","disjuntorGeralA","piVA","pdVA"},
"circuitos":[{"id","descricao","tipo":"ilum|tug|tue","disjuntorA","polos","condutorFaseMm2","condutorProtecaoMm2","potenciaVA"}],
"pontos":{"iluminacao","tug10A","tue20A","interruptorSimples","interruptorParalelo","interruptorIntermediario","conjuntos","tomadasPiso"},
"eletrodutos":[{"tipo","diametro","comprimentoM"}],"caixas":[{"tipo","qtd"}],"confianca":0a1,"observacoes":[],"divergencias":[]}
Use o Diagrama Unifilar / Quadro de Cargas (QDFL) para os circuitos e a Lista de Materiais/Componentes para pontos e caixas.
Se um valor não existir na prancha, use null. NÃO invente quantidades.`;

export function parseRespostaExtracao(raw: string): ExtracaoEletrica {
  const limpo = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const ini = limpo.indexOf('{'); const fim = limpo.lastIndexOf('}');
  if (ini < 0 || fim < 0) throw new Error('Resposta sem JSON');
  const obj = JSON.parse(limpo.slice(ini, fim + 1)) as Record<string, unknown>;

  const o = (obj.obra ?? {}) as Record<string, unknown>;
  const a = (obj.alimentacao ?? {}) as Record<string, unknown>;
  const pin = (obj.pontos ?? {}) as Record<string, unknown>;

  const circuitos: CircuitoEletrico[] = Array.isArray(obj.circuitos)
    ? (obj.circuitos as Record<string, unknown>[]).map((c, i) => ({
        id: str(c.id, `C${i + 1}`),
        descricao: str(c.descricao),
        tipo: (['ilum', 'tug', 'tue'].includes(String(c.tipo)) ? String(c.tipo) : 'tug') as TipoCircuito,
        disjuntorA: num(c.disjuntorA),
        polos: ([1, 2, 3].includes(num(c.polos, 1)) ? num(c.polos, 1) : 1) as 1 | 2 | 3,
        condutorFaseMm2: num(c.condutorFaseMm2, 2.5),
        condutorProtecaoMm2: c.condutorProtecaoMm2 == null ? null : num(c.condutorProtecaoMm2),
        potenciaVA: num(c.potenciaVA),
      }))
    : [];

  const pontos: PontosEletricos = {
    ...PONTOS_ZERO,
    iluminacao: num(pin.iluminacao), tug10A: num(pin.tug10A), tue20A: num(pin.tue20A),
    interruptorSimples: num(pin.interruptorSimples), interruptorParalelo: num(pin.interruptorParalelo),
    interruptorIntermediario: num(pin.interruptorIntermediario), conjuntos: num(pin.conjuntos),
    tomadasPiso: num(pin.tomadasPiso),
  };

  const tipoAlim = (['monofasico', 'bifasico', 'trifasico'].includes(String(a.tipo))
    ? String(a.tipo) : 'monofasico') as TipoAlimentacao;
  const tensao = ([127, 220, 380].includes(num(a.tensaoV, 220)) ? num(a.tensaoV, 220) : 220) as 127 | 220 | 380;

  return {
    obra: {
      titulo: str(o.titulo) || undefined, endereco: str(o.endereco) || undefined,
      municipio: str(o.municipio) || undefined, uf: str(o.uf) || undefined,
      proprietario: str(o.proprietario) || undefined, cpfCnpj: str(o.cpfCnpj) || undefined,
      areaConstruidaM2: o.areaConstruidaM2 == null ? undefined : num(o.areaConstruidaM2),
      areaLoteM2: o.areaLoteM2 == null ? undefined : num(o.areaLoteM2),
      taxaOcupacaoPct: o.taxaOcupacaoPct == null ? undefined : num(o.taxaOcupacaoPct),
      nPavimentos: o.nPavimentos == null ? undefined : num(o.nPavimentos),
      prancha: str(o.prancha) || undefined, dataProjeto: str(o.dataProjeto) || undefined,
    },
    alimentacao: {
      tipo: tipoAlim, tensaoV: tensao,
      ramalSecaoMm2: num(a.ramalSecaoMm2, 10), disjuntorGeralA: num(a.disjuntorGeralA, 40),
      piVA: a.piVA == null ? null : num(a.piVA), pdVA: a.pdVA == null ? null : num(a.pdVA),
    },
    circuitos,
    pontos,
    eletrodutos: Array.isArray(obj.eletrodutos)
      ? (obj.eletrodutos as Record<string, unknown>[]).map((e) => ({ tipo: str(e.tipo), diametro: str(e.diametro), comprimentoM: num(e.comprimentoM) }))
      : [],
    caixas: Array.isArray(obj.caixas)
      ? (obj.caixas as Record<string, unknown>[]).map((c) => ({ tipo: str(c.tipo), qtd: num(c.qtd) }))
      : [],
    confianca: Math.min(Math.max(num(obj.confianca, 0), 0), 1),
    observacoes: Array.isArray(obj.observacoes) ? (obj.observacoes as unknown[]).map(String) : [],
    divergencias: Array.isArray(obj.divergencias) ? (obj.divergencias as unknown[]).map(String) : [],
  };
}

export function validarExtracao(e: ExtracaoEletrica): string[] {
  const p: string[] = [];
  if (!e.circuitos.length) p.push('Nenhum circuito identificado — preencha na revisão.');
  if (!e.alimentacao.disjuntorGeralA) p.push('Disjuntor geral não identificado.');
  const totalPontos = e.pontos.iluminacao + e.pontos.tug10A + e.pontos.tue20A;
  if (totalPontos === 0) p.push('Nenhum ponto (luz/tomada) identificado.');
  return p;
}

// Aplica defaults de lance por tipo (usado pelo orquestrador após o parse).
export function aplicarLanceDefault(circuitos: CircuitoEletrico[]): CircuitoEletrico[] {
  return circuitos.map((c) => ({ ...c, lanceMedioM: c.lanceMedioM ?? LANCE_DEFAULT_M[c.tipo] }));
}

// ── Chamada multimodal (NÃO testada por rede; coberta por mock no orquestrador) ──
export async function extrairEletricaDeDocumento(pdf: Buffer): Promise<ExtracaoEletrica> {
  const base64 = pdf.toString('base64');
  try {
    return await chamarGemini(base64);
  } catch (errG) {
    console.warn('[aiDocExtractor] Gemini falhou, tentando Anthropic:', (errG as Error).message);
    return await chamarAnthropic(base64);
  }
}

async function chamarGemini(base64: string): Promise<ExtracaoEletrica> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
  const model = client.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
  const resp = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: base64 } },
    { text: PROMPT_EXTRACAO },
  ]);
  return aplicarConfianca(parseRespostaExtracao(resp.response.text()));
}

async function chamarAnthropic(base64: string): Promise<ExtracaoEletrica> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: PROMPT_EXTRACAO },
      ],
    }],
  });
  const txt = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
  return aplicarConfianca(parseRespostaExtracao(txt));
}

function aplicarConfianca(e: ExtracaoEletrica): ExtracaoEletrica {
  e.circuitos = aplicarLanceDefault(e.circuitos);
  return e;
}
