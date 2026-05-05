// v1.66.23: Live contínuo via Gemini 2.0 Flash (free tier 15 RPM / 1500 RPD).
// Análise rápida e concisa (1-2 frases) por frame, sem histórico de chat,
// sem tools — só visão. Mantém contador por dia em memória.
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.0-flash-exp';
const FREE_TIER_RPM = 15;
const FREE_TIER_RPD = 1500;

let _gemini: GoogleGenerativeAI | null = null;
function client(): GoogleGenerativeAI {
  if (!_gemini) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY nao configurada');
    _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return _gemini;
}

// Contador por dia (reseta na meia-noite UTC)
interface DayCounter { date: string; count: number; lastMinuteWindow: number[]; }
let counter: DayCounter = { date: '', count: 0, lastMinuteWindow: [] };

function hojeUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function checkFreeTier(): { ok: boolean; rpd_usado: number; rpd_limite: number; rpm_usado: number; rpm_limite: number; aviso?: string } {
  const hoje = hojeUTC();
  if (counter.date !== hoje) {
    counter = { date: hoje, count: 0, lastMinuteWindow: [] };
  }
  // Limpa janela de 1 minuto
  const agora = Date.now();
  counter.lastMinuteWindow = counter.lastMinuteWindow.filter(t => agora - t < 60_000);

  const rpd_usado = counter.count;
  const rpm_usado = counter.lastMinuteWindow.length;

  if (rpd_usado >= FREE_TIER_RPD) {
    return { ok: false, rpd_usado, rpd_limite: FREE_TIER_RPD, rpm_usado, rpm_limite: FREE_TIER_RPM, aviso: 'Limite diario do Gemini Free Tier atingido (1500 reqs). Reseta a meia-noite UTC.' };
  }
  if (rpm_usado >= FREE_TIER_RPM) {
    return { ok: false, rpd_usado, rpd_limite: FREE_TIER_RPD, rpm_usado, rpm_limite: FREE_TIER_RPM, aviso: 'Limite por minuto atingido (15 RPM). Aguarde alguns segundos.' };
  }

  let aviso: string | undefined;
  if (rpd_usado >= FREE_TIER_RPD * 0.9) aviso = `Free tier diario quase esgotado: ${rpd_usado}/${FREE_TIER_RPD}`;

  return { ok: true, rpd_usado, rpd_limite: FREE_TIER_RPD, rpm_usado, rpm_limite: FREE_TIER_RPM, aviso };
}

function registrarUso(): void {
  counter.count++;
  counter.lastMinuteWindow.push(Date.now());
}

const PROMPT_LIVE = `Voce e a ZAYRA, assistente visual em tempo real do CEO da Romatec Consultoria Imobiliaria.
Analise o frame abaixo e responda em PORTUGUES, MAX 2 FRASES (~20 palavras), de forma direta e util:
- Se for imovel/obra: cite padrao construtivo, conservacao, possivel uso, irregularidade visivel.
- Se for documento: extraia o dado mais relevante (CPF, valor, data).
- Se for ambiente generico: descreva o que esta vendo de forma util pro contexto de obra/imobiliaria.
- Se vier acompanhado de uma pergunta especifica do CEO, FOQUE nessa pergunta.

NAO repita "estou vendo", "a imagem mostra", "no frame...". Va direto ao ponto. Tom executivo, conciso.`;

export async function analisarFrameLive(input: {
  imagem_b64: string;
  mimetype: string;
  pergunta?: string;
}): Promise<{ resposta: string; rpd_usado: number; rpd_limite: number; aviso?: string }> {
  const tier = checkFreeTier();
  if (!tier.ok) {
    throw new Error(tier.aviso || 'Free tier esgotado');
  }

  const model = client().getGenerativeModel({
    model: GEMINI_LIVE_MODEL,
    systemInstruction: PROMPT_LIVE,
    generationConfig: { maxOutputTokens: 100, temperature: 0.4 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userParts: any[] = [
    { inlineData: { mimeType: input.mimetype, data: input.imagem_b64 } },
    { text: input.pergunta ? `Pergunta do CEO: ${input.pergunta}` : 'Descreva.' },
  ];

  const result = await model.generateContent(userParts);
  registrarUso();
  const resposta = (result.response.text() || '').trim();

  return {
    resposta: resposta || 'Sem detalhes relevantes detectados no frame.',
    rpd_usado: counter.count,
    rpd_limite: FREE_TIER_RPD,
    aviso: tier.aviso,
  };
}

export function statusFreeTier(): { rpd_usado: number; rpd_limite: number; rpm_usado: number; rpm_limite: number } {
  const t = checkFreeTier();
  return {
    rpd_usado: t.rpd_usado,
    rpd_limite: t.rpd_limite,
    rpm_usado: t.rpm_usado,
    rpm_limite: t.rpm_limite,
  };
}
