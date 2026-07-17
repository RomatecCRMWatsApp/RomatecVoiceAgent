// v3.24.8: Catalogo de comodos de edificacao usado no Programa de Necessidades
// da Proposta de Projeto Executivo. 6 categorias + 49 comodos.
//
// Cada comodo tem `ordem_pdf` pra controlar a ordem no documento final (menores
// numeros aparecem primeiro). Numeracao com gap (10/11/12.../20/21...) deixa
// margem pra inserir novos comodos no meio sem renumerar tudo.

export type CategoriaComodo =
  | 'social'
  | 'intimo'
  | 'servico'
  | 'externo'
  | 'comercial'
  | 'tecnico';

// v3.104.0: tipos de edificação (espelha o select do form). Usado pra FILTRAR os
// cômodos: comercial/galpão não mostra Suíte/Cozinha; residencial não mostra
// Galpão/Doca. Cômodo SEM `tipos` = universal (aparece em todos).
export type TipoEdificacao =
  | 'residencial'
  | 'comercial'
  | 'misto'
  | 'industrial'
  | 'institucional';

export interface ComodoCatalogo {
  codigo: string;
  nome: string;
  nome_plural: string;
  categoria: CategoriaComodo;
  icone: string;
  ordem_pdf: number;
  observacao_padrao?: string;
  /** Tipos de edificação onde este cômodo aparece. Ausente = todos. */
  tipos?: TipoEdificacao[];
}

// Atalhos de aplicabilidade
const RESID: TipoEdificacao[] = ['residencial', 'misto'];
const COMER: TipoEdificacao[] = ['comercial', 'misto', 'industrial', 'institucional'];

export const CATEGORIAS_LABEL: Record<CategoriaComodo, string> = {
  social:    '🛋 Area Social',
  intimo:    '🛏 Area Intima',
  servico:   '🍳 Area de Servico',
  externo:   '🌳 Area Externa',
  comercial: '🏪 Area Comercial',
  tecnico:   '⚙ Areas Tecnicas',
};

export const COMODOS_CATALOGO: ComodoCatalogo[] = [
  // ===== SOCIAL ===== (estar/jantar/tv/jogos são residenciais; escritório/hall/lavabo servem a todos)
  { codigo: 'sala_estar',       nome: 'Sala de Estar',       nome_plural: 'Salas de Estar',       categoria: 'social', icone: '🛋', ordem_pdf: 10, tipos: RESID },
  { codigo: 'sala_jantar',      nome: 'Sala de Jantar',      nome_plural: 'Salas de Jantar',      categoria: 'social', icone: '🍽', ordem_pdf: 11, tipos: RESID },
  { codigo: 'sala_tv',          nome: 'Sala de TV',          nome_plural: 'Salas de TV',          categoria: 'social', icone: '📺', ordem_pdf: 12, tipos: RESID },
  { codigo: 'sala_integrada',   nome: 'Sala Integrada',      nome_plural: 'Salas Integradas',     categoria: 'social', icone: '🏠', ordem_pdf: 13, tipos: RESID, observacao_padrao: 'Estar/Jantar conjugados' },
  { codigo: 'home_office',      nome: 'Home Office',         nome_plural: 'Home Offices',         categoria: 'social', icone: '💻', ordem_pdf: 14, tipos: RESID },
  { codigo: 'escritorio',       nome: 'Escritorio',          nome_plural: 'Escritorios',          categoria: 'social', icone: '📚', ordem_pdf: 15 },
  { codigo: 'hall_entrada',     nome: 'Hall de Entrada',     nome_plural: 'Halls de Entrada',     categoria: 'social', icone: '🚪', ordem_pdf: 16 },
  { codigo: 'lavabo',           nome: 'Lavabo',              nome_plural: 'Lavabos',              categoria: 'social', icone: '🚻', ordem_pdf: 17 },
  { codigo: 'sala_jogos',       nome: 'Sala de Jogos',       nome_plural: 'Salas de Jogos',       categoria: 'social', icone: '🎮', ordem_pdf: 18, tipos: RESID },

  // ===== INTIMO ===== (todos residenciais)
  { codigo: 'suite_master',     nome: 'Suite Master',        nome_plural: 'Suites Master',        categoria: 'intimo', icone: '👑', ordem_pdf: 20, tipos: RESID, observacao_padrao: 'Com banheiro privativo e closet' },
  { codigo: 'suite_closet',     nome: 'Suite com Closet',    nome_plural: 'Suites com Closet',    categoria: 'intimo', icone: '🚪', ordem_pdf: 21, tipos: RESID },
  { codigo: 'suite_simples',    nome: 'Suite Simples',       nome_plural: 'Suites Simples',       categoria: 'intimo', icone: '🛏', ordem_pdf: 22, tipos: RESID, observacao_padrao: 'Com banheiro privativo' },
  { codigo: 'quarto_casal',     nome: 'Quarto de Casal',     nome_plural: 'Quartos de Casal',     categoria: 'intimo', icone: '💑', ordem_pdf: 23, tipos: RESID },
  { codigo: 'quarto_solteiro',  nome: 'Quarto de Solteiro',  nome_plural: 'Quartos de Solteiro',  categoria: 'intimo', icone: '🧒', ordem_pdf: 24, tipos: RESID },
  { codigo: 'quarto',           nome: 'Quarto',              nome_plural: 'Quartos',              categoria: 'intimo', icone: '🛌', ordem_pdf: 25, tipos: RESID },
  { codigo: 'quarto_hospede',   nome: 'Quarto de Hospedes',  nome_plural: 'Quartos de Hospedes',  categoria: 'intimo', icone: '🛎', ordem_pdf: 26, tipos: RESID },
  { codigo: 'closet',           nome: 'Closet',              nome_plural: 'Closets',              categoria: 'intimo', icone: '👔', ordem_pdf: 27, tipos: RESID },
  { codigo: 'banheiro_social',  nome: 'Banheiro Social',     nome_plural: 'Banheiros Sociais',    categoria: 'intimo', icone: '🚿', ordem_pdf: 28, tipos: RESID },
  { codigo: 'banheiro_suite',   nome: 'Banheiro de Suite',   nome_plural: 'Banheiros de Suite',   categoria: 'intimo', icone: '🛁', ordem_pdf: 29, tipos: RESID },

  // ===== SERVICO ===== (cozinhas/lavanderia/dce residenciais; copa serve a todos)
  { codigo: 'cozinha',          nome: 'Cozinha',             nome_plural: 'Cozinhas',             categoria: 'servico', icone: '🍳', ordem_pdf: 40, tipos: RESID },
  { codigo: 'cozinha_americana',nome: 'Cozinha Americana',   nome_plural: 'Cozinhas Americanas',  categoria: 'servico', icone: '🥘', ordem_pdf: 41, tipos: RESID },
  { codigo: 'cozinha_gourmet',  nome: 'Cozinha Gourmet',     nome_plural: 'Cozinhas Gourmet',     categoria: 'servico', icone: '👨‍🍳', ordem_pdf: 42, tipos: RESID },
  { codigo: 'copa',             nome: 'Copa',                nome_plural: 'Copas',                categoria: 'servico', icone: '🥄', ordem_pdf: 43 },
  { codigo: 'area_servico',     nome: 'Area de Servico',     nome_plural: 'Areas de Servico',     categoria: 'servico', icone: '🧺', ordem_pdf: 44, tipos: RESID },
  { codigo: 'lavanderia',       nome: 'Lavanderia',          nome_plural: 'Lavanderias',          categoria: 'servico', icone: '🧼', ordem_pdf: 45, tipos: RESID },
  { codigo: 'despensa',         nome: 'Despensa',            nome_plural: 'Despensas',            categoria: 'servico', icone: '🥫', ordem_pdf: 46, tipos: RESID },
  { codigo: 'dce',              nome: 'DCE',                 nome_plural: 'DCEs',                 categoria: 'servico', icone: '🧹', ordem_pdf: 47, tipos: RESID, observacao_padrao: 'Dependencia Completa de Empregada' },

  // ===== EXTERNO ===== (varanda/gourmet/piscina/jardim residenciais; garagem/vaga/terraço servem a todos)
  { codigo: 'varanda',          nome: 'Varanda',             nome_plural: 'Varandas',             categoria: 'externo', icone: '🌅', ordem_pdf: 60, tipos: RESID },
  { codigo: 'sacada',           nome: 'Sacada',              nome_plural: 'Sacadas',              categoria: 'externo', icone: '🌇', ordem_pdf: 61, tipos: RESID },
  { codigo: 'terraco',          nome: 'Terraco',             nome_plural: 'Terracos',             categoria: 'externo', icone: '🏙', ordem_pdf: 62 },
  { codigo: 'area_gourmet',     nome: 'Area Gourmet',        nome_plural: 'Areas Gourmet',        categoria: 'externo', icone: '🍖', ordem_pdf: 63, tipos: RESID },
  { codigo: 'churrasqueira',    nome: 'Churrasqueira',       nome_plural: 'Churrasqueiras',       categoria: 'externo', icone: '🔥', ordem_pdf: 64, tipos: RESID },
  { codigo: 'piscina',          nome: 'Piscina',             nome_plural: 'Piscinas',             categoria: 'externo', icone: '🏊', ordem_pdf: 65, tipos: RESID },
  { codigo: 'jardim',           nome: 'Jardim',              nome_plural: 'Jardins',              categoria: 'externo', icone: '🌳', ordem_pdf: 66 },
  { codigo: 'quintal',          nome: 'Quintal',             nome_plural: 'Quintais',             categoria: 'externo', icone: '🌿', ordem_pdf: 67, tipos: RESID },
  { codigo: 'garagem',          nome: 'Garagem',             nome_plural: 'Garagens',             categoria: 'externo', icone: '🚗', ordem_pdf: 68, tipos: RESID },
  { codigo: 'vaga_coberta',     nome: 'Vaga Coberta',        nome_plural: 'Vagas Cobertas',       categoria: 'externo', icone: '🅿', ordem_pdf: 69 },
  { codigo: 'edicula',          nome: 'Edicula',             nome_plural: 'Ediculas',             categoria: 'externo', icone: '🏚', ordem_pdf: 70, tipos: RESID },

  // ===== COMERCIAL ===== (galpão, salas, atendimento, estoque, banheiros F/M, vestiário, doca…)
  { codigo: 'galpao',           nome: 'Galpao',              nome_plural: 'Galpoes',              categoria: 'comercial', icone: '🏭', ordem_pdf: 79, tipos: COMER, observacao_padrao: 'Area principal do galpao (vao livre)' },
  { codigo: 'salao_comercial',  nome: 'Salao Comercial',     nome_plural: 'Saloes Comerciais',    categoria: 'comercial', icone: '🏪', ordem_pdf: 80, tipos: COMER },
  { codigo: 'loja',             nome: 'Loja',                nome_plural: 'Lojas',                categoria: 'comercial', icone: '🛍', ordem_pdf: 81, tipos: COMER },
  { codigo: 'showroom',         nome: 'Showroom',            nome_plural: 'Showrooms',            categoria: 'comercial', icone: '🖼', ordem_pdf: 82, tipos: COMER, observacao_padrao: 'Area de exposicao' },
  { codigo: 'recepcao',         nome: 'Recepcao',            nome_plural: 'Recepcoes',            categoria: 'comercial', icone: '🛎', ordem_pdf: 83, tipos: COMER },
  { codigo: 'sala_atendimento', nome: 'Sala de Atendimento', nome_plural: 'Salas de Atendimento', categoria: 'comercial', icone: '💼', ordem_pdf: 84, tipos: COMER },
  { codigo: 'sala_administrativa', nome: 'Sala Administrativa', nome_plural: 'Salas Administrativas', categoria: 'comercial', icone: '🗂', ordem_pdf: 85, tipos: COMER },
  { codigo: 'sala_reuniao',     nome: 'Sala de Reuniao',     nome_plural: 'Salas de Reuniao',     categoria: 'comercial', icone: '👥', ordem_pdf: 86, tipos: COMER },
  { codigo: 'sala_generica',    nome: 'Sala',                nome_plural: 'Salas',                categoria: 'comercial', icone: '🚪', ordem_pdf: 87, tipos: COMER, observacao_padrao: 'Sala comercial de uso geral' },
  { codigo: 'almoxarifado',     nome: 'Almoxarifado',        nome_plural: 'Almoxarifados',        categoria: 'comercial', icone: '📦', ordem_pdf: 88, tipos: COMER },
  { codigo: 'deposito',         nome: 'Deposito',            nome_plural: 'Depositos',            categoria: 'comercial', icone: '🗄', ordem_pdf: 89, tipos: COMER },
  { codigo: 'camara_fria',      nome: 'Camara Fria',         nome_plural: 'Camaras Frias',        categoria: 'comercial', icone: '❄', ordem_pdf: 90, tipos: COMER },
  { codigo: 'refeitorio',       nome: 'Refeitorio',          nome_plural: 'Refeitorios',          categoria: 'comercial', icone: '🍽', ordem_pdf: 91, tipos: COMER },
  { codigo: 'copa_funcionarios',nome: 'Copa de Funcionarios',nome_plural: 'Copas de Funcionarios',categoria: 'comercial', icone: '☕', ordem_pdf: 92, tipos: COMER },
  { codigo: 'vestiario',        nome: 'Vestiario',           nome_plural: 'Vestiarios',           categoria: 'comercial', icone: '🚹', ordem_pdf: 93, tipos: COMER, observacao_padrao: 'Vestiario de funcionarios' },
  { codigo: 'banheiro_feminino',nome: 'Banheiro Feminino',   nome_plural: 'Banheiros Femininos',  categoria: 'comercial', icone: '🚺', ordem_pdf: 94, tipos: COMER },
  { codigo: 'banheiro_masculino',nome: 'Banheiro Masculino', nome_plural: 'Banheiros Masculinos', categoria: 'comercial', icone: '🚹', ordem_pdf: 95, tipos: COMER },
  { codigo: 'banheiro_pne',     nome: 'Banheiro PNE',        nome_plural: 'Banheiros PNE',        categoria: 'comercial', icone: '♿', ordem_pdf: 96, observacao_padrao: 'Acessivel conforme NBR 9050' },
  { codigo: 'doca',             nome: 'Doca de Carga/Descarga', nome_plural: 'Docas de Carga/Descarga', categoria: 'comercial', icone: '🚚', ordem_pdf: 97, tipos: COMER },
  { codigo: 'patio_manobra',    nome: 'Patio de Manobra',    nome_plural: 'Patios de Manobra',    categoria: 'comercial', icone: '🅿', ordem_pdf: 98, tipos: COMER },
  { codigo: 'estacionamento',   nome: 'Estacionamento',      nome_plural: 'Estacionamentos',      categoria: 'comercial', icone: '🚗', ordem_pdf: 99, tipos: COMER },
  { codigo: 'guarita',          nome: 'Guarita / Portaria',  nome_plural: 'Guaritas / Portarias', categoria: 'comercial', icone: '💂', ordem_pdf: 100, tipos: COMER },

  // ===== TECNICO ===== (servem a todos os tipos)
  { codigo: 'casa_maquinas',    nome: 'Casa de Maquinas',    nome_plural: 'Casas de Maquinas',    categoria: 'tecnico', icone: '⚙', ordem_pdf: 110 },
  { codigo: 'reservatorio',     nome: 'Reservatorio',        nome_plural: 'Reservatorios',        categoria: 'tecnico', icone: '💧', ordem_pdf: 111, observacao_padrao: "Caixa d'agua superior/inferior" },
  { codigo: 'subsolo',          nome: 'Subsolo',             nome_plural: 'Subsolos',             categoria: 'tecnico', icone: '🕳', ordem_pdf: 112 },
  { codigo: 'circulacao',       nome: 'Circulacao',          nome_plural: 'Circulacoes',          categoria: 'tecnico', icone: '↔', ordem_pdf: 113 },
  { codigo: 'escada',           nome: 'Escada',              nome_plural: 'Escadas',              categoria: 'tecnico', icone: '🪜', ordem_pdf: 114 },
  { codigo: 'mezanino',         nome: 'Mezanino',            nome_plural: 'Mezaninos',            categoria: 'tecnico', icone: '🏗', ordem_pdf: 115 },
];

export function buscarComodo(codigo: string): ComodoCatalogo | undefined {
  return COMODOS_CATALOGO.find(c => c.codigo === codigo);
}

export function listarComodosPorCategoria(): Record<CategoriaComodo, ComodoCatalogo[]> {
  const out: Record<CategoriaComodo, ComodoCatalogo[]> = {
    social: [], intimo: [], servico: [], externo: [], comercial: [], tecnico: [],
  };
  for (const c of COMODOS_CATALOGO) out[c.categoria].push(c);
  // Garante ordenacao por ordem_pdf dentro de cada categoria
  for (const k of Object.keys(out) as CategoriaComodo[]) {
    out[k].sort((a, b) => a.ordem_pdf - b.ordem_pdf);
  }
  return out;
}

// v3.24.8: ordem padrao de exibicao das categorias no PDF/UI
export const ORDEM_CATEGORIAS: CategoriaComodo[] = [
  'social', 'intimo', 'servico', 'externo', 'comercial', 'tecnico',
];
