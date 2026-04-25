import Anthropic from '@anthropic-ai/sdk';
import * as crm from '../integrations/crm';
import * as avalieimob from '../integrations/avalieimob';
import { ResumoDia, ToolResult } from '../types';
import axios from 'axios';

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'listar_leads',
    description: 'Lista leads do CRM WhatsApp, opcionalmente filtrando por status e limite.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filtrar por status (ex: novo, em_atendimento, convertido)' },
        limite: { type: 'number', description: 'Máximo de registros a retornar' },
      },
    },
  },
  {
    name: 'buscar_lead',
    description: 'Busca um lead específico pelo ID no CRM.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID do lead' },
      },
      required: ['id'],
    },
  },
  {
    name: 'criar_agendamento',
    description: 'Cria um agendamento de visita ou reunião para um lead.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'ID do lead' },
        data: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        hora: { type: 'string', description: 'Hora no formato HH:MM' },
        tipo: { type: 'string', description: 'Tipo de agendamento (visita, reunião, ligação)' },
        observacoes: { type: 'string', description: 'Observações adicionais' },
      },
      required: ['lead_id', 'data', 'hora', 'tipo'],
    },
  },
  {
    name: 'listar_campanhas',
    description: 'Lista campanhas de WhatsApp do CRM.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'status_campanha',
    description: 'Retorna métricas detalhadas de uma campanha específica.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID da campanha' },
      },
      required: ['id'],
    },
  },
  {
    name: 'listar_contratos',
    description: 'Lista contratos do AvalieImob.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filtrar por status (pendente, assinado, cancelado)' },
      },
    },
  },
  {
    name: 'buscar_cliente',
    description: 'Busca clientes no AvalieImob pelo nome.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome ou parte do nome do cliente' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'gerar_avaliacao',
    description: 'Inicia uma nova avaliação imobiliária no AvalieImob.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string', description: 'ID do cliente' },
        tipo: { type: 'string', description: 'Tipo de avaliação (PTAM, Garantia, Locação)' },
        endereco: { type: 'string', description: 'Endereço completo do imóvel' },
        area: { type: 'number', description: 'Área do imóvel em m²' },
      },
      required: ['cliente_id', 'tipo', 'endereco'],
    },
  },
  {
    name: 'status_railway',
    description: 'Verifica se os serviços CRM e AvalieImob estão online.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'resumo_dia',
    description: 'Gera um briefing completo do dia com dados dos dois sistemas.',
    input_schema: { type: 'object', properties: {} },
  },
];

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    let data: unknown;

    switch (name) {
      case 'listar_leads':
        data = await crm.listarLeads(input as { status?: string; limite?: number });
        break;
      case 'buscar_lead':
        data = await crm.buscarLead(input.id as string);
        break;
      case 'criar_agendamento':
        data = await crm.criarAgendamento(input as unknown as Parameters<typeof crm.criarAgendamento>[0]);
        break;
      case 'listar_campanhas':
        data = await crm.listarCampanhas();
        break;
      case 'status_campanha':
        data = await crm.statusCampanha(input.id as string);
        break;
      case 'listar_contratos':
        data = await avalieimob.listarContratos(input as { status?: string });
        break;
      case 'buscar_cliente':
        data = await avalieimob.buscarCliente(input.nome as string);
        break;
      case 'gerar_avaliacao':
        data = await avalieimob.gerarAvaliacao(input as Parameters<typeof avalieimob.gerarAvaliacao>[0]);
        break;
      case 'status_railway': {
        const [crmStatus, imobStatus] = await Promise.allSettled([
          axios.get(`${process.env.CRM_BASE_URL}/health`, { timeout: 5000 }),
          avalieimob.statusServicos(),
        ]);
        data = {
          crm: crmStatus.status === 'fulfilled' ? 'online' : 'offline',
          avalieimob: imobStatus.status === 'fulfilled' ? 'online' : 'offline',
        };
        break;
      }
      case 'resumo_dia': {
        const [leads, contratos, campanhas] = await Promise.allSettled([
          crm.listarLeads({ limite: 100 }),
          avalieimob.listarContratos({ status: 'pendente' }),
          crm.listarCampanhas(),
        ]);
        const resumo: ResumoDia = {
          data: new Date().toLocaleDateString('pt-BR'),
          leads_novos: leads.status === 'fulfilled' ? leads.value.filter((l) => l.status === 'novo').length : 0,
          agendamentos_hoje: 0,
          contratos_pendentes: contratos.status === 'fulfilled' ? contratos.value.length : 0,
          campanhas_ativas:
            campanhas.status === 'fulfilled' ? campanhas.value.filter((c) => c.status === 'ativa').length : 0,
          servicos_online: true,
        };
        data = resumo;
        break;
      }
      default:
        return { toolName: name, success: false, error: `Tool desconhecida: ${name}` };
    }

    return { toolName: name, success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { toolName: name, success: false, error: message };
  }
}
