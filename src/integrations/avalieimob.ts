import axios from 'axios';
import { Cliente, Contrato } from '../types';

const client = axios.create({
  baseURL: process.env.AVALIEIMOB_BASE_URL,
  headers: { Authorization: `Bearer ${process.env.AVALIEIMOB_API_KEY}` },
  timeout: 10000,
});

// Detecta 401 (token expirado) e outros erros comuns
client.interceptors.response.use(
  response => {
    const ct = String(response.headers['content-type'] ?? '');
    if (ct.includes('text/html')) {
      throw new Error(
        `AvalieImob retornou HTML em vez de JSON — verifique AVALIEIMOB_BASE_URL (atual: ${process.env.AVALIEIMOB_BASE_URL})`,
      );
    }
    return response;
  },
  error => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401) {
        throw new Error(
          'AvalieImob: token expirado ou inválido (401) — ' +
          'acesse o Railway e atualize a variável AVALIEIMOB_API_KEY com um token válido',
        );
      }
      if (status === 403) {
        throw new Error('AvalieImob: acesso negado (403) — o token não tem permissão para este recurso');
      }
      if (status === 404) {
        throw new Error(`AvalieImob: rota não encontrada (404) — verifique AVALIEIMOB_BASE_URL`);
      }
    }
    return Promise.reject(error);
  },
);

export async function listarContratos(filtros?: { status?: string }): Promise<Contrato[]> {
  const { data } = await client.get('/api/contratos', { params: filtros });
  return Array.isArray(data) ? data : (data.contratos ?? data.data ?? []);
}

export async function buscarCliente(nome: string): Promise<Cliente[]> {
  const { data } = await client.get('/api/clientes', { params: { nome } });
  return Array.isArray(data) ? data : (data.clientes ?? data.data ?? []);
}

export async function gerarAvaliacao(payload: {
  cliente_id: string;
  tipo: string;
  endereco: string;
  area?: number;
}): Promise<{ id: string; numero_ptam: string }> {
  const { data } = await client.post('/api/avaliacoes', payload);
  return data;
}

export async function statusServicos(): Promise<{ online: boolean; version?: string }> {
  const { data } = await client.get('/api/');
  return { online: true, version: data.version };
}
