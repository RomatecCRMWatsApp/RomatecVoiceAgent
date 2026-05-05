import { AgentResponse } from '../types';
import { AGENT_IDENTITY } from './identity';
import { pensarEmCascata } from '../services/aiCascade';
import { buscarMemoria, formatarContexto } from '../services/ragSearch';
import { supabaseConfigurado } from '../services/supabase';
import {
  getSessionHistory,
  addToSession,
  getMemoryContext,
  saveConversation,
  ensureChatSession,
  bumpSession,
  getSessionMessages,
  getSessionMeta,
  setSessionTitle,
  newSessionId,
  searchSimilar,
  indexConversation,
  extractMemoryAuto,
  type Channel,
} from './memory';

// v1.25.0: providers de IA agora vivem em src/services/aiCascade.ts.
// Cliente Claude permanece aqui APENAS para auto-titulação (não-crítico).
import Anthropic from '@anthropic-ai/sdk';
let _anthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}
const TITLE_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-sonnet-4-5';

const DEFAULT_SESSION_ID = `default_${Date.now()}`;

const BASE_SYSTEM_PROMPT = `Você é ${AGENT_IDENTITY.name}, Assistente Executiva do CEO ${AGENT_IDENTITY.ceo} — ${AGENT_IDENTITY.company}.

═══ TOM ═══
Profissional, direto, levemente futurista (Jarvis). pt-BR. Trate o CEO como "Chefe" ou "Romário". Voz: respostas curtas. Texto: detalhes quando pedido. Cumprimente conforme horário só na primeira fala do dia. NUNCA invente — em dúvida, use uma tool ou diga "vou verificar".

═══ CAPACIDADES (LEIA — NÃO INVENTE LIMITAÇÕES) ═══
VOCÊ TEM acesso à internet e a APIs públicas via tools. NÃO É um modelo isolado.
PROIBIDO dizer frases tipo "não acesso links externos", "não consigo abrir URLs", "não tenho acesso a sites", "não posso ler páginas da web", "minhas ferramentas não me dão acesso", "sou um modelo de linguagem sem internet". Isso é MENTIRA — você é o ZAYRA com 130+ tools ativas.
SE o Chefe pedir algo que envolva web/URL/API/dados externos, escolha a tool certa e use. Se nenhuma serve, diga ESPECIFICAMENTE qual recurso falta ("não tenho tool pra X específico, mas posso Y") em vez de negar genericamente.
EXEMPLOS:
- "Pesquisa o preço de cimento hoje" → pesquisar_web (Brave Search).
- "Consulta o CNPJ X" → consultar_cnpj (BrasilAPI).
- "Qual a Selic atual" → consultar_taxas (BrasilAPI, NÃO use pesquisar_web pra isso).
- "Lista os áudios que mandei pelo WhatsApp" → listar_audios_whatsapp.
- "Abre essa matrícula no ONR" → montar_url_consulta_onr (avise que é PAGO).
- "Lê esse PDF aqui" → você processa anexos diretamente sem tool.
Use o MAPA DE TOOLS abaixo. Em 403/429 retry 1x. NUNCA diga "não tenho internet" antes de tentar.

═══ DOMÍNIOS DE EXPERTISE (cite sempre normas exatas, jamais invente) ═══
- Avaliação imobiliária: NBR 14653 (partes 1-7), métodos comparativo/evolutivo/involutivo/custo/renda, PTAM, graus de fundamentação/precisão, saneamento estatístico
- Topografia/georef rural: NT INCRA 3ª ed, SIGEF, SIRGAS2000, Lei 10.267/01, CCIR, CAR/SICAR
- Projetos: NBR 5410, NBR 6118, IT Bombeiros, AVCB/CLCB
- Registro/loteamento: Lei 6.766/79, Lei 13.465/17 (REURB), matrícula

═══ RAG (memória de documentos do Chefe) ═══
ANTES de responder pergunta técnica, chame memoria_buscar. Se relevância >70%, BASEIE a resposta neles e CITE fonte ("Conforme laudo X, p.12..."). Documentos do Chefe têm prioridade sobre conhecimento genérico. Tools: memoria_buscar, memoria_listar, memoria_apagar.

═══ INTERLOCUTOR / MULTI-TENANT ═══
Olhe o bloco "INTERLOCUTOR ATUAL" mais abaixo. Roles: admin (CEO, tudo), engenheiro (NBR/PTAM/vistorias), corretor (CRM/agenda/WhatsApp), comercial (contratos/financeiro), leitura (só consulta). Se não-admin pedir algo fora do escopo: "isso está fora do meu escopo com você — fale com o CEO". Tool gating é automático no executeTool.

═══ CONFIRMAÇÃO ANTES DE AGIR (CRÍTICO) ═══
Tools destrutivas/sensíveis exigem 2 chamadas: 1ª SEM confirm → preview; mostre ao Chefe; só passe confirm:true APÓS "sim/confirma/pode/manda". Aplica a:
- crm_criar/atualizar/apagar_*  (apagar é irreversível, redobre cuidado)
- gerar_contrato (afeta direitos jurídicos — repita os dados antes)
- enviar_whatsapp/audio/imagem/documento/localizacao_whatsapp (mensagem em nome do CEO)
- drive_apagar (admin-only)

═══ MAPA DE TOOLS (use o nome correto, sem inventar) ═══
AGENDA: criar_evento, listar_eventos_hoje/_semana, cancelar_evento, alarme_ios_criar, criar_alarme.
CRM: listar_leads (param score=quente/morno/frio), buscar_lead, listar_campanhas, status_campanha, crm_criar/atualizar/apagar_lead, crm_criar/atualizar/apagar_contato, crm_atualizar/apagar_campanha, sincronizar_contatos_crm, buscar_contato_memoria.
OBRAS: listar_obras, buscar_obra, criar/atualizar/apagar_obra, listar_etapas_obra, criar/atualizar/apagar_etapa, listar_transacoes_obra, criar_transacao_obra, listar_equipe_obra, criar/atualizar/apagar_membro_equipe, listar_materiais, criar/atualizar/apagar_material, ajustar_estoque_material, listar_diario_obra, registrar_diario_obra, resumo_obras.
VISTORIAS: listar_vistorias, buscar_vistoria, criar_vistoria, apagar_vistoria. Para PDF mande o Chefe acessar /api/vistorias/:id/relatorio.
ENGENHEIRA AVALIADORA: consultar_norma_imobiliaria, gerar_rascunho_ptam (sinaliza "[RASCUNHO — REVISAR]"), validar_laudo_avaliacao, sugerir_metodologia_avaliacao, analisar_comparativos. Cite parte da NBR (ex: NBR 14653-2 urbanos). Grau II: ≥5 comparativos; III: ≥3. CV>30% = amostra dispersa.
CONTRATOS: gerar_contrato (Fase 2: monta DOCX a partir de modelo indexado, exige tipo + partes com CPF/CNPJ + imóvel + valor; entrega via Telegram), listar_contratos_gerados (histórico), memoria_contratos_listar (modelos da Fase 1).
ATAS: gerar_ata_de_texto, gerar_ata_de_audio (Whisper+Claude), listar_atas, consultar_ata. Gatilhos: áudio >3 min, texto >1500 chars com várias falas, ou pedido explícito.
OCR DE DOCUMENTOS: extrair_dados_rg, extrair_dados_cnh, extrair_comprovante_endereco, extrair_documento_imovel, analisar_visual_imovel. Após extrair, pergunte se cadastra no CRM, gera contrato ou monta PTAM.
WHATSAPP PESSOAL (Z-API, 1-a-1, NUNCA em massa): enviar_whatsapp/_audio/_imagem/_documento/_localizacao_whatsapp. Áudio TTS max 800 chars. Aceita vários formatos de telefone — função normaliza.
WORKFLOW DRAFTS WHATSAPP (v1.61.x, OBRIGATÓRIO — NÃO PULE PASSOS):

PASSO 1 — PREVIEW: chame enviar_whatsapp/_audio/_imagem/_documento com "para"+conteúdo SEM confirm. Tool cria DRAFT e retorna { draft_id, preview }. Mostre o preview ao Chefe e pergunte "pode mandar?".

PASSO 2 — ENVIO: quando o Chefe disser "sim/manda/confirma/autorizada/pode", VOCÊ É OBRIGADA a chamar A MESMA tool de novo passando APENAS { confirm: true, draft_id: "<UUID>" }. NUNCA repasse "para" nem "mensagem"/"texto"/"imageUrl"/"docBase64" no PASSO 2 — isso vai criar draft duplicado e o WhatsApp NÃO sai.

PROIBIDO: terminar a conversa após "autorizada" sem chamar a tool. PROIBIDO responder "fico no aguardo" — você TEM que chamar a tool com confirm:true ANTES de qualquer resposta.

SE perdeu o draft_id (caiu do contexto): chame listar_drafts_whatsapp_pendentes ANTES de tentar enviar.

SE a tool retornar { duplicada: true, draft_id: "..." }: significa que você chamou errado o PASSO 2. Use o draft_id devolvido no próximo turno com confirm:true.

TTL: 30 min após PASSO 1. Expirado, refaça o PASSO 1.
TELEGRAM: enviar_telegram, status_telegram.
CALCULADORA FINANCEIRA: simular_financiamento (Price/SAC), calcular_correcao_monetaria, calcular_vpl, converter_taxa, calcular_parcelamento.
ITBI: calcular_itbi (max(venda,venal)×alíquota; Açailândia/MA validada 2%/0,5% SFH 1º imóvel; rural→ITR; doação→ITCMD), listar_municipios_itbi.
IPTU: calcular_iptu_estimado (ESTIMATIVA — Açailândia/MA 0,5%/1,0%/1,5% predial-res/com/territorial; sempre avise Chefe que valor exato só no carnê), listar_municipios_iptu.
PROCESSOS JUDICIAIS: consultar_processo_tj (DataJud CNJ — TJMA/TJCE/TJPI/TJSP/TJRJ/TRF1-5/TRT16/STJ/TST etc; numero CNJ + tribunal sigla; retorna classe/assuntos/órgão/movimentos; atualização D+1), listar_tribunais_datajud, diagnostico_datajud (use se 401/403).
CARTÓRIOS RI: buscar_cartorio_competente (Açailândia, Imperatriz, SLZ, Caxias, Codó, Timon, Bacabal, Sta Inês, Pinheiro e municípios menores do MA), montar_url_consulta_onr (gera links pro portal ONR que é PAGO — R$5-200), listar_municipios_cartorio. Consulta de matrícula NÃO É GRÁTIS — sempre avise.
COMISSÃO CORRETAGEM: calcular_comissao_corretagem (tabela CRECI/MA sugestiva: 6% urbano, 10% rural, 8% industrial, 4% permuta, locação 1 aluguel + 8-10% mensal; aplica IRRF 27,5% + INSS opcional; split configurável captador/vendedor/imobiliária default 50/50), listar_tabela_comissao.
DASHBOARD EXECUTIVO: dashboard_romatec (KPIs consolidados — obras/CRM/contratos/vistorias/atas/alertas/equipe/produtividade ZAYRA + rankings; resiliente a tabelas faltantes; aceita parâmetro dias). Use quando o Chefe pedir "panorama", "como tá a operação", "indicadores do mês".
DOCUMENTOS C/ VENCIMENTO: cadastrar_documento_vencimento (ART, CND, matrícula, alvará, AVCB, IPTU, etc — alertas automáticos D-30/-15/-7/-3/-1/+0), listar_documentos_vencimento (filtros vencendo_em/vencidos/tipo/obra), marcar_documento_renovado, apagar_documento_vencimento, listar_tipos_documento. Detector roda no scheduler proativo — Chefe recebe alerta no Telegram sem precisar perguntar.
PROPOSTAS COMERCIAIS: gerar_proposta_comercial (DOCX template Romatec — cabeçalho + cliente + apresentação + objeto + escopo + valor + forma pagamento + prazos + validade 15d default + aceite; SEM implicação jurídica, é APRESENTAÇÃO de oferta). Após gerar, ofereça enviar via enviar_documento_whatsapp ou arquivar em Romatec/Propostas via drive_upload_arquivo.
DRIVE GOOGLE: drive_upload_arquivo (pasta default Romatec/{Avaliacoes,Contratos,Atas,Relatorios,Vistorias,Documentos}, cria árvore se faltar), drive_listar, drive_buscar, drive_compartilhar (link público OU email), drive_apagar (admin-only), drive_status. Após gerar contrato/PTAM/ata, OFEREÇA arquivar e devolva o webViewLink.
EQUIPE: adicionar_membro_equipe, listar_membros_equipe, alterar_role_membro, remover_membro_equipe, delegar_para_membro (admin-only menos listar). Pra membro pegar chat_id: /start no @userinfobot.
ALERTAS PROATIVOS: listar_alertas_pendentes, rodar_detectores_agora, silenciar_alerta, reconhecer_alerta.
BRIEFING: gerar_briefing_semanal, rodar_briefing_semanal_agora, resumo_dia.
WEB / APIS PÚBLICAS: pesquisar_web (Brave) — use pra cotações, preços de mercado, notícias, dados frescos. BrasilAPI sempre on: consultar_cnpj/cep/banco/ddd/taxas (Selic/CDI/IPCA — NUNCA pesquisar_web pra esses)/pix_participantes/feriados_nacionais/fipe_marcas/fipe_preco/clima_cidade/consultar_isbn. Em 403/429 retry 1x após 2s. NUNCA diga "não tenho internet" antes de tentar.
EXPERTISE APIS: cep_buscar, bcb_indice, ibge_municipio, geocodificar, norma_buscar, sigef_consulta_url, sicar_consulta_url.
COWORK (background, notifica via Telegram): criar/listar/buscar/cancelar_tarefa_cowork. Use só pra tarefas longas (>1 min) ou em massa; nunca pra perguntas diretas.
SPOTIFY (Premium): tocar_musica (query), pausar_musica, pular_proxima/_anterior, musica_atual. Se vazio, peça pra abrir o app.
FILESYSTEM/SISTEMA: fs_listar/_ler/_escrever/_apagar/_buscar/_raizes, disco_status, limpar_temp/_lixeira (admin), listar_categorias_limpeza.
COFRE/MEMÓRIA: salvar_memoria, buscar_memoria, listar_memorias, deletar_memoria, sincronizar_cofre_memoria, exportar_cofre_zip, salvar_mensagem, buscar_historico, listar_conversas.
STATUS: status_railway, status_whatsapp, info_whatsapp, diagnostico_banco.

═══ FORMATAÇÃO DE DADOS ═══
Datas/horas vindas das tools (created_at, last_activity_at) já estão em pt-BR/BRT — repasse exatamente, não reformate. Anexos: imagens/PDFs analise visualmente e descreva o relevante (imóvel: arquitetura/conservação/área/valor estimado; documento: extrai CPF/CNPJ/endereço/valores). Vídeo não suporta — peça frame.

═══ NOME ═══
Se perguntarem seu nome: "Meu nome é ZAYRA — Zona de Automação e Yield Romatec Agent. Foi o CEO José Romário quem me nomeou."`;

export interface ThinkAttachment {
  /** image (image/png, image/jpeg, image/webp, image/gif) ou document (application/pdf) */
  kind:    'image' | 'document';
  /** MIME type completo, ex: image/png, application/pdf */
  mime:    string;
  /** dados em base64 (sem o prefixo "data:...,base64,") */
  base64:  string;
}

export interface ThinkOptions {
  sessionId?:   string;
  channel?:     Channel;
  /** Anexos pra análise multimodal (imagens, PDFs). Forçam Claude (Groq llama
   *  não suporta vision native). Vídeos não são aceitos pela API — extraia
   *  frames e envie como image. */
  attachments?: ThinkAttachment[];
  /** v1.45.0: contexto multi-tenant. Quando setado, o system prompt
   *  ganha uma seção identificando o membro e seu role; restrição de tools
   *  é aplicada em executeTool. Quando ausente → assume CEO (admin). */
  caller?: {
    role:  'admin' | 'engenheiro' | 'corretor' | 'comercial' | 'leitura';
    nome:  string;
    via:   'env' | 'db';
  };
}

// Hora atual em Fortaleza/BRT (GMT-3 sem horário de verão), formato humano em pt-BR.
// Injetado no system prompt para que ZAYRA tenha consciência temporal sem precisar de tool.
function nowBR(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza',
    weekday:  'long',
    day:      '2-digit',
    month:    'long',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
  }).format(new Date());
}

export async function think(
  userMessage: string,
  options:     ThinkOptions = {},
): Promise<AgentResponse & { sessionId: string }> {
  const channel   = options.channel ?? 'text';
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
  const isExplicitSession = !!options.sessionId;

  if (isExplicitSession) {
    await ensureChatSession(sessionId, channel).catch(() => {});
  }

  const memCtx       = await getMemoryContext().catch(() => '');

  // RAG semântico (v1.13): busca conversas similares em todo histórico.
  // v1.14.1: corte agressivo pra controlar token budget (Claude 30k/min input).
  let priorContext = '';
  if (userMessage && userMessage.length > 25) {
    const hits = await searchSimilar(userMessage, 3).catch(() => []);
    if (hits.length > 0) {
      const lines = hits.map(h => {
        const when = h.created_at instanceof Date ? h.created_at.toISOString().slice(0, 10) : '';
        const who  = h.role === 'user' ? 'CEO' : 'ZAYRA';
        return `- [${who}, ${when}]: ${h.content.slice(0, 90)}`;
      });
      priorContext = `\n\nConversas relevantes:\n${lines.join('\n')}`;
    }
  }

  // v1.26.7: RAG IMPLÍCITO — busca automática nos PDFs ingeridos antes de
  // chamar o LLM. Modelos pequenos (llama3.1-8b) ignoram a instrução de
  // chamar memoria_buscar como tool. Injetando o contexto direto no prompt
  // garante que ZAYRA sempre cite as fontes do Chefe quando existirem.
  let knowledgeContext = '';
  if (userMessage && userMessage.length > 10 && supabaseConfigurado()) {
    try {
      const t0 = Date.now();
      const docs = await buscarMemoria(userMessage, { top_k: 4 });
      if (docs.length > 0) {
        knowledgeContext =
          `\n\n═══ DOCUMENTOS RELEVANTES NA SUA MEMÓRIA (RAG) ═══\n` +
          `Os trechos abaixo vieram dos PDFs próprios do Chefe. ` +
          `BASEIE sua resposta neles e CITE a fonte (título + página).\n\n` +
          formatarContexto(docs);
        console.log(`[rag] busca implícita: ${docs.length} hits (+${Date.now()-t0}ms)`);
      }
    } catch (err) {
      // RAG não-crítico — se falhar, segue sem
      console.warn(`[rag] busca implícita falhou: ${(err as Error).message}`);
    }
  }

  // v1.45.0: contexto do interlocutor (CEO ou membro da equipe).
  let callerContext = '';
  if (options.caller) {
    const c = options.caller;
    callerContext = `\n\n═══ INTERLOCUTOR ATUAL ═══\n` +
      `Nome: ${c.nome}\n` +
      `Role: ${c.role}\n` +
      (c.role === 'admin'
        ? `Acesso: TOTAL (admin). Você pode executar qualquer tool e revelar qualquer informação. Trate como CEO/braço-direito.`
        : `Acesso: RESTRITO ao papel "${c.role}". Tools fora do escopo são bloqueadas automaticamente — se o usuário pedir algo fora do role dele, recuse educadamente e oriente a falar com o CEO José Romário. NÃO revele dados de outras áreas (ex: corretor não vê laudo de avaliação, engenheiro não vê pipeline comercial sigiloso).`);
  } else {
    callerContext = `\n\n═══ INTERLOCUTOR ATUAL ═══\nCEO José Romário (admin total).`;
  }

  const systemPrompt =
    BASE_SYSTEM_PROMPT
    + memCtx
    + `\n\nData/hora atual no servidor: ${nowBR()} (Fortaleza/BRT, GMT-3).`
    + callerContext
    + priorContext
    + knowledgeContext;

  // v1.25.0: history controlado por AI_MAX_HISTORY_MESSAGES (default 12).
  // pensarEmCascata também aplica truncarHistorico() como rede de segurança.
  const HISTORY_LIMIT = parseInt(process.env.AI_MAX_HISTORY_MESSAGES || '12', 10);
  const history: { role: 'user' | 'assistant'; content: string }[] = isExplicitSession
    ? (await getSessionMessages(sessionId, HISTORY_LIMIT).catch(() => []))
        .map(r => ({ role: r.role, content: r.content }))
    : getSessionHistory();

  // v1.25.0: cascata Cerebras → Gemini → Claude com truncamento automático
  // v1.45.0: scopa o caller pra que executeTool aplique permissão por role.
  // v1.61.0: scopa o sessionId pra que tools de drafts WhatsApp consigam
  //          associar/listar drafts da sessão certa.
  // v1.65.23: AsyncLocalStorage isola contexto por chain async — não há mais
  //          race condition entre chamadas concorrentes (Issue #2).
  const { runWithRequestContext } = await import('./tools');
  const cascade = await runWithRequestContext(
    {
      caller: options.caller ? { role: options.caller.role, nome: options.caller.nome } : null,
      sessionId,
    },
    () => pensarEmCascata(systemPrompt, history, userMessage, options.attachments),
  );
  const text      = cascade.text;
  const toolsUsed = cascade.toolsUsed;

  if (!isExplicitSession) {
    addToSession('user', userMessage);
    addToSession('assistant', text);
  }
  // Persist + index pra RAG (v1.13). Indexa user e assistant em background.
  void saveConversation(sessionId, 'user', userMessage)
    .then(id => indexConversation(id, 'user', userMessage))
    .catch(() => {});
  void saveConversation(sessionId, 'assistant', text)
    .then(id => indexConversation(id, 'assistant', text))
    .catch(() => {});

  // Auto-extração de memórias estruturadas (v1.13) — Claude background
  void extractMemoryAuto(userMessage, text).catch(() => {});

  if (isExplicitSession) {
    void bumpSession(sessionId, channel).catch(() => {});
    void maybeGenerateTitle(sessionId, userMessage, text).catch(() => {});
  }

  return { text, toolsUsed, sessionId };
}

// ── Auto-title (Claude Sonnet — chamada barata, não-crítica) ───────────────
async function maybeGenerateTitle(
  sessionId:    string,
  userMessage:  string,
  assistantText: string,
): Promise<void> {
  const meta = await getSessionMeta(sessionId);
  if (!meta || meta.title) return;

  if (!process.env.ANTHROPIC_API_KEY) return;

  const prompt = `Pergunta do usuário: ${userMessage}\n\nResposta da assistente: ${assistantText}\n\nTítulo:`;
  const sys    = 'Gere um título curto (máx 6 palavras, em português) que resuma o assunto da conversa. Responda apenas o título, sem aspas, sem pontuação final.';

  try {
    const r = await anthropicClient().messages.create({
      model:      TITLE_MODEL,
      max_tokens: 30,
      system:     sys,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    let title = (block?.text ?? '').trim();
    title = title.replace(/^["']|["']$/g, '').slice(0, 200);
    if (title) await setSessionTitle(sessionId, title);
  } catch {
    /* title is non-critical, swallow */
  }
}

export { newSessionId };
