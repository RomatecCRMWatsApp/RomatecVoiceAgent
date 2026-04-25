import axios from 'axios';
import { Lead, Agendamento, Campanha } from '../types';

const client = axios.create({
  baseURL: process.env.CRM_BASE_URL,
  headers: { 'x-api-key': process.env.CRM_API_KEY },
  timeout: 10000,
});

export async function listarLeads(filtros?: { status?: string; limite?: number }): Promise<Lead[]> {
  const { data } = await client.get('/api/leads', { params: filtros });
  return data;
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
  return data;
}

export async function statusCampanha(id: string): Promise<Campanha> {
  const { data } = await client.get(`/api/campaigns/${id}`);
  return data;
}
