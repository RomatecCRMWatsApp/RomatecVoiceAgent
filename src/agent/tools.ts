import Anthropic from '@anthropic-ai/sdk';
import * as crm from '../integrations/crm';
import * as avalieimob from '../integrations/avalieimob';
import * as calendar from '../integrations/calendar';
import * as spotify from '../integrations/spotify';
import * as telegram from '../integrations/telegram';
import * as filesystem from '../integrations/filesystem';
import * as system from '../integrations/system';
import * as obras from '../integrations/obras';
import * as alarmes from '../integrations/alarmes';
import * as cofre from '../integrations/cofre';
import * as vistorias from '../integrations/vistorias';
import * as cowork from '../integrations/cowork';
import { alarmeIosCriar } from '../integrations/iosAlarm';
import {
  viaCepBuscar, bcbIndice, ibgeMunicipio,
  geocodificar, normaBuscar, sigefConsultaUrl, sicarConsultaUrl,
} from '../integrations/expertiseApis';
import { buscarMemoria, formatarContexto } from '../services/ragSearch';
import { listarDocumentos, apagarDocumento } from '../services/ragIngest';
import { listarContratosIndexados } from '../services/contratosIngest';
import { sendReply } from '../integrations/whatsapp';
import { pesquisarWeb } from '../integrations/braveSearch';
import {
  consultarCnpj, consultarCep, consultarBanco, feriadosNacionais,
  consultarDdd, fipeMarcas, fipePreco, consultarTaxas,
  consultarPixParticipantes, climaCidade, consultarIsbn,
} from '../integrations/brasilApi';
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
    name: 'disco_status',
    description: 'Reporta espaço em disco (drives C:, D:, etc) e tamanho das pastas temporárias do Windows que podem ser limpas. Use quando o CEO falar "máquina lenta", "sem espaço", "tá pesado".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'limpar_temp',
    description: 'Limpa pastas temporárias do Windows pra liberar espaço e melhorar performance. DESTRUTIVO. Sempre rode primeiro sem "confirm" pra ver preview do que será apagado, peça autorização verbal ao CEO, depois rode com "confirm: true". Categorias: temp_usuario, temp_windows, cache_navegador, cache_inet, relatorios_erro, crashdumps, prefetch, delivery_optimization, thumbnails, ou "tudo" (todas).',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Uma categoria específica ou "tudo" (default)' },
        confirm:   { type: 'boolean', description: 'Só passar true APÓS autorização do CEO' },
      },
    },
  },
  {
    name: 'limpar_lixeira',
    description: 'Esvazia a Lixeira do Windows. IRREVERSÍVEL. Exige preview + confirmação verbal antes de "confirm: true".',
    input_schema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean' },
      },
    },
  },
  {
    name: 'listar_categorias_limpeza',
    description: 'Lista as categorias de limpeza disponíveis com label, caminhos e idade mínima dos arquivos pra apagar.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'fs_raizes',
    description: 'Retorna lista de diretórios autorizados pra acesso ao filesystem (FS_ALLOWED_ROOTS).',
    input_schema: { type: 'object', properties: {} },
  },
  // ── Obras (v1.16) ─────────────────────────────────────────────────────────
  {
    name: 'listar_obras',
    description: 'Lista obras da Romatec, opcionalmente filtrando por status (planejamento, em_andamento, paralisada, concluida).',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['planejamento','em_andamento','paralisada','concluida'] },
        limite: { type: 'number' },
      },
    },
  },
  {
    name: 'buscar_obra',
    description: 'Retorna detalhes completos de uma obra: dados gerais + progresso + financeiro + etapas + transações recentes + diário recente.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'criar_obra',
    description: 'Cria uma obra nova. DESTRUTIVO. Sempre rode primeiro sem confirm pra preview, peça autorização, depois confirm:true.',
    input_schema: {
      type: 'object',
      properties: {
        nome:                { type: 'string' },
        tipo:                { type: 'string', enum: ['residencial','comercial','industrial','reforma','publica'] },
        cliente:             { type: 'string' },
        cliente_telefone:    { type: 'string' },
        endereco:            { type: 'string' },
        cidade:              { type: 'string' },
        area_m2:             { type: 'number' },
        orcamento:           { type: 'number' },
        status:              { type: 'string', enum: ['planejamento','em_andamento','paralisada','concluida'] },
        responsavel_tecnico: { type: 'string' },
        data_inicio:         { type: 'string', description: 'YYYY-MM-DD' },
        data_previsao:       { type: 'string', description: 'YYYY-MM-DD' },
        observacoes:         { type: 'string' },
        confirm:             { type: 'boolean' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'atualizar_obra',
    description: 'Atualiza campos de uma obra existente. Confirm exigido após autorização verbal.',
    input_schema: {
      type: 'object',
      properties: {
        id:                  { type: 'string' },
        nome:                { type: 'string' },
        tipo:                { type: 'string' },
        cliente:             { type: 'string' },
        cliente_telefone:    { type: 'string' },
        endereco:            { type: 'string' },
        cidade:              { type: 'string' },
        area_m2:             { type: 'number' },
        orcamento:           { type: 'number' },
        status:              { type: 'string' },
        responsavel_tecnico: { type: 'string' },
        data_inicio:         { type: 'string' },
        data_previsao:       { type: 'string' },
        observacoes:         { type: 'string' },
        confirm:             { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'apagar_obra',
    description: 'APAGA obra + todas as etapas/transações/diário. IRREVERSÍVEL. Exige confirmação verbal explícita antes de confirm:true.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'listar_etapas_obra',
    description: 'Lista etapas/cronograma de uma obra ordenadas pela ordem de execução.',
    input_schema: {
      type: 'object',
      properties: { obra_id: { type: 'string' } },
      required: ['obra_id'],
    },
  },
  {
    name: 'criar_etapa',
    description: 'Cria etapa no cronograma. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        obra_id:     { type: 'string' },
        nome:        { type: 'string' },
        responsavel: { type: 'string' },
        data_inicio: { type: 'string' },
        data_fim:    { type: 'string' },
        descricao:   { type: 'string' },
        ordem:       { type: 'number' },
        confirm:     { type: 'boolean' },
      },
      required: ['obra_id', 'nome'],
    },
  },
  {
    name: 'atualizar_etapa',
    description: 'Atualiza status/dados de uma etapa. Use status=concluido pra marcar como pronto, em_andamento pra começar, atrasado pra sinalizar atraso.',
    input_schema: {
      type: 'object',
      properties: {
        id:          { type: 'string' },
        status:      { type: 'string', enum: ['pendente','em_andamento','concluido','atrasado'] },
        nome:        { type: 'string' },
        responsavel: { type: 'string' },
        data_inicio: { type: 'string' },
        data_fim:    { type: 'string' },
        confirm:     { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'apagar_etapa',
    description: 'APAGA etapa do cronograma. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'listar_transacoes_obra',
    description: 'Lista entradas/saídas financeiras de uma obra.',
    input_schema: {
      type: 'object',
      properties: { obra_id: { type: 'string' }, limite: { type: 'number' } },
      required: ['obra_id'],
    },
  },
  {
    name: 'criar_transacao_obra',
    description: 'Registra entrada ou saída financeira em uma obra. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        obra_id:         { type: 'string' },
        tipo:            { type: 'string', enum: ['entrada','saida'] },
        descricao:       { type: 'string' },
        valor:           { type: 'number' },
        data:            { type: 'string', description: 'YYYY-MM-DD (default hoje)' },
        categoria:       { type: 'string' },
        fornecedor:      { type: 'string' },
        nota_fiscal:     { type: 'string' },
        forma_pagamento: { type: 'string', enum: ['dinheiro','pix','transferencia','cartao','boleto'] },
        confirm:         { type: 'boolean' },
      },
      required: ['obra_id','tipo','descricao','valor'],
    },
  },
  {
    name: 'listar_equipe_obra',
    description: 'Lista equipe — total ou de uma obra específica via obra_id.',
    input_schema: {
      type: 'object',
      properties: { obra_id: { type: 'string' } },
    },
  },
  {
    name: 'criar_membro_equipe',
    description: 'Adiciona membro à equipe de obras. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        nome:          { type: 'string' },
        funcao:        { type: 'string' },
        tipo_contrato: { type: 'string', enum: ['clt','diarista','empreitada','terceirizado'] },
        cpf:           { type: 'string' },
        telefone:      { type: 'string' },
        valor_dia:     { type: 'number' },
        especialidade: { type: 'string' },
        observacoes:   { type: 'string' },
        obras_ids:     { type: 'array', items: { type: 'string' }, description: 'IDs das obras onde o membro está alocado' },
        confirm:       { type: 'boolean' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'atualizar_membro_equipe',
    description: 'Atualiza dados de um membro existente (mudar obra, função, valor diária, etc). Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, nome: { type: 'string' }, funcao: { type: 'string' },
        tipo_contrato: { type: 'string' }, telefone: { type: 'string' },
        valor_dia: { type: 'number' }, especialidade: { type: 'string' },
        observacoes: { type: 'string' }, obra_id: { type: 'string' },
        ativo: { type: 'boolean' }, confirm: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'atualizar_material',
    description: 'Atualiza dados de um material existente. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, nome: { type: 'string' }, categoria: { type: 'string' },
        unidade: { type: 'string' }, estoque: { type: 'number' },
        estoque_minimo: { type: 'number' }, valor_unitario: { type: 'number' },
        fornecedor_principal: { type: 'string' }, local_armazenamento: { type: 'string' },
        obra_id: { type: 'string' }, confirm: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'apagar_membro_equipe',
    description: 'APAGA membro da equipe + todas as marcações de dias trabalhados dele. IRREVERSÍVEL. Confirm exigido após autorização verbal.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'apagar_material',
    description: 'APAGA material do estoque. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'listar_materiais',
    description: 'Lista materiais. Use apenas_baixos:true pra ver só os abaixo do estoque mínimo.',
    input_schema: {
      type: 'object',
      properties: { apenas_baixos: { type: 'boolean' } },
    },
  },
  {
    name: 'criar_material',
    description: 'Cadastra material novo. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        nome:                 { type: 'string' },
        categoria:            { type: 'string' },
        unidade:              { type: 'string', description: 'kg, sc, m, un, etc' },
        estoque:              { type: 'number' },
        estoque_minimo:       { type: 'number' },
        valor_unitario:       { type: 'number' },
        fornecedor_principal: { type: 'string' },
        local_armazenamento:  { type: 'string' },
        confirm:              { type: 'boolean' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'ajustar_estoque_material',
    description: 'Ajusta estoque de um material (delta positivo = compra/entrada, negativo = consumo). Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        id:      { type: 'string' },
        delta:   { type: 'number', description: 'Positivo adiciona, negativo consome' },
        confirm: { type: 'boolean' },
      },
      required: ['id', 'delta'],
    },
  },
  {
    name: 'listar_diario_obra',
    description: 'Lista registros do diário de uma obra (mais recentes primeiro).',
    input_schema: {
      type: 'object',
      properties: { obra_id: { type: 'string' }, limite: { type: 'number' } },
      required: ['obra_id'],
    },
  },
  {
    name: 'registrar_diario_obra',
    description: 'Registra entrada no diário de obra (atividades, clima, equipe, ocorrências). Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        obra_id:                  { type: 'string' },
        atividades:               { type: 'string' },
        data:                     { type: 'string', description: 'YYYY-MM-DD (default hoje)' },
        clima:                    { type: 'string', enum: ['sol','nublado','chuva','tempestade'] },
        horario_inicio:           { type: 'string', description: 'HH:MM' },
        horario_fim:              { type: 'string', description: 'HH:MM' },
        quantidade_trabalhadores: { type: 'number' },
        visitas:                  { type: 'string' },
        equipe_presente:          { type: 'string' },
        ocorrencias:              { type: 'string' },
        fotos_urls:               { type: 'array', items: { type: 'string' } },
        confirm:                  { type: 'boolean' },
      },
      required: ['obra_id', 'atividades'],
    },
  },
  // ── Cowork — tarefas em background (v1.22) ──
  {
    name: 'criar_tarefa_cowork',
    description: 'Cria uma tarefa pra você executar em BACKGROUND enquanto o CEO faz outra coisa. Você pega a tarefa numa instância paralela, executa via think() (com acesso a todas as tools), e quando termina notifica via push web + Telegram. Use quando o CEO disser "faz isso enquanto eu vou em outra coisa", "deixa rodando", "me avisa quando terminar". Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        descricao: { type: 'string', description: 'Resumo curto pra UI/notificação (ex: "Análise de leads quentes do mês")' },
        prompt:    { type: 'string', description: 'Instrução completa que será executada pela ZAYRA paralela' },
        confirm:   { type: 'boolean' },
      },
      required: ['descricao', 'prompt'],
    },
  },
  {
    name: 'listar_tarefas_cowork',
    description: 'Lista tarefas em background (filtra por status: pendente, executando, concluida, falhou, cancelada).',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pendente','executando','concluida','falhou','cancelada'] },
        limite: { type: 'number' },
      },
    },
  },
  {
    name: 'buscar_tarefa_cowork',
    description: 'Retorna detalhes completos de uma tarefa cowork: prompt, resultado, tools usadas, tempos.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'cancelar_tarefa_cowork',
    description: 'Cancela tarefa pendente ou em execução. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },

  // ── VTO — Vistoria Técnica de Obra (v1.21) ──
  {
    name: 'listar_vistorias',
    description: 'Lista vistorias técnicas (VTO). Filtre por obra com obra_id pra ver só de uma obra específica.',
    input_schema: {
      type: 'object',
      properties: { obra_id: { type: 'string' }, limite: { type: 'number' } },
    },
  },
  {
    name: 'buscar_vistoria',
    description: 'Retorna detalhes completos de uma vistoria + URLs das fotos.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'criar_vistoria',
    description: 'Cria nova VTO com descrição, observações, pendências e status. Confirm exigido. Use sem fotos pelo chat (use a UI /obras → Vistorias pra anexar fotos), ou passe array de fotos com base64.',
    input_schema: {
      type: 'object',
      properties: {
        obra_id:     { type: 'string' },
        descricao:   { type: 'string' },
        data:        { type: 'string', description: 'YYYY-MM-DD (default hoje)' },
        titulo:      { type: 'string' },
        vistoriador: { type: 'string' },
        observacoes: { type: 'string' },
        pendencias:  { type: 'string' },
        status_obra: { type: 'string', enum: ['regular','atencao','critica'] },
        confirm:     { type: 'boolean' },
      },
      required: ['obra_id', 'descricao'],
    },
  },
  {
    name: 'apagar_vistoria',
    description: 'APAGA vistoria + fotos relacionadas. IRREVERSÍVEL. Confirm exigido após autorização verbal.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },

  // ── Cofre Obsidian (v1.20) ──
  {
    name: 'sincronizar_cofre_memoria',
    description: 'Espelha todas as memórias persistentes em arquivos Markdown navegáveis no Obsidian (cofre dedicado). Cria pastas por tipo (00-Fatos, 01-Preferencias, 02-Decisoes, 03-Contexto, 04-Lembretes) + _index.md com links wiki. Use quando o CEO pedir pra "atualizar o cofre", "regenerar o vault", "exportar memória pro Obsidian".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'exportar_cofre_zip',
    description: 'Gera arquivo de exportação único do cofre (concatenado) pra download — útil em Railway onde filesystem é efêmero. Retorna path e tamanho.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── Alarmes / Despertadores (v1.19) ──
  {
    name: 'criar_alarme',
    description: 'Programa um alarme/despertador. Notifica via push web (browser/PWA) e Telegram (chega no celular mesmo offline). Aceita "quando" em formato livre: "14:30", "14:30 amanhã", "2026-04-27 09:00". Sem confirm primeiro pra preview.',
    input_schema: {
      type: 'object',
      properties: {
        titulo:    { type: 'string', description: 'Ex: "Reunião com cliente Maria"' },
        quando:    { type: 'string', description: '"HH:MM", "HH:MM amanhã", ou "YYYY-MM-DD HH:MM"' },
        descricao: { type: 'string' },
        repeticao: { type: 'string', enum: ['uma_vez', 'diario', 'semanal', 'dias_uteis'] },
        canais:    { type: 'string', description: '"sse,telegram" (default), "sse", ou "telegram"' },
        confirm:   { type: 'boolean' },
      },
      required: ['titulo', 'quando'],
    },
  },
  {
    name: 'listar_alarmes',
    description: 'Lista alarmes programados. Default mostra ativos+disparados (não cancelados).',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ativo','disparado','cancelado'] },
        limite: { type: 'number' },
      },
    },
  },
  {
    name: 'atualizar_alarme',
    description: 'Edita alarme existente (mudar hora, título, repetição). Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        id:        { type: 'string' },
        titulo:    { type: 'string' },
        quando:    { type: 'string' },
        descricao: { type: 'string' },
        repeticao: { type: 'string', enum: ['uma_vez','diario','semanal','dias_uteis'] },
        canais:    { type: 'string' },
        confirm:   { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'cancelar_alarme',
    description: 'Cancela um alarme. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['id'],
    },
  },
  {
    name: 'listar_profissoes_catalogo',
    description: 'Lista todas as 30+ profissões da construção civil cadastradas no catálogo (com valor diária e salário mensal de referência sindical).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'atualizar_profissao_catalogo',
    description: 'Edita valores de referência de uma profissão. Use quando o CEO disser "no nosso acordo o pedreiro é R$220, ajusta o valor de referência". Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        valor_dia_referencia: { type: 'number' },
        salario_mensal_referencia: { type: 'number' },
        descricao: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'marcar_dia_trabalhado',
    description: 'Marca um dia trabalhado pra um funcionário com período (integral, manha, tarde). Manhã/tarde valem 50% da diária. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        funcionario_id: { type: 'string' },
        data:           { type: 'string', description: 'YYYY-MM-DD' },
        periodo:        { type: 'string', enum: ['integral','manha','tarde'] },
        obra_id:        { type: 'string', description: 'opcional' },
        observacoes:    { type: 'string' },
        confirm:        { type: 'boolean' },
      },
      required: ['funcionario_id', 'data'],
    },
  },
  {
    name: 'desmarcar_dia_trabalhado',
    description: 'Remove marcação de dia trabalhado. Sem periodo, remove TODAS as marcações daquele dia. Confirm exigido.',
    input_schema: {
      type: 'object',
      properties: {
        funcionario_id: { type: 'string' },
        data:           { type: 'string' },
        periodo:        { type: 'string', enum: ['integral','manha','tarde'] },
        confirm:        { type: 'boolean' },
      },
      required: ['funcionario_id', 'data'],
    },
  },
  {
    name: 'listar_dias_funcionario',
    description: 'Lista dias trabalhados de um funcionário, opcionalmente filtrando por mês/ano.',
    input_schema: {
      type: 'object',
      properties: {
        funcionario_id: { type: 'string' },
        ano:            { type: 'number' },
        mes:            { type: 'number', description: '1-12' },
      },
      required: ['funcionario_id'],
    },
  },
  {
    name: 'relatorio_mensal_funcionario',
    description: 'Relatório mensal de um funcionário: integral, manhã, tarde, total dias equivalentes (manhã/tarde = 0,5 dia), total a pagar.',
    input_schema: {
      type: 'object',
      properties: {
        funcionario_id: { type: 'string' },
        ano:            { type: 'number' },
        mes:            { type: 'number' },
      },
      required: ['funcionario_id', 'ano', 'mes'],
    },
  },
  {
    name: 'relatorio_mensal_equipe',
    description: 'Folha mensal de toda equipe (ou de uma obra). Retorna por funcionário: dias trabalhados e total a pagar, mais o total geral.',
    input_schema: {
      type: 'object',
      properties: {
        ano:     { type: 'number' },
        mes:     { type: 'number' },
        obra_id: { type: 'string' },
      },
      required: ['ano', 'mes'],
    },
  },
  {
    name: 'resumo_obras',
    description: 'Visão geral de TODAS as obras: total, em andamento, concluídas, paralisadas, orçamento total, saldo financeiro consolidado, etapas atrasadas, materiais em estoque baixo. Use quando o CEO pedir "como tão as obras", "panorama geral", "status das obras".',
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

  // ── v1.24.0: alarme nativo iPhone via ntfy + Atalhos ──────────────────────
  {
    name: 'alarme_ios_criar',
    description: 'Cria alarme nativo no iPhone do Chefe via ntfy → Atalhos (app Shortcuts). Use para reuniões, vistorias, prazos. Requer IOS_NTFY_TOPIC e que o CEO tenha configurado o atalho "ZAYRA-Alarme".',
    input_schema: {
      type: 'object',
      properties: {
        titulo:       { type: 'string', description: 'Etiqueta do alarme (ex: "Vistoria Lote 14")' },
        datetime_iso: { type: 'string', description: 'ISO 8601 com timezone -03:00 (Fortaleza). Ex: 2026-04-27T08:30:00-03:00' },
        notas:        { type: 'string', description: 'Notas opcionais' },
      },
      required: ['titulo', 'datetime_iso'],
    },
  },

  // ── v1.24.0: APIs de expertise técnica ────────────────────────────────────
  {
    name: 'cep_buscar',
    description: 'Endereço completo a partir de CEP brasileiro (ViaCEP). Use para preencher endereço de cliente, lote, contrato.',
    input_schema: {
      type: 'object',
      properties: { cep: { type: 'string', description: 'CEP com ou sem hífen' } },
      required: ['cep'],
    },
  },
  {
    name: 'bcb_indice',
    description: 'Série temporal de IPCA, INCC, IGP-M, Selic ou CUB (Banco Central — SGS) para atualização monetária em laudos e contratos.',
    input_schema: {
      type: 'object',
      properties: {
        indice: { type: 'string', enum: ['ipca', 'incc', 'igpm', 'selic', 'cub'] },
        meses:  { type: 'integer', minimum: 1, maximum: 120, description: 'Quantidade de meses retroativos (default 12)' },
      },
      required: ['indice'],
    },
  },
  {
    name: 'ibge_municipio',
    description: 'Busca município brasileiro pelo nome — retorna código IBGE, UF, microrregião. Útil para preencher dados oficiais em laudos.',
    input_schema: {
      type: 'object',
      properties: { nome: { type: 'string' } },
      required: ['nome'],
    },
  },
  {
    name: 'geocodificar',
    description: 'Converte endereço em coordenadas (lat/lon) via OpenStreetMap Nominatim. Útil para georreferenciamento básico e mapas.',
    input_schema: {
      type: 'object',
      properties: { endereco: { type: 'string' } },
      required: ['endereco'],
    },
  },
  {
    name: 'norma_buscar',
    description: 'Busca info atualizada sobre norma técnica (ABNT NBR, IT Bombeiros, INCRA, REURB, leis de loteamento). USE SEMPRE em dúvida sobre número de norma ou artigo de lei — nunca invente.',
    input_schema: {
      type: 'object',
      properties: { termo: { type: 'string' } },
      required: ['termo'],
    },
  },
  {
    name: 'sigef_consulta_url',
    description: 'Link de consulta pública SIGEF/INCRA para imóvel rural certificado (georreferenciamento). Se receber código do certificado, monta URL direta da parcela.',
    input_schema: {
      type: 'object',
      properties: { codigo_certificado: { type: 'string' } },
    },
  },
  {
    name: 'sicar_consulta_url',
    description: 'Link de consulta pública do CAR (Cadastro Ambiental Rural — SICAR). Use quando o CEO precisar checar regularidade ambiental de imóvel rural.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── v1.26.0: RAG (memória vetorial Supabase + Voyage AI) ──────────────────
  {
    name: 'memoria_buscar',
    description: 'Busca semântica na memória de conhecimento da ZAYRA (laudos, normas, contratos, manuais já ingeridos). USE SEMPRE que a pergunta envolver expertise técnica antes de responder por conhecimento geral. Retorna trechos com fonte, página e relevância.',
    input_schema: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: 'Pergunta ou termo a buscar na biblioteca' },
        categoria: { type: 'string', enum: ['norma', 'laudo', 'contrato', 'manual', 'outro'], description: 'Filtrar por tipo de documento (opcional)' },
        top_k:     { type: 'integer', minimum: 1, maximum: 20, description: 'Quantos trechos retornar (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memoria_listar',
    description: 'Lista todos os documentos que a ZAYRA tem na memória vetorial — título, categoria, fonte (whatsapp/telegram/web/cli), data de ingestão.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'memoria_apagar',
    description: 'Remove um documento da memória pelo ID (UUID retornado por memoria_listar). Operação IRREVERSÍVEL — confirme com o Chefe antes.',
    input_schema: {
      type: 'object',
      properties: {
        documento_id: { type: 'string', description: 'UUID do documento a remover' },
      },
      required: ['documento_id'],
    },
  },

  // ── v1.28.1: contratos modelo indexados (Fase 1 do sistema de contratos) ──
  {
    name: 'memoria_contratos_listar',
    description: 'Lista os contratos modelo já indexados na base vetorial (clausulas_juridicas + contratos_indexados). Use quando o Chefe perguntar "que contratos modelo eu tenho", "quais minutas estão na memória", "tem contrato de compra e venda?", etc. Retorna título, tipo (compra_venda/locacao/permuta/etc), categoria, número de cláusulas e data de indexação.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── v1.32.0: Brave Search + BrasilAPI (busca web e dados públicos) ──
  {
    name: 'pesquisar_web',
    description: 'Pesquisa na web em tempo real via Brave Search. Use pra buscar preços de mercado, índices CUB/INCC atualizados, notícias do setor imobiliário, dados de empresas/pessoas, ou qualquer info que não está nos sistemas internos. Retorna até 10 resultados com título, URL e resumo.',
    input_schema: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: 'Termo de busca (em pt-BR de preferência)' },
        limite:    { type: 'number', description: 'Quantos resultados (default 5, max 20)' },
        freshness: { type: 'string', enum: ['pd','pw','pm','py'], description: 'Filtra por idade: pd=24h, pw=semana, pm=mês, py=ano' },
      },
      required: ['query'],
    },
  },
  {
    name: 'consultar_cnpj',
    description: 'Consulta dados oficiais de uma empresa pelo CNPJ na Receita Federal (via BrasilAPI). Retorna razão social, nome fantasia, endereço, CNAE, capital social, situação cadastral. Use ao receber um CNPJ pra pré-preencher cadastro de cliente/fornecedor.',
    input_schema: {
      type: 'object',
      properties: { cnpj: { type: 'string', description: 'CNPJ com ou sem formatação (14 dígitos)' } },
      required: ['cnpj'],
    },
  },
  {
    name: 'consultar_cep',
    description: 'Consulta endereço completo a partir do CEP (BrasilAPI v2 — ViaCEP + WideNet + OpenCEP). Retorna logradouro, bairro, cidade, UF. Use pra preencher endereço de obra/cliente automaticamente.',
    input_schema: {
      type: 'object',
      properties: { cep: { type: 'string', description: 'CEP com ou sem traço (8 dígitos)' } },
      required: ['cep'],
    },
  },
  {
    name: 'consultar_banco',
    description: 'Consulta nome e ISPB de um banco pelo código FEBRABAN (3 dígitos). Útil pra confirmar dados de pagamento/boleto.',
    input_schema: {
      type: 'object',
      properties: { codigo: { type: 'string', description: 'Código FEBRABAN do banco (ex: 001 = Banco do Brasil, 341 = Itaú, 260 = Nubank)' } },
      required: ['codigo'],
    },
  },
  {
    name: 'feriados_nacionais',
    description: 'Lista todos os feriados nacionais brasileiros de um ano (default = ano atual). Útil pra calcular prazos de obra, descontar dias do contrato, agendar entregas.',
    input_schema: {
      type: 'object',
      properties: { ano: { type: 'number', description: 'Ano (4 dígitos). Default: ano atual.' } },
    },
  },

  // ── v1.33.0: BrasilAPI expandida ──
  {
    name: 'consultar_ddd',
    description: 'Descobre estado e cidades de um DDD (2 dígitos). Use quando o Chefe receber lead/contato com telefone novo e quiser saber a região (ex: DDD 98 = Maranhão, capital + Imperatriz; DDD 11 = SP capital).',
    input_schema: {
      type: 'object',
      properties: { ddd: { type: 'string', description: 'DDD com 2 dígitos (ex: 98, 11, 21)' } },
      required: ['ddd'],
    },
  },
  {
    name: 'fipe_marcas',
    description: 'Lista marcas de veículos da Tabela FIPE (carros, motos ou caminhões). Use antes de fipe_preco quando o Chefe perguntar valor de carro pra avaliação patrimonial ou garantia.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['carros','motos','caminhoes'], description: 'Default: carros' },
      },
    },
  },
  {
    name: 'fipe_preco',
    description: 'Consulta valor FIPE atualizado de um veículo pelo código FIPE (ex: 001234-5). Retorna valor, marca, modelo, ano, mês de referência. Use pra avaliação de bens em PTAM, garantia em contratos, comparativo patrimonial.',
    input_schema: {
      type: 'object',
      properties: { codigo_fipe: { type: 'string', description: 'Código FIPE no formato XXXXXX-X (ex: 001234-5)' } },
      required: ['codigo_fipe'],
    },
  },
  {
    name: 'consultar_taxas',
    description: 'Retorna taxas oficiais ATUALIZADAS de Selic, CDI, IPCA. Mais confiável que pesquisar_web pra esses indicadores específicos. Use quando o Chefe perguntar "qual a Selic hoje", "CDI atual", "IPCA do mês", etc.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pix_participantes',
    description: 'Lista os principais bancos cadastrados no PIX (50 primeiros). Útil pra verificar se um banco aceita PIX, descobrir ISPB pra TED, conferir nomes oficiais.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'clima_cidade',
    description: 'Previsão do tempo dos próximos 6 dias via CPTEC/INPE (NÃO previsão de cidade qualquer — só capitais e cidades cadastradas no CPTEC). Use pra planejar cronograma de obra (chuva atrasa concretagem, alvenaria externa, etc), agendar vistorias, programar transporte de material. Cidades que funcionam: capitais e principais cidades do Maranhão (São Luís, Imperatriz, Caxias, Bacabal).',
    input_schema: {
      type: 'object',
      properties: { cidade: { type: 'string', description: 'Nome da cidade (ex: São Luís, Imperatriz, Açailândia)' } },
      required: ['cidade'],
    },
  },
  {
    name: 'consultar_isbn',
    description: 'Consulta dados de um livro pelo ISBN (10 ou 13 dígitos). Útil pra biblioteca técnica de avaliações (NBRs, manuais, normas), citações em laudos.',
    input_schema: {
      type: 'object',
      properties: { isbn: { type: 'string', description: 'ISBN com ou sem traços' } },
      required: ['isbn'],
    },
  },
];

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  console.log(`[Tool] → ${name}`, JSON.stringify(input).slice(0, 200));
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
      case 'disco_status':
        data = await system.discoStatus();
        break;
      case 'limpar_temp':
        data = await system.limparTemp(input as { categoria?: string; confirm?: boolean });
        break;
      case 'limpar_lixeira':
        data = await system.limparLixeira(input as { confirm?: boolean });
        break;
      case 'listar_categorias_limpeza':
        data = system.listarCategorias();
        break;
      // ── Obras (v1.16) ───────────────────────────────────────────────────
      case 'listar_obras':
        data = await obras.listarObras(input as { status?: string; limite?: number });
        break;
      case 'buscar_obra':
        data = await obras.buscarObra(input.id as string);
        break;
      case 'criar_obra':
        data = await obras.criarObra(input as Parameters<typeof obras.criarObra>[0]);
        break;
      case 'atualizar_obra':
        data = await obras.atualizarObra(input as Parameters<typeof obras.atualizarObra>[0]);
        break;
      case 'apagar_obra':
        data = await obras.apagarObra(input as { id: string; confirm?: boolean });
        break;
      case 'listar_etapas_obra':
        data = await obras.listarEtapasObra(input.obra_id as string);
        break;
      case 'criar_etapa':
        data = await obras.criarEtapa(input as Parameters<typeof obras.criarEtapa>[0]);
        break;
      case 'atualizar_etapa':
        data = await obras.atualizarEtapa(input as Parameters<typeof obras.atualizarEtapa>[0]);
        break;
      case 'apagar_etapa':
        data = await obras.apagarEtapa(input as { id: string; confirm?: boolean });
        break;
      case 'listar_transacoes_obra':
        data = await obras.listarTransacoesObra(input as { obra_id: string; limite?: number });
        break;
      case 'criar_transacao_obra':
        data = await obras.criarTransacaoObra(input as Parameters<typeof obras.criarTransacaoObra>[0]);
        break;
      case 'listar_equipe_obra':
        data = await obras.listarEquipe(input as { obra_id?: string });
        break;
      case 'criar_membro_equipe':
        data = await obras.criarMembroEquipe(input as Parameters<typeof obras.criarMembroEquipe>[0]);
        break;
      case 'atualizar_membro_equipe':
        data = await obras.atualizarMembroEquipe(input as Parameters<typeof obras.atualizarMembroEquipe>[0]);
        break;
      case 'atualizar_material':
        data = await obras.atualizarMaterial(input as Parameters<typeof obras.atualizarMaterial>[0]);
        break;
      case 'apagar_membro_equipe':
        data = await obras.apagarMembroEquipe(input as { id: string; confirm?: boolean });
        break;
      case 'apagar_material':
        data = await obras.apagarMaterial(input as { id: string; confirm?: boolean });
        break;
      case 'listar_materiais':
        data = await obras.listarMateriais(input as { apenas_baixos?: boolean });
        break;
      case 'criar_material':
        data = await obras.criarMaterial(input as Parameters<typeof obras.criarMaterial>[0]);
        break;
      case 'ajustar_estoque_material':
        data = await obras.ajustarEstoqueMaterial(input as { id: string; delta: number; confirm?: boolean });
        break;
      case 'listar_diario_obra':
        data = await obras.listarDiarioObra(input as { obra_id: string; limite?: number });
        break;
      case 'registrar_diario_obra':
        data = await obras.registrarDiarioObra(input as Parameters<typeof obras.registrarDiarioObra>[0]);
        break;
      case 'criar_tarefa_cowork':
        data = await cowork.criarTarefaCowork(input as Parameters<typeof cowork.criarTarefaCowork>[0]);
        break;
      case 'listar_tarefas_cowork':
        data = await cowork.listarTarefasCowork(input as Parameters<typeof cowork.listarTarefasCowork>[0]);
        break;
      case 'buscar_tarefa_cowork':
        data = await cowork.buscarTarefaCowork(input.id as string);
        break;
      case 'cancelar_tarefa_cowork':
        data = await cowork.cancelarTarefaCowork(input as { id: string; confirm?: boolean });
        break;
      case 'listar_vistorias':
        data = await vistorias.listarVistorias(input as Parameters<typeof vistorias.listarVistorias>[0]);
        break;
      case 'buscar_vistoria':
        data = await vistorias.buscarVistoria(input.id as string);
        break;
      case 'criar_vistoria':
        data = await vistorias.criarVistoria(input as Parameters<typeof vistorias.criarVistoria>[0]);
        break;
      case 'apagar_vistoria':
        data = await vistorias.apagarVistoria(input as { id: string; confirm?: boolean });
        break;
      case 'sincronizar_cofre_memoria':
        data = await cofre.sincronizarCofreMemoria();
        break;
      case 'exportar_cofre_zip':
        data = await cofre.exportarVaultZip();
        break;
      case 'criar_alarme':
        data = await alarmes.criarAlarme(input as Parameters<typeof alarmes.criarAlarme>[0]);
        break;
      case 'listar_alarmes':
        data = await alarmes.listarAlarmes(input as Parameters<typeof alarmes.listarAlarmes>[0]);
        break;
      case 'atualizar_alarme':
        data = await alarmes.atualizarAlarme(input as Parameters<typeof alarmes.atualizarAlarme>[0]);
        break;
      case 'cancelar_alarme':
        data = await alarmes.cancelarAlarme(input as { id: string; confirm?: boolean });
        break;
      case 'listar_profissoes_catalogo':
        data = await obras.listarProfissoesCatalogo();
        break;
      case 'atualizar_profissao_catalogo':
        data = await obras.atualizarProfissaoCatalogo(input as Parameters<typeof obras.atualizarProfissaoCatalogo>[0]);
        break;
      case 'marcar_dia_trabalhado':
        data = await obras.marcarDiaTrabalhado(input as Parameters<typeof obras.marcarDiaTrabalhado>[0]);
        break;
      case 'desmarcar_dia_trabalhado':
        data = await obras.desmarcarDiaTrabalhado(input as Parameters<typeof obras.desmarcarDiaTrabalhado>[0]);
        break;
      case 'listar_dias_funcionario':
        data = await obras.listarDiasFuncionario(input as Parameters<typeof obras.listarDiasFuncionario>[0]);
        break;
      case 'relatorio_mensal_funcionario':
        data = await obras.relatorioMensalFuncionario(input as Parameters<typeof obras.relatorioMensalFuncionario>[0]);
        break;
      case 'relatorio_mensal_equipe':
        data = await obras.relatorioMensalEquipe(input as Parameters<typeof obras.relatorioMensalEquipe>[0]);
        break;
      case 'resumo_obras':
        data = await obras.resumoObras();
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

      // ── v1.24.0: alarme nativo iPhone via ntfy ────────────────────────────
      case 'alarme_ios_criar':
        data = await alarmeIosCriar(input as unknown as Parameters<typeof alarmeIosCriar>[0]);
        break;

      // ── v1.24.0: APIs de expertise técnica ────────────────────────────────
      case 'cep_buscar':
        data = await viaCepBuscar(input.cep as string);
        break;
      case 'bcb_indice':
        data = await bcbIndice(input.indice as string, input.meses as number | undefined);
        break;
      case 'ibge_municipio':
        data = await ibgeMunicipio(input.nome as string);
        break;
      case 'geocodificar':
        data = await geocodificar(input.endereco as string);
        break;
      case 'norma_buscar':
        data = await normaBuscar(input.termo as string);
        break;
      case 'sigef_consulta_url':
        data = { url: sigefConsultaUrl(input.codigo_certificado as string | undefined) };
        break;
      case 'sicar_consulta_url':
        data = { url: sicarConsultaUrl() };
        break;

      // ── v1.26.0: RAG memória vetorial ───────────────────────────────────
      case 'memoria_buscar': {
        const q     = input.query as string;
        const cat   = input.categoria as string | undefined;
        const top_k = input.top_k as number | undefined;
        const hits  = await buscarMemoria(q, { categoria: cat, top_k });
        data = {
          query:       q,
          encontrados: hits.length,
          contexto:    formatarContexto(hits),
          fontes:      hits.map(h => ({
            documento_id: h.documento_id,
            titulo:       h.titulo,
            categoria:    h.categoria,
            pagina:       h.pagina,
            relevancia:   Math.round(h.similarity * 100) + '%',
          })),
        };
        break;
      }
      case 'memoria_listar':
        data = await listarDocumentos();
        break;
      case 'memoria_apagar':
        data = await apagarDocumento(input.documento_id as string);
        break;
      case 'memoria_contratos_listar':
        data = await listarContratosIndexados();
        break;

      // ── v1.32.0: Brave Search + BrasilAPI ──
      case 'pesquisar_web':
        data = await pesquisarWeb(input as { query: string; limite?: number; freshness?: 'pd'|'pw'|'pm'|'py' });
        break;
      case 'consultar_cnpj':
        data = await consultarCnpj(input as { cnpj: string });
        break;
      case 'consultar_cep':
        data = await consultarCep(input as { cep: string });
        break;
      case 'consultar_banco':
        data = await consultarBanco(input as { codigo: string | number });
        break;
      case 'feriados_nacionais':
        data = await feriadosNacionais(input as { ano?: number });
        break;

      // ── v1.33.0: BrasilAPI expandida ──
      case 'consultar_ddd':
        data = await consultarDdd(input as { ddd: string | number });
        break;
      case 'fipe_marcas':
        data = await fipeMarcas(input as { tipo?: 'carros' | 'motos' | 'caminhoes' });
        break;
      case 'fipe_preco':
        data = await fipePreco(input as { codigo_fipe: string });
        break;
      case 'consultar_taxas':
        data = await consultarTaxas();
        break;
      case 'pix_participantes':
        data = await consultarPixParticipantes();
        break;
      case 'clima_cidade':
        data = await climaCidade(input as { cidade: string });
        break;
      case 'consultar_isbn':
        data = await consultarIsbn(input as { isbn: string });
        break;

      default:
        return { toolName: name, success: false, error: `Tool desconhecida: ${name}` };
    }

    return { toolName: name, success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { toolName: name, success: false, error: message };
  }
}
