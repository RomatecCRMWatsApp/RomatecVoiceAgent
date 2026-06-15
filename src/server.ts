import 'dotenv/config';
import './util/logBR';            // side-effect: patches console.* with [HH:MM BRT] prefix
import fs from 'fs';
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
import * as recibos from './integrations/recibos';
import * as notasFiscais from './integrations/notasFiscais';
import { gerarPdfRecibo, getBaseUrl } from './services/reciboPdf';
import { getTenantSettings } from './services/tenantSettings';
import {
  getFiscalConfig as getTenantFiscalConfig,
  upsertFiscalConfig as upsertTenantFiscalConfig,
} from './services/tenantFiscalConfig';
// v1.99.3: assinatura digital ICP-Brasil
import {
  uploadCert as uploadSigningCert,
  listCerts as listSigningCerts,
  deleteCert as deleteSigningCert,
  setCertAtivo as setSigningCertAtivo,
} from './services/signingCertificates';
import {
  assinarRecibo as assinarReciboPades,
  getReciboPdfAssinado,
  getStatusAssinatura,
} from './integrations/recibosAssinatura';
import ragRoutes from './routes/rag';
import pool from './database/connection';
import { runMigrationsExplicativo } from './database/migrations-explicativo';
import { relatorioDemarcacaoRouter } from './routes/relatorioDemarcacao';
import contractsRoutes from './routes/contracts';
import painelRoutes from './routes/painel';
import gnssRouter from './routes/gnss';
import cartoriosRouter from './routes/cartorios';
import explicativoRouter from './routes/explicativo';
import memoriaisHidraulicoRouter from './routes/memoriais'; // v3.49.2 Memorial Hidraulico
import canvasGraficoRouter from './routes/canvasGrafico';
import relatorioFotograficoRouter from './routes/relatorioFotografico';
import galeriaExportRouter from './routes/galeriaExport'; // Feature 04 — export Galeria p/ AvalieImob (X-API-Key)
import pdfPrimeRouter from './routes/pdfPrime'; // v1.99.16 — export PDF templates Prime I/II
import diligenciasRouter from './routes/diligencias'; // v3.54.0 — Diligências de Campo
import wifiLeadRoutes from './routes/wifiLeadRoutes'; // v3.61.0 — Captive Portal / Leads Wi-Fi

const app = express();
// Railway está atrás de proxy reverso — habilita pra que req.protocol respeite x-forwarded-proto
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
// v3.17.0: upload de arquivos vetoriais (DXF/DWG até 50MB, KML até 20MB — validado no service)
const vectorUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 10 } });
// Multer separado pra anexos multimodais (imagens/PDFs) — Claude aceita até 32MB/PDF e ~5MB/imagem
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024, files: 5 } });

// v1.99.18: limit 64mb (antes 32mb). VTO no iPhone com 10 fotos HEIC chegava
// a ~67mb em base64 e quebrava com 413 → JSON.parse de HTML no Safari iOS
// virava SyntaxError "string did not match the expected pattern".
app.use(express.json({ limit: '64mb' }));
// v1.65.19: forms HTML do /recibos/confirmar/:token (POST application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: false, limit: '128kb' }));
// v3.24.0: cookie-parser pra requireAuth ler o cookie httpOnly do JWT.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser') as () => (req: Request, res: Response, next: (e?: unknown) => void) => void;
app.use(cookieParser());

// v3.24.0: PR A Auth Foundation — fail-fast no boot se JWT_SECRET nao
// estiver setada ou for curta demais. Antes era so um placeholder mock
// em test-setup.ts; agora exige real em prod.
import { bootValidateAuthEnv } from './services/auth';
bootValidateAuthEnv();

// v3.24.0: rotas /api/auth/* (login, logout, me).
import authRoutes from './routes/auth';
app.use('/api/auth', authRoutes);

// v3.24.1: rotas /api/minha-quinzena/* — colaborador self-service.
import minhaQuinzenaRoutes from './routes/minhaQuinzena';
app.use('/api/minha-quinzena', minhaQuinzenaRoutes);

// v3.24.2: rotas /api/admin/* — gestao de acessos (PR C).
import adminAcessosRoutes from './routes/adminAcessos';
app.use('/api/admin', adminAcessosRoutes);

// v3.25.0: rotas /api/admin/* — gestao de usuarios + permissoes (Configuracoes)
import adminUsersRoutes from './routes/adminUsers';
app.use('/api/admin', adminUsersRoutes);

// v3.24.0: tela /login (HTML mobile-first dark theme). Cache no-store pra
// nao servir versao antiga apos deploy. /login.html tambem funciona via static.
app.get('/login', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// v3.24.1: tela /minha-quinzena (mobile-first dark theme) — view do colaborador.
app.get('/minha-quinzena', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'minha-quinzena.html'));
});

// v3.61.0: Captive Portal Wi-Fi. Roteadores (Mikrotik/TP-Link/Starlink+hAP)
// abrem /wifi/?local=escritorio. Atende com e sem barra final — a query string
// nao afeta o match de path e o browser a mantem na URL (lida pelo JS do portal).
app.get(['/wifi', '/wifi/'], (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'captive', 'index.html'));
});

// Logo da marca em /brand/romatec-logo.png (referenciada no portal). Serve o
// logo da bussola "R" em public/brand/ (png OU jpg — sendFile ajusta o
// Content-Type pela extensao real do arquivo). Fallback pro asset horizontal
// existente caso nada tenha sido colocado. Alias vem ANTES do express.static.
app.get('/brand/romatec-logo.png', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=86400');
  const candidates = [
    path.join(__dirname, 'public', 'brand', 'romatec-logo.png'),
    path.join(__dirname, 'public', 'brand', 'romatec-logo.jpg'),
    path.join(__dirname, 'public', 'romatec-logo-removebg-preview.png'),
  ];
  const file = candidates.find((f) => fs.existsSync(f)) ?? candidates[2];
  res.sendFile(file);
});

// v3.61.0: dashboard interno de leads Wi-Fi (protegido — a pagina checa o JWT
// via fetch /api/wifi/leads e redireciona pro /login se 401).
app.get('/admin/wifi-leads', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'admin', 'wifi-leads.html'));
});

// v1.99.18: error handler explicito pra payload demasiado grande.
// Sem isso, Express retorna HTML padrao 413 e o JSON.parse no client falha
// com SyntaxError enganador. Aqui forcamos resposta JSON sempre.
app.use((err: { type?: string; status?: number; message?: string; statusCode?: number }, _req: Request, res: Response, next: (e?: unknown) => void) => {
  if (err && (err.type === 'entity.too.large' || err.statusCode === 413)) {
    res.status(413).json({
      error: 'Tamanho do envio excede o limite (64MB). Reduza fotos, comprima ou divida em vistorias menores.',
      code: 'PAYLOAD_TOO_LARGE',
    });
    return;
  }
  next(err);
});
app.use('/rag', ragRoutes);                 // v1.26.0 — endpoints de memoria vetorial
app.use('/contracts', contractsRoutes);     // v1.27.1 — indexacao de contratos modelo (Fase 1)
app.use(painelRoutes);                      // v1.47.0 — dashboard /painel + /api/painel/stats
app.use('/api/relatorios-demarcacao', relatorioDemarcacaoRouter(pool as any)); // v3.14.0
// v3.18.0: rotas de processamento GNSS (RINEX / IBGE-PPP)
app.use('/api/gnss', gnssRouter);
// v3.22.0: autocomplete de cartórios (CNJ) p/ wizard de Proposta de Remembramento
app.use('/api/cartorios', cartoriosRouter);
app.use('/api/explicativo', explicativoRouter); // v3.23.0 — texto explicativo de serviço
app.use('/api/memoriais', memoriaisHidraulicoRouter); // v3.49.2 Memorial Hidraulico NBR 5626
app.use('/api/canvas', canvasGraficoRouter); // v3.51.0 VTA Canvas
app.use('/api/relatorio-fotografico', relatorioFotograficoRouter); // v3.51.0 VTA Relatorio Fotografico
app.use('/api/galeria', galeriaExportRouter); // Feature 04 — export Galeria p/ AvalieImob (X-API-Key)
app.use('/api/pdf-prime', pdfPrimeRouter); // v1.99.16 — export PDF templates Prime I/II (proposta/recibo)
app.use('/api/diligencias', diligenciasRouter); // v3.54.0 — Diligências de Campo
app.use('/api/wifi', wifiLeadRoutes); // v3.61.0 — Captive Portal / Captação de Leads Wi-Fi
(async () => {
  try { const m = await import('./database/migrations-wifi-leads'); await m.runMigrationsWifiLeads(); }
  catch (err) { console.error('[wifi-leads-migrations] FALHA fatal:', err); }
})();
(async () => {
  try { const m = await import('./database/migrations-canvas-grafico'); await m.runCanvasGraficoMigrations(); }
  catch (err) { console.error('[canvas-grafico-migrations] FALHA fatal:', err); }
})();
(async () => {
  try { const m = await import('./database/migrations-relatorio-fotografico'); await m.runRelatorioFotograficoMigrations(); }
  catch (err) { console.error('[relatorio-fotografico-migrations] FALHA fatal:', err); }
})();

// v1.99.15: Live Feed Universal — feed animado no topo de toda aba.
// GET /api/live-feed/:tab → cards passando em loop com os registros da aba.
import { createLiveFeedRouter } from './components/liveFeed/liveFeedRouter';
app.use('/api/live-feed', createLiveFeedRouter(pool));

// v3.23.2: /sw.js servido com injecao de versao em runtime.
// Fonte unica da verdade e' package.json (via AGENT_IDENTITY.version).
// O arquivo em disco contem o placeholder __APP_VERSION__ no const CACHE;
// aqui substituimos antes de enviar pro browser. Sem isso, esquecer de
// bumpar a string em sw.js faz o SW nunca invalidar o cache antigo (bug
// classico "deploy OK no Railway mas a versao no app nao muda").
// PRECISA vir ANTES do express.static abaixo pra interceptar a request.
app.get('/sw.js', (_req: Request, res: Response) => {
  try {
    const swPath = path.join(__dirname, 'public', 'sw.js');
    const source = fs.readFileSync(swPath, 'utf8');
    const injected = source.replace(/__APP_VERSION__/g, AGENT_IDENTITY.version);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(injected);
  } catch (err) {
    console.error('[sw.js] falha ao servir:', err);
    res.status(500).type('application/javascript').send('// sw.js read error');
  }
});

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

// v3.62.0: timestamp do boot do processo == momento do deploy atual.
// Exposto como buildTime pra barra de status do front (ex: "v3.61.1 · 10/06 17:56").
const BOOT_TIME = new Date().toISOString();

app.get('/health', (_req: Request, res: Response) => {
  res.json({ agent: AGENT_IDENTITY.name, version: AGENT_IDENTITY.version, status: 'online', timestamp: new Date().toISOString(), buildTime: BOOT_TIME });
});

// v1.93.0: rota leve so com versao — usada pelo client pra detectar
// quando ha versao nova do app E o SW antigo ainda esta cached.
app.get('/api/version', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ version: AGENT_IDENTITY.version, name: AGENT_IDENTITY.name, buildTime: BOOT_TIME });
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

// v1.72.0: status callbacks Z-API atualizam tracking de recibos universais.
// Z-API envia eventos 'sent' / 'delivered' / 'read' em payloads separados,
// vem diferente formato dependendo da versao da API. Usamos o messageId pra
// fazer match com recibos.zapi_message_id.
async function handleZapiStatusCallback(body: unknown): Promise<void> {
  if (!body || typeof body !== 'object') return;
  const b = body as Record<string, unknown>;
  // Detecta payload de status (varios formatos Z-API conhecidos)
  const eventStr = String(
    (b.event as string) ?? (b.type as string) ?? (b.status as string) ??
    ((b.data as Record<string, unknown>)?.event as string) ?? ''
  ).toLowerCase();
  const STATUS_MAP: Record<string, 'enviado' | 'entregue' | 'lido'> = {
    sent: 'enviado', delivered: 'entregue', read: 'lido',
    'message-status-sent': 'enviado',
    'message-status-delivered': 'entregue',
    'message-status-read': 'lido',
    'message_status_sent': 'enviado',
    'message_status_delivered': 'entregue',
    'message_status_read': 'lido',
  };
  const eventoRecibo = STATUS_MAP[eventStr];
  if (!eventoRecibo) return; // nao e status, ignora

  // Pega o messageId em vários formatos possiveis
  const messageId = String(
    (b.messageId as string) ?? (b.id as string) ?? (b.zaapId as string) ??
    ((b.data as Record<string, unknown>)?.messageId as string) ?? ''
  );
  if (!messageId) return;

  // Procura o recibo com esse messageId
  try {
    const r = await recibos.buscarReciboPorZapiMessageId(messageId);
    if (!r) return; // mensagem nao e de recibo, ignora
    await recibos.marcarEvento(r.id, eventoRecibo, messageId);
    console.log(`[recibos:status] recibo #${r.id} -> ${eventoRecibo} (msg ${messageId.slice(0, 12)}...)`);
  } catch (err) {
    console.warn('[recibos:status-callback] erro:', (err as Error).message);
  }
}

function handleWhatsAppWebhook(req: Request, res: Response) {
  res.json({ status: 'ok' }); // ack imediato — processa async pra não travar ZAPI
  const body = req.body ?? {};

  // v1.72.0: intercepta callbacks de status (sent/delivered/read) ANTES do parser.
  // Atualiza tracking de recibos universais sem bloquear o fluxo normal.
  void handleZapiStatusCallback(body).catch(err =>
    console.warn('[recibos:status-callback] falha:', (err as Error).message)
  );

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

        // v3.54.0 — resposta de DILIGÊNCIA (SIM/REMARCAR/NÃO). Vem ANTES dos
        // demais roteamentos; se reconhecida, atualiza status e silencia ZAYRA.
        try {
          if (msg.type === 'text') {
            const dilMod = await import('./integrations/diligencias');
            const dil = await dilMod.processarRespostaDiligencia(msg.from, msg.text.body);
            if (dil.handled) {
              console.log(`[diligencias] resposta phone=${msg.from} dil=${dil.diligencia_id} -> ${dil.acao}. ZAYRA silenciada.`);
              continue;
            }
          }
        } catch (err) {
          console.warn('[diligencias] routing falhou:', (err as Error).message);
        }

        // v3.12.0 — roteamento de resposta de cliente cobrado por parcela vencida.
        // Se o phone bate com cliente de obra com parcela em status_cobranca msg_enviada/vencido,
        // marca como cliente_respondeu + encaminha pro CEO via Telegram, e silencia ZAYRA.
        try {
          if (msg.type === 'text') {
            const cobMod = await import('./services/cobrancaParcelas');
            const cob = await cobMod.processarRespostaClienteParcela({
              phone: msg.from, text: msg.text.body, messageId: msg.id,
            });
            if (cob.handled) {
              console.log(`[cobranca-parcelas] resposta cliente phone=${msg.from} parcela=${cob.parcela_id} encaminhada ao CEO. ZAYRA silenciada.`);
              continue;
            }
          }
        } catch (err) {
          console.warn('[cobranca-parcelas] routing falhou:', (err as Error).message);
        }

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

// v1.98.0: cartao publico de visitas (sem auth) — paleta verde Romatec + dourado
// Atende /cartao e /cartao/ (com slash final). Busca em /public/cartao/index.html
app.get(['/cartao', '/cartao/'], (_req: Request, res: Response) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, 'public', 'cartao', 'index.html'));
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

// v1.67.17: envia resumo da obra pro Telegram do CEO (default) ou chat custom
app.post  ('/api/obras/:id/enviar-telegram',
  apiHandle(args => obras.enviarObraTelegram(args as Parameters<typeof obras.enviarObraTelegram>[0])));

// v1.65.40: Parcelas de pagamento do cliente (receita por obra)
app.get   ('/api/obras/:obra_id/parcelas',     apiHandle(args => obras.listarParcelasObra((args as { obra_id: string }).obra_id, args as { since?: string })));
// v3.16.0: listagem global de parcelas (full sync offline cache_v2)
app.get   ('/api/parcelas',                    apiHandle(args => obras.listarParcelas(args as { since?: string; limite?: number })));
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
// v3.24.0: requireCeoToken DESTRAVADO. Antes era no-op (return next() direto)
// deixando todas as rotas admin abertas. Agora checa X-CEO-Token contra env real
// e FALHA FECHADO se CEO_API_TOKEN nao estiver setada (antes falhava aberto).
// Implementacao moveu pra src/middleware/auth.ts pra ficar perto do requireAuth.
import { requireCeoToken, requireAuth, type AuthedRequest } from './middleware/auth';
import { requirePin } from './middleware/requirePin'; // v3.50.0

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

// v3.63.10: config das listas do VTO (tipos de vistoria + vistoriadores) —
// editavel em Configuracoes. GET aberto (so nomes); PUT exige login.
app.get('/api/vto/config', async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/configuracoes');
    const parse = (s: string): string[] => {
      try { const a = JSON.parse(s); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
      catch { return []; }
    };
    const [tit, vis, qua, con] = await Promise.all([
      m.getConfig('VTO_TITULOS'), m.getConfig('VTO_VISTORIADORES'),
      m.getConfig('VTO_QUALIFICACOES'), m.getConfig('VTO_CONSELHOS'),
    ]);
    res.json({ ok: true, titulos: parse(tit), vistoriadores: parse(vis), qualificacoes: parse(qua), conselhos: parse(con) });
  } catch (err) { res.status(500).json({ ok: false, error: (err as Error).message }); }
});
app.put('/api/vto/config', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const clean = (arr: unknown): string[] => Array.isArray(arr)
      ? [...new Set(arr.map(x => String(x).trim()).filter(Boolean))].slice(0, 100) : [];
    const m = await import('./services/configuracoes');
    if (Array.isArray(b.titulos)) await m.setConfig('VTO_TITULOS', JSON.stringify(clean(b.titulos)), 'Tipos de vistoria (VTO)');
    if (Array.isArray(b.vistoriadores)) await m.setConfig('VTO_VISTORIADORES', JSON.stringify(clean(b.vistoriadores)), 'Vistoriadores cadastrados (VTO)');
    if (Array.isArray(b.qualificacoes)) await m.setConfig('VTO_QUALIFICACOES', JSON.stringify(clean(b.qualificacoes)), 'Qualificações do vistoriador (VTO)');
    if (Array.isArray(b.conselhos)) await m.setConfig('VTO_CONSELHOS', JSON.stringify(clean(b.conselhos)), 'Conselhos/registros CFT-CREA (VTO)');
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ ok: false, error: (err as Error).message }); }
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

// v3.16.0: foto do colaborador. Upload via multipart 'arquivo' (JPG/PNG/WEBP/GIF, max 5MB).
// GET serve o binario inline com cache 1h. DELETE limpa.
app.post('/api/equipe/:id/foto', upload.single('arquivo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'arquivo obrigatorio (multipart field: arquivo)' }); return; }
    const r = await obras.uploadFotoMembroEquipe(String(req.params.id), req.file.buffer, req.file.mimetype);
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.get('/api/equipe/:id/foto', async (req: Request, res: Response) => {
  try {
    const d = await obras.getFotoMembroEquipe(String(req.params.id));
    if (!d) { res.status(404).json({ error: 'Sem foto' }); return; }
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(d.arquivo);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.delete('/api/equipe/:id/foto', async (req: Request, res: Response) => {
  try {
    const r = await obras.deletarFotoMembroEquipe(String(req.params.id));
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
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
app.post('/api/recibos/disparar', requireCeoToken, requirePin, async (req: Request, res: Response) => {
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
// v3.24.13 FIX: removido requireCeoToken de PUT/DELETE — cadastro de cliente
// nao e' admin sensivel. CEO reportou que "nao salva dados do cliente" porque
// o middleware retornava 403 quando CEO_API_TOKEN nao estava setado.
// Rotas destrutivas/financeiras (transacoes, propostas) continuam protegidas.
app.put   ('/api/propostas-clientes/:id', apiHandle(args => propostas.atualizarClienteProposta(args as Parameters<typeof propostas.atualizarClienteProposta>[0])));
app.delete('/api/propostas-clientes/:id', apiHandle(args => propostas.apagarClienteProposta(args as { id: string })));

app.get   ('/api/propostas',             apiHandle(args => propostas.listarPropostas(args as Parameters<typeof propostas.listarPropostas>[0])));
app.get   ('/api/propostas/:id',         apiHandle(args => propostas.buscarProposta((args as { id: string }).id)));
app.post  ('/api/propostas',             apiHandle(args => propostas.criarProposta(args as Parameters<typeof propostas.criarProposta>[0])));
app.put   ('/api/propostas/:id',         apiHandle(args => propostas.atualizarProposta(args as Parameters<typeof propostas.atualizarProposta>[0])));
app.delete('/api/propostas/:id',         requireCeoToken, requirePin, apiHandle(args => propostas.apagarProposta(args as { id: string })));

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
// v1.99.15: transição de status rascunho/enviada → assinada (mão de obra)
app.post('/api/propostas/:id/assinar', apiHandle(async (args) => {
  return propostas.assinarProposta(Number((args as { id: string }).id));
}));
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

// v1.99.12: envio simples de texto WhatsApp (usado pelo modal "Passar Vale")
app.post('/api/whatsapp/send-text', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const { phone, message } = (req.body || {}) as { phone?: string; message?: string };
    if (!phone || !message) {
      res.status(400).json({ error: 'phone e message obrigatorios' });
      return;
    }
    const phoneClean = String(phone).replace(/\D/g, '');
    if (phoneClean.length < 10) {
      res.status(400).json({ error: 'telefone invalido' });
      return;
    }
    const r = await sendReply(phoneClean, String(message));
    res.json({ ok: true, result: r });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.99.13: PREVIEW PDF de Vale (sem persistir)
app.post('/api/recibos/vale/preview-pdf', async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const { gerarPdfVale } = await import('./services/valePdf');
    const pool = (await import('./database/connection')).default;
    const membroId = Number(b.membro_id);
    if (!membroId) { res.status(400).json({ error: 'membro_id obrigatorio' }); return; }
    const valor = Number(b.valor);
    if (!valor || valor <= 0) { res.status(400).json({ error: 'valor invalido' }); return; }

    // Busca dados do membro
    const [rows] = await pool.execute<import('mysql2').RowDataPacket[]>(
      'SELECT nome, funcao, cpf, telefone FROM romatec_obra_equipe WHERE id = ? LIMIT 1',
      [membroId]
    );
    if (!rows.length) { res.status(404).json({ error: 'Membro nao encontrado' }); return; }
    const m = rows[0] as { nome: string; funcao: string | null; cpf: string | null; telefone: string | null };

    // v1.99.21: forma_pagamento no preview tambem
    const formaPagPreviewRaw = typeof b.forma_pagamento === 'string' ? b.forma_pagamento.toLowerCase() : '';
    const formaPagPreview = (['pix', 'dinheiro', 'ted', 'transferencia'].includes(formaPagPreviewRaw)
      ? formaPagPreviewRaw : null) as 'pix' | 'dinheiro' | 'ted' | 'transferencia' | null;
    const pdf = await gerarPdfVale({
      membro_nome: m.nome,
      membro_funcao: m.funcao,
      membro_cpf: m.cpf,
      membro_telefone: m.telefone,
      valor,
      descricao: typeof b.descricao === 'string' ? b.descricao : null,
      periodo: String(b.periodo || ''),
      saldo_anterior: Number(b.saldo_anterior) || 0,
      obra_nome: typeof b.obra_nome === 'string' ? b.obra_nome : null,
      forma_pagamento: formaPagPreview,
      preview: true,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="vale-preview.pdf"');
    res.send(pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.99.16: cria vale como RECIBO UNIVERSAL tipo='vale' (fluxo confirmacao
// WhatsApp completo) + ajuste em recibos_ajustes (subtrai do quinzenal).
// Atomicidade via transacao MySQL. Idempotencia via chave natural
// (membro+periodo+valor) com janela 60s.
app.post('/api/recibos/vale/criar-e-enviar', requireCeoToken, async (req: Request, res: Response) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const membroId = Number(b.membro_id);
  const valor = Number(b.valor);
  const periodo = String(b.periodo || '');
  if (!membroId || !valor || valor <= 0 || !periodo) {
    res.status(400).json({ error: 'membro_id, valor e periodo obrigatorios' });
    return;
  }
  const descricao = typeof b.descricao === 'string' ? b.descricao : '';
  const enviarWa = b.enviar_whatsapp !== false; // default true
  const enviarTg = !!b.enviar_telegram;
  const saldoAnterior = Number(b.saldo_anterior) || 0;
  const obraNome = typeof b.obra_nome === 'string' ? b.obra_nome : null;
  // v1.99.21: forma de pagamento (PIX | Dinheiro | TED | Transferência)
  const formaPagRaw = typeof b.forma_pagamento === 'string' ? b.forma_pagamento.toLowerCase() : '';
  const formaPag = (['pix', 'dinheiro', 'ted', 'transferencia'].includes(formaPagRaw)
    ? formaPagRaw : 'pix') as 'pix' | 'dinheiro' | 'ted' | 'transferencia';
  // v1.99.22: phone override (substitui o do colaborador) + extras (copias pra outros)
  const phoneOverride = typeof b.phone_override === 'string'
    ? b.phone_override.replace(/\D/g, '')
    : '';
  const phonesExtras = Array.isArray(b.phones_extras)
    ? (b.phones_extras as unknown[])
        .map(p => String(p ?? '').replace(/\D/g, ''))
        .filter(p => p.length >= 10)
    : [];

  const pool = (await import('./database/connection')).default;
  const recibosMod = await import('./integrations/recibos');

  const [memberRows] = await pool.execute<import('mysql2').RowDataPacket[]>(
    'SELECT nome, funcao, cpf, telefone FROM romatec_obra_equipe WHERE id = ? LIMIT 1',
    [membroId]
  );
  if (!memberRows.length) { res.status(404).json({ error: 'Membro nao encontrado' }); return; }
  const m = memberRows[0] as { nome: string; funcao: string | null; cpf: string | null; telefone: string | null };
  // v1.99.22: aceita override de telefone — pode salvar vale sem telefone cadastrado
  // se o user passou phone_override no payload.
  const phonePrincipalEnvio = phoneOverride || m.telefone || '';
  if (!phonePrincipalEnvio && phonesExtras.length === 0 && enviarWa) {
    res.status(400).json({ error: 'Membro sem telefone cadastrado e nenhum override informado — recibo de vale exige numero pra envio' });
    return;
  }

  // ── IDEMPOTENCIA — chave natural (membro+periodo+valor) janela 60s ─────
  // Se duplo-clique cria o mesmo vale 2x, retorna SAME RESPONSE da 1a chamada
  // sem reenviar nem duplicar registros. JOIN com recibos pra confirmar
  // que ambos os lados (ajuste + recibo universal) ja existem.
  // v1.99.20: COLLATE explicito pra evitar 'Illegal mix of collations'.
  // recibos.resource_id e VARCHAR utf8mb4_unicode_ci; CAST(a.id AS CHAR)
  // sai com utf8mb4_0900_ai_ci (default MySQL 8). Usar CAST(... AS UNSIGNED)
  // do lado de recibos.resource_id resolve sem dependencia de collation.
  const [duplicatas] = await pool.execute<import('mysql2').RowDataPacket[]>(
    `SELECT a.id AS ajuste_id,
            r.id AS vale_id, r.numero, r.token, r.hash_validacao
       FROM recibos_ajustes a
       LEFT JOIN recibos r
              ON r.resource_type = 'ajuste_quinzenal'
             AND CAST(r.resource_id AS UNSIGNED) = a.id
      WHERE a.membro_id = ?
        AND a.periodo = ?
        AND a.tipo = 'adiantamento'
        AND a.valor = ?
        AND a.criado_em >= NOW() - INTERVAL 60 SECOND
      ORDER BY a.id DESC LIMIT 1`,
    [membroId, periodo, valor]
  );
  if (duplicatas.length > 0 && duplicatas[0].vale_id) {
    const dup = duplicatas[0];
    console.log(`[vale:idempotente] retornando vale_id=${dup.vale_id} (criado <60s, mesma chave membro=${membroId}/periodo=${periodo}/valor=${valor})`);
    res.json({
      ok: true,
      idempotent: true,
      numero: dup.numero,
      vale_id: Number(dup.vale_id),
      ajuste_id: Number(dup.ajuste_id),
      token: dup.token,
      hash: dup.hash_validacao,
      link_v: `${getBaseUrl()}/v/${dup.hash_validacao}`,
      valor,
      saldo_apos: saldoAnterior - valor,
      envios: { ok: [], falha: [], note: 'idempotente — nao reenvia' },
    });
    return;
  }

  // ── PERSISTENCIA TRANSACIONAL (ajuste + recibo universal) ──────────────
  const conn = await pool.getConnection();
  let ajusteId = 0;
  let reciboCriado: import('./integrations/recibos').Recibo;
  try {
    await conn.beginTransaction();
    // 1) INSERT ajuste (subtrai do quinzenal automaticamente)
    const [ajusteRes] = await conn.execute<import('mysql2').ResultSetHeader>(
      `INSERT INTO recibos_ajustes (membro_id, periodo, tipo, valor, descricao, criado_por)
       VALUES (?, ?, 'adiantamento', ?, ?, ?)`,
      [membroId, periodo, valor, descricao || `Vale passado em ${new Date().toLocaleDateString('pt-BR')}`, 'admin']
    );
    ajusteId = Number(ajusteRes.insertId);

    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error('[vale:persistencia] rollback:', (err as Error).message);
    res.status(500).json({ error: 'Falha ao persistir vale: ' + (err as Error).message });
    return;
  } finally {
    conn.release();
  }

  // 2) Cria recibo universal (chama criarRecibo que faz proprio numero/token/hash)
  // Fora da transacao acima porque criarRecibo gerencia conexao propria
  // (com lock pessimista pra numeracao). Se falhar, removemos o ajuste.
  try {
    // v1.99.21: forma_pagamento pra recibos universais usa enum proprio
    // (pix|dinheiro|transferencia|cartao|boleto|cheque). Mapeio TED -> transferencia.
    const formaPagRecibo: 'pix' | 'dinheiro' | 'transferencia' =
      formaPag === 'ted' ? 'transferencia' :
      formaPag === 'pix' ? 'pix' :
      formaPag === 'dinheiro' ? 'dinheiro' :
      'transferencia';
    reciboCriado = await recibosMod.criarRecibo({
      tenant_id: 1,
      tipo: 'vale',
      resource_type: 'ajuste_quinzenal',
      resource_id: String(ajusteId),
      destinatario_nome: m.nome,
      destinatario_doc: m.cpf,
      destinatario_phone: m.telefone || phonePrincipalEnvio, // v1.99.22: fallback override
      valor,
      forma_pagamento: formaPagRecibo,
      descricao_servico: descricao || `Vale (adiantamento) — ${m.nome}`,
      categoria_servico: 'vale_quinzenal',
      categoria_grupo: null,
      emitente_perfil: 'romatec_pj',
      expira_em_dias: 30,
    });
    console.log(`[vale:criado] vale=${reciboCriado.numero} ajuste=${ajusteId} membro=${membroId} valor=${valor}`);
  } catch (err) {
    // Compensacao: remove o ajuste pra nao ficar fantasma
    await pool.execute('DELETE FROM recibos_ajustes WHERE id = ?', [ajusteId]).catch(() => {});
    console.error('[vale:recibo-criar] falhou, ajuste removido:', (err as Error).message);
    res.status(500).json({ error: 'Falha ao criar recibo universal: ' + (err as Error).message });
    return;
  }

  // 3) Gera PDF do vale com QR + hash (Etapa 4 vai usar input.recibo)
  const { gerarPdfVale } = await import('./services/valePdf');
  const pdf = await gerarPdfVale({
    membro_nome: m.nome,
    membro_funcao: m.funcao,
    membro_cpf: m.cpf,
    membro_telefone: m.telefone,
    valor,
    descricao: descricao || null,
    periodo,
    saldo_anterior: saldoAnterior,
    obra_nome: obraNome,
    forma_pagamento: formaPag, // v1.99.21
    numero: reciboCriado.numero,
    recibo: reciboCriado, // v1.99.16: PDF agora inclui QR /v/:hash + hash truncado
  });

  const enviosOk: string[] = [];
  const enviosFalha: string[] = [];
  let zapiMessageId: string | undefined;

  // 4) WhatsApp — envia pra principal + extras (v1.99.22)
  // Cada numero recebe texto + PDF anexo. So o PRIMEIRO envio bem-sucedido
  // grava zapi_message_id (usado pra confirmacao via webhook CONFIRMO —
  // a confirmacao deve vir do principal/colaborador, nao das copias).
  if (enviarWa) {
    const wa = await import('./integrations/whatsapp');
    const todosOsPhones: Array<{ phone: string; rotulo: string }> = [];
    if (phonePrincipalEnvio) {
      todosOsPhones.push({ phone: phonePrincipalEnvio, rotulo: 'principal' });
    }
    for (const extra of phonesExtras) {
      if (extra && extra !== phonePrincipalEnvio) {
        todosOsPhones.push({ phone: extra, rotulo: 'extra' });
      }
    }
    const caption = `💸 *Recibo de Vale* — ${reciboCriado.numero}\n\n` +
      `${m.nome}, foi registrado um vale de *R$ ${valor.toLocaleString('pt-BR',{minimumFractionDigits:2})}*` +
      `${descricao ? ` (${descricao})` : ''}.\n\nSerá descontado da próxima quinzena.\n\n` +
      `Para confirmar o recebimento, responda *CONFIRMO*.\n\n— Romatec`;
    let primeiroEnvioOk = false;
    for (const dest of todosOsPhones) {
      try {
        const repRes = await wa.sendReply(dest.phone, caption);
        await wa.sendDocument(dest.phone, pdf.toString('base64'), `Vale-${reciboCriado.numero}.pdf`);
        enviosOk.push(`whatsapp:${dest.rotulo}:${dest.phone.slice(-4)}`);
        console.log(`[vale:whatsapp:${dest.rotulo}] vale=${reciboCriado.numero} phone=${dest.phone} msgId=${repRes.messageId ?? '?'}`);
        if (!primeiroEnvioOk && repRes.messageId) {
          zapiMessageId = repRes.messageId;
          primeiroEnvioOk = true;
        }
      } catch (err) {
        console.error(`[vale:whatsapp:${dest.rotulo}] falhou pra ${dest.phone}:`, (err as Error).message);
        enviosFalha.push(`whatsapp:${dest.rotulo}:${dest.phone.slice(-4)}`);
      }
    }
    if (zapiMessageId) {
      await recibosMod.marcarEvento(reciboCriado.id, 'enviado', zapiMessageId).catch(err =>
        console.warn('[vale:marcarEvento]', (err as Error).message)
      );
    }
  }

  // 5) Telegram pro CEO (copia)
  if (enviarTg) {
    try {
      const { sendDocument: sendTelegramDocument } = await import('./integrations/telegram');
      const chatId = process.env.TELEGRAM_CEO_CHAT_ID
        || process.env.TELEGRAM_CHAT_ID
        || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
      if (!chatId) throw new Error('Telegram CEO chat_id nao configurado');
      await sendTelegramDocument(
        chatId, pdf, `Vale-${reciboCriado.numero}.pdf`,
        `💸 Vale ${reciboCriado.numero} — ${m.nome} — R$ ${valor.toLocaleString('pt-BR',{minimumFractionDigits:2})}` +
        `${descricao ? `\n${descricao}` : ''}\n\n🔗 ${getBaseUrl()}/v/${reciboCriado.hash_validacao}`
      );
      enviosOk.push('telegram');
    } catch (err) {
      console.error('[vale:telegram] falhou:', (err as Error).message);
      enviosFalha.push('telegram');
    }
  }

  res.json({
    ok: true,
    numero: reciboCriado.numero,
    vale_id: reciboCriado.id,
    ajuste_id: ajusteId,
    token: reciboCriado.token,
    hash: reciboCriado.hash_validacao,
    link_v: `${getBaseUrl()}/v/${reciboCriado.hash_validacao}`,
    valor,
    saldo_apos: saldoAnterior - valor,
    envios: { ok: enviosOk, falha: enviosFalha },
  });
});

// ── v1.81.0: lookups Brasil API (CEP, CNPJ) pra autocompletar formularios
app.get('/api/lookup/cep/:cep', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/brasilApi');
    res.json(await m.consultarCep({ cep: String(req.params.cep) }));
  } catch (err) { res.status(404).json({ error: (err as Error).message }); }
});
app.get('/api/lookup/cnpj/:cnpj', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/brasilApi');
    res.json(await m.consultarCnpj({ cnpj: String(req.params.cnpj) }));
  } catch (err) { res.status(404).json({ error: (err as Error).message }); }
});

// ── v1.74.0: Configuração Fiscal + Notas Fiscais (NFe.io) ───────────────
app.get('/api/fiscal-config', async (_req: Request, res: Response) => {
  try {
    const cfg = await getTenantFiscalConfig(1);
    res.json(cfg); // has_api_key boolean — nunca retorna a chave em si
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.put('/api/fiscal-config', async (req: Request, res: Response) => {
  try {
    const cfg = await upsertTenantFiscalConfig({
      ...(req.body || {}),
      tenant_id: 1,
    });
    res.json(cfg);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ─── v1.99.25: Laudo de Demarcacao — Fase 1 (Contratantes/Executantes/Laudo) ──

// CONTRATANTES
app.get('/api/contratantes', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/contratantes');
    const r = await m.listarContratantes({
      q: typeof req.query.q === 'string' ? req.query.q : undefined,
      tipo_pessoa: req.query.tipo_pessoa === 'PF' || req.query.tipo_pessoa === 'PJ'
        ? req.query.tipo_pessoa : undefined,
      apenas_ativos: req.query.apenas_ativos !== 'false',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.get('/api/contratantes/:id', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/contratantes');
    const c = await m.buscarContratante(String(req.params.id));
    if (!c) { res.status(404).json({ error: 'Contratante nao encontrado' }); return; }
    res.json(c);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.post('/api/contratantes', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/contratantes');
    const c = await m.criarContratante(req.body || {});
    res.status(201).json(c);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.put('/api/contratantes/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/contratantes');
    const c = await m.atualizarContratante(String(req.params.id), req.body || {});
    res.json(c);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.delete('/api/contratantes/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/contratantes');
    if (req.query.hard === 'true') {
      await m.excluirContratante(String(req.params.id));
    } else {
      await m.desativarContratante(String(req.params.id));
    }
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// EXECUTANTES
app.get('/api/executantes', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/executantes');
    const items = await m.listarExecutantes({ apenas_ativos: req.query.apenas_ativos !== 'false' });
    res.json(items);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.post('/api/executantes', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/executantes');
    const e = await m.criarExecutante(req.body || {});
    res.status(201).json(e);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.put('/api/executantes/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/executantes');
    const e = await m.atualizarExecutante(String(req.params.id), req.body || {});
    res.json(e);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// LAUDOS DE DEMARCACAO (Fase 1: rascunho + listagem)
app.get('/api/laudos-demarcacao', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const statusValido = ['RASCUNHO','PREENCHIDO','ASSINADO','RECIBO_GERADO','ENVIADO','CONFIRMADO','CANCELADO'];
    const status = typeof req.query.status === 'string' && statusValido.includes(req.query.status)
      ? (req.query.status as 'RASCUNHO' | 'PREENCHIDO' | 'ASSINADO' | 'RECIBO_GERADO' | 'ENVIADO' | 'CONFIRMADO' | 'CANCELADO')
      : undefined;
    const r = await m.listarLaudos({
      status,
      contratante_id: req.query.contratante_id ? Number(req.query.contratante_id) : undefined,
      apenas_ativos: req.query.apenas_ativos !== 'false',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.get('/api/laudos-demarcacao/:id', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    // v2.4.2: aceita id numerico ou uuid_local
    const id = await m.resolverLaudoId(String(req.params.id));
    const l = await m.buscarLaudo(id);
    if (!l) { res.status(404).json({ error: 'Laudo nao encontrado' }); return; }
    res.json(l);
  } catch (err) { res.status(404).json({ error: (err as Error).message }); }
});
app.post('/api/laudos-demarcacao', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const l = await m.criarLaudoRascunho(req.body || {});
    res.status(201).json(l);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.delete('/api/laudos-demarcacao/:id', requireCeoToken, requirePin, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    await m.desativarLaudo(id);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// PUT — atualiza dados gerais do laudo (imovel, confrontantes, ART/TRT, financeiro)
app.put('/api/laudos-demarcacao/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const l = await m.atualizarLaudo(id, req.body || {});
    res.json(l);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v1.99.26 — Fase 2: Pontos (vertices) + calculos geodesicos
app.get('/api/laudos-demarcacao/:id/pontos', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const [pontos, lados] = await Promise.all([
      m.listarPontosDoLaudo(id),
      m.listarLadosDoLaudo(id),
    ]);
    res.json({ pontos, lados });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.post('/api/laudos-demarcacao/:id/pontos', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const b = (req.body || {}) as { pontos?: unknown; default_zona?: number; default_hemisferio?: 'N' | 'S' };
    if (!Array.isArray(b.pontos)) {
      res.status(400).json({ error: 'campo `pontos` (array) obrigatorio' });
      return;
    }
    const r = await m.salvarPontosDoLaudo(
      id,
      b.pontos as Parameters<typeof m.salvarPontosDoLaudo>[1],
      b.default_zona ?? 23,
      b.default_hemisferio ?? 'S'
    );
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// Import RTK (CSV/TXT) — recebe { texto: string } e retorna pontos parseados

// v3.1.0: clonagem 1-clique de laudo
app.post('/api/laudos-demarcacao/:id/clonar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    // v3.17.4: aceita { copiar_fotos: boolean } no body — quando true, INSERT...SELECT
    // duplica fotos do original no clone (sem rastrear ponto_id, pois pontos foram zerados)
    const copiarFotos = !!(req.body?.copiar_fotos);
    const clone = await m.clonarLaudo(id, { copiarFotos });
    res.json(clone);
  } catch (err) {
    const msg = (err as Error).message;
    const status = /nao encontrado|inativo/i.test(msg) ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

// v3.0.0: precificação INCRA — sugestão de critérios baseada nos dados do laudo
app.get('/api/laudos-demarcacao/:id/precificacao/sugerir', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const { sugerirCriterios } = await import('./services/pricing/incra');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) return res.status(404).json({ error: 'Laudo nao encontrado' });

    const criterios = sugerirCriterios({
      area_total_m2: laudo.area_total_m2 ?? undefined,
      perimetro_m:   laudo.perimetro_m ?? undefined,
      uf:            laudo.uf_imovel ?? undefined,
      municipio:     laudo.municipio ?? undefined,
    });

    res.json({
      criterios,
      fonte: {
        area_ha:      laudo.area_total_m2 ? +(laudo.area_total_m2 / 10000).toFixed(4) : null,
        perimetro_km: laudo.perimetro_m ? +(laudo.perimetro_m / 1000).toFixed(4) : null,
        uf:           laudo.uf_imovel ?? null,
      },
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// v3.0.0: precificação INCRA — calcular e persistir
app.post('/api/laudos-demarcacao/:id/precificacao/calcular', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const unidade = String(body.unidade ?? '');
    if (!['km','hectare','lote'].includes(unidade)) {
      return res.status(400).json({ error: "Campo 'unidade' obrigatorio: km, hectare ou lote" });
    }
    const quantidade = Number(body.quantidade);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return res.status(400).json({ error: "Campo 'quantidade' deve ser numero > 0" });
    }
    const c = body.criterios ?? {};
    const criterios = {
      vegetacao:     Number(c.vegetacao),
      relevo:        Number(c.relevo),
      insalubridade: Number(c.insalubridade),
      acesso:        Number(c.acesso),
      clima:         Number(c.clima),
      area_media:    Number(c.area_media),
    };
    const desc = body.desconto ?? { tipo: 'nenhum', valor: 0 };
    const desconto = {
      tipo:  String(desc.tipo ?? 'nenhum') as 'percentual' | 'fixo' | 'nenhum',
      valor: Number(desc.valor ?? 0),
    };
    if (!['percentual','fixo','nenhum'].includes(desconto.tipo)) {
      return res.status(400).json({ error: "desconto.tipo invalido" });
    }

    const m = await import('./integrations/laudos');
    const { calcularPrecificacao } = await import('./services/pricing/incra');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) return res.status(404).json({ error: 'Laudo nao encontrado' });

    const resultado = calcularPrecificacao({ criterios, unidade: unidade as 'km'|'hectare'|'lote', quantidade, desconto });

    await m.atualizarPrecificacao(id, {
      unidade: unidade as 'km'|'hectare'|'lote',
      criterios,
      quantidade,
      resultado,
      desconto,
      observacoes: body.observacoes ?? null,
    });

    res.json(resultado);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// v3.0.0: precificação INCRA — recalcula só desconto (laudo já com precificação base)
app.patch('/api/laudos-demarcacao/:id/precificacao', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const desc = req.body?.desconto ?? {};
    const desconto = {
      tipo:  String(desc.tipo ?? 'nenhum') as 'percentual' | 'fixo' | 'nenhum',
      valor: Number(desc.valor ?? 0),
    };
    if (!['percentual','fixo','nenhum'].includes(desconto.tipo)) {
      return res.status(400).json({ error: "desconto.tipo invalido" });
    }

    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) return res.status(404).json({ error: 'Laudo nao encontrado' });
    if (!laudo.precificacao_calculada_em || laudo.valor_base_calculado == null) {
      return res.status(409).json({ error: 'Laudo nao possui precificacao base. Use POST /precificacao/calcular primeiro.' });
    }

    const valorBase = Number(laudo.valor_base_calculado);
    let descontoAplicado = 0;
    const avisos: string[] = [];

    if (desconto.tipo === 'percentual') {
      if (desconto.valor < 0 || desconto.valor > 100) {
        return res.status(400).json({ error: 'Desconto percentual deve estar entre 0 e 100' });
      }
      descontoAplicado = +(valorBase * (desconto.valor / 100)).toFixed(2);
    } else if (desconto.tipo === 'fixo') {
      if (desconto.valor < 0) return res.status(400).json({ error: 'Desconto fixo nao pode ser negativo' });
      if (desconto.valor > valorBase) return res.status(400).json({ error: 'Desconto fixo nao pode ser maior que o valor base' });
      descontoAplicado = +desconto.valor.toFixed(2);
    }

    const valorFinal = +(valorBase - descontoAplicado).toFixed(2);
    if (valorBase > 0 && (descontoAplicado / valorBase) * 100 > 10) {
      avisos.push(`Desconto aplicado (${((descontoAplicado / valorBase) * 100).toFixed(1)}%) excede a variacao admissivel de 10% prevista na Portaria INCRA 12/2025.`);
    }

    await m.atualizarApenasDesconto(id, desconto, valorFinal);

    res.json({
      valorBase,
      descontoAplicado,
      valorFinal,
      avisos,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// v2.10.0: Memorial descritivo do laudo (texto narrativo padrao tecnico)
// Usado pelo painel lateral do preview e pelo PDF (mesma funcao).
app.get('/api/laudos-demarcacao/:id/memorial', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const c = await import('./integrations/contratantes');
    const memMod = await import('./services/memorialDescritivo');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) { res.status(404).json({ error: 'Laudo nao encontrado' }); return; }
    const [pontos, lados, contratante] = await Promise.all([
      m.listarPontosDoLaudo(id),
      m.listarLadosDoLaudo(id),
      c.buscarContratante(laudo.contratante_id).catch(() => null),
    ]);
    const out = memMod.gerarMemorialDescritivo({ laudo, pontos, lados, contratante });
    res.json(out);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/laudos-demarcacao/import-rtk', requireCeoToken, async (req: Request, res: Response) => {
  try {
    // v2.5.0: dispatcher auto-deteta CSV/TXT/KML/GPX. Aceita default_zona e
    // default_hemisferio pra conversao lat/lng -> UTM quando o arquivo trouxer
    // coordenadas geograficas (KML, GPX, ou CSV com colunas lat/lng).
    const { importarPontosArquivo } = await import('./services/geometria');
    const texto = typeof req.body?.texto === 'string' ? req.body.texto : '';
    if (!texto.trim()) { res.status(400).json({ error: 'campo `texto` obrigatorio' }); return; }
    const defaultZona = req.body?.default_zona ? Number(req.body.default_zona) : undefined;
    const defaultHemisferio = (req.body?.default_hemisferio === 'N' || req.body?.default_hemisferio === 'S')
      ? req.body.default_hemisferio
      : undefined;
    const r = importarPontosArquivo(texto, { defaultZona, defaultHemisferio });
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

/**
 * v2.7.0: Import binario (XLSX, DXF, SHP) via multipart upload.
 * Detecta formato pela extensao + dispatcha pro parser apropriado.
 * CSV/TXT/KML/GPX continuam pelo /import-rtk com texto no body — esse
 * endpoint e so pros formatos binarios ou que tem encoding especial.
 */
app.post('/api/laudos-demarcacao/import-arquivo', requireCeoToken, upload.single('arquivo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'arquivo obrigatorio (campo `arquivo` em multipart)' }); return; }
    const { importarXLSX, importarDXF, importarSHP, importarPontosArquivo } = await import('./services/geometria');
    const filename = req.file.originalname || '';
    const ext = filename.toLowerCase().split('.').pop() || '';
    const defaultZona = req.body?.default_zona ? Number(req.body.default_zona) : undefined;
    const defaultHemisferio = (req.body?.default_hemisferio === 'N' || req.body?.default_hemisferio === 'S')
      ? req.body.default_hemisferio
      : undefined;
    const opts = { defaultZona, defaultHemisferio };
    let formato: string;
    let r: { pontos: unknown[]; cabecalhos: string[] };
    if (ext === 'xlsx' || ext === 'xls') {
      formato = 'XLSX';
      r = importarXLSX(req.file.buffer, opts);
    } else if (ext === 'dxf') {
      formato = 'DXF';
      r = importarDXF(req.file.buffer.toString('utf8'), opts);
    } else if (ext === 'shp') {
      formato = 'SHP';
      r = await importarSHP(req.file.buffer, opts);
    } else if (ext === 'csv' || ext === 'txt' || ext === 'dat' || ext === 'kml' || ext === 'gpx') {
      // Texto: tenta UTF-8 strict, fallback Windows-1252 (v2.7.1)
      // Coletoras brasileiras e softwares CAD frequentemente geram em CP1252.
      let texto: string;
      try {
        texto = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer);
      } catch (_) {
        console.log('[import-arquivo] UTF-8 falhou em', filename, '— tentando windows-1252');
        texto = new TextDecoder('windows-1252').decode(req.file.buffer);
      }
      const r2 = importarPontosArquivo(texto, opts);
      formato = r2.formato;
      r = r2;
    } else {
      res.status(400).json({ error: `extensao .${ext} nao suportada — use csv/txt/dat/kml/gpx/xlsx/dxf/shp` });
      return;
    }
    res.json({ ...r, formato });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ─── v2.8.0: Modulo Loteamentos / Auto-preenchimento ──────────────────────────
// CRUD de leitura + import CSV/XLSX em 2 passadas.

app.get('/api/loteamentos', requireCeoToken, async (_req: Request, res: Response) => {
  try {
    const m = await import('./integrations/loteamentos');
    const list = await m.listarLoteamentos();
    res.json({ loteamentos: list });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/loteamentos/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/loteamentos');
    const id = Number(req.params.id);
    const loteamento = await m.buscarLoteamento(id);
    if (!loteamento) { res.status(404).json({ error: 'Loteamento nao encontrado' }); return; }
    const quadras = await m.listarQuadras(id);
    res.json({ loteamento, quadras });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/loteamentos/quadra/:quadraId/lotes', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/loteamentos');
    const lotes = await m.listarLotesPorQuadra(Number(req.params.quadraId));
    res.json({ lotes });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/loteamentos/lote/:loteId', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/loteamentos');
    // v2.9.0: devolve "completo" com quadra + loteamento + confrontantes resolvidos
    const lote = await m.buscarLoteCompleto(Number(req.params.loteId));
    if (!lote) { res.status(404).json({ error: 'Lote nao encontrado' }); return; }
    res.json({ lote });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/configuracoes-demarcacao', requireCeoToken, async (_req: Request, res: Response) => {
  try {
    const m = await import('./integrations/loteamentos');
    const cfg = await m.getConfig();
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.99.17: defaults globais de precificação (Desmembramento/Desdobro + salário mínimo).
// Público intencional (sem requireCeoToken) — UI consome ao montar form de proposta.
app.get('/api/configuracoes/defaults-precificacao', async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/configuracoes');
    const defaults = await m.getDefaultsPrecificacao();
    res.json(defaults);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.put('/api/configuracoes-demarcacao', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/loteamentos');
    const tol = Number(req.body?.tolerancia_medida_cm ?? 5);
    if (!Number.isFinite(tol) || tol < 0) { res.status(400).json({ error: 'tolerancia_medida_cm invalida' }); return; }
    await m.setTolerancia(tol);
    const cfg = await m.getConfig();
    res.json(cfg);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ============================================================
// v3.2.0: Cartorios nacional (CNJ) — autocomplete no campo Cartorio
// ============================================================
//
// Catalogo nacional (3.7k cartorios com atribuicao Registro de Imoveis).
// Endpoint admin POST /api/admin/cartorios/importar dispara o importer
// que le data/cartorios-cns.csv e faz UPSERT em batches. Endpoint publico
// GET /api/cartorios filtra por UF + texto livre para alimentar a UI.
app.post('/api/admin/cartorios/importar', requireCeoToken, async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/cartoriosImporter');
    const result = await m.importarCartoriosFromFile();
    res.json(result);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/cartorios', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const uf = String(req.query.uf || '').trim().toUpperCase();
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    if (uf && uf.length !== 2) { res.status(400).json({ error: 'uf invalida (use sigla de 2 letras)' }); return; }
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (uf) { where.push('uf = ?'); params.push(uf); }
    if (q) {
      // Busca tolerante: normaliza o termo igual a coluna cidade_normalizada
      // e tambem permite match em denominacao/responsavel.
      const qNorm = q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      where.push('(cidade_normalizada LIKE ? OR denominacao LIKE ? OR responsavel LIKE ?)');
      params.push(`%${qNorm}%`, `%${q}%`, `%${q}%`);
    }
    const sql =
      `SELECT cns, cns_formatado, denominacao, uf, cidade, responsavel, status
         FROM cartorios
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY uf, cidade, denominacao
        LIMIT ${limit}`;
    const m = await import('./database/connection');
    const [rows] = await m.default.execute(sql, params);
    res.json({ cartorios: rows, total: (rows as unknown[]).length, uf: uf || null, q: q || null });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

/**
 * Import unificado CSV/XLSX. Multipart upload com campo `arquivo`.
 * Query param `preview=1` valida sem persistir e retorna relatorio.
 * Detecta formato por extensao + decode UTF-8 strict / fallback CP1252.
 */
app.post('/api/loteamentos/import', requireCeoToken, upload.single('arquivo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'arquivo obrigatorio (campo `arquivo`)' }); return; }
    const m = await import('./integrations/loteamentos');
    const filename = req.file.originalname || '';
    const ext = filename.toLowerCase().split('.').pop() || '';
    const preview = String(req.query.preview || req.body?.preview || '').toLowerCase() === '1' || req.query.preview === 'true';
    type LinhaImportT = Parameters<typeof m.importarLinhas>[0][number];
    type OrigemT = Parameters<typeof m.importarLinhas>[1];
    let linhas: LinhaImportT[] = [];
    let origem: OrigemT;

    if (ext === 'csv' || ext === 'txt') {
      // Decode com fallback CP1252
      let texto: string;
      try {
        texto = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer);
      } catch (_) {
        texto = new TextDecoder('windows-1252').decode(req.file.buffer);
      }
      // Strip BOM
      texto = texto.replace(/^﻿/, '');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Papa = require('papaparse') as typeof import('papaparse');
      const parsed = Papa.parse<LinhaImportT>(texto, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase(),
      });
      if (parsed.errors?.length) {
        // Apenas avisa; papaparse e lenient
        console.warn('[import-loteamento] avisos parse:', parsed.errors.slice(0, 3));
      }
      linhas = parsed.data;
      origem = 'csv';
    } else if (ext === 'xlsx' || ext === 'xls') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const xlsx = require('xlsx') as typeof import('xlsx');
      const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) { res.status(400).json({ error: 'arquivo XLSX sem sheets' }); return; }
      const ws = wb.Sheets[sheetName];
      const json = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      // Normaliza chaves (lowercase)
      linhas = json.map(row => {
        const norm: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          norm[String(k).trim().toLowerCase()] = v;
        }
        return norm as LinhaImportT;
      });
      origem = 'xlsx';
    } else {
      res.status(400).json({ error: `extensao .${ext} nao suportada — use .csv ou .xlsx` });
      return;
    }

    const relatorio = await m.importarLinhas(linhas, origem, { preview });
    res.json({ preview, ...relatorio });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.6.0 — Planta da Quadra: upload DXF do loteamento + preview de mapeamento
app.post(
  '/api/loteamentos/:id/importar-dxf',
  requireCeoToken,
  upload.single('arquivo'),
  async (req: Request, res: Response) => {
    const loteamentoId = Number(req.params.id);
    if (!req.file) {
      res.status(400).json({ erro: 'arquivo ausente (multipart field: arquivo)' });
      return;
    }
    const nome = (req.file.originalname || '').toLowerCase();
    if (!nome.endsWith('.dxf')) {
      res.status(400).json({ erro: 'apenas .dxf ASCII e suportado (exporte do AutoCAD como DXF)' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs/promises') as typeof import('node:fs/promises');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const tmpPath = path.join(os.tmpdir(), `dxf-${crypto.randomUUID()}.dxf`);
    try {
      await fs.writeFile(tmpPath, req.file.buffer);
      const parser = await import('./services/parserDxfPython');
      const matcher = await import('./services/mapearDxfQuadras');
      const m = await import('./integrations/loteamentos');

      const report = await parser.parseLoteamentoDxf(tmpPath);
      const quadrasCad = await m.listarQuadras(loteamentoId);
      const lotesCadNested = await Promise.all(
        quadrasCad.map(q =>
          m.listarLotesPorQuadra(q.id).then(ls => ls.map(l => ({ ...l, quadra_id: q.id }))),
        ),
      );
      const lotesCad = lotesCadNested.flat();
      const mapping = matcher.mapearDxfQuadras(report, quadrasCad, lotesCad);
      res.json({ report, mapping });
    } catch (err) {
      const parser = await import('./services/parserDxfPython');
      if (err instanceof parser.DxfParseError) {
        const status = err.codigo === 'dependencia_ausente' ? 503 : 400;
        res.status(status).json({ erro: err.codigo, detalhe: err.detalhe });
        return;
      }
      res.status(500).json({ erro: 'falha_interna', detalhe: (err as Error).message });
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  },
);

// v3.6.0 — Planta da Quadra: confirma e persiste geometria
app.post(
  '/api/loteamentos/:id/importar-dxf/confirmar',
  requireCeoToken,
  async (req: Request, res: Response) => {
    const body = req.body as {
      matches?: Array<{
        tipo: 'quadra' | 'lote';
        cadastro_id: number;
        geojson: string;
      }>;
    };
    if (!Array.isArray(body?.matches)) {
      res.status(400).json({ erro: 'matches[] ausente' });
      return;
    }
    const m = await import('./integrations/loteamentos');
    let quadras = 0, lotes = 0;
    for (const item of body.matches) {
      try {
        const parsed = JSON.parse(item.geojson);
        if (parsed?.type !== 'Polygon' || !Array.isArray(parsed.coordinates)) continue;
      } catch { continue; }
      if (item.tipo === 'quadra') {
        await m.salvarGeometriaQuadra(item.cadastro_id, item.geojson);
        quadras++;
      } else if (item.tipo === 'lote') {
        await m.salvarGeometriaLote(item.cadastro_id, item.geojson);
        lotes++;
      }
    }
    res.json({ quadras_atualizadas: quadras, lotes_atualizados: lotes });
  },
);

// v3.8.0 — Galeria de Fotos georreferenciadas

app.get('/api/galeria', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/galeria');
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const obraId = req.query.obra_id ? Number(req.query.obra_id) : undefined;
    const fotos = await m.listarFotos({ limit, offset, obra_id: obraId });
    res.json({ fotos });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Binário da foto (preview) — retorna data URI ou bytes
app.get('/api/galeria/:id/arquivo', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/galeria');
    const foto = await m.buscarFotoComB64(Number(req.params.id));
    if (!foto) { res.status(404).json({ error: 'Foto não encontrada' }); return; }
    const buf = Buffer.from(foto.arquivo_b64, 'base64');
    res.setHeader('Content-Type', foto.mime);
    res.setHeader('Content-Disposition', `inline; filename="foto-${foto.id}.${foto.mime.split('/')[1] || 'jpg'}"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/galeria', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/galeria');
    const b = (req.body || {}) as Record<string, unknown>;
    if (!b.arquivo_b64 || typeof b.arquivo_b64 !== 'string') {
      res.status(400).json({ error: 'arquivo_b64 obrigatório' });
      return;
    }
    if (!b.mime || typeof b.mime !== 'string' || !b.mime.startsWith('image/')) {
      res.status(400).json({ error: 'mime de imagem obrigatório (ex: image/jpeg)' });
      return;
    }
    const id = await m.criarFoto({
      mime: b.mime,
      arquivo_b64: b.arquivo_b64,
      user_nome: typeof b.user_nome === 'string' ? b.user_nome : null,
      legenda: typeof b.legenda === 'string' ? b.legenda : null,
      lat: typeof b.lat === 'number' ? b.lat : null,
      lng: typeof b.lng === 'number' ? b.lng : null,
      altitude_m: typeof b.altitude_m === 'number' ? b.altitude_m : null,
      accuracy_m: typeof b.accuracy_m === 'number' ? b.accuracy_m : null,
      endereco_reverso: typeof b.endereco_reverso === 'string' ? b.endereco_reverso : null,
      capturada_em: typeof b.capturada_em === 'string' ? b.capturada_em : null,
      tags: typeof b.tags === 'string' ? b.tags : null,
      obra_id: typeof b.obra_id === 'number' ? b.obra_id : null,
    });
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/galeria/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/galeria');
    const b = (req.body || {}) as Record<string, unknown>;
    const ok = await m.atualizarFoto(Number(req.params.id), {
      legenda: typeof b.legenda === 'string' ? b.legenda : undefined,
      tags: typeof b.tags === 'string' ? b.tags : undefined,
      obra_id: typeof b.obra_id === 'number' ? b.obra_id : undefined,
    });
    res.json({ ok });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/galeria/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/galeria');
    const ok = await m.apagarFoto(Number(req.params.id));
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Envia a foto pra WhatsApp ou Telegram
// body: { canal: 'whatsapp' | 'telegram', destinatario: string, caption?: string }
app.post('/api/galeria/:id/enviar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const g = await import('./integrations/galeria');
    const foto = await g.buscarFotoComB64(Number(req.params.id));
    if (!foto) { res.status(404).json({ error: 'Foto não encontrada' }); return; }
    const b = (req.body || {}) as { canal?: string; destinatario?: string; caption?: string };
    const canal = (b.canal || '').toLowerCase();
    const destinatario = String(b.destinatario || '').trim();
    const caption = String(b.caption || '');
    if (!destinatario) { res.status(400).json({ error: 'destinatario obrigatório' }); return; }

    if (canal === 'whatsapp') {
      const wa = await import('./integrations/whatsapp');
      const dataUri = `data:${foto.mime};base64,${foto.arquivo_b64}`;
      const r = await wa.sendImage(destinatario, dataUri, caption);
      res.json({ ok: true, canal, messageId: r.messageId });
      return;
    }
    if (canal === 'telegram') {
      // Telegram sendPhoto via multipart upload
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) { res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN não configurado' }); return; }
      const buf = Buffer.from(foto.arquivo_b64, 'base64');
      const FormData = (await import('form-data')).default;
      const fd = new FormData();
      fd.append('chat_id', destinatario);
      if (caption) fd.append('caption', caption);
      fd.append('photo', buf, { filename: `foto-${foto.id}.jpg`, contentType: foto.mime });
      const axios = (await import('axios')).default;
      const resp = await axios.post(
        `https://api.telegram.org/bot${token}/sendPhoto`,
        fd,
        { headers: fd.getHeaders(), timeout: 30000 },
      );
      res.json({ ok: true, canal, telegram: resp.data });
      return;
    }
    res.status(400).json({ error: `canal inválido: ${canal} (esperado 'whatsapp' ou 'telegram')` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// v3.35.0: memoriais de calculo (Fase 1 — Hidraulico NBR 5626).
// Endpoints core: catalogo de disciplinas + wizard + upload-pdf + criar + get + listar.
app.get('/api/memoriais/disciplinas', async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/memoriais/wizardEngine');
    res.json({ disciplinas: m.listarDisciplinasDisponiveis() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/memoriais/:disciplina/wizard', async (req: Request, res: Response) => {
  try {
    const disc = String(req.params.disciplina);
    const validos = ['arquitetonico', 'eletrico', 'hidraulico', 'sanitario', 'estrutural', 'pci'];
    if (!validos.includes(disc)) { res.status(404).json({ error: 'disciplina invalida' }); return; }
    const m = await import('./services/memoriais/wizardEngine');
    res.json(m.obterWizardDisciplina(disc as 'hidraulico'));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/memoriais/upload-pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as { pdf_b64?: string };
    if (!b.pdf_b64) { res.status(422).json({ error: 'pdf_b64 obrigatorio' }); return; }
    const buf = Buffer.from(b.pdf_b64, 'base64');
    if (buf.length === 0 || buf.length > 30 * 1024 * 1024) {
      res.status(413).json({ error: 'PDF deve ter ate 30 MB' });
      return;
    }
    const parser = await import('./services/memoriais/memorialPdfParser');
    const r = await parser.parsePlantaPdf(buf);
    res.json({
      metadados: r.metadados,
      tabelas: r.tabelas,
      produtos_inexistentes: r.produtos_inexistentes,
      confianca: r.confianca,
      observacoes: r.observacoes_extracao,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// v3.37.0 HOTFIX: /calcular tornado PUBLICO (espelhando /adicional-campo/calcular
// da v3.36.0). Calculo e' deterministico — le apenas tabelas NBR 5626 hardcoded
// no engine, nao acessa DB, nao persiste, nao retorna dado sensivel.
// Diagnostico: user reportou 401 em producao ao usar o wizard hidraulico.
app.post('/api/memoriais/hidraulico/calcular', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/memoriais/hidraulicoCalc');
    const r = m.calcularMemorialHidraulico(req.body as Parameters<typeof m.calcularMemorialHidraulico>[0]);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// v3.48.0 — Fase 2 Memoriais: Sanitario / Eletrico / Estrutural
// Mesmo padrao do hidraulico: calculo deterministico, publico (sem auth),
// le tabelas NBR hardcoded, nao acessa DB, nao persiste.
app.post('/api/memoriais/sanitario/calcular', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/memoriais/sanitarioCalc');
    const r = m.calcularMemorialSanitario(req.body as Parameters<typeof m.calcularMemorialSanitario>[0]);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/memoriais/eletrico/calcular', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/memoriais/eletricoCalc');
    const r = m.calcularMemorialEletrico(req.body as Parameters<typeof m.calcularMemorialEletrico>[0]);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/memoriais/estrutural/calcular', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/memoriais/estruturalCalc');
    const r = m.calcularMemorialEstrutural(req.body as Parameters<typeof m.calcularMemorialEstrutural>[0]);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/memoriais/:disciplina/criar', requireAuth, async (req: Request, res: Response) => {
  try {
    const disc = String(req.params.disciplina);
    // v3.48.0: Fase 2 ativa Sanitario, Eletrico e Estrutural alem do Hidraulico
    const DISCIPLINAS_ATIVAS = new Set(['hidraulico', 'sanitario', 'eletrico', 'estrutural']);
    if (!DISCIPLINAS_ATIVAS.has(disc)) {
      res.status(422).json({ error: `Disciplina ${disc} ainda nao implementada. Disponiveis: ${[...DISCIPLINAS_ATIVAS].join(', ')}` });
      return;
    }
    const user = (req as AuthedRequest).user;
    const b = (req.body || {}) as Record<string, unknown>;
    if (!b.obra_titulo || !b.obra_endereco || !b.proprietario_nome || !b.area_construida_m2) {
      res.status(422).json({ error: 'obra_titulo, obra_endereco, proprietario_nome e area_construida_m2 sao obrigatorios' });
      return;
    }
    const repo = await import('./repositories/memoriaisRepo');
    const r = await repo.memoriaisRepo.criar({
      disciplina: disc as 'hidraulico' | 'sanitario' | 'eletrico' | 'estrutural',
      obra_id: typeof b.obra_id === 'number' ? b.obra_id : null,
      cliente_id: typeof b.cliente_id === 'number' ? b.cliente_id : null,
      user_id: user?.sub ? Number(user.sub) : null,
      obra_titulo: String(b.obra_titulo),
      obra_uso: typeof b.obra_uso === 'string' ? b.obra_uso : undefined,
      obra_endereco: String(b.obra_endereco),
      obra_municipio: typeof b.obra_municipio === 'string' ? b.obra_municipio : undefined,
      obra_uf: typeof b.obra_uf === 'string' ? b.obra_uf : undefined,
      obra_cep: typeof b.obra_cep === 'string' ? b.obra_cep : null,
      proprietario_nome: String(b.proprietario_nome),
      proprietario_cpf_cnpj: typeof b.proprietario_cpf_cnpj === 'string' ? b.proprietario_cpf_cnpj : null,
      area_lote_m2: typeof b.area_lote_m2 === 'number' ? b.area_lote_m2 : null,
      area_construida_m2: Number(b.area_construida_m2),
      num_pavimentos: typeof b.num_pavimentos === 'number' ? b.num_pavimentos : 1,
      wizard_responses: b.wizard_responses,
      pdf_extracted_data: b.pdf_extracted_data,
      pdf_filename: typeof b.pdf_filename === 'string' ? b.pdf_filename : null,
      prancha_codigo: typeof b.prancha_codigo === 'string' ? b.prancha_codigo : null,
      trt_numero: typeof b.trt_numero === 'string' ? b.trt_numero : null,
      trt_data: typeof b.trt_data === 'string' ? b.trt_data : null,
    });
    res.json({ ok: true, id: r.id, codigo: r.codigo });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/memoriais/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const repo = await import('./repositories/memoriaisRepo');
    const row = await repo.memoriaisRepo.buscarPorId(id);
    if (!row) { res.status(404).json({ error: 'memorial nao encontrado' }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/memoriais', requireAuth, async (req: Request, res: Response) => {
  try {
    const repo = await import('./repositories/memoriaisRepo');
    const items = await repo.memoriaisRepo.listar({
      disciplina: typeof req.query.disciplina === 'string' ? req.query.disciplina as 'hidraulico' : undefined,
      status: typeof req.query.status === 'string' ? req.query.status as 'finalizado' : undefined,
      obra_id: typeof req.query.obra_id === 'string' ? Number(req.query.obra_id) : undefined,
      limite: typeof req.query.limite === 'string' ? Number(req.query.limite) : undefined,
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// v3.31.0: planta individual por quadra (DXF/DWG/PDF) — upload/download/parse.
// Reusa /api/loteamentos/* (sem prefixo novo). Multer + magic bytes + parser DXF lazy.
app.post(
  '/api/loteamentos/:lotId/quadras/:quadraId/planta/upload',
  requireAuth,
  (req: Request, res: Response, next: () => void) => {
    void (async () => {
      const m = await import('./middleware/uploadPlantaMulter');
      m.uploadPlantaMulter(req, res, (err) => {
        if (err) { res.status(422).json({ error: 'upload', detail: (err as Error).message }); return; }
        next();
      });
    })();
  },
  async (req: Request, res: Response) => {
    try {
      const user = (req as AuthedRequest).user;
      const lotId = Number(req.params.lotId);
      const quadraId = Number(req.params.quadraId);
      if (!Number.isFinite(lotId) || !Number.isFinite(quadraId)) {
        res.status(404).json({ error: 'lotId/quadraId invalido' }); return;
      }
      const filesRaw = (req as Request & { files?: Record<string, Express.Multer.File[]> | Express.Multer.File[] }).files;
      const files: Record<string, Express.Multer.File[]> = Array.isArray(filesRaw) ? {} : (filesRaw || {});
      const formatos: Array<'dxf' | 'dwg' | 'pdf'> = ['dxf', 'dwg', 'pdf'];
      const storage = await import('./services/quadraPlantaStorage');
      const repo = await import('./repositories/quadrasPlantasRepo');
      const resultados: Array<{ formato: string; status: 'ok' | 'erro'; detalhe?: string; size_bytes?: number; hash?: string }> = [];
      let teveSucesso = false;

      for (const f of formatos) {
        const arr = files[f];
        if (!arr || arr.length === 0) continue;
        const file = arr[0];
        try {
          const r = await storage.salvarPlanta(lotId, quadraId, f, file.buffer);
          await repo.quadrasPlantasRepo.upsertFormato({
            loteamento_id: lotId,
            quadra_id: quadraId,
            formato: f,
            snapshot: {
              filename: file.originalname.slice(0, 240),
              path: r.caminho_relativo,
              size_bytes: r.size_bytes,
              hash_sha256: r.hash_sha256,
              uploaded_at: new Date(),
            },
            uploaded_by_user_id: user?.sub ? Number(user.sub) : null,
          });
          resultados.push({ formato: f, status: 'ok', size_bytes: r.size_bytes, hash: r.hash_sha256 });
          teveSucesso = true;
        } catch (err) {
          resultados.push({ formato: f, status: 'erro', detalhe: (err as Error).message });
        }
      }

      if (teveSucesso) await repo.quadrasPlantasRepo.marcarFlagQuadra(quadraId, true);

      // Background parse do DXF (nao bloqueia resposta)
      const dxfOk = resultados.find((r) => r.formato === 'dxf' && r.status === 'ok');
      if (dxfOk) {
        void (async () => {
          try {
            const buf = await storage.lerPlanta(lotId, quadraId, 'dxf');
            const parser = await import('./services/quadraPlantaDxfParser');
            const out = await parser.parsearDxfBuffer(buf);
            await repo.quadrasPlantasRepo.atualizarParse(quadraId, {
              parse_status: out.status,
              num_lotes_detectados: out.num_lotes_detectados,
              perimetro_quadra_m: out.perimetro_total_m,
              area_total_quadra_m2: out.area_total_m2,
              lotes_extraidos_json: out.lotes.length > 0 ? JSON.stringify(out.lotes) : null,
              parse_error: out.mensagem ?? null,
            });
            console.log(`[planta-quadra] parse DXF quadra=${quadraId} status=${out.status} lotes=${out.num_lotes_detectados}`);
          } catch (err) {
            console.error(`[planta-quadra] parse DXF FALHOU quadra=${quadraId}:`, (err as Error).message);
            await repo.quadrasPlantasRepo.atualizarParse(quadraId, { parse_status: 'erro', parse_error: (err as Error).message });
          }
        })();
      }

      res.json({ ok: teveSucesso, resultados });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

app.get('/api/loteamentos/:lotId/quadras/:quadraId/planta', requireAuth, async (req: Request, res: Response) => {
  try {
    const quadraId = Number(req.params.quadraId);
    const repo = await import('./repositories/quadrasPlantasRepo');
    const row = await repo.quadrasPlantasRepo.findByQuadraId(quadraId);
    if (!row) { res.status(404).json({ error: 'planta nao encontrada' }); return; }
    res.json(row);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/loteamentos/:lotId/quadras/:quadraId/planta/:formato/download', requireAuth, async (req: Request, res: Response) => {
  try {
    const lotId = Number(req.params.lotId);
    const quadraId = Number(req.params.quadraId);
    const formato = String(req.params.formato).toLowerCase();
    if (!['dxf', 'dwg', 'pdf'].includes(formato)) { res.status(400).json({ error: 'formato invalido' }); return; }
    const storage = await import('./services/quadraPlantaStorage');
    const repo = await import('./repositories/quadrasPlantasRepo');
    const row = await repo.quadrasPlantasRepo.findByQuadraId(quadraId);
    if (!row) { res.status(404).json({ error: 'planta nao encontrada' }); return; }
    const filenameCol = (row as unknown as Record<string, unknown>)[`${formato}_filename`] as string | null;
    if (!filenameCol) { res.status(404).json({ error: `formato ${formato} nao disponivel` }); return; }
    const buf = await storage.lerPlanta(lotId, quadraId, formato as 'dxf' | 'dwg' | 'pdf');
    const mime = formato === 'pdf' ? 'application/pdf' : (formato === 'dxf' ? 'application/dxf' : 'application/acad');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filenameCol.replace(/[^a-z0-9._-]/gi, '_')}"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.delete('/api/loteamentos/:lotId/quadras/:quadraId/planta/:formato', requireAuth, async (req: Request, res: Response) => {
  try {
    const lotId = Number(req.params.lotId);
    const quadraId = Number(req.params.quadraId);
    const formato = String(req.params.formato).toLowerCase() as 'dxf' | 'dwg' | 'pdf';
    if (!['dxf', 'dwg', 'pdf'].includes(formato)) { res.status(400).json({ error: 'formato invalido' }); return; }
    const storage = await import('./services/quadraPlantaStorage');
    const repo = await import('./repositories/quadrasPlantasRepo');
    const removed = await storage.removerPlanta(lotId, quadraId, formato);
    await repo.quadrasPlantasRepo.limparFormato(quadraId, formato);
    const row = await repo.quadrasPlantasRepo.findByQuadraId(quadraId);
    const restantes = ['dxf_filename', 'dwg_filename', 'pdf_filename'].some((c) => (row as unknown as Record<string, unknown>)?.[c]);
    if (!restantes) await repo.quadrasPlantasRepo.marcarFlagQuadra(quadraId, false);
    res.json({ ok: true, removed });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/loteamentos/:lotId/quadras/:quadraId/planta/parse', requireAuth, async (req: Request, res: Response) => {
  try {
    const lotId = Number(req.params.lotId);
    const quadraId = Number(req.params.quadraId);
    const storage = await import('./services/quadraPlantaStorage');
    const repo = await import('./repositories/quadrasPlantasRepo');
    const parser = await import('./services/quadraPlantaDxfParser');
    const buf = await storage.lerPlanta(lotId, quadraId, 'dxf');
    const out = await parser.parsearDxfBuffer(buf);
    await repo.quadrasPlantasRepo.atualizarParse(quadraId, {
      parse_status: out.status,
      num_lotes_detectados: out.num_lotes_detectados,
      perimetro_quadra_m: out.perimetro_total_m,
      area_total_quadra_m2: out.area_total_m2,
      lotes_extraidos_json: out.lotes.length > 0 ? JSON.stringify(out.lotes) : null,
      parse_error: out.mensagem ?? null,
    });
    res.json(out);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/loteamentos/:lotId/quadras/:quadraId/planta/lotes-extraidos', requireAuth, async (req: Request, res: Response) => {
  try {
    const quadraId = Number(req.params.quadraId);
    const repo = await import('./repositories/quadrasPlantasRepo');
    const row = await repo.quadrasPlantasRepo.findByQuadraId(quadraId);
    if (!row) { res.status(404).json({ error: 'planta nao encontrada' }); return; }
    const lotes = row.lotes_extraidos_json ? JSON.parse(row.lotes_extraidos_json) : [];
    res.json({ parse_status: row.parse_status, num_lotes: row.num_lotes_detectados, lotes });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.33.0 (= v3.27.1 do prompt): adicional de campo REFACTORED.
// Substitui o select(tipo, grau) livre por wizard estruturado de cenario.
// Endpoint /api/adicional-campo/* (singular, novo). O legacy /aditivos-campo
// continua existindo por compat retro.
app.get('/api/adicional-campo/cenarios', async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/pricing/adicionalCampo');
    res.json({ cenarios: m.listarCenarios() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// v3.36.0 HOTFIX: endpoint /calcular tornado PUBLICO (sem requireAuth).
// Diagnostico do 401 em producao: cookie httpOnly de sessao nao chegava ao
// endpoint quando o user marcava o checkbox do adicional sem estar logado.
// O calculo e' determinist​ico (consulta apenas pricing-params.json — sem DB,
// sem side-effect, sem dado sensivel). Endpoint /cenarios ja era publico —
// agora /calcular tambem. Endpoints que PERSISTEM (criar/atualizar proposta)
// continuam protegidos.
app.post('/api/adicional-campo/calcular', async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const ativo = !!b.ativo;
    const m = await import('./services/pricing/adicionalCampo');
    if (!ativo) {
      res.json(m.calcularAdicionalCampo({ ativo: false }));
      return;
    }
    const cenario = String(b.cenario || '');
    const validos = ['mata_densa_animais', 'rodovia_faixa_dominio', 'eletricidade_alta_tensao', 'pedreira_explosivos', 'produtos_quimicos'];
    if (!validos.includes(cenario)) {
      res.status(422).json({ error: 'cenario invalido', detail: 'esperado: ' + validos.join('|') });
      return;
    }
    try {
      const r = m.calcularAdicionalCampo({
        ativo: true,
        cenario: cenario as 'mata_densa_animais' | 'rodovia_faixa_dominio' | 'eletricidade_alta_tensao' | 'pedreira_explosivos' | 'produtos_quimicos',
        tipo: (typeof b.tipo === 'string' ? b.tipo : undefined) as 'insalubridade' | 'periculosidade' | undefined,
        grau: (typeof b.grau === 'string' ? b.grau : undefined) as 'minimo' | 'medio' | 'maximo' | 'unico' | undefined,
        bloco_enquadramento_tecnico_editado: typeof b.bloco_enquadramento_tecnico_editado === 'string' ? b.bloco_enquadramento_tecnico_editado : undefined,
        bloco_justificativa_cliente_editado: typeof b.bloco_justificativa_cliente_editado === 'string' ? b.bloco_justificativa_cliente_editado : undefined,
        observacao_adicional: typeof b.observacao_adicional === 'string' ? b.observacao_adicional : undefined,
      });
      res.json(r);
    } catch (err) {
      res.status(422).json({ error: 'combinacao invalida', detail: (err as Error).message });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// v3.29.0: aditivo de campo (insalubridade/periculosidade) — endpoints de
// catalogo + calculo. CRUD admin dos templates fica como follow-up.
app.get('/api/aditivos-campo/configs', requireAuth, async (_req: Request, res: Response) => {
  try {
    const m = await import('./repositories/aditivoCampoRepo');
    const items = await m.aditivoCampoConfigRepo.listarAtivos();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/aditivos-campo/configs/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) { res.status(404).json({ error: 'id invalido' }); return; }
    const m = await import('./repositories/aditivoCampoRepo');
    const c = await m.aditivoCampoConfigRepo.buscarPorId(id);
    if (!c) { res.status(404).json({ error: 'config nao encontrada' }); return; }
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/aditivos-campo/calcular', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    const tipo = String(b.tipo || '');
    const grau = String(b.grau || '');
    if (tipo !== 'insalubridade' && tipo !== 'periculosidade') {
      res.status(422).json({ error: 'tipo invalido' }); return;
    }
    if (!['minimo', 'medio', 'maximo', 'unico'].includes(grau)) {
      res.status(422).json({ error: 'grau invalido' }); return;
    }
    const bc = b.base_calculo as Record<string, unknown> | undefined;
    // Aceita tanto { base_calculo: { diarias_tecnico_valor, diarias_equipamento_valor } }
    // quanto shortcut { base_calculo_valor } (split 50/50 — uso so pra preview rapido)
    let dtec = 0, deq = 0;
    if (bc && typeof bc === 'object') {
      dtec = Number(bc.diarias_tecnico_valor) || 0;
      deq = Number(bc.diarias_equipamento_valor) || 0;
    } else if (typeof b.base_calculo_valor === 'number') {
      const tot = Number(b.base_calculo_valor) || 0;
      dtec = tot / 2;
      deq = tot / 2;
    }
    const fc = await import('./services/aditivoCampoCalculator');
    const repo = await import('./repositories/aditivoCampoRepo');
    const r = await fc.calcularAditivoCampo({
      tipo: tipo as 'insalubridade' | 'periculosidade',
      grau: grau as 'minimo' | 'medio' | 'maximo' | 'unico',
      base_calculo: { diarias_tecnico_valor: dtec, diarias_equipamento_valor: deq },
      observacao_tecnica: typeof b.observacao_tecnica === 'string' ? b.observacao_tecnica : undefined,
    }, repo.aditivoCampoConfigRepo);
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// v3.28.0: Galeria Pos-Captura — compartilhamento multi-canal + download +
// preferences. Reusa servicos existentes (whatsapp/telegram) via injecao.
// Validacao manual (padrao do repo — Zod nao e' usado em nenhum outro lugar).
type CanalCompart = 'celular_download' | 'whatsapp' | 'telegram';
const CANAIS_VALIDOS: CanalCompart[] = ['celular_download', 'whatsapp', 'telegram'];

interface ParsedCompart {
  canais: CanalCompart[];
  destinatario_whatsapp?: string;
  destinatario_telegram?: string;
  legenda?: string;
}

function validarCompartilharBody(body: unknown): { ok: true; data: ParsedCompart } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body invalido' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.canais) || b.canais.length === 0) {
    return { ok: false, error: 'canais (array nao vazio) obrigatorio' };
  }
  const canais: CanalCompart[] = [];
  for (const c of b.canais) {
    if (typeof c !== 'string' || !(CANAIS_VALIDOS as readonly string[]).includes(c)) {
      return { ok: false, error: `canal invalido: ${String(c)}` };
    }
    canais.push(c as CanalCompart);
  }
  const dwa = typeof b.destinatario_whatsapp === 'string' ? b.destinatario_whatsapp : undefined;
  const dtg = typeof b.destinatario_telegram === 'string' ? b.destinatario_telegram : undefined;
  if (dwa != null && !/^\d{10,15}$/.test(dwa)) {
    return { ok: false, error: 'destinatario_whatsapp deve ter 10-15 digitos' };
  }
  if (dtg != null && !/^(@\w+|-?\d+)$/.test(dtg)) {
    return { ok: false, error: 'destinatario_telegram deve ser @username ou chat_id numerico' };
  }
  if (canais.includes('whatsapp') && !dwa) return { ok: false, error: 'WhatsApp requer destinatario_whatsapp' };
  if (canais.includes('telegram') && !dtg) return { ok: false, error: 'Telegram requer destinatario_telegram' };
  const legenda = typeof b.legenda === 'string' ? b.legenda.slice(0, 1024) : undefined;
  return { ok: true, data: { canais, destinatario_whatsapp: dwa, destinatario_telegram: dtg, legenda } };
}

async function buscarFotoArquivoCarregada(id: number) {
  const g = await import('./integrations/galeria');
  const foto = await g.buscarFotoComB64(id);
  if (!foto) return null;
  return {
    id: foto.id,
    mime: foto.mime,
    buffer: Buffer.from(foto.arquivo_b64, 'base64'),
    lat: foto.lat,
    lng: foto.lng,
    capturada_em: foto.capturada_em,
  };
}

// POST /api/galeria/fotos/:id/compartilhar — multi-canal
app.post('/api/galeria/fotos/:id/compartilhar', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user) { res.status(401).json({ error: 'nao autenticado' }); return; }
    const parsed = validarCompartilharBody(req.body || {});
    if (!parsed.ok) {
      res.status(422).json({ error: 'validacao', detail: parsed.error });
      return;
    }
    const fotoId = Number(req.params.id);
    if (!Number.isFinite(fotoId) || fotoId <= 0) { res.status(404).json({ error: 'foto invalida' }); return; }
    const arq = await buscarFotoArquivoCarregada(fotoId);
    if (!arq) { res.status(404).json({ error: 'foto nao encontrada' }); return; }

    const fc = await import('./integrations/fotoCompartilhamento');
    const repo = await import('./repositories/fotosEnviosLogRepo');
    const wa = await import('./integrations/whatsapp');
    const tg = await import('./integrations/telegram');

    const idemKey = String(req.headers['idempotency-key'] || '').trim() || undefined;

    const resultados = await fc.compartilharFoto({
      foto_id: fotoId,
      user_id: Number(user.sub),
      canais: parsed.data.canais,
      destinatario_whatsapp: parsed.data.destinatario_whatsapp,
      destinatario_telegram: parsed.data.destinatario_telegram,
      legenda: parsed.data.legenda,
      idempotency_key: idemKey,
    }, arq, {
      log: repo.fotosEnviosLogRepo,
      senders: {
        whatsapp: async (to, buffer, mime, caption) => {
          const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
          const r = await wa.sendImage(to, dataUri, caption);
          return { messageId: r.messageId };
        },
        telegram: async (to, buffer, mime, caption) => {
          // Telegram aceita Buffer direto via FormData (existe em sendDocument; sendPhoto
          // segue mesmo pattern via raw axios — fallback usando o codigo de /enviar)
          const FormData = (await import('form-data')).default;
          const axios = (await import('axios')).default;
          const fd = new FormData();
          fd.append('chat_id', to);
          if (caption) fd.append('caption', caption);
          fd.append('photo', buffer, { filename: `foto-${fotoId}.jpg`, contentType: mime });
          const token = process.env.TELEGRAM_BOT_TOKEN;
          if (!token) throw new Error('TELEGRAM_BOT_TOKEN nao configurado');
          const resp = await axios.post(
            `https://api.telegram.org/bot${token}/sendPhoto`,
            fd,
            { headers: fd.getHeaders(), timeout: 30000 },
          );
          const msgId = resp.data?.result?.message_id;
          return { messageId: typeof msgId === 'number' ? msgId : undefined };
        },
      },
      baseUrlDownload: (fid) => `/api/galeria/fotos/${fid}/download`,
    });

    res.json({ ok: true, resultados });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/galeria/fotos/:id/download — stream com Content-Disposition: attachment
app.get('/api/galeria/fotos/:id/download', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/galeria');
    const foto = await m.buscarFotoComB64(Number(req.params.id));
    if (!foto) { res.status(404).json({ error: 'foto nao encontrada' }); return; }
    const buf = Buffer.from(foto.arquivo_b64, 'base64');
    const ext = (foto.mime.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '');
    const fname = `romatec-foto-${foto.id}.${ext}`;
    res.setHeader('Content-Type', foto.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/users/me/preferences/galeria — retorna preferences.galeria_pos_captura ou defaults
const DEFAULT_PREFS_GALERIA = {
  salvar_celular: false,
  whatsapp: false,
  telegram: false,
  destinatario_whatsapp_default: '',
  destinatario_telegram_default: '',
  lembrar_escolha: false,
  mostrar_modal: true,
};

app.get('/api/users/me/preferences/galeria', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user) { res.status(401).json({ error: 'nao autenticado' }); return; }
    const m = await import('./repositories/userPreferencesRepo');
    const prefs = await m.userPreferencesRepo.get(Number(user.sub));
    const galeria = (prefs?.galeria_pos_captura as Record<string, unknown> | undefined) || {};
    res.json({ galeria_pos_captura: { ...DEFAULT_PREFS_GALERIA, ...galeria } });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/users/me/preferences/galeria — persiste
function validarPrefsGaleria(body: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body invalido' };
  const b = body as Record<string, unknown>;
  const g = b.galeria_pos_captura;
  if (!g || typeof g !== 'object') return { ok: false, error: 'galeria_pos_captura obrigatorio' };
  const obj = g as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['salvar_celular', 'whatsapp', 'telegram', 'lembrar_escolha', 'mostrar_modal']) {
    if (k in obj && typeof obj[k] !== 'boolean') return { ok: false, error: `${k} deve ser boolean` };
    if (k in obj) out[k] = obj[k];
  }
  for (const k of ['destinatario_whatsapp_default', 'destinatario_telegram_default']) {
    if (k in obj && typeof obj[k] !== 'string') return { ok: false, error: `${k} deve ser string` };
    if (k in obj) out[k] = obj[k];
  }
  return { ok: true, data: out };
}

app.put('/api/users/me/preferences/galeria', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user) { res.status(401).json({ error: 'nao autenticado' }); return; }
    const parsed = validarPrefsGaleria(req.body || {});
    if (!parsed.ok) {
      res.status(422).json({ error: 'validacao', detail: parsed.error });
      return;
    }
    const m = await import('./repositories/userPreferencesRepo');
    const atual = await m.userPreferencesRepo.get(Number(user.sub));
    const merged = {
      ...(atual || {}),
      galeria_pos_captura: {
        ...DEFAULT_PREFS_GALERIA,
        ...((atual?.galeria_pos_captura as Record<string, unknown> | undefined) || {}),
        ...parsed.data,
      },
    };
    await m.userPreferencesRepo.upsert(Number(user.sub), merged);
    res.json({ ok: true, galeria_pos_captura: merged.galeria_pos_captura });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// v1.99.27 — Fase 3: Croqui SVG / Upload + Fotos

// GET croqui — gera SVG auto OU retorna o upload manual
app.get('/api/laudos-demarcacao/:id/croqui', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const laudo = await m.buscarLaudo(id);
    if (!laudo) { res.status(404).json({ error: 'Laudo nao encontrado' }); return; }

    if (laudo.croqui_tipo === 'UPLOAD') {
      const up = await m.getCroquiUpload(id);
      if (!up) { res.status(404).json({ error: 'Croqui upload nao encontrado' }); return; }
      const buf = Buffer.from(up.base64, 'base64');
      res.setHeader('Content-Type', up.mime);
      res.setHeader('Content-Disposition', `inline; filename="croqui-${id}.${up.mime.split('/')[1] || 'png'}"`);
      res.send(buf);
      return;
    }

    // AUTO_SVG
    const svg = await m.gerarCroquiAutoSvg(id);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// POST upload croqui manual
app.post('/api/laudos-demarcacao/:id/croqui-upload', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const b = (req.body || {}) as { mime?: string; conteudo_b64?: string };
    if (!b.conteudo_b64) { res.status(400).json({ error: 'conteudo_b64 obrigatorio' }); return; }
    if (!b.mime) { res.status(400).json({ error: 'mime obrigatorio' }); return; }
    await m.salvarCroquiUpload(id, b.conteudo_b64, b.mime);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// POST volta pro auto-SVG (limpa upload manual)
app.post('/api/laudos-demarcacao/:id/croqui-reset', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    await m.resetarCroquiAuto(id);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// FOTOS — listar
app.get('/api/laudos-demarcacao/:id/fotos', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const fotos = await m.listarFotosDoLaudo(id);
    res.json(fotos);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// FOTOS — adicionar (uma ou varias em batch)
app.post('/api/laudos-demarcacao/:id/fotos', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const id = await m.resolverLaudoId(String(req.params.id));
    const b = (req.body || {}) as { fotos?: unknown };
    if (!Array.isArray(b.fotos) || b.fotos.length === 0) {
      res.status(400).json({ error: 'campo `fotos` (array) obrigatorio' });
      return;
    }
    const adicionadas = [];
    for (const f of b.fotos) {
      const ff = f as { mime?: string; conteudo_b64?: string; legenda?: string; ponto_id?: number };
      if (!ff.mime || !ff.conteudo_b64) continue;
      const nova = await m.adicionarFotoLaudo({
        laudo_id: id,
        mime: ff.mime,
        conteudo_b64: ff.conteudo_b64,
        legenda: ff.legenda ?? null,
        ponto_id: ff.ponto_id ?? null,
      });
      adicionadas.push(nova);
    }
    res.json({ ok: true, adicionadas });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// FOTOS — get conteudo individual (binario). v3.17.4: ?download=1 forca attachment
app.get('/api/laudos-demarcacao/foto/:fotoId', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const f = await m.getFotoConteudo(String(req.params.fotoId));
    if (!f) { res.status(404).json({ error: 'Foto nao encontrada' }); return; }
    const buf = Buffer.from(f.base64, 'base64');
    res.setHeader('Content-Type', f.mime);
    if (req.query.download === '1') {
      const ext = f.mime.includes('png') ? 'png' : (f.mime.includes('webp') ? 'webp' : 'jpg');
      res.setHeader('Content-Disposition', `attachment; filename="foto-${req.params.fotoId}.${ext}"`);
    }
    res.send(buf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// FOTOS — remover
app.delete('/api/laudos-demarcacao/foto/:fotoId', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    await m.removerFotoLaudo(String(req.params.fotoId));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// FOTOS — atualizar legenda
app.put('/api/laudos-demarcacao/foto/:fotoId/legenda', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const legenda = typeof req.body?.legenda === 'string' ? req.body.legenda : '';
    await m.atualizarLegendaFoto(String(req.params.fotoId), legenda);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ─── v3.17.0: Anexos vetoriais (DXF / DWG / KML) do Laudo de Demarcação ────
// Storage no banco (LONGBLOB). Download público via /d/:token.
app.get('/api/laudos-demarcacao/:id/arquivos', async (req: Request, res: Response) => {
  try {
    const lm = await import('./integrations/laudos');
    const id = await lm.resolverLaudoId(String(req.params.id));
    const av = await import('./services/arquivosVetoriaisService');
    const rows = await av.listarArquivosVetoriais(id);
    res.json({ total: rows.length, items: rows });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/laudos-demarcacao/:id/arquivos', requireCeoToken, vectorUpload.array('arquivos', 10), async (req: Request, res: Response) => {
  try {
    const lm = await import('./integrations/laudos');
    const id = await lm.resolverLaudoId(String(req.params.id));
    const av = await import('./services/arquivosVetoriaisService');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) { res.status(400).json({ error: 'Nenhum arquivo enviado (use field "arquivos")' }); return; }
    const criados: unknown[] = [];
    const erros: Array<{ arquivo: string; erro: string }> = [];
    for (const f of files) {
      try {
        const r = await av.criarArquivoVetorial({
          laudo_id: id,
          nome_original: f.originalname,
          mime_type: f.mimetype,
          conteudo: f.buffer,
        });
        criados.push(r);
      } catch (e) {
        erros.push({ arquivo: f.originalname, erro: (e as Error).message });
      }
    }
    res.status(criados.length > 0 ? 201 : 400).json({ ok: criados.length > 0, criados, erros });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.delete('/api/laudos-demarcacao/:id/arquivos/:arquivoId', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const av = await import('./services/arquivosVetoriaisService');
    const r = await av.removerArquivoVetorial(Number(req.params.arquivoId));
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.post('/api/laudos-demarcacao/:id/arquivos/:arquivoId/regenerar-token', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const av = await import('./services/arquivosVetoriaisService');
    const r = await av.regenerarTokenArquivo(Number(req.params.arquivoId));
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.64.0 — Lista AGREGADA de anexos do laudo (read-only): PDF + croqui + recibo
// + relatórios fotográficos + fotos + arquivos avulsos numa resposta só.
// Não cria/armazena nada — só compõe as fontes existentes (ver anexosLaudoDemarcacao.ts).
// O Excluir é exposto só p/ arquivos avulsos, via DELETE /:id/arquivos/:arquivoId (acima).
app.get('/api/laudos-demarcacao/:id/anexos', async (req: Request, res: Response) => {
  try {
    const lm = await import('./integrations/laudos');
    const id = await lm.resolverLaudoId(String(req.params.id));
    const mod = await import('./services/anexosLaudoDemarcacao');
    const anexos = await mod.listarAnexosDoLaudo(id);
    res.json({ ok: true, total: anexos.length, anexos });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    res.status(e?.statusCode ?? 500).json({ ok: false, error: e?.message ?? 'Erro ao listar anexos' });
  }
});

// Rota pública de download — /d/:token (sem auth, token de 64 chars hex = 256 bits)
app.get('/d/:token', async (req: Request, res: Response) => {
  try {
    const av = await import('./services/arquivosVetoriaisService');
    const { arquivo, estado } = await av.buscarPorToken(String(req.params.token));
    if (estado === 'inexistente') { res.status(404).send('Arquivo não encontrado'); return; }
    if (estado === 'inativo')     { res.status(404).send('Arquivo removido'); return; }
    if (estado === 'expirado')    { res.status(410).send('Link de download expirado'); return; }

    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || null;
    // Best-effort: incrementa contador (não bloqueia o download se falhar)
    av.registrarDownload(arquivo.id, ip).catch(e => console.warn(`[arquivos-download] registrarDownload: ${(e as Error).message}`));

    res.setHeader('Content-Type', arquivo.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nome_original.replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(arquivo.conteudo_blob);
  } catch (err) { res.status(500).send((err as Error).message); }
});

// v2.1.0 — atualiza UM lado individualmente (medida manual + confrontante + nome do lado)
app.put('/api/laudos-demarcacao/lado/:ladoId', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const b = (req.body || {}) as { medida_manual_m?: number | null; confrontante_nome?: string | null; nome_lado?: string | null };
    await m.atualizarLado(String(req.params.ladoId), b);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v2.1.0 — atualiza UM ponto individualmente (azimute manual + descricao do marco)
app.put('/api/laudos-demarcacao/ponto/:pontoId', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const b = (req.body || {}) as { azimute_manual?: string | null; descricao_marco?: string | null };
    await m.atualizarPonto(String(req.params.pontoId), b);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v1.99.29 — Fase 5: Assina digital + serve PDF assinado
app.post('/api/laudos-demarcacao/:id/assinar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const laudosMod = await import('./integrations/laudos');
    const certsMod = await import('./services/signingCertificates');
    const pdfSignerMod = await import('./services/pdfSigner');

    // Reusa cert PJ Romatec (cadastrado em /obras → 🔒 Certs).
    // Se preferirem assinar com PF, passar { perfil: 'pf' } no body.
    const perfil = (req.body?.perfil === 'pf' ? 'pf' : 'pj') as 'pj' | 'pf';
    const cert = await certsMod.getCertForSigning(perfil);
    if (!cert) {
      res.status(400).json({ error: `Certificado digital ${perfil.toUpperCase()} nao cadastrado em /obras → Certs` });
      return;
    }

    // Gera PDF base do laudo
    const laudo = await laudosMod.buscarLaudo(id);
    if (!laudo) { res.status(404).json({ error: 'Laudo nao encontrado' }); return; }
    const contratantesMod = await import('./integrations/contratantes');
    const executantesMod = await import('./integrations/executantes');
    const contratante = await contratantesMod.buscarContratante(laudo.contratante_id);
    const executante = await executantesMod.buscarExecutante(laudo.executante_id);
    if (!contratante || !executante) { res.status(500).json({ error: 'Contratante/Executante associado nao encontrado' }); return; }

    // v3.65.0: layout que sera OFICIALMENTE assinado (PAdES). O usuario escolhe
    // no front: padrao (PDFKit) | prime1 | prime2 (puppeteer). O layout escolhido
    // e gerado JA com a marca da assinatura e PAdES-assinado de verdade.
    const tplReq = String(req.body?.template || 'padrao').toLowerCase();
    const template = (['padrao', 'prime1', 'prime2'].includes(tplReq) ? tplReq : 'padrao') as 'padrao' | 'prime1' | 'prime2';
    const agoraAssin = new Date();

    let pdfBase: Buffer;
    if (template === 'prime1' || template === 'prime2') {
      // Prime: monta a caixa ICP e gera o template puppeteer escolhido.
      const { construirLaudoDadosPrime, montarAssinaturaIcp } = await import('./services/laudoPrimeDados');
      const { gerarLaudoPdf } = await import('./pdf/laudoPdfRouter');
      const { TemplateId } = await import('./types/templateTypes');
      const assinaturaIcp = montarAssinaturaIcp(cert.meta, agoraAssin, executante.nome);
      const dados = await construirLaudoDadosPrime(id, { assinaturaIcp });
      pdfBase = await gerarLaudoPdf(dados, template === 'prime1' ? TemplateId.PRIME_I : TemplateId.PRIME_II);
    } else {
      // Padrao (PDFKit): caixa verde ICP desenhada no miolo via signatureMeta.
      const { gerarPdfLaudo } = await import('./services/laudoPdf');
      const { carregarAnexosLaudo } = await import('./services/laudoAnexos');
      const [pontos, lados, fotos, croquiUpload, anexos] = await Promise.all([
        laudosMod.listarPontosDoLaudo(id),
        laudosMod.listarLadosDoLaudo(id),
        laudosMod.listarFotosDoLaudo(id),
        laudosMod.getCroquiUpload(id),
        carregarAnexosLaudo(id),
      ]);
      const signatureVisualMeta = {
        signer_cn: cert.meta.subject_cn ?? executante.nome,
        signer_doc: cert.meta.subject_doc,
        issuer_cn: cert.meta.issuer_cn,
        validade_ate: cert.meta.validade_ate,
        data_assinatura: agoraAssin,
        thumbprint: cert.meta.thumbprint,
      };
      pdfBase = await gerarPdfLaudo({
        laudo, contratante, executante, pontos, lados,
        fotos: fotos.map(f => ({ id: f.id, mime: f.mime, legenda: f.legenda })),
        fotoBase64Loader: async (fotoId) => {
          const f = await laudosMod.getFotoConteudo(fotoId);
          return f ? { base64: f.base64, mime: f.mime } : null;
        },
        croquiUpload: croquiUpload ?? null,
        croquiCanvasPng: anexos.croquiCanvasPng,
        croquiCanvasInfo: anexos.croquiCanvasInfo,
        fotosRelatorio: anexos.fotosRelatorio,
        signatureMeta: signatureVisualMeta,
      });
    }

    // Aplica PAdES (PKCS#7 detached, ICP-Brasil)
    const pdfAssinado = await pdfSignerMod.signPdfBuffer(pdfBase, cert.pfx, cert.senha, {
      name: cert.meta.subject_cn || executante.nome,
      reason: `Laudo ${laudo.numero_laudo} — Demarcacao`,
      location: `${laudo.municipio || 'Açailândia'}/${laudo.uf_imovel || 'MA'}`,
      contactInfo: cert.meta.subject_doc || '',
    });
    await laudosMod.salvarPdfAssinado(id, pdfAssinado);
    res.json({
      ok: true,
      numero: laudo.numero_laudo,
      assinado_por: cert.meta.subject_cn,
      cert_validade: cert.meta.validade_ate,
      pdf_size_bytes: pdfAssinado.length,
      link_validacao: `${getBaseUrl()}/v/laudo/${laudo.hash_validacao}`,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// PDF assinado (gera novo se nao existe)
app.get('/api/laudos-demarcacao/:id/pdf-assinado', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const data = await m.getPdfAssinado(String(req.params.id));
    if (!data) {
      res.status(404).json({ error: 'Laudo ainda nao foi assinado' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Laudo-${data.numero}-assinado.pdf"`);
    res.send(data.pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.99.30 — Fase 6: Gerar recibo do laudo + Enviar Z-API (laudo + recibo)

// POST /:id/gerar-recibo — cria recibo universal pre-preenchido com dados do laudo
app.post('/api/laudos-demarcacao/:id/gerar-recibo', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const laudosMod = await import('./integrations/laudos');
    const cMod = await import('./integrations/contratantes');
    const recMod = await import('./integrations/recibos');

    const laudo = await laudosMod.buscarLaudo(id);
    if (!laudo) { res.status(404).json({ error: 'Laudo nao encontrado' }); return; }
    if (!laudo.valor_servico) {
      res.status(400).json({ error: 'Laudo sem valor_servico definido' });
      return;
    }
    const contratante = await cMod.buscarContratante(laudo.contratante_id);
    if (!contratante) { res.status(500).json({ error: 'Contratante nao encontrado' }); return; }
    if (!contratante.telefone) {
      res.status(400).json({ error: 'Contratante sem telefone — necessario pra envio do recibo' });
      return;
    }

    // Mapeia FormaPagamentoLaudo → FormaPagamento de recibo
    const formaPagMap: Record<string, 'pix' | 'dinheiro' | 'transferencia' | 'boleto'> = {
      PIX: 'pix', DINHEIRO: 'dinheiro', TRANSFERENCIA: 'transferencia', BOLETO: 'boleto',
    };
    const formaPagRecibo = laudo.forma_pagamento ? formaPagMap[laudo.forma_pagamento] || 'pix' : 'pix';

    const identImovel = laudo.tipo_imovel === 'URBANO'
      ? `${laudo.loteamento ? laudo.loteamento + ' — ' : ''}Quadra ${laudo.quadra || '?'} Lote ${laudo.numero_lote || '?'}`
      : laudo.denominacao_imovel || 'Imóvel rural';

    const reciboCriado = await recMod.criarRecibo({
      tenant_id: 1,
      tipo: 'custom',
      resource_type: 'laudo_demarcacao',
      resource_id: String(laudo.id),
      destinatario_nome: contratante.nome,
      destinatario_doc: contratante.cpf_cnpj,
      destinatario_phone: contratante.telefone,
      destinatario_email: contratante.email,
      valor: laudo.valor_servico,
      forma_pagamento: formaPagRecibo,
      descricao_servico: `Referente ao serviço de demarcação do imóvel: ${identImovel} — Laudo nº ${laudo.numero_laudo}`,
      categoria_servico: 'demarcacao_imovel',
      categoria_grupo: null,
      emitente_perfil: 'romatec_pj',
      expira_em_dias: 30,
    });

    // Liga recibo ao laudo
    const pool1 = (await import('./database/connection')).default;
    await pool1.execute(
      `UPDATE laudos_demarcacao SET recibo_id = ?, status = IF(status='ASSINADO','RECIBO_GERADO',status) WHERE id = ?`,
      [reciboCriado.id, laudo.id]
    );

    // v3.0.0: monta resumo INCRA pra uso no PDF do recibo (quando precificacao foi aplicada)
    const incraRecibo = (laudo.precificacao_calculada_em && laudo.valor_final != null) ? {
      faixa_aplicada:       String(laudo.faixa_aplicada ?? '—'),
      unidade_calculo:      laudo.unidade_calculo as 'km' | 'hectare' | 'lote',
      valor_base_calculado: Number(laudo.valor_base_calculado),
      desconto_tipo:        (laudo.desconto_tipo ?? 'nenhum') as 'percentual' | 'fixo' | 'nenhum',
      desconto_valor:       Number(laudo.desconto_valor ?? 0),
      valor_final:          Number(laudo.valor_final),
    } : undefined;

    res.json({
      ok: true,
      recibo_id: reciboCriado.id,
      recibo_numero: reciboCriado.numero,
      token: reciboCriado.token,
      hash: reciboCriado.hash_validacao,
      incra_aplicado: !!incraRecibo,
    });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// POST /:id/enviar-zapi — envia laudo assinado + recibo, 2 disparos sequenciais
app.post('/api/laudos-demarcacao/:id/enviar-zapi', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const laudosMod = await import('./integrations/laudos');
    const cMod = await import('./integrations/contratantes');
    const recMod = await import('./integrations/recibos');
    const wa = await import('./integrations/whatsapp');

    const laudo = await laudosMod.buscarLaudo(id);
    if (!laudo) { res.status(404).json({ error: 'Laudo nao encontrado' }); return; }
    const contratante = await cMod.buscarContratante(laudo.contratante_id);
    if (!contratante?.telefone) { res.status(400).json({ error: 'Contratante sem telefone' }); return; }
    const phoneOverride = typeof req.body?.phone_override === 'string'
      ? req.body.phone_override.replace(/\D/g, '') : '';
    const phone = phoneOverride || (contratante.telefone || '').replace(/\D/g, '');

    // 1) PDF do laudo assinado
    const pdfLaudoData = await laudosMod.getPdfAssinado(id);
    if (!pdfLaudoData) { res.status(400).json({ error: 'Laudo ainda nao foi assinado — chame /assinar antes' }); return; }

    const enviosOk: string[] = [];
    const enviosFalha: string[] = [];

    // Mensagem inicial
    try {
      const msg = `📐 *Laudo Técnico de Demarcação ${laudo.numero_laudo}*\n\n` +
        `${contratante.nome}, segue o laudo técnico assinado digitalmente.\n` +
        `🔗 Validar: ${getBaseUrl()}/v/laudo/${laudo.hash_validacao}\n\n— Romatec`;
      await wa.sendReply(phone, msg);
    } catch (err) {
      console.warn('[laudo:zapi:msg]', (err as Error).message);
    }

    // Disparo 1: laudo assinado
    try {
      await wa.sendDocument(phone, pdfLaudoData.pdf.toString('base64'), `Laudo-${laudo.numero_laudo}.pdf`);
      enviosOk.push('laudo');
    } catch (err) {
      console.error('[laudo:zapi:laudo]', (err as Error).message);
      enviosFalha.push('laudo');
    }

    // Pausa 1.2s pra ZAPI processar (primeiro disparo) antes do segundo
    await new Promise(r => setTimeout(r, 1200));

    // Disparo 2: recibo (se existe)
    if (laudo.recibo_id) {
      try {
        const recibo = await recMod.buscarReciboPorId(laudo.recibo_id);
        if (recibo) {
          const { gerarPdfRecibo } = await import('./services/reciboPdf');
          // v3.0.0: passa resumo INCRA quando laudo tem precificacao aplicada
          const incraEnvio = (laudo.precificacao_calculada_em && laudo.valor_final != null) ? {
            faixa_aplicada:       String(laudo.faixa_aplicada ?? '—'),
            unidade_calculo:      laudo.unidade_calculo as 'km' | 'hectare' | 'lote',
            valor_base_calculado: Number(laudo.valor_base_calculado),
            desconto_tipo:        (laudo.desconto_tipo ?? 'nenhum') as 'percentual' | 'fixo' | 'nenhum',
            desconto_valor:       Number(laudo.desconto_valor ?? 0),
            valor_final:          Number(laudo.valor_final),
          } : undefined;
          const pdfRecibo = await gerarPdfRecibo(recibo, undefined, incraEnvio);
          await wa.sendDocument(phone, pdfRecibo.toString('base64'), `Recibo-${recibo.numero}.pdf`);
          enviosOk.push('recibo');
          // Marca recibo como enviado
          await recMod.marcarEvento(recibo.id, 'enviado').catch(() => {});
        }
      } catch (err) {
        console.error('[laudo:zapi:recibo]', (err as Error).message);
        enviosFalha.push('recibo');
      }
    }

    // Atualiza status do laudo
    const pool2 = (await import('./database/connection')).default;
    await pool2.execute(
      `UPDATE laudos_demarcacao
         SET status = 'ENVIADO', zapi_enviado_em = NOW()
       WHERE id = ?`,
      [laudo.id]
    );

    res.json({
      ok: enviosFalha.length === 0,
      enviado_pra: phone,
      envios: { ok: enviosOk, falha: enviosFalha },
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.5.0: envio do laudo assinado via Telegram. chatId opcional no body.
app.post('/api/laudos-demarcacao/:id/enviar-telegram', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const chatIdOverride = typeof req.body?.chat_id === 'string' ? req.body.chat_id : undefined;
    const m = await import('./integrations/laudos');
    const result = await m.enviarLaudoTelegram({ id, chatId: chatIdOverride });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Pagina publica de validacao /v/laudo/:hash
app.get('/v/laudo/:hash', async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/laudos');
    const cMod = await import('./integrations/contratantes');
    const eMod = await import('./integrations/executantes');
    const laudo = await m.buscarLaudoPorHash(String(req.params.hash));
    if (!laudo) {
      res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`
        <!doctype html><html lang=pt-br><head><meta charset=utf-8>
        <title>Laudo nao encontrado</title>
        <style>body{font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px;background:#fff8f8}
        .x{background:#fee;border:1px solid #fcc;padding:20px;border-radius:8px;text-align:center}</style>
        </head><body><div class=x><h1>❌ Laudo não encontrado</h1>
        <p>Hash inválido ou laudo removido.</p></div></body></html>
      `);
      return;
    }
    const contratante = await cMod.buscarContratante(laudo.contratante_id);
    const executante = await eMod.buscarExecutante(laudo.executante_id);
    const fmtBR = (n: number | null): string => n != null
      ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
      : '—';
    const statusCor = laudo.status === 'CONFIRMADO' ? '#10b981'
                    : laudo.status === 'CANCELADO' ? '#ef4444'
                    : laudo.status === 'ASSINADO' || laudo.status === 'ENVIADO' ? '#3b82f6'
                    : '#6b7280';
    const statusEmoji = laudo.status === 'CONFIRMADO' ? '✓'
                      : laudo.status === 'CANCELADO' ? '✗'
                      : laudo.status === 'ASSINADO' ? '🔏'
                      : laudo.status === 'ENVIADO' ? '📤'
                      : '📋';
    res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang=pt-br>
<head>
<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Laudo ${laudo.numero_laudo} — Romatec</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f5f5f0;color:#222}
.card{background:#fff;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.05)}
h1{margin:0 0 8px;font-size:24px;color:#1F5C3A}
.sub{color:#666;font-size:14px;margin-bottom:16px}
.badge{display:inline-block;background:${statusCor};color:#fff;padding:4px 12px;border-radius:14px;font-weight:600;font-size:12px;margin-left:6px}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
.row:last-child{border-bottom:0}
.label{color:#888;font-size:13px}.value{font-weight:500}
.dest{background:#1F5C3A;color:#fff;padding:24px;border-radius:12px;margin-bottom:16px;text-align:center}
.dest h2{margin:0 0 4px;font-size:28px}.dest p{margin:0;font-size:13px;opacity:0.9}
.btn{display:inline-block;background:#1F5C3A;color:#fff!important;text-decoration:none;padding:12px 20px;border-radius:8px;margin-top:8px}
</style>
</head>
<body>
<div class=dest>
  <h2>📐 Laudo Técnico de Demarcação</h2>
  <p>Romatec Consultoria Imobiliária</p>
</div>
<div class=card>
  <h1>${laudo.numero_laudo} <span class=badge>${statusEmoji} ${laudo.status}</span></h1>
  <p class=sub>Documento autenticado pelo Romatec — hash SHA-256 verificado</p>
  <div class=row><span class=label>Tipo de imóvel</span><span class=value>${laudo.tipo_imovel}</span></div>
  ${contratante ? `<div class=row><span class=label>Contratante</span><span class=value>${contratante.nome}</span></div>` : ''}
  ${executante ? `<div class=row><span class=label>Executante</span><span class=value>${executante.nome}${executante.registro_cft ? ` · CFT ${executante.registro_cft}` : ''}</span></div>` : ''}
  ${laudo.area_total_m2 ? `<div class=row><span class=label>Área total</span><span class=value>${fmtBR(laudo.area_total_m2)} m²</span></div>` : ''}
  ${laudo.perimetro_m ? `<div class=row><span class=label>Perímetro</span><span class=value>${fmtBR(laudo.perimetro_m)} m</span></div>` : ''}
  ${laudo.municipio ? `<div class=row><span class=label>Município</span><span class=value>${laudo.municipio}/${laudo.uf_imovel || ''}</span></div>` : ''}
  ${laudo.assinado_em ? `<div class=row><span class=label>Assinado digitalmente em</span><span class=value>${new Date(laudo.assinado_em).toLocaleString('pt-BR')}</span></div>` : ''}
  <div class=row><span class=label>Emitido em</span><span class=value>${new Date(laudo.created_at).toLocaleString('pt-BR')}</span></div>
</div>
<div style="text-align:center"><a class=btn href="/api/laudos-demarcacao/${laudo.id}/pdf-assinado">📄 Baixar PDF assinado</a></div>
<p style="text-align:center;color:#888;font-size:11px;margin-top:16px">Documento validado pelo sistema Romatec — para questionar autenticidade entre em contato (99) 99181-1246.</p>
</body></html>`);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.99.28 — Fase 4: PDF do Laudo (memorial NTGIR, croqui, fotos)
app.get('/api/laudos-demarcacao/:id/pdf', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const laudosMod = await import('./integrations/laudos');
    const contratantesMod = await import('./integrations/contratantes');
    const executantesMod = await import('./integrations/executantes');
    const { gerarPdfLaudo } = await import('./services/laudoPdf');

    const laudo = await laudosMod.buscarLaudo(id);
    if (!laudo) { res.status(404).json({ error: 'Laudo nao encontrado' }); return; }
    const contratante = await contratantesMod.buscarContratante(laudo.contratante_id);
    if (!contratante) { res.status(500).json({ error: 'Contratante associado nao encontrado' }); return; }
    const executante = await executantesMod.buscarExecutante(laudo.executante_id);
    if (!executante) { res.status(500).json({ error: 'Executante associado nao encontrado' }); return; }

    const { carregarAnexosLaudo } = await import('./services/laudoAnexos');
    const [pontos, lados, fotos, croquiUpload, anexos] = await Promise.all([
      laudosMod.listarPontosDoLaudo(id),
      laudosMod.listarLadosDoLaudo(id),
      laudosMod.listarFotosDoLaudo(id),
      laudosMod.getCroquiUpload(id),
      carregarAnexosLaudo(id),
    ]);

    const pdf = await gerarPdfLaudo({
      laudo, contratante, executante, pontos, lados,
      fotos: fotos.map(f => ({ id: f.id, mime: f.mime, legenda: f.legenda })),
      fotoBase64Loader: async (fotoId) => {
        const f = await laudosMod.getFotoConteudo(fotoId);
        if (!f) return null;
        return { base64: f.base64, mime: f.mime };
      },
      croquiUpload: croquiUpload ?? null,
      croquiCanvasPng: anexos.croquiCanvasPng,
      croquiCanvasInfo: anexos.croquiCanvasInfo,
      fotosRelatorio: anexos.fotosRelatorio,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Laudo-${laudo.numero_laudo}.pdf"`);
    res.send(pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// ─── v1.99.3: Certificados Digitais ICP-Brasil ─────────────────────────────
// GET — lista certs cadastrados (sem expor pfx/senha)
app.get('/api/signing-cert', async (_req: Request, res: Response) => {
  try {
    const certs = await listSigningCerts(1);
    res.json(certs);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// POST — upload de novo cert (.pfx + senha + perfil + label)
// multipart/form-data: file=pfx, fields=senha,perfil,label
app.post('/api/signing-cert', requireCeoToken, upload.single('pfx'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Arquivo .pfx obrigatorio (campo file=pfx)' });
      return;
    }
    const { senha, perfil, label } = req.body || {};
    const cert = await uploadSigningCert({
      tenant_id: 1,
      pfx: req.file.buffer,
      senha: String(senha || ''),
      perfil: (String(perfil || 'pj').toLowerCase() === 'pf' ? 'pf' : 'pj'),
      label: String(label || req.file.originalname || 'Certificado'),
    });
    res.json(cert);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.delete('/api/signing-cert/:id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    await deleteSigningCert(Number(String(req.params.id)), 1);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.post('/api/signing-cert/:id/ativar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const cert = await setSigningCertAtivo(Number(String(req.params.id)), true, 1);
    res.json(cert);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.post('/api/signing-cert/:id/desativar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const cert = await setSigningCertAtivo(Number(String(req.params.id)), false, 1);
    res.json(cert);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ─── Assinatura digital de Recibos ─────────────────────────────────────────
// POST — assina recibo (gera PDF + aplica PAdES + salva no banco)
app.post('/api/recibos/:id/assinar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const result = await assinarReciboPades(String(req.params.id));
    res.json(result);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// GET — status (assinado? quando? por qual cert?) sem retornar o blob
app.get('/api/recibos/:id/assinatura-status', async (req: Request, res: Response) => {
  try {
    const st = await getStatusAssinatura(String(req.params.id));
    res.json(st);
  } catch (err) { res.status(404).json({ error: (err as Error).message }); }
});

// GET — baixa o PDF assinado (Buffer). Inline pra abrir no browser.
app.get('/api/recibos/:id/pdf-assinado', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = await getReciboPdfAssinado(id);
    if (!data) {
      res.status(404).json({ error: 'Recibo ainda nao foi assinado' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="recibo-${id}-assinado.pdf"`);
    res.send(data.pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/notas-fiscais',
  apiHandle(args => notasFiscais.listarNotasFiscais(args as Parameters<typeof notasFiscais.listarNotasFiscais>[0])));
app.get('/api/notas-fiscais/:id',
  apiHandle(args => notasFiscais.buscarNotaFiscal((args as { id: string }).id)));
app.post('/api/notas-fiscais',
  apiHandle(args => notasFiscais.criarRascunhoNF(args as Parameters<typeof notasFiscais.criarRascunhoNF>[0])));
app.post('/api/notas-fiscais/:id/emitir',
  apiHandle(async args => notasFiscais.enviarNFParaProvider((args as { id: string }).id)));
// v3.50.0: cancelar NF emitida requer PIN (admin/owner bypass)
app.post('/api/notas-fiscais/:id/cancelar', requireAuth, requirePin,
  apiHandle(async args => {
    const a = args as { id: string; motivo?: string };
    if (!a.motivo?.trim()) throw new Error('motivo obrigatorio pra cancelar');
    return notasFiscais.cancelarNotaFiscal(a.id, a.motivo);
  }));

// v1.82.0: enviar PDF da NF via WhatsApp/Telegram
app.post('/api/notas-fiscais/:id/enviar-whatsapp', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const tel = String(req.body?.telefone || '').replace(/\D/g, '');
    if (tel.length < 10) return res.status(400).json({ error: 'telefone obrigatorio' });
    const nf = await notasFiscais.buscarNotaFiscal(id);
    if (!nf.pdf_url) return res.status(400).json({ error: 'NF ainda nao tem PDF (status: ' + nf.status + ')' });
    const axios = (await import('axios')).default;
    const r = await axios.get(nf.pdf_url, { responseType: 'arraybuffer', timeout: 30000 });
    const pdfBuf = Buffer.from(r.data);
    const wpp = await import('./integrations/whatsapp');
    const phone = tel.startsWith('55') ? tel : `55${tel}`;
    const fileName = `NF_${nf.numero || nf.rps_numero}.pdf`;
    const sent = await wpp.sendDocument(phone, pdfBuf.toString('base64'), fileName);
    res.json({ ok: true, message: `NF enviada para ${sent.phone}.`, messageId: sent.messageId });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.post('/api/notas-fiscais/:id/enviar-telegram', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const nf = await notasFiscais.buscarNotaFiscal(id);
    if (!nf.pdf_url) return res.status(400).json({ error: 'NF ainda nao tem PDF (status: ' + nf.status + ')' });
    const axios = (await import('axios')).default;
    const r = await axios.get(nf.pdf_url, { responseType: 'arraybuffer', timeout: 30000 });
    const pdfBuf = Buffer.from(r.data);
    const tg = await import('./integrations/telegram');
    const chatId = String(req.body?.chatId || '').trim()
      || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
      || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
    if (!chatId) return res.status(400).json({ error: 'chatId Telegram obrigatorio' });
    const fileName = `NF_${nf.numero || nf.rps_numero}.pdf`;
    await tg.sendDocument(chatId, pdfBuf, fileName, `NF ${nf.numero || 'RPS ' + nf.rps_numero} — ${nf.tomador_nome}`);
    res.json({ ok: true, message: 'NF enviada via Telegram.' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.delete('/api/notas-fiscais/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const nf = await notasFiscais.buscarNotaFiscal(id);
    if (!['rascunho', 'rejeitada'].includes(nf.status)) {
      return res.status(400).json({ error: `Nao pode excluir NF status='${nf.status}'. Use cancelar.` });
    }
    const m = await import('./database/connection');
    await m.default.execute('DELETE FROM notas_fiscais WHERE id = ?', [id]);
    res.json({ ok: true, message: `NF #${id} excluida.` });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// Webhook NFe.io — recebe atualizacao quando prefeitura processa
app.post('/webhook/nfeio', async (req: Request, res: Response) => {
  res.json({ ok: true }); // ack imediato
  try {
    const body = req.body as Record<string, unknown>;
    const provider_id = String(body.id || (body.serviceInvoice as Record<string, unknown>)?.id || '');
    if (!provider_id) {
      console.warn('[webhook nfeio] sem provider_id no payload');
      return;
    }
    const data = (body.serviceInvoice as Record<string, unknown>) || body;
    await notasFiscais.aplicarAtualizacaoProvider(provider_id, {
      status: data.status as string,
      number: data.number as string,
      pdfUrl: data.pdfUrl as string,
      xmlUrl: data.xmlUrl as string,
      checkCode: data.checkCode as string,
      flowMessage: data.flowMessage as string,
      issuedOn: data.issuedOn as string,
      cancelledOn: data.cancelledOn as string,
    });
    console.log(`[webhook nfeio] NF ${provider_id} -> ${data.status}`);
  } catch (err) {
    console.error('[webhook nfeio] erro:', (err as Error).message);
  }
});

// ── v1.70.0: Recibos Universais ─────────────────────────────────────────
// API autenticada (CRUD + envio) + paginas publicas /r/:token e /v/:hash
// v1.73.0: configuracao de triggers automaticos
app.get   ('/api/recibos/triggers', async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosTriggers');
    res.json(await m.getTodosTriggers(1));
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
app.put   ('/api/recibos/triggers/:evento', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/recibosTriggers');
    await m.setTriggerConfig(1,
      String(req.params.evento) as Parameters<typeof m.setTriggerConfig>[1],
      req.body || {}
    );
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.get   ('/api/recibos',
  apiHandle(args => recibos.listarRecibos(args as Parameters<typeof recibos.listarRecibos>[0])));
app.get   ('/api/recibos/:id',
  apiHandle(args => recibos.buscarReciboPorId((args as { id: string }).id)));
app.get   ('/api/recibos/:id/eventos',
  apiHandle(args => recibos.listarEventos((args as { id: string }).id)));
app.post  ('/api/recibos',
  apiHandle(args => recibos.criarRecibo(args as Parameters<typeof recibos.criarRecibo>[0])));
app.post  ('/api/recibos/:id/enviar',
  apiHandle(args => recibos.enviarReciboWhatsApp(args as Parameters<typeof recibos.enviarReciboWhatsApp>[0])));
app.post  ('/api/recibos/:id/reenviar',
  apiHandle(async args => {
    await recibos.reenviarRecibo((args as { id: string }).id);
    return { ok: true };
  }));
// v3.50.0: cancelar recibo (incluindo confirmado/NF emitida) — requer PIN
app.post  ('/api/recibos/:id/cancelar', requireAuth, requirePin,
  apiHandle(async args => {
    const a = args as { id: string; motivo?: string };
    await recibos.cancelarRecibo(a.id, a.motivo);
    return { ok: true };
  }));

// v1.82.0: enviar PDF do recibo via Telegram (WhatsApp ja existe via /enviar)
app.post('/api/recibos/:id/enviar-telegram', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const r = await recibos.buscarReciboPorId(id);
    const { gerarPdfRecibo } = await import('./services/reciboPdf');
    const pdfBuf = await gerarPdfRecibo(r);
    const tg = await import('./integrations/telegram');
    const chatId = String(req.body?.chatId || '').trim()
      || (process.env.TELEGRAM_LEAD_CHAT_ID || '').trim()
      || (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
    if (!chatId) return res.status(400).json({ error: 'chatId Telegram obrigatorio' });
    const fileName = `${r.numero}.pdf`;
    await tg.sendDocument(chatId, pdfBuf, fileName, `Recibo ${r.numero} — ${r.destinatario_nome}`);
    res.json({ ok: true, message: 'Recibo enviado via Telegram.' });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.50.0: exclusao de recibo requer PIN (admin/owner bypass)
app.delete('/api/recibos/:id', requireAuth, requirePin, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const r = await recibos.buscarReciboPorId(id);
    if (r.status === 'confirmado') {
      return res.status(400).json({ error: 'Recibo confirmado nao pode ser excluido (LGPD).' });
    }
    const m = await import('./database/connection');
    await m.default.execute('DELETE FROM recibos WHERE id = ?', [id]);
    res.json({ ok: true, message: `Recibo ${r.numero} excluido.` });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// PUT pra editar recibo em rascunho/aguardando_envio
app.put('/api/recibos/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const r = await recibos.buscarReciboPorId(id);
    if (!['rascunho', 'aguardando_envio'].includes(r.status)) {
      return res.status(400).json({ error: `Nao pode editar — status='${r.status}'.` });
    }
    const b = req.body || {};
    const fields: string[] = [];
    const params: (string | number | null)[] = [];
    // v1.89.0: status_force permite transicionar 'rascunho' -> 'aguardando_envio'
    // (botao "Salvar sem enviar"). So aceita transicao especifica, sem pular etapas.
    if (b.status_force === 'aguardando_envio' && r.status === 'rascunho') {
      fields.push('status = ?');
      params.push('aguardando_envio');
    }
    const allow = ['destinatario_nome', 'destinatario_doc', 'destinatario_phone',
                   'destinatario_email', 'valor', 'forma_pagamento',
                   'descricao_servico'];
    for (const k of allow) {
      if (b[k] !== undefined) {
        fields.push(`${k} = ?`);
        const v = b[k];
        if (k === 'destinatario_phone') {
          const tel = String(v).replace(/\D/g, '');
          params.push(tel.startsWith('55') ? tel : `55${tel}`);
        } else if (k === 'destinatario_doc') {
          params.push(v ? String(v).replace(/\D/g, '') : null);
        } else {
          params.push(v == null ? null : v);
        }
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'nada pra atualizar' });
    params.push(id);
    const m = await import('./database/connection');
    await m.default.execute(
      `UPDATE recibos SET ${fields.join(', ')} WHERE id = ?`, params
    );
    res.json({ ok: true, message: `Recibo ${r.numero} atualizado.` });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
// v1.89.0: PDF preview SEM persistir — pra modal de confirmacao
app.post('/api/recibos/preview-pdf', async (req: Request, res: Response) => {
  try {
    const { gerarPdfReciboPreview } = await import('./services/reciboPdf');
    const buf = await gerarPdfReciboPreview(req.body || {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get   ('/api/recibos/:id/pdf', async (req: Request, res: Response) => {
  try {
    const r = await recibos.buscarReciboPorId(String(req.params.id));
    const buf = await gerarPdfRecibo(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.numero}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ─── v3.49.0: anexos do recibo (PDF/imagem) ─────────────────────────────────
// CCIR antigo/atualizado, ITR/NIRF, recibo CAR — documentos complementares
// enviados junto ao PDF principal via WhatsApp.
const RECIBO_ANEXO_MAX_BYTES = 10 * 1024 * 1024;
const RECIBO_ANEXO_MAX_FILES = 5;
const RECIBO_ANEXO_MIMES = new Set([
  'application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
]);
const RECIBO_ANEXO_EXTS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

const uploadReciboAnexoMulter = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: RECIBO_ANEXO_MAX_BYTES,
    files: RECIBO_ANEXO_MAX_FILES,
  },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    const extOk = RECIBO_ANEXO_EXTS.has(ext);
    const mimeOk = RECIBO_ANEXO_MIMES.has(mime) || mime === 'application/octet-stream' || mime === '';
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error(`Arquivo invalido: ${file.originalname} (${file.mimetype}). Aceitos: PDF, JPG, PNG, WebP.`));
  },
}).array('files', RECIBO_ANEXO_MAX_FILES);

// POST /api/recibos/:id/anexos — upload de 1..5 arquivos via multipart/form-data
// Campos: files[] (binarios) + descricoes[] (array opcional de labels, mesmo indice)
app.post('/api/recibos/:id/anexos', requireCeoToken, (req: Request, res: Response) => {
  uploadReciboAnexoMulter(req, res, async (uploadErr: unknown) => {
    try {
      if (uploadErr) {
        const m = (uploadErr as Error).message || 'Falha no upload';
        return res.status(400).json({ error: m });
      }
      const files = (req.files as Express.Multer.File[] | undefined) || [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado (campo "files" obrigatorio)' });
      }
      // descricoes pode vir como string (1 item) ou array (N itens)
      const rawDesc = (req.body?.descricoes ?? req.body?.['descricoes[]']) as string | string[] | undefined;
      const descricoes: Array<string | null> = Array.isArray(rawDesc)
        ? rawDesc.map(d => (d ? String(d) : null))
        : rawDesc ? [String(rawDesc)] : [];

      const reciboAnexos = await import('./integrations/recibosAnexos');
      const reciboId = Number(req.params.id);
      const criados: import('./integrations/recibosAnexos').AnexoReciboResumo[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const anexo = await reciboAnexos.criarAnexo({
          recibo_id: reciboId,
          nome_original: f.originalname,
          mime_type: f.mimetype,
          conteudo: f.buffer,
          descricao: descricoes[i] ?? null,
        });
        criados.push(anexo);
      }
      res.json({ ok: true, anexos: criados });
    } catch (err) {
      const msg = (err as Error).message || 'Erro ao salvar anexo';
      const status = /nao encontrado/i.test(msg) ? 404
                   : /maximo|excede|invalida|invalido/i.test(msg) ? 400
                   : 500;
      res.status(status).json({ error: msg });
    }
  });
});

// GET /api/recibos/:id/anexos — lista os anexos ativos do recibo (sem blob)
app.get('/api/recibos/:id/anexos', async (req: Request, res: Response) => {
  try {
    const reciboAnexos = await import('./integrations/recibosAnexos');
    const anexos = await reciboAnexos.listarAnexos(Number(req.params.id));
    res.json(anexos);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// GET /api/recibos/anexos/:anexo_id/download — download autenticado (CEO)
app.get('/api/recibos/anexos/:anexo_id/download', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const reciboAnexos = await import('./integrations/recibosAnexos');
    const anexo = await reciboAnexos.buscarAnexoParaDownload(Number(req.params.anexo_id));
    if (!anexo) return res.status(404).json({ error: 'Anexo nao encontrado' });
    res.setHeader('Content-Type', anexo.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(anexo.tamanho_bytes));
    res.setHeader('Content-Disposition',
      `attachment; filename="${anexo.nome_original.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.send(anexo.conteudo_blob);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /a/:token — download publico via token (link compartilhavel)
app.get('/a/:token', async (req: Request, res: Response) => {
  try {
    const reciboAnexos = await import('./integrations/recibosAnexos');
    const anexo = await reciboAnexos.buscarAnexoPorToken(String(req.params.token));
    if (!anexo) return res.status(404).send('Anexo nao encontrado ou removido.');
    res.setHeader('Content-Type', anexo.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(anexo.tamanho_bytes));
    res.setHeader('Content-Disposition',
      `inline; filename="${anexo.nome_original.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.send(anexo.conteudo_blob);
  } catch (err) {
    res.status(500).send('Erro: ' + (err as Error).message);
  }
});

// DELETE /api/recibos/anexos/:anexo_id — soft delete (CEO)
app.delete('/api/recibos/anexos/:anexo_id', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const reciboAnexos = await import('./integrations/recibosAnexos');
    const r = await reciboAnexos.removerAnexo(Number(req.params.anexo_id));
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Paginas publicas de resposta (sem auth, token-based) ────────────────
// /r/:token → form mobile pra destinatario confirmar/contestar
app.get('/r/:token', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'recibo-responder.html'));
});

app.get('/r/:token/json', async (req: Request, res: Response) => {
  try {
    const r = await recibos.buscarReciboPorToken(String(req.params.token));
    if (!r) return res.status(404).json({ error: 'Recibo nao encontrado' });
    const tenant = await getTenantSettings(r.tenant_id).catch(() => null);
    res.json({
      recibo: r,
      tenant: tenant ? {
        brand_name: tenant.brand_name,
        primary_color: tenant.primary_color,
        cnpj: tenant.cnpj,
        logo_url: tenant.logo_path
          ? `/public/${tenant.logo_path.replace(/^\/?(public\/)?/, '')}`
          : null,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/r/:token/pdf', async (req: Request, res: Response) => {
  try {
    const r = await recibos.buscarReciboPorToken(String(req.params.token));
    if (!r) return res.status(404).json({ error: 'Recibo nao encontrado' });
    const buf = await gerarPdfRecibo(r);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.numero}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

app.post('/r/:token/responder', async (req: Request, res: Response) => {
  try {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            || req.socket.remoteAddress || '';
    const ua = String(req.headers['user-agent'] || '');
    const r = await recibos.responderRecibo({
      token: String(req.params.token),
      acao: (req.body?.acao || '') as 'confirma' | 'contesta' | 'recebido' | 'pix',
      obs: req.body?.obs,
      foto_url: req.body?.foto_url,
      lat: req.body?.lat,
      lng: req.body?.lng,
      ip,
      user_agent: ua,
    });
    res.json({ ok: true, recibo: r });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// /v/:hash → pagina de validacao publica permanente (escaneou QR)
app.get('/v/:hash', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'recibo-validar.html'));
});

app.get('/v/:hash/json', async (req: Request, res: Response) => {
  try {
    const hash = String(req.params.hash);
    // Tenta recibo primeiro (compat legado)
    const r = await recibos.buscarReciboPorHash(hash);
    if (r) {
      const tenant = await getTenantSettings(r.tenant_id).catch(() => null);
      return res.json({
        tipo: 'recibo',
        recibo: r,
        tenant: tenant ? {
          brand_name: tenant.brand_name,
          primary_color: tenant.primary_color,
          cnpj: tenant.cnpj,
          logo_url: tenant.logo_path
            ? `/public/${tenant.logo_path.replace(/^\/?(public\/)?/, '')}`
            : null,
        } : null,
      });
    }
    // v1.99.17: fallback para propostas (consultoria)
    const p = await propostasConsultoria.buscarPropostaPorHash(hash);
    if (p) {
      const tenant = await getTenantSettings(1).catch(() => null);
      return res.json({
        tipo: 'proposta',
        proposta: p,
        tenant: tenant ? {
          brand_name: tenant.brand_name,
          primary_color: tenant.primary_color,
          cnpj: tenant.cnpj,
          logo_url: tenant.logo_path
            ? `/public/${tenant.logo_path.replace(/^\/?(public\/)?/, '')}`
            : null,
        } : null,
      });
    }
    return res.status(404).json({ error: 'Hash invalido' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/v/:hash/pdf', async (req: Request, res: Response) => {
  try {
    const hash = String(req.params.hash);
    // Tenta recibo primeiro
    const r = await recibos.buscarReciboPorHash(hash);
    if (r) {
      const buf = await gerarPdfRecibo(r);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${r.numero}.pdf"`);
      return res.send(buf);
    }
    // v1.99.17: fallback para proposta — serve PDF completo (proposta + anexos).
    // v3.23.7-9: experimento serviu so a proposta principal — CEO pediu reverter
    // em v3.23.10. Cliente externo/cartorio prefere um arquivo unico.
    const p = await propostasConsultoria.buscarPropostaPorHash(hash);
    if (p) {
      const buf = await propostasConsultoria.gerarPdfPropostaConsultoriaComAnexos(p.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${p.numero}.pdf"`);
      return res.send(buf);
    }
    return res.status(404).json({ error: 'Hash invalido' });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

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

// v3.63.0: Pontos / Croqui da Proposta de Demarcação (Fase 1c).
// Mesmo padrão aberto das demais rotas de proposta (apiHandle não exige auth).
app.put('/api/propostas-consultoria/:id/pontos', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ ok: false, error: 'id inválido' }); return; }
    const m = await import('./services/propostaCroqui');
    const r = await m.salvarPontos(id, (req.body?.pontos ?? []) as Parameters<typeof m.salvarPontos>[1]);
    res.json({ ok: true, ...r });
  } catch (err) { res.status(400).json({ ok: false, error: (err as Error).message }); }
});

app.get('/api/propostas-consultoria/:id/pontos', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ ok: false, error: 'id inválido' }); return; }
    const m = await import('./services/propostaCroqui');
    const r = await m.obterPontos(id);
    res.json({ ok: true, ...r });
  } catch (err) { res.status(500).json({ ok: false, error: (err as Error).message }); }
});

app.put('/api/propostas-consultoria/:id/alinhamento', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ ok: false, error: 'id inválido' }); return; }
    const ladosOrdem = Array.isArray(req.body?.ladosOrdem) ? req.body.ladosOrdem.map(Number) : [];
    const m = await import('./services/propostaCroqui');
    const r = await m.definirAlinhamento(id, ladosOrdem);
    res.json({ ok: true, ...r });
  } catch (err) { res.status(400).json({ ok: false, error: (err as Error).message }); }
});

// v3.63.0: parse da coletora (CSV/TXT/KML/GPX) — reusa o motor do laudo.
// Stateless: front manda o texto, recebe os pontos pra tabela.
app.post('/api/propostas-consultoria/coletora/parse', async (req: Request, res: Response) => {
  try {
    const texto = String(req.body?.texto ?? '');
    if (!texto.trim()) { res.status(400).json({ ok: false, error: 'texto vazio' }); return; }
    const m = await import('./services/propostaCroqui');
    const pontos = m.parseColetora(texto, req.body?.formato);
    res.json({ ok: true, pontos });
  } catch (err) { res.status(400).json({ ok: false, error: (err as Error).message }); }
});

// v3.63.0: gera o SVG do croqui a partir dos pontos (preview ao vivo no front).
app.post('/api/propostas-consultoria/croqui-svg', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const pontos = Array.isArray(b.pontos) ? b.pontos : [];
    const m = await import('./services/propostaCroqui');
    const svg = m.gerarSvgProposta(pontos as Parameters<typeof m.gerarSvgProposta>[0], {
      larguraPx: b.larguraPx, alturaPx: b.alturaPx,
      tipoImovel: b.tipoImovel, areaTotalM2: b.areaTotalM2,
      destacarLados: Array.isArray(b.destacarLados) ? b.destacarLados.map(Number) : undefined,
      tituloDestaque: b.tituloDestaque,
    });
    res.type('image/svg+xml').send(svg);
  } catch (err) { res.status(400).json({ ok: false, error: (err as Error).message }); }
});

// §4.4: importar pontos+lados (com flag alinhar) da proposta pro laudo.
app.post('/api/laudos-demarcacao/:laudoId/importar-proposta/:propostaId', async (req: Request, res: Response) => {
  try {
    const laudoId = Number(req.params.laudoId);
    const propostaId = Number(req.params.propostaId);
    if (!Number.isFinite(laudoId) || !Number.isFinite(propostaId)) {
      res.status(400).json({ ok: false, error: 'ids inválidos' }); return;
    }
    const sobrescrever = String(req.query.sobrescrever || '') === '1';
    const m = await import('./services/propostaCroqui');
    const r = await m.importarPontosParaLaudo(laudoId, propostaId, sobrescrever);
    res.json({ ok: true, ...r });
  } catch (err) {
    const code = (err as { code?: number }).code === 409 ? 409 : 400;
    res.status(code).json({ ok: false, error: (err as Error).message });
  }
});

// v3.45.0: preview ao vivo via PDF binario em iframe (mesmo padrao do recibo).
// Body: { subtipo, dados_imovel, cliente?, endereco_imovel?, validade_dias?, adicional_campo?, ... }
// Retorna application/pdf. Tolera campos parciais (placeholders).
app.post('/api/propostas-consultoria/preview-pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const buf = await propostasConsultoria.gerarPdfPropostaConsultoriaPreview(req.body || {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    console.error('[preview-pdf-proposta]', (err as Error).message);
    res.status(500).json({ error: 'Falha gerar preview', detail: (err as Error).message });
  }
});

// v3.24.8: Catalogo de comodos do Programa de Necessidades (Projeto Executivo).
// Publico (so leitura de constante TS), serve pro front montar tags clicaveis.
app.get('/api/propostas-consultoria/projeto-executivo/comodos-catalogo', (_req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('./constants/comodosEdificacao');
  res.json({
    categorias: m.CATEGORIAS_LABEL,
    comodos: m.COMODOS_CATALOGO,
    ordem_categorias: m.ORDEM_CATEGORIAS,
  });
});
app.get   ('/api/propostas-consultoria/:id/pdf', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // Historico do default deste endpoint:
    //   v1.66.9: default era COMPLETO (merge proposta + anexos);  ?somente_principal=1 opt-out
    //   v3.23.7: default invertido pra SO A PROPOSTA;             ?incluir_anexos=1 opt-in
    //   v3.23.10: CEO pediu pra REVERTER ao default v1.66.9 — anexos JUNTOS no PDF.
    //     Razao: cartorio/INCRA/cliente final preferem 1 arquivo unico do que multiplos
    //     anexos avulsos. ?sem_anexos=1 e' o opt-out pra quem quer so a proposta enxuta.
    //     Compat: ?somente_principal=1 (antigo) e ?incluir_anexos=1 (transient v3.23.7-9)
    //     tambem sao aceitos. somente_principal=1 e sem_anexos=1 sao sinonimos.
    const semAnexos = req.query.sem_anexos === '1' || req.query.somente_principal === '1';
    // ?incluir_anexos=1 ainda funciona como opt-in explicito (caso alguem dependa)
    const incluirExplicito = req.query.incluir_anexos === '1';
    const incluirAnexos = incluirExplicito || !semAnexos;
    const buf = incluirAnexos
      ? await propostasConsultoria.gerarPdfPropostaConsultoriaComAnexos(id)
      : await propostasConsultoria.gerarPdfPropostaConsultoria(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Proposta_Consultoria_${id}.pdf"`);
    res.send(buf);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// v1.99.11: Assinatura digital ICP-Brasil de propostas
// v3.23.9: aceita body.perfil ('pj' | 'pf') pra escolher qual cert usar. Default 'pj'.
app.post('/api/propostas-consultoria/:id/assinar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as { perfil?: 'pj' | 'pf'; tipo_certificado?: 'pj' | 'pf' | 'e_cnpj' | 'e_cpf' };
    // Aceita tanto perfil quanto tipo_certificado (alias) pra compat com clients diferentes.
    // Tambem traduz e_cnpj/e_cpf (nomes alternativos do brief) pra pj/pf (nomes internos).
    const rawPerfil = body.perfil ?? body.tipo_certificado ?? 'pj';
    const perfil: 'pj' | 'pf' =
      rawPerfil === 'pf' || rawPerfil === 'e_cpf' ? 'pf' : 'pj';
    const result = await propostasConsultoria.assinarProposta(String(req.params.id), perfil);
    res.json(result);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.get('/api/propostas-consultoria/:id/pdf-assinado', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const data = await propostasConsultoria.getPropostaPdfAssinado(id);
    if (!data) { res.status(404).json({ error: 'Proposta ainda nao foi assinada' }); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Proposta_${id}_assinada.pdf"`);
    res.send(data.pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v1.66.9: anexos da proposta (Planta Arquitetonica/Mapa — PDF/PNG/JPEG)
// v3.24.13 FIX: o front manda multipart/form-data com `arquivo` (FormData), mas
// o endpoint antigo so aceitava JSON body com `conteudo_b64`. Como o Express
// body-parser nao parsea FormData como JSON, os anexos NUNCA chegavam ao banco.
// Agora aceita 2 caminhos:
//   1. multipart/form-data + field 'arquivo' (preferido pelo front)
//   2. JSON body { filename, mimetype, conteudo_b64 } (legacy, retrocompat)
app.get   ('/api/propostas-consultoria/:id/anexos',
  apiHandle(args => propostasConsultoria.listarAnexosProposta({ proposta_id: (args as { id: string }).id })));
app.post  ('/api/propostas-consultoria/:id/anexos',
  upload.single('arquivo'),
  async (req: Request, res: Response) => {
    try {
      const propId = String(req.params.id);
      let filename: string;
      let mimetype: string;
      let conteudo_b64: string;
      if (req.file) {
        // Multipart: file vem em memoria via multer.memoryStorage
        filename = req.file.originalname;
        mimetype = req.file.mimetype;
        conteudo_b64 = req.file.buffer.toString('base64');
      } else {
        // JSON legacy
        const b = (req.body || {}) as { filename?: string; mimetype?: string; conteudo_b64?: string };
        if (!b.filename || !b.mimetype || !b.conteudo_b64) {
          res.status(400).json({ error: 'Envie arquivo via multipart (campo "arquivo") OU JSON {filename, mimetype, conteudo_b64}.' });
          return;
        }
        filename = b.filename;
        mimetype = b.mimetype;
        conteudo_b64 = b.conteudo_b64;
      }
      const r = await propostasConsultoria.criarAnexoProposta({
        proposta_id: propId, filename, mimetype, conteudo_b64,
      });
      res.json(r);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
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

// v3.4.0: assinatura digital ICP-Brasil de vistorias (PF default — ato tecnico do RT)
app.post('/api/vistorias/:id/assinar', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const m = await import('./integrations/vistoriasAssinatura');
    const perfilOverride = (req.body?.perfil as 'pj' | 'pf' | undefined);
    const result = await m.assinarVistoria(String(req.params.id), { perfil: perfilOverride });
    res.json(result);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.4.0: baixa PDF assinado da vistoria (inline pra abrir no browser)
app.get('/api/vistorias/:id/pdf-assinado', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const m = await import('./integrations/vistoriasAssinatura');
    const data = await m.getVistoriaPdfAssinado(id);
    if (!data) {
      res.status(404).json({ error: 'Vistoria ainda nao foi assinada' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="vistoria-${id}-assinada.pdf"`);
    res.send(data.pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

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
// v1.99.16: saldo consolidado em aberto (cross-month) — sub-aba Folha Mensal
app.get   ('/api/folha/saldo-aberto',
  apiHandle(args => obras.relatorioSaldoEmAbertoEquipe(args as Parameters<typeof obras.relatorioSaldoEmAbertoEquipe>[0])));

// v3.10.0: Fechamento de Folha por período flexível (preview + fechar + listar + pagar item + reverter).
// Schema mapeado pra v3.9.x: romatec_obras, romatec_obra_equipe, romatec_obra_funcionario_dias.
app.get('/api/folha/periodo-sugerido/:obraId', async (req: Request, res: Response) => {
  try {
    const obraId = Number(req.params.obraId);
    if (!Number.isFinite(obraId)) { res.status(400).json({ error: 'obraId inválido' }); return; }
    const { calcularPeriodoSugerido } = await import('./services/periodoSugerido');
    const periodo = await calcularPeriodoSugerido(obraId);
    res.json(periodo);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/folha/preview', async (req: Request, res: Response) => {
  try {
    const { obraId, dataInicio, dataFim } = req.body ?? {};
    if (!obraId || !dataInicio || !dataFim) {
      res.status(400).json({ error: 'Parâmetros: obraId, dataInicio, dataFim' }); return;
    }
    const m = await import('./services/folhaFechamento');
    const data = await m.previewFolha(Number(obraId), String(dataInicio), String(dataFim));
    res.json(data);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.50.0: fechar folha requer PIN (admin/owner bypass)
app.post('/api/folha/fechar', requireAuth, requirePin, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!body.obraId || !body.dataInicio || !body.dataFim) {
      res.status(400).json({ error: 'obraId, dataInicio e dataFim são obrigatórios' }); return;
    }
    const m = await import('./services/folhaFechamento');
    const result = await m.fecharFolha({
      obraId: Number(body.obraId),
      dataInicio: String(body.dataInicio),
      dataFim: String(body.dataFim),
      dataFimPrevista: body.dataFimPrevista ? String(body.dataFimPrevista) : undefined,
      rotulo: body.rotulo,
      fechadoPor: body.fechadoPor ? String(body.fechadoPor) : undefined,
      observacoes: body.observacoes,
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.get('/api/folha/listar/:obraId', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/folhaFechamento');
    const lista = await m.listarPorObra(Number(req.params.obraId), req.query.status as string | undefined);
    res.json(lista);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.get('/api/folha/detalhe/:id', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/folhaFechamento');
    const det = await m.obterDetalhe(Number(req.params.id));
    if (!det) { res.status(404).json({ error: 'Fechamento não encontrado' }); return; }
    res.json(det);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.47.0: auditoria de inconsistencias de pagamento (CEO reportou bug de
// "dias de outra quinzena ficam pagos"). Endpoint admin-only retorna 2 tipos:
//   1. data_fora_do_periodo: dias com fechamento_id apontando pra um fechamento
//      cujo data_inicio/fim NAO cobre a data do dia (corrupcao)
//   2. lote_legado_sobreposto: dias com fechamento_id mas tambem com lote
//      legado pago cobrindo a data (overlap historico — esperado em obras
//      migradas, mas explica o sintoma visual)
app.get('/api/folha/auditar-inconsistencias', requireCeoToken, async (req: Request, res: Response) => {
  try {
    const obraId = Number(req.query.obraId);
    if (!Number.isFinite(obraId) || obraId <= 0) {
      res.status(400).json({ error: 'obraId obrigatorio (?obraId=N)' });
      return;
    }
    const m = await import('./services/folhaFechamento');
    const r = await m.auditarInconsistenciasPagamento(obraId);
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

app.post('/api/folha/item/:itemId/pagar', async (req: Request, res: Response) => {
  try {
    const { formaPagamento, usuario, observacao } = req.body ?? {};
    if (!formaPagamento) { res.status(400).json({ error: 'formaPagamento é obrigatório' }); return; }
    const m = await import('./services/folhaFechamento');
    const r = await m.marcarItemPago({
      itemId: Number(req.params.itemId),
      formaPagamento, usuario, observacao,
    });
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.post('/api/folha/item/:itemId/reverter', async (req: Request, res: Response) => {
  try {
    const { usuario, motivo } = req.body ?? {};
    const m = await import('./services/folhaFechamento');
    await m.reverterPagamento(Number(req.params.itemId), usuario, motivo);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.62.4: editar valor BRUTO de um item do fechamento (correcao manual —
// ex: diaria errada na epoca). Recalcula liquido + totais do cabecalho.
app.post('/api/folha/item/:itemId/editar-valor', async (req: Request, res: Response) => {
  try {
    const { valorTotal, usuario, motivo } = req.body ?? {};
    const v = Number(valorTotal);
    if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: 'valorTotal inválido' }); return; }
    const m = await import('./services/folhaFechamento');
    const r = await m.editarValorItem(Number(req.params.itemId), v, usuario, motivo);
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.10.1: PDF detalhado do fechamento
app.get('/api/folha/fechamento/:id/pdf-relatorio', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalido' }); return; }
    const m = await import('./services/folhaFechamentoPdf');
    const pdf = await m.gerarPdfFechamento(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="fechamento-${id}.pdf"`);
    res.send(pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.15.17: PDF unificado = relatorio + comprovantes anexados (1 pagina por item).
app.get('/api/folha/fechamento/:id/pdf-completo', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalido' }); return; }
    const m = await import('./services/folhaFechamentoPdf');
    const pdf = await m.gerarPdfFechamentoCompleto(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="fechamento-${id}-completo.pdf"`);
    res.send(pdf);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.15.17: reenviar comprovante + recibo de UM item ja pago.
app.post('/api/folha/item/:itemId/reenviar', async (req: Request, res: Response) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone : undefined; // v3.62.5: override de numero
    const m = await import('./services/folhaFechamentoComprovante');
    const r = await m.reenviarComprovanteRecibo(Number(req.params.itemId), phone);
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.15.17: bulk - reenvia comprovantes + recibos de TODOS itens pagos do fechamento.
app.post('/api/folha/fechamento/:id/enviar-tudo', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/folhaFechamentoComprovante');
    const r = await m.enviarTudoFechamento(Number(req.params.id));
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.10.1: retorna dados do colaborador dono de um item (nome, PIX, etc) pra
// pre-preencher o modal de "Marcar Pago".
app.get('/api/folha/item/:itemId/dados-pagamento', async (req: Request, res: Response) => {
  try {
    const m = await import('./services/folhaFechamentoPdf');
    const d = await m.getDadosPagamentoItem(Number(req.params.itemId));
    if (!d) { res.status(404).json({ error: 'Item nao encontrado' }); return; }
    res.json(d);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.10.1: salva/atualiza chave PIX do funcionario (vinda do modal Marcar Pago).
app.post('/api/folha/funcionario/:funcionarioId/pix', async (req: Request, res: Response) => {
  try {
    const { chave_pix } = req.body ?? {};
    if (!chave_pix || !String(chave_pix).trim()) {
      res.status(400).json({ error: 'chave_pix obrigatoria' }); return;
    }
    const m = await import('./services/folhaFechamentoPdf');
    await m.atualizarChavePixFuncionario(Number(req.params.funcionarioId), String(chave_pix));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.11.0: upload de comprovante de pagamento (JPG/PNG/PDF) com OCR + marca pago + envia WhatsApp
app.post('/api/folha/item/:itemId/upload-comprovante', upload.single('arquivo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'arquivo obrigatorio (multipart field: arquivo)' }); return; }
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId)) { res.status(400).json({ error: 'itemId invalido' }); return; }
    // Optional flag pra desabilitar envio WhatsApp (default true)
    const enviar = req.body?.enviar_whatsapp !== 'false';
    const m = await import('./services/folhaFechamentoComprovante');
    const r = await m.processarComprovantePagamento(
      itemId,
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname || `comprovante-${itemId}.${req.file.mimetype.split('/')[1] || 'bin'}`,
      enviar,
    );
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.11.0: download do comprovante anexado (inline)
app.get('/api/folha/item/:itemId/comprovante', async (req: Request, res: Response) => {
  try {
    const itemId = Number(req.params.itemId);
    const m = await import('./services/folhaFechamentoComprovante');
    const d = await m.getComprovanteItem(itemId);
    if (!d) { res.status(404).json({ error: 'Comprovante nao encontrado' }); return; }
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', `inline; filename="${d.filename}"`);
    res.send(d.arquivo);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.12.0: cobranca manual de parcela (botao "Cobrar agora" na UI)
// v3.15.0: aceita texto e telefone customizados (UI mostra preview pra editar antes de enviar)
app.post('/api/parcelas/:id/cobrar', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const m = await import('./services/cobrancaParcelas');
    const r = await m.enviarCobrancaParcela(id, {
      texto: typeof req.body?.texto === 'string' ? req.body.texto : undefined,
      telefone: typeof req.body?.telefone === 'string' ? req.body.telefone : undefined,
    });
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.15.0: preview do texto/telefone da cobranca — UI usa pra confirmar antes de enviar
app.get('/api/parcelas/:id/cobrar-preview', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const m = await import('./services/cobrancaParcelas');
    const r = await m.previewCobrancaParcela(id);
    res.json(r);
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// v3.12.0: trigger manual do ticker (admin only — pra testar/forcar checagem fora do horario)
app.post('/api/parcelas/check-cobrancas', async (_req: Request, res: Response) => {
  try {
    const m = await import('./services/cobrancaParcelas');
    const r = await m.checkAndSendCobrancasDoDia();
    res.json(r);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

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
  // v1.99.7+: signing migrations rodam IMEDIATAMENTE em promise SEPARADA.
  // Antes (v1.99.7) estavam encadeadas em initDb().then(...) — quando initDb
  // rejeitava (bug do users.password_hash), o .catch da chain pulava as
  // signing migrations. Agora correm independente do sucesso/falha de initDb.
  void (async () => {
    try {
      const m = await import('./database/migrations-signing');
      await m.runSigningMigrations();
    } catch (err) {
      console.error('[signing-migrations] FALHA fatal:', err);
    }
  })();

  // v3.54.0: migrations do módulo Diligências de Campo — independente.
  void (async () => {
    try {
      const m = await import('./database/migrations-diligencias');
      await m.runDiligenciasMigrations();
    } catch (err) {
      console.error('[diligencias-migrations] FALHA:', err);
    }
  })();

  // v1.99.25: migrations do modulo Laudo de Demarcacao — independente.
  void (async () => {
    try {
      const m = await import('./database/migrations-laudos');
      await m.runLaudosMigrations();
    } catch (err) {
      console.error('[laudos-migrations] FALHA fatal:', err);
    }
  })();

  // v2.8.0: migrations do modulo Loteamentos / Auto-preenchimento.
  void (async () => {
    try {
      const m = await import('./database/migrations-loteamentos');
      await m.runLoteamentosMigrations();
    } catch (err) {
      console.error('[loteamentos-migrations] FALHA fatal:', err);
    }
  })();

  // v3.8.0: migrations da Galeria de Fotos georreferenciadas.
  void (async () => {
    try {
      const m = await import('./database/migrations-galeria');
      await m.runGaleriaMigrations();
    } catch (err) {
      console.error('[galeria-migrations] FALHA fatal:', err);
    }
  })();

  // v3.0.0: migrations da Precificacao INCRA (Portaria 12/2025).
  void (async () => {
    try {
      const m = await import('./database/migrations-precificacao-incra');
      await m.runPrecificacaoIncraMigrations();
    } catch (err) {
      console.error('[precif-incra-migrations] FALHA fatal:', err);
    }
  })();

  // v3.1.0: migrations da clonagem de laudo (clonado_de_id + clonado_em).
  void (async () => {
    try {
      const m = await import('./database/migrations-clonagem-laudo');
      await m.runClonagemLaudoMigrations();
    } catch (err) {
      console.error('[clonagem-laudo-migrations] FALHA fatal:', err);
    }
  })();

  // v3.2.0: tabela `cartorios` (catalogo nacional CNJ p/ autocomplete).
  void (async () => {
    try {
      const m = await import('./database/migrations-cartorios');
      await m.runCartoriosMigrations();
    } catch (err) {
      console.error('[cartorios-migrations] FALHA fatal:', err);
    }
  })();

  // v1.99.17: tabela `configuracoes` (defaults globais — precificação, salário mínimo, etc).
  void (async () => {
    try {
      const m = await import('./database/migrations-configuracoes');
      await m.runConfiguracoesMigrations();
    } catch (err) {
      console.error('[configuracoes-migrations] FALHA fatal:', err);
    }
  })();

  // v1.99.17: coluna hash_validacao (+UNIQUE) em `propostas` para validação pública /v/:hash.
  void (async () => {
    try {
      const m = await import('./database/migrations-propostas-hash');
      await m.runPropostasHashMigrations();
    } catch (err) {
      console.error('[propostas-hash-migrations] FALHA fatal:', err);
    }
  })();

  // v3.24.0: PR A Auth Foundation — auth_logs + ALTER tenant_users.equipe_id.
  void (async () => {
    try {
      const m = await import('./database/migrations-auth');
      await m.runAuthMigrations();
    } catch (err) {
      console.error('[auth-migrations] FALHA fatal:', err);
    }
  })();

  // v3.23.5: backfill numero PROP-AAAA-NNNN -> PROP-AAAA-NNNN-R1 (propostas legado).
  void (async () => {
    try {
      const m = await import('./database/migrations-propostas-revisao');
      await m.runPropostasRevisaoMigrations();
    } catch (err) {
      console.error('[propostas-revisao-migrations] FALHA fatal:', err);
    }
  })();

  // v3.27.0: credencial INCRA do tecnico (FQNS prefixo + contadores vitalicios).
  // Migration idempotente em users (auth SaaS) — ZERO ALTER em propostas.
  void (async () => {
    try {
      const m = await import('./database/migrations-usuarios-credencial-incra');
      await m.runMigrationsUsuariosCredencialIncra();
    } catch (err) {
      console.error('[MigrationUsuariosCredencial] FALHA fatal:', err);
    }
  })();

  // v3.28.0: log de auditoria de envios da galeria (fotos_envios_log).
  void (async () => {
    try {
      const m = await import('./database/migrations-fotos-envios-log');
      await m.runMigrationsFotosEnviosLog();
    } catch (err) {
      console.error('[fotos-envios-log-migrations] FALHA fatal:', err);
    }
  })();

  // v3.28.0: preferencias por usuario (kv JSON).
  void (async () => {
    try {
      const m = await import('./database/migrations-user-preferences');
      await m.runMigrationsUserPreferences();
    } catch (err) {
      console.error('[user-preferences-migrations] FALHA fatal:', err);
    }
  })();

  // v3.29.0: aditivo de campo (insalubridade/periculosidade) — config + seed
  // dos 4 templates + tabela polimorfica de vinculo com propostas.
  void (async () => {
    try {
      const m = await import('./database/migrations-aditivo-campo');
      await m.runMigrationsAditivoCampo();
    } catch (err) {
      console.error('[aditivo-campo-migrations] FALHA fatal:', err);
    }
  })();

  // v3.31.0: planta individual por quadra (DXF/DWG/PDF).
  void (async () => {
    try {
      const m = await import('./database/migrations-quadras-plantas');
      await m.runMigrationsQuadrasPlantas();
    } catch (err) {
      console.error('[quadras-plantas-migrations] FALHA fatal:', err);
    }
  })();

  // v3.35.0: memoriais de calculo (memoriais_calculo + sinapi_indices seed).
  void (async () => {
    try {
      const m = await import('./database/migrations-memoriais');
      await m.runMigrationsMemoriais();
    } catch (err) {
      console.error('[memoriais-migrations] FALHA fatal:', err);
    }
  })();

  void (async () => {
    try {
      const m = await import('./database/migrations-memoriais-pdf');
      await m.runMigrationsMemoriaisPdf();
    } catch (err) {
      console.error('[memoriais-pdf-migrations] FALHA fatal:', err);
    }
  })();

  // v3.66.0: coluna extracao_json em memoriais_calculo (memorial eletrico).
  void (async () => {
    try {
      const m = await import('./database/migrations-memoriais-eletrico-extracao');
      await m.runMemoriaisEletricoExtracaoMigrations();
    } catch (err) {
      console.error('[mem-ele-extracao-migrations] FALHA fatal:', err);
    }
  })();

  // v3.17.0: tabela laudos_demarcacao_arquivos (anexos vetoriais DXF/DWG/KML)
  // + seeds de configurações de upload/download em `configuracoes`.
  void (async () => {
    try {
      const m = await import('./database/migrations-laudos-arquivos');
      await m.runLaudosArquivosMigrations();
    } catch (err) {
      console.error('[laudos-arquivos-migrations] FALHA fatal:', err);
    }
  })();

  // v3.49.0: tabela recibos_anexos (anexos PDF/imagem em recibos universais).
  // Usada para CCIR/ITR/CAR e outros documentos complementares enviados junto
  // ao PDF principal via WhatsApp.
  void (async () => {
    try {
      const m = await import('./database/migrations-recibos-anexos');
      await m.runRecibosAnexosMigrations();
    } catch (err) {
      console.error('[recibos-anexos-migrations] FALHA fatal:', err);
    }
  })();

  // v3.50.0: PIN secundario — colunas pin_hash, pin_set_at, pin_failed_attempts,
  // pin_locked_until em users. Admin/owner bypassam, outros roles digitam PIN
  // pra acoes destrutivas (deletar recibo, fechar folha, cancelar NF, etc.).
  void (async () => {
    try {
      const m = await import('./database/migrations-pin-secundario');
      await m.runPinSecundarioMigrations();
    } catch (err) {
      console.error('[pin-migrations] FALHA fatal:', err);
    }
  })();

  // v3.18.0: tabelas processamentos_gnss + processamentos_gnss_arquivos (RINEX/PPP)
  // + seeds de configuracoes (URL portal IBGE, tamanhos maximos, duracoes minimas).
  void (async () => {
    try {
      const m = await import('./database/migrations-gnss');
      await m.runGnssMigrations();
    } catch (err) {
      console.error('[gnss-migrations] FALHA fatal:', err);
    }
  })();

  // v3.10.0: tabelas de Fechamento de Folha (folha_fechamentos + itens + log)
  // + ALTERs em romatec_obras (ciclo_pagamento, dia_corte_padrao, ultima_data_fechada)
  // + ALTERs em romatec_obra_funcionario_dias (fechamento_id, bloqueado_em).
  void (async () => {
    try {
      const m = await import('./database/migrations-folha-fechamento');
      await m.runFolhaFechamentoMigrations();
    } catch (err) {
      console.error('[folha-fechamento-migrations] FALHA fatal:', err);
    }
  })();

  // v3.10.2: tipo_chave_pix em romatec_obra_equipe (pra cadastro PIX por tipo).
  void (async () => {
    try {
      const m = await import('./database/migrations-folha-fechamento');
      await m.runEquipePixMigrations();
    } catch (err) {
      console.error('[equipe-pix-migrations] FALHA fatal:', err);
    }
  })();

  // v3.63.0: Croqui de Pontos na Proposta de Demarcação — tabelas
  // propostas_demarcacao_pontos/lados (FK propostas) + colunas calculadas em
  // propostas + flag alinhar em laudos_demarcacao_lados (import Proposta→Laudo).
  void (async () => {
    try {
      const m = await import('./database/migrations-proposta-croqui');
      await m.runPropostaCroquiMigrations();
    } catch (err) {
      console.error('[proposta-croqui-migrations] FALHA fatal:', err);
    }
  })();

  // v3.16.0: foto do colaborador como BLOB pra aparecer em recibos e relatorios.
  void (async () => {
    try {
      const m = await import('./database/migrations-folha-fechamento');
      await m.runEquipeFotoMigrations();
    } catch (err) {
      console.error('[equipe-foto-migrations] FALHA fatal:', err);
    }
  })();

  // v3.11.0: colunas de comprovante em folha_fechamento_itens.
  void (async () => {
    try {
      const m = await import('./database/migrations-folha-fechamento');
      await m.runComprovanteMigrations();
    } catch (err) {
      console.error('[comprovante-migrations] FALHA fatal:', err);
    }
  })();

  // v3.12.0: colunas de cobranca em romatec_obra_parcelas.
  void (async () => {
    try {
      const m = await import('./database/migrations-cobranca-parcelas');
      await m.runCobrancaParcelasMigrations();
    } catch (err) {
      console.error('[cobranca-parcelas-migrations] FALHA fatal:', err);
    }
    // v3.14.0
    try {
      const m = await import('./database/migrations-relatorio-demarcacao');
      await m.runRelatorioDemarcacaoMigrations();
    } catch (err) {
      console.error('[relatorio-demarcacao-migrations] FALHA fatal:', err);
    }
  })();

  // texto-explicativo: tabelas textos_explicativos + envios + coluna
  // enviar_explicativo_junto em propostas + seed dos 2 templates.
  void (async () => {
    try {
      await runMigrationsExplicativo();
    } catch (err) {
      console.error('[explicativo-migrations] FALHA fatal:', err);
    }
  })();

  void initDb()
    .then(() => loadSessionFromDb())
    .then(() => import('./services/whatsappDrafts'))
    .then(m => m.startDraftCleanup())
    .then(() => import('./services/recibosQuinzena'))
    .then(m => m.startExpiracaoRecibosTicker()) // v1.65.16: expira recibos sem resposta há mais de 48h (ticker a cada 6h)
    .then(() => import('./services/reciboLembretes'))
    .then(m => m.iniciarLembretesCron()) // v1.72.0: lembretes universais + auto-expirar
    .then(() => import('./services/cobrancaParcelas'))
    .then(m => m.iniciarTickerCobrancaParcelas()) // v3.12.0: cobranca automatica de parcelas (6h cron)
    .then(() => import('./jobs/lembretesDiligencias'))
    .then(m => m.iniciarJobLembretesDiligencias()) // v3.54.0: lembrete D-1 das diligências (08:00 BRT)
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
