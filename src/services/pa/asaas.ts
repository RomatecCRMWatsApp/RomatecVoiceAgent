// v3.143.0 — Cliente da API do Asaas (v3) para os boletos do módulo PA.
//
// Variáveis (Railway):
//   ASAAS_API_KEY        chave da conta ($aact_prod_… produção / $aact_hmlg_… sandbox)
//   ASAAS_AMBIENTE       'producao' | 'sandbox' (opcional — deduzido pelo prefixo da chave)
//   ASAAS_WEBHOOK_TOKEN  token configurado no webhook do Asaas (header asaas-access-token)
//   ASAAS_BASE_URL       opcional, sobrescreve a URL da API
//
// Os montadores de payload são puros (testados sem rede); o cliente HTTP recebe
// o fetch por parâmetro pra teste.
import { PaErro } from './erros';
import { soDigitos } from './validadores';
import { centavos } from './regrasFinanceiras';

export interface AsaasConfig { apiKey: string; baseUrl: string; ambiente: 'producao' | 'sandbox' }

export function configAsaas(env: NodeJS.ProcessEnv = process.env): AsaasConfig | null {
  const apiKey = (env.ASAAS_API_KEY || '').trim();
  if (!apiKey) return null;
  const amb = (env.ASAAS_AMBIENTE || '').toLowerCase();
  const ambiente: AsaasConfig['ambiente'] =
    amb === 'producao' || amb === 'production' ? 'producao'
      : amb === 'sandbox' ? 'sandbox'
        : apiKey.includes('_prod_') ? 'producao' : 'sandbox';
  const baseUrl = (env.ASAAS_BASE_URL || (ambiente === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3')).replace(/\/+$/, '');
  return { apiKey, baseUrl, ambiente };
}

export function exigirConfigAsaas(): AsaasConfig {
  const c = configAsaas();
  if (!c) throw new PaErro('ASAAS_NAO_CONFIGURADO', 'Asaas não configurado: defina ASAAS_API_KEY no Railway', 503);
  return c;
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** Chamada à API com timeout de 15 s e 1 retentativa em 429/5xx/rede. */
export async function asaasReq<T>(
  cfg: AsaasConfig, method: 'GET' | 'POST' | 'DELETE', caminho: string, body?: unknown,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<T> {
  let ultimo: unknown = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await fetchFn(`${cfg.baseUrl}${caminho}`, {
        method,
        headers: { access_token: cfg.apiKey, 'Content-Type': 'application/json', 'User-Agent': 'ZAYRA-Romatec/1.0' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const txt = await r.text();
      let json: unknown = null;
      try { json = txt ? JSON.parse(txt) : null; } catch { json = null; }
      if (r.status >= 200 && r.status < 300) return json as T;
      const desc = ((json as { errors?: Array<{ description?: string; code?: string }> } | null)?.errors ?? [])
        .map((e) => e.description || e.code).filter(Boolean).join('; ');
      if (r.status === 401) throw new PaErro('ASAAS_CHAVE_INVALIDA', 'Asaas recusou a chave de API (ASAAS_API_KEY)', 502);
      if (r.status === 404) throw new PaErro('ASAAS_NAO_ENCONTRADO', desc || 'Registro não encontrado no Asaas', 404);
      if (r.status === 429 || r.status >= 500) { ultimo = new Error(`Asaas HTTP ${r.status} ${desc}`); continue; }
      throw new PaErro('ASAAS_RECUSOU', `Asaas: ${desc || 'requisição recusada (HTTP ' + r.status + ')'}`, 422, json);
    } catch (err) {
      if (err instanceof PaErro) throw err;
      ultimo = err;
    } finally {
      clearTimeout(t);
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new PaErro('ASAAS_INDISPONIVEL', `Asaas indisponível (${(ultimo as Error)?.message || 'falha de rede'})`, 502);
}

// ─── Montadores puros ─────────────────────────────────────────────────────
export interface DadosClienteAsaas {
  nome: string; cpf: string; telefone_e164: string | null; email: string | null; lote: string | null;
  denominacao_terra: string | null; associado_id: number;
}
export interface DadosProjetoAsaas {
  nome: string; municipio: string; cep_padrao: string | null; boleto_multa_pct: number; boleto_juros_mes_pct: number;
}

export function payloadCliente(a: DadosClienteAsaas, p: DadosProjetoAsaas) {
  const cep = soDigitos(p.cep_padrao);
  if (cep.length !== 8) throw new PaErro('CEP_NAO_CONFIGURADO', 'Projeto sem CEP padrão (necessário para registrar o boleto)', 422);
  const tel = soDigitos(a.telefone_e164).replace(/^55/, '');
  const email = a.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a.email) ? a.email.trim() : undefined;
  return {
    name: a.nome.slice(0, 100),
    cpfCnpj: soDigitos(a.cpf),
    mobilePhone: tel.length === 11 ? tel : undefined,
    email,
    postalCode: cep,
    address: `${p.nome}${a.lote ? ', Lote ' + a.lote : ''}`.slice(0, 100),
    addressNumber: 'S/N',
    complement: a.denominacao_terra ? a.denominacao_terra.slice(0, 60) : undefined,
    province: 'Zona Rural',
    externalReference: `pa-assoc-${a.associado_id}`,
    // A ZAYRA faz a comunicação (WhatsApp); o Asaas não manda SMS/e-mail próprios.
    notificationDisabled: true,
  };
}

/** Vencimento do boleto: o da parcela, ou hoje se ela já venceu (o Asaas não aceita data passada). */
export function vencimentoBoleto(vencParcela: string | null, hojeIso: string): string {
  return vencParcela && vencParcela >= hojeIso ? vencParcela : hojeIso;
}

export function payloadCobranca(input: {
  customerId: string; lancamentoId: number; valor: number; vencimento: string; descricao: string; projeto: DadosProjetoAsaas;
}) {
  if (!(input.valor > 0)) throw new PaErro('SEM_SALDO', 'Parcela sem saldo para cobrar', 409);
  return {
    customer: input.customerId,
    billingType: 'BOLETO',
    value: centavos(input.valor),
    dueDate: input.vencimento,
    description: input.descricao.slice(0, 500),
    externalReference: `pa-lanc-${input.lancamentoId}`,
    fine: { value: input.projeto.boleto_multa_pct },
    interest: { value: input.projeto.boleto_juros_mes_pct },
  };
}

export type StatusBoleto = 'PENDENTE' | 'VENCIDO' | 'PAGO' | 'CANCELADO' | 'ESTORNADO';

/** Status de cobrança do Asaas → status local. */
export function statusLocal(statusAsaas: string | null | undefined): StatusBoleto {
  switch (String(statusAsaas || '').toUpperCase()) {
    case 'RECEIVED': case 'CONFIRMED': case 'RECEIVED_IN_CASH': return 'PAGO';
    case 'OVERDUE': return 'VENCIDO';
    case 'REFUNDED': case 'REFUND_REQUESTED': case 'CHARGEBACK_REQUESTED': case 'CHARGEBACK_DISPUTE': return 'ESTORNADO';
    case 'DELETED': return 'CANCELADO';
    default: return 'PENDENTE';
  }
}

// ─── Chamadas ─────────────────────────────────────────────────────────────
export interface AsaasCliente { id: string; cpfCnpj?: string; deleted?: boolean }
export interface AsaasCobranca {
  id: string; status: string; value: number; dueDate: string; bankSlipUrl?: string | null; invoiceUrl?: string | null;
  nossoNumero?: string | null; billingType?: string; externalReference?: string | null;
  paymentDate?: string | null; clientPaymentDate?: string | null; confirmedDate?: string | null;
}

export async function buscarOuCriarCliente(cfg: AsaasConfig, payload: ReturnType<typeof payloadCliente>, fetchFn?: FetchFn): Promise<string> {
  const lista = await asaasReq<{ data?: AsaasCliente[] }>(cfg, 'GET', `/customers?cpfCnpj=${payload.cpfCnpj}`, undefined, fetchFn);
  const existente = (lista?.data ?? []).find((c) => !c.deleted);
  if (existente) return existente.id;
  const novo = await asaasReq<AsaasCliente>(cfg, 'POST', '/customers', payload, fetchFn);
  return novo.id;
}

export async function criarCobranca(cfg: AsaasConfig, payload: ReturnType<typeof payloadCobranca>, fetchFn?: FetchFn) {
  return asaasReq<AsaasCobranca>(cfg, 'POST', '/payments', payload, fetchFn);
}

export async function linhaDigitavel(cfg: AsaasConfig, id: string, fetchFn?: FetchFn) {
  return asaasReq<{ identificationField?: string; nossoNumero?: string; barCode?: string }>(cfg, 'GET', `/payments/${encodeURIComponent(id)}/identificationField`, undefined, fetchFn);
}

export async function pixDaCobranca(cfg: AsaasConfig, id: string, fetchFn?: FetchFn) {
  return asaasReq<{ payload?: string; expirationDate?: string }>(cfg, 'GET', `/payments/${encodeURIComponent(id)}/pixQrCode`, undefined, fetchFn);
}

export async function cancelarCobranca(cfg: AsaasConfig, id: string, fetchFn?: FetchFn) {
  return asaasReq<{ deleted?: boolean }>(cfg, 'DELETE', `/payments/${encodeURIComponent(id)}`, undefined, fetchFn);
}

/** Agência/conta do beneficiário (campo "Agência / Código do beneficiário" do boleto). */
export async function numeroConta(cfg: AsaasConfig, fetchFn?: FetchFn) {
  return asaasReq<{ agency?: string; account?: string; accountDigit?: string }>(cfg, 'GET', '/myAccount/accountNumber', undefined, fetchFn);
}

export async function obterCobranca(cfg: AsaasConfig, id: string, fetchFn?: FetchFn) {
  return asaasReq<AsaasCobranca>(cfg, 'GET', `/payments/${encodeURIComponent(id)}`, undefined, fetchFn);
}
