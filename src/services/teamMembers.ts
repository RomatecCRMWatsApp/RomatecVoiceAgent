// v1.45.0 — Multi-tenant equipe Romatec.
// Serve de "agenda viva" da equipe (Eldemberto, Rosielma, etc) para a ZAYRA.
// Combina com TELEGRAM_AUTHORIZED_USER_IDS (env var) — DB tem precedência,
// env var continua como backdoor de segurança caso o DB esteja off.
//
// Roles:
//   admin       → pode tudo (só CEO + braço-direito)
//   engenheiro  → avaliações, vistorias, NBR 14653, PTAM
//   corretor    → CRM (leads, contatos, campanhas), agenda
//   comercial   → contratos, financeiro, propostas
//   leitura     → só consulta (default seguro)

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { sendMessage as sendTelegram } from '../integrations/telegram';

export type TeamRole = 'admin' | 'engenheiro' | 'corretor' | 'comercial' | 'leitura';

export interface TeamMember {
  id:                 number;
  nome:               string;
  telegram_chat_id:   string | null;
  whatsapp_phone:     string | null;
  email:              string | null;
  role:               TeamRole;
  cargo:              string | null;
  ativo:              boolean;
  observacoes:        string | null;
  criado_em?:         Date;
  atualizado_em?:     Date;
}

interface TeamMemberRow extends RowDataPacket {
  id:                number;
  nome:              string;
  telegram_chat_id:  string | null;
  whatsapp_phone:    string | null;
  email:             string | null;
  role:              TeamRole;
  cargo:             string | null;
  ativo:             number;
  observacoes:       string | null;
  criado_em:         Date;
  atualizado_em:     Date;
}

function rowToMember(r: TeamMemberRow): TeamMember {
  return {
    id:                r.id,
    nome:              r.nome,
    telegram_chat_id:  r.telegram_chat_id,
    whatsapp_phone:    r.whatsapp_phone,
    email:             r.email,
    role:              r.role,
    cargo:             r.cargo,
    ativo:             r.ativo === 1,
    observacoes:       r.observacoes,
    criado_em:         r.criado_em,
    atualizado_em:     r.atualizado_em,
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────
export async function adicionarMembro(input: {
  nome:              string;
  telegram_chat_id?: string;
  whatsapp_phone?:   string;
  email?:            string;
  role?:             TeamRole;
  cargo?:            string;
  observacoes?:      string;
}): Promise<TeamMember> {
  if (!input.nome?.trim()) throw new Error('Nome é obrigatório.');
  const role: TeamRole = input.role ?? 'leitura';

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_team_members
       (nome, telegram_chat_id, whatsapp_phone, email, role, cargo, observacoes)
     VALUES (?,?,?,?,?,?,?)`,
    [
      input.nome.trim(),
      input.telegram_chat_id?.trim() || null,
      input.whatsapp_phone?.trim()   || null,
      input.email?.trim()            || null,
      role,
      input.cargo?.trim()            || null,
      input.observacoes?.trim()      || null,
    ],
  );
  const id = r.insertId;
  const [rows] = await pool.execute<TeamMemberRow[]>(
    'SELECT * FROM romatec_team_members WHERE id = ?', [id],
  );
  if (!rows.length) throw new Error('Falha ao recuperar membro recém-criado.');
  return rowToMember(rows[0]);
}

export async function listarMembros(opts?: { ativos_apenas?: boolean; role?: TeamRole }): Promise<TeamMember[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.ativos_apenas !== false) { where.push('ativo = 1'); }
  if (opts?.role) { where.push('role = ?'); params.push(opts.role); }
  const sql = `SELECT * FROM romatec_team_members ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY role, nome`;
  const [rows] = await pool.execute<TeamMemberRow[]>(sql, params);
  return rows.map(rowToMember);
}

export async function buscarMembroPorNome(nome: string): Promise<TeamMember | null> {
  const [rows] = await pool.execute<TeamMemberRow[]>(
    'SELECT * FROM romatec_team_members WHERE nome LIKE ? AND ativo = 1 LIMIT 1',
    [`%${nome.trim()}%`],
  );
  return rows.length ? rowToMember(rows[0]) : null;
}

export async function buscarMembroPorTelegram(chatId: string | number): Promise<TeamMember | null> {
  const [rows] = await pool.execute<TeamMemberRow[]>(
    'SELECT * FROM romatec_team_members WHERE telegram_chat_id = ? AND ativo = 1 LIMIT 1',
    [String(chatId)],
  );
  return rows.length ? rowToMember(rows[0]) : null;
}

export async function atualizarMembro(id: number, patch: {
  nome?:             string;
  telegram_chat_id?: string | null;
  whatsapp_phone?:   string | null;
  email?:            string | null;
  role?:             TeamRole;
  cargo?:            string | null;
  ativo?:            boolean;
  observacoes?:      string | null;
}): Promise<TeamMember> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const k of ['nome','telegram_chat_id','whatsapp_phone','email','role','cargo','observacoes'] as const) {
    if (patch[k] !== undefined) { sets.push(`${k} = ?`); params.push(patch[k] ?? null); }
  }
  if (patch.ativo !== undefined) { sets.push('ativo = ?'); params.push(patch.ativo ? 1 : 0); }
  if (!sets.length) throw new Error('Nenhum campo para atualizar.');
  params.push(id);
  await pool.execute(`UPDATE romatec_team_members SET ${sets.join(', ')} WHERE id = ?`, params);
  const [rows] = await pool.execute<TeamMemberRow[]>(
    'SELECT * FROM romatec_team_members WHERE id = ?', [id],
  );
  if (!rows.length) throw new Error(`Membro ${id} não encontrado.`);
  return rowToMember(rows[0]);
}

export async function alterarRole(id: number, role: TeamRole): Promise<TeamMember> {
  return atualizarMembro(id, { role });
}

export async function removerMembro(id: number): Promise<{ id: number; removido: boolean }> {
  // Soft-delete: ativo=0 (preserva histórico de delegações).
  const [r] = await pool.execute<ResultSetHeader>(
    'UPDATE romatec_team_members SET ativo = 0 WHERE id = ?', [id],
  );
  return { id, removido: r.affectedRows > 0 };
}

// ── Autorização ─────────────────────────────────────────────────────────────
// Combina env var (CEO/legacy) + DB (equipe). DB-first: se o chat_id está no
// DB e está ativo → autoriza com role; senão fallback no env var (admin).
export async function isAuthorizedByDb(chatId: string | number): Promise<{
  authorized: boolean;
  member?:    TeamMember;
}> {
  try {
    const m = await buscarMembroPorTelegram(chatId);
    if (m) return { authorized: true, member: m };
  } catch (err) {
    // DB indisponível — não bloqueia, deixa o env var decidir
    console.warn('[teamMembers] DB lookup falhou:', (err as Error).message);
  }
  return { authorized: false };
}

// ── Permissões por role ─────────────────────────────────────────────────────
// Lista de prefixos de tools que cada role pode executar.
// admin = wildcard '*' (tudo). Os outros são restritivos.
const ROLE_PERMISSIONS: Record<TeamRole, string[]> = {
  admin:      ['*'],
  engenheiro: [
    'consultar_norma_imobiliaria', 'gerar_rascunho_ptam', 'validar_laudo_avaliacao',
    'sugerir_metodologia_avaliacao', 'analisar_comparativos',
    'extrair_documento_imovel', 'analisar_visual_imovel',
    'listar_vistorias', 'buscar_vistoria', 'criar_vistoria',
    'gerar_avaliacao', 'cep_buscar', 'consultar_cep', 'sigef_consulta_url', 'sicar_consulta_url',
    'norma_buscar', 'pesquisar_web', 'memoria_buscar', 'memoria_listar',
    'listar_obras', 'buscar_obra', 'listar_etapas_obra',
    'salvar_memoria', 'buscar_memoria', 'listar_memorias',
  ],
  corretor: [
    'listar_leads', 'buscar_lead', 'listar_campanhas', 'status_campanha',
    'crm_criar_lead', 'crm_atualizar_lead',
    'crm_criar_contato', 'crm_atualizar_contato',
    'buscar_cliente', 'buscar_contato_memoria',
    'criar_evento', 'listar_eventos_hoje', 'listar_eventos_semana', 'cancelar_evento',
    'enviar_whatsapp', 'enviar_audio_whatsapp', 'enviar_imagem_whatsapp',
    'consultar_cep', 'cep_buscar', 'consultar_cnpj',
    'salvar_memoria', 'buscar_memoria',
  ],
  comercial: [
    'listar_contratos', 'gerar_contrato', 'listar_contratos_gerados',
    'memoria_contratos_listar', 'consultar_norma_imobiliaria',
    'listar_obras', 'buscar_obra', 'listar_transacoes_obra',
    'simular_financiamento', 'calcular_correcao_monetaria', 'calcular_vpl',
    'converter_taxa', 'calcular_parcelamento',
    'consultar_cnpj', 'consultar_taxas', 'fipe_marcas', 'fipe_preco',
    'salvar_memoria', 'buscar_memoria',
  ],
  leitura: [
    'listar_leads', 'listar_obras', 'buscar_obra', 'listar_eventos_hoje',
    'listar_eventos_semana', 'resumo_obras', 'resumo_dia',
    'buscar_memoria', 'memoria_buscar', 'pesquisar_web', 'consultar_cep',
  ],
};

export function temPermissao(role: TeamRole, toolName: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes('*')) return true;
  return perms.includes(toolName);
}

export function permissoesDoRole(role: TeamRole): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

// ── Delegação ───────────────────────────────────────────────────────────────
// CEO fala "Eldemberto, faz X" → ZAYRA dispara mensagem no Telegram dele.
export async function delegarTarefaParaMembro(input: {
  membro_nome: string;
  tarefa:      string;
  prazo?:      string;
  remetente?:  string; // default: CEO José Romário
}): Promise<{ enviado: boolean; via: 'telegram' | 'whatsapp' | 'nenhum'; membro: TeamMember; preview: string }> {
  const m = await buscarMembroPorNome(input.membro_nome);
  if (!m) throw new Error(`Membro "${input.membro_nome}" não encontrado na equipe Romatec.`);

  const remetente = input.remetente?.trim() || 'CEO José Romário';
  const linhaPrazo = input.prazo ? `\n*Prazo:* ${input.prazo}` : '';
  const preview =
    `📋 *Tarefa delegada por ${remetente}*\n\n` +
    `${input.tarefa}${linhaPrazo}\n\n` +
    `_— ZAYRA, assistente executiva da Romatec_`;

  // Telegram tem prioridade (canal interno, sem custo de chip)
  if (m.telegram_chat_id) {
    try {
      await sendTelegram(m.telegram_chat_id, preview);
      return { enviado: true, via: 'telegram', membro: m, preview };
    } catch (err) {
      console.warn('[delegarTarefa] Telegram falhou:', (err as Error).message);
    }
  }

  // Fallback WhatsApp (se tiver número cadastrado)
  if (m.whatsapp_phone) {
    try {
      const { sendReply } = await import('../integrations/whatsapp');
      await sendReply(m.whatsapp_phone, preview);
      return { enviado: true, via: 'whatsapp', membro: m, preview };
    } catch (err) {
      console.warn('[delegarTarefa] WhatsApp falhou:', (err as Error).message);
    }
  }

  return { enviado: false, via: 'nenhum', membro: m, preview };
}
