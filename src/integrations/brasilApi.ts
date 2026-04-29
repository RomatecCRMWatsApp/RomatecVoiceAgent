// BrasilAPI — dados públicos brasileiros (CNPJ, CEP, banks, FIPE, etc).
// Zero credencial, zero rate limit prático. https://brasilapi.com.br
//
// Útil pra ZAYRA: ao receber CNPJ/CEP do CEO, buscar dados oficiais e
// pré-preencher cadastros (cliente, fornecedor, endereço de obra).

const BASE = 'https://brasilapi.com.br/api';

export interface CnpjResultado {
  cnpj:                string;
  razao_social:        string;
  nome_fantasia:       string | null;
  situacao_cadastral:  string;
  data_situacao:       string;
  cnae_principal:      { codigo: string; descricao: string };
  natureza_juridica:   string;
  endereco: {
    logradouro: string; numero: string; complemento: string;
    bairro:     string; cep:    string; municipio:    string; uf: string;
  };
  telefone:            string | null;
  email:               string | null;
  capital_social:      number;
  porte:               string;
  data_inicio:         string;
}

function clean(s: string): string {
  return String(s ?? '').replace(/\D/g, '');
}

export async function consultarCnpj(input: { cnpj: string }): Promise<CnpjResultado> {
  const cnpj = clean(input.cnpj);
  if (cnpj.length !== 14) throw new Error(`CNPJ inválido: ${input.cnpj} (esperado 14 dígitos)`);

  const r = await fetch(`${BASE}/cnpj/v1/${cnpj}`);
  if (r.status === 404) throw new Error(`CNPJ ${cnpj} não encontrado na Receita Federal`);
  if (!r.ok) throw new Error(`BrasilAPI CNPJ ${r.status}`);
  const d = await r.json() as Record<string, unknown>;
  const s = (k: string) => String(d[k] ?? '');
  const n = (k: string) => Number(d[k] ?? 0);

  return {
    cnpj:                s('cnpj'),
    razao_social:        s('razao_social'),
    nome_fantasia:       d.nome_fantasia ? s('nome_fantasia') : null,
    situacao_cadastral:  s('descricao_situacao_cadastral'),
    data_situacao:       s('data_situacao_cadastral'),
    cnae_principal:      {
      codigo:    s('cnae_fiscal'),
      descricao: s('cnae_fiscal_descricao'),
    },
    natureza_juridica:   s('natureza_juridica'),
    endereco: {
      logradouro: `${s('descricao_tipo_de_logradouro')} ${s('logradouro')}`.trim(),
      numero:     s('numero') || 's/n',
      complemento: s('complemento'),
      bairro:     s('bairro'),
      cep:        s('cep'),
      municipio:  s('municipio'),
      uf:         s('uf'),
    },
    telefone:            d.ddd_telefone_1 ? s('ddd_telefone_1') : null,
    email:               d.email ? s('email') : null,
    capital_social:      n('capital_social'),
    porte:               s('porte'),
    data_inicio:         s('data_inicio_atividade'),
  };
}

export interface CepResultado {
  cep:        string;
  estado:     string;
  cidade:     string;
  bairro:     string;
  rua:        string;
  servico:    string;
}

export async function consultarCep(input: { cep: string }): Promise<CepResultado> {
  const cep = clean(input.cep);
  if (cep.length !== 8) throw new Error(`CEP inválido: ${input.cep} (esperado 8 dígitos)`);

  const r = await fetch(`${BASE}/cep/v2/${cep}`);
  if (r.status === 404) throw new Error(`CEP ${cep} não encontrado`);
  if (!r.ok) throw new Error(`BrasilAPI CEP ${r.status}`);
  const d = await r.json() as Record<string, unknown>;
  const s = (k: string) => String(d[k] ?? '');

  return {
    cep:     s('cep'),
    estado:  s('state'),
    cidade:  s('city'),
    bairro:  s('neighborhood'),
    rua:     s('street'),
    servico: s('service'),
  };
}

export interface BancoResultado {
  ispb:        string;
  nome:        string;
  codigo:      number | null;
  nome_completo: string;
}

export async function consultarBanco(input: { codigo: string | number }): Promise<BancoResultado> {
  const cod = String(input.codigo).padStart(3, '0');
  const r = await fetch(`${BASE}/banks/v1/${cod}`);
  if (r.status === 404) throw new Error(`Banco ${cod} não encontrado`);
  if (!r.ok) throw new Error(`BrasilAPI Banks ${r.status}`);
  const d = await r.json() as { ispb: string; name: string; code: number | null; fullName: string };
  return {
    ispb:          d.ispb,
    nome:          d.name,
    codigo:        d.code,
    nome_completo: d.fullName,
  };
}

export async function feriadosNacionais(input: { ano?: number } = {}): Promise<Array<{ data: string; nome: string; tipo: string }>> {
  const ano = input.ano ?? new Date().getFullYear();
  const r = await fetch(`${BASE}/feriados/v1/${ano}`);
  if (!r.ok) throw new Error(`BrasilAPI Feriados ${r.status}`);
  const list = await r.json() as Array<{ date: string; name: string; type: string }>;
  return list.map(h => ({ data: h.date, nome: h.name, tipo: h.type }));
}

// ── DDD: descobrir cidades/estado de um DDD ──────────────────────────────
export async function consultarDdd(input: { ddd: string | number }): Promise<{
  ddd: string; estado: string; cidades: string[];
}> {
  const ddd = String(input.ddd).replace(/\D/g, '');
  if (ddd.length !== 2) throw new Error(`DDD inválido: ${input.ddd} (esperado 2 dígitos, ex: 98)`);
  const r = await fetch(`${BASE}/ddd/v1/${ddd}`);
  if (r.status === 404) throw new Error(`DDD ${ddd} não encontrado`);
  if (!r.ok) throw new Error(`BrasilAPI DDD ${r.status}`);
  const d = await r.json() as { state: string; cities: string[] };
  return { ddd, estado: d.state, cidades: d.cities };
}

// ── FIPE: tabela de valor de veículos (útil pra avaliação de bens em PTAM) ─
export async function fipeMarcas(input: { tipo?: 'carros' | 'motos' | 'caminhoes' } = {}): Promise<Array<{ codigo: string; nome: string }>> {
  const tipo = input.tipo ?? 'carros';
  const r = await fetch(`${BASE}/fipe/marcas/v1/${tipo}`);
  if (!r.ok) throw new Error(`BrasilAPI FIPE marcas ${r.status}`);
  const list = await r.json() as Array<{ valor: string; nome: string }>;
  return list.map(m => ({ codigo: m.valor, nome: m.nome }));
}

export async function fipePreco(input: { codigo_fipe: string }): Promise<Array<{
  valor: string; marca: string; modelo: string; ano: string; combustivel: string;
  codigo_fipe: string; mes_referencia: string;
}>> {
  if (!input.codigo_fipe) throw new Error('codigo_fipe obrigatório (formato: 001234-5)');
  const r = await fetch(`${BASE}/fipe/preco/v1/${input.codigo_fipe}`);
  if (r.status === 404) throw new Error(`Veículo FIPE ${input.codigo_fipe} não encontrado`);
  if (!r.ok) throw new Error(`BrasilAPI FIPE preço ${r.status}`);
  const list = await r.json() as Array<Record<string, string>>;
  return list.map(v => ({
    valor:           v.valor,
    marca:           v.marca,
    modelo:          v.modelo,
    ano:             String(v.anoModelo ?? ''),
    combustivel:     v.combustivel,
    codigo_fipe:     v.codigoFipe,
    mes_referencia:  v.mesReferencia,
  }));
}

// ── Taxas: Selic, CDI, IPCA (atualizadas) ────────────────────────────────
export async function consultarTaxas(): Promise<Array<{ nome: string; valor: number }>> {
  const r = await fetch(`${BASE}/taxas/v1`);
  if (!r.ok) throw new Error(`BrasilAPI Taxas ${r.status}`);
  const list = await r.json() as Array<{ nome: string; valor: number }>;
  return list;
}

// ── PIX: participantes (bancos cadastrados no PIX) ───────────────────────
export async function consultarPixParticipantes(): Promise<Array<{ ispb: string; nome: string; nome_reduzido: string; modalidade: string; tipo_participacao: string }>> {
  const r = await fetch(`${BASE}/pix/v1/participants`);
  if (!r.ok) throw new Error(`BrasilAPI PIX ${r.status}`);
  const list = await r.json() as Array<Record<string, string>>;
  return list.map(p => ({
    ispb:               p.ispb,
    nome:               p.nome,
    nome_reduzido:      p.nome_reduzido,
    modalidade:         p.modalidade_participacao,
    tipo_participacao:  p.tipo_participacao,
  })).slice(0, 50); // limita a 50 pra não estourar contexto
}

// ── CPTEC/INPE: previsão de clima (essencial pra cronograma de obra) ─────
export async function climaCidade(input: { cidade: string }): Promise<{
  cidade: string; estado: string; previsao: Array<{ data: string; tempo: string; max: number; min: number; iuv: number }>;
}> {
  if (!input.cidade) throw new Error('cidade obrigatória');
  // Primeiro busca código da cidade
  const r1 = await fetch(`${BASE}/cptec/v1/cidade/${encodeURIComponent(input.cidade)}`);
  if (!r1.ok) throw new Error(`BrasilAPI CPTEC busca cidade ${r1.status}`);
  const cidades = await r1.json() as Array<{ id: number; nome: string; estado: string }>;
  if (cidades.length === 0) throw new Error(`Cidade "${input.cidade}" não encontrada no CPTEC`);
  const cidade = cidades[0];

  // Depois busca previsão
  const r2 = await fetch(`${BASE}/cptec/v1/clima/previsao/${cidade.id}/6`);
  if (!r2.ok) throw new Error(`BrasilAPI CPTEC previsão ${r2.status}`);
  const d = await r2.json() as { cidade: string; estado: string; clima: Array<Record<string, unknown>> };
  return {
    cidade:   d.cidade,
    estado:   d.estado,
    previsao: (d.clima || []).map(c => ({
      data:    String(c.data ?? ''),
      tempo:   String(c.condicao_desc ?? c.condicao ?? ''),
      max:     Number(c.max ?? 0),
      min:     Number(c.min ?? 0),
      iuv:     Number(c.indice_uv ?? 0),
    })),
  };
}

// ── ISBN: dados de livro (útil pra biblioteca técnica de avaliações) ─────
export async function consultarIsbn(input: { isbn: string }): Promise<{
  isbn: string; titulo: string; autores: string[]; editora: string; ano: string; paginas: number; idioma: string;
}> {
  const isbn = clean(input.isbn);
  const r = await fetch(`${BASE}/isbn/v1/${isbn}`);
  if (r.status === 404) throw new Error(`ISBN ${isbn} não encontrado`);
  if (!r.ok) throw new Error(`BrasilAPI ISBN ${r.status}`);
  const d = await r.json() as Record<string, unknown>;
  return {
    isbn:     String(d.isbn ?? ''),
    titulo:   String(d.title ?? ''),
    autores:  Array.isArray(d.authors) ? d.authors as string[] : [],
    editora:  String(d.publisher ?? ''),
    ano:      String(d.year ?? ''),
    paginas:  Number(d.page_count ?? 0),
    idioma:   String(d.language ?? ''),
  };
}
