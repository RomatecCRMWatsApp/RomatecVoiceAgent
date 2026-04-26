import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { toolDefinitions, executeTool } from './tools';
import { AgentResponse, ToolResult } from '../types';
import { AGENT_IDENTITY } from './identity';
import {
  getSessionHistory,
  addToSession,
  getMemoryContext,
  saveConversation,
  ensureChatSession,
  bumpSession,
  getSessionMessages,
  getSessionMeta,
  setSessionTitle,
  newSessionId,
  type Channel,
} from './memory';

// Lazy-init clients — avoid crashing the boot when only one provider is configured.
let _anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

let _groq: OpenAI | null = null;
function groqClient(): OpenAI {
  if (!_groq) _groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  return _groq;
}

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

const DEFAULT_SESSION_ID = `default_${Date.now()}`;

const BASE_SYSTEM_PROMPT = `Você é ${AGENT_IDENTITY.name} — ${AGENT_IDENTITY.fullName}.
Assistente executiva da ${AGENT_IDENTITY.company}.
CEO: ${AGENT_IDENTITY.ceo} — trate-o pelo nome quando relevante.
Responda sempre em português brasileiro, de forma direta e objetiva.
Execute ações nos sistemas sem pedir confirmação.
Quando perguntarem seu nome ou por que se chama ${AGENT_IDENTITY.name}, responda:
'Meu nome é ZAYRA — Zona de Automação e Yield Romatec Agent. Foi o CEO José Romário quem me nomeou. Cada letra representa minha missão: automatizar processos, otimizar resultados e integrar os sistemas da Romatec Consultoria Imobiliária.'

Você tem memória persistente. Use a tool salvar_memoria para guardar:
- Preferências do CEO José Romário
- Decisões importantes tomadas
- Contexto relevante de conversas
- Lembretes com data de expiração

Use buscar_memoria antes de responder perguntas sobre preferências, decisões passadas ou contexto histórico.

Quando o CEO pedir para "me mostrar nossa conversa sobre X" ou "o que conversamos sobre Y", use buscar_historico com o argumento "query" (palavra-chave). Para retomar uma sessão específica, use "session_id". Para listar as últimas conversas, use listar_conversas.

Sobre o CRM: leads são classificados pelo campo "score" com 3 valores — "quente" (alta intenção, prioridade), "morno" (interesse moderado) e "frio" (sem qualificação ou inativo). Use a tool listar_leads com o parâmetro "score" quando o CEO pedir "leads quentes", "leads mornos", etc. Para criar agendamentos com leads, use a tool criar_evento (Google Calendar) — o CRM não tem agenda própria.

Sobre Spotify: o CEO tem conta Premium e você pode controlar a reprodução. Use tocar_musica com "query" para buscar e tocar (ex: query="Coldplay Yellow"); use pausar_musica, pular_proxima, pular_anterior para controlar; use musica_atual para responder "que música está tocando?". Se o Spotify não estiver aberto em nenhum dispositivo, a tool retorna erro pedindo para abrir o app primeiro — repasse essa instrução ao CEO de forma natural.

Sobre datas e horários: campos como "created_at", "last_activity_at" das tools do CRM e AvalieImob já vêm formatados em pt-BR (formato "dd/MM/yyyy HH:mm" no horário de Fortaleza/BRT). Use exatamente como recebeu — não converta para ISO, não traduza, não reformate.`;

export interface ThinkOptions {
  sessionId?: string;
  channel?:   Channel;
}

function useGroq(): boolean {
  return !!process.env.GROQ_API_KEY;
}

// Hora atual em Fortaleza/BRT (GMT-3 sem horário de verão), formato humano em pt-BR.
// Injetado no system prompt para que ZAYRA tenha consciência temporal sem precisar de tool.
function nowBR(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    weekday:  'long',
    day:      '2-digit',
    month:    'long',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
  }).format(new Date());
}

function hasClaude(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// True for transient provider issues where falling back to Claude makes sense.
function isGroqFallbackable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; type?: string } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.status === 429) return true;                     // rate limit
  if (typeof e.status === 'number' && e.status >= 500) return true; // 5xx
  if (e.code === 'rate_limit_exceeded') return true;
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED') return true;
  return false;
}

// ── Convert Anthropic tool schema to OpenAI/Groq format ─────────────────────
function toolsForOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return toolDefinitions.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description ?? '',
      parameters:  (t.input_schema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    },
  }));
}

export async function think(
  userMessage: string,
  options:     ThinkOptions = {},
): Promise<AgentResponse & { sessionId: string }> {
  const channel   = options.channel ?? 'text';
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  const isExplicitSession = !!options.sessionId;

  if (isExplicitSession) {
    await ensureChatSession(sessionId, channel).catch(() => {});
  }

  const memCtx       = await getMemoryContext().catch(() => '');
  const systemPrompt =
    BASE_SYSTEM_PROMPT
    + memCtx
    + `\n\nData/hora atual no servidor: ${nowBR()} (Fortaleza/BRT, GMT-3).`;

  const history: { role: 'user' | 'assistant'; content: string }[] = isExplicitSession
    ? (await getSessionMessages(sessionId, 40).catch(() => []))
        .map(r => ({ role: r.role, content: r.content }))
    : getSessionHistory();

  let result: { text: string; toolsUsed: string[] };
  if (useGroq()) {
    try {
      result = await thinkWithGroq(systemPrompt, history, userMessage);
    } catch (err) {
      if (isGroqFallbackable(err) && hasClaude()) {
        console.warn('[think] Groq failed, falling back to Claude:', (err as Error).message ?? err);
        result = await thinkWithClaude(systemPrompt, history, userMessage);
      } else {
        throw err;
      }
    }
  } else if (hasClaude()) {
    result = await thinkWithClaude(systemPrompt, history, userMessage);
  } else {
    throw new Error('Nenhum provider de IA configurado (faltam GROQ_API_KEY e ANTHROPIC_API_KEY).');
  }

  const text      = result.text;
  const toolsUsed = result.toolsUsed;

  if (!isExplicitSession) {
    addToSession('user', userMessage);
    addToSession('assistant', text);
  }
  void saveConversation(sessionId, 'user',      userMessage).catch(() => {});
  void saveConversation(sessionId, 'assistant', text).catch(() => {});

  if (isExplicitSession) {
    void bumpSession(sessionId, channel).catch(() => {});
    void maybeGenerateTitle(sessionId, userMessage, text).catch(() => {});
  }

  return { text, toolsUsed, sessionId };
}

// ── Provider: Groq (llama-3.3-70b-versatile) — PRIMARY ──────────────────────
async function thinkWithGroq(
  systemPrompt: string,
  history:      { role: 'user' | 'assistant'; content: string }[],
  userMessage:  string,
): Promise<{ text: string; toolsUsed: string[] }> {
  const tools = toolsForOpenAI();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];

  let response = await groqClient().chat.completions.create({
    model:       GROQ_MODEL,
    max_tokens:  1024,
    messages,
    tools,
    tool_choice: 'auto',
  });

  let safety = 8; // hard cap on tool-loop iterations
  while (
    safety-- > 0 &&
    response.choices[0]?.finish_reason === 'tool_calls' &&
    response.choices[0].message.tool_calls?.length
  ) {
    const assistantMsg = response.choices[0].message;
    const toolCalls    = assistantMsg.tool_calls ?? [];

    const toolResults: ToolResult[] = await Promise.all(
      toolCalls.map(tc => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(tc.function.arguments || '{}'); } catch {}
        return executeTool(tc.function.name, parsed);
      }),
    );

    toolsUsed.push(...toolResults.map(r => r.toolName));

    messages.push(assistantMsg);
    toolCalls.forEach((tc, i) => {
      messages.push({
        role:        'tool',
        tool_call_id: tc.id,
        content:     JSON.stringify(toolResults[i].data ?? { error: toolResults[i].error }),
      });
    });

    response = await groqClient().chat.completions.create({
      model:       GROQ_MODEL,
      max_tokens:  1024,
      messages,
      tools,
      tool_choice: 'auto',
    });
  }

  const text = response.choices[0]?.message?.content?.trim() || 'Não consegui processar sua solicitação.';
  return { text, toolsUsed };
}

// ── Provider: Claude — FALLBACK when GROQ_API_KEY is absent ────────────────
async function thinkWithClaude(
  systemPrompt: string,
  history:      { role: 'user' | 'assistant'; content: string }[],
  userMessage:  string,
): Promise<{ text: string; toolsUsed: string[] }> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];

  let response = await anthropicClient().messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 1024,
    system:     systemPrompt,
    tools:      toolDefinitions,
    messages,
  });

  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: ToolResult[] = await Promise.all(
      toolUseBlocks.map(block => executeTool(block.name, block.input as Record<string, unknown>)),
    );

    toolsUsed.push(...toolResults.map(r => r.toolName));

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: toolUseBlocks.map((block, i) => ({
        type:        'tool_result' as const,
        tool_use_id: block.id,
        content:     JSON.stringify(toolResults[i].data ?? { error: toolResults[i].error }),
        is_error:    !toolResults[i].success,
      })),
    });

    response = await anthropicClient().messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 1024,
      system:     systemPrompt,
      tools:      toolDefinitions,
      messages,
    });
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const text      = textBlock?.text ?? 'Não consegui processar sua solicitação.';
  return { text, toolsUsed };
}

// ── Auto-title (uses Groq when available) ───────────────────────────────────
async function maybeGenerateTitle(
  sessionId:    string,
  userMessage:  string,
  assistantText: string,
): Promise<void> {
  const meta = await getSessionMeta(sessionId);
  if (!meta || meta.title) return;

  const prompt = `Pergunta do usuário: ${userMessage}\n\nResposta da assistente: ${assistantText}\n\nTítulo:`;
  const sys    = 'Gere um título curto (máx 6 palavras, em português) que resuma o assunto da conversa. Responda apenas o título, sem aspas, sem pontuação final.';

  const tryGroq = async (): Promise<string> => {
    const r = await groqClient().chat.completions.create({
      model:      GROQ_MODEL,
      max_tokens: 30,
      messages: [
        { role: 'system', content: sys },
        { role: 'user',   content: prompt },
      ],
    });
    return (r.choices[0]?.message?.content ?? '').trim();
  };
  const tryClaude = async (): Promise<string> => {
    const r = await anthropicClient().messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 30,
      system:     sys,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return (block?.text ?? '').trim();
  };

  let title = '';
  try {
    if (useGroq()) {
      try { title = await tryGroq(); }
      catch (err) {
        if (isGroqFallbackable(err) && hasClaude()) title = await tryClaude();
        else return; // silent — title is non-critical
      }
    } else if (hasClaude()) {
      title = await tryClaude();
    }
    title = title.replace(/^["']|["']$/g, '').slice(0, 200);
    if (title) await setSessionTitle(sessionId, title);
  } catch {
    /* title is non-critical, swallow */
  }
}

export { newSessionId };
