// v3.28.0: orquestrador de compartilhamento multi-canal de fotos da galeria.
//
// Decisoes:
//   - Promise.allSettled: falha em 1 canal NAO derruba os outros.
//   - Cada tentativa (sucesso ou falha) e logada em fotos_envios_log via
//     repositorio injetavel — testavel sem arrastar mysql.
//   - Resize: lazy import de sharp (optional dep). Se nao instalado, passa
//     o buffer original adiante (warning em log). Tests injetam um stub.
//   - Rate limiting Z-API: debounce de 2s entre envios na mesma instancia.
//     Implementado como estado em memoria (fila simples, nao BullMQ).
//   - Idempotency-Key: cache em memoria por 60s — repeticao retorna mesmo
//     resultado sem disparar novo envio.
//   - Privacidade: destinatario truncado em logs (`+55****07840`) — numero
//     completo so vai pra fotos_envios_log (acesso restrito).
//
// Modulo standalone — zero deps de pdfkit/voyageai/express. Repositorio
// (fotosEnviosLogRepo) e senders (zapiSend/telegramSend) sao injetaveis.

export type CanalEnvio = 'celular_download' | 'whatsapp' | 'telegram';
export type CanalStatus = 'sucesso' | 'erro';

export interface CanalResultado {
  canal: CanalEnvio;
  status: CanalStatus;
  message_id?: string | number;
  download_url?: string;
  erro?: string;
}

export interface CompartilharInput {
  foto_id: number;
  user_id: number;
  canais: CanalEnvio[];
  destinatario_whatsapp?: string;
  destinatario_telegram?: string;
  legenda?: string;
  idempotency_key?: string;
}

export interface FotoArquivo {
  id: number;
  mime: string;
  buffer: Buffer;
  lat?: number | null;
  lng?: number | null;
  capturada_em?: string | null;
}

// Repositorio injetavel (real -> mysql; testes -> em memoria)
export interface LogRepo {
  registrarPendente(input: {
    foto_id: number; canal: CanalEnvio; user_id: number;
    destinatario?: string | null; idempotency_key?: string | null;
  }): Promise<number>;
  registrarSucesso(id: number, fields: {
    zapi_message_id?: string | null; telegram_message_id?: number | null;
  }): Promise<void>;
  registrarErro(id: number, mensagem: string): Promise<void>;
  buscarPorIdempotencyKey(key: string, dentroDeSegundos: number): Promise<CanalResultado[] | null>;
}

// Senders injetaveis
export interface Senders {
  whatsapp: (to: string, buffer: Buffer, mime: string, caption?: string) => Promise<{ messageId?: string }>;
  telegram: (to: string, buffer: Buffer, mime: string, caption?: string) => Promise<{ messageId?: number }>;
}

// Resizer injetavel
export type Resizer = (buffer: Buffer, mime: string) => Promise<{ buffer: Buffer; mime: string }>;

export interface CompartilharDeps {
  log: LogRepo;
  senders: Senders;
  resizer?: Resizer;
  delayMs?: (ms: number) => Promise<void>; // injetavel pra testes (evita esperar 2s real)
  baseUrlDownload?: (fotoId: number) => string;
}

// Estado em memoria (modulo singleton — uma instancia por processo).
// Para tests, exportamos resetEstado() pra zerar entre runs.
const ESTADO = {
  ultimoEnvioZapi: 0,
  idempotencyCache: new Map<string, { ts: number; resultado: CanalResultado[] }>(),
};

// Tipo minimo da API sharp que usamos (evita exigir @types/sharp).
interface SharpLike {
  resize(opts: { width: number; height: number; fit: string; withoutEnlargement: boolean }): SharpLike;
  jpeg(opts: { quality: number }): SharpLike;
  toBuffer(): Promise<Buffer>;
}

const RATE_LIMIT_ZAPI_MS = 2000;
const IDEMPOTENCY_TTL_MS = 60_000;
const RESIZE_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MB

export function resetEstadoCompartilhamento(): void {
  ESTADO.ultimoEnvioZapi = 0;
  ESTADO.idempotencyCache.clear();
}

// Trunca destinatario para logs gerais (privacidade).
// Ex: 5599991507840 -> +55****07840 ; @romatec_obras -> @rom****
export function truncarDestinatario(d: string): string {
  if (!d) return '';
  if (d.startsWith('@')) {
    return d.length > 6 ? `${d.slice(0, 4)}****` : d;
  }
  if (/^\d{10,15}$/.test(d)) {
    const head = d.slice(0, 2);
    const tail = d.slice(-5);
    return `+${head}****${tail}`;
  }
  return '****';
}

// Resize padrao (lazy sharp). Se sharp nao instalado, retorna buffer original.
const resizerSharp: Resizer = async (buffer, mime) => {
  if (buffer.length <= RESIZE_LIMIT_BYTES) return { buffer, mime };
  try {
    // Lazy import — sharp e optional dep. Indireto via Function('return import')
    // pra TypeScript nao exigir @types/sharp em build (modulo pode nao existir).
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
    const mod = await dynamicImport('sharp') as { default: (b: Buffer) => SharpLike };
    const reduzida = await mod.default(buffer)
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buffer: reduzida, mime: 'image/jpeg' };
  } catch (err) {
    console.warn('[fotoCompartilhamento] resize indisponivel (sharp ausente):', (err as Error).message);
    return { buffer, mime };
  }
};

export async function compartilharFoto(
  input: CompartilharInput,
  foto: FotoArquivo,
  deps: CompartilharDeps,
): Promise<CanalResultado[]> {
  // 1) Idempotency-Key — retorna cache se houver
  if (input.idempotency_key) {
    const cached = ESTADO.idempotencyCache.get(input.idempotency_key);
    if (cached && Date.now() - cached.ts < IDEMPOTENCY_TTL_MS) {
      return cached.resultado;
    }
    // Tambem checa no repo (multi-processo)
    const fromRepo = await deps.log.buscarPorIdempotencyKey(input.idempotency_key, IDEMPOTENCY_TTL_MS / 1000);
    if (fromRepo) {
      ESTADO.idempotencyCache.set(input.idempotency_key, { ts: Date.now(), resultado: fromRepo });
      return fromRepo;
    }
  }

  // 2) Pre-resize se necessario (uma vez — reusa pra todos os canais)
  const resizer = deps.resizer ?? resizerSharp;
  const { buffer: bufferProcessado, mime: mimeProcessado } = await resizer(foto.buffer, foto.mime);

  // 3) Executa canais em paralelo, mas WhatsApp respeita debounce 2s
  const resultados: CanalResultado[] = await Promise.all(
    input.canais.map(async (canal) => {
      try {
        if (canal === 'celular_download') {
          return await executarDownload(input, deps);
        }
        if (canal === 'whatsapp') {
          return await executarWhatsApp(input, foto, bufferProcessado, mimeProcessado, deps);
        }
        if (canal === 'telegram') {
          return await executarTelegram(input, foto, bufferProcessado, mimeProcessado, deps);
        }
        return { canal, status: 'erro' as CanalStatus, erro: `Canal desconhecido: ${canal}` };
      } catch (err) {
        return { canal, status: 'erro' as CanalStatus, erro: (err as Error).message };
      }
    }),
  );

  if (input.idempotency_key) {
    ESTADO.idempotencyCache.set(input.idempotency_key, { ts: Date.now(), resultado: resultados });
  }
  return resultados;
}

async function executarDownload(input: CompartilharInput, deps: CompartilharDeps): Promise<CanalResultado> {
  const logId = await deps.log.registrarPendente({
    foto_id: input.foto_id,
    canal: 'celular_download',
    user_id: input.user_id,
    destinatario: null,
    idempotency_key: input.idempotency_key ?? null,
  });
  const url = deps.baseUrlDownload
    ? deps.baseUrlDownload(input.foto_id)
    : `/api/galeria/fotos/${input.foto_id}/download`;
  await deps.log.registrarSucesso(logId, {});
  return { canal: 'celular_download', status: 'sucesso', download_url: url };
}

async function executarWhatsApp(
  input: CompartilharInput,
  foto: FotoArquivo,
  buffer: Buffer,
  mime: string,
  deps: CompartilharDeps,
): Promise<CanalResultado> {
  if (!input.destinatario_whatsapp) {
    return { canal: 'whatsapp', status: 'erro', erro: 'destinatario_whatsapp obrigatorio' };
  }
  const logId = await deps.log.registrarPendente({
    foto_id: input.foto_id,
    canal: 'whatsapp',
    user_id: input.user_id,
    destinatario: input.destinatario_whatsapp,
    idempotency_key: input.idempotency_key ?? null,
  });

  // Rate limit
  const delay = deps.delayMs ?? defaultDelay;
  const agora = Date.now();
  const desde = agora - ESTADO.ultimoEnvioZapi;
  if (desde < RATE_LIMIT_ZAPI_MS) {
    await delay(RATE_LIMIT_ZAPI_MS - desde);
  }
  ESTADO.ultimoEnvioZapi = Date.now();

  try {
    const caption = montarLegenda(input.legenda, foto);
    const r = await deps.senders.whatsapp(input.destinatario_whatsapp, buffer, mime, caption);
    await deps.log.registrarSucesso(logId, { zapi_message_id: r.messageId ?? null });
    console.log(`[fotoCompartilhamento] WhatsApp OK foto=${foto.id} dest=${truncarDestinatario(input.destinatario_whatsapp)} msgId=${r.messageId ?? '-'}`);
    return { canal: 'whatsapp', status: 'sucesso', message_id: r.messageId };
  } catch (err) {
    const msg = (err as Error).message;
    await deps.log.registrarErro(logId, msg);
    console.error(`[fotoCompartilhamento] WhatsApp ERRO foto=${foto.id} dest=${truncarDestinatario(input.destinatario_whatsapp)}: ${msg}`);
    return { canal: 'whatsapp', status: 'erro', erro: msg };
  }
}

async function executarTelegram(
  input: CompartilharInput,
  foto: FotoArquivo,
  buffer: Buffer,
  mime: string,
  deps: CompartilharDeps,
): Promise<CanalResultado> {
  if (!input.destinatario_telegram) {
    return { canal: 'telegram', status: 'erro', erro: 'destinatario_telegram obrigatorio' };
  }
  const logId = await deps.log.registrarPendente({
    foto_id: input.foto_id,
    canal: 'telegram',
    user_id: input.user_id,
    destinatario: input.destinatario_telegram,
    idempotency_key: input.idempotency_key ?? null,
  });

  try {
    const caption = montarLegenda(input.legenda, foto);
    const r = await deps.senders.telegram(input.destinatario_telegram, buffer, mime, caption);
    await deps.log.registrarSucesso(logId, { telegram_message_id: r.messageId ?? null });
    console.log(`[fotoCompartilhamento] Telegram OK foto=${foto.id} dest=${truncarDestinatario(input.destinatario_telegram)} msgId=${r.messageId ?? '-'}`);
    return { canal: 'telegram', status: 'sucesso', message_id: r.messageId };
  } catch (err) {
    const msg = (err as Error).message;
    await deps.log.registrarErro(logId, msg);
    console.error(`[fotoCompartilhamento] Telegram ERRO foto=${foto.id} dest=${truncarDestinatario(input.destinatario_telegram)}: ${msg}`);
    return { canal: 'telegram', status: 'erro', erro: msg };
  }
}

// Legenda default: usa a fornecida pelo usuario OU monta com coords + timestamp.
export function montarLegenda(legenda: string | undefined, foto: FotoArquivo): string {
  if (legenda && legenda.trim()) return legenda.trim();
  const partes: string[] = [];
  if (foto.lat != null && foto.lng != null) {
    partes.push(`📍 ${Number(foto.lat).toFixed(5)}, ${Number(foto.lng).toFixed(5)}`);
  }
  if (foto.capturada_em) {
    const dt = new Date(foto.capturada_em);
    if (!isNaN(dt.getTime())) {
      partes.push(`🕒 ${dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    }
  }
  return partes.length > 0 ? `Romatec — ${partes.join(' · ')}` : 'Romatec';
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Constantes exportadas pra testes que validam thresholds.
export const __internals = {
  RATE_LIMIT_ZAPI_MS,
  IDEMPOTENCY_TTL_MS,
  RESIZE_LIMIT_BYTES,
  resizerSharp,
};
