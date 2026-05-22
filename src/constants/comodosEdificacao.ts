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

export interface ComodoCatalogo {
  codigo: string;
  nome: string;
  nome_plural: string;
  categoria: CategoriaComodo;
  icone: string;
  ordem_pdf: number;
  observacao_padrao?: string;
}

export const CATEGORIAS_LABEL: Record<CategoriaComodo, string> = {
  social:    '🛋 Area Social',
  intimo:    '🛏 Area Intima',
  servico:   '🍳 Area de Servico',
  externo:   '🌳 Area Externa',
  comercial: '🏪 Area Comercial',
  tecnico:   '⚙ Areas Tecnicas',
};

export const COMODOS_CATALOGO: ComodoCatalogo[] = [
  // ===== SOCIAL =====
  { codigo: 'sala_estar',       nome: 'Sala de Estar',       nome_plural: 'Salas de Estar',       categoria: 'social', icone: '🛋', ordem_pdf: 10 },
  { codigo: 'sala_jantar',      nome: 'Sala de Jantar',      nome_plural: 'Salas de Jantar',      categoria: 'social', icone: '🍽', ordem_pdf: 11 },
  { codigo: 'sala_tv',          nome: 'Sala de TV',          nome_plural: 'Salas de TV',          categoria: 'social', icone: '📺', ordem_pdf: 12 },
  { codigo: 'sala_integrada',   nome: 'Sala Integrada',      nome_plural: 'Salas Integradas',     categoria: 'social', icone: '🏠', ordem_pdf: 13, observacao_padrao: 'Estar/Jantar conjugados' },
  { codigo: 'home_office',      nome: 'Home Office',         nome_plural: 'Home Offices',         categoria: 'social', icone: '💻', ordem_pdf: 14 },
  { codigo: 'escritorio',       nome: 'Escritorio',          nome_plural: 'Escritorios',          categoria: 'social', icone: '📚', ordem_pdf: 15 },
  { codigo: 'hall_entrada',     nome: 'Hall de Entrada',     nome_plural: 'Halls de Entrada',     categoria: 'social', icone: '🚪', ordem_pdf: 16 },
  { codigo: 'lavabo',           nome: 'Lavabo',              nome_plural: 'Lavabos',              categoria: 'social', icone: '🚻', ordem_pdf: 17 },
  { codigo: 'sala_jogos',       nome: 'Sala de Jogos',       nome_plural: 'Salas de Jogos',       categoria: 'social', icone: '🎮', ordem_pdf: 18 },

  // ===== INTIMO =====
  { codigo: 'suite_master',     nome: 'Suite Master',        nome_plural: 'Suites Master',        categoria: 'intimo', icone: '👑', ordem_pdf: 20, observacao_padrao: 'Com banheiro privativo e closet' },
  { codigo: 'suite_closet',     nome: 'Suite com Closet',    nome_plural: 'Suites com Closet',    categoria: 'intimo', icone: '🚪', ordem_pdf: 21 },
  { codigo: 'suite_simples',    nome: 'Suite Simples',       nome_plural: 'Suites Simples',       categoria: 'intimo', icone: '🛏', ordem_pdf: 22, observacao_padrao: 'Com banheiro privativo' },
  { codigo: 'quarto_casal',     nome: 'Quarto de Casal',     nome_plural: 'Quartos de Casal',     categoria: 'intimo', icone: '💑', ordem_pdf: 23 },
  { codigo: 'quarto_solteiro',  nome: 'Quarto de Solteiro',  nome_plural: 'Quartos de Solteiro',  categoria: 'intimo', icone: '🧒', ordem_pdf: 24 },
  { codigo: 'quarto',           nome: 'Quarto',              nome_plural: 'Quartos',              categoria: 'intimo', icone: '🛌', ordem_pdf: 25 },
  { codigo: 'quarto_hospede',   nome: 'Quarto de Hospedes',  nome_plural: 'Quartos de Hospedes',  categoria: 'intimo', icone: '🛎', ordem_pdf: 26 },
  { codigo: 'closet',           nome: 'Closet',              nome_plural: 'Closets',              categoria: 'intimo', icone: '👔', ordem_pdf: 27 },
  { codigo: 'banheiro_social',  nome: 'Banheiro Social',     nome_plural: 'Banheiros Sociais',    categoria: 'intimo', icone: '🚿', ordem_pdf: 28 },
  { codigo: 'banheiro_suite',   nome: 'Banheiro de Suite',   nome_plural: 'Banheiros de Suite',   categoria: 'intimo', icone: '🛁', ordem_pdf: 29 },

  // ===== SERVICO =====
  { codigo: 'cozinha',          nome: 'Cozinha',             nome_plural: 'Cozinhas',             categoria: 'servico', icone: '🍳', ordem_pdf: 40 },
  { codigo: 'cozinha_americana',nome: 'Cozinha Americana',   nome_plural: 'Cozinhas Americanas',  categoria: 'servico', icone: '🥘', ordem_pdf: 41 },
  { codigo: 'cozinha_gourmet',  nome: 'Cozinha Gourmet',     nome_plural: 'Cozinhas Gourmet',     categoria: 'servico', icone: '👨‍🍳', ordem_pdf: 42 },
  { codigo: 'copa',             nome: 'Copa',                nome_plural: 'Copas',                categoria: 'servico', icone: '🥄', ordem_pdf: 43 },
  { codigo: 'area_servico',     nome: 'Area de Servico',     nome_plural: 'Areas de Servico',     categoria: 'servico', icone: '🧺', ordem_pdf: 44 },
  { codigo: 'lavanderia',       nome: 'Lavanderia',          nome_plural: 'Lavanderias',          categoria: 'servico', icone: '🧼', ordem_pdf: 45 },
  { codigo: 'despensa',         nome: 'Despensa',            nome_plural: 'Despensas',            categoria: 'servico', icone: '🥫', ordem_pdf: 46 },
  { codigo: 'dce',              nome: 'DCE',                 nome_plural: 'DCEs',                 categoria: 'servico', icone: '🧹', ordem_pdf: 47, observacao_padrao: 'Dependencia Completa de Empregada' },

  // ===== EXTERNO =====
  { codigo: 'varanda',          nome: 'Varanda',             nome_plural: 'Varandas',             categoria: 'externo', icone: '🌅', ordem_pdf: 60 },
  { codigo: 'sacada',           nome: 'Sacada',              nome_plural: 'Sacadas',              categoria: 'externo', icone: '🌇', ordem_pdf: 61 },
  { codigo: 'terraco',          nome: 'Terraco',             nome_plural: 'Terracos',             categoria: 'externo', icone: '🏙', ordem_pdf: 62 },
  { codigo: 'area_gourmet',     nome: 'Area Gourmet',        nome_plural: 'Areas Gourmet',        categoria: 'externo', icone: '🍖', ordem_pdf: 63 },
  { codigo: 'churrasqueira',    nome: 'Churrasqueira',       nome_plural: 'Churrasqueiras',       categoria: 'externo', icone: '🔥', ordem_pdf: 64 },
  { codigo: 'piscina',          nome: 'Piscina',             nome_plural: 'Piscinas',             categoria: 'externo', icone: '🏊', ordem_pdf: 65 },
  { codigo: 'jardim',           nome: 'Jardim',              nome_plural: 'Jardins',              categoria: 'externo', icone: '🌳', ordem_pdf: 66 },
  { codigo: 'quintal',          nome: 'Quintal',             nome_plural: 'Quintais',             categoria: 'externo', icone: '🌿', ordem_pdf: 67 },
  { codigo: 'garagem',          nome: 'Garagem',             nome_plural: 'Garagens',             categoria: 'externo', icone: '🚗', ordem_pdf: 68 },
  { codigo: 'vaga_coberta',     nome: 'Vaga Coberta',        nome_plural: 'Vagas Cobertas',       categoria: 'externo', icone: '🅿', ordem_pdf: 69 },
  { codigo: 'edicula',          nome: 'Edicula',             nome_plural: 'Ediculas',             categoria: 'externo', icone: '🏚', ordem_pdf: 70 },

  // ===== COMERCIAL =====
  { codigo: 'salao_comercial',  nome: 'Salao Comercial',     nome_plural: 'Saloes Comerciais',    categoria: 'comercial', icone: '🏪', ordem_pdf: 80 },
  { codigo: 'loja',             nome: 'Loja',                nome_plural: 'Lojas',                categoria: 'comercial', icone: '🛍', ordem_pdf: 81 },
  { codigo: 'recepcao',         nome: 'Recepcao',            nome_plural: 'Recepcoes',            categoria: 'comercial', icone: '🛎', ordem_pdf: 82 },
  { codigo: 'sala_atendimento', nome: 'Sala de Atendimento', nome_plural: 'Salas de Atendimento', categoria: 'comercial', icone: '💼', ordem_pdf: 83 },
  { codigo: 'sala_reuniao',     nome: 'Sala de Reuniao',     nome_plural: 'Salas de Reuniao',     categoria: 'comercial', icone: '👥', ordem_pdf: 84 },
  { codigo: 'almoxarifado',     nome: 'Almoxarifado',        nome_plural: 'Almoxarifados',        categoria: 'comercial', icone: '📦', ordem_pdf: 85 },
  { codigo: 'deposito',         nome: 'Deposito',            nome_plural: 'Depositos',            categoria: 'comercial', icone: '🗄', ordem_pdf: 86 },
  { codigo: 'banheiro_pne',     nome: 'Banheiro PNE',        nome_plural: 'Banheiros PNE',        categoria: 'comercial', icone: '♿', ordem_pdf: 87, observacao_padrao: 'Acessivel conforme NBR 9050' },

  // ===== TECNICO =====
  { codigo: 'casa_maquinas',    nome: 'Casa de Maquinas',    nome_plural: 'Casas de Maquinas',    categoria: 'tecnico', icone: '⚙', ordem_pdf: 90 },
  { codigo: 'reservatorio',     nome: 'Reservatorio',        nome_plural: 'Reservatorios',        categoria: 'tecnico', icone: '💧', ordem_pdf: 91, observacao_padrao: "Caixa d'agua superior/inferior" },
  { codigo: 'subsolo',          nome: 'Subsolo',             nome_plural: 'Subsolos',             categoria: 'tecnico', icone: '🕳', ordem_pdf: 92 },
  { codigo: 'circulacao',       nome: 'Circulacao',          nome_plural: 'Circulacoes',          categoria: 'tecnico', icone: '↔', ordem_pdf: 93 },
  { codigo: 'escada',           nome: 'Escada',              nome_plural: 'Escadas',              categoria: 'tecnico', icone: '🪜', ordem_pdf: 94 },
  { codigo: 'mezanino',         nome: 'Mezanino',            nome_plural: 'Mezaninos',            categoria: 'tecnico', icone: '🏗', ordem_pdf: 95 },
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
