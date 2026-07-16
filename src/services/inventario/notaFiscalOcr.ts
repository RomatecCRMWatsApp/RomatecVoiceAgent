// v3.97.0 — Extração de NOTA FISCAL DE MATERIAL por IA (PDF DANFE ou foto).
//
// Clona o padrão de src/services/cupomOcr.ts (Claude Vision, v1.67.7) e de
// aiDocExtractor (document block pra PDF). Usado quando o upload NÃO é XML —
// o XML tem parser determinístico próprio (nfeXmlParser.ts, sempre preferido).
// Confiança baixa => nota marcada como revisao_manual e itens confianca_baixa=1.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.INVENTARIO_OCR_MODEL || 'claude-sonnet-4-5';

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY nao configurada');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const PROMPT = `Voce e um extrator de dados de NOTA FISCAL / DANFE brasileira de compra de materiais de construcao.
Analise o documento e devolva APENAS JSON puro (sem markdown, sem prosa):

{
  "numero_nota": "numero da NF (so digitos) ou null",
  "chave_acesso": "44 digitos da chave de acesso ou null",
  "fornecedor_nome": "RAZAO SOCIAL DO EMITENTE (max 200 chars) ou null",
  "fornecedor_cnpj": "00.000.000/0000-00 ou null",
  "data_emissao": "YYYY-MM-DD ou null",
  "valor_total": 9999.99,
  "itens": [
    { "descricao": "PRODUTO (max 300 chars)", "codigo": "cod ou null", "unidade": "UN|M|M2|M3|KG|L|SC|BR|PC|CX", "quantidade": 10.5, "valor_unitario": 32.50, "valor_total": 341.25 }
  ],
  "confianca": "alta" | "media" | "baixa"
}

REGRAS CRITICAS:
- Se o documento nao parecer nota fiscal/DANFE, retorne { "erro": "documento nao parece nota fiscal" }.
- Valores: decimais com ponto (32.50, nunca "32,50"). Quantidade pode ter fracao.
- unidade: use a da nota (coluna UN/UNID); se ilegivel, "UN".
- NAO ALUCINE: item ilegivel => pule; numero ilegivel => null. Melhor faltar que inventar.
- confianca: "alta" = tabela de itens toda legivel; "media" = 1-2 campos duvidosos; "baixa" = leitura dificil.

Responda APENAS com o JSON.`;

export interface NotaOcrItem {
  descricao: string;
  codigo?: string | null;
  unidade?: string;
  quantidade: number;
  valor_unitario?: number | null;
  valor_total?: number | null;
}

export interface NotaOcrResult {
  numero_nota?: string | null;
  chave_acesso?: string | null;
  fornecedor_nome?: string | null;
  fornecedor_cnpj?: string | null;
  data_emissao?: string | null;
  valor_total?: number | null;
  itens?: NotaOcrItem[];
  confianca?: 'alta' | 'media' | 'baixa';
  erro?: string;
}

const MIMES_IMAGEM = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Extrai a nota de um PDF (DANFE) ou imagem (foto da nota) via Claude.
 * @param arquivo_b64 base64 PURO (sem prefixo data:)
 */
export async function extrairNotaFiscal(input: {
  arquivo_b64: string;
  mimetype: string;
}): Promise<NotaOcrResult> {
  const mime = input.mimetype.toLowerCase();
  const ehPdf = mime === 'application/pdf';
  if (!ehPdf && !MIMES_IMAGEM.includes(mime)) {
    throw new Error(`Mimetype nao suportado para extracao: ${mime}. Use PDF, JPG, PNG ou WEBP.`);
  }

  const blocoArquivo = ehPdf
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: input.arquivo_b64 },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: (mime === 'image/jpg' ? 'image/jpeg' : mime) as 'image/jpeg' | 'image/png' | 'image/webp',
          data: input.arquivo_b64,
        },
      };

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    temperature: 0.1,
    messages: [{ role: 'user', content: [blocoArquivo, { type: 'text', text: PROMPT }] }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('IA nao retornou texto');
  const raw = textBlock.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[nota-ocr] sem JSON na resposta:', raw.slice(0, 200));
    throw new Error('Extracao sem JSON. Tente arquivo/foto mais nitida.');
  }
  let parsed: NotaOcrResult;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`JSON invalido da extracao: ${(err as Error).message}`);
  }
  if (parsed.erro) throw new Error(parsed.erro);
  parsed.itens = (parsed.itens ?? []).filter(i => i.descricao && Number(i.quantidade) > 0);
  if (!parsed.itens.length) throw new Error('Nenhum item legivel na nota. Revise/lance manualmente.');
  return parsed;
}
