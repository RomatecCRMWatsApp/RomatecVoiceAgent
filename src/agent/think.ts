import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, executeTool } from './tools';
import { AgentResponse, ToolResult } from '../types';
import { AGENT_IDENTITY } from './identity';
import {
  getSessionHistory,
  addToSession,
  getMemoryContext,
  saveConversation,
} from './memory';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SESSION_ID = `session_${Date.now()}`;

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

Exemplos do que salvar:
- 'José Romário prefere reuniões pela manhã'
- 'Decisão: usar OpenAI TTS ao invés de ElevenLabs'
- 'Lead João Silva tem alto interesse no lote 3'
- 'Reunião com cliente amanhã às 10h'

Use buscar_memoria antes de responder perguntas sobre preferências, decisões passadas ou contexto histórico.`;

export async function think(userMessage: string): Promise<AgentResponse> {
  const memCtx    = await getMemoryContext().catch(() => '');
  const systemPrompt = BASE_SYSTEM_PROMPT + memCtx;

  // Prepend session history so ZAYRA has conversation context
  const history = getSessionHistory();
  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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
  const text = textBlock?.text ?? 'Não consegui processar sua solicitação.';

  // Persist exchange in session + DB (fire-and-forget for DB)
  addToSession('user', userMessage);
  addToSession('assistant', text);
  void saveConversation(SESSION_ID, 'user', userMessage).catch(() => {});
  void saveConversation(SESSION_ID, 'assistant', text).catch(() => {});

  return { text, toolsUsed };
}
