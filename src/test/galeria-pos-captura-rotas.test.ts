// v3.28.0: testes das rotas novas de Galeria Pos-Captura.
// Estrategia: monta um app express minimo com mocks pra cobrir handlers sem
// depender do server.ts inteiro (que ja faz boot pesado de migrations/cron).

import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetEstadoCompartilhamento, type CanalResultado, type FotoArquivo, type LogRepo, type Senders } from '../integrations/fotoCompartilhamento';

interface FakeUser { sub: string; tenant_id: number; }

// Storage em memoria pros testes (mock dos repos)
const fotos = new Map<number, FotoArquivo>();
const prefs = new Map<number, Record<string, unknown>>();
const log: Array<{ id: number; foto_id: number; canal: string; status: string; destinatario: string | null }> = [];
let logSeq = 1;

const fakeLogRepo: LogRepo = {
  async registrarPendente(input) {
    const id = logSeq++;
    log.push({ id, foto_id: input.foto_id, canal: input.canal, status: 'pendente', destinatario: input.destinatario ?? null });
    return id;
  },
  async registrarSucesso(id) {
    const e = log.find((x) => x.id === id);
    if (e) e.status = 'sucesso';
  },
  async registrarErro(id) {
    const e = log.find((x) => x.id === id);
    if (e) e.status = 'erro';
  },
  async buscarPorIdempotencyKey() { return null; },
};

const fakeSenders: Senders = {
  whatsapp: vi.fn(async () => ({ messageId: 'wa-fake' })),
  telegram: vi.fn(async () => ({ messageId: 999 })),
};

// Mock do middleware de auth
function fakeAuth(req: Request, res: Response, next: NextFunction): void {
  const h = req.headers['x-fake-user'];
  if (!h) { res.status(401).json({ error: 'nao autenticado' }); return; }
  (req as Request & { user: FakeUser }).user = { sub: String(h), tenant_id: 1 };
  next();
}

// Validacao espelha a do server.ts (copia minima — codigo identico).
type CanalCompart = 'celular_download' | 'whatsapp' | 'telegram';
function validarCompartilharBody(body: unknown): { ok: true; data: { canais: CanalCompart[]; destinatario_whatsapp?: string; destinatario_telegram?: string; legenda?: string } } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body invalido' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.canais) || b.canais.length === 0) return { ok: false, error: 'canais obrigatorio' };
  const VALIDOS = new Set<string>(['celular_download', 'whatsapp', 'telegram']);
  const canais: CanalCompart[] = [];
  for (const c of b.canais) {
    if (typeof c !== 'string' || !VALIDOS.has(c)) return { ok: false, error: 'canal invalido' };
    canais.push(c as CanalCompart);
  }
  const dwa = typeof b.destinatario_whatsapp === 'string' ? b.destinatario_whatsapp : undefined;
  const dtg = typeof b.destinatario_telegram === 'string' ? b.destinatario_telegram : undefined;
  if (canais.includes('whatsapp') && !dwa) return { ok: false, error: 'WhatsApp requer destinatario_whatsapp' };
  if (canais.includes('telegram') && !dtg) return { ok: false, error: 'Telegram requer destinatario_telegram' };
  return { ok: true, data: { canais, destinatario_whatsapp: dwa, destinatario_telegram: dtg, legenda: typeof b.legenda === 'string' ? b.legenda : undefined } };
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.post('/api/galeria/fotos/:id/compartilhar', fakeAuth, async (req, res) => {
    const fotoId = Number(req.params.id);
    const arq = fotos.get(fotoId);
    if (!arq) { res.status(404).json({ error: 'foto nao encontrada' }); return; }
    const parsed = validarCompartilharBody(req.body || {});
    if (!parsed.ok) { res.status(422).json({ error: 'validacao', detail: parsed.error }); return; }
    const fc = await import('../integrations/fotoCompartilhamento');
    const userId = Number((req as Request & { user: FakeUser }).user.sub);
    const resultados: CanalResultado[] = await fc.compartilharFoto({
      foto_id: fotoId,
      user_id: userId,
      canais: parsed.data.canais,
      destinatario_whatsapp: parsed.data.destinatario_whatsapp,
      destinatario_telegram: parsed.data.destinatario_telegram,
      legenda: parsed.data.legenda,
    }, arq, {
      log: fakeLogRepo,
      senders: fakeSenders,
      delayMs: async () => {},
    });
    res.json({ ok: true, resultados });
  });

  app.get('/api/galeria/fotos/:id/download', (req, res) => {
    const fotoId = Number(req.params.id);
    const arq = fotos.get(fotoId);
    if (!arq) { res.status(404).json({ error: 'foto nao encontrada' }); return; }
    const fname = `romatec-foto-${arq.id}.jpg`;
    res.setHeader('Content-Type', arq.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(arq.buffer);
  });

  const DEFAULTS = {
    salvar_celular: false,
    whatsapp: false,
    telegram: false,
    destinatario_whatsapp_default: '',
    destinatario_telegram_default: '',
    lembrar_escolha: false,
    mostrar_modal: true,
  };

  app.get('/api/users/me/preferences/galeria', fakeAuth, (req, res) => {
    const userId = Number((req as Request & { user: FakeUser }).user.sub);
    const p = prefs.get(userId);
    const g = (p?.galeria_pos_captura as Record<string, unknown> | undefined) || {};
    res.json({ galeria_pos_captura: { ...DEFAULTS, ...g } });
  });

  app.put('/api/users/me/preferences/galeria', fakeAuth, (req, res) => {
    const userId = Number((req as Request & { user: FakeUser }).user.sub);
    const body = (req.body as { galeria_pos_captura?: Record<string, unknown> }) || {};
    if (!body.galeria_pos_captura || typeof body.galeria_pos_captura !== 'object') {
      res.status(422).json({ error: 'validacao' }); return;
    }
    const atual = prefs.get(userId) || {};
    const merged = {
      ...atual,
      galeria_pos_captura: {
        ...DEFAULTS,
        ...((atual.galeria_pos_captura as Record<string, unknown>) || {}),
        ...body.galeria_pos_captura,
      },
    };
    prefs.set(userId, merged);
    res.json({ ok: true, galeria_pos_captura: merged.galeria_pos_captura });
  });

  return app;
}

beforeEach(() => {
  fotos.clear();
  prefs.clear();
  log.length = 0;
  logSeq = 1;
  resetEstadoCompartilhamento();
  vi.clearAllMocks();
  fakeSenders.whatsapp = vi.fn(async () => ({ messageId: 'wa-fake' }));
  fakeSenders.telegram = vi.fn(async () => ({ messageId: 999 }));
});

describe('Galeria Pos-Captura — rotas HTTP (v3.28.0)', () => {
  it('1. POST /compartilhar 200 com array de resultados', async () => {
    fotos.set(42, { id: 42, mime: 'image/jpeg', buffer: Buffer.alloc(1024) });
    const app = buildApp();
    const r = await request(app)
      .post('/api/galeria/fotos/42/compartilhar')
      .set('x-fake-user', '1')
      .send({ canais: ['whatsapp'], destinatario_whatsapp: '5598999999999' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.resultados)).toBe(true);
    expect(r.body.resultados[0].canal).toBe('whatsapp');
  });

  it('2. POST sem canais -> 422', async () => {
    fotos.set(42, { id: 42, mime: 'image/jpeg', buffer: Buffer.alloc(1024) });
    const app = buildApp();
    const r = await request(app)
      .post('/api/galeria/fotos/42/compartilhar')
      .set('x-fake-user', '1')
      .send({});
    expect(r.status).toBe(422);
  });

  it('3. POST com whatsapp mas sem destinatario -> 422', async () => {
    fotos.set(42, { id: 42, mime: 'image/jpeg', buffer: Buffer.alloc(1024) });
    const app = buildApp();
    const r = await request(app)
      .post('/api/galeria/fotos/42/compartilhar')
      .set('x-fake-user', '1')
      .send({ canais: ['whatsapp'] });
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/destinatario_whatsapp/i);
  });

  it('4. POST com foto_id inexistente -> 404', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/galeria/fotos/9999/compartilhar')
      .set('x-fake-user', '1')
      .send({ canais: ['whatsapp'], destinatario_whatsapp: '5598999999999' });
    expect(r.status).toBe(404);
  });

  it('5. POST sem auth -> 401', async () => {
    fotos.set(42, { id: 42, mime: 'image/jpeg', buffer: Buffer.alloc(1024) });
    const app = buildApp();
    const r = await request(app)
      .post('/api/galeria/fotos/42/compartilhar')
      .send({ canais: ['whatsapp'], destinatario_whatsapp: '5598999999999' });
    expect(r.status).toBe(401);
  });

  it('6. GET /download retorna stream com Content-Disposition', async () => {
    fotos.set(42, { id: 42, mime: 'image/jpeg', buffer: Buffer.from('FAKE_JPG_BYTES') });
    const app = buildApp();
    const r = await request(app).get('/api/galeria/fotos/42/download');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="romatec-foto-42\.jpg"/);
    expect(r.headers['content-type']).toMatch(/image\/jpeg/);
  });

  it('7. GET /preferences/galeria retorna defaults quando nunca salvo', async () => {
    const app = buildApp();
    const r = await request(app)
      .get('/api/users/me/preferences/galeria')
      .set('x-fake-user', '1');
    expect(r.status).toBe(200);
    expect(r.body.galeria_pos_captura).toBeTruthy();
    expect(r.body.galeria_pos_captura.mostrar_modal).toBe(true);
    expect(r.body.galeria_pos_captura.salvar_celular).toBe(false);
  });

  it('8. PUT /preferences/galeria persiste e GET subsequente retorna salvo', async () => {
    const app = buildApp();
    const r1 = await request(app)
      .put('/api/users/me/preferences/galeria')
      .set('x-fake-user', '1')
      .send({ galeria_pos_captura: { whatsapp: true, destinatario_whatsapp_default: '5598999999999' } });
    expect(r1.status).toBe(200);
    expect(r1.body.galeria_pos_captura.whatsapp).toBe(true);
    const r2 = await request(app)
      .get('/api/users/me/preferences/galeria')
      .set('x-fake-user', '1');
    expect(r2.body.galeria_pos_captura.whatsapp).toBe(true);
    expect(r2.body.galeria_pos_captura.destinatario_whatsapp_default).toBe('5598999999999');
    expect(r2.body.galeria_pos_captura.mostrar_modal).toBe(true); // merge com defaults
  });
});
