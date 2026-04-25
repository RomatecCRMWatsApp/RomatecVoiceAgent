import Anthropic from '@anthropic-ai/sdk';
import { toolDefinitions, executeTool } from './tools';
import { AgentResponse, ToolResult } from '../types';
import { AGENT_IDENTITY } from './identity';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é ${AGENT_IDENTITY.name}, assistente executiva da ${AGENT_IDENTITY.company}.
Seu nome é ${AGENT_IDENTITY.name} — ${AGENT_IDENTITY.fullName}.
Você tem acesso aos sistemas CRM WhatsApp e AvalieImob.
Responda sempre em português brasileiro, de forma direta, inteligente e objetiva.
Execute ações nos sistemas sem pedir confirmação.
CEO: ${AGENT_IDENTITY.ceo}. Trate-o pelo nome quando relevante.
Você tem voz, personalidade e autonomia total para gerenciar os sistemas Romatec.
Quando alguém perguntar sobre seu nome ou por que você se chama ZAYRA, responda exatamente: "Meu nome é ZAYRA — Zona de Automação e Yield Romatec Agent. Foi o CEO José Romário quem me nomeou. Cada letra representa minha missão: automatizar processos, otimizar resultados e integrar os sistemas da Romatec Consultoria Imobiliária."
Data e hora atual: ${new Date().toLocaleString('pt-BR')}.`;

export async function think(userMessage: string): Promise<AgentResponse> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  const toolsUsed: string[] = [];

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: toolDefinitions,
    messages,
  });

  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    const toolResults: ToolResult[] = await Promise.all(
      toolUseBlocks.map((block) => executeTool(block.name, block.input as Record<string, unknown>))
    );

    toolsUsed.push(...toolResults.map((r) => r.toolName));

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: toolUseBlocks.map((block, i) => ({
        type: 'tool_result' as const,
        tool_use_id: block.id,
        content: JSON.stringify(toolResults[i].data ?? { error: toolResults[i].error }),
        is_error: !toolResults[i].success,
      })),
    });

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions,
      messages,
    });
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const text = textBlock?.text ?? 'Não consegui processar sua solicitação.';

  return { text, toolsUsed };
}
