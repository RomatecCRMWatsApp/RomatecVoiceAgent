// v3.142.0 — Leitura do recibo público da InfinitePay
// (https://recibo.infinitepay.io/statements/<token>).
//
// O parser trabalha sobre o TEXTO da página (tags viram quebra de linha) e não
// sobre classes CSS — a marcação muda, os rótulos ("Origem", "Destino", "Nome",
// "CPF", "ID"…) não. Se a página vier como app Next.js com os dados só no
// __NEXT_DATA__, o JSON é varrido também (fallback por nome de chave).
//
// Página "Comprovante não encontrado" = link cortado no WhatsApp → erro
// RECIBO_NAO_ENCONTRADO (regra: pedir o link de novo, não dar baixa).
import { PaErro } from './erros';
import { centavos } from './regrasFinanceiras';

export interface ReciboInfinitePay {
  valor: number;
  pago_em: string | null; // 'aaaa-mm-dd hh:mm:ss' (horário de Brasília)
  status: string | null;
  origem: { nome: string | null; cpf: string | null; instituicao: string | null };
  destino: { nome: string | null; cnpj: string | null; chave: string | null };
  id_transacao: string | null;
}

const MESES: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', bull: '•', middot: '·',
};

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** HTML → linhas de texto não vazias (scripts/estilos descartados). */
export function htmlParaLinhas(html: string): string[] {
  const semScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');
  return decodificar(semScript.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '\n'))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function valorBrl(txt: string): number | null {
  const m = txt.match(/R\$\s*(-?[\d.]+,\d{2})/);
  if (!m) return null;
  return centavos(Number(m[1].replace(/\./g, '').replace(',', '.')));
}

/** "10 Out, 2026 • 14:03" / "10 de out. de 2026 às 14:03:10" → 'aaaa-mm-dd hh:mm:ss'. */
export function dataRecibo(txt: string): string | null {
  const m = txt.match(
    /(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?,?\s*(?:de\s+)?(\d{4})(?:\s*(?:[•·|\-]|às|as)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i,
  );
  if (m) {
    const mes = MESES[m[2].toLowerCase()];
    return `${m[3]}-${mes}-${m[1].padStart(2, '0')} ${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
  }
  const n = txt.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (n) return `${n[3]}-${n[2]}-${n[1]} ${(n[4] ?? '00').padStart(2, '0')}:${n[5] ?? '00'}:${n[6] ?? '00'}`;
  return null;
}

/** Valor de um rótulo: "Nome: Fulano" na mesma linha ou "Nome" + linha seguinte. */
function campo(linhas: string[], rotulos: RegExp): string | null {
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const mesma = l.match(new RegExp(`^(?:${rotulos.source})\\s*[:\\-]\\s*(.+)$`, 'i'));
    if (mesma) return mesma[1].trim();
    if (new RegExp(`^(?:${rotulos.source})\\s*:?$`, 'i').test(l) && linhas[i + 1]) return linhas[i + 1].trim();
  }
  return null;
}

function secao(linhas: string[], inicio: RegExp, fim: RegExp | null): string[] {
  const i = linhas.findIndex((l) => inicio.test(l));
  if (i < 0) return [];
  const resto = linhas.slice(i + 1);
  const j = fim ? resto.findIndex((l) => fim.test(l)) : -1;
  return j < 0 ? resto : resto.slice(0, j);
}

const RE_E2E = /\bE[0-9A-Za-z]{31}\b/;
const RE_NAO_ENCONTRADO = /comprovante\s+n[ãa]o\s+encontrado/i;

/** Varre um JSON (ex.: __NEXT_DATA__) atrás do primeiro valor de uma das chaves. */
function buscarChave(obj: unknown, chaves: string[], prof = 0): unknown {
  if (obj == null || typeof obj !== 'object' || prof > 12) return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (chaves.includes(k.toLowerCase()) && v != null && typeof v !== 'object') return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = buscarChave(v, chaves, prof + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function textoOuNull(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
}

export function parseReciboHtml(html: string): ReciboInfinitePay {
  if (RE_NAO_ENCONTRADO.test(html)) {
    throw new PaErro('RECIBO_NAO_ENCONTRADO', 'Comprovante não encontrado — o link provavelmente veio cortado. Peça o link completo de novo.', 404);
  }
  const linhas = htmlParaLinhas(html);
  const texto = linhas.join('\n');

  const origem = secao(linhas, /^(origem|de|pagador|quem pagou)$/i, /^(destino|para|recebedor|quem recebeu)$/i);
  const destino = secao(linhas, /^(destino|para|recebedor|quem recebeu)$/i, /^(id|id da transa[çc][ãa]o|identificador|autentica[çc][ãa]o)\b/i);

  let valor = valorBrl(texto);
  let pagoEm = dataRecibo(texto);
  let idTx = campo(linhas, /id(?: da transa[çc][ãa]o)?|id\s*e2e|end\s*to\s*end|identificador/)?.replace(/\s+/g, '') ?? null;
  if (!idTx || !/^[A-Za-z0-9]{20,}$/.test(idTx)) idTx = texto.match(RE_E2E)?.[0] ?? idTx;

  const r: ReciboInfinitePay = {
    valor: valor ?? 0,
    pago_em: pagoEm,
    status: linhas.find((l) => /^(pix\s+)?(aprovad|conclu[íi]d|realizad|efetuad|pago|enviado|recebido)/i.test(l)) ?? null,
    origem: {
      nome: campo(origem, /nome/),
      cpf: campo(origem, /cpf|cpf\/cnpj|documento/),
      instituicao: campo(origem, /institui[çc][ãa]o|banco/),
    },
    destino: {
      nome: campo(destino, /nome/),
      cnpj: campo(destino, /cnpj|cpf\/cnpj|documento/),
      chave: campo(destino, /chave(?: pix)?/),
    },
    id_transacao: idTx,
  };

  // Fallback: página que só traz os dados no JSON do Next.js.
  const nd = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nd && (!valor || !r.id_transacao || !r.origem.nome)) {
    try {
      const json = JSON.parse(nd[1]) as unknown;
      if (!valor) {
        const v = buscarChave(json, ['amount', 'valor', 'value', 'total']);
        const num = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
        // amount inteiro grande = centavos (padrão de gateway)
        if (Number.isFinite(num) && num > 0) r.valor = centavos(Number.isInteger(num) && num >= 1000 && !String(v).includes('.') ? num / 100 : num);
      }
      if (!r.id_transacao) r.id_transacao = textoOuNull(buscarChave(json, ['end_to_end_id', 'endtoendid', 'e2e_id', 'e2eid', 'transaction_id']));
      if (!pagoEm) {
        const d = textoOuNull(buscarChave(json, ['created_at', 'paid_at', 'date', 'datetime']));
        if (d && /^\d{4}-\d{2}-\d{2}T/.test(d)) {
          const dt = new Date(d);
          // ISO UTC → horário de Brasília (UTC-3, sem horário de verão desde 2019)
          pagoEm = new Date(dt.getTime() - 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
          r.pago_em = pagoEm;
        }
      }
      if (!r.origem.nome) r.origem.nome = textoOuNull(buscarChave(json, ['payer_name', 'sender_name']));
      if (!r.destino.nome) r.destino.nome = textoOuNull(buscarChave(json, ['receiver_name', 'merchant_name', 'recipient_name']));
    } catch {
      /* JSON inválido — fica com o que o texto deu */
    }
  }

  if (!(r.valor > 0)) {
    throw new PaErro('RECIBO_ILEGIVEL', 'Não consegui ler o valor no recibo da InfinitePay. Lance o pagamento manualmente.', 422);
  }
  return r;
}

/** Destino tem que ser a ROMATEC (nome) ou a chave Pix do projeto. */
export function destinoEhRomatec(r: ReciboInfinitePay, chaveProjeto?: string | null): boolean {
  const nome = (r.destino.nome || '').toUpperCase();
  const chave = (r.destino.chave || '').trim().toLowerCase();
  if (/ROMATEC/.test(nome)) return true;
  if (chaveProjeto && chave && chave === chaveProjeto.trim().toLowerCase()) return true;
  return false;
}

export function validarUrlRecibo(url: string): URL {
  let u: URL;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new PaErro('URL_INVALIDA', 'Link de recibo inválido.', 400);
  }
  if (u.protocol !== 'https:' || u.hostname !== 'recibo.infinitepay.io' || !/^\/statements\/[A-Za-z0-9_\-]+/.test(u.pathname)) {
    throw new PaErro('URL_INVALIDA', 'O link precisa ser https://recibo.infinitepay.io/statements/…', 400);
  }
  return u;
}

type FetchFn = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;

/** GET do recibo (timeout 10 s, 2 retentativas em falha de rede/5xx) + parse. */
export async function parseRecibo(url: string, fetchFn: FetchFn = fetch as unknown as FetchFn): Promise<ReciboInfinitePay> {
  const u = validarUrlRecibo(url);
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const resp = await fetchFn(u.toString(), {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (ZAYRA Romatec)', Accept: 'text/html' },
      });
      const html = await resp.text();
      if (resp.status === 404 || RE_NAO_ENCONTRADO.test(html)) {
        throw new PaErro('RECIBO_NAO_ENCONTRADO', 'Comprovante não encontrado — o link provavelmente veio cortado. Peça o link completo de novo.', 404);
      }
      if (resp.status >= 500) throw new Error(`InfinitePay respondeu ${resp.status}`);
      if (resp.status >= 400) throw new PaErro('RECIBO_INDISPONIVEL', `InfinitePay respondeu ${resp.status}`, 502);
      return parseReciboHtml(html);
    } catch (err) {
      if (err instanceof PaErro) throw err;
      ultimoErro = err;
    } finally {
      clearTimeout(t);
    }
  }
  throw new PaErro('RECIBO_INDISPONIVEL', `Não consegui abrir o recibo da InfinitePay (${(ultimoErro as Error)?.message || 'falha de rede'}).`, 502);
}
