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

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`${AGENT_IDENTITY.name} v${AGENT_IDENTITY.version} rodando na porta ${PORT}`);
});

export default app;
