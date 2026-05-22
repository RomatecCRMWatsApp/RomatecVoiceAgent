// v3.25.0: Catalogo de permissoes granulares do sistema.
//
// Formato da chave: `<modulo>:<acao>` (ex: 'proposta:criar', 'equipe:excluir')
//
// USO:
//   - Persistido em users.permissions JSON (array de strings)
//   - Quando users.permissions = NULL → usa defaults do role (DEFAULT_PERMISSIONS_BY_ROLE)
//   - Quando users.permissions = [] → user nao tem NENHUMA permissao alem das obrigatorias do role
//   - Quando users.permissions = [...] → exatamente essas permissoes (NAO faz merge com defaults)
//
// ENFORCEMENT (futuro v3.25.x): middleware requirePermission('key') nas rotas relevantes.
// Por ora (v3.25.0) so e' persistido + exibido no front pra UX de configuracao.

export type RoleNome = 'admin' | 'owner' | 'gestor' | 'colaborador';

export interface CategoriaPermissoes {
  modulo: string;
  icone: string;
  label: string;
  itens: { key: string; label: string; descricao?: string }[];
}

export const CATEGORIAS_PERMISSOES: CategoriaPermissoes[] = [
  {
    modulo: 'proposta',
    icone: '📑',
    label: 'Propostas',
    itens: [
      { key: 'proposta:ver',        label: 'Visualizar lista e detalhes' },
      { key: 'proposta:criar',      label: 'Criar nova proposta' },
      { key: 'proposta:editar',     label: 'Editar proposta em rascunho' },
      { key: 'proposta:excluir',    label: 'Excluir proposta',  descricao: 'Soft-delete, reversivel via SQL' },
      { key: 'proposta:assinar',    label: 'Assinar digitalmente (PAdES/ICP-Brasil)' },
      { key: 'proposta:enviar',     label: 'Enviar via WhatsApp/Telegram/Email' },
      { key: 'proposta:anexos',     label: 'Gerenciar anexos (croqui, fotos)' },
      { key: 'proposta:revisar',    label: 'Criar revisao R1->R2 (ja enviada)' },
    ],
  },
  {
    modulo: 'cliente',
    icone: '👤',
    label: 'Clientes',
    itens: [
      { key: 'cliente:ver',     label: 'Visualizar clientes' },
      { key: 'cliente:criar',   label: 'Cadastrar novo cliente' },
      { key: 'cliente:editar',  label: 'Editar dados do cliente' },
      { key: 'cliente:excluir', label: 'Excluir cliente (soft)' },
    ],
  },
  {
    modulo: 'equipe',
    icone: '👥',
    label: 'Equipe (Colaboradores)',
    itens: [
      { key: 'equipe:ver',          label: 'Visualizar equipe' },
      { key: 'equipe:criar',        label: 'Cadastrar novo membro' },
      { key: 'equipe:editar',       label: 'Editar dados do membro' },
      { key: 'equipe:excluir',      label: 'Excluir membro' },
      { key: 'equipe:foto',         label: 'Upload/remover foto' },
      { key: 'equipe:pix',          label: 'Gerenciar chave PIX' },
      { key: 'equipe:acesso',       label: 'Criar/desativar acesso de login' },
    ],
  },
  {
    modulo: 'recibo',
    icone: '🧾',
    label: 'Recibos',
    itens: [
      { key: 'recibo:ver',     label: 'Visualizar recibos' },
      { key: 'recibo:criar',   label: 'Criar rascunho' },
      { key: 'recibo:emitir',  label: 'Emitir (gera numero definitivo)' },
      { key: 'recibo:assinar', label: 'Assinar digitalmente' },
      { key: 'recibo:enviar',  label: 'Enviar via WhatsApp' },
      { key: 'recibo:editar',  label: 'Editar rascunho' },
      { key: 'recibo:cancelar', label: 'Cancelar recibo emitido' },
    ],
  },
  {
    modulo: 'folha',
    icone: '💰',
    label: 'Folha Mensal / Quinzenal',
    itens: [
      { key: 'folha:ver',       label: 'Visualizar folha' },
      { key: 'folha:fechar',    label: 'Fechar quinzena/mes' },
      { key: 'folha:reverter',  label: 'Reverter fechamento' },
      { key: 'folha:exportar',  label: 'Exportar PDF/Excel' },
      { key: 'folha:ajuste',    label: 'Adicionar bonus/desconto/vale' },
    ],
  },
  {
    modulo: 'dias',
    icone: '📅',
    label: 'Marcar Dias Trabalhados',
    itens: [
      { key: 'dias:ver',       label: 'Ver calendario de presenca' },
      { key: 'dias:marcar',    label: 'Marcar dia trabalhado' },
      { key: 'dias:desmarcar', label: 'Desmarcar dia' },
      { key: 'dias:editar_passado', label: 'Editar dias de meses anteriores' },
    ],
  },
  {
    modulo: 'material',
    icone: '🧱',
    label: 'Materiais',
    itens: [
      { key: 'material:ver',      label: 'Visualizar materiais' },
      { key: 'material:registrar', label: 'Registrar entrada/uso' },
      { key: 'material:editar',   label: 'Editar registro' },
      { key: 'material:excluir',  label: 'Excluir registro' },
    ],
  },
  {
    modulo: 'despesa',
    icone: '💸',
    label: 'Despesas Extras',
    itens: [
      { key: 'despesa:ver',      label: 'Visualizar despesas' },
      { key: 'despesa:registrar', label: 'Registrar despesa' },
      { key: 'despesa:editar',   label: 'Editar despesa' },
      { key: 'despesa:excluir',  label: 'Excluir despesa' },
      { key: 'despesa:comprovante', label: 'Anexar/remover comprovante' },
    ],
  },
  {
    modulo: 'financeiro',
    icone: '🏦',
    label: 'Financeiro (Transações)',
    itens: [
      { key: 'financeiro:ver',     label: 'Ver lancamentos' },
      { key: 'financeiro:lancar',  label: 'Lancar nova transacao' },
      { key: 'financeiro:editar',  label: 'Editar transacao' },
      { key: 'financeiro:excluir', label: 'Excluir transacao' },
      { key: 'financeiro:exportar', label: 'Exportar relatorios' },
    ],
  },
  {
    modulo: 'laudo',
    icone: '📐',
    label: 'Laudos de Demarcação',
    itens: [
      { key: 'laudo:ver',       label: 'Visualizar laudos' },
      { key: 'laudo:criar',     label: 'Criar laudo novo' },
      { key: 'laudo:editar',    label: 'Editar laudo' },
      { key: 'laudo:gerar_pdf', label: 'Gerar PDF/KML/DWG' },
      { key: 'laudo:assinar',   label: 'Assinar digitalmente' },
      { key: 'laudo:excluir',   label: 'Excluir laudo' },
    ],
  },
  {
    modulo: 'loteamento',
    icone: '🏘',
    label: 'Loteamentos',
    itens: [
      { key: 'loteamento:ver',    label: 'Visualizar loteamentos' },
      { key: 'loteamento:criar',  label: 'Criar loteamento' },
      { key: 'loteamento:editar', label: 'Editar loteamento' },
      { key: 'loteamento:lotes',  label: 'Gerenciar lotes/quadras' },
    ],
  },
  {
    modulo: 'vistoria',
    icone: '🔎',
    label: 'Vistorias (VTO)',
    itens: [
      { key: 'vistoria:ver',     label: 'Visualizar vistorias' },
      { key: 'vistoria:criar',   label: 'Criar nova vistoria' },
      { key: 'vistoria:editar',  label: 'Editar vistoria' },
      { key: 'vistoria:assinar', label: 'Assinar digitalmente' },
      { key: 'vistoria:gerar_pdf', label: 'Gerar PDF do relatorio' },
    ],
  },
  {
    modulo: 'galeria',
    icone: '📷',
    label: 'Galeria de Fotos',
    itens: [
      { key: 'galeria:ver',     label: 'Visualizar fotos' },
      { key: 'galeria:upload',  label: 'Upload de fotos' },
      { key: 'galeria:editar',  label: 'Editar legenda/categoria' },
      { key: 'galeria:excluir', label: 'Excluir foto' },
    ],
  },
  {
    modulo: 'calculo',
    icone: '🧮',
    label: 'Cálculos Técnicos',
    itens: [
      { key: 'calculo:ver',      label: 'Ver historico de calculos' },
      { key: 'calculo:executar', label: 'Executar novos calculos' },
    ],
  },
  {
    modulo: 'config',
    icone: '⚙',
    label: 'Configurações do Sistema',
    itens: [
      { key: 'config:usuarios',     label: 'Gerenciar usuarios e permissoes' },
      { key: 'config:auditoria',    label: 'Ver logs de auditoria' },
      { key: 'config:certificados', label: 'Gerenciar certificados digitais' },
      { key: 'config:obras',        label: 'Criar/editar/excluir obras' },
    ],
  },
];

// Lista flat de todas as permission keys validas (gerada do catalogo)
export const PERMISSIONS_VALIDAS: Set<string> = new Set(
  CATEGORIAS_PERMISSOES.flatMap(c => c.itens.map(i => i.key)),
);

// Defaults por role quando users.permissions = NULL.
// Admin/owner = TODAS as permissoes (acesso total).
// Gestor = quase tudo, exceto configuracoes e algumas operacoes destrutivas.
// Colaborador = so /minha-quinzena (sem acesso a /obras).
export const DEFAULT_PERMISSIONS_BY_ROLE: Record<RoleNome, string[]> = {
  admin: Array.from(PERMISSIONS_VALIDAS),
  owner: Array.from(PERMISSIONS_VALIDAS),
  gestor: Array.from(PERMISSIONS_VALIDAS).filter(p =>
    !p.startsWith('config:') &&
    !p.endsWith(':excluir') &&
    p !== 'financeiro:excluir' &&
    p !== 'folha:reverter'
  ),
  colaborador: [], // colaborador nao tem acesso ao /obras de modo geral
};

// Resolve permissoes EFETIVAS de um user: se permissions custom NULL, usa default do role.
export function resolverPermissoesEfetivas(role: RoleNome, custom?: string[] | null): string[] {
  if (custom === null || custom === undefined) {
    return DEFAULT_PERMISSIONS_BY_ROLE[role] || [];
  }
  // Quando custom = [] explicito, retorna [] (user sem permissoes)
  return custom.filter(k => PERMISSIONS_VALIDAS.has(k));
}

export function temPermissao(role: RoleNome, custom: string[] | null | undefined, key: string): boolean {
  return resolverPermissoesEfetivas(role, custom).includes(key);
}
