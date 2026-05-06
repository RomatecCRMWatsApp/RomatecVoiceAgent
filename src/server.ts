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
import { getDriveAuthUrl } from './integrations/driveGoogle';
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
import * as obras from './integrations/obras';
import * as propostas from './integrations/propostas';
import * as propostasConsultoria from './integrations/propostasConsultoria';
import * as despesasExtras from './integrations/despesasExtras';
import * as alarmes from './integrations/alarmes';
import * as cofre from './integrations/cofre';
import * as vistorias from './integrations/vistorias';
import * as cowork from './integrations/cowork';
import ragRoutes from './routes/rag';
import contractsRoutes from './routes/contracts';
import painelRoutes from './routes/painel';

const app = express();
// Railway está atrás de proxy reverso — habilita pra que req.protocol respeite x-forwarded-proto
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
// Multer separado pra anexos multimodais (imagens/PDFs) — Claude aceita até 32MB/PDF e ~5MB/imagem
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024, files: 5 } });

app.use(express.json({ limit: '32mb' })); // VTO usa fotos base64 no body
// v1.65.19: forms HTML do /recibos/confirmar/:token (POST application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: false, limit: '128kb' }));
app.use('/rag', ragRoutes);                 // v1.26.0 — endpoints de memoria vetorial
app.use('/contracts', contractsRoutes);     // v1.27.1 — indexacao de contratos modelo (Fase 1)
app.use(painelRoutes);                      // v1.47.0 — dashboard /painel + /api/painel/stats

// Static files com Cache-Control inteligente:
// HTML/SW/manifest = no-cache (browser revalida a cada request com ETag)
// Imagens/outros = 1h (suficiente — ETag também garante consistência)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json') || filePath.endsWith('.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      if (filePath.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
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

// v1.65.23: diagnostico do MySQL — lista todas as tabelas + valida criticas.
// Resolve Issue #5 (tabelas ausentes em prod sem diagnostico claro).
app.get('/health/db', async (_req: Request, res: Response) => {
  try {
    const { listExistingTables, checkCriticalTables } = await import('./database/migrations');
    const [allTables, critical] = await Promise.all([
      listExistingTables(),
      checkCriticalTables(),
    ]);
    res.json({
      version: AGENT_IDENTITY.version,
      timestamp: new Date().toISOString(),
      totalTables: allTables.length,
      criticalPresent: critical.present,
      criticalMissing: critical.missing,
      allTables,
    });
  } catch (err) {
    res.status(500).json({ error: 'health_db_failed', message: (err as Error).message });
  }
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
      'X-Zayra-Text':     encodeURIComponent(agentResponse.text),
      'X-Tools-Used':     agentResponse.toolsUsed.join(','),
      'X-Session-Id':     agentResponse.sessionId,
      'Access-Control-Expose-Headers': 'X-Transcription, X-Response-Text, X-Zayra-Text, X-Tools-Used, X-Session-Id',
    });
    res.send(audioBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /voice]', msg);
    res.status(500).json({ error: msg });
  }
});

app.post('/text', docUpload.array('files', 5), async (req: Request, res: Response) => {
  try {
    const { message = '', voice: voiceRaw = false, session_id } = (req.body ?? {}) as {
      message?:    string;
      voice?:      boolean | string;
      session_id?: string;
    };
    const voice = voiceRaw === true || voiceRaw === 'true';

    // Multimodal: se vieram files (multipart/form-data), converte pra ThinkAttachment[]
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const attachments = files
      .filter(f => f.mimetype.startsWith('image/') || f.mimetype === 'application/pdf')
      .map(f => ({
        kind:   (f.mimetype === 'application/pdf' ? 'document' : 'image') as 'image' | 'document',
        mime:   f.mimetype,
        base64: f.buffer.toString('base64'),
      }));

    if (!message && attachments.length === 0) {
      res.status(400).json({ error: 'Envie ao menos "message" ou um anexo.' });
      return;
    }

    const agentResponse = await think(message, {
      sessionId: session_id,
      channel:   'text',
      attachments: attachments.length > 0 ? attachments : undefined,
    });

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
// v1.38.5: alias /webhook/zapi pro caso da instância Z-API estar configurada
// com esse path (era o caminho usado pelo CRM antigo). Mesmo handler, paths distintos.
app.post('/webhook/zapi', (req: Request, res: Response) => handleWhatsAppWebhook(req, res));
app.post('/webhook/whatsapp', (req: Request, res: Response) => handleWhatsAppWebhook(req, res));

function handleWhatsAppWebhook(req: Request, res: Response) {
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
        const userText = msg.type === 'text' ? msg.text.body
                       : msg.type === 'audio' ? '[áudio]'
                       : `[PDF: ${msg.document.filename}]`;
        void logInbound(msg.from, userText, msg.id).catch(() => {});

        // v1.65.15 — PR B.3: roteamento contextual de respostas de recibo.
        // v1.65.18 — bloqueio total: ZAYRA NÃO responde mensagem de colaborador.
        // Ordem:
        //   1) tenta rotear como resposta de recibo (1/2/PIX)
        //   2) se não roteou e o remetente é colaborador, repassa ao CEO
        //      e silencia (não chama think)
        //   3) só não-colaboradores caem no fluxo normal da ZAYRA
        try {
          const m = await import('./services/recibosQuinzena');
          if (msg.type === 'text') {
            const r = await m.processarRespostaRecibo({
              phone: msg.from,
              text: msg.text.body,
              messageId: msg.id,
            });
            console.log(`[recibos] roteamento phone=${msg.from} text="${msg.text.body.slice(0,40)}" handled=${r.handled} acao=${r.acao ?? '-'}`);
            if (r.handled) continue;
          }
          const colab = await m.isPhoneDeColaborador(msg.from);
          if (colab) {
            const txt = msg.type === 'text' ? msg.text.body
                      : msg.type === 'audio' ? '[áudio]'
                      : `[doc: ${msg.document.filename}]`;
            console.log(`[recibos] msg de colaborador sem fluxo ativo: ${colab.nome} (${msg.from}). Repasso CEO, ZAYRA silenciada.`);
            await m.notificarCeoMensagemColaborador({
              phone: msg.from, text: txt,
              membroId: colab.membroId, nome: colab.nome, funcao: colab.funcao,
            }).catch(err => console.warn('[recibos] notificarCeo falhou:', (err as Error).message));
            continue; // ZAYRA NÃO responde colaborador
          }
        } catch (err) {
          console.warn('[recibos] roteamento/bloqueio falhou — caindo no fluxo normal:', (err as Error).message);
        }

        const reply = await processMessage(msg);
        await sendReply(msg.from, reply);
      } catch (err) {
        console.error('[WhatsApp webhook]', err instanceof Error ? err.message : err);
      }
    }
  })();
}

// ── Spotify now-playing (v1.9.3) — usado pelo widget da UI ────────────────
app.get('/spotify/now-playing', async (_req: Request, res: Response) => {
  try {
    const data = await spotify.musicaAtual();
    // Cache curto pra reduzir chamadas Spotify se UI fizer polling agressivo
    res.set('Cache-Control', 'public, max-age=10');
    res.json(data);
  } catch (err) {
    res.status(200).json({ tocando: null, error: err instanceof Error ? err.message : String(err) });
  }
});

// Endpoint expandido pra trazer também a capa do álbum
app.get('/spotify/now-playing-rich', async (_req: Request, res: Response) => {
  try {
    const data = await spotify.musicaAtualRich();
    res.set('Cache-Control', 'public, max-age=10');
    res.json(data);
  } catch (err) {
    res.status(200).json({ tocando: null, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Spotify auto-pause (v1.9.2) — chamados pela UI quando mic abre/fecha ───
app.post('/spotify/pause', async (_req: Request, res: Response) => {
  try {
    const r = await spotify.pauseForMic();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/spotify/resume', async (_req: Request, res: Response) => {
  try {
    const r = await spotify.resumeAfterMic();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
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
    // Railway/proxy: req.protocol vem 'http'; força 'https' (Telegram exige HTTPS)
    const proto   = (req.get('x-forwarded-proto') as string | undefined)?.split(',')[0]?.trim() || 'https';
    const baseUrl = `${proto}://${req.get('host')}`.replace(/\/$/, '');
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

// v1.47.1: reautoriza incluindo Drive + Calendar (mesmo callback,
// só muda o scope da URL de consent). Use depois de adicionar Drive.
app.get('/auth/google/drive', (_req: Request, res: Response) => {
  res.redirect(getDriveAuthUrl());
});

app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) { res.status(400).send('Parâmetro code ausente.'); return; }
  try {
    const refreshToken = await exchangeCode(code);
    // Token vai pra clipboard via JS, NÃO pro DOM. Evita exposição em
    // print, cache de browser, screenshare ou histórico de devtools.
    res.set('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a1a0f;color:#e0f2e6;padding:24px">
      <h2>✅ Google Calendar conectado</h2>
      <p>Clique no botão abaixo para copiar o <code>GOOGLE_REFRESH_TOKEN</code> e cole no Railway → Variables.</p>
      <p style="color:#c9a84c">⚠️ NÃO tire print desta página. O token é a senha do Google Calendar.</p>
      <button id="cp" style="background:#00ff88;color:#000;border:0;padding:10px 20px;font-weight:600;cursor:pointer;border-radius:6px">📋 Copiar token (clipboard)</button>
      <span id="ok" style="margin-left:12px;color:#00ff88;display:none">Copiado!</span>
      <script>
        const T=${JSON.stringify(refreshToken)};
        document.getElementById('cp').onclick=async()=>{
          await navigator.clipboard.writeText(T);
          document.getElementById('ok').style.display='inline';
          setTimeout(()=>{T=null;}, 30000);
        };
      </script>
    </body></html>`);
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
    res.set('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a1a0f;color:#e0f2e6;padding:24px">
      <h2>✅ Spotify conectado</h2>
      <p>Clique para copiar o <code>SPOTIFY_REFRESH_TOKEN</code> e cole no Railway → Variables.</p>
      <p style="color:#c9a84c">⚠️ NÃO tire print desta página. O token é a senha do Spotify.</p>
      <button id="cp" style="background:#00ff88;color:#000;border:0;padding:10px 20px;font-weight:600;cursor:pointer;border-radius:6px">📋 Copiar token (clipboard)</button>
      <span id="ok" style="margin-left:12px;color:#00ff88;display:none">Copiado!</span>
      <p style="color:#7aab8a;font-size:.85rem;margin-top:18px">Após colar no Railway e o redeploy (~3min), abra o Spotify em algum dispositivo e teste com "ZAYRA, toca Coldplay".</p>
      <script>
        const T=${JSON.stringify(refreshToken)};
        document.getElementById('cp').onclick=async()=>{
          await navigator.clipboard.writeText(T);
          document.getElementById('ok').style.display='inline';
          setTimeout(()=>{T=null;}, 30000);
        };
      </script>
    </body></html>`);
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

// ── Obras (v1.16) — interface web + API REST ────────────────────────────────
app.get('/obras', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'obras.html'));
});

const apiHandle = (fn: (...args: never[]) => Promise<unknown> | unknown) =>
  async (req: Request, res: Response) => {
    try {
      const args: Record<string, unknown> = {
        ...req.query, ...req.params, ...(req.body ?? {}), confirm: true,
      };
      const data = await (fn as (a: typeof args) => Promise<unknown>)(args);
      res.json(data);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  };

// Obras
app.get   ('/api/obras',     apiHandle(args => obras.listarObras(args as Parameters<typeof obras.listarObras>[0])));
app.get   ('/api/obras/:id', apiHandle(args => obras.buscarObra((args as { id: string }).id)));
app.post  ('/api/obras',     apiHandle(args => obras.criarObra(args as Parameters<typeof obras.criarObra>[0])));
app.put   ('/api/obras/:id', apiHandle(args => obras.atualizarObra(args as Parameters<typeof obras.atualizarObra>[0])));
app.delete('/api/obras/:id', apiHandle(args => obras.apagarObra(args as { id: string; confirm?: boolean })));

// v1.65.40: Parcelas de pagamento do cliente (receita por obra)
app.get   ('/api/obras/:obra_id/parcelas',     apiHandle(args => obras.listarParcelasObra((args as { obra_id: string }).obra_id)));
app.post  ('/api/parcelas',                    apiHandle(args => obras.criarParcela(args as Parameters<typeof obras.criarParcela>[0])));
app.put   ('/api/parcelas/:id',                apiHandle(args => obras.atualizarParcela(args as Parameters<typeof obras.atualizarParcela>[0])));
app.delete('/api/parcelas/:id',                apiHandle(args => obras.apagarParcela(args as { id: string })));
app.post  ('/api/obras/:obra_id/parcelas/auto-gerar', apiHandle(args => obras.gerarParcelasAutomaticas(args as Parameters<typeof obras.gerarParcelasAutomaticas>[0])));
app.get   ('/api/parcelas-vencendo',           apiHandle(args => obras.parcelasVencendo(Number((args as { dias?: number }).dias ?? 7))));

// Etapas
app.get   ('/api/etapas',     apiHandle(args => obras.listarEtapasObra((args as { obra_id: string }).obra_id)));
app.post  ('/api/etapas',     apiHandle(args => obras.criarEtapa(args as Parameters<typeof obras.criarEtapa>[0])));
app.put   ('/api/etapas/:id', apiHandle(args => obras.atualizarEtapa(args as Parameters<typeof obras.atualizarEtapa>[0])));
app.delete('/api/etapas/:id', apiHandle(args => obras.apagarEtapa(args as { id: string; confirm?: boolean })));

// v1.62.0: middleware de admin pra endpoints de mutação sensíveis (financeiro).
// v1.65.38: DESABILITADO temporariamente — sistema em uso pessoal do CEO,
// sem necessidade de auth. Quando virar SaaS multi-tenant, reabilitar
// validacao do header X-CEO-Token contra CEO_API_TOKEN do .env.
// Pra reativar: descomentar o bloco abaixo e remover o "return next()".
function requireCeoToken(_req: Request, _res: Response, next: () => void): void {
  return next();
  // const expected = process.env.CEO_API_TOKEN;
  // if (!expected) {
  //   console.warn('[auth] CEO_API_TOKEN não setado — endpoint admin LIBERADO. Configure no Railway pra proteger.');
  //   return next();
  // }
  // const got = (_req.headers['x-ceo-token'] || _req.headers['X-CEO-Token']) as string | undefined;
  // if (got !== expected) {
  //   _res.status(403).json({ error: 'Forbidden — header X-CEO-Token ausente ou inválido.' });
  //   return;
  // }
  // next();
}

// v1.64.0: tenant settings (white-label estrutural). GET é público, PUT só CEO.
app.get('/api/tenant-settings', async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/tenantSettings');
    res.json(await m.getTenantSettings(1));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
app.put('/api/tenant-settings', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./services/tenantSettings');
    const updated = await m.atualizarTenantSettings(1, req.body ?? {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Transações
app.get ('/api/transacoes', apiHandle(args => obras.listarTransacoesObra(args as Parameters<typeof obras.listarTransacoesObra>[0])));
app.post('/api/transacoes', apiHandle(args => obras.criarTransacaoObra(args as Parameters<typeof obras.criarTransacaoObra>[0])));
app.put   ('/api/transacoes/:id', requireCeoToken, apiHandle(args => obras.atualizarTransacaoObra(args as Parameters<typeof obras.atualizarTransacaoObra>[0])));
app.delete('/api/transacoes/:id', requireCeoToken, apiHandle(args => obras.apagarTransacaoObra(args as { id: string; deleted_by?: string; confirm?: boolean })));

// Equipe
app.get   ('/api/equipe',     apiHandle(args => obras.listarEquipe(args as { obra_id?: string })));
app.post  ('/api/equipe',     apiHandle(args => obras.criarMembroEquipe(args as Parameters<typeof obras.criarMembroEquipe>[0])));
app.put   ('/api/equipe/:id', apiHandle(args => obras.atualizarMembroEquipe(args as Parameters<typeof obras.atualizarMembroEquipe>[0])));
app.delete('/api/equipe/:id', apiHandle(args => obras.apagarMembroEquipe(args as { id: string; confirm?: boolean })));
// v1.65.10: backfill manual de sync Equipe→contacts→zayra_memory.
// Útil para popular tudo após deploy desta migração; depois disso, criar/editar
// membro dispara sync automaticamente via hook em obras.ts.
app.post('/api/equipe/sync-all', requireCeoToken, apiHandle(async () => {
  const m = await import('./services/syncEquipeMembro');
  return m.syncTodaEquipe();
}));

// v1.65.12 — PR B.1: recibo quinzenal (ajustes + PDF + validação por hash)
app.get   ('/api/recibos/ajustes', apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.listarAjustes(args as { membro_id: string; periodo?: string });
}));
app.post  ('/api/recibos/ajustes', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.criarAjuste(args as Parameters<typeof m.criarAjuste>[0]);
}));
app.delete('/api/recibos/ajustes/:id', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.removerAjuste(args as { id: string });
}));

// PDF do recibo quinzenal (preview / download / fonte para o envio em B.2)
app.get('/api/recibos/quinzena/:membro_id/pdf', async (req: Request, res: Response) => {
  try {
    const periodo = String(req.query.periodo || '');
    if (!periodo) {
      res.status(400).json({ error: 'parâmetro ?periodo=YYYY-MM-1 obrigatório' });
      return;
    }
    const m = await import('./services/recibosQuinzena');
    const proto = (req.get('x-forwarded-proto') as string | undefined)?.split(',')[0]?.trim() || 'https';
    const baseUrl = `${proto}://${req.get('host')}`.replace(/\/$/, '');
    const r = await m.gerarReciboQuinzenalPdf({
      membro_id: String(req.params.membro_id),
      periodo,
      baseUrl,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `inline; filename="Recibo_${r.data.membro.nome.replace(/[^a-zA-Z0-9]/g, '_')}_${periodo}.pdf"`);
    res.send(r.buffer);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// v1.65.13 — PR B.2: lote + disparo via Z-API.
// POST /api/recibos/preview-lote → preview (não cria nada). Body: { periodo? }
// POST /api/recibos/disparar     → cria lote + dispara. Body: { periodo?, confirm:true, force? }
// POST /api/recibos/disparar     → sem confirm:true também devolve preview (idêntico ao preview-lote)
// GET  /api/recibos/lote/:id     → status consolidado
app.post('/api/recibos/preview-lote', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.previewLoteQuinzena(args as { periodo?: string });
}));
app.post('/api/recibos/disparar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosQuinzena');
    const proto = (req.get('x-forwarded-proto') as string | undefined)?.split(',')[0]?.trim() || 'https';
    const baseUrl = `${proto}://${req.get('host')}`.replace(/\/$/, '');
    const out = await m.dispararRecibosQuinzena({
      periodo: req.body?.periodo,
      confirm: !!req.body?.confirm,
      force:   !!req.body?.force,
      criado_por: req.body?.criado_por,
      baseUrl,
    });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
app.get('/api/recibos/lote/:id', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.statusLote({ lote_id: (args as { id: string }).id });
}));
app.get('/api/recibos/lote-do-periodo/:periodo', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.statusLote({ periodo: (args as { periodo: string }).periodo });
}));

// v1.65.16 — PR B.4: comandos de gerenciamento (marcar pago / reenviar / expirar)
app.post('/api/recibos/marcar-pago', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.marcarReciboPago(args as Parameters<typeof m.marcarReciboPago>[0]);
}));
app.post('/api/recibos/reenviar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosQuinzena');
    const proto = (req.get('x-forwarded-proto') as string | undefined)?.split(',')[0]?.trim() || 'https';
    const baseUrl = `${proto}://${req.get('host')}`.replace(/\/$/, '');
    res.json(await m.reenviarRecibos({ ...req.body, baseUrl }));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
app.post('/api/recibos/expirar', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.expirarRecibosAntigos(args as Parameters<typeof m.expirarRecibosAntigos>[0]);
}));

// v1.65.20: controle manual individual no modal Recibo (aba Marcar Dias)
// GET status do envio mais recente do colaborador no período
app.get('/api/recibos/envio-status', apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.buscarStatusEnvioColaborador(args as { membro_id: string; periodo: string });
}));
// POST disparar individual (mini-lote de 1)
app.post('/api/recibos/disparar-individual', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosQuinzena');
    const proto = (req.get('x-forwarded-proto') as string | undefined)?.split(',')[0]?.trim() || 'https';
    const baseUrl = `${proto}://${req.get('host')}`.replace(/\/$/, '');
    const out = await m.dispararEnvioIndividual({ ...req.body, baseUrl });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
// POST avançar status manualmente
app.post('/api/recibos/envio/:envio_id/status-manual', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.alterarStatusManual(args as Parameters<typeof m.alterarStatusManual>[0]);
}));

// v1.65.32: registra pagamento offline (sem enviar WhatsApp).
// Caso de uso: pagamento foi em maos / banco — CEO so registra no sistema.
app.post('/api/recibos/marcar-pago-offline', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.marcarPagoOffline(args as Parameters<typeof m.marcarPagoOffline>[0]);
}));

// v1.65.35: apagar envio (limpa lote tambem se ficar vazio).
app.post('/api/recibos/envio/:envio_id/apagar', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.apagarEnvio(args as Parameters<typeof m.apagarEnvio>[0]);
}));

// v1.65.36: diagnostico — lista TODOS os envios de 1 membro em todos os
// periodos. Util pra investigar "PAGO sumiu" / "estado errado".
app.get('/api/recibos/historico-membro/:membro_id', requireCeoToken, apiHandle(async (args) => {
  const m = await import('./services/recibosQuinzena');
  return m.historicoEnviosMembro(String((args as { membro_id: string }).membro_id));
}));

// v1.65.19 — Confirmação web por token (link clicável → vira botão no WhatsApp)
app.get('/recibos/confirmar/:token', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosQuinzena');
    const html = await m.gerarHtmlConfirmacaoWeb(String(req.params.token));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre>Erro: ${(err as Error).message}</pre>`);
  }
});
app.post('/recibos/confirmar/:token/:acao(confirma|contesta|recebido|pix)', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosQuinzena');
    const acao = String(req.params.acao) as 'confirma' | 'contesta' | 'recebido' | 'pix';
    const ip = (req.get('x-forwarded-for') as string | undefined)?.split(',')[0]?.trim() || req.ip || '?';
    const ua = (req.get('user-agent') as string | undefined) || '';
    const r = await m.confirmarRecibosViaWeb({
      token: String(req.params.token),
      acao,
      chave_pix: req.body?.chave_pix,
      tipo_chave_pix: req.body?.tipo_chave_pix,
      ip, userAgent: ua,
    });
    // Re-renderiza a página com mensagem flash + estado novo
    const html = await m.gerarHtmlConfirmacaoWeb(String(req.params.token), {
      tipo: r.ok ? 'ok' : 'erro', texto: r.mensagem,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre>Erro: ${(err as Error).message}</pre>`);
  }
});

// Página pública acessada via QR-code (validação)
app.get('/recibos/validar/:hash', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosQuinzena');
    const html = await m.gerarHtmlValidacao(String(req.params.hash));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre>Erro: ${(err as Error).message}</pre>`);
  }
});

// Materiais
app.get   ('/api/materiais',          apiHandle(args => obras.listarMateriais(args as { apenas_baixos?: boolean; obra_id?: string })));
app.post  ('/api/materiais',          apiHandle(args => obras.criarMaterial(args as Parameters<typeof obras.criarMaterial>[0])));
app.post  ('/api/materiais/ajustar',  apiHandle(args => obras.ajustarEstoqueMaterial(args as { id: string; delta: number; confirm?: boolean })));
app.put   ('/api/materiais/:id',      apiHandle(args => obras.atualizarMaterial(args as Parameters<typeof obras.atualizarMaterial>[0])));
app.delete('/api/materiais/:id',      apiHandle(args => obras.apagarMaterial(args as { id: string; confirm?: boolean })));

// Diário
app.get ('/api/diario', apiHandle(args => obras.listarDiarioObra(args as Parameters<typeof obras.listarDiarioObra>[0])));
app.post('/api/diario', apiHandle(args => obras.registrarDiarioObra(args as Parameters<typeof obras.registrarDiarioObra>[0])));

// Catálogo de profissões
app.get('/api/profissoes-catalogo', apiHandle(() => obras.listarProfissoesCatalogo()));
app.put('/api/profissoes-catalogo/:id', apiHandle(args => obras.atualizarProfissaoCatalogo(args as Parameters<typeof obras.atualizarProfissaoCatalogo>[0])));

// v1.65.2: Propostas de Mão de Obra (catálogo SINAPI + clientes + propostas + itens)
app.get   ('/api/sinapi-servicos',       apiHandle(args => propostas.listarCatalogoSinapi(args as Parameters<typeof propostas.listarCatalogoSinapi>[0])));
app.get   ('/api/sinapi-categorias',     apiHandle(() => propostas.listarCategoriasSinapi()));

app.get   ('/api/propostas-clientes',    apiHandle(args => propostas.listarClientesProposta(args as Parameters<typeof propostas.listarClientesProposta>[0])));
app.post  ('/api/propostas-clientes',    apiHandle(args => propostas.criarClienteProposta(args as Parameters<typeof propostas.criarClienteProposta>[0])));
app.put   ('/api/propostas-clientes/:id', requireCeoToken, apiHandle(args => propostas.atualizarClienteProposta(args as Parameters<typeof propostas.atualizarClienteProposta>[0])));
app.delete('/api/propostas-clientes/:id', requireCeoToken, apiHandle(args => propostas.apagarClienteProposta(args as { id: string })));

app.get   ('/api/propostas',             apiHandle(args => propostas.listarPropostas(args as Parameters<typeof propostas.listarPropostas>[0])));
app.get   ('/api/propostas/:id',         apiHandle(args => propostas.buscarProposta((args as { id: string }).id)));
app.post  ('/api/propostas',             apiHandle(args => propostas.criarProposta(args as Parameters<typeof propostas.criarProposta>[0])));
app.put   ('/api/propostas/:id',         apiHandle(args => propostas.atualizarProposta(args as Parameters<typeof propostas.atualizarProposta>[0])));
app.delete('/api/propostas/:id',         requireCeoToken, apiHandle(args => propostas.apagarProposta(args as { id: string })));

app.post  ('/api/propostas/:proposta_id/itens',         apiHandle(args => propostas.adicionarItemProposta(args as Parameters<typeof propostas.adicionarItemProposta>[0])));
app.put   ('/api/proposta-itens/:id',                   apiHandle(args => propostas.atualizarItemProposta(args as Parameters<typeof propostas.atualizarItemProposta>[0])));
app.delete('/api/proposta-itens/:id',                   apiHandle(args => propostas.removerItemProposta(args as { id: string })));
app.post  ('/api/propostas/:proposta_id/itens/reordenar', apiHandle(args => propostas.reordenarItensProposta(args as Parameters<typeof propostas.reordenarItensProposta>[0])));

// v1.65.4: Relatório HTML / PDF / envio Z-API
app.get('/api/propostas/:id/relatorio', async (req: Request, res: Response) => {
  try {
    const html = await propostas.gerarHtmlPropostaRelatorio(String(req.params.id));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(404).send(`<pre>Erro: ${(err as Error).message}</pre>`);
  }
});
app.get('/api/propostas/:id/pdf', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const buf = await propostas.gerarPdfProposta(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Proposta_${id}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});
app.post('/api/propostas/:id/enviar-whatsapp', apiHandle(args => propostas.enviarPropostaWhatsApp(args as Parameters<typeof propostas.enviarPropostaWhatsApp>[0])));
// v1.66.19: envio Telegram + anexos pra Mao de Obra (paridade com Consultoria)
app.post('/api/propostas/:id/enviar-telegram',
  apiHandle(args => propostas.enviarPropostaTelegram(args as Parameters<typeof propostas.enviarPropostaTelegram>[0])));
app.get   ('/api/propostas/:id/anexos',
  apiHandle(args => propostasConsultoria.listarAnexosProposta({ proposta_id: (args as { id: string }).id })));
app.post  ('/api/propostas/:id/anexos',
  apiHandle(args => propostasConsultoria.criarAnexoProposta({
    proposta_id: (args as { id: string }).id,
    filename: (args as { filename: string }).filename,
    mimetype: (args as { mimetype: string }).mimetype,
    conteudo_b64: (args as { conteudo_b64: string }).conteudo_b64,
  })));
app.delete('/api/propostas/anexos/:id',
  apiHandle(args => propostasConsultoria.removerAnexoProposta(args as { id: string })));

// v1.67.8: Vencimentos triagem — rotas REST pra UI (ja tinha tools ZAYRA + detector proativo)
import * as docsVenc from './services/documentosVencimento';
app.get   ('/api/documentos-vencimento',
  apiHandle(args => docsVenc.listarDocumentos(args as Parameters<typeof docsVenc.listarDocumentos>[0])));
app.post  ('/api/documentos-vencimento',
  apiHandle(args => docsVenc.cadastrarDocumento(args as Parameters<typeof docsVenc.cadastrarDocumento>[0])));
app.post  ('/api/documentos-vencimento/:id/renovado',
  apiHandle(args => docsVenc.marcarRenovado(args as Parameters<typeof docsVenc.marcarRenovado>[0])));
app.delete('/api/documentos-vencimento/:id',
  apiHandle(args => docsVenc.apagarDocumento(Number((args as { id: string }).id))));
app.get   ('/api/documentos-vencimento/tipos',
  apiHandle(async () => docsVenc.listarTiposDocumento()));

// v1.67.7: OCR de cupom fiscal — foto/PDF do cupom -> extrai loja/itens/total
import { extrairDadosCupom } from './services/cupomOcr';
app.post('/api/despesas-extras/ocr-cupom', async (req: Request, res: Response) => {
  try {
    const imgB64 = String(req.body?.imagem_b64 ?? '').trim();
    const mimetype = String(req.body?.mimetype ?? 'image/jpeg').toLowerCase();
    if (!imgB64) return res.status(400).json({ error: 'imagem_b64 obrigatorio' });
    const tamanhoMB = (imgB64.length * 3 / 4) / 1024 / 1024;
    if (tamanhoMB > 10) return res.status(413).json({ error: `Imagem ${tamanhoMB.toFixed(1)}MB, max 10MB.` });
    const r = await extrairDadosCupom({ imagem_b64: imgB64, mimetype });
    res.json(r);
  } catch (err) {
    console.error('[ocr-cupom] erro:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

// v1.67.0: Despesas Extras — gastos avulsos por obra (ferramenta, aluguel,
// material avulso). Soma no Consumo da obra junto com obras_transacoes.
app.get   ('/api/despesas-extras',
  apiHandle(args => despesasExtras.listarDespesasExtras(args as Parameters<typeof despesasExtras.listarDespesasExtras>[0])));
app.get   ('/api/despesas-extras/resumo',
  apiHandle(args => despesasExtras.resumoDespesasExtras(args as Parameters<typeof despesasExtras.resumoDespesasExtras>[0])));
app.get   ('/api/despesas-extras/:id',
  apiHandle(args => despesasExtras.buscarDespesaExtra((args as { id: string }).id)));
app.post  ('/api/despesas-extras',
  apiHandle(args => despesasExtras.criarDespesaExtra(args as Parameters<typeof despesasExtras.criarDespesaExtra>[0])));
app.put   ('/api/despesas-extras/:id',
  apiHandle(args => despesasExtras.atualizarDespesaExtra(args as Parameters<typeof despesasExtras.atualizarDespesaExtra>[0])));
app.delete('/api/despesas-extras/:id', requireCeoToken,
  apiHandle(args => despesasExtras.apagarDespesaExtra(args as { id: string })));
// v1.67.10: PDF individual + relatorio consolidado + envios WhatsApp/Telegram
app.get('/api/despesas-extras/:id/pdf', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const buf = await despesasExtras.gerarPdfDespesaExtra(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Despesa_${id}.pdf"`);
    res.send(buf);
  } catch (err) { res.status(404).json({ error: (err as Error).message }); }
});
app.post('/api/despesas-extras/relatorio-pdf', async (req: Request, res: Response) => {
  try {
    const ids = (req.body?.ids || []) as string[];
    const obra_nome = String(req.body?.obra_nome || '').trim() || undefined;
    if (!ids.length) return res.status(400).json({ error: 'ids obrigatorio (array)' });
    const buf = await despesasExtras.gerarPdfRelatorioDespesas(ids, { obra_nome });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Relatorio_Despesas_${ids.length}_notas.pdf"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
// v1.67.13: rotas literais /relatorio/... ANTES das paramétricas /:id/...
// (caso contrario o Express casa "relatorio" como :id e quebra com "id invalido")
app.post('/api/despesas-extras/relatorio/enviar-whatsapp',
  apiHandle(args => despesasExtras.enviarRelatorioDespesasWhatsApp(args as Parameters<typeof despesasExtras.enviarRelatorioDespesasWhatsApp>[0])));
app.post('/api/despesas-extras/relatorio/enviar-telegram',
  apiHandle(args => despesasExtras.enviarRelatorioDespesasTelegram(args as Parameters<typeof despesasExtras.enviarRelatorioDespesasTelegram>[0])));
app.post('/api/despesas-extras/:id/enviar-whatsapp',
  apiHandle(args => despesasExtras.enviarDespesaWhatsApp(args as Parameters<typeof despesasExtras.enviarDespesaWhatsApp>[0])));
app.post('/api/despesas-extras/:id/enviar-telegram',
  apiHandle(args => despesasExtras.enviarDespesaTelegram(args as Parameters<typeof despesasExtras.enviarDespesaTelegram>[0])));

// v1.66.0: Proposta de Consultoria (averbacao + outros 5 subtipos na Fase 3).
// Numeracao PROP-AAAA-XXXX compartilhada com Mao de Obra.
app.get   ('/api/propostas-consultoria',
  apiHandle(args => propostasConsultoria.listarPropostasPorTipo({
    ...(args as object), tipo: 'consultoria',
  } as Parameters<typeof propostasConsultoria.listarPropostasPorTipo>[0])));
app.get   ('/api/propostas-consultoria/:id',
  apiHandle(args => propostasConsultoria.buscarPropostaConsultoria((args as { id: string }).id)));
app.post  ('/api/propostas-consultoria',
  apiHandle(args => propostasConsultoria.criarPropostaConsultoria(args as Parameters<typeof propostasConsultoria.criarPropostaConsultoria>[0])));
app.put   ('/api/propostas-consultoria/:id',
  apiHandle(args => propostasConsultoria.atualizarPropostaConsultoria(args as Parameters<typeof propostasConsultoria.atualizarPropostaConsultoria>[0])));
app.post  ('/api/propostas-consultoria/preview',
  apiHandle(args => propostasConsultoria.previewCustoConsultoria(args as Parameters<typeof propostasConsultoria.previewCustoConsultoria>[0])));
app.get   ('/api/propostas-consultoria/:id/pdf', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // v1.66.9: por padrao serve PDF completo (com anexos mergeados).
    // Use ?somente_principal=1 pra pegar so a proposta sem anexos.
    const somentePrincipal = req.query.somente_principal === '1';
    const buf = somentePrincipal
      ? await propostasConsultoria.gerarPdfPropostaConsultoria(id)
      : await propostasConsultoria.gerarPdfPropostaConsultoriaCompleto(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Proposta_Consultoria_${id}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// v1.66.9: anexos da proposta (Planta Arquitetonica/Mapa — PDF/PNG/JPEG)
app.get   ('/api/propostas-consultoria/:id/anexos',
  apiHandle(args => propostasConsultoria.listarAnexosProposta({ proposta_id: (args as { id: string }).id })));
app.post  ('/api/propostas-consultoria/:id/anexos',
  apiHandle(args => propostasConsultoria.criarAnexoProposta({
    proposta_id: (args as { id: string }).id,
    filename: (args as { filename: string }).filename,
    mimetype: (args as { mimetype: string }).mimetype,
    conteudo_b64: (args as { conteudo_b64: string }).conteudo_b64,
  })));
app.delete('/api/propostas-consultoria/anexos/:id',
  apiHandle(args => propostasConsultoria.removerAnexoProposta(args as { id: string })));
app.post  ('/api/propostas-consultoria/:id/enviar-whatsapp',
  apiHandle(args => propostasConsultoria.enviarPropostaConsultoriaWhatsApp(args as Parameters<typeof propostasConsultoria.enviarPropostaConsultoriaWhatsApp>[0])));
app.post  ('/api/propostas-consultoria/:id/enviar-telegram',
  apiHandle(args => propostasConsultoria.enviarPropostaConsultoriaTelegram(args as Parameters<typeof propostasConsultoria.enviarPropostaConsultoriaTelegram>[0])));

// Cowork (tarefas em background)
app.get   ('/api/cowork',       apiHandle(args => cowork.listarTarefasCowork(args as Parameters<typeof cowork.listarTarefasCowork>[0])));
app.get   ('/api/cowork/:id',   apiHandle(args => cowork.buscarTarefaCowork((args as { id: string }).id)));
app.post  ('/api/cowork',       apiHandle(args => cowork.criarTarefaCowork(args as Parameters<typeof cowork.criarTarefaCowork>[0])));
app.delete('/api/cowork/:id',   apiHandle(args => cowork.cancelarTarefaCowork(args as { id: string; confirm?: boolean })));

// Vistorias VTO
app.get   ('/api/vistorias',     apiHandle(args => vistorias.listarVistorias(args as Parameters<typeof vistorias.listarVistorias>[0])));
app.get   ('/api/vistorias/:id', apiHandle(args => vistorias.buscarVistoria((args as { id: string }).id)));
app.post  ('/api/vistorias',     apiHandle(args => vistorias.criarVistoria(args as Parameters<typeof vistorias.criarVistoria>[0])));
app.put   ('/api/vistorias/:id', apiHandle(args => vistorias.atualizarVistoria(args as Parameters<typeof vistorias.atualizarVistoria>[0])));
app.delete('/api/vistorias/:id', apiHandle(args => vistorias.apagarVistoria(args as { id: string; confirm?: boolean })));
app.post  ('/api/vistorias/:vistoria_id/fotos', apiHandle(args => vistorias.adicionarFotoVistoria(args as Parameters<typeof vistorias.adicionarFotoVistoria>[0])));
app.delete('/api/vistorias/fotos/:foto_id',     apiHandle(args => vistorias.apagarFotoVistoria(args as { foto_id: string; confirm?: boolean })));
app.get   ('/api/vistorias/:id/fotos/:foto_id/raw', async (req, res) => {
  try {
    const r = await vistorias.fotoRaw(req.params.foto_id);
    if (!r) return res.status(404).end();
    res.set('Content-Type', r.mime);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(r.buffer);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.get('/api/vistorias/:id/relatorio', async (req, res) => {
  try {
    const html = await vistorias.gerarHtmlRelatorio(req.params.id);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(html);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.67.1: PDF + envio WhatsApp/Telegram da vistoria (paridade Proposta)
app.get('/api/vistorias/:id/pdf', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const buf = await vistorias.gerarPdfVistoria(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Vistoria_${id}.pdf"`);
    res.send(buf);
  } catch (err) { res.status(404).json({ error: (err as Error).message }); }
});
app.post('/api/vistorias/:id/enviar-whatsapp',
  apiHandle(args => vistorias.enviarVistoriaWhatsApp(args as Parameters<typeof vistorias.enviarVistoriaWhatsApp>[0])));
app.post('/api/vistorias/:id/enviar-telegram',
  apiHandle(args => vistorias.enviarVistoriaTelegram(args as Parameters<typeof vistorias.enviarVistoriaTelegram>[0])));

// Cofre Obsidian
app.post('/api/cofre/sincronizar', apiHandle(() => cofre.sincronizarCofreMemoria()));
app.get ('/api/cofre/exportar',    apiHandle(() => cofre.exportarVaultZip()));
app.get ('/api/cofre/baixar', async (_req: Request, res: Response) => {
  try {
    const r = await cofre.exportarVaultZip();
    res.download(r.path, `zayra_memoria_${new Date().toISOString().slice(0,10)}.md`);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Alarmes
app.get   ('/api/alarmes',     apiHandle(args => alarmes.listarAlarmes(args as Parameters<typeof alarmes.listarAlarmes>[0])));
app.post  ('/api/alarmes',     apiHandle(args => alarmes.criarAlarme(args as Parameters<typeof alarmes.criarAlarme>[0])));
app.put   ('/api/alarmes/:id', apiHandle(args => alarmes.atualizarAlarme(args as Parameters<typeof alarmes.atualizarAlarme>[0])));
app.delete('/api/alarmes/:id', apiHandle(args => alarmes.cancelarAlarme(args as { id: string; confirm?: boolean })));

// Resumo
app.get('/api/resumo-obras', apiHandle(() => obras.resumoObras()));

// Dias trabalhados
app.get   ('/api/funcionarios/:funcionario_id/dias',
  apiHandle(args => obras.listarDiasFuncionario(args as Parameters<typeof obras.listarDiasFuncionario>[0])));
app.post  ('/api/funcionarios/:funcionario_id/dias',
  apiHandle(args => obras.marcarDiaTrabalhado(args as Parameters<typeof obras.marcarDiaTrabalhado>[0])));
app.delete('/api/funcionarios/:funcionario_id/dias',
  apiHandle(args => obras.desmarcarDiaTrabalhado(args as Parameters<typeof obras.desmarcarDiaTrabalhado>[0])));
app.get   ('/api/funcionarios/:funcionario_id/relatorio',
  apiHandle(args => obras.relatorioMensalFuncionario(args as Parameters<typeof obras.relatorioMensalFuncionario>[0])));
app.get   ('/api/relatorio-equipe',
  apiHandle(args => obras.relatorioMensalEquipe(args as Parameters<typeof obras.relatorioMensalEquipe>[0])));

// v1.65.60: Webhook do AvalieImob — recebe leads (cadastros + assinaturas)
// pra ZAYRA monitorar. Disparo em paralelo: WhatsApp CEO + Telegram CEO +
// auto-resposta WhatsApp pro lead. Header X-Webhook-Secret obrigatorio.
import { processarLeadWebhook, consultarLeads } from './integrations/avalieImobLeads';

app.post('/api/avalieimob/lead-webhook', async (req: Request, res: Response) => {
  try {
    const secret = req.headers['x-webhook-secret'] || req.headers['X-Webhook-Secret'];
    const expected = process.env.AVALIEIMOB_WEBHOOK_SECRET;
    if (!expected) {
      return res.status(500).json({ error: 'AVALIEIMOB_WEBHOOK_SECRET nao configurada na ZAYRA' });
    }
    if (secret !== expected) {
      return res.status(401).json({ error: 'invalid secret' });
    }
    const result = await processarLeadWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error('[avalieimob-webhook] erro:', (err as Error).message);
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/avalieimob/leads', async (req: Request, res: Response) => {
  try {
    const dias  = req.query.dias  ? parseInt(String(req.query.dias),  10) : 7;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const event_type = req.query.event_type as 'cadastro' | 'assinatura' | 'login' | 'outro' | undefined;
    const data = await consultarLeads({ dias, limit, event_type });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Pergunta pra ZAYRA via contexto de obras
app.post('/api/obras/zayra', async (req: Request, res: Response) => {
  try {
    const pergunta = String(req.body?.pergunta ?? '').trim();
    const obraId   = req.body?.obra_id as string | undefined;
    if (!pergunta) return res.status(400).json({ error: 'pergunta obrigatória' });
    const ctx = obraId ? `\n\n[Contexto: foco na obra de ID ${obraId}]` : '';
    const r = await think(pergunta + ctx, { channel: 'text' });
    res.json({ resposta: r.text, tools: r.toolsUsed, sessionId: r.sessionId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// v1.66.23: ZAYRA Visual Live — frame contínuo a cada 5s via Gemini Free Tier.
import { analisarFrameLive, statusFreeTier } from './services/zayraVisualLive';
app.post('/api/zayra/visual-live', async (req: Request, res: Response) => {
  try {
    const imgB64   = String(req.body?.imagem_b64 ?? '').trim();
    const mimetype = String(req.body?.mimetype ?? 'image/jpeg').toLowerCase();
    const pergunta = String(req.body?.pergunta ?? '').trim() || undefined;
    if (!imgB64) return res.status(400).json({ error: 'imagem_b64 obrigatorio' });
    const r = await analisarFrameLive({ imagem_b64: imgB64, mimetype, pergunta });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
app.get('/api/zayra/visual-live/status', async (_req: Request, res: Response) => {
  try { res.json(statusFreeTier()); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.66.22: ZAYRA Visual — analisa imagem capturada via camera ou tela.
// Recebe { imagem_b64, mimetype, pergunta? } e devolve a analise da ZAYRA.
app.post('/api/zayra/visual', async (req: Request, res: Response) => {
  try {
    const imgB64    = String(req.body?.imagem_b64 ?? '').trim();
    const mimetype  = String(req.body?.mimetype ?? 'image/jpeg').toLowerCase();
    const perguntaUsuario = String(req.body?.pergunta ?? '').trim();
    if (!imgB64) return res.status(400).json({ error: 'imagem_b64 obrigatorio' });
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(mimetype)) {
      return res.status(400).json({ error: `mimetype ${mimetype} nao suportado. Aceito: jpeg/png/webp/gif.` });
    }
    const tamanhoMB = (imgB64.length * 3 / 4) / 1024 / 1024;
    if (tamanhoMB > 10) {
      return res.status(413).json({ error: `Imagem tem ${tamanhoMB.toFixed(1)}MB, maximo 10MB.` });
    }
    const pergunta = perguntaUsuario || 'Analise a imagem e descreva o que voce ve em detalhes (avaliacao tecnica se for imovel — fachada, padrao construtivo, conservacao, area aproximada).';
    const r = await think(pergunta, {
      channel: 'text',
      attachments: [{ kind: 'image', mime: mimetype, base64: imgB64 }],
    });
    res.json({ resposta: r.text, sessionId: r.sessionId });
  } catch (err) {
    console.error('[zayra-visual] erro:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
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
  void import('./agent/briefingSemanal').then(m => m.startWeeklyBriefingScheduler()).catch(() => {});
  alarmes.startAlarmesTicker();
  cowork.startCoworkWorker();
  // v1.61.1: cleanup de drafts roda APÓS migrations criarem a tabela.
  // Antes (v1.61.0), startDraftCleanup era chamado direto e a 1ª execução
  // falhava com ER_NO_SUCH_TABLE pq runMigrations ainda nem tinha rodado.
  void initDb()
    .then(() => loadSessionFromDb())
    .then(() => import('./services/whatsappDrafts'))
    .then(m => m.startDraftCleanup())
    .then(() => import('./services/recibosQuinzena'))
    .then(m => m.startExpiracaoRecibosTicker()) // v1.65.16: expira recibos sem resposta há mais de 48h (ticker a cada 6h)
    .catch(err => console.warn('[Memory] Init failed (continuing without DB):', err));

  // v1.39.1: sync contatos CRM → memória ZAYRA (1x ao boot + 1x/dia 04:00 BRT)
  void import('./services/syncContatosCRM').then(({ sincronizarContatosCRM }) => {
    // Boot: aguarda 60s (DB conectar) e roda
    setTimeout(() => {
      void sincronizarContatosCRM().catch(err =>
        console.warn('[syncContatos boot]', (err as Error).message),
      );
    }, 60_000);
    // Daily: roda às 04h BRT (07h UTC)
    setInterval(() => {
      const now = new Date();
      const brtHour = (now.getUTCHours() + 21) % 24;  // BRT = UTC-3
      const brtMin  = now.getUTCMinutes();
      if (brtHour === 4 && brtMin === 0) {
        void sincronizarContatosCRM().catch(err =>
          console.warn('[syncContatos daily]', (err as Error).message),
        );
      }
    }, 60_000);
  }).catch(() => {});
});

export default app;
