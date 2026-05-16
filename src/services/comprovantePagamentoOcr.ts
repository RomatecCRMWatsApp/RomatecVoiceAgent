// v3.11.0 — Extracao de dados de comprovante de pagamento (PIX, TED, etc).
// Aceita JPG, PNG, WEBP, GIF e PDF. Usa Claude Vision (paridade com cupomOcr.ts).
//
// Retorna struct com:
//   - valor          (R$ pago)
//   - emitente       (nome de quem pagou)
//   - destinatario   (nome de quem recebeu)
//   - id_transacao   (E2E ID do PIX, codigo de autenticacao, NSU, etc)
//   - banco_emitente / banco_destinatario
//   - data_pagamento
//   - tipo           (pix, ted, doc, boleto, transferencia, outro)
//   - confianca      (alta, media, baixa)

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

const PROMPT = `Voce e um extrator de dados de comprovante de pagamento brasileiro (PIX, TED, DOC, transferencia, boleto pago, recibo bancario).
Analise a imagem/PDF e devolva APENAS JSON puro (sem markdown, sem prosa) com a estrutura:

{
  "tipo": "pix" | "ted" | "doc" | "boleto" | "transferencia" | "outro",
  "valor": 999.99,
  "data_pagamento": "YYYY-MM-DD" | null,
  "hora_pagamento": "HH:MM" | null,
  "emitente": {
    "nome": "NOME COMPLETO DE QUEM PAGOU (max 150 chars)",
    "documento": "CPF/CNPJ formatado ou null",
    "banco": "BANCO DA ORIGEM ou null",
    "agencia": "agencia ou null",
    "conta": "conta ou null"
  },
  "destinatario": {
    "nome": "NOME COMPLETO DE QUEM RECEBEU (max 150 chars)",
    "documento": "CPF/CNPJ formatado ou null",
    "banco": "BANCO DESTINO ou null",
    "agencia": "agencia ou null",
    "conta": "conta ou null",
    "chave_pix": "chave PIX usada (se PIX) ou null",
    "tipo_chave_pix": "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | null
  },
  "id_transacao": "ID de autenticacao do comprovante (E2E ID do PIX, codigo autenticacao, NSU, ID end-to-end). Ex: E12345678202405161430123456789012",
  "observacoes": "qualquer detalhe relevante (descricao da transferencia, finalidade) ou null",
  "confianca": "alta" | "media" | "baixa"
}

REGRAS CRITICAS:
- Se nao for comprovante de pagamento bancario, retorne { "erro": "imagem nao parece comprovante de pagamento" }.
- Valores: numero decimal com 2 casas (1234.56 nao "1.234,56").
- id_transacao: campo MAIS IMPORTANTE — busca por "ID Transacao", "Autenticacao", "Codigo de Autenticacao", "E2E ID", "ID End-to-End", "NSU", "Numero de Controle". Geralmente uma string alfanumerica longa.
- emitente/destinatario: olha por "Pagador"/"Recebedor", "Origem"/"Destino", "De"/"Para".
- Se for boleto pago: emitente = quem pagou, destinatario = beneficiario do boleto.
- NAO ALUCINE valores. Se nao consegue ler algum campo, retorne null pra ele, NAO invente.
- confianca: "alta" se tudo legivel; "media" se 1-2 campos borrados; "baixa" se a maioria dos campos esta dificil.

Responda APENAS com o JSON, sem nenhum texto antes ou depois.`;

export interface ComprovanteExtraido {
  tipo?: 'pix' | 'ted' | 'doc' | 'boleto' | 'transferencia' | 'outro';
  valor?: number;
  data_pagamento?: string | null;
  hora_pagamento?: string | null;
  emitente?: {
    nome?: string;
    documento?: string | null;
    banco?: string | null;
    agencia?: string | null;
    conta?: string | null;
  };
  destinatario?: {
    nome?: string;
    documento?: string | null;
    banco?: string | null;
    agencia?: string | null;
    conta?: string | null;
    chave_pix?: string | null;
    tipo_chave_pix?: string | null;
  };
  id_transacao?: string | null;
  observacoes?: string | null;
  confianca?: 'alta' | 'media' | 'baixa';
  erro?: string;
}

export async function extrairComprovantePagamento(
  fileBase64: string,
  mimeType: string,
): Promise<ComprovanteExtraido> {
  // Claude Vision aceita image/jpeg, image/png, image/gif, image/webp, application/pdf
  const supportedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  if (!supportedMimes.includes(mimeType)) {
    throw new Error(`MIME nao suportado: ${mimeType}. Use JPG, PNG, GIF, WEBP ou PDF.`);
  }

  const isPdf = mimeType === 'application/pdf';

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        {
          type: isPdf ? 'document' : 'image',
          source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf', data: fileBase64 },
        } as Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam,
        { type: 'text', text: PROMPT },
      ],
    }],
  });

  const block = resp.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('Resposta do Claude sem texto.');
  }
  const raw = block.text.trim();

  // Tenta extrair JSON (Claude as vezes envolve em ```json ... ```)
  let jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[comprovante-ocr] sem JSON na resposta:', raw.slice(0, 200));
    throw new Error('Resposta do OCR sem JSON valido.');
  }
  try {
    return JSON.parse(jsonMatch[0]) as ComprovanteExtraido;
  } catch (err) {
    console.error('[comprovante-ocr] JSON invalido:', jsonMatch[0].slice(0, 200));
    throw new Error('JSON do OCR malformado: ' + (err as Error).message);
  }
}
