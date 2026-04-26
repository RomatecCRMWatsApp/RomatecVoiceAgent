import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { Cliente, Contrato } from '../types';
import { formatBR } from '../util/format';

// AvalieImob é um SaaS multi-tenant (FastAPI + MongoDB) com JWT HS256 (168h).
// ZAYRA loga com email+senha do CEO uma vez e cacheia o JWT até ~6 dias depois.
// Em 401, invalida o cache e tenta uma vez mais.

const BASE_URL = process.env.AVALIEIMOB_BASE_URL ?? '';
const TOKEN_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 dias (margem de 24h sob os 168h do JWT)

let _token: { value: string; expiresAt: number } | null = null;
let _loginInFlight: Promise<string> | null = null;

async function login(): Promise<string> {
  const email    = process.env.AVALIEIMOB_EMAIL;
  const password = process.env.AVALIEIMOB_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'AvalieImob: faltam AVALIEIMOB_EMAIL e/ou AVALIEIMOB_PASSWORD no Railway.',
    );
  }
  const resp = await axios.post<{ token: string; user?: unknown }>(
    `${BASE_URL}/api/auth/login`,
    { email, password },
    { timeout: 10000 },
  );
  const token = resp.data?.token;
  if (!token) throw new Error('AvalieImob: login sem token na resposta.');
  _token = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt) return _token.value;
  if (_loginInFlight) return _loginInFlight;
  _loginInFlight = login().finally(() => { _loginInFlight = null; });
  return _loginInFlight;
}

function invalidateToken(): void {
  _token = null;
}

const client = axios.create({ baseURL: BASE_URL, timeout: 10000 });

client.interceptors.request.use(async (config) => {
  const token = await getToken();
  config.headers = config.headers ?? {};
  (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  return config;
});

// Helper that retries once after invalidating token on 401.
async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const { data, headers } = await client.request<T>(config);
    const ct = String(headers['content-type'] ?? '');
    if (ct.includes('text/html')) {
      throw new Error(
        `AvalieImob: retornou HTML em vez de JSON — verifique AVALIEIMOB_BASE_URL (atual: ${BASE_URL})`,
      );
    }
    return data;
  } catch (err) {
    const ax = err as AxiosError;
    const status = ax.response?.status;
    if (status === 401) {
      invalidateToken();
      // single retry with a fresh token
      const { data } = await client.request<T>(config);
      return data;
    }
    if (status === 403) {
      throw new Error(
        'AvalieImob (403): acesso negado — verifique se a conta tem assinatura ativa (mensal/trimestral/anual).',
      );
    }
    if (status === 404) {
      throw new Error(`AvalieImob (404): rota não encontrada — ${config.url}`);
    }
    throw err;
  }
}

// ── Tools de leitura ──────────────────────────────────────────────────────────

interface RawContrato {
  id?:                string;
  numero_contrato?:   string;
  tipo_contrato?:     string;
  status?:            string;
  data_assinatura?:   string;
  vendedores?:        unknown[];
  compradores?:       unknown[];
  created_at?:        string;
}

export async function listarContratos(filtros?: { status?: string }): Promise<Contrato[]> {
  const params: Record<string, string> = {};
  if (filtros?.status) params.status = filtros.status;

  const data = await request<RawContrato[]>({ method: 'GET', url: '/api/contratos', params });
  const arr = Array.isArray(data) ? data : [];
  return arr.map(c => ({
    id:         String(c.id ?? ''),
    cliente_id: '',
    tipo:       c.tipo_contrato ?? '',
    status:     c.status ?? 'pendente',
    valor:      undefined,
    created_at: formatBR(c.created_at ?? c.data_assinatura ?? new Date()),
  }));
}

interface RawClient {
  id:          string;
  user_id?:    string;
  name:        string;
  type?:       string;
  doc?:        string;
  phone?:      string;
  email?:      string;
  city?:       string;
  created_at?: string;
}

export async function buscarCliente(nome: string): Promise<Cliente[]> {
  // /api/clients não tem filtro por nome — listar todos e filtrar client-side
  const data = await request<RawClient[]>({ method: 'GET', url: '/api/clients' });
  const all  = Array.isArray(data) ? data : [];
  const q    = nome.trim().toLowerCase();
  if (!q) return all.map(rawClientToCliente);
  return all
    .filter(c => (c.name ?? '').toLowerCase().includes(q))
    .map(rawClientToCliente);
}

function rawClientToCliente(c: RawClient): Cliente {
  return {
    id:        c.id,
    nome:      c.name,
    cpf_cnpj:  c.doc,
    telefone:  c.phone,
    email:     c.email,
    cidade:    c.city,
  };
}

// ── Criar PTAM (avaliação) ────────────────────────────────────────────────────

export async function gerarAvaliacao(payload: {
  cliente_id: string;
  tipo:       string;
  endereco:   string;
  area?:      number;
}): Promise<{ id: string; numero_ptam: string }> {
  // Tenta buscar dados do cliente para preencher solicitante_*
  let solicitante_nome     = '';
  let solicitante_cpf_cnpj = '';
  let solicitante_telefone = '';
  let solicitante_email    = '';
  if (payload.cliente_id) {
    try {
      const cliente = await request<RawClient>({
        method: 'GET',
        url:    `/api/clients/${encodeURIComponent(payload.cliente_id)}`,
      });
      solicitante_nome     = cliente?.name  ?? '';
      solicitante_cpf_cnpj = cliente?.doc   ?? '';
      solicitante_telefone = cliente?.phone ?? '';
      solicitante_email    = cliente?.email ?? '';
    } catch {
      /* se cliente não existe ou rota não suporta /:id, segue sem */
    }
  }

  // PtamBase tem ~80 campos, todos opcionais — preenchemos só o essencial.
  const body: Record<string, unknown> = {
    solicitante_nome,
    solicitante_cpf_cnpj,
    solicitante_telefone,
    solicitante_email,
    solicitante_endereco: payload.endereco,
    purpose:    payload.tipo,
    finalidade: payload.tipo,
  };
  if (typeof payload.area === 'number') {
    body.area_terreno = payload.area;
  }

  const data = await request<{ id: string; numero_ptam: string }>({
    method: 'POST',
    url:    '/api/ptam',
    data:   body,
  });
  return { id: data.id, numero_ptam: data.numero_ptam };
}

// ── Status / health ───────────────────────────────────────────────────────────

export async function statusServicos(): Promise<{ online: boolean; version?: string }> {
  // /api/auth/me é um endpoint barato que valida JWT + retorna user_id.
  // Se autenticar, AvalieImob está online E o JWT é válido.
  await request<unknown>({ method: 'GET', url: '/api/auth/me' });
  return { online: true };
}
