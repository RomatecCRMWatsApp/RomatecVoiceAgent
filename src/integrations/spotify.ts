import axios, { AxiosError, AxiosRequestConfig } from 'axios';

// Spotify Web API client com Authorization Code Flow + Refresh Token rotation.
// Token cacheado em memória (~55min, expires_in real é 3600s).
// Em 401, invalida cache e tenta uma vez mais.

const ACCOUNTS = 'https://accounts.spotify.com';
const BASE_URL = 'https://api.spotify.com/v1';

// Conjunto completo de scopes (8) — autorizado uma vez no fluxo OAuth, evita
// reauth quando precisarmos adicionar features novas (sync de playlists etc).
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

let _accessToken: { value: string; expiresAt: number } | null = null;
let _refreshInFlight: Promise<string> | null = null;

function basicAuth(): string {
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify: faltam SPOTIFY_CLIENT_ID e/ou SPOTIFY_CLIENT_SECRET no Railway.');
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      'Spotify: SPOTIFY_REFRESH_TOKEN não configurado. Acesse /auth/spotify no navegador, autorize, e adicione o token retornado no Railway.',
    );
  }
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });
  const resp = await axios.post<{ access_token: string; expires_in: number }>(
    `${ACCOUNTS}/api/token`,
    body.toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    },
  );
  const ttl = (resp.data.expires_in - 60) * 1000; // margem de 60s
  _accessToken = { value: resp.data.access_token, expiresAt: Date.now() + ttl };
  return resp.data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (_accessToken && Date.now() < _accessToken.expiresAt) return _accessToken.value;
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = refreshAccessToken().finally(() => { _refreshInFlight = null; });
  return _refreshInFlight;
}

function invalidateToken(): void { _accessToken = null; }

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const exec = async (): Promise<T> => {
    const token = await getAccessToken();
    const resp = await axios.request<T>({
      baseURL: BASE_URL,
      timeout: 10000,
      ...config,
      headers: { ...(config.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    return resp.data;
  };

  try {
    return await exec();
  } catch (err) {
    const ax = err as AxiosError<{ error?: { status?: number; message?: string } }>;
    const status = ax.response?.status;
    if (status === 401) {
      invalidateToken();
      return await exec();
    }
    if (status === 403) {
      throw new Error('Spotify (403): operação requer Spotify Premium, ou conta sem permissão para esta ação.');
    }
    if (status === 404) {
      throw new Error('Spotify (404): nenhum dispositivo ativo encontrado. Abra o Spotify em algum dispositivo (PC, celular, etc) e tente de novo.');
    }
    if (status === 429) {
      const retry = ax.response?.headers?.['retry-after'];
      throw new Error(`Spotify (429): rate limit excedido. Tente em ${retry ?? '?'} segundos.`);
    }
    const msg = ax.response?.data?.error?.message ?? ax.message;
    throw new Error(`Spotify: ${msg}`);
  }
}

// ── OAuth flow helpers (chamados pelo server.ts) ────────────────────────────

export function getAuthUrl(state: string): string {
  const id          = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!id || !redirectUri) {
    throw new Error('Spotify: faltam SPOTIFY_CLIENT_ID e/ou SPOTIFY_REDIRECT_URI no Railway.');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     id,
    scope:         SCOPES,
    redirect_uri:  redirectUri,
    state,
    show_dialog:   'false',
  });
  return `${ACCOUNTS}/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<string> {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? '';
  const body = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const resp = await axios.post<{ refresh_token: string; access_token: string; expires_in: number }>(
    `${ACCOUNTS}/api/token`,
    body.toString(),
    {
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    },
  );
  // Aproveita pra cachear o access_token novo já que foi emitido junto
  _accessToken = {
    value:     resp.data.access_token,
    expiresAt: Date.now() + (resp.data.expires_in - 60) * 1000,
  };
  return resp.data.refresh_token;
}

// ── Tools (consumidos por executeTool em src/agent/tools.ts) ────────────────

interface SpotifyTrack {
  uri:     string;
  name:    string;
  artists: { name: string }[];
  album?:  { name: string };
}

interface SpotifyCurrentlyPlaying {
  is_playing: boolean;
  progress_ms?: number;
  item?: SpotifyTrack;
}

interface SpotifySearchResult {
  tracks: { items: SpotifyTrack[] };
}

export async function tocarMusica(args: { query?: string; uri?: string }): Promise<{ tocando: string; uri: string }> {
  let trackUri = args.uri;
  let label    = '(retomado)';

  if (!trackUri && args.query) {
    const r = await request<SpotifySearchResult>({
      method: 'GET',
      url:    '/search',
      params: { q: args.query, type: 'track', limit: 1, market: 'BR' },
    });
    const item = r.tracks.items[0];
    if (!item) throw new Error(`Spotify: nenhuma música encontrada para "${args.query}".`);
    trackUri = item.uri;
    label    = `${item.name} — ${item.artists.map(a => a.name).join(', ')}`;
  }

  if (trackUri) {
    await request<unknown>({ method: 'PUT', url: '/me/player/play', data: { uris: [trackUri] } });
  } else {
    await request<unknown>({ method: 'PUT', url: '/me/player/play' });
  }
  return { tocando: label, uri: trackUri ?? '' };
}

export async function pausarMusica(): Promise<{ ok: true }> {
  await request<unknown>({ method: 'PUT', url: '/me/player/pause' });
  return { ok: true };
}

export async function pularProxima(): Promise<{ ok: true }> {
  await request<unknown>({ method: 'POST', url: '/me/player/next' });
  return { ok: true };
}

export async function pularAnterior(): Promise<{ ok: true }> {
  await request<unknown>({ method: 'POST', url: '/me/player/previous' });
  return { ok: true };
}

export async function musicaAtual(): Promise<{
  tocando:      string | null;
  artistas?:    string;
  album?:       string;
  progresso_ms?: number;
  is_playing?:  boolean;
}> {
  try {
    const data = await request<SpotifyCurrentlyPlaying | ''>({ method: 'GET', url: '/me/player/currently-playing' });
    // 204 No Content => string vazia em axios
    if (!data || typeof data === 'string' || !data.item) return { tocando: null };
    return {
      tocando:      data.item.name,
      artistas:     data.item.artists?.map(a => a.name).join(', '),
      album:        data.item.album?.name,
      progresso_ms: data.progress_ms,
      is_playing:   data.is_playing,
    };
  } catch (err) {
    // Se nada está tocando, alguns endpoints respondem 204; tratamos como null.
    if ((err as Error).message.includes('204')) return { tocando: null };
    throw err;
  }
}
