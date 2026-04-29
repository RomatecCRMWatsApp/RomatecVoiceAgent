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
  // Aceita qualquer variavel que contenha "BRAVE" no nome (mais flexivel)
  let apiKey = process.env.BRAVE_API_KEY || process.env.CHAVE_API_BRAVE;
  if (!apiKey) {
    // Procura QUALQUER env var que contenha "BRAVE" caso nome diferente
    const allBraveVars = Object.keys(process.env).filter(k => k.toUpperCase().includes('BRAVE'));
    console.log(`[Brave] env vars com BRAVE: ${allBraveVars.length === 0 ? 'NENHUMA' : allBraveVars.join(', ')}`);
    if (allBraveVars.length > 0) {
      apiKey = process.env[allBraveVars[0]];
      console.log(`[Brave] usando variavel alternativa: ${allBraveVars[0]} (${apiKey?.length} chars)`);
    }
  }
  console.log(`[Brave] env check: BRAVE_API_KEY=${process.env.BRAVE_API_KEY ? 'set('+process.env.BRAVE_API_KEY.length+'chars)' : 'undefined'} | CHAVE_API_BRAVE=${process.env.CHAVE_API_BRAVE ? 'set('+process.env.CHAVE_API_BRAVE.length+'chars)' : 'undefined'}`);
  if (!apiKey) {
    throw new Error('BRAVE_API_KEY não configurada no ambiente. Variavel deve ser BRAVE_API_KEY ou CHAVE_API_BRAVE com valor da api.search.brave.com');
  }

  const limit = Math.min(Math.max(input.limite ?? 5, 1), 20);
  const params = new URLSearchParams({
    q:             input.query,
    count:         String(limit),
    country:       input.pais ?? 'BR',
    search_lang:   'pt-br',
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
