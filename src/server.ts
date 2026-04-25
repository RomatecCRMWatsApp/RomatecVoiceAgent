import 'dotenv/config';
import path from 'path';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { transcribeAudio } from './agent/transcribe';
import { think } from './agent/think';
import { speak } from './agent/speak';
import { AGENT_IDENTITY } from './agent/identity';
import * as crm from './integrations/crm';
import * as avalieimob from './integrations/avalieimob';
import { processMessage, sendReply, WaMessage } from './integrations/whatsapp';
import { getAuthUrl, exchangeCode } from './integrations/calendar';
import { addSSEClient, removeSSEClient, startProactiveNotifications } from './agent/proactive';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((_req, res, next) => {
  res.set('X-Agent', `${AGENT_IDENTITY.name}/${AGENT_IDENTITY.version}`);
  next();
});

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ agent: AGENT_IDENTITY.name, version: AGENT_IDENTITY.version, status: 'online', timestamp: new Date().toISOString() });
});

app.post('/voice', upload.single('audio'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Nenhum arquivo de áudio enviado.' });
    return;
  }

  const transcription = await transcribeAudio(req.file.buffer, req.file.mimetype);
  const agentResponse = await think(transcription.text);
  const audioBuffer = await speak(agentResponse.text);

  res.set({
    'Content-Type': 'audio/mpeg',
    'X-Transcription': encodeURIComponent(transcription.text),
    'X-Response-Text': encodeURIComponent(agentResponse.text),
    'X-Tools-Used': agentResponse.toolsUsed.join(','),
  });
  res.send(audioBuffer);
});

app.post('/text', async (req: Request, res: Response) => {
  const { message, voice = false } = req.body as { message: string; voice?: boolean };

  if (!message) {
    res.status(400).json({ error: 'Campo "message" obrigatório.' });
    return;
  }

  const agentResponse = await think(message);

  if (voice) {
    const audioBuffer = await speak(agentResponse.text);
    res.set({ 'Content-Type': 'audio/mpeg', 'X-Response-Text': encodeURIComponent(agentResponse.text) });
    res.send(audioBuffer);
    return;
  }

  res.json({ agent: AGENT_IDENTITY.name, response: agentResponse.text, tools_used: agentResponse.toolsUsed });
});

app.get('/briefing', async (_req: Request, res: Response) => {
  const [leads, contratos, campanhas, servicos] = await Promise.allSettled([
    crm.listarLeads({ limite: 100 }),
    avalieimob.listarContratos({ status: 'pendente' }),
    crm.listarCampanhas(),
    avalieimob.statusServicos(),
  ]);

  const briefingText = await think('Me dê um resumo executivo completo do dia, incluindo leads, contratos e campanhas.');

  res.json({
    agent: AGENT_IDENTITY.name,
    briefing: briefingText.text,
    data: {
      leads: leads.status === 'fulfilled' ? leads.value : [],
      contratos_pendentes: contratos.status === 'fulfilled' ? contratos.value : [],
      campanhas: campanhas.status === 'fulfilled' ? campanhas.value : [],
      servicos: servicos.status === 'fulfilled' ? servicos.value : { online: false },
    },
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

// ── WhatsApp webhook ──────────────────────────────────────────────────────────
app.post('/webhook/whatsapp', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
  const msgs = (req.body?.messages ?? []) as WaMessage[];
  void (async () => {
    for (const msg of msgs) {
      try {
        const reply = await processMessage(msg);
        await sendReply(msg.from, reply);
      } catch (err) {
        console.error('[WhatsApp webhook]', err);
      }
    }
  })();
});

app.post('/zayra/whatsapp', async (req: Request, res: Response) => {
  const { message, from } = req.body as { message: string; from?: string };
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  const agentResponse = await think(message);
  if (from) void sendReply(from, agentResponse.text).catch(console.error);
  res.json({ response: agentResponse.text, tools_used: agentResponse.toolsUsed });
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

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`${AGENT_IDENTITY.name} v${AGENT_IDENTITY.version} rodando na porta ${PORT}`);
  startProactiveNotifications();
});

export default app;
