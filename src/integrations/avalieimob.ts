import axios from 'axios';
import { Cliente, Contrato } from '../types';

const client = axios.create({
  baseURL: process.env.AVALIEIMOB_BASE_URL,
  headers: { Authorization: `Bearer ${process.env.AVALIEIMOB_API_KEY}` },
  timeout: 10000,
});

export async function listarContratos(filtros?: { status?: string }): Promise<Contrato[]> {
  const { data } = await client.get('/api/contratos', { params: filtros });
  return data;
}

export async function buscarCliente(nome: string): Promise<Cliente[]> {
  const { data } = await client.get('/api/clientes', { params: { nome } });
  return data;
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
