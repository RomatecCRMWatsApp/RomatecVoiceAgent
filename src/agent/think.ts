import Anthropic from '@anthropic-ai/sdk';
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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

Quando o CEO pedir para "me mostrar nossa conversa sobre X" ou "o que conversamos sobre Y", use buscar_historico com o argumento "query" (palavra-chave). Para retomar uma sessão específica, use "session_id". Para listar as últimas conversas, use listar_conversas.`;

export interface ThinkOptions {
  sessionId?: string;
  channel?:   Channel;
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
  const systemPrompt = BASE_SYSTEM_PROMPT + memCtx;

  // History: if explicit session, load from DB; else use the in-memory singleton
  const history: { role: 'user' | 'assistant'; content: string }[] = isExplicitSession
    ? (await getSessionMessages(sessionId, 40).catch(() => []))
        .map(r => ({ role: r.role, content: r.content }))
    : getSessionHistory();

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];

  let response = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
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

    response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     systemPrompt,
      tools:      toolDefinitions,
      messages,
    });
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const text      = textBlock?.text ?? 'Não consegui processar sua solicitação.';

  // Persist
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

async function maybeGenerateTitle(
  sessionId:    string,
  userMessage:  string,
  assistantText: string,
): Promise<void> {
  const meta = await getSessionMeta(sessionId);
  if (!meta || meta.title) return;

  try {
    const r = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 30,
      system:     'Gere um título curto (máx 6 palavras, em português) que resuma o assunto da conversa. Responda apenas o título, sem aspas, sem pontuação final.',
      messages: [
        {
          role:    'user',
          content: `Pergunta do usuário: ${userMessage}\n\nResposta da assistente: ${assistantText}\n\nTítulo:`,
        },
      ],
    });
    const block = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const title = (block?.text ?? '').trim().replace(/^["']|["']$/g, '').slice(0, 200);
    if (title) await setSessionTitle(sessionId, title);
  } catch {
    /* ignore */
  }
}

export { newSessionId };
