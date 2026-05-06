// v1.67.7: OCR de cupom fiscal via Claude Vision.
// Recebe imagem do cupom (JPG/PNG) e devolve struct pronta pra preencher
// o form de Nova Despesa Extra. Tenta inferir categoria (ferramenta/material/
// aluguel/outros) baseado na descricao dos itens.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-5';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY nao configurada');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const PROMPT = `Voce e um extrator de dados de cupom fiscal/recibo brasileiro.
Analise a imagem e devolva APENAS JSON puro (sem markdown, sem prosa) com a estrutura:

{
  "loja": "NOME COMPLETO DA LOJA OU FORNECEDOR (max 120 chars)",
  "cnpj": "00.000.000/0000-00 OU null",
  "data": "YYYY-MM-DD OU null se nao identificavel",
  "forma_pagamento": "pix" | "dinheiro" | "cartao_credito" | "cartao_debito" | "boleto" | null,
  "categoria_sugerida": "ferramenta" | "aluguel" | "material" | "outros",
  "itens": [
    { "descricao": "ITEM 1 (max 200 chars)", "quantidade": 1, "valor": 99.90 },
    ...
  ],
  "subtotal": 999.99,
  "desconto": 0,
  "total": 999.99,
  "observacoes": "qualquer detalhe relevante (ex: NF #123, vendedor, etc) ou null",
  "confianca": "alta" | "media" | "baixa"
}

REGRAS CRITICAS:
- Se nao for cupom/recibo/nota fiscal, retorne { "erro": "imagem nao parece cupom fiscal" }.
- Valores: numeros decimais com 2 casas (99.90 nao "99,90").
- Quantidade: numero (1, 2, 0.5 — pode ter fracao tipo "0.250 kg").
- categoria_sugerida: escolha a melhor das 4 opcoes baseado nos itens (ex: parafusos/tinta/cimento = material; furadeira/serra = ferramenta; aluguel betoneira = aluguel; resto = outros).
- forma_pagamento: detecta pelo texto do cupom (PIX, DEBITO, CREDITO, DINHEIRO, BOLETO). Se nao tiver, null.
- Se subtotal != soma dos itens (cupom tem desconto), preencha desconto.
- confianca: "alta" se tudo legivel; "media" se 1-2 itens borrados; "baixa" se muito dificil ler.
- NAO ALUCINE valores. Se nao consegue ler um numero, marque o item com confianca:"baixa" e pule pro proximo.

Responda APENAS com o JSON, sem nenhum texto antes ou depois.`;

export interface CupomOcrResult {
  loja?: string;
  cnpj?: string | null;
  data?: string | null;
  forma_pagamento?: 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'boleto' | null;
  categoria_sugerida?: 'ferramenta' | 'aluguel' | 'material' | 'outros';
  itens?: Array<{ descricao: string; quantidade: number; valor: number }>;
  subtotal?: number;
  desconto?: number;
  total?: number;
  observacoes?: string | null;
  confianca?: 'alta' | 'media' | 'baixa';
  erro?: string;
}

export async function extrairDadosCupom(input: {
  imagem_b64: string;
  mimetype: string;
}): Promise<CupomOcrResult> {
  const mime = input.mimetype.toLowerCase();
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime)) {
    throw new Error(`Mimetype nao suportado para OCR: ${mime}. Use JPG, PNG ou WEBP.`);
  }

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    temperature: 0.1, // baixo pra extracao consistente
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: input.imagem_b64,
            },
          },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude nao retornou texto');
  }
  const raw = textBlock.text.trim();
  // Tenta extrair JSON mesmo se vier com markdown
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[cupom-ocr] sem JSON na resposta:', raw.slice(0, 200));
    throw new Error('Claude retornou resposta sem JSON. Tente foto mais nitida.');
  }
  let parsed: CupomOcrResult;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[cupom-ocr] JSON invalido:', jsonMatch[0].slice(0, 200));
    throw new Error(`JSON invalido: ${(err as Error).message}`);
  }
  if (parsed.erro) {
    throw new Error(parsed.erro);
  }
  // Defesa: garante shape minimo
  parsed.itens = parsed.itens?.filter(i => i.descricao && Number(i.valor) > 0) || [];
  return parsed;
}
