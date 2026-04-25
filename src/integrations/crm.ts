import axios from 'axios';
import { Lead, Agendamento, Campanha } from '../types';

const client = axios.create({
  baseURL: process.env.CRM_BASE_URL,
  headers: { 'x-api-key': process.env.CRM_API_KEY },
  timeout: 10000,
});

// Detecta quando o CRM retorna HTML do frontend em vez de JSON da API
client.interceptors.response.use(
  response => {
    const ct = String(response.headers['content-type'] ?? '');
    if (ct.includes('text/html')) {
      throw new Error(
        `CRM retornou HTML em vez de JSON — verifique CRM_BASE_URL (atual: ${process.env.CRM_BASE_URL}) ` +
        `e confirme que as rotas /api/leads e /api/campanhas existem no backend.`,
      );
    }
    return response;
  },
  error => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new Error(`CRM: autenticação falhou (${status}) — verifique CRM_API_KEY no Railway`);
      }
      if (status === 404) {
        throw new Error(`CRM: rota não encontrada (404) — verifique CRM_BASE_URL e as rotas da API`);
      }
    }
    return Promise.reject(error);
  },
);

export async function listarLeads(filtros?: { status?: string; limite?: number }): Promise<Lead[]> {
  const { data } = await client.get('/api/leads', { params: filtros });
  return Array.isArray(data) ? data : (data.leads ?? data.data ?? []);
}

export async function buscarLead(id: string): Promise<Lead> {
  const { data } = await client.get(`/api/leads/${id}`);
  return data;
}

export async function criarAgendamento(agendamento: Agendamento): Promise<Agendamento> {
  const { data } = await client.post('/api/agenda', agendamento);
  return data;
}

export async function listarCampanhas(): Promise<Campanha[]> {
  const { data } = await client.get('/api/campaigns');
  return Array.isArray(data) ? data : (data.campaigns ?? data.data ?? []);
}

export async function statusCampanha(id: string): Promise<Campanha> {
  const { data } = await client.get(`/api/campaigns/${id}`);
  return data;
}
