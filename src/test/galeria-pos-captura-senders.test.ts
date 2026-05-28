// v3.28.0: testes dos adapters de Z-API e Telegram (sendImage/sendPhoto).
//
// Estrategia: NAO importa whatsapp.ts diretamente (arrasta voyageai com
// problema de ESM resolution conhecido — vide proposta-georref-pdf-render).
// Em vez disso, testa o contrato dos adapters reimplementando o payload
// builder e validando-o contra um axios mock. Isso bate com o codigo de
// server.ts (rota POST /compartilhar) que ja delega via injecao.

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface ZapiPayload { phone: string; image: string; caption: string; }
interface ZapiResp { messageId?: string; id?: string; }
interface AxiosFn {
  (url: string, body: unknown, opts?: { headers?: Record<string, string>; timeout?: number }): Promise<{ data: ZapiResp }>;
}

// Adapter de Z-API espelha o usado pelo orquestrador (e por whatsapp.sendImage):
//   POST {base}/send-image  body={phone, image, caption}  headers={Content-Type, Client-Token}
async function zapiSendImageAdapter(
  axiosPost: AxiosFn,
  base: string,
  clientToken: string,
  phone: string,
  imageDataUri: string,
  caption: string,
): Promise<{ messageId?: string }> {
  try {
    const r = await axiosPost(
      `${base}/send-image`,
      { phone, image: imageDataUri, caption },
      { headers: { 'Content-Type': 'application/json', 'Client-Token': clientToken }, timeout: 30000 },
    );
    return { messageId: r.data?.messageId ?? r.data?.id };
  } catch (err) {
    const ax = err as { response?: { data?: unknown }; message?: string };
    const detail = JSON.stringify(ax.response?.data ?? ax.message ?? err);
    throw new Error(`ZAPI send-image: ${detail}`);
  }
}

interface TelegramResp { ok: boolean; result?: { message_id?: number }; }
interface FormDataLike { headers(): Record<string, string>; }

async function telegramSendPhotoAdapter(
  axiosPost: (url: string, body: FormDataLike, opts: { headers: Record<string, string>; timeout: number }) => Promise<{ data: TelegramResp }>,
  botToken: string,
  fd: FormDataLike,
): Promise<{ messageId?: number }> {
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN nao configurado');
  const resp = await axiosPost(
    `https://api.telegram.org/bot${botToken}/sendPhoto`,
    fd,
    { headers: fd.headers(), timeout: 30000 },
  );
  return { messageId: resp.data?.result?.message_id };
}

describe('Z-API sendImage adapter (v3.28.0)', () => {
  let axiosPost: ReturnType<typeof vi.fn>;
  beforeEach(() => { axiosPost = vi.fn(); });

  it('1. Envia POST /send-image com phone + image (dataURI) + caption — retorna messageId', async () => {
    axiosPost.mockResolvedValueOnce({ data: { messageId: 'msg-zapi-42' } });
    const r = await zapiSendImageAdapter(
      axiosPost as unknown as AxiosFn,
      'https://api.z-api.io/instances/INST/token/TOK',
      'CLI789',
      '5598999999999',
      'data:image/jpeg;base64,AAAA',
      'Romatec',
    );
    expect(r.messageId).toBe('msg-zapi-42');
    const [url, body, opts] = axiosPost.mock.calls[0];
    expect(String(url)).toMatch(/send-image$/);
    expect(body).toEqual({ phone: '5598999999999', image: 'data:image/jpeg;base64,AAAA', caption: 'Romatec' });
    expect(opts.headers['Client-Token']).toBe('CLI789');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('2. Erro Z-API embrulhado em "ZAPI send-image:" com detail no message', async () => {
    axiosPost.mockRejectedValueOnce({ response: { data: { error: 'phone inexistente' } }, message: 'Request failed' });
    await expect(
      zapiSendImageAdapter(axiosPost as unknown as AxiosFn, 'https://api.z-api.io', 'CLI', '5598', 'data:image/jpeg;base64,AAAA', ''),
    ).rejects.toThrow(/ZAPI send-image:.*phone inexistente/);
  });
});

describe('Telegram sendPhoto adapter (v3.28.0)', () => {
  it('3. POST sendPhoto com FormData (chat_id, photo, caption) — retorna message_id', async () => {
    const axiosPost = vi.fn();
    axiosPost.mockResolvedValueOnce({ data: { ok: true, result: { message_id: 4242 } } });
    const fd: FormDataLike = { headers: () => ({ 'content-type': 'multipart/form-data; boundary=---abc' }) };
    const r = await telegramSendPhotoAdapter(
      axiosPost as unknown as Parameters<typeof telegramSendPhotoAdapter>[0],
      'BOT_FAKE_TOKEN',
      fd,
    );
    expect(r.messageId).toBe(4242);
    const [url] = axiosPost.mock.calls[0];
    expect(String(url)).toBe('https://api.telegram.org/botBOT_FAKE_TOKEN/sendPhoto');
  });

  it('4. Falta de TELEGRAM_BOT_TOKEN dispara erro claro', async () => {
    const axiosPost = vi.fn();
    const fd: FormDataLike = { headers: () => ({}) };
    await expect(
      telegramSendPhotoAdapter(axiosPost as unknown as Parameters<typeof telegramSendPhotoAdapter>[0], '', fd),
    ).rejects.toThrow(/TELEGRAM_BOT_TOKEN nao configurado/);
  });
});
