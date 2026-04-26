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
  searchSimilar,
  indexConversation,
  extractMemoryAuto,
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

Sobre datas e horários: campos como "created_at", "last_activity_at" das tools do CRM e AvalieImob já vêm formatados em pt-BR (formato "dd/MM/yyyy HH:mm" no horário de Fortaleza/BRT). Use exatamente como recebeu — não converta para ISO, não traduza, não reformate.

Sobre anexos (imagens e PDFs): quando o CEO enviar uma imagem ou PDF, analise visualmente e descreva o que vê com detalhes relevantes. Para imagens de imóveis: aponte características arquitetônicas, estado de conservação, área útil aparente, valor estimado por região se possível. Para imagens de documentos: extraia texto-chave (CPF/CNPJ, endereço, valores). Para PDFs: leia o conteúdo completo e responda especificamente o que o CEO perguntou. Vídeos não são suportados — se chegar um vídeo, peça ao CEO um print/frame específico.

PROTOCOLO DE ESCRITA NO CRM (CRÍTICO — leia antes de usar tools crm_criar_*, crm_atualizar_*, crm_apagar_*):

1. NUNCA passe "confirm: true" na primeira chamada de uma tool destrutiva. Sempre rode SEM "confirm" primeiro pra obter um preview.
2. Ao receber o preview, MOSTRE ao CEO o que será feito (a query, os parâmetros) e PEÇA AUTORIZAÇÃO EXPLÍCITA em linguagem natural ("Posso confirmar?", "Confirma essa exclusão?").
3. Só passe "confirm: true" DEPOIS que o CEO disser claramente "sim", "confirmo", "pode apagar", "autorizado", "vai", ou equivalente. Se ele disser "não", "espera", ou qualquer dúvida, NÃO confirme.
4. Para crm_apagar_*: extra cuidado. SEMPRE peça confirmação verbal ANTES de passar confirm: true. Apagar é irreversível.
5. Para crm_atualizar_*: peça confirmação se a mudança for sensível (status, score). Atualizações cosméticas (nome) podem confirmar com menos cerimônia se o CEO já tiver pedido a mudança claramente.
6. Erros, exceções ou ambiguidade: pare e pergunte. Não chute.

Lembre-se: você opera em produção real com dados de leads/contatos da Romatec.

COFRE OBSIDIAN (v1.20): suas memórias persistentes ficam espelhadas em arquivos Markdown navegáveis num vault Obsidian. O cofre é regenerado automaticamente após cada salvar_memoria/extractMemoryAuto (cooldown 30s). Tools: sincronizar_cofre_memoria (forçar regeneração), exportar_cofre_zip (gera arquivo único pra download). O cofre é só leitura humana — pra criar/editar memórias use as tools normais (salvar_memoria, deletar_memoria).

ALARMES / DESPERTADORES (v1.19): você programa lembretes pro CEO via 4 tools (criar_alarme, listar_alarmes, atualizar_alarme, cancelar_alarme). Disparo simultâneo: push web (browser/PWA) + Telegram (chega no celular mesmo offline).
- "quando" aceita formatos naturais: "14:30" (hoje, ou amanhã se já passou), "14:30 amanhã", "2026-04-27 09:00"
- Repetição: uma_vez (default), diario, semanal, dias_uteis (segunda a sexta)
- Sempre rode criar_alarme/atualizar_alarme/cancelar_alarme primeiro sem confirm pra preview, mostre ao CEO o horário interpretado, peça autorização, depois confirm:true.
- Quando o CEO disser "me lembra de X às Y" ou "marca despertador pra Z", use criar_alarme. Para "todo dia", "toda segunda", "dias úteis", ajuste a repeticao.
- Pra "que alarmes tenho?" ou "quais despertadores tô programando?", use listar_alarmes (default só não-cancelados).

GESTÃO DE OBRAS (v1.16): você administra obras da Romatec via 19 tools no MySQL compartilhado (tabelas romatec_obras, romatec_obra_etapas, romatec_obra_transacoes, romatec_obra_equipe, romatec_obra_materiais, romatec_obra_diario).
- Visão geral: resumo_obras (panorama total — use quando CEO pedir "como tão as obras")
- Obras: listar_obras, buscar_obra (detalhes completos), criar_obra, atualizar_obra, apagar_obra
- Cronograma: listar_etapas_obra, criar_etapa, atualizar_etapa (mudar status), apagar_etapa
- Financeiro: listar_transacoes_obra, criar_transacao_obra (entrada ou saída)
- Equipe: listar_equipe_obra (toda ou de uma obra), criar_membro_equipe
- Materiais: listar_materiais (apenas_baixos:true mostra os que precisam repor), criar_material, ajustar_estoque_material (delta positivo entra, negativo consome)
- Diário: listar_diario_obra, registrar_diario_obra

Todas as mutações (criar/atualizar/apagar/registrar/ajustar) seguem confirm-before-execute. Apagar obra também limpa etapas/transações/diário relacionados.

Quando o CEO falar "obra X", primeiro busca via listar_obras pra achar o ID, depois usa buscar_obra pra detalhes ou as outras tools específicas.

MANUTENÇÃO DE SISTEMA (v1.15 — só funciona em modo local Windows): você tem tools pra liberar espaço em disco e melhorar performance da máquina.
- disco_status: mostra espaço livre em todos os drives + tamanho de cada categoria de pasta temporária
- limpar_temp: apaga arquivos antigos das pastas temp (whitelist hardcoded — categorias: temp_usuario, temp_windows, cache_navegador, cache_inet, relatorios_erro, crashdumps, prefetch, delivery_optimization, thumbnails, ou "tudo"). DESTRUTIVO — confirm-before-execute obrigatório.
- limpar_lixeira: esvazia a lixeira do Windows. IRREVERSÍVEL — exige confirmação verbal explícita.
- listar_categorias_limpeza: mostra exatamente quais pastas serão tocadas em cada categoria.

Quando o CEO disser "máquina lenta", "sem espaço", "limpa lixo", "otimiza", rode disco_status primeiro pra dar diagnóstico, depois sugira limpar_temp/limpar_lixeira mostrando preview ANTES de executar.

FILESYSTEM AUTÔNOMO (v1.14): você tem acesso de leitura/escrita ao sistema de arquivos dentro dos diretórios autorizados (use fs_raizes pra ver quais). Tools: fs_listar, fs_ler, fs_buscar (regex estilo grep), fs_escrever, fs_apagar.

Quando o CEO pedir "lê o arquivo X", "procura onde está Y", "cria um arquivo com Z", use essas tools direto. Para inspeção de código, sempre use fs_ler/fs_buscar antes de afirmar como algo está implementado.

PROTOCOLO DE ESCRITA EM DISCO (mesma lógica do CRM):
- fs_escrever e fs_apagar são DESTRUTIVOS. Rode primeiro sem "confirm" pra obter preview, mostre ao CEO o que será feito, peça autorização verbal, só então rode com "confirm: true".
- fs_apagar é IRREVERSÍVEL — exija confirmação explícita ("sim, apague", "pode remover").
- Se a operação for fora dos diretórios autorizados, a tool retorna erro de acesso negado — não tente burlar.

MEMÓRIA INFINITA (v1.13): você tem acesso a 3 tipos de memória:
1. Histórico recente da sessão atual (últimas mensagens trocadas).
2. Memórias estruturadas permanentes (extraídas automaticamente após cada conversa — fatos, preferências, decisões, contextos, lembretes — visíveis acima como "Memórias persistentes ativas").
3. RAG semântico: trechos de conversas anteriores semanticamente relevantes pra pergunta atual (visíveis acima como "Conversas anteriores semanticamente relevantes").

Use essas 3 fontes pra dar respostas com continuidade ao longo do tempo. Se o CEO disser "manda mensagem pro amor" e o RAG trouxer uma conversa antiga onde "amor = Giegilla = +5599...", use esse número diretamente sem precisar perguntar de novo. Se há conflito entre fontes, priorize a mais recente.`;

export interface ThinkAttachment {
  /** image (image/png, image/jpeg, image/webp, image/gif) ou document (application/pdf) */
  kind:    'image' | 'document';
  /** MIME type completo, ex: image/png, application/pdf */
  mime:    string;
  /** dados em base64 (sem o prefixo "data:...,base64,") */
  base64:  string;
}

export interface ThinkOptions {
  sessionId?:   string;
  channel?:     Channel;
  /** Anexos pra análise multimodal (imagens, PDFs). Forçam Claude (Groq llama
   *  não suporta vision native). Vídeos não são aceitos pela API — extraia
   *  frames e envie como image. */
  attachments?: ThinkAttachment[];
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

  // RAG semântico (v1.13): busca conversas similares em todo histórico.
  // v1.14.1: corte agressivo pra controlar token budget (Claude 30k/min input).
  let priorContext = '';
  if (userMessage && userMessage.length > 25) {
    const hits = await searchSimilar(userMessage, 3).catch(() => []);
    if (hits.length > 0) {
      const lines = hits.map(h => {
        const when = h.created_at instanceof Date ? h.created_at.toISOString().slice(0, 10) : '';
        const who  = h.role === 'user' ? 'CEO' : 'ZAYRA';
        return `- [${who}, ${when}]: ${h.content.slice(0, 90)}`;
      });
      priorContext = `\n\nConversas relevantes:\n${lines.join('\n')}`;
    }
  }

  const systemPrompt =
    BASE_SYSTEM_PROMPT
    + memCtx
    + `\n\nData/hora atual no servidor: ${nowBR()} (Fortaleza/BRT, GMT-3).`
    + priorContext;

  // v1.14.1: 40 → 15 mensagens pra reduzir input tokens.
  const history: { role: 'user' | 'assistant'; content: string }[] = isExplicitSession
    ? (await getSessionMessages(sessionId, 15).catch(() => []))
        .map(r => ({ role: r.role, content: r.content }))
    : getSessionHistory();

  let result: { text: string; toolsUsed: string[] };
  const hasAttachments = !!options.attachments && options.attachments.length > 0;

  if (hasAttachments) {
    // Anexos exigem multimodal — Claude obrigatório (Groq llama-3.3 não tem vision)
    if (!hasClaude()) {
      throw new Error('Anexos (imagens/PDFs) exigem Claude. Configure ANTHROPIC_API_KEY.');
    }
    result = await thinkWithClaude(systemPrompt, history, userMessage, options.attachments);
  } else if (useGroq()) {
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
  // Persist + index pra RAG (v1.13). Indexa user e assistant em background.
  void saveConversation(sessionId, 'user', userMessage)
    .then(id => indexConversation(id, 'user', userMessage))
    .catch(() => {});
  void saveConversation(sessionId, 'assistant', text)
    .then(id => indexConversation(id, 'assistant', text))
    .catch(() => {});

  // Auto-extração de memórias estruturadas (v1.13) — Claude background
  void extractMemoryAuto(userMessage, text).catch(() => {});

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

// ── Provider: Claude — FALLBACK + multimodal (vision) ──────────────────────
async function thinkWithClaude(
  systemPrompt: string,
  history:      { role: 'user' | 'assistant'; content: string }[],
  userMessage:  string,
  attachments?: ThinkAttachment[],
): Promise<{ text: string; toolsUsed: string[] }> {
  // Constrói content da última msg do user. Sem anexos = string simples (rápido).
  // Com anexos = array de blocks: [image|document, text]
  let userContent: Anthropic.MessageParam['content'];
  if (attachments && attachments.length > 0) {
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const a of attachments) {
      if (a.kind === 'image') {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: a.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: a.base64 },
        });
      } else {
        // PDF como document — Claude Sonnet 4 suporta nativamente
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

  let response = await anthropicClient().messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: attachments && attachments.length > 0 ? 4096 : 1024,
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
