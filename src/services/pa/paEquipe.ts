// v3.169.0 — Equipe do PA (modelo do Recrutamento do CRM): o ADMIN cadastra a pessoa
// (nome, CPF, WhatsApp, perfil e permissões), o sistema cria o login da ZAYRA com senha
// provisória e manda pelo WhatsApp. Perfil CAMPO = funcionário de campo: entra só no
// PA (Campo, Mapa e os arquivos da coletora), sem PDF/imprimir/enviar, sem financeiro.
// O bloqueio é no servidor (apiAuthGate + rotas do PA), não só na tela.
import bcrypt from 'bcrypt';
import { PaErro } from './erros';
import { pool, rows, one, exec, isoDateTime, registrarEvento } from './paDb';
import { cpfValido, soDigitos } from './validadores';
import { gerarSenhaTemporaria } from '../admin-acessos-helpers';
import { baseUrlPublica } from './paBoletoPdf';
import type { PerfilPa } from './lgpd';

export interface PermissoesCampo { ver_mapa: boolean; baixar_coletora: boolean; marcar_campo: boolean }
export const PERMISSOES_PADRAO: PermissoesCampo = { ver_mapa: true, baixar_coletora: true, marcar_campo: true };
export const PERFIS_EQUIPE: Record<string, string> = {
  CAMPO: 'Funcionário de campo',
  DIRECAO_ASSOCIACAO: 'Direção da associação (só leitura)',
  OPERADOR: 'Operador do escritório',
};
const TENANT = 1;
const dominioCpf = (cpf: string) => `${cpf}@campo.romatec.local`;

export interface AcessoPa { perfil: PerfilPa | null; permissoes: PermissoesCampo; nome: string | null }

// cache curto: o gate do /api consulta a cada requisição
const cache = new Map<string, { v: AcessoPa; ate: number }>();
export const limparCacheAcesso = (sub?: string) => { if (sub) cache.delete(sub); else cache.clear(); };

export function lerPermissoes(v: unknown): PermissoesCampo {
  let o: Record<string, unknown> = {};
  try { o = (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown> ?? {}; } catch { o = {}; }
  return { ver_mapa: o.ver_mapa !== false, baixar_coletora: o.baixar_coletora !== false, marcar_campo: o.marcar_campo !== false };
}

export async function acessoPa(sub: string | null): Promise<AcessoPa> {
  const vazio: AcessoPa = { perfil: null, permissoes: PERMISSOES_PADRAO, nome: null };
  if (!sub) return vazio;
  const c = cache.get(sub);
  if (c && c.ate > Date.now()) return c.v;
  let v = vazio;
  try {
    const r = await one(pool, 'SELECT p.perfil, p.permissoes, u.name FROM pa_usuarios_perfil p LEFT JOIN users u ON u.id = p.user_sub WHERE p.user_sub = ?', [sub]);
    if (r) v = { perfil: r.perfil as PerfilPa, permissoes: lerPermissoes(r.permissoes), nome: (r.name as string) ?? null };
  } catch { /* tabela/coluna ainda não migrada → sem override */ }
  cache.set(sub, { v, ate: Date.now() + 30_000 });
  return v;
}

/**
 * Funcionário de campo só usa o módulo PA e o login. Caminho relativo ao /api.
 * (pura — testável)
 */
export function apiPermitidaCampo(caminho: string): boolean {
  return /^\/(pa|auth)(\/|$)/.test(caminho);
}

/** Rotas do PA liberadas para o perfil CAMPO (método + caminho relativo a /api/pa). Pura — testável. */
export function rotaPaPermitidaCampo(metodo: string, caminho: string, p: PermissoesCampo): boolean {
  const c = caminho.split('?')[0];
  const m = metodo.toUpperCase();
  if (m === 'GET' && /^\/(eu|projetos)$/.test(c)) return true;
  if (/^\/projetos\/\d+\/campo(\/|$)/.test(c)) return m === 'GET' || p.marcar_campo;
  if (m !== 'GET') return false;
  if (p.baixar_coletora && /^\/projetos\/\d+\/(coletora\.(csv|txt|dxf)|caderneta-campo\.pdf)$/.test(c)) return true;
  // mapa só para visualizar: dados JSON/GeoJSON/SVG, nunca PDF nem download de DXF
  if (p.ver_mapa && /^\/projetos\/\d+\/(subdivisao(\.geojson|\.svg)?|subdivisao\/lotes\/[\w-]+(\.svg)?|perimetro|vila-perimetro|divisa|lotes|desenho|memorial-vila|mapa-vila\.svg|marcas)$/.test(c)) return true;
  return false;
}

const telefoneE164 = (t: string) => { const d = soDigitos(t); return d.length === 10 || d.length === 11 ? `55${d}` : d; };

export async function listarEquipe() {
  const r = await rows(pool, `SELECT p.user_sub, p.perfil, p.permissoes, p.criado_em, u.name, u.email, u.phone, u.deleted_at, u.last_login_at
    FROM pa_usuarios_perfil p JOIN users u ON u.id = p.user_sub ORDER BY u.deleted_at IS NOT NULL, u.name`);
  return r.map((x) => {
    const email = String(x.email ?? '');
    const cpf = email.endsWith('@campo.romatec.local') ? email.split('@')[0] : null;
    return {
      user_id: Number(x.user_sub), nome: String(x.name ?? ''), cpf, login: cpf ?? email, telefone: (x.phone as string) ?? null,
      perfil: String(x.perfil), perfil_rotulo: PERFIS_EQUIPE[String(x.perfil)] ?? String(x.perfil), permissoes: lerPermissoes(x.permissoes),
      ativo: x.deleted_at == null, criado_em: isoDateTime(x.criado_em), ultimo_acesso: isoDateTime(x.last_login_at),
    };
  });
}

function mensagemAcesso(nome: string, login: string, senha: string, perfil: string): string {
  const primeiro = nome.split(/\s+/)[0];
  return [
    `🔐 *Acesso ZAYRA — Romatec · Gestão de PA*`,
    ``,
    `Olá, ${primeiro.charAt(0) + primeiro.slice(1).toLowerCase()}! Seu acesso foi liberado (${PERFIS_EQUIPE[perfil] ?? perfil}).`,
    ``,
    `🌐 Link: ${baseUrlPublica()}/login?next=/pa.html`,
    `👤 Login: ${login}`,
    `🔑 Senha provisória: ${senha}`,
    ``,
    `Guarde esta mensagem. Qualquer dúvida, fale com o José Romário.`,
  ].join('\n');
}

async function enviarAcesso(telefone: string | null, nome: string, login: string, senha: string, perfil: string): Promise<{ enviado: boolean; mensagem: string; erro: string | null }> {
  const mensagem = mensagemAcesso(nome, login, senha, perfil);
  if (!telefone) return { enviado: false, mensagem, erro: 'sem WhatsApp' };
  try {
    const wa = await import('./paWhatsapp');
    await wa.enviarWhatsAppNumero(telefoneE164(telefone), mensagem);
    return { enviado: true, mensagem, erro: null };
  } catch (e) { return { enviado: false, mensagem, erro: (e as Error).message.slice(0, 200) }; }
}

export async function cadastrarMembro(b: { nome?: unknown; cpf?: unknown; telefone?: unknown; perfil?: unknown; permissoes?: unknown; enviar?: unknown }, autor: string | null) {
  const nome = String(b.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const cpf = soDigitos(b.cpf);
  const telefone = soDigitos(b.telefone);
  const perfil = String(b.perfil ?? 'CAMPO');
  if (nome.length < 3) throw new PaErro('CAMPO_INVALIDO', 'Informe o nome', 400);
  if (!cpfValido(cpf)) throw new PaErro('CPF_INVALIDO', 'CPF inválido', 400);
  if (telefone && telefone.length < 10) throw new PaErro('CAMPO_INVALIDO', 'WhatsApp inválido', 400);
  if (!PERFIS_EQUIPE[perfil]) throw new PaErro('CAMPO_INVALIDO', 'Perfil inválido', 400);
  const login = dominioCpf(cpf);
  const ja = await one(pool, 'SELECT id FROM users WHERE email = ? LIMIT 1', [login]);
  if (ja) throw new PaErro('JA_CADASTRADO', 'Esse CPF já tem acesso — use "Reenviar acesso"', 409);
  const senha = gerarSenhaTemporaria(8);
  const hash = await bcrypt.hash(senha, 12);
  const ins = await exec(pool, `INSERT INTO users (openId, email, name, phone, loginMethod, role, password_hash) VALUES (?, ?, ?, ?, 'password', 'user', ?)`,
    [`pa-${cpf}-${Date.now()}`, login, nome, telefone || null, hash]);
  const uid = ins.insertId;
  await exec(pool, `INSERT INTO tenant_users (tenant_id, user_id, role, equipe_id) VALUES (?, ?, 'viewer', NULL)`, [TENANT, uid]);
  await exec(pool, 'INSERT INTO pa_usuarios_perfil (user_sub, perfil, permissoes, criado_por) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE perfil = VALUES(perfil), permissoes = VALUES(permissoes)',
    [String(uid), perfil, JSON.stringify(lerPermissoes(b.permissoes)), autor]);
  limparCacheAcesso(String(uid));
  await registrarEvento(pool, { projeto_id: null, usuario: autor, tipo: 'EQUIPE_CADASTRO', dados: { user_id: uid, perfil, cpf_final: cpf.slice(-2) } });
  const env = b.enviar === false ? { enviado: false, mensagem: mensagemAcesso(nome, cpf, senha, perfil), erro: null } : await enviarAcesso(telefone || null, nome, cpf, senha, perfil);
  // senha só volta na resposta se não saiu pelo WhatsApp (para o ADMIN repassar)
  return { user_id: uid, login: cpf, enviado: env.enviado, erro_envio: env.erro, senha: env.enviado ? null : senha, mensagem: env.enviado ? null : env.mensagem };
}

export async function reenviarAcesso(uid: number, autor: string | null) {
  const u = await one(pool, 'SELECT u.id, u.name, u.email, u.phone, p.perfil FROM users u JOIN pa_usuarios_perfil p ON p.user_sub = u.id WHERE u.id = ?', [uid]);
  if (!u) throw new PaErro('NAO_ENCONTRADO', 'Pessoa não encontrada na equipe do PA', 404);
  const senha = gerarSenhaTemporaria(8);
  await exec(pool, 'UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, deleted_at = NULL WHERE id = ?', [await bcrypt.hash(senha, 12), uid]);
  const email = String(u.email);
  const login = email.endsWith('@campo.romatec.local') ? email.split('@')[0] : email;
  const env = await enviarAcesso((u.phone as string) ?? null, String(u.name), login, senha, String(u.perfil));
  await registrarEvento(pool, { projeto_id: null, usuario: autor, tipo: 'EQUIPE_NOVA_SENHA', dados: { user_id: uid, enviado: env.enviado } });
  limparCacheAcesso(String(uid));
  return { user_id: uid, enviado: env.enviado, erro_envio: env.erro, senha: env.enviado ? null : senha, mensagem: env.enviado ? null : env.mensagem };
}

export async function ativarMembro(uid: number, ativo: boolean, autor: string | null) {
  const u = await one(pool, 'SELECT user_sub FROM pa_usuarios_perfil WHERE user_sub = ?', [String(uid)]);
  if (!u) throw new PaErro('NAO_ENCONTRADO', 'Pessoa não encontrada na equipe do PA', 404);
  await exec(pool, `UPDATE users SET deleted_at = ${ativo ? 'NULL' : 'NOW()'} WHERE id = ?`, [uid]);
  limparCacheAcesso(String(uid));
  await registrarEvento(pool, { projeto_id: null, usuario: autor, tipo: ativo ? 'EQUIPE_REATIVADO' : 'EQUIPE_DESATIVADO', dados: { user_id: uid } });
  return { user_id: uid, ativo };
}

export async function atualizarMembro(uid: number, b: { perfil?: unknown; permissoes?: unknown }, autor: string | null) {
  const perfil = b.perfil != null ? String(b.perfil) : null;
  if (perfil && !PERFIS_EQUIPE[perfil]) throw new PaErro('CAMPO_INVALIDO', 'Perfil inválido', 400);
  const r = await exec(pool, `UPDATE pa_usuarios_perfil SET ${perfil ? 'perfil = ?, ' : ''}permissoes = ? WHERE user_sub = ?`,
    [...(perfil ? [perfil] : []), JSON.stringify(lerPermissoes(b.permissoes)), String(uid)]);
  if (!r.affectedRows) throw new PaErro('NAO_ENCONTRADO', 'Pessoa não encontrada na equipe do PA', 404);
  limparCacheAcesso(String(uid));
  await registrarEvento(pool, { projeto_id: null, usuario: autor, tipo: 'EQUIPE_PERMISSOES', dados: { user_id: uid, perfil, permissoes: lerPermissoes(b.permissoes) } });
  return { user_id: uid };
}
