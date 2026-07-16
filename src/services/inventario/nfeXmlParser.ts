// v3.97.0 — Parser de XML de NFe (modelo 55) pro Inventário de Materiais.
//
// Determinístico e SEM dependência de lib XML — regex por tag, mesmo estilo do
// kmlParser (src/services/gnss/kmlParser.ts), padrão da casa. Extrai cabeçalho
// (nNF, chave, emitente, data, vNF) e os itens <det><prod> (cProd, xProd, uCom,
// qCom, vUnCom, vProd). Puro/testável: entrada string, saída struct.

export interface NfeItemParseado {
  descricao: string;
  codigo?: string;
  unidade: string;       // UN, M, M2, KG, SC... (normalizada, max 10 chars)
  quantidade: number;
  valor_unitario?: number;
  valor_total?: number;
}

export interface NfeParseada {
  numero_nota?: string;
  chave_acesso?: string;   // 44 dígitos
  fornecedor_nome?: string;
  fornecedor_cnpj?: string; // formatado 00.000.000/0000-00
  data_emissao?: string;    // YYYY-MM-DD
  valor_total?: number;
  itens: NfeItemParseado[];
}

/** Valor da primeira ocorrência de <tag>...</tag> dentro do bloco (sem atributos). */
function tagValue(bloco: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(bloco);
  if (!m) return undefined;
  const v = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
  return v || undefined;
}

function num(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** CNPJ com máscara a partir dos 14 dígitos. */
export function formatarCnpjNfe(v: string | undefined): string | undefined {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length !== 14) return v || undefined;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

/**
 * Parseia o XML de uma NFe (procNFe ou NFe "crua"). Retorna null quando o
 * conteúdo não parece uma NFe (sem <infNFe> nem itens <det>).
 */
export function parseNfeXml(xml: string): NfeParseada | null {
  const s = String(xml ?? '');
  if (!/<infNFe[\s>]/i.test(s)) return null;

  // Chave de acesso: atributo Id="NFe<44 dígitos>" do infNFe.
  const chaveM = /<infNFe[^>]*\bId\s*=\s*"NFe(\d{44})"/i.exec(s);
  const chave = chaveM ? chaveM[1] : undefined;

  // Cabeçalho
  const ideBloco = tagBloco(s, 'ide') ?? s;
  const emitBloco = tagBloco(s, 'emit') ?? '';
  const totalBloco = tagBloco(s, 'ICMSTot') ?? '';

  const numero = tagValue(ideBloco, 'nNF');
  // dhEmi (NFe 4.0: 2024-08-15T10:30:00-03:00) ou dEmi (layouts antigos: 2014-08-15)
  const dhEmi = tagValue(ideBloco, 'dhEmi') ?? tagValue(ideBloco, 'dEmi');
  const dataEmissao = dhEmi ? dhEmi.slice(0, 10) : undefined;

  const fornecedorNome = tagValue(emitBloco, 'xNome');
  const fornecedorCnpj = formatarCnpjNfe(tagValue(emitBloco, 'CNPJ'));
  const valorTotal = num(tagValue(totalBloco, 'vNF'));

  // Itens <det> → <prod>
  const itens: NfeItemParseado[] = [];
  const detRe = /<det[\s>][\s\S]*?<\/det>/gi;
  let dm: RegExpExecArray | null;
  while ((dm = detRe.exec(s))) {
    const det = dm[0];
    const prod = tagBloco(det, 'prod') ?? det;
    const descricao = tagValue(prod, 'xProd');
    const quantidade = num(tagValue(prod, 'qCom'));
    if (!descricao || quantidade == null || quantidade <= 0) continue;
    const unidade = (tagValue(prod, 'uCom') || 'UN').toUpperCase().slice(0, 10);
    itens.push({
      descricao: descricao.slice(0, 300),
      codigo: tagValue(prod, 'cProd')?.slice(0, 60),
      unidade,
      quantidade,
      valor_unitario: num(tagValue(prod, 'vUnCom')),
      valor_total: num(tagValue(prod, 'vProd')),
    });
  }

  if (itens.length === 0) return null;

  return {
    numero_nota: numero,
    chave_acesso: chave,
    fornecedor_nome: fornecedorNome?.slice(0, 200),
    fornecedor_cnpj: fornecedorCnpj,
    data_emissao: dataEmissao,
    valor_total: valorTotal,
    itens,
  };
}

/** Bloco completo <tag>...</tag> (primeira ocorrência). */
function tagBloco(s: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'i').exec(s);
  return m ? m[0] : undefined;
}
