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

// v3.180.0: permissões por função (aba/ação), escolhidas pelo ADMIN para cada pessoa da equipe.
// O perfil só define o padrão; o que vale é o que estiver marcado. Bloqueio no servidor (rotaPaPermitida).
export const CATALOGO_PERMISSOES = [
  { id: 'ver_painel', grupo: '📊 Painel', rotulo: 'Ver o painel (resumo do PA)' },
  { id: 'ver_mapa', grupo: '🗺️ Mapa', rotulo: 'Ver os mapas' },
  { id: 'baixar_mapas', grupo: '🗺️ Mapa', rotulo: 'Baixar PDF/DXF de mapas e memoriais (SIGEF/tradicional)' },
  { id: 'editar_mapas', grupo: '🗺️ Mapa', rotulo: 'Carregar/alterar perímetro, subdivisão, divisa e vínculo lote→associado' },
  { id: 'ver_associados', grupo: '👥 Associados', rotulo: 'Ver associados e documentos' },
  { id: 'editar_associados', grupo: '👥 Associados', rotulo: 'Cadastrar/editar associados, participantes e documentos' },
  { id: 'ver_financeiro', grupo: '💰 Financeiro', rotulo: 'Ver financeiro (pagamentos, extrato, cobrança, caixa, marcos)' },
  { id: 'operar_financeiro', grupo: '💰 Financeiro', rotulo: 'Lançar pagamentos, emitir/enviar boletos e cobranças' },
  { id: 'carteirinhas', grupo: '🪪 Carteirinhas', rotulo: 'Gerar carteirinhas' },
  { id: 'documentos_oficiais', grupo: '📜 Documentos', rotulo: 'Documentos oficiais (atas, termos de concessão, relação de lotes)' },
  { id: 'marcar_campo', grupo: '📡 Campo', rotulo: 'Marcar marcos locados no mapa' },
  { id: 'programar_campo', grupo: '📡 Campo', rotulo: 'Programação do dia e boletins para o grupo' },
  { id: 'baixar_coletora', grupo: '📡 Campo', rotulo: 'Baixar arquivos da coletora e caderneta de campo' },
  { id: 'dossies', grupo: '📦 Dossiês', rotulo: 'Dossiês (gerar, enviar, TRT e entrega)' },
  { id: 'whatsapp', grupo: '📲 WhatsApp', rotulo: 'Grupo e envios de WhatsApp' },
] as const;
export type ChavePermissao = (typeof CATALOGO_PERMISSOES)[number]['id'];
export type Permissoes = Record<ChavePermissao, boolean>;
/** compatibilidade: o nome antigo do tipo */
export type PermissoesCampo = Permissoes;
const CHAVES = CATALOGO_PERMISSOES.map((x) => x.id) as ChavePermissao[];
const todas = (v: boolean): Permissoes => Object.fromEntries(CHAVES.map((k) => [k, v])) as Permissoes;
const so = (...ks: ChavePermissao[]): Permissoes => ({ ...todas(false), ...Object.fromEntries(ks.map((k) => [k, true])) });
export const PADRAO_POR_PERFIL: Record<string, Permissoes> = {
  ADMIN: todas(true),
  OPERADOR: todas(true),
  AGRIMENSOR: so('ver_painel', 'ver_mapa', 'baixar_mapas', 'editar_mapas', 'ver_associados', 'documentos_oficiais', 'marcar_campo', 'programar_campo', 'baixar_coletora', 'dossies'),
  CAMPO: so('ver_mapa', 'marcar_campo', 'baixar_coletora'),
  DIRECAO_ASSOCIACAO: so('ver_painel', 'ver_mapa', 'baixar_mapas', 'ver_associados', 'ver_financeiro', 'carteirinhas', 'documentos_oficiais'),
};
/** Padrão do funcionário de campo (mantido com o nome antigo). */
export const PERMISSOES_PADRAO: Permissoes = PADRAO_POR_PERFIL.CAMPO;
export const PERFIS_EQUIPE: Record<string, string> = {
  CAMPO: 'Topógrafo de campo',
  AGRIMENSOR: 'Agrimensor',
  OPERADOR: 'Operador do escritório',
  DIRECAO_ASSOCIACAO: 'Direção da associação (só leitura)',
};
const TENANT = 1;
const dominioCpf = (cpf: string) => `${cpf}@campo.romatec.local`;

export interface AcessoPa { perfil: PerfilPa | null; permissoes: PermissoesCampo; nome: string | null }

// cache curto: o gate do /api consulta a cada requisição
const cache = new Map<string, { v: AcessoPa; ate: number }>();
export const limparCacheAcesso = (sub?: string) => { if (sub) cache.delete(sub); else cache.clear(); };

/** Permissões gravadas por cima do padrão do perfil (chave ausente = padrão do perfil). */
export function lerPermissoes(v: unknown, perfil: string = 'CAMPO'): Permissoes {
  let o: Record<string, unknown> = {};
  try { o = (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown> ?? {}; } catch { o = {}; }
  const base = PADRAO_POR_PERFIL[perfil] ?? PADRAO_POR_PERFIL.CAMPO;
  return Object.fromEntries(CHAVES.map((k) => [k, typeof o[k] === 'boolean' ? o[k] as boolean : base[k]])) as Permissoes;
}

export async function acessoPa(sub: string | null): Promise<AcessoPa> {
  const vazio: AcessoPa = { perfil: null, permissoes: PERMISSOES_PADRAO, nome: null };
  if (!sub) return vazio;
  const c = cache.get(sub);
  if (c && c.ate > Date.now()) return c.v;
  let v = vazio;
  try {
    const r = await one(pool, 'SELECT p.perfil, p.permissoes, u.name FROM pa_usuarios_perfil p LEFT JOIN users u ON u.id = p.user_sub WHERE p.user_sub = ?', [sub]);
    if (r) v = { perfil: r.perfil as PerfilPa, permissoes: lerPermissoes(r.permissoes, String(r.perfil)), nome: (r.name as string) ?? null };
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

type Regra = [metodos: 'GET' | 'ESCRITA' | '*', re: RegExp, chave: ChavePermissao | '*'];
const P = '^\\/projetos\\/\\d+';
const R = (m: Regra[0], re: string, k: Regra[2]): Regra => [m, new RegExp(re + '$'), k];
/** Rota → permissão exigida (caminho relativo a /api/pa). '*' = liberada para todos da equipe. */
const REGRAS: Regra[] = [
  R('GET', '^\\/(eu|projetos)', '*'), R('GET', P, '*'), R('GET', P + '\\/campo', '*'), R('GET', P + '\\/campo\\/programacao', '*'),
  R('GET', P + '\\/painel', 'ver_painel'), R('GET', P + '\\/mapa-publico', 'ver_mapa'), R('*', P + '\\/mapa-publico\\/(envio|enviar)', 'whatsapp'), R('GET', P + '\\/pesquisa', 'ver_painel'), R('*', P + '\\/pesquisa\\/(link\\/\\d+|enviar)', 'whatsapp'),
  R('GET', P + '\\/(subdivisao\\.(pdf|dxf)|mapa-geral\\.pdf|mapa-vila\\.pdf|vila-perimetro\\.pdf|divisa\\.dxf)', 'baixar_mapas'),
  R('GET', P + '\\/(subdivisao(\\.geojson|\\.svg)?|subdivisao\\/lotes\\/[\\w-]+(\\.svg)?|perimetro|vila-perimetro|divisa|lotes|lotes\\/[\\w-]+|desenho|memorial-vila|mapa-vila\\.svg|marcas)', 'ver_mapa'),
  R('ESCRITA', P + '\\/(perimetro|vila-perimetro|subdivisao|subdivisao\\/limpar|subdivisao\\/vinculo|divisa|lotes\\/[\\w-]+)', 'editar_mapas'),
  R('GET', P + '\\/(associados|associados\\/\\d+|documentos)', 'ver_associados'),
  R('GET', '^\\/(associados\\/\\d+\\/(foto|participantes)|documentos\\/\\d+)', 'ver_associados'),
  R('ESCRITA', P + '\\/associados(\\/\\d+)?', 'editar_associados'),
  R('ESCRITA', '^\\/(associados\\/\\d+\\/(documentos|participantes)|participantes\\/\\d+)', 'editar_associados'),
  R('GET', P + '\\/(pagamentos|extrato|extrato\\.pdf|cobranca|caixa|boletos|boletos\\/elegiveis|pix|marcos)', 'ver_financeiro'),
  R('GET', '^\\/(associados\\/\\d+\\/boletos|boletos\\/\\d+\\/pdf|caixa\\/categorias|asaas\\/status)', 'ver_financeiro'),
  R('ESCRITA', P + '\\/(pagamentos(\\/.*)?|extrato\\/whatsapp|caixa|boletos\\/.*|lancamentos\\/.*|marcos\\/.*)', 'operar_financeiro'),
  R('ESCRITA', '^\\/(associados\\/\\d+\\/(plano|whatsapp\\/cobranca)|boletos\\/\\d+(\\/link|\\/ajustar)?|caixa\\/\\d+|lancamentos\\/\\d+\\/boleto)', 'operar_financeiro'),
  R('GET', P + '\\/carteirinhas\\.(html|pdf)', 'carteirinhas'),
  R('*', P + '\\/(ata-assembleia\\.(pdf|docx)|relacao-lotes\\.pdf|concessao\\.pdf|concessao\\/lotes)', 'documentos_oficiais'),
  R('ESCRITA', P + '\\/campo\\/pontos(\\/[^/]+)?', 'marcar_campo'),
  R('*', P + '\\/campo\\/(programacao|programacao\\.pdf|programacao\\/texto|boletim|boletim\\.pdf)', 'programar_campo'),
  R('GET', P + '\\/(coletora\\.[a-z]+|caderneta-campo\\.pdf)', 'baixar_coletora'),
  R('*', P + '\\/dossies(\\/.*)?', 'dossies'),
  R('*', P + '\\/whatsapp\\/.*', 'whatsapp'), R('*', '^\\/whatsapp\\/.*', 'whatsapp'), R('*', '^\\/associados\\/\\d+\\/whatsapp\\/enviar', 'whatsapp'),
];
/** Permissão que a rota exige (null = rota sem regra: equipe, importar, exportar… — só ADMIN). Pura — testável. */
export function permissaoDaRota(metodo: string, caminho: string): ChavePermissao | '*' | null {
  const c = caminho.split('?')[0];
  const m = metodo.toUpperCase() === 'GET' ? 'GET' : 'ESCRITA';
  for (const [mm, re, k] of REGRAS) if ((mm === '*' || mm === m) && re.test(c)) return k;
  return null;
}
export const rotuloPermissao = (k: ChavePermissao) => CATALOGO_PERMISSOES.find((x) => x.id === k)?.rotulo ?? k;
/**
 * A rota é permitida para o perfil com estas permissões? ADMIN: tudo. Rota sem regra: Operador e
 * Direção seguem as travas da própria rota; Topógrafo de campo e Agrimensor não acessam. Pura — testável.
 */
export function rotaPaPermitida(perfil: string, metodo: string, caminho: string, p: Permissoes): boolean {
  if (perfil === 'ADMIN') return true;
  const k = permissaoDaRota(metodo, caminho);
  if (k === '*') return true;
  if (k === null) return perfil !== 'CAMPO' && perfil !== 'AGRIMENSOR';
  return p[k] === true;
}
/** Compatibilidade (v3.169): regra do funcionário de campo. */
export function rotaPaPermitidaCampo(metodo: string, caminho: string, p: Permissoes): boolean {
  return rotaPaPermitida('CAMPO', metodo, caminho, p);
}

const telefoneE164 = (t: string) => { const d = soDigitos(t); return d.length === 10 || d.length === 11 ? `55${d}` : d; };

// ─── v3.180.0: acessos (sessões) da equipe ─────────────────────────────────
// Uma sessão = sequência de uso sem pausa de 30 min. Grava no máximo 1x por minuto por pessoa.
const SESSAO_MS = 30 * 60_000, ONLINE_MIN = 5;
const sessoes = new Map<string, { id: number; ultimo: number; pend: number }>();
/** Resumo do aparelho a partir do user-agent (pura — testável). */
export function dispositivo(ua: string | null | undefined): string {
  const u = String(ua ?? '');
  const so = /iPhone/i.test(u) ? 'iPhone' : /iPad/i.test(u) ? 'iPad' : /Android/i.test(u) ? (/Mobile/i.test(u) ? 'Android (celular)' : 'Android (tablet)') : /Windows/i.test(u) ? 'Windows' : /Mac OS X|Macintosh/i.test(u) ? 'Mac' : /Linux/i.test(u) ? 'Linux' : 'outro';
  const nav = /EdgA?\//.test(u) ? 'Edge' : /SamsungBrowser/i.test(u) ? 'Samsung Internet' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /FxiOS|Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'navegador';
  return `${so} · ${nav}`;
}
export async function registrarAcesso(sub: string, ip: string | null, ua: string | null | undefined): Promise<void> {
  const agora = Date.now();
  let s = sessoes.get(sub);
  if (s && agora - s.ultimo < 60_000) { s.pend++; return; }
  try {
    if (!s) {
      const r = await one(pool, 'SELECT id, fim FROM pa_acessos WHERE user_sub = ? ORDER BY id DESC LIMIT 1', [sub]);
      const fim = r?.fim instanceof Date ? r.fim.getTime() : r?.fim ? Date.parse(String(r.fim).replace(' ', 'T') + 'Z') : NaN;
      if (r && Number.isFinite(fim) && agora - fim < SESSAO_MS) s = { id: Number(r.id), ultimo: fim, pend: 0 };
    }
    if (s && agora - s.ultimo < SESSAO_MS) {
      await exec(pool, 'UPDATE pa_acessos SET fim = NOW(), requisicoes = requisicoes + ? WHERE id = ?', [s.pend + 1, s.id]);
      sessoes.set(sub, { id: s.id, ultimo: agora, pend: 0 });
    } else {
      const ins = await exec(pool, 'INSERT INTO pa_acessos (user_sub, inicio, fim, requisicoes, ip, dispositivo) VALUES (?, NOW(), NOW(), 1, ?, ?)', [sub, ip ? ip.slice(0, 64) : null, dispositivo(ua)]);
      sessoes.set(sub, { id: ins.insertId, ultimo: agora, pend: 0 });
    }
  } catch { /* tabela ainda não migrada: não atrapalha o uso */ }
}

export async function listarEquipe() {
  const r = await rows(pool, `SELECT p.user_sub, p.perfil, p.permissoes, p.criado_em, u.name, u.email, u.phone, u.deleted_at, u.last_login_at
    FROM pa_usuarios_perfil p JOIN users u ON u.id = p.user_sub ORDER BY u.deleted_at IS NOT NULL, u.name`);
  const est = await rows(pool, `SELECT user_sub, COUNT(*) AS total, SUM(inicio >= NOW() - INTERVAL 30 DAY) AS d30, SUM(inicio >= NOW() - INTERVAL 7 DAY) AS d7,
      MAX(fim) AS ultimo, MAX(fim) >= NOW() - INTERVAL ${ONLINE_MIN} MINUTE AS online FROM pa_acessos GROUP BY user_sub`).catch(() => []);
  const porSub = new Map(est.map((x) => [String(x.user_sub), x]));
  return r.map((x) => {
    const email = String(x.email ?? '');
    const cpf = email.endsWith('@campo.romatec.local') ? email.split('@')[0] : null;
    const e = porSub.get(String(x.user_sub));
    return {
      user_id: Number(x.user_sub), nome: String(x.name ?? ''), cpf, login: cpf ?? email, telefone: (x.phone as string) ?? null,
      perfil: String(x.perfil), perfil_rotulo: PERFIS_EQUIPE[String(x.perfil)] ?? String(x.perfil), permissoes: lerPermissoes(x.permissoes, String(x.perfil)),
      ativo: x.deleted_at == null, criado_em: isoDateTime(x.criado_em), ultimo_acesso: isoDateTime(x.last_login_at),
      acessos: { total: Number(e?.total ?? 0), d30: Number(e?.d30 ?? 0), d7: Number(e?.d7 ?? 0), ultima_atividade: e?.ultimo ? isoDateTime(e.ultimo) : null, online: Number(e?.online ?? 0) === 1 },
    };
  });
}

/** Histórico de acesso de uma pessoa (sessões mais recentes primeiro). */
export async function historicoAcessos(uid: number) {
  const r = await rows(pool, 'SELECT inicio, fim, requisicoes, ip, dispositivo FROM pa_acessos WHERE user_sub = ? ORDER BY id DESC LIMIT 60', [String(uid)]).catch(() => []);
  return {
    sessoes: r.map((x) => {
      const ini = x.inicio instanceof Date ? x.inicio.getTime() : Date.parse(String(x.inicio));
      const fim = x.fim instanceof Date ? x.fim.getTime() : Date.parse(String(x.fim));
      return { inicio: isoDateTime(x.inicio), fim: isoDateTime(x.fim), minutos: Math.max(1, Math.round((fim - ini) / 60_000)), requisicoes: Number(x.requisicoes), ip: (x.ip as string) ?? null, dispositivo: (x.dispositivo as string) ?? null };
    }),
  };
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
    `📲 *Instale o app no celular:* abra o link no *Chrome* (Android) ou no *Safari* (iPhone), entre e toque em *Instalar app* — fica o ícone *Romatec PA* na tela inicial. No iPhone: Compartilhar ⬆️ → Adicionar à Tela de Início.`,
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
    [String(uid), perfil, JSON.stringify(lerPermissoes(b.permissoes, perfil)), autor]);
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
  const perfilNovo = b.perfil != null ? String(b.perfil) : null;
  if (perfilNovo && !PERFIS_EQUIPE[perfilNovo]) throw new PaErro('CAMPO_INVALIDO', 'Perfil inválido', 400);
  const atual = await one(pool, 'SELECT perfil FROM pa_usuarios_perfil WHERE user_sub = ?', [String(uid)]);
  if (!atual) throw new PaErro('NAO_ENCONTRADO', 'Pessoa não encontrada na equipe do PA', 404);
  const perfil = perfilNovo ?? String(atual.perfil);
  const permissoes = lerPermissoes(b.permissoes, perfil);
  await exec(pool, 'UPDATE pa_usuarios_perfil SET perfil = ?, permissoes = ? WHERE user_sub = ?', [perfil, JSON.stringify(permissoes), String(uid)]);
  limparCacheAcesso(String(uid));
  await registrarEvento(pool, { projeto_id: null, usuario: autor, tipo: 'EQUIPE_PERMISSOES', dados: { user_id: uid, perfil, permissoes } });
  return { user_id: uid, perfil, permissoes };
}
