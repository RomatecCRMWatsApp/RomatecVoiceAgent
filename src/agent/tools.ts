import Anthropic from '@anthropic-ai/sdk';
import * as crm from '../integrations/crm';
import * as avalieimob from '../integrations/avalieimob';
import * as calendar from '../integrations/calendar';
import { sendReply } from '../integrations/whatsapp';
import { saveMemory, searchMemory, listMemories, deleteMemory, saveConversation } from './memory';
import { ResumoDia, ToolResult } from '../types';
import axios from 'axios';

interface Colaborador { nome: string; cargo: string; telefone: string; }

function getColaboradores(): Colaborador[] {
  if (process.env.TEAM_JSON) {
    try { return JSON.parse(process.env.TEAM_JSON) as Colaborador[]; } catch {}
  }
  return [
    { nome: 'José Romário', cargo: 'CEO', telefone: process.env.CEO_WHATSAPP_PHONE ?? '' },
  ];
}

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
  {
    name: 'criar_evento',
    description: 'Cria um evento no Google Calendar.',
    input_schema: {
      type: 'object',
      properties: {
        titulo:      { type: 'string', description: 'Título do evento' },
        data:        { type: 'string', description: 'Data YYYY-MM-DD' },
        hora_inicio: { type: 'string', description: 'Hora de início HH:MM' },
        hora_fim:    { type: 'string', description: 'Hora de fim HH:MM' },
        descricao:   { type: 'string', description: 'Descrição opcional' },
      },
      required: ['titulo', 'data', 'hora_inicio', 'hora_fim'],
    },
  },
  {
    name: 'listar_eventos_hoje',
    description: 'Lista eventos do Google Calendar para hoje.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_eventos_semana',
    description: 'Lista eventos do Google Calendar para os próximos 7 dias.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancelar_evento',
    description: 'Cancela um evento do Google Calendar pelo ID.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'ID do evento' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'salvar_memoria',
    description: 'Salva um fato, preferência, decisão, contexto ou lembrete na memória persistente do ZAYRA.',
    input_schema: {
      type: 'object',
      properties: {
        type:           { type: 'string', description: 'Tipo: fact | preference | decision | context | reminder' },
        content:        { type: 'string', description: 'Conteúdo da memória' },
        relevance_tags: { type: 'string', description: 'Tags separadas por vírgula para busca futura' },
        expires_at:     { type: 'string', description: 'Data de expiração opcional (YYYY-MM-DD)' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'buscar_memoria',
    description: 'Busca memórias persistentes relevantes por palavra-chave. Use antes de responder sobre o passado.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Palavra-chave ou frase para buscar' },
        type:  { type: 'string', description: 'Filtrar por tipo (opcional): fact | preference | decision | context | reminder' },
      },
      required: ['query'],
    },
  },
  {
    name: 'listar_memorias',
    description: 'Lista todas as memórias persistentes ativas, agrupadas por tipo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'deletar_memoria',
    description: 'Remove uma memória persistente por ID.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'ID da memória a deletar' },
      },
      required: ['id'],
    },
  },
  {
    name: 'salvar_mensagem',
    description: 'Salva uma mensagem no histórico de conversas no banco de dados.',
    input_schema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'ID da sessão' },
        role:       { type: 'string', description: '"user" ou "assistant"' },
        content:    { type: 'string', description: 'Conteúdo da mensagem' },
      },
      required: ['session_id', 'role', 'content'],
    },
  },
  {
    name: 'buscar_historico',
    description: 'Busca as últimas mensagens de uma sessão no histórico persistido.',
    input_schema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'ID da sessão' },
        limit:      { type: 'number', description: 'Número máximo de mensagens (padrão 20)' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'enviar_whatsapp',
    description: 'Envia uma mensagem de texto via WhatsApp para um número específico através do CRM.',
    input_schema: {
      type: 'object',
      properties: {
        para:     { type: 'string', description: 'Número do destinatário com DDI e DDD (ex: 5598991234567)' },
        mensagem: { type: 'string', description: 'Texto da mensagem a enviar' },
      },
      required: ['para', 'mensagem'],
    },
  },
  {
    name: 'listar_colaboradores',
    description: 'Lista os colaboradores da equipe Romatec com nome, cargo e telefone.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'delegar_tarefa',
    description: 'Delega uma tarefa a um membro da equipe Romatec enviando uma mensagem formatada via WhatsApp.',
    input_schema: {
      type: 'object',
      properties: {
        colaborador_nome: { type: 'string', description: 'Nome (ou parte do nome) do colaborador' },
        tarefa:           { type: 'string', description: 'Descrição da tarefa a delegar' },
        prazo:            { type: 'string', description: 'Prazo para conclusão (opcional, ex: "hoje às 18h", "sexta-feira")' },
      },
      required: ['colaborador_nome', 'tarefa'],
    },
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
      case 'criar_evento':
        data = await calendar.criarEvento(input as Parameters<typeof calendar.criarEvento>[0]);
        break;
      case 'listar_eventos_hoje':
        data = await calendar.listarEventosDia();
        break;
      case 'listar_eventos_semana':
        data = await calendar.listarEventosSemana();
        break;
      case 'cancelar_evento':
        await calendar.cancelarEvento(input.event_id as string);
        data = { success: true, message: 'Evento cancelado.' };
        break;
      case 'salvar_memoria':
        data = {
          id: await saveMemory(
            input.type as Parameters<typeof saveMemory>[0],
            input.content as string,
            input.relevance_tags as string | undefined,
            input.expires_at as string | undefined,
          ),
          message: 'Memória salva com sucesso.',
        };
        break;
      case 'buscar_memoria':
        data = await searchMemory(input.query as string, input.type as string | undefined);
        break;
      case 'listar_memorias':
        data = await listMemories();
        break;
      case 'deletar_memoria':
        await deleteMemory(input.id as number);
        data = { success: true, message: 'Memória deletada.' };
        break;
      case 'salvar_mensagem':
        await saveConversation(
          input.session_id as string,
          input.role as 'user' | 'assistant',
          input.content as string,
        );
        data = { success: true };
        break;
      case 'buscar_historico': {
        const limit = (input.limit as number | undefined) ?? 20;
        const connModule = await import('../database/connection');
        const [rows] = await connModule.default.execute<import('mysql2').RowDataPacket[]>(
          'SELECT role, content, created_at FROM zayra_conversations WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
          [input.session_id as string, limit],
        );
        data = [...rows].reverse();
        break;
      }
      case 'enviar_whatsapp': {
        const { para, mensagem } = input as { para: string; mensagem: string };
        await sendReply(para, mensagem);
        data = { success: true, para, mensagem, enviado_em: new Date().toISOString() };
        break;
      }
      case 'listar_colaboradores':
        data = getColaboradores();
        break;
      case 'delegar_tarefa': {
        const { colaborador_nome, tarefa, prazo } = input as { colaborador_nome: string; tarefa: string; prazo?: string };
        const equipe = getColaboradores();
        const membro = equipe.find(c => c.nome.toLowerCase().includes(colaborador_nome.toLowerCase()));
        if (!membro) throw new Error(`Colaborador "${colaborador_nome}" não encontrado na equipe.`);
        if (!membro.telefone) throw new Error(`Telefone não configurado para ${membro.nome} — adicione ao TEAM_JSON.`);
        const prazoStr = prazo ? `\n*Prazo:* ${prazo}` : '';
        const msg = `🤖 *ZAYRA — Romatec*\n\n*Delegação de Tarefa*\n\n*Para:* ${membro.nome}\n*Cargo:* ${membro.cargo}\n*Tarefa:* ${tarefa}${prazoStr}\n\n_Delegado pelo CEO José Romário_`;
        await sendReply(membro.telefone, msg);
        data = { success: true, delegado_para: membro.nome, tarefa };
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
