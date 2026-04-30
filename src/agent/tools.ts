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
import { gerarContrato, listarContratosGerados } from '../services/contratosGerar';
import { sendReply, sendImage, sendDocument, sendLocation, enviarAudioTTS, statusInstancia, infoInstancia } from '../integrations/whatsapp';
import { listarAlertasPendentes, silenciarAlerta, reconhecerAlerta, rodarDetectoresAgora } from './proactive';
import { sincronizarContatosCRM, buscarContatoMemoria } from '../services/syncContatosCRM';
import { gerarBriefingSemanal, enviarBriefingSemanal } from './briefingSemanal';
import poolDb from '../database/connection';
import {
  simularFinanciamento, calcularCorrecaoMonetaria, calcularVPL,
  converterTaxa, calcularParcelamento,
} from '../services/calculadoraFinanceira';
import { calcularItbi, listarMunicipiosValidados } from '../services/calcularItbi';
import { calcularIptu, listarMunicipiosIptu } from '../services/calcularIptu';
import {
  gerarAtaDeTranscricao, gerarAtaDeAudio,
  listarAtas, consultarAta,
} from '../services/meetingNotes';
import {
  consultarNormaImobiliaria, gerarRascunhoPtam, validarLaudoAvaliacao,
  sugerirMetodologiaAvaliacao, analisarComparativos,
} from '../services/avaliacaoImobiliaria';
import {
  extrairDadosRG, extrairDadosCNH, extrairComprovanteEndereco,
  extrairDocumentoImovel, analisarVisualImovel,
} from '../services/ocrDocumentos';
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
import * as drive from '../integrations/driveGoogle';
import {
  adicionarMembro as tmAdicionar,
  listarMembros as tmListar,
  atualizarMembro as tmAtualizar,
  alterarRole as tmAlterarRole,
  removerMembro as tmRemover,
  buscarMembroPorNome as tmBuscarPorNome,
  delegarTarefaParaMembro as tmDelegar,
  temPermissao,
  type TeamRole,
} from '../services/teamMembers';

// v1.45.0: scope do interlocutor atual. think() seta antes de chamar a cascata
// e limpa no finally; executeTool checa permissão por role. Default = admin.
let _currentCaller: { role: TeamRole; nome: string } | null = null;
export function setCurrentCaller(c: { role: TeamRole; nome: string } | null): void {
  _currentCaller = c;
}
export function getCurrentCaller(): { role: TeamRole; nome: string } | null {
  return _currentCaller;
}

// Tools que admin-only (sempre — independente do role configurado)
const ADMIN_ONLY_TOOLS = new Set<string>([
  'adicionar_membro_equipe', 'alterar_role_membro', 'remover_membro_equipe',
  'crm_apagar_lead', 'crm_apagar_contato', 'crm_apagar_campanha',
  'apagar_obra', 'apagar_etapa', 'apagar_membro_equipe', 'apagar_material',
  'apagar_vistoria', 'fs_apagar', 'limpar_temp', 'limpar_lixeira',
  'drive_apagar',
]);

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
    description: 'Envia mensagem de TEXTO pelo WhatsApp do CEO (instancia Z-API dedicada ZAYRA). DESTRUTIVO — afeta WhatsApp pessoal do CEO. Sempre rode primeiro SEM confirm pra ver preview, peca autorizacao verbal ao Chefe ("pode mandar?"), so depois rode com confirm:true. NUNCA envie sem o CEO autorizar a mensagem exata.',
    input_schema: {
      type: 'object',
      properties: {
        para:     { type: 'string', description: 'Número do destinatário (aceita formatos: 5598999999999, 98 9 9999-9999, +55 98 99999-9999)' },
        mensagem: { type: 'string', description: 'Texto da mensagem a enviar (sem markdown — WhatsApp não renderiza)' },
        confirm:  { type: 'boolean', description: 'true APÓS autorização verbal do CEO. Sem isso, retorna preview.' },
      },
      required: ['para', 'mensagem'],
    },
  },
  {
    name: 'enviar_audio_whatsapp',
    description: 'Envia AUDIO (PTT/push-to-talk) pelo WhatsApp do CEO. ZAYRA gera o audio via Edge TTS (voz pt-BR Francisca/Antonio) a partir do texto fornecido e envia pra contato. DESTRUTIVO — exige confirm. Use quando o CEO pedir "manda audio pra X explicando Y" ou "fala com Z em audio sobre W". Texto max 800 chars (audio nao pode ser muito longo).',
    input_schema: {
      type: 'object',
      properties: {
        para:    { type: 'string', description: 'Número destinatário' },
        texto:   { type: 'string', description: 'Texto que ZAYRA vai falar (max 800 chars, gera audio neural pt-BR)' },
        confirm: { type: 'boolean' },
      },
      required: ['para', 'texto'],
    },
  },
  {
    name: 'enviar_imagem_whatsapp',
    description: 'Envia IMAGEM (foto, captura de tela, logo, plant baixa) pelo WhatsApp do CEO. Aceita URL pública (https://...) ou data URI base64 (data:image/jpeg;base64,...). Suporta caption (legenda da imagem). DESTRUTIVO — exige confirm.',
    input_schema: {
      type: 'object',
      properties: {
        para:     { type: 'string', description: 'Número destinatário' },
        imageUrl: { type: 'string', description: 'URL pública (https) ou data URI base64 da imagem' },
        caption:  { type: 'string', description: 'Legenda opcional da imagem' },
        confirm:  { type: 'boolean' },
      },
      required: ['para', 'imageUrl'],
    },
  },
  {
    name: 'enviar_documento_whatsapp',
    description: 'Envia DOCUMENTO (PDF, DOCX, XLSX, TXT, CSV) pelo WhatsApp do CEO. Combina perfeito com gerar_contrato (que retorna DOCX base64) — depois de gerar contrato, pode mandar direto pro contato pelo WhatsApp. DESTRUTIVO — exige confirm.',
    input_schema: {
      type: 'object',
      properties: {
        para:      { type: 'string', description: 'Número destinatário' },
        docBase64: { type: 'string', description: 'Conteúdo do arquivo em base64 (sem prefixo data:..., só os bytes)' },
        fileName:  { type: 'string', description: 'Nome do arquivo (ex: "Contrato_Locacao.docx")' },
        confirm:   { type: 'boolean' },
      },
      required: ['para', 'docBase64', 'fileName'],
    },
  },
  // ── v1.44.0: OCR Documentos brasileiros ──
  {
    name: 'extrair_dados_rg',
    description: 'OCR estruturado de RG/Carteira de Identidade. Recebe foto em base64, retorna JSON com nome, RG, CPF, data nascimento, filiação, naturalidade. Use quando o Chefe enviar foto de RG pra cadastrar cliente. NÃO inventa dados — campos faltantes vêm vazios.',
    input_schema: {
      type: 'object',
      properties: {
        base64: { type: 'string', description: 'Imagem do RG em base64 (sem prefixo data:)' },
        mime:   { type: 'string', description: 'image/jpeg, image/png, etc (auto-detect se omitir)' },
      },
      required: ['base64'],
    },
  },
  {
    name: 'extrair_dados_cnh',
    description: 'OCR estruturado de CNH (Carteira Nacional de Habilitação). Retorna nome, CPF, RG, categoria, primeira habilitação, validade, observações médicas. Indica "vencida: true" se validade já passou.',
    input_schema: {
      type: 'object',
      properties: {
        base64: { type: 'string' },
        mime:   { type: 'string' },
      },
      required: ['base64'],
    },
  },
  {
    name: 'extrair_comprovante_endereco',
    description: 'OCR de comprovante de endereço (conta de luz, água, telefone, internet, IPTU). Extrai titular, endereço completo, CEP, fornecedor, valor, vencimento. Use pra cadastrar cliente sem digitar endereço manualmente.',
    input_schema: {
      type: 'object',
      properties: {
        base64: { type: 'string' },
        mime:   { type: 'string' },
      },
      required: ['base64'],
    },
  },
  {
    name: 'extrair_documento_imovel',
    description: 'OCR de documento imobiliário (matrícula, IPTU, escritura, contrato, habite-se, alvará). Extrai matrícula, cartório, proprietário+CPF, endereço completo, áreas (terreno/construída), valor venal, ônus/gravames. Use ao receber documentação de imóvel pra avaliação ou contrato.',
    input_schema: {
      type: 'object',
      properties: {
        base64: { type: 'string' },
        mime:   { type: 'string' },
      },
      required: ['base64'],
    },
  },
  {
    name: 'analisar_visual_imovel',
    description: 'Analisa FOTO DE IMÓVEL (fachada, interior, terreno) com olhar de engenheira avaliadora. Retorna tipo, estado de conservação, padrão construtivo, áreas estimadas, acabamentos visíveis, pontos de atenção (rachaduras, infiltração, etc), idade estimada. Útil pra pré-avaliação e composição de laudo.',
    input_schema: {
      type: 'object',
      properties: {
        base64: { type: 'string' },
        mime:   { type: 'string' },
      },
      required: ['base64'],
    },
  },

  // ── v1.43.0: Roma_IA Avaliação Imobiliária ──
  {
    name: 'consultar_norma_imobiliaria',
    description: 'Busca trechos da NBR 14653 ou Tabela TVI Romatec na biblioteca indexada (RAG). Use quando precisa fundamentar decisão técnica em norma específica. Retorna chunks relevantes com título, página, relevância. Filtre por categoria pra precisão (ex: "nbr14653", "tvi", "jurisprudencia").',
    input_schema: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: 'O que buscar (ex: "fatores de homogeneização imóvel urbano")' },
        categoria: { type: 'string', description: 'Filtra biblioteca (opcional)' },
        top_k:     { type: 'number', description: 'Quantos chunks (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gerar_rascunho_ptam',
    description: 'Gera RASCUNHO de PTAM (Parecer Técnico de Avaliação Mercadológica) conforme NBR 14653. Estrutura completa de 10 seções (identificação, objetivo, metodologia, pesquisa de mercado, estimativa, conclusão, etc). Sinaliza "[RASCUNHO — REVISAR]" no topo. Use quando o engenheiro Chefe estiver começando um laudo novo e quiser uma base estruturada. NÃO substitui o engenheiro humano — lista próximas ações que precisam ser feitas (vistoria, ART, etc).',
    input_schema: {
      type: 'object',
      properties: {
        finalidade:      { type: 'string', enum: ['compra_venda','garantia','judicial','inventario','locacao','desapropriacao'] },
        tipo_imovel:     { type: 'string', description: 'urbano_residencial | urbano_comercial | rural | terreno_urbano | terreno_rural | semovente' },
        endereco:        { type: 'string' },
        area_terreno:    { type: 'number', description: 'm²' },
        area_construida: { type: 'number', description: 'm²' },
        caracteristicas: { type: 'string', description: 'idade, padrão, conservação, descrição livre' },
        comparativos: {
          type: 'array',
          description: 'Comparativos de mercado pra pesquisa',
          items: { type: 'object', properties: {
            endereco: { type: 'string' }, area: { type: 'number' }, valor: { type: 'number' }, data: { type: 'string' },
          }},
        },
        metodologia_sugerida: { type: 'string', enum: ['comparativo_dados_mercado','evolutivo','involutivo','renda','custo'] },
        observacoes:     { type: 'string' },
      },
      required: ['finalidade','tipo_imovel','endereco'],
    },
  },
  {
    name: 'validar_laudo_avaliacao',
    description: 'Revisa um LAUDO de avaliação (texto completo) contra NBR 14653 e retorna conformidades, divergências (com severidade critica/alta/media/baixa), pontuação 0-100 e parecer geral. Use pra revisão técnica antes de assinar/entregar laudo seu, OU pra avaliar laudo de terceiro (perícia, contraditório, due diligence).',
    input_schema: {
      type: 'object',
      properties: { texto_laudo: { type: 'string', description: 'Texto completo do laudo a revisar' } },
      required: ['texto_laudo'],
    },
  },
  {
    name: 'sugerir_metodologia_avaliacao',
    description: 'Sugere metodologia adequada conforme NBR 14653 baseado no tipo de imóvel, finalidade e disponibilidade de dados. Retorna método principal, parte da NBR aplicável e justificativa. Use logo no início pra alinhar abordagem antes de coletar dados.',
    input_schema: {
      type: 'object',
      properties: {
        tipo_imovel:        { type: 'string' },
        finalidade:         { type: 'string' },
        tem_comparativos:   { type: 'boolean' },
        tem_renda_locativa: { type: 'boolean' },
        caracteristicas:    { type: 'string' },
      },
      required: ['tipo_imovel','finalidade'],
    },
  },
  {
    name: 'analisar_comparativos',
    description: 'Análise estatística de comparativos de mercado: média/mediana de valor por m², desvio padrão, coeficiente de variação (CV), valor estimado do imóvel-subjeito. Aplica fatores de homogeneização (idade, padrão, conservação) se fornecidos. Avisa se CV>30% (amostra dispersa) ou se <3 amostras (insuficiente pra grau II NBR).',
    input_schema: {
      type: 'object',
      properties: {
        area_subjeito: { type: 'number', description: 'Área do imóvel sendo avaliado em m²' },
        comparativos: {
          type: 'array',
          items: { type: 'object', properties: {
            endereco: { type: 'string' }, area: { type: 'number' }, valor: { type: 'number' }, data: { type: 'string' },
            fator_idade: { type: 'number', description: 'Default 1 (sem ajuste)' },
            fator_padrao: { type: 'number', description: 'Default 1' },
            fator_conservacao: { type: 'number', description: 'Default 1' },
          }, required: ['endereco','area','valor'] },
        },
        data_referencia: { type: 'string' },
      },
      required: ['area_subjeito','comparativos'],
    },
  },

  // ── v1.42.0: Meeting Note-Taker ──
  {
    name: 'gerar_ata_de_texto',
    description: 'Gera ata estruturada de reunião a partir de uma TRANSCRIÇÃO já em texto. Use quando o Chefe colar uma transcrição de áudio que já foi feita por terceiros, ou copiar conteúdo de uma reunião escrita. Claude estrutura: resumo executivo, decisões, action items (com responsável/prazo), datas mencionadas, pessoas envolvidas, tópicos, pontos de atenção. Salva no banco e retorna ata em Markdown.',
    input_schema: {
      type: 'object',
      properties: {
        transcricao:      { type: 'string', description: 'Texto completo da reunião' },
        data_reuniao:     { type: 'string', description: 'YYYY-MM-DD (default = hoje)' },
        duracao_segundos: { type: 'number', description: 'Opcional, duração da reunião em segundos' },
      },
      required: ['transcricao'],
    },
  },
  {
    name: 'gerar_ata_de_audio',
    description: 'Gera ata de reunião a partir de ÁUDIO em base64 (até 25MB). Pipeline: Whisper transcreve → Claude estrutura → salva no banco → retorna ata em Markdown + transcrição completa. Use quando o Chefe gravar reunião pelo celular e mandar o áudio (ou se Telegram receber áudio longo com flag de ata).',
    input_schema: {
      type: 'object',
      properties: {
        audio_base64: { type: 'string', description: 'Áudio em base64 (sem prefixo data:)' },
        mime_type:    { type: 'string', description: 'Default audio/webm. Pode ser audio/ogg, audio/mp4, audio/mp3' },
        data_reuniao: { type: 'string', description: 'YYYY-MM-DD (default = hoje)' },
      },
      required: ['audio_base64'],
    },
  },
  {
    name: 'listar_atas',
    description: 'Lista atas de reunião salvas (mais recentes primeiro). Use quando o Chefe perguntar "que reuniões teve essa semana?", "quais foram as últimas atas?". Retorna ID, título, data, resumo, total de action items e decisões.',
    input_schema: {
      type: 'object',
      properties: { limite: { type: 'number', description: 'Default 30' } },
    },
  },
  {
    name: 'consultar_ata',
    description: 'Retorna ata completa por ID (com transcrição completa, todas as decisões, action items detalhados em Markdown). Use após listar_atas pra abrir uma específica.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'ID retornado por listar_atas' } },
      required: ['id'],
    },
  },

  // ── v1.41.0: Calculadora financeira ──
  {
    name: 'simular_financiamento',
    description: 'Simula financiamento imobiliário/veicular pelas tabelas Price (parcela fixa) ou SAC (parcela decrescente). Use quando cliente perguntar "quanto fica em X meses?", "qual a parcela?", ou pra montar proposta. Retorna primeira/última/média parcela, total pago, total juros e amortização detalhada das primeiras 6 + últimas 3 parcelas.',
    input_schema: {
      type: 'object',
      properties: {
        valor_financiado:  { type: 'number', description: 'Valor total a financiar em reais (ex: 350000)' },
        taxa_juros_mensal: { type: 'number', description: 'Taxa de juros AO MÊS em % (ex: 1.0 pra 1% a.m.)' },
        prazo_meses:       { type: 'number', description: 'Prazo em meses (ex: 360 pra 30 anos)' },
        sistema:           { type: 'string', enum: ['price','sac'], description: 'price=parcela fixa (mais comum), sac=decrescente. Default price.' },
      },
      required: ['valor_financiado','taxa_juros_mensal','prazo_meses'],
    },
  },
  {
    name: 'calcular_correcao_monetaria',
    description: 'Calcula correção monetária de um valor entre 2 datas usando índice anual fornecido (IPCA, IGP-M, INCC, Selic). Use pra atualizar valores de contratos antigos, calcular reajuste de aluguel, ajustar preço de imóvel pelo tempo. ATENÇÃO: usa índice constante (não puxa do BCB em tempo real). Pra precisão use índices oficiais depois.',
    input_schema: {
      type: 'object',
      properties: {
        valor_inicial:    { type: 'number' },
        data_inicial:     { type: 'string', description: 'YYYY-MM-DD' },
        data_final:       { type: 'string', description: 'YYYY-MM-DD (opcional, default = hoje)' },
        indice_anual_pct: { type: 'number', description: 'Índice anual em % (ex: 4.5 pra IPCA de 4.5% a.a.)' },
      },
      required: ['valor_inicial','data_inicial','indice_anual_pct'],
    },
  },
  {
    name: 'calcular_vpl',
    description: 'Calcula Valor Presente Líquido (VPL/NPV) de um fluxo de caixa mensal. Use pra avaliar viabilidade de investimento imobiliário, projeto de obra, compra/venda. Recebe taxa de desconto anual e array de fluxos mensais (negativos=saída, positivos=entrada). Retorna VPL e decisão (investir/não investir).',
    input_schema: {
      type: 'object',
      properties: {
        taxa_desconto_anual_pct: { type: 'number' },
        fluxos_mensais:          { type: 'array', items: { type: 'number' }, description: 'Item 0 = mês 0 (investimento inicial NEGATIVO). Demais = receitas/despesas mensais.' },
      },
      required: ['taxa_desconto_anual_pct','fluxos_mensais'],
    },
  },
  {
    name: 'converter_taxa',
    description: 'Converte taxa de juros entre mensal e anual (capitalização composta). Útil pra "1% a.m. dá quanto ao ano?".',
    input_schema: {
      type: 'object',
      properties: {
        taxa_pct: { type: 'number' },
        de:       { type: 'string', enum: ['mensal','anual'] },
        para:     { type: 'string', enum: ['mensal','anual'] },
      },
      required: ['taxa_pct','de','para'],
    },
  },
  {
    name: 'calcular_itbi',
    description: 'Calcula ITBI (Imposto sobre Transmissão de Bens Imóveis) de um imóvel urbano. Fórmula: max(valor_venda, valor_venal) × alíquota. Açailândia/MA validada (Lei 234/2008): 2% padrão, 0,5% SFH 1º imóvel. Outros municípios usam fallback (2%/0,5%) com aviso pra confirmar na Prefeitura. Imóvel rural retorna 0 e avisa que paga ITR (federal). Doação retorna 0 e avisa ITCMD (estadual). Use quando o Chefe perguntar "quanto fica o ITBI de X" ou "calcula o ITBI dessa venda".',
    input_schema: {
      type: 'object',
      properties: {
        valor_venda:    { type: 'number', description: 'Valor da venda em BRL (ex: 350000)' },
        valor_venal:    { type: 'number', description: 'Valor venal do IPTU em BRL (opcional — se omitido usa valor_venda). Se for maior que venda, é a base.' },
        municipio:      { type: 'string', description: 'Nome do município (ex: "Açailândia")' },
        uf:             { type: 'string', description: 'UF (ex: "MA")' },
        tipo_operacao:  { type: 'string', description: 'compra_venda (default) | sfh_primeiro_imovel (alíquota reduzida) | permuta | doacao' },
        imovel_rural:   { type: 'boolean', description: 'true se é imóvel rural (paga ITR, não ITBI). Default false.' },
      },
      required: ['valor_venda', 'municipio'],
    },
  },
  {
    name: 'listar_municipios_itbi',
    description: 'Lista os municípios que a ZAYRA tem alíquotas ITBI validadas (atualmente: Açailândia/MA). Use quando o Chefe perguntar "quais cidades você sabe calcular ITBI" ou "tem São Luís?".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'calcular_iptu_estimado',
    description: 'ESTIMA o IPTU anual de um imóvel urbano. Açailândia/MA: 0,5% predial residencial, 1,0% comercial, 1,5% territorial (alíquotas plausíveis pra interior MA, NÃO validadas com lei específica — deixa claro pro Chefe que é estimativa). Retorna anual à vista (com desconto típico 10%), parcelado 5x e 10x. Imóvel rural retorna 0 e avisa que paga ITR. SEMPRE diga ao Chefe que valor exato vem só no carnê da Prefeitura (ela usa coeficientes de PGV — Planta Genérica de Valores — sobre idade, localização, padrão construtivo).',
    input_schema: {
      type: 'object',
      properties: {
        valor_venal:  { type: 'number', description: 'Valor venal cadastrado na Prefeitura (NÃO o valor de mercado — geralmente 60-80% do mercado).' },
        municipio:    { type: 'string', description: 'Ex: "Açailândia"' },
        uf:           { type: 'string', description: 'Ex: "MA"' },
        tipo:         { type: 'string', description: 'predial_residencial (default) | predial_comercial | territorial (terreno baldio)' },
        imovel_rural: { type: 'boolean', description: 'true se rural (paga ITR, não IPTU)' },
        ano:          { type: 'number', description: 'Ano de referência (default ano atual)' },
      },
      required: ['valor_venal', 'municipio'],
    },
  },
  {
    name: 'listar_municipios_iptu',
    description: 'Lista municípios com alíquotas IPTU configuradas na ZAYRA. Use quando perguntarem "quais cidades de IPTU você cobre".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'calcular_parcelamento',
    description: 'Calcula parcelamento simples de um valor (com ou sem juros, com ou sem entrada). Use pra propostas comerciais rápidas tipo "vendo por R$ 50k, entrada 10k e 12x sem juros, qual a parcela?".',
    input_schema: {
      type: 'object',
      properties: {
        valor:         { type: 'number' },
        entrada:       { type: 'number', description: 'Default 0' },
        n_parcelas:    { type: 'number' },
        juros_mes_pct: { type: 'number', description: 'Default 0 (sem juros)' },
      },
      required: ['valor','n_parcelas'],
    },
  },

  // ── v1.40.0: Briefing semanal + diagnóstico banco ──
  {
    name: 'gerar_briefing_semanal',
    description: 'Gera o briefing semanal executivo da Romatec (obras em andamento + progresso, equipe + folha da semana, financeiro + categorias de gasto, leads CRM, vistorias). Não envia — só retorna o texto formatado pra revisão. Use rodar_briefing_semanal_agora pra também enviar pro Telegram.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'rodar_briefing_semanal_agora',
    description: 'Gera o briefing semanal E ENVIA agora pelo Telegram do CEO (não espera sexta 17h). Use quando o Chefe pedir "me dá um relatório agora" ou "como tá a semana?".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'diagnostico_banco',
    description: 'Lista TODAS as tabelas do MySQL atual e quantas linhas cada uma tem. Use quando suspeitar de tabela renomeada, banco trocado, ou pra confirmar que dados do CRM estão acessíveis. Útil pra debugar erros tipo "tabela não existe".',
    input_schema: { type: 'object', properties: {} },
  },

  // ── v1.39.1: Sync de contatos CRM → memória ZAYRA ──
  {
    name: 'sincronizar_contatos_crm',
    description: 'Lê todos os leads (leadQualifications) e contatos (contacts) do CRM e grava na memória persistente da ZAYRA (zayra_memory) como type=fact. Idempotente: não duplica, atualiza nome/score se mudou. Usa marker [crm:lead:ID] e [crm:contact:ID]. Rode uma vez pra carga inicial; depois roda automático 1x/dia. Retorna estatísticas (lidos/inseridos/atualizados).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_contato_memoria',
    description: 'Busca contato/lead na memória ZAYRA por nome ou telefone (não precisa consultar o CRM em tempo real — usa a memória sincronizada). Use quando o Chefe perguntar "quem é Karoliny?", "qual o telefone do Danny?", "tenho lead com sobrenome Silva?". Retorna lista com nome, telefone, tipo (lead/contato) e resumo.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nome, sobrenome ou telefone (parcial OK)' } },
      required: ['query'],
    },
  },

  // ── v1.39.0: Push notifications proativas ──
  {
    name: 'listar_alertas_pendentes',
    description: 'Lista alertas proativos pendentes (não reconhecidos). Use quando o Chefe perguntar "tem algum alerta?", "o que precisa atenção?", "tô em dia com tudo?". Retorna alertas de: material em estoque baixo, etapa de obra atrasada, lead sem follow-up há 7+ dias, funcionário sem dias marcados, obra estourando orçamento.',
    input_schema: {
      type: 'object',
      properties: { limite: { type: 'number', description: 'Default 30' } },
    },
  },
  {
    name: 'rodar_detectores_agora',
    description: 'Força rodar TODOS os detectores proativos AGORA (não aguarda o ciclo de 30 min). Útil quando o Chefe quer um "scan executivo" completo. Retorna número de alertas detectados + lista. Notifica via Telegram automaticamente os novos.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'silenciar_alerta',
    description: 'Silencia um alerta proativo por X horas (default 24h, max 720h=30dias). Use quando o Chefe disser "já vi", "deixa pra depois", "não me alerta mais hoje sobre X". Recebe alert_key (vem da listar_alertas_pendentes).',
    input_schema: {
      type: 'object',
      properties: {
        alert_key: { type: 'string', description: 'Chave do alerta (ex: "material_baixo:42")' },
        horas:     { type: 'number', description: 'Horas pra silenciar (default 24)' },
      },
      required: ['alert_key'],
    },
  },
  {
    name: 'reconhecer_alerta',
    description: 'Marca um alerta como RESOLVIDO/visto. ZAYRA não vai mais notificar até o problema voltar a aparecer no detector. Use quando o Chefe disser "já resolvi isso", "tomei providência".',
    input_schema: {
      type: 'object',
      properties: { alert_key: { type: 'string' } },
      required: ['alert_key'],
    },
  },
  {
    name: 'status_whatsapp',
    description: 'Verifica se a instância Z-API da ZAYRA está conectada (WhatsApp do CEO online). Use ANTES de tentar enviar mensagens se houver suspeita de problema. Retorna { connected, smartphoneConnected, needQrCode }. Se needQrCode=true, CEO precisa escanear novo QR no painel Z-API.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'info_whatsapp',
    description: 'Retorna info DETALHADA da instância Z-API: qual número está conectado, perfil, dados do aparelho. Use quando suspeitar que mensagens não estão chegando (talvez a Z-API esteja conectada mas no número errado). Tenta vários endpoints (/device, /phone-info, /me, /profile-info) e retorna tudo que conseguir.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'enviar_localizacao_whatsapp',
    description: 'Envia LOCALIZAÇÃO GPS (lat/lng) pelo WhatsApp do CEO. Útil pra mandar endereço de obra, ponto de encontro, lote/imóvel pra cliente. Coordenadas em decimal (Açailândia/MA: lat=-4.946, lng=-47.501). DESTRUTIVO — exige confirm.',
    input_schema: {
      type: 'object',
      properties: {
        para:      { type: 'string' },
        latitude:  { type: 'number', description: 'Latitude decimal (ex: -4.946)' },
        longitude: { type: 'number', description: 'Longitude decimal (ex: -47.501)' },
        title:     { type: 'string', description: 'Nome do local (ex: "Obra Posto Chapadão")' },
        address:   { type: 'string', description: 'Endereço opcional' },
        confirm:   { type: 'boolean' },
      },
      required: ['para', 'latitude', 'longitude'],
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

  // ── v1.34.0: Geracao automatica de contratos (Fase 2) ──
  {
    name: 'gerar_contrato',
    description: 'Gera contrato Romatec a partir de modelos indexados (Fase 1) preenchendo com dados reais do CEO. Retorna texto + DOCX (base64). USE quando o Chefe pedir "gera contrato de compra e venda com X", "monta locacao do apartamento Y", "faz permuta entre A e B" etc. Sempre confirme dados criticos (CPF, valor, endereco) antes de gerar. O DOCX retornado vai ser enviado por Telegram automaticamente.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['compra_venda','locacao','permuta','comodato','corretagem','outro'],
          description: 'Tipo de contrato — escolhe o modelo indexado correto',
        },
        vendedor: {
          type: 'object',
          description: 'Vendedor (compra_venda) ou Locador (locacao). Inclua o maximo de dados.',
          properties: {
            nome:         { type: 'string' },
            cpf_cnpj:     { type: 'string' },
            rg:           { type: 'string' },
            endereco:     { type: 'string' },
            estado_civil: { type: 'string' },
            profissao:    { type: 'string' },
            telefone:     { type: 'string' },
            email:        { type: 'string' },
          },
        },
        comprador: {
          type: 'object',
          description: 'Comprador (compra_venda) ou Locatario (locacao). Inclua o maximo de dados.',
          properties: {
            nome:         { type: 'string' },
            cpf_cnpj:     { type: 'string' },
            rg:           { type: 'string' },
            endereco:     { type: 'string' },
            estado_civil: { type: 'string' },
            profissao:    { type: 'string' },
            telefone:     { type: 'string' },
            email:        { type: 'string' },
          },
        },
        imovel: {
          type: 'object',
          properties: {
            endereco:   { type: 'string' },
            cidade:     { type: 'string' },
            uf:         { type: 'string' },
            cep:        { type: 'string' },
            area_m2:    { type: 'number' },
            matricula:  { type: 'string' },
            cartorio:   { type: 'string' },
            tipo:       { type: 'string', description: 'residencial/comercial/terreno/rural' },
            descricao:  { type: 'string' },
          },
        },
        condicoes: {
          type: 'object',
          properties: {
            valor_total:     { type: 'number', description: 'Valor TOTAL do contrato (obrigatorio)' },
            forma_pagamento: { type: 'string', description: 'pix/boleto/transferencia/financiamento etc' },
            parcelas:        { type: 'number' },
            valor_entrada:   { type: 'number' },
            data_entrega:    { type: 'string', description: 'YYYY-MM-DD' },
            prazo_meses:     { type: 'number' },
            juros_aa_pct:    { type: 'number' },
            observacoes:     { type: 'string' },
          },
        },
        cidade_foro:      { type: 'string', description: 'Cidade do foro de eleicao. Default: Acailandia/MA' },
        contrato_modelo_id: { type: 'string', description: 'ID especifico do modelo indexado, se quiser forcar um' },
        observacoes_ceo:  { type: 'string', description: 'Instrucoes extras do CEO pro Claude personalizar (ex: "Inclui clausula de retomada se atrasar 3 meses")' },
      },
      required: ['tipo'],
    },
  },
  {
    name: 'listar_contratos_gerados',
    description: 'Lista contratos JÁ GERADOS pela ZAYRA (historico). Use quando o Chefe perguntar "que contratos eu gerei", "ultimos contratos", "contratos do mes" etc. NÃO confunde com memoria_contratos_listar (esse lista MODELOS indexados, nao contratos preenchidos).',
    input_schema: {
      type: 'object',
      properties: { limite: { type: 'number', description: 'Default 50' } },
    },
  },

  // ── v1.46.0: Google Drive integrado ────────────────────────────────────────
  {
    name: 'drive_upload_arquivo',
    description: 'Sobe um arquivo (base64) pro Google Drive do CEO José Romário. Cria a pasta automaticamente se não existir. Pastas-padrão Romatec: "Romatec/Avaliacoes" (PTAMs), "Romatec/Contratos" (gerados), "Romatec/Atas" (reuniões), "Romatec/Relatorios" (briefings). Use após gerar_contrato/gerar_rascunho_ptam/gerar_ata pra arquivar permanentemente. Retorna webViewLink (link de visualização).',
    input_schema: {
      type: 'object',
      properties: {
        arquivo_base64: { type: 'string', description: 'Conteúdo do arquivo em base64' },
        filename:       { type: 'string', description: 'Nome do arquivo com extensão (ex: "PTAM-Casa-João-2026-04-30.docx")' },
        pasta:          { type: 'string', description: 'Caminho da pasta no Drive (ex: "Romatec/Avaliacoes"). Cria se não existir. Default: raiz.' },
        mime_type:      { type: 'string', description: 'MIME type explícito (auto-detect por extensão se omitir)' },
        publico:        { type: 'boolean', description: 'Se true, libera link público "anyone with link". Default false (só CEO).' },
      },
      required: ['arquivo_base64', 'filename'],
    },
  },
  {
    name: 'drive_listar',
    description: 'Lista arquivos do Drive do CEO. Pode filtrar por pasta e/ou por busca textual no nome.',
    input_schema: {
      type: 'object',
      properties: {
        pasta:  { type: 'string', description: 'Filtra por pasta (ex: "Romatec/Avaliacoes")' },
        query:  { type: 'string', description: 'Busca por nome/conteúdo (ex: "PTAM João")' },
        limite: { type: 'number', description: 'Default 30' },
      },
    },
  },
  {
    name: 'drive_buscar',
    description: 'Atalho pra buscar arquivos pelo nome no Drive inteiro. Use quando o Chefe perguntar "onde está o contrato do Pedro" ou "tem a ata de ontem no Drive?".',
    input_schema: {
      type: 'object',
      properties: {
        nome:   { type: 'string', description: 'Trecho do nome do arquivo' },
        limite: { type: 'number', description: 'Default 10' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'drive_apagar',
    description: 'Apaga um arquivo do Drive permanentemente. ADMIN-ONLY. Use somente quando o Chefe pedir explicitamente "apaga isso do Drive".',
    input_schema: {
      type: 'object',
      properties: { file_id: { type: 'string' } },
      required: ['file_id'],
    },
  },
  {
    name: 'drive_compartilhar',
    description: 'Compartilha um arquivo do Drive — gera link "anyone with link" ou compartilha com e-mail específico. Útil pra mandar PTAM pro cliente, contrato pro advogado, etc.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string' },
        email:   { type: 'string', description: 'E-mail destinatário (omite pra link público)' },
        role:    { type: 'string', description: 'reader | writer | commenter. Default reader.' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'drive_status',
    description: 'Status da integração Google Drive (online?, email da conta, quota usada/total). Use pra diagnosticar quando upload falhar.',
    input_schema: { type: 'object', properties: {} },
  },

  // ── v1.45.0: equipe Romatec (multi-tenant) ─────────────────────────────────
  {
    name: 'adicionar_membro_equipe',
    description: 'Cadastra um novo membro da equipe Romatec (Eldemberto, Rosielma, etc) com role específico. ADMIN-ONLY. Após cadastrado com telegram_chat_id, o membro pode interagir com a ZAYRA dentro do escopo do role dele. Roles disponíveis: admin (tudo), engenheiro (avaliações/NBR/PTAM), corretor (CRM/leads), comercial (contratos/financeiro), leitura (só consulta).',
    input_schema: {
      type: 'object',
      properties: {
        nome:             { type: 'string', description: 'Nome completo do membro' },
        telegram_chat_id: { type: 'string', description: 'chat_id do Telegram do membro (peça pra ele rodar /start no @userinfobot). Sem isso ele não consegue conversar com a ZAYRA.' },
        whatsapp_phone:   { type: 'string', description: 'Telefone WhatsApp com DDI (5598..., opcional, fallback de delegação)' },
        email:            { type: 'string' },
        role:             { type: 'string', description: 'admin | engenheiro | corretor | comercial | leitura. Default: leitura.' },
        cargo:            { type: 'string', description: 'Ex: Engenheiro Avaliador, Corretora Sênior, Diretor Comercial' },
        observacoes:      { type: 'string' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_membros_equipe',
    description: 'Lista membros da equipe Romatec cadastrados na ZAYRA. Pode filtrar por role e por ativos.',
    input_schema: {
      type: 'object',
      properties: {
        role:          { type: 'string', description: 'Filtra por role (admin/engenheiro/corretor/comercial/leitura)' },
        ativos_apenas: { type: 'boolean', description: 'Default true. Use false pra ver inativos também.' },
      },
    },
  },
  {
    name: 'alterar_role_membro',
    description: 'Promove/rebaixa um membro da equipe (muda o role). ADMIN-ONLY. Use quando o CEO falar "promove a Rosielma pra comercial" ou "deixa o Pedro só como leitura".',
    input_schema: {
      type: 'object',
      properties: {
        id:        { type: 'number', description: 'ID do membro (de listar_membros_equipe)' },
        nome:      { type: 'string', description: 'Alternativa ao id: nome (ou parte) do membro' },
        novo_role: { type: 'string', description: 'admin | engenheiro | corretor | comercial | leitura' },
      },
      required: ['novo_role'],
    },
  },
  {
    name: 'remover_membro_equipe',
    description: 'Desativa um membro da equipe (soft-delete: ativo=0, mantém histórico). ADMIN-ONLY. Após desativar ele perde acesso à ZAYRA pelo Telegram.',
    input_schema: {
      type: 'object',
      properties: {
        id:   { type: 'number' },
        nome: { type: 'string', description: 'Alternativa ao id: nome do membro' },
      },
    },
  },
  {
    name: 'delegar_para_membro',
    description: 'Delega uma tarefa pra um membro específico da equipe Romatec, enviando mensagem pelo Telegram dele (ou WhatsApp como fallback). Diferente de delegar_tarefa (que usa lista hard-coded de colaboradores), esse usa a tabela romatec_team_members. Use quando o Chefe falar "manda o Eldemberto fazer X" ou "fala com a Rosielma pra Y".',
    input_schema: {
      type: 'object',
      properties: {
        membro_nome: { type: 'string', description: 'Nome (ou parte) do membro' },
        tarefa:      { type: 'string', description: 'Descrição da tarefa' },
        prazo:       { type: 'string', description: 'Prazo opcional (ex: "hoje 18h", "sexta")' },
      },
      required: ['membro_nome', 'tarefa'],
    },
  },
];

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  console.log(`[Tool] → ${name}`, JSON.stringify(input).slice(0, 200));

  // v1.45.0: gate por role (multi-tenant). Admin/CEO passam direto.
  const caller = _currentCaller;
  if (caller && caller.role !== 'admin') {
    if (ADMIN_ONLY_TOOLS.has(name)) {
      return { toolName: name, success: false, error: `Acesso negado: a tool "${name}" é restrita ao CEO/admin. Seu papel: ${caller.role}.` };
    }
    if (!temPermissao(caller.role, name)) {
      return { toolName: name, success: false, error: `Acesso negado: ${caller.nome} (${caller.role}) não tem permissão para "${name}". Peça ao CEO José Romário.` };
    }
  }

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
        const inp = input as { para: string; mensagem: string; confirm?: boolean };
        if (!inp.confirm) {
          data = { preview: true, message: `[PREVIEW] Vou enviar pelo WhatsApp do Chefe pra ${inp.para}: "${inp.mensagem}". Reenvie com confirm:true após autorização.` };
        } else {
          const r = await sendReply(inp.para, inp.mensagem);
          data = { success: true, para: r.phone, mensagem: inp.mensagem, messageId: r.messageId, enviado_em: new Date().toISOString() };
        }
        break;
      }
      case 'enviar_audio_whatsapp': {
        const inp = input as { para: string; texto: string; confirm?: boolean };
        if (!inp.confirm) {
          data = { preview: true, message: `[PREVIEW] Vou gerar áudio TTS e enviar pra ${inp.para}: "${inp.texto.slice(0, 120)}${inp.texto.length > 120 ? '…' : ''}". Reenvie com confirm:true.` };
        } else {
          const r = await enviarAudioTTS(inp.para, inp.texto);
          data = { success: true, para: r.phone, segundos_estimados: r.segundos, messageId: r.messageId };
        }
        break;
      }
      case 'enviar_imagem_whatsapp': {
        const inp = input as { para: string; imageUrl: string; caption?: string; confirm?: boolean };
        if (!inp.confirm) {
          const tipo = inp.imageUrl.startsWith('data:') ? 'imagem (base64)' : `imagem (${inp.imageUrl.slice(0, 60)}…)`;
          data = { preview: true, message: `[PREVIEW] Vou enviar ${tipo} pra ${inp.para}${inp.caption ? ' com legenda "' + inp.caption + '"' : ''}. Reenvie com confirm:true.` };
        } else {
          const r = await sendImage(inp.para, inp.imageUrl, inp.caption);
          data = { success: true, para: r.phone, messageId: r.messageId, caption: inp.caption };
        }
        break;
      }
      case 'enviar_documento_whatsapp': {
        const inp = input as { para: string; docBase64: string; fileName: string; confirm?: boolean };
        if (!inp.confirm) {
          const sizeKb = Math.round((inp.docBase64.length * 3 / 4) / 1024);
          data = { preview: true, message: `[PREVIEW] Vou enviar documento "${inp.fileName}" (${sizeKb}KB) pra ${inp.para}. Reenvie com confirm:true.` };
        } else {
          const r = await sendDocument(inp.para, inp.docBase64, inp.fileName);
          data = { success: true, para: r.phone, fileName: inp.fileName, messageId: r.messageId };
        }
        break;
      }
      // ── v1.44.0: OCR Documentos ──
      case 'extrair_dados_rg':
        data = await extrairDadosRG(input as { base64: string; mime?: string });
        break;
      case 'extrair_dados_cnh':
        data = await extrairDadosCNH(input as { base64: string; mime?: string });
        break;
      case 'extrair_comprovante_endereco':
        data = await extrairComprovanteEndereco(input as { base64: string; mime?: string });
        break;
      case 'extrair_documento_imovel':
        data = await extrairDocumentoImovel(input as { base64: string; mime?: string });
        break;
      case 'analisar_visual_imovel':
        data = await analisarVisualImovel(input as { base64: string; mime?: string });
        break;

      // ── v1.43.0: Roma_IA Avaliação Imobiliária ──
      case 'consultar_norma_imobiliaria':
        data = await consultarNormaImobiliaria(input as Parameters<typeof consultarNormaImobiliaria>[0]);
        break;
      case 'gerar_rascunho_ptam':
        data = await gerarRascunhoPtam(input as unknown as Parameters<typeof gerarRascunhoPtam>[0]);
        break;
      case 'validar_laudo_avaliacao':
        data = await validarLaudoAvaliacao(input as { texto_laudo: string });
        break;
      case 'sugerir_metodologia_avaliacao':
        data = await sugerirMetodologiaAvaliacao(input as Parameters<typeof sugerirMetodologiaAvaliacao>[0]);
        break;
      case 'analisar_comparativos':
        data = analisarComparativos(input as unknown as Parameters<typeof analisarComparativos>[0]);
        break;

      // ── v1.42.0: Meeting Note-Taker ──
      case 'gerar_ata_de_texto':
        data = await gerarAtaDeTranscricao(input as Parameters<typeof gerarAtaDeTranscricao>[0]);
        break;
      case 'gerar_ata_de_audio':
        data = await gerarAtaDeAudio(input as Parameters<typeof gerarAtaDeAudio>[0]);
        break;
      case 'listar_atas':
        data = await listarAtas(input as { limite?: number });
        break;
      case 'consultar_ata':
        data = await consultarAta(input as { id: string });
        break;

      // ── v1.41.0: Calculadora financeira ──
      case 'simular_financiamento':
        data = simularFinanciamento(input as unknown as Parameters<typeof simularFinanciamento>[0]);
        break;
      case 'calcular_correcao_monetaria':
        data = calcularCorrecaoMonetaria(input as unknown as Parameters<typeof calcularCorrecaoMonetaria>[0]);
        break;
      case 'calcular_vpl':
        data = calcularVPL(input as unknown as Parameters<typeof calcularVPL>[0]);
        break;
      case 'converter_taxa':
        data = converterTaxa(input as unknown as Parameters<typeof converterTaxa>[0]);
        break;
      case 'calcular_parcelamento':
        data = calcularParcelamento(input as unknown as Parameters<typeof calcularParcelamento>[0]);
        break;
      case 'calcular_itbi':
        data = calcularItbi(input as unknown as Parameters<typeof calcularItbi>[0]);
        break;
      case 'listar_municipios_itbi':
        data = listarMunicipiosValidados();
        break;
      case 'calcular_iptu_estimado':
        data = calcularIptu(input as unknown as Parameters<typeof calcularIptu>[0]);
        break;
      case 'listar_municipios_iptu':
        data = listarMunicipiosIptu();
        break;

      // ── v1.40.0: Briefing semanal + diagnóstico banco ──
      case 'gerar_briefing_semanal': {
        const r = await gerarBriefingSemanal();
        data = { texto: r.texto, dados: r.dados };
        break;
      }
      case 'rodar_briefing_semanal_agora':
        data = await enviarBriefingSemanal();
        break;
      case 'diagnostico_banco': {
        type Row = import('mysql2').RowDataPacket & { name: string; rows: number };
        const [tables] = await poolDb.execute<Row[]>(
          `SELECT TABLE_NAME AS name, TABLE_ROWS AS rows
           FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE()
           ORDER BY TABLE_NAME ASC`,
        );
        const [dbInfo] = await poolDb.execute<import('mysql2').RowDataPacket[]>(
          'SELECT DATABASE() AS db, VERSION() AS version, USER() AS user',
        );
        data = {
          banco_atual:    (dbInfo[0] as { db: string }).db,
          mysql_version:  (dbInfo[0] as { version: string }).version,
          mysql_user:     (dbInfo[0] as { user: string }).user,
          total_tabelas:  tables.length,
          tabelas:        tables.map(t => ({ nome: t.name, linhas_aprox: Number(t.rows) })),
        };
        break;
      }

      // ── v1.39.1: Sync contatos CRM → memória ZAYRA ──
      case 'sincronizar_contatos_crm':
        data = await sincronizarContatosCRM();
        break;
      case 'buscar_contato_memoria':
        data = await buscarContatoMemoria((input as { query: string }).query);
        break;

      // ── v1.39.0: Push notifications proativas ──
      case 'listar_alertas_pendentes':
        data = await listarAlertasPendentes(input as { limite?: number });
        break;
      case 'rodar_detectores_agora':
        data = await rodarDetectoresAgora();
        break;
      case 'silenciar_alerta':
        data = await silenciarAlerta(input as { alert_key: string; horas?: number });
        break;
      case 'reconhecer_alerta':
        data = await reconhecerAlerta(input as { alert_key: string });
        break;
      case 'status_whatsapp':
        data = await statusInstancia();
        break;
      case 'info_whatsapp':
        data = await infoInstancia();
        break;
      case 'enviar_localizacao_whatsapp': {
        const inp = input as { para: string; latitude: number; longitude: number; title?: string; address?: string; confirm?: boolean };
        if (!inp.confirm) {
          data = { preview: true, message: `[PREVIEW] Vou enviar localização (${inp.latitude}, ${inp.longitude})${inp.title ? ' "' + inp.title + '"' : ''} pra ${inp.para}. Reenvie com confirm:true.` };
        } else {
          const r = await sendLocation(inp.para, inp.latitude, inp.longitude, inp.title, inp.address);
          data = { success: true, para: r.phone, messageId: r.messageId, coordenadas: { lat: inp.latitude, lng: inp.longitude } };
        }
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

      // ── v1.34.0: Geracao de contratos (Fase 2) ──
      case 'gerar_contrato': {
        const result = await gerarContrato(input as unknown as Parameters<typeof gerarContrato>[0]);
        // Envia DOCX direto por Telegram (em vez de retornar base64 enorme no contexto)
        try {
          const ceoIds = (process.env.TELEGRAM_AUTHORIZED_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
          if (ceoIds.length > 0 && process.env.TELEGRAM_BOT_TOKEN) {
            const buf = Buffer.from(result.docx_base64, 'base64');
            const fileName = `${result.titulo.replace(/[^a-zA-Z0-9-_]/g, '_')}_${Date.now()}.docx`;
            const fd = new FormData();
            fd.append('chat_id', ceoIds[0]);
            fd.append('document', new Blob([buf as unknown as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), fileName);
            fd.append('caption', `📄 ${result.titulo}\n${result.total_clausulas} cláusulas\nModelo: ${result.modelo_usado}`);
            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd });
            console.log(`[gerar_contrato] DOCX enviado pra Telegram chat ${ceoIds[0]}`);
          }
        } catch (e) {
          console.warn(`[gerar_contrato] falha ao enviar DOCX por Telegram: ${(e as Error).message}`);
        }
        // Retorna pro LLM apenas metadata + preview do texto (não o base64 inteiro)
        data = {
          contrato_gerado_id: result.contrato_gerado_id,
          titulo:             result.titulo,
          modelo_usado:       result.modelo_usado,
          total_clausulas:    result.total_clausulas,
          preview_texto:      result.texto.slice(0, 500) + '...',
          docx_enviado_telegram: true,
          tamanho_bytes:      Buffer.from(result.docx_base64, 'base64').length,
        };
        break;
      }
      case 'listar_contratos_gerados':
        data = await listarContratosGerados(input as { limite?: number });
        break;

      // ── v1.46.0: Google Drive ────────────────────────────────────────────
      case 'drive_upload_arquivo': {
        const inp = input as { arquivo_base64: string; filename: string; pasta?: string; mime_type?: string; publico?: boolean };
        if (!inp.arquivo_base64) throw new Error('arquivo_base64 obrigatório.');
        const buf = Buffer.from(inp.arquivo_base64, 'base64');
        data = await drive.uploadArquivo({
          buffer:   buf,
          filename: inp.filename,
          pasta:    inp.pasta,
          mimeType: inp.mime_type,
          publico:  inp.publico,
        });
        break;
      }
      case 'drive_listar':
        data = await drive.listarArquivos(input as { pasta?: string; query?: string; limite?: number });
        break;
      case 'drive_buscar':
        data = await drive.buscarPorNome(input.nome as string, input.limite as number | undefined);
        break;
      case 'drive_apagar':
        data = await drive.apagarArquivo(input.file_id as string);
        break;
      case 'drive_compartilhar':
        data = await drive.compartilharArquivo(input as Parameters<typeof drive.compartilharArquivo>[0]);
        break;
      case 'drive_status':
        data = await drive.statusDrive();
        break;

      // ── v1.45.0: equipe Romatec ──────────────────────────────────────────
      case 'adicionar_membro_equipe':
        data = await tmAdicionar(input as Parameters<typeof tmAdicionar>[0]);
        break;
      case 'listar_membros_equipe':
        data = await tmListar(input as { ativos_apenas?: boolean; role?: TeamRole });
        break;
      case 'alterar_role_membro': {
        const id = typeof input.id === 'number' ? input.id : undefined;
        const novoRole = input.novo_role as TeamRole;
        let alvoId = id;
        if (!alvoId && input.nome) {
          const m = await tmBuscarPorNome(input.nome as string);
          if (!m) throw new Error(`Membro "${input.nome}" não encontrado.`);
          alvoId = m.id;
        }
        if (!alvoId) throw new Error('Informe id ou nome do membro.');
        data = await tmAlterarRole(alvoId, novoRole);
        break;
      }
      case 'remover_membro_equipe': {
        const id = typeof input.id === 'number' ? input.id : undefined;
        let alvoId = id;
        if (!alvoId && input.nome) {
          const m = await tmBuscarPorNome(input.nome as string);
          if (!m) throw new Error(`Membro "${input.nome}" não encontrado.`);
          alvoId = m.id;
        }
        if (!alvoId) throw new Error('Informe id ou nome do membro.');
        data = await tmRemover(alvoId);
        break;
      }
      case 'delegar_para_membro':
        data = await tmDelegar(input as Parameters<typeof tmDelegar>[0]);
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
