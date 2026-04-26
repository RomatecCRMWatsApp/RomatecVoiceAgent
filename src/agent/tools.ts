import Anthropic from '@anthropic-ai/sdk';
import * as crm from '../integrations/crm';
import * as avalieimob from '../integrations/avalieimob';
import * as calendar from '../integrations/calendar';
import * as spotify from '../integrations/spotify';
import * as telegram from '../integrations/telegram';
import * as filesystem from '../integrations/filesystem';
import { sendReply } from '../integrations/whatsapp';
import {
  saveMemory, searchMemory, listMemories, deleteMemory,
  saveConversation, searchConversations, listChatSessions, getSessionMessages,
} from './memory';
import { ResumoDia, ToolResult } from '../types';
import pool from '../database/connection';

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
    description: 'Lista leads do CRM WhatsApp (tabela leadQualifications), opcionalmente filtrando por score e limite.',
    input_schema: {
      type: 'object',
      properties: {
        score:  { type: 'string', enum: ['quente', 'morno', 'frio'], description: 'Filtrar por classificação do lead (quente, morno, frio)' },
        limite: { type: 'number', description: 'Máximo de registros a retornar (padrão 50, máx 500)' },
      },
    },
  },
  {
    name: 'buscar_lead',
    description: 'Busca um lead específico pelo ID no CRM.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID do lead (numérico, vindo do leadQualifications.id)' },
      },
      required: ['id'],
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
    description: 'Busca em todas as conversas anteriores. Use "query" para buscar por palavra-chave/assunto (ex: "lead Maria"), ou "session_id" para retomar uma sessão específica.',
    input_schema: {
      type: 'object',
      properties: {
        query:      { type: 'string', description: 'Palavra-chave/assunto para buscar nas conversas anteriores' },
        session_id: { type: 'string', description: 'ID de sessão específica para retornar todas as mensagens dela' },
        limit:      { type: 'number', description: 'Número máximo de resultados (padrão 20)' },
      },
    },
  },
  {
    name: 'listar_conversas',
    description: 'Lista as conversas anteriores mais recentes com título, canal e contagem de mensagens.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Quantas conversas listar (padrão 20)' },
      },
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
    name: 'crm_criar_lead',
    description: 'Cria um lead novo no CRM (tabela leadQualifications). DESTRUTIVO. Sempre rode primeiro sem "confirm" pra ver preview, peça autorização verbal ao CEO, depois rode com "confirm: true".',
    input_schema: {
      type: 'object',
      properties: {
        phone:          { type: 'string', description: 'Telefone com DDI+DDD (só dígitos, ex: 5599999887766)' },
        nome:           { type: 'string' },
        score:          { type: 'string', enum: ['quente','morno','frio'] },
        campanhaOrigem: { type: 'string' },
        confirm:        { type: 'boolean', description: 'Só passar true APÓS autorização explícita do CEO' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'crm_atualizar_lead',
    description: 'Atualiza campos de um lead existente. DESTRUTIVO em produção — exige preview antes (sem confirm) + autorização verbal do CEO antes de "confirm: true".',
    input_schema: {
      type: 'object',
      properties: {
        id:            { type: 'string' },
        nome:          { type: 'string' },
        score:         { type: 'string', enum: ['quente','morno','frio'] },
        stage:         { type: 'string' },
        discardReason: { type: 'string' },
        confirm:       { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'crm_apagar_lead',
    description: 'APAGA permanentemente um lead. AÇÃO IRREVERSÍVEL. Sempre mostre preview ao CEO e EXIJA confirmação verbal ("sim, apague") antes de passar "confirm: true".',
    input_schema: {
      type: 'object',
      properties: {
        id:      { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'crm_criar_contato',
    description: 'Cria contato no CRM. Exige confirm: true após autorização do CEO.',
    input_schema: {
      type: 'object',
      properties: {
        name:    { type: 'string' },
        phone:   { type: 'string' },
        email:   { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'crm_atualizar_contato',
    description: 'Atualiza contato existente. Exige confirm: true após autorização.',
    input_schema: {
      type: 'object',
      properties: {
        id:      { type: 'string' },
        name:    { type: 'string' },
        phone:   { type: 'string' },
        email:   { type: 'string' },
        status:  { type: 'string', enum: ['active','blocked','inactive'] },
        confirm: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'crm_apagar_contato',
    description: 'APAGA contato. IRREVERSÍVEL. Confirmação verbal obrigatória antes de confirm: true.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'crm_atualizar_campanha',
    description: 'Atualiza campanha (status, nome, ativo dia/noite). Confirm exigido. Use status=running pra começar, paused pra pausar, completed pra encerrar.',
    input_schema: {
      type: 'object',
      properties: {
        id:          { type: 'string' },
        status:      { type: 'string', enum: ['draft','scheduled','running','paused','completed'] },
        name:        { type: 'string' },
        activeDay:   { type: 'boolean' },
        activeNight: { type: 'boolean' },
        confirm:     { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'crm_apagar_campanha',
    description: 'APAGA campanha. Mensagens relacionadas permanecem (apenas a campanha sai). IRREVERSÍVEL — exige confirmação verbal.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'enviar_telegram',
    description: 'Envia mensagem via Telegram para um chat_id autorizado. Use quando o CEO pedir para mandar algo via Telegram.',
    input_schema: {
      type: 'object',
      properties: {
        chat_id:  { type: 'string', description: 'chat_id do Telegram (numérico)' },
        mensagem: { type: 'string', description: 'Texto da mensagem (Markdown suportado)' },
      },
      required: ['chat_id', 'mensagem'],
    },
  },
  {
    name: 'status_telegram',
    description: 'Verifica saúde do bot Telegram da ZAYRA — retorna online/offline, username, webhook configurado e quantos updates pendentes.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'tocar_musica',
    description: 'Toca música no Spotify. Pode buscar por nome (query) ou tocar uma URI específica. Sem args, retoma reprodução pausada. Requer Spotify Premium e algum dispositivo ativo.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto de busca (ex: "Coldplay Yellow", "Anitta")' },
        uri:   { type: 'string', description: 'Spotify track URI (ex: spotify:track:abc123)' },
      },
    },
  },
  {
    name: 'pausar_musica',
    description: 'Pausa a reprodução atual no Spotify.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pular_proxima',
    description: 'Pula para a próxima música no Spotify.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pular_anterior',
    description: 'Volta para a música anterior no Spotify.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'musica_atual',
    description: 'Retorna a música que está tocando agora no Spotify (nome, artistas, álbum, progresso).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'fs_listar',
    description: 'Lista arquivos e subdiretórios de um caminho dentro dos diretórios autorizados (FS_ALLOWED_ROOTS). Use sem "caminho" pra listar a raiz padrão.',
    input_schema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho absoluto ou relativo à raiz autorizada (ex: "src/agent" ou "C:\\Users\\Ronicley Pinto\\Documents\\RomatecVoiceAgent\\src")' },
      },
    },
  },
  {
    name: 'fs_ler',
    description: 'Lê o conteúdo UTF-8 de um arquivo dentro dos diretórios autorizados. Trunca em 256KB.',
    input_schema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho do arquivo' },
      },
      required: ['caminho'],
    },
  },
  {
    name: 'fs_escrever',
    description: 'Escreve um arquivo (texto UTF-8) dentro dos diretórios autorizados. DESTRUTIVO. Sempre rode primeiro sem "confirm" pra ver preview, peça autorização ao CEO, depois rode com "confirm: true". Modos: criar (default, falha se existir), sobrescrever, anexar.',
    input_schema: {
      type: 'object',
      properties: {
        caminho:  { type: 'string', description: 'Caminho do arquivo' },
        conteudo: { type: 'string', description: 'Conteúdo UTF-8 a gravar (máx 1 MB)' },
        modo:     { type: 'string', enum: ['criar', 'sobrescrever', 'anexar'], description: 'criar = falha se já existir; sobrescrever = substitui; anexar = adiciona ao fim' },
        confirm:  { type: 'boolean', description: 'Só passar true APÓS autorização explícita do CEO' },
      },
      required: ['caminho', 'conteudo'],
    },
  },
  {
    name: 'fs_apagar',
    description: 'APAGA permanentemente arquivo ou diretório (recursivo). AÇÃO IRREVERSÍVEL. Sempre mostre preview ao CEO e EXIJA confirmação verbal antes de "confirm: true".',
    input_schema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho a remover' },
        confirm: { type: 'boolean' },
      },
      required: ['caminho'],
    },
  },
  {
    name: 'fs_buscar',
    description: 'Busca regex em arquivos de texto dentro de uma raiz autorizada (estilo grep). Pula node_modules/.git/dist/build/.obsidian. Limita 100 hits.',
    input_schema: {
      type: 'object',
      properties: {
        raiz:           { type: 'string', description: 'Raiz da busca (default: primeira raiz autorizada)' },
        padrao:         { type: 'string', description: 'Regex a buscar (ex: "function think", "TODO|FIXME")' },
        glob:           { type: 'string', description: 'Filtro de extensão (ex: "*.ts", "*.md")' },
        case_sensitive: { type: 'boolean', description: 'Default false' },
      },
      required: ['padrao'],
    },
  },
  {
    name: 'fs_raizes',
    description: 'Retorna lista de diretórios autorizados pra acesso ao filesystem (FS_ALLOWED_ROOTS).',
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
        const [crmCheck, imobCheck] = await Promise.allSettled([
          pool.query('SELECT 1'),
          avalieimob.statusServicos(),
        ]);
        data = {
          crm:        crmCheck.status  === 'fulfilled' ? 'online' : 'offline',
          avalieimob: imobCheck.status === 'fulfilled' ? 'online' : 'offline',
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
          leads_novos: leads.status === 'fulfilled'
            ? leads.value.filter((l) => l.score === 'quente').length
            : 0,
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
        const limit     = (input.limit as number | undefined) ?? 20;
        const query     = input.query     as string | undefined;
        const sessionId = input.session_id as string | undefined;
        if (sessionId) {
          const rows = await getSessionMessages(sessionId, limit);
          data = rows.map(r => ({ role: r.role, content: r.content, created_at: r.created_at }));
        } else if (query) {
          const hits = await searchConversations(query, limit);
          data = hits.map(h => ({
            session_id:    h.session_id,
            session_title: h.session_title,
            role:          h.role,
            content:       h.content,
            created_at:    h.created_at,
          }));
        } else {
          throw new Error('Informe "query" (busca por palavra-chave) ou "session_id".');
        }
        break;
      }
      case 'listar_conversas': {
        const limit    = (input.limit as number | undefined) ?? 20;
        const sessions = await listChatSessions(limit, 0);
        data = sessions.map(s => ({
          id:         s.id,
          title:      s.title,
          channel:    s.channel,
          msg_count:  s.msg_count,
          updated_at: s.updated_at,
        }));
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
      case 'crm_criar_lead':
        data = await crm.criarLead(input as Parameters<typeof crm.criarLead>[0]);
        break;
      case 'crm_atualizar_lead':
        data = await crm.atualizarLead(input as Parameters<typeof crm.atualizarLead>[0]);
        break;
      case 'crm_apagar_lead':
        data = await crm.apagarLead(input as Parameters<typeof crm.apagarLead>[0]);
        break;
      case 'crm_criar_contato':
        data = await crm.criarContato(input as Parameters<typeof crm.criarContato>[0]);
        break;
      case 'crm_atualizar_contato':
        data = await crm.atualizarContato(input as Parameters<typeof crm.atualizarContato>[0]);
        break;
      case 'crm_apagar_contato':
        data = await crm.apagarContato(input as Parameters<typeof crm.apagarContato>[0]);
        break;
      case 'crm_atualizar_campanha':
        data = await crm.atualizarCampanha(input as Parameters<typeof crm.atualizarCampanha>[0]);
        break;
      case 'crm_apagar_campanha':
        data = await crm.apagarCampanha(input as Parameters<typeof crm.apagarCampanha>[0]);
        break;
      case 'enviar_telegram': {
        const { chat_id, mensagem } = input as { chat_id: string; mensagem: string };
        await telegram.sendMessage(chat_id, mensagem);
        data = { success: true, chat_id, mensagem, enviado_em: new Date().toISOString() };
        break;
      }
      case 'status_telegram':
        data = await telegram.getBotInfo();
        break;
      case 'tocar_musica':
        data = await spotify.tocarMusica(input as { query?: string; uri?: string });
        break;
      case 'pausar_musica':
        data = await spotify.pausarMusica();
        break;
      case 'pular_proxima':
        data = await spotify.pularProxima();
        break;
      case 'pular_anterior':
        data = await spotify.pularAnterior();
        break;
      case 'musica_atual':
        data = await spotify.musicaAtual();
        break;
      case 'fs_listar':
        data = await filesystem.fsListar(input as { caminho?: string });
        break;
      case 'fs_ler':
        data = await filesystem.fsLer(input as { caminho: string });
        break;
      case 'fs_escrever':
        data = await filesystem.fsEscrever(input as Parameters<typeof filesystem.fsEscrever>[0]);
        break;
      case 'fs_apagar':
        data = await filesystem.fsApagar(input as { caminho: string; confirm?: boolean });
        break;
      case 'fs_buscar':
        data = await filesystem.fsBuscar(input as Parameters<typeof filesystem.fsBuscar>[0]);
        break;
      case 'fs_raizes':
        data = filesystem.fsRoots();
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
