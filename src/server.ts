import 'dotenv/config';
import './util/logBR';            // side-effect: patches console.* with [HH:MM BRT] prefix
import path from 'path';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { transcribeAudio } from './agent/transcribe';
import { think } from './agent/think';
import { speak } from './agent/speak';
import { AGENT_IDENTITY } from './agent/identity';
import * as crm from './integrations/crm';
import * as avalieimob from './integrations/avalieimob';
import { processMessage, sendReply, parseZapiWebhook, logInbound } from './integrations/whatsapp';
import * as telegram from './integrations/telegram';
import { getAuthUrl, exchangeCode } from './integrations/calendar';
import * as spotify from './integrations/spotify';
import { addSSEClient, removeSSEClient, startProactiveNotifications } from './agent/proactive';
import {
  initDb,
  loadSessionFromDb,
  listMemories,
  createChatSession,
  listChatSessions,
  getSessionMessages,
  getSessionMeta,
  deleteChatSession,
  searchConversations,
  newSessionId,
} from './agent/memory';
import { startDailyScheduler } from './agent/scheduler';
import * as calendar from './integrations/calendar';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json());

// Static files com Cache-Control inteligente:
// HTML/SW/manifest = no-cache (browser revalida a cada request com ETag)
// Imagens/outros = 1h (suficiente — ETag também garante consistência)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

app.use((_req, res, next) => {
  res.set('X-Agent', `${AGENT_IDENTITY.name}/${AGENT_IDENTITY.version}`);
  next();
});

app.get('/', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/ping', (_req: Request, res: Response) => {
  res.send('OK');
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ agent: AGENT_IDENTITY.name, version: AGENT_IDENTITY.version, status: 'online', timestamp: new Date().toISOString() });
});

// ── Diagnóstico de providers ──────────────────────────────────────────────────
app.get('/health/providers', async (_req: Request, res: Response) => {
  const results: Record<string, unknown> = {
    agent:     AGENT_IDENTITY.name,
    version:   AGENT_IDENTITY.version,
    timestamp: new Date().toISOString(),
  };

  // Groq
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqKey}` },
      });
      const data = await r.json() as { data?: { id: string }[] };
      const modelos = (data.data ?? []).map((m: { id: string }) => m.id).filter((id: string) => id.includes('whisper') || id.includes('llama'));
      results.groq = { status: r.ok ? '✅ online' : '❌ erro', modelos };
    } catch (err) {
      results.groq = { status: '❌ falhou', erro: String(err) };
    }
  } else {
    results.groq = { status: '⚠️ GROQ_API_KEY não configurado' };
  }

  // Claude
  results.claude = process.env.ANTHROPIC_API_KEY
    ? { status: '✅ configurado', modelo: 'claude-sonnet-4-6' }
    : { status: '⚠️ ANTHROPIC_API_KEY não configurado' };

  // OpenAI (TTS)
  results.openai = process.env.OPENAI_API_KEY
    ? { status: '✅ configurado', uso: 'TTS (síntese de voz)' }
    : { status: '⚠️ OPENAI_API_KEY não configurado' };

  // Modo ativo
  results.transcricao = groqKey ? 'Groq Whisper (rápido)' : 'OpenAI Whisper';
  results.raciocinio  = groqKey
    ? `Groq ${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'} (principal)`
    : 'Claude Sonnet 4.6 (fallback)';

  res.json(results);
});

app.post('/voice', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo de áudio enviado.' });
      return;
    }

    const sessionId = (req.body?.session_id as string | undefined) || undefined;

    const transcription = await transcribeAudio(req.file.buffer, req.file.mimetype);
    const agentResponse = await think(transcription.text, { sessionId, channel: 'voice' });
    const audioBuffer   = await speak(agentResponse.text);

    res.set({
      'Content-Type':     'audio/mpeg',
      'X-Transcription':  encodeURIComponent(transcription.text),
      'X-Response-Text':  encodeURIComponent(agentResponse.text),
      'X-Tools-Used':     agentResponse.toolsUsed.join(','),
      'X-Session-Id':     agentResponse.sessionId,
    });
    res.send(audioBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /voice]', msg);
    res.status(500).json({ error: msg });
  }
});

app.post('/text', async (req: Request, res: Response) => {
  try {
    const { message, voice = false, session_id } = req.body as {
      message:     string;
      voice?:      boolean;
      session_id?: string;
    };

    if (!message) {
      res.status(400).json({ error: 'Campo "message" obrigatório.' });
      return;
    }

    const agentResponse = await think(message, { sessionId: session_id, channel: 'text' });

    if (voice) {
      const audioBuffer = await speak(agentResponse.text);
      res.set({
        'Content-Type':    'audio/mpeg',
        'X-Response-Text': encodeURIComponent(agentResponse.text),
        'X-Session-Id':    agentResponse.sessionId,
      });
      res.send(audioBuffer);
      return;
    }

    res.json({
      agent:      AGENT_IDENTITY.name,
      response:   agentResponse.text,
      tools_used: agentResponse.toolsUsed,
      session_id: agentResponse.sessionId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /text]', msg);
    res.status(500).json({ error: msg });
  }
});

// ── Chat Sessions API ─────────────────────────────────────────────────────────
app.post('/chat/sessions', async (req: Request, res: Response) => {
  try {
    const { title, channel } = (req.body ?? {}) as { title?: string; channel?: 'text' | 'voice' | 'whatsapp' | 'mixed' };
    const id = await createChatSession(title, channel ?? 'text', newSessionId());
    res.json({ id, title: title ?? null, channel: channel ?? 'text' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/chat/sessions', async (req: Request, res: Response) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const sessions = await listChatSessions(limit, offset);
    res.json({ count: sessions.length, sessions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/chat/sessions/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const meta = await getSessionMeta(id);
    if (!meta) { res.status(404).json({ error: 'Sessão não encontrada' }); return; }
    const messages = await getSessionMessages(id, 500);
    res.json({ session: meta, messages });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/chat/sessions/:id', async (req: Request, res: Response) => {
  try {
    await deleteChatSession(String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/chat/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string ?? '').trim();
    if (!q) { res.json({ count: 0, hits: [] }); return; }
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const hits  = await searchConversations(q, limit);
    res.json({ count: hits.length, hits });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/briefing', async (_req: Request, res: Response) => {
  // Per-integration timeout: 5s. Distinguishes "empty success" from "timeout error".
  const TIMEOUT_MS = 5000;
  const withTimeout = <T>(p: Promise<T>): Promise<T> => Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('integration_timeout')), TIMEOUT_MS)),
  ]);

  const [leads, contratos, campanhas, servicos, agendaHoje] = await Promise.allSettled([
    withTimeout(crm.listarLeads({ limite: 100 })),
    withTimeout(avalieimob.listarContratos({ status: 'pendente' })),
    withTimeout(crm.listarCampanhas()),
    withTimeout(avalieimob.statusServicos()),
    withTimeout(calendar.listarEventosDia()),
  ]);

  // Build a status map so the LLM (and the JSON consumer) can tell empty from offline.
  const statusOf = (r: PromiseSettledResult<unknown>) => r.status === 'fulfilled' ? 'ok' : 'offline';
  const integrations = {
    crm_leads:     statusOf(leads),
    crm_campanhas: statusOf(campanhas),
    avalieimob_contratos: statusOf(contratos),
    avalieimob_servicos:  statusOf(servicos),
    google_calendar:      statusOf(agendaHoje),
  };

  const data = {
    leads:               leads.status       === 'fulfilled' ? leads.value       : [],
    contratos_pendentes: contratos.status   === 'fulfilled' ? contratos.value   : [],
    campanhas:           campanhas.status   === 'fulfilled' ? campanhas.value   : [],
    servicos:            servicos.status    === 'fulfilled' ? servicos.value    : { online: false },
    agenda_hoje:         agendaHoje.status  === 'fulfilled' ? agendaHoje.value  : [],
  };

  // Tell the LLM exactly what is online vs offline so it can't hallucinate generalizations.
  const integrationLines = Object.entries(integrations)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const briefingText = await think(
    `Gere um resumo executivo do dia em português, formato curto.

Estado das integrações:
${integrationLines}

Dados disponíveis (apenas integrações com status "ok" são reais; "offline" significa que a integração não respondeu — não invente dados, e quando "ok" retornar lista vazia, isso significa "sem itens hoje", NÃO erro):
- leads.length: ${data.leads.length}
- contratos_pendentes.length: ${data.contratos_pendentes.length}
- campanhas.length: ${data.campanhas.length}
- agenda_hoje.length: ${data.agenda_hoje.length}

Mencione apenas o que for relevante. Para integrações offline, diga apenas "{nome} indisponível no momento" — não trate como dado vazio.`,
  );

  res.json({
    agent: AGENT_IDENTITY.name,
    briefing: briefingText.text,
    integrations,
    data,
  });
});

// ── SSE — Notificações proativas ─────────────────────────────────────────────
app.get('/notifications/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = addSSEClient(res);
  req.on('close', () => removeSSEClient(clientId));
});

// ── WhatsApp webhook (formato ZAPI) ──────────────────────────────────────────
// ZAPI manda 1 mensagem por POST. Aceita também o formato antigo (Meta-style com messages[])
app.post('/webhook/whatsapp', (req: Request, res: Response) => {
  res.json({ status: 'ok' }); // ack imediato — processa async pra não travar ZAPI
  const body = req.body ?? {};

  // Tenta formato ZAPI (1 mensagem por payload)
  const msgsZapi = parseZapiWebhook(body);

  // Fallback: formato Meta-like com array messages[]
  const legacyMsgs = Array.isArray((body as { messages?: unknown[] }).messages)
    ? (body as { messages: unknown[] }).messages
    : [];

  const allMsgs = msgsZapi.length > 0 ? msgsZapi : (legacyMsgs as Parameters<typeof processMessage>[0][]);

  void (async () => {
    for (const msg of allMsgs) {
      try {
        // Log inbound (fire-and-forget)
        const userText = msg.type === 'text' ? msg.text.body : '[áudio]';
        void logInbound(msg.from, userText, msg.id).catch(() => {});

        const reply = await processMessage(msg);
        await sendReply(msg.from, reply);
      } catch (err) {
        console.error('[WhatsApp webhook]', err instanceof Error ? err.message : err);
      }
    }
  })();
});

// ── Telegram webhook (v1.9.0) ────────────────────────────────────────────────
app.post('/webhook/telegram', (req: Request, res: Response) => {
  res.json({ ok: true }); // ack imediato — Telegram reenvia se demorar >1s
  const incoming = telegram.parseTelegramUpdate(req.body);
  if (!incoming) return;
  void telegram.processTelegramIncoming(incoming).catch(err =>
    console.error('[Telegram webhook]', err instanceof Error ? err.message : err),
  );
});

// Helper pra registrar webhook no Telegram (chame uma vez no browser)
app.get('/auth/telegram/setup', async (req: Request, res: Response) => {
  try {
    const baseUrl = (req.protocol + '://' + req.get('host')).replace(/\/$/, '');
    const target  = `${baseUrl}/webhook/telegram`;
    const result  = await telegram.setWebhook(target);
    const info    = await telegram.getBotInfo();
    res.send(
      `<h2 style="font-family:sans-serif;color:#00ff88">Telegram webhook setup</h2>` +
      `<p style="font-family:sans-serif">Webhook URL: <code>${target}</code></p>` +
      `<pre style="font-family:monospace;background:#0a1a0f;color:#00ff88;padding:12px;border-radius:8px">${JSON.stringify({ setWebhook: result, botInfo: info }, null, 2)}</pre>` +
      (info.online
        ? `<p style="font-family:sans-serif">Bot ativo: <b>@${info.username}</b>. Mande uma DM pra ele pra testar.</p>`
        : `<p style="color:#ff5577">Bot não respondeu — verifique TELEGRAM_BOT_TOKEN no Railway.</p>`),
    );
  } catch (err) {
    res.status(500).send(`Erro: ${String(err)}`);
  }
});

app.post('/zayra/whatsapp', async (req: Request, res: Response) => {
  const { message, from, session_id } = req.body as { message: string; from?: string; session_id?: string };
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  const agentResponse = await think(message, { sessionId: session_id, channel: 'whatsapp' });
  if (from) void sendReply(from, agentResponse.text).catch(console.error);
  res.json({ response: agentResponse.text, tools_used: agentResponse.toolsUsed, session_id: agentResponse.sessionId });
});

// ── Google Calendar OAuth ─────────────────────────────────────────────────────
app.get('/auth/google', (_req: Request, res: Response) => {
  res.redirect(getAuthUrl());
});

app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) { res.status(400).send('Parâmetro code ausente.'); return; }
  try {
    const refreshToken = await exchangeCode(code);
    res.send(
      `<h2 style="font-family:sans-serif">✅ Google Calendar conectado!</h2>` +
      `<p style="font-family:monospace">Adicione ao Railway:<br>` +
      `<b>GOOGLE_REFRESH_TOKEN=${refreshToken}</b></p>`,
    );
  } catch (err) {
    res.status(500).send(`Erro: ${String(err)}`);
  }
});

// ── Spotify OAuth ─────────────────────────────────────────────────────────────
app.get('/auth/spotify', (_req: Request, res: Response) => {
  try {
    const state = `zayra_${Date.now().toString(36)}`;
    res.redirect(spotify.getAuthUrl(state));
  } catch (err) {
    res.status(500).send(`Erro: ${String(err)}`);
  }
});

app.get('/auth/spotify/callback', async (req: Request, res: Response) => {
  const code  = req.query.code  as string | undefined;
  const error = req.query.error as string | undefined;
  if (error) { res.status(400).send(`<h2>❌ Spotify recusou: ${error}</h2>`); return; }
  if (!code) { res.status(400).send('Parâmetro code ausente.'); return; }
  try {
    const refreshToken = await spotify.exchangeCode(code);
    res.send(
      `<h2 style="font-family:sans-serif">✅ Spotify conectado!</h2>` +
      `<p style="font-family:sans-serif">Adicione esta variável ao Railway:</p>` +
      `<pre style="font-family:monospace;background:#0a1a0f;color:#00ff88;padding:12px;border-radius:8px;overflow-x:auto">SPOTIFY_REFRESH_TOKEN=${refreshToken}</pre>` +
      `<p style="font-family:sans-serif;color:#7aab8a;font-size:.85rem">Após adicionar e o Railway redeployar (~3min), abra o Spotify em algum dispositivo e teste com "ZAYRA, toca Coldplay".</p>`,
    );
  } catch (err) {
    res.status(500).send(`Erro: ${String(err)}`);
  }
});

// ── Memory endpoint ───────────────────────────────────────────────────────────
app.get('/memory', async (_req: Request, res: Response) => {
  try {
    const memories = await listMemories();
    res.json({ agent: AGENT_IDENTITY.name, count: memories.length, memories });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Last-resort guardrails: prevent transient provider/DB errors from killing the process
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`${AGENT_IDENTITY.name} v${AGENT_IDENTITY.version} rodando na porta ${PORT}`);
  startProactiveNotifications();
  startDailyScheduler();
  void initDb()
    .then(() => loadSessionFromDb())
    .catch(err => console.warn('[Memory] Init failed (continuing without DB):', err));
});

export default app;
