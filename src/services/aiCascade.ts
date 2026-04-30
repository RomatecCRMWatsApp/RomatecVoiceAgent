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
import OpenAI from 'openai';
import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { toolDefinitions, executeTool } from '../agent/tools';
import type { ThinkAttachment } from '../agent/think';

// Modelos válidos no Cerebras Cloud (verificado via GET /v1/models em 2026-04):
//   - llama3.1-8b                       (production, 8B, free tier ✅)
//   - gpt-oss-120b                      (production, 120B, requer waitlist)
//   - qwen-3-235b-a22b-instruct-2507    (preview, 32k ctx) — escolhido v1.49
//   - zai-glm-4.7                       (preview)
// llama-3.3-70b foi DESCONTINUADO no Cerebras — não usar.
// v1.49.0: default vira qwen-3-235b (32k ctx, suporta o prompt enxuto + tools + history).
const CEREBRAS_MODEL    = process.env.CEREBRAS_MODEL       || 'qwen-3-235b-a22b-instruct-2507';
const GEMINI_MODEL      = process.env.GEMINI_MODEL         || 'gemini-2.5-flash';
const CLAUDE_MODEL      = process.env.CLAUDE_FALLBACK_MODEL || 'claude-sonnet-4-5';
// v1.27.3: Groq Chat (separado do Whisper que vive em transcribe.ts) e OpenRouter
// como elos da cascata. Tudo OpenAI-compatible — reusa o pattern Cerebras.
const GROQ_CHAT_MODEL   = process.env.GROQ_CHAT_MODEL      || 'llama-3.3-70b-versatile';
const OPENROUTER_MODEL  = process.env.OPENROUTER_MODEL     || 'meta-llama/llama-3.1-70b-instruct:free';
// v1.32.0: GitHub Models e Cloudflare Workers AI (elos da cascata).
const GITHUB_MODEL      = process.env.GITHUB_MODEL         || 'gpt-4o-mini';
const CLOUDFLARE_MODEL  = process.env.CLOUDFLARE_MODEL     || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// v1.49.0: OpenAI direto (gpt-4o-mini) — ativa se OPENAI_API_KEY existir. Custa
// US$0.15/1M tokens input, sempre disponível, sem rate limits agressivos.
const OPENAI_MODEL      = process.env.OPENAI_MODEL         || 'gpt-4o-mini';

console.log(
  `[aiCascade] modelos ativos: Cerebras=${CEREBRAS_MODEL} | ` +
  `Gemini=${GEMINI_MODEL} | Claude=${CLAUDE_MODEL} | ` +
  `Groq=${GROQ_CHAT_MODEL} | OpenRouter=${OPENROUTER_MODEL} | ` +
  `GitHub=${GITHUB_MODEL} | Cloudflare=${CLOUDFLARE_MODEL} | ` +
  `OpenAI=${OPENAI_MODEL}${process.env.OPENAI_API_KEY ? '' : ' (sem chave)'}`
);

const MAX_HISTORY = parseInt(process.env.AI_MAX_HISTORY_MESSAGES || '12', 10);
const MAX_OUTPUT  = parseInt(process.env.AI_MAX_TOKENS_OUTPUT    || '1024', 10);

// Limite de input tokens estimados pra pular Cerebras.
// v1.49.0: qwen-3-235b tem 32k ctx — bumpamos a janela. Se voltar pra llama3.1-8b
// (env var CEREBRAS_MODEL=llama3.1-8b), define CEREBRAS_MAX_INPUT_TOKENS=7500.
const CEREBRAS_MAX_INPUT_TOKENS = parseInt(
  process.env.CEREBRAS_MAX_INPUT_TOKENS || '28000', 10,
);
// Groq llama-3.3-70b free tier: 128k context mas TPM ~6k — pré-flight pra evitar 413.
// v1.49.0: bumpado de 5500 pra 6500 (com prompt enxuto v1.48 vai caber em mais casos).
const GROQ_MAX_INPUT_TOKENS = parseInt(
  process.env.GROQ_MAX_INPUT_TOKENS || '6500', 10,
);
// OpenRouter free: contexto grande mas requests/dia limitado. Sem pré-flight de tokens.

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
  if (!_cerebras) _cerebras = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY || process.env.CHAVE_API_CEREBRAS!,
  });
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

let _groqChat: OpenAI | null = null;
function groqChatClient(): OpenAI {
  if (!_groqChat) _groqChat = new OpenAI({
    apiKey:  process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  return _groqChat;
}

let _openRouter: OpenAI | null = null;
function openRouterClient(): OpenAI {
  if (!_openRouter) _openRouter = new OpenAI({
    apiKey:  process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      // OpenRouter exige esses headers pra atribuir uso ao app
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://romatecvoiceagent-production.up.railway.app',
      'X-Title':      'ZAYRA Romatec',
    },
  });
  return _openRouter;
}

// GitHub Models (6º elo) — endpoint OpenAI-compatible que dá acesso a GPT-4o,
// Phi-4, Llama-3.3-70B, Mistral-large e outros, autenticando com GITHUB_TOKEN.
// Free tier generoso (rate-limit por modelo, sem cobrança).
let _githubModels: OpenAI | null = null;
function githubModelsClient(): OpenAI {
  if (!_githubModels) _githubModels = new OpenAI({
    apiKey:  process.env.GITHUB_TOKEN,
    baseURL: 'https://models.inference.ai.azure.com',
  });
  return _githubModels;
}

// Cloudflare Workers AI (7º elo) — edge brasileiro (latência < 100ms BR).
// Endpoint OpenAI-compatible: /v1/chat/completions. Auth via Bearer + ACCOUNT_ID.
let _cloudflare: OpenAI | null = null;
function cloudflareClient(): OpenAI {
  const token   = process.env.CLOUDFLARE_API_TOKEN  || process.env.TOKEN_API_CLOUDFLARE;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.ID_CONTA_CLOUDFLARE;
  if (!_cloudflare) _cloudflare = new OpenAI({
    apiKey:  token,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
  });
  return _cloudflare;
}

// v1.49.0: OpenAI direto — backbone alternativo quando Claude está sem crédito.
// gpt-4o-mini é ~70× mais barato que Claude e raramente falha.
let _openai: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
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

// ── Helper genérico pra qualquer provider OpenAI-compatible ────────────────
// (Cerebras, Groq, OpenRouter — todos usam o mesmo SDK com baseURL diferente)
async function chamarOpenAICompatible(
  client:        Cerebras | OpenAI,
  model:         string,
  providerName:  string,
  systemPrompt:  string,
  history:       CascadeMessage[],
  userMessage:   string,
): Promise<CascadeResult> {
  const tools = toolsParaOpenAI();
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolsUsed: string[] = [];
  let totalIn = 0, totalOut = 0;

  const create = (msgs: any[]) => (client as OpenAI).chat.completions.create({
    model,
    max_completion_tokens: MAX_OUTPUT,
    messages: msgs,
    tools,
    tool_choice: 'auto',
  } as any);

  let response: any = await create(messages);
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

    response = await create(messages);
    totalIn  += response.usage?.prompt_tokens     ?? 0;
    totalOut += response.usage?.completion_tokens ?? 0;
  }

  const text = response.choices?.[0]?.message?.content?.trim() || '';
  // Trata resposta vazia como falha pra continuar a cascata (em vez de retornar
  // "Não consegui processar" e parar nesse provider)
  if (!text || text.length < 3) {
    throw new Error(`${providerName} retornou resposta vazia (${totalIn} in / ${totalOut} out)`);
  }
  return {
    text,
    toolsUsed,
    provider: `${providerName} ${model} (${totalIn} in / ${totalOut} out)`,
  };
}

// ── CEREBRAS (1º elo da cascata) ───────────────────────────────────────────
async function chamarCerebras(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
): Promise<CascadeResult> {
  return chamarOpenAICompatible(
    cerebrasClient(), CEREBRAS_MODEL, 'Cerebras',
    systemPrompt, history, userMessage,
  );
}

// ── GROQ chat (4º elo) ──────────────────────────────────────────────────────
async function chamarGroqChat(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
): Promise<CascadeResult> {
  return chamarOpenAICompatible(
    groqChatClient(), GROQ_CHAT_MODEL, 'Groq',
    systemPrompt, history, userMessage,
  );
}

// ── OPENROUTER (5º elo) ─────────────────────────────────────────────────────
async function chamarOpenRouter(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
): Promise<CascadeResult> {
  return chamarOpenAICompatible(
    openRouterClient(), OPENROUTER_MODEL, 'OpenRouter',
    systemPrompt, history, userMessage,
  );
}

// ── GITHUB MODELS (6º elo) — GPT-4o-mini/Phi-4/Llama via GitHub ────────────
async function chamarGitHub(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
): Promise<CascadeResult> {
  return chamarOpenAICompatible(
    githubModelsClient(), GITHUB_MODEL, 'GitHub',
    systemPrompt, history, userMessage,
  );
}

// ── CLOUDFLARE WORKERS AI (7º elo) — Llama-3.3 em edge BR ──────────────────
async function chamarCloudflare(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
): Promise<CascadeResult> {
  return chamarOpenAICompatible(
    cloudflareClient(), CLOUDFLARE_MODEL, 'Cloudflare',
    systemPrompt, history, userMessage,
  );
}

// ── OPENAI direto (v1.49.0) — backbone alternativo barato ──────────────────
async function chamarOpenAI(
  systemPrompt: string,
  history:      CascadeMessage[],
  userMessage:  string,
): Promise<CascadeResult> {
  return chamarOpenAICompatible(
    openaiClient(), OPENAI_MODEL, 'OpenAI',
    systemPrompt, history, userMessage,
  );
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

  const text  = (result.response.text() || '').trim();
  if (!text || text.length < 3) {
    throw new Error(`Gemini retornou resposta vazia (provavelmente quota excedida ou tool loop falhou)`);
  }
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
  const tentativas: { provider: string; razao: string }[] = [];

  // v1.49.0 — Nova ordem da cascata:
  // 1) Gemini  (1M ctx, free tier 20 req/dia, paid muito barato — barato + robusto)
  // 2) Cerebras (qwen-3-235b 32k ctx, free tier rápido, sem vision)
  // 3) Claude   (200k ctx, sempre cabe, principal pago — só se Anthropic OK)
  // 4) OpenAI   (gpt-4o-mini, ~$0.15/1M tokens — backbone se Claude offline)
  // 5) Groq     (llama-3.3-70b free, mas TPM ~6k limita)
  // 6) OpenRouter (free, sem pré-flight)
  // 7) GitHub Models (gpt-4o-mini free, max 8k tokens)
  // 8) Cloudflare Workers AI (edge BR)

  // ── 1) GEMINI ────────────────────────────────────────────────────────────
  if (process.env.GEMINI_API_KEY) {
    try {
      const r = await chamarGemini(systemPrompt, truncado, userMessage, attachments);
      console.log(`[AI] ✅ ${r.provider}`);
      return r;
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      console.warn(`[AI] ⚠️ Gemini falhou: ${m}`);
      tentativas.push({ provider: 'Gemini', razao: m.slice(0, 200) });
    }
  } else {
    tentativas.push({ provider: 'Gemini', razao: 'GEMINI_API_KEY não setada' });
  }

  // ── 2) CEREBRAS (sem vision) ─────────────────────────────────────────────
  if (!hasAttachments && process.env.CEREBRAS_API_KEY) {
    const estimated = estimatePromptTokens(systemPrompt, truncado, userMessage);
    if (estimated > CEREBRAS_MAX_INPUT_TOKENS) {
      const razao = `prompt ~${estimated} > janela ${CEREBRAS_MAX_INPUT_TOKENS}`;
      console.warn(`[AI] ⚠️ Cerebras pulado: ${razao}`);
      tentativas.push({ provider: 'Cerebras', razao });
    } else {
      try {
        const r = await chamarCerebras(systemPrompt, truncado, userMessage);
        console.log(`[AI] ✅ ${r.provider}`);
        return r;
      } catch (err) {
        const m = (err as Error).message ?? String(err);
        console.warn(`[AI] ⚠️ Cerebras falhou: ${m}`);
        tentativas.push({ provider: 'Cerebras', razao: m.slice(0, 200) });
      }
    }
  } else if (hasAttachments) {
    tentativas.push({ provider: 'Cerebras', razao: 'sem suporte a anexos (vision)' });
  }

  // ── 3) CLAUDE ────────────────────────────────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await chamarClaude(systemPrompt, truncado, userMessage, attachments);
      console.log(`[AI] ✅ ${r.provider}`);
      return r;
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      console.warn(`[AI] ⚠️ Claude falhou: ${m}`);
      tentativas.push({ provider: 'Claude', razao: m.slice(0, 200) });
    }
  } else {
    tentativas.push({ provider: 'Claude', razao: 'ANTHROPIC_API_KEY não setada' });
  }

  // ── 4) OPENAI direto (v1.49.0) ───────────────────────────────────────────
  if (!hasAttachments && process.env.OPENAI_API_KEY) {
    try {
      const r = await chamarOpenAI(systemPrompt, truncado, userMessage);
      console.log(`[AI] ✅ ${r.provider}`);
      return r;
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      console.warn(`[AI] ⚠️ OpenAI falhou: ${m}`);
      tentativas.push({ provider: 'OpenAI', razao: m.slice(0, 200) });
    }
  } else if (!process.env.OPENAI_API_KEY) {
    tentativas.push({ provider: 'OpenAI', razao: 'OPENAI_API_KEY não setada (opcional)' });
  }

  // ── 5) GROQ ──────────────────────────────────────────────────────────────
  if (!hasAttachments && process.env.GROQ_API_KEY) {
    const estimated = estimatePromptTokens(systemPrompt, truncado, userMessage);
    if (estimated > GROQ_MAX_INPUT_TOKENS) {
      const razao = `prompt ~${estimated} > TPM ${GROQ_MAX_INPUT_TOKENS}`;
      console.warn(`[AI] ⚠️ Groq pulado: ${razao}`);
      tentativas.push({ provider: 'Groq', razao });
    } else {
      try {
        const r = await chamarGroqChat(systemPrompt, truncado, userMessage);
        console.log(`[AI] ✅ ${r.provider}`);
        return r;
      } catch (err) {
        const m = (err as Error).message ?? String(err);
        console.warn(`[AI] ⚠️ Groq falhou: ${m}`);
        tentativas.push({ provider: 'Groq', razao: m.slice(0, 200) });
      }
    }
  }

  // ── 6) OPENROUTER ────────────────────────────────────────────────────────
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const r = await chamarOpenRouter(systemPrompt, truncado, userMessage);
      console.log(`[AI] ✅ ${r.provider}`);
      return r;
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      console.warn(`[AI] ⚠️ OpenRouter falhou: ${m}`);
      tentativas.push({ provider: 'OpenRouter', razao: m.slice(0, 200) });
    }
  }

  // ── 7) GITHUB MODELS ─────────────────────────────────────────────────────
  if (!hasAttachments && process.env.GITHUB_TOKEN) {
    try {
      const r = await chamarGitHub(systemPrompt, truncado, userMessage);
      console.log(`[AI] ✅ ${r.provider}`);
      return r;
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      console.warn(`[AI] ⚠️ GitHub Models falhou: ${m}`);
      tentativas.push({ provider: 'GitHub', razao: m.slice(0, 200) });
    }
  }

  // ── 8) CLOUDFLARE (último elo) ───────────────────────────────────────────
  if (!hasAttachments && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
    try {
      const r = await chamarCloudflare(systemPrompt, truncado, userMessage);
      console.log(`[AI] ✅ ${r.provider}`);
      return r;
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      console.warn(`[AI] ⚠️ Cloudflare falhou: ${m}`);
      tentativas.push({ provider: 'Cloudflare', razao: m.slice(0, 200) });
    }
  }

  // v1.49.0: erro detalhado por provider em vez de checklist genérico
  const detalhes = tentativas.map(t => `  • ${t.provider}: ${t.razao}`).join('\n');
  throw new Error(
    `Cascata IA esgotada (${tentativas.length} providers tentados):\n${detalhes}\n\n` +
    `Ações sugeridas: recarregar Anthropic (https://console.anthropic.com/settings/billing), ` +
    `ativar billing Gemini, ou setar OPENAI_API_KEY.`
  );
}
