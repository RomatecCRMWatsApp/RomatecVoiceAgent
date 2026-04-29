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
