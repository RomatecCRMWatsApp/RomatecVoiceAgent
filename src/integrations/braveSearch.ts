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
  // Aceita BRAVE_API_KEY (padrão) ou CHAVE_API_BRAVE (PT-BR no Railway)
  const apiKey = process.env.BRAVE_API_KEY || process.env.CHAVE_API_BRAVE;
  if (!apiKey) {
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

  const cleanKey = apiKey.trim();  // Remove espaços/quebra de linha que podem ter sido coladas
  console.log(`[Brave] query: "${input.query}" | key length: ${cleanKey.length} | starts with: ${cleanKey.slice(0,4)}...`);

  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      Accept:                  'application/json',
      'X-Subscription-Token':  cleanKey,
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.error(`[Brave] HTTP ${r.status}:`, txt.slice(0, 300));
    if (r.status === 401) throw new Error('Brave Search 401: chave inválida ou subscription não ativada (verifique em api-dashboard.search.brave.com → Subscriptions)');
    if (r.status === 403) throw new Error('Brave Search 403: subscription expirada ou plano free não assinado (assine em Available plans)');
    if (r.status === 422) throw new Error(`Brave Search 422: query rejeitada — ${txt.slice(0, 100)}`);
    if (r.status === 429) throw new Error('Brave Search 429: limite de 1 query/segundo do free tier excedido — aguarde');
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
