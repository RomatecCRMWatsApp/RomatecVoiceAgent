// Cascata de providers de IA — v1.25.0
// Tenta Cerebras (rápido, 30k TPM), cai pra Gemini (1M TPM free), por fim Claude
// (mais caro mas robusto). Cada provider faz sua própria loop de tool calling.
//
// Por que cascata: o erro 413 "Request too large" do Groq llama-3.3-70b
// (limite TPM 12k no free tier) estava forçando todo request pro Claude
// (lento + caro). Cerebras Cloud (mesmo modelo, free tier) tem TPM 30k+,
// resolvendo o gargalo. Gemini cobre se Cerebras cair. Claude é último elo.
//
// O Groq Whisper de transcrição (/voice) NÃO é tocado — fica em transcribe.ts.

import Anthropic from '@anthropic-ai/sdk';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { toolDefinitions, executeTool } from '../agent/tools';
import type { ThinkAttachment } from '../agent/think';

// Modelos válidos no Cerebras Cloud (verificado via GET /v1/models em 2026-04):
//   - llama3.1-8b                       (production, 8B, free tier ✅)
//   - gpt-oss-120b                      (production, 120B, requer waitlist)
//   - qwen-3-235b-a22b-instruct-2507    (preview)
//   - zai-glm-4.7                       (preview)
// llama-3.3-70b foi DESCONTINUADO — não usar.
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || 'llama3.1-8b';
const GEMINI_MODEL   = process.env.GEMINI_MODEL   || 'gemini-2.5-flash';
const CLAUDE_MODEL   = process.env.CLAUDE_FALLBACK_MODEL || 'claude-sonnet-4-5';

// Log no boot — facilita debug de "qual modelo realmente está rodando".
// Aparece UMA vez quando o módulo é carregado, mostrando o que será usado
// até o próximo restart do container.
console.log(
  `[aiCascade] modelos ativos: Cerebras=${CEREBRAS_MODEL} | ` +
  `Gemini=${GEMINI_MODEL} | Claude=${CLAUDE_MODEL}`
);

const MAX_HISTORY = parseInt(process.env.AI_MAX_HISTORY_MESSAGES || '12', 10);
const MAX_OUTPUT  = parseInt(process.env.AI_MAX_TOKENS_OUTPUT    || '1024', 10);

// Limite de input tokens estimados pra pular Cerebras (llama3.1-8b tem 8k context).
// Se o prompt total estimado passar disso, pulamos direto pro Gemini que tem 1M.
const CEREBRAS_MAX_INPUT_TOKENS = parseInt(
  process.env.CEREBRAS_MAX_INPUT_TOKENS || '7500', 10,
);

const TOOL_LOOP_CAP = 8; // hard cap em iterações de tool use

// Estimativa rápida de tokens — heurística clássica chars/4 (~80% de precisão
// pra pt-BR). Não precisa ser exata, só evitar request que SABEMOS que vai 400.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Estima tokens totais que serão enviados pro provider (sem o overhead do JSON
// das tools, que cada provider serializa diferente — chutamos +20%).
function estimatePromptTokens(
  systemPrompt: string,
  history: CascadeMessage[],
  userMessage: string,
): number {
  const sysTokens  = estimateTokens(systemPrompt);
  const histTokens = history.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const userTokens = estimateTokens(userMessage);
  // toolDefinitions (importado abaixo) — JSON grosseiro, 1 vez por request
  const toolsJson  = JSON.stringify(toolDefinitions);
  const toolTokens = estimateTokens(toolsJson);
  return Math.ceil((sysTokens + histTokens + userTokens + toolTokens) * 1.1);
}

export interface CascadeMessage {
  role:    'user' | 'assistant';
  content: string;
}

export interface CascadeResult {
  text:      string;
  toolsUsed: string[];
  provider:  string;
}

export function truncarHistorico<T>(historico: T[]): T[] {
  return historico.slice(-MAX_HISTORY);
}

// ── Lazy clients ────────────────────────────────────────────────────────────
let _cerebras: Cerebras | null = null;
function cerebrasClient(): Cerebras {
  if (!_cerebras) _cerebras = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY! });
  return _cerebras;
}

let _gemini: GoogleGenerativeAI | null = null;
function geminiClient(): GoogleGenerativeAI {
  if (!_gemini) _gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  return _gemini;
}

let _claude: Anthropic | null = null;
function claudeClient(): Anthropic {
  if (!_claude) _claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _claude;
}

// ── Conversores de schema ───────────────────────────────────────────────────
function toolsParaOpenAI(): any[] {
  return toolDefinitions.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description ?? '',
      parameters:  (t.input_schema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    },
  }));
}

function schemaParaGemini(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return { type: SchemaType.OBJECT, properties: {} };
  }
  const typeMap: Record<string, SchemaType> = {
    string:  SchemaType.STRING,
    number:  SchemaType.NUMBER,
    integer: SchemaType.INTEGER,
    boolean: SchemaType.BOOLEAN,
    array:   SchemaType.ARRAY,
    object:  SchemaType.OBJECT,
  };
  const out: any = {};
  if (schema.type) {
    const t = String(schema.type).toLowerCase();
    out.type = typeMap[t] ?? SchemaType.STRING;
  }
  if (schema.description) out.description = schema.description;
  if (schema.enum)        out.enum        = schema.enum;
  if (schema.format)      out.format      = schema.format;
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = schemaParaGemini(v);
    }
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (schema.items) out.items = schemaParaGemini(schema.items);
  // Gemini não aceita `default` em schemas — remove silenciosamente
  return out;
}

function toolsParaGemini(): FunctionDeclaration[] {
  return toolDefinitions.map(t => ({
    name:        t.name,
    description: t.description ?? '',
    parameters:  schemaParaGemini(t.input_schema),
  }));
}

// ── CEREBRAS (primário) ─────────────────────────────────────────────────────
async function chamarCerebras(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
): Promise<CascadeResult> {
  const tools    = toolsParaOpenAI();
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];
  let totalIn = 0, totalOut = 0;

  let response: any = await cerebrasClient().chat.completions.create({
    model:                 CEREBRAS_MODEL,
    max_completion_tokens: MAX_OUTPUT,
    messages,
    tools,
    tool_choice:           'auto',
  });
  totalIn  += response.usage?.prompt_tokens     ?? 0;
  totalOut += response.usage?.completion_tokens ?? 0;

  let safety = TOOL_LOOP_CAP;
  while (
    safety-- > 0 &&
    response.choices?.[0]?.finish_reason === 'tool_calls' &&
    response.choices[0].message?.tool_calls?.length
  ) {
    const assistantMsg = response.choices[0].message;
    const toolCalls    = assistantMsg.tool_calls ?? [];

    const results = await Promise.all(toolCalls.map((tc: any) => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(tc.function.arguments || '{}'); } catch {}
      return executeTool(tc.function.name, parsed);
    }));
    toolsUsed.push(...results.map(r => r.toolName));

    messages.push(assistantMsg);
    toolCalls.forEach((tc: any, i: number) => {
      messages.push({
        role:         'tool',
        tool_call_id: tc.id,
        content:      JSON.stringify(results[i].data ?? { error: results[i].error }),
      });
    });

    response = await cerebrasClient().chat.completions.create({
      model:                 CEREBRAS_MODEL,
      max_completion_tokens: MAX_OUTPUT,
      messages,
      tools,
      tool_choice:           'auto',
    });
    totalIn  += response.usage?.prompt_tokens     ?? 0;
    totalOut += response.usage?.completion_tokens ?? 0;
  }

  const text = response.choices?.[0]?.message?.content?.trim() || 'Não consegui processar.';
  return {
    text,
    toolsUsed,
    provider: `Cerebras ${CEREBRAS_MODEL} (${totalIn} in / ${totalOut} out)`,
  };
}

// ── GEMINI (fallback intermediário) ─────────────────────────────────────────
async function chamarGemini(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
  attachments?: ThinkAttachment[],
): Promise<CascadeResult> {
  const model = geminiClient().getGenerativeModel({
    model:             GEMINI_MODEL,
    systemInstruction: systemPrompt,
    tools:             [{ functionDeclarations: toolsParaGemini() }],
    generationConfig:  { maxOutputTokens: MAX_OUTPUT },
  });

  // Converte histórico pra formato Gemini (role 'assistant' → 'model').
  // Gemini EXIGE que history comece com role 'user' E alterne user/model.
  // Se começar com 'model' (raro mas possível após truncamento), drop até user.
  const geminiHistory = history.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  while (geminiHistory.length > 0 && geminiHistory[0].role === 'model') {
    geminiHistory.shift();
  }
  // Garante alternância: remove duplicatas consecutivas do mesmo role
  for (let i = geminiHistory.length - 1; i > 0; i--) {
    if (geminiHistory[i].role === geminiHistory[i - 1].role) {
      geminiHistory.splice(i, 1);
    }
  }

  const chat = model.startChat({ history: geminiHistory });
  const toolsUsed: string[] = [];

  // Monta parts do user (anexos + texto)
  const userParts: any[] = [];
  if (attachments && attachments.length > 0) {
    for (const a of attachments) {
      userParts.push({ inlineData: { mimeType: a.mime, data: a.base64 } });
    }
  }
  userParts.push({ text: userMessage || 'Analise os anexos.' });

  let result = await chat.sendMessage(userParts);
  let safety = TOOL_LOOP_CAP;

  while (safety-- > 0) {
    const fnCalls = result.response.functionCalls();
    if (!fnCalls || fnCalls.length === 0) break;

    const responses: any[] = [];
    for (const call of fnCalls) {
      const r = await executeTool(call.name, (call.args || {}) as Record<string, unknown>);
      toolsUsed.push(r.toolName);
      responses.push({
        functionResponse: {
          name:     call.name,
          response: r.data ? { result: r.data } : { error: r.error },
        },
      });
    }
    result = await chat.sendMessage(responses);
  }

  const text  = (result.response.text() || '').trim() || 'Não consegui processar.';
  const usage = result.response.usageMetadata;
  return {
    text,
    toolsUsed,
    provider: `Gemini ${GEMINI_MODEL} (${usage?.promptTokenCount ?? 0} in / ${usage?.candidatesTokenCount ?? 0} out)`,
  };
}

// ── CLAUDE (último recurso) ────────────────────────────────────────────────
async function chamarClaude(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
  attachments?: ThinkAttachment[],
): Promise<CascadeResult> {
  let userContent: Anthropic.MessageParam['content'];
  if (attachments && attachments.length > 0) {
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const a of attachments) {
      if (a.kind === 'image') {
        blocks.push({
          type: 'image',
          source: {
            type:       'base64',
            media_type: a.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
            data:       a.base64,
          },
        });
      } else {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: a.base64 },
        } as Anthropic.ContentBlockParam);
      }
    }
    blocks.push({ type: 'text', text: userMessage || 'Analise os anexos.' });
    userContent = blocks;
  } else {
    userContent = userMessage;
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
  ];

  const toolsUsed: string[] = [];
  let totalIn = 0, totalOut = 0;
  const maxOut = attachments && attachments.length > 0 ? Math.max(MAX_OUTPUT, 4096) : MAX_OUTPUT;

  let response = await claudeClient().messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: maxOut,
    system:     systemPrompt,
    tools:      toolDefinitions,
    messages,
  });
  totalIn  += response.usage?.input_tokens  ?? 0;
  totalOut += response.usage?.output_tokens ?? 0;

  let safety = TOOL_LOOP_CAP;
  while (safety-- > 0 && response.stop_reason === 'tool_use') {
    const blocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    const results = await Promise.all(
      blocks.map(b => executeTool(b.name, b.input as Record<string, unknown>)),
    );
    toolsUsed.push(...results.map(r => r.toolName));

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: blocks.map((b, i) => ({
        type:        'tool_result' as const,
        tool_use_id: b.id,
        content:     JSON.stringify(results[i].data ?? { error: results[i].error }),
        is_error:    !results[i].success,
      })),
    });

    response = await claudeClient().messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT,
      system:     systemPrompt,
      tools:      toolDefinitions,
      messages,
    });
    totalIn  += response.usage?.input_tokens  ?? 0;
    totalOut += response.usage?.output_tokens ?? 0;
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const text      = textBlock?.text ?? 'Não consegui processar.';
  return {
    text,
    toolsUsed,
    provider: `Claude ${CLAUDE_MODEL} (${totalIn} in / ${totalOut} out)`,
  };
}

// ── ORQUESTRADOR DA CASCATA ────────────────────────────────────────────────
export async function pensarEmCascata(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
  attachments?: ThinkAttachment[],
): Promise<CascadeResult> {
  const truncado = truncarHistorico(history);
  const hasAttachments = !!attachments && attachments.length > 0;

  // Cerebras pulado se: (1) houver anexos (sem vision), OU (2) prompt estimado
  // exceder a janela do modelo (llama3.1-8b = 8k tokens). Evita request que
  // sabemos que vai retornar 400 antes mesmo de sair daqui.
  if (!hasAttachments && process.env.CEREBRAS_API_KEY) {
    const estimated = estimatePromptTokens(systemPrompt, truncado, userMessage);
    if (estimated > CEREBRAS_MAX_INPUT_TOKENS) {
      console.warn(
        `[AI] ⚠️ Cerebras pulado: prompt ~${estimated} tokens > ` +
        `${CEREBRAS_MAX_INPUT_TOKENS} (janela do modelo). Indo direto pro Gemini.`
      );
    } else {
      try {
        const r = await chamarCerebras(systemPrompt, truncado, userMessage);
        console.log(`[AI] ✅ ${r.provider}`);
        return r;
      } catch (err) {
        console.warn(`[AI] ⚠️ Cerebras falhou: ${(err as Error).message ?? err}`);
      }
    }
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const r = await chamarGemini(systemPrompt, truncado, userMessage, attachments);
      console.log(`[AI] ✅ ${r.provider}`);
      return r;
    } catch (err) {
      console.warn(`[AI] ⚠️ Gemini falhou: ${(err as Error).message ?? err}`);
    }
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const r = await chamarClaude(systemPrompt, truncado, userMessage, attachments);
    console.log(`[AI] ✅ ${r.provider}`);
    return r;
  }

  throw new Error('Nenhum provider de IA configurado (faltam CEREBRAS_API_KEY, GEMINI_API_KEY e ANTHROPIC_API_KEY).');
}
