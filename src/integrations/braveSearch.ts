// Brave Search API — busca web pra ZAYRA.
// Free tier: 2k req/mês. Endpoint: https://api.search.brave.com
// Auth: header X-Subscription-Token.
// Setup: api.search.brave.com → Create subscription → Free plan → copia key.

interface BraveResult {
  title:       string;
  url:         string;
  description: string;
  age?:        string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

export interface PesquisaResultado {
  query:    string;
  total:    number;
  resultados: Array<{
    titulo:    string;
    url:       string;
    resumo:    string;
    publicado?: string;
  }>;
}

export async function pesquisarWeb(input: {
  query:   string;
  limite?: number;        // default 5, max 20
  pais?:   string;        // ex: 'BR' (default 'BR')
  freshness?: 'pd' | 'pw' | 'pm' | 'py';  // dia/semana/mês/ano
}): Promise<PesquisaResultado> {
  if (!input.query?.trim()) throw new Error('query obrigatória');
  if (!process.env.BRAVE_API_KEY) {
    throw new Error('BRAVE_API_KEY não configurada — gere em api.search.brave.com');
  }

  const limit = Math.min(Math.max(input.limite ?? 5, 1), 20);
  const params = new URLSearchParams({
    q:             input.query,
    count:         String(limit),
    country:       input.pais ?? 'BR',
    search_lang:   'pt',
    safesearch:    'moderate',
  });
  if (input.freshness) params.set('freshness', input.freshness);

  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      Accept:                  'application/json',
      'X-Subscription-Token':  process.env.BRAVE_API_KEY,
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Brave Search ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = await r.json() as BraveResponse;
  const results = data.web?.results ?? [];

  return {
    query:    input.query,
    total:    results.length,
    resultados: results.map(r => ({
      titulo:    r.title,
      url:       r.url,
      resumo:    r.description,
      publicado: r.age,
    })),
  };
}
