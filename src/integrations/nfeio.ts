// v1.74.0 — Integração com NFe.io para emissão de NFS-e.
//
// Documentação oficial: https://nfe.io/docs/desenvolvedores/rest-api/
// Auth: header Authorization com a api_key (sem "Bearer").
// Sandbox/Produção: ambiente é setado por flag na criação da empresa,
// nao em URLs separadas.
//
// Fluxo basico:
//   1) POST /v2/companies         -> cria/atualiza empresa (CNPJ + IM + cert)
//   2) POST /v2/companies/:id/serviceinvoices -> emite NFS-e
//   3) Webhook recebe atualizacao quando prefeitura processa (~5-30s)
//   4) GET /v2/companies/:id/serviceinvoices/:nfId -> fallback consulta
//   5) POST .../cancel -> cancela
//
// Documentos importantes:
//   - cityServiceCode: codigo do servico na prefeitura (ex: 7.01 ou 1.01)
//   - federalServiceCode: codigo LC 116 (ex: "01.01")
//   - rpsSerialNumber + rpsNumber: nosso numero interno (Recibo Provisorio)

import axios, { AxiosError } from 'axios';

const BASE = 'https://api.nfe.io/v2';
const TIMEOUT = 30_000;

export interface NfeioCompany {
  id: string;
  name: string;
  federalTaxNumber: string;
  email?: string;
  status?: string;
  webhook?: string;
  enabled?: boolean;
}

export interface NfeioServiceInvoiceInput {
  cityServiceCode: string;
  federalServiceCode?: string;
  description: string;
  servicesAmount: number;
  rpsSerialNumber: string;
  rpsNumber: string;
  issRate?: number;
  issTaxAmount?: number;
  approximateTax?: number;
  borrower: {
    federalTaxNumber: string;
    name: string;
    email?: string;
    address: {
      country?: string;
      postalCode: string;
      street: string;
      number: string;
      additionalInformation?: string;
      district: string;
      city: { code?: string; name: string };
      state: string;
    };
  };
}

export interface NfeioServiceInvoice {
  id: string;
  status:
    | 'WaitingDefineRpsNumber'
    | 'WaitingSend'
    | 'WaitingSendCancel'
    | 'WaitingReturn'
    | 'WaitingDownload'
    | 'Issued'
    | 'Cancelled'
    | 'Error';
  rpsNumber?: string;
  number?: string;
  flowMessage?: string;
  flowStatus?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  checkCode?: string;
  issuedOn?: string;
  cancelledOn?: string;
}

class NfeioClient {
  constructor(
    private apiKey: string,
    private baseUrl: string = BASE,
  ) {
    if (!apiKey) throw new Error('NFe.io api_key obrigatoria');
  }

  private headers() {
    return {
      Authorization: this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /** Cria ou retorna empresa existente pelo CNPJ. */
  async upsertCompany(input: {
    name: string;
    federalTaxNumber: string;
    email?: string;
    municipalTaxNumber?: string;
    webhook?: string;
    address: NfeioServiceInvoiceInput['borrower']['address'];
    fiscalStatus?: 'Activated' | 'Deactivated';
    issRateLowering?: number;
  }): Promise<NfeioCompany> {
    try {
      const r = await axios.post<{ companies: NfeioCompany }>(
        `${this.baseUrl}/companies`,
        input,
        { headers: this.headers(), timeout: TIMEOUT },
      );
      return r.data.companies;
    } catch (err) {
      throw this.mapError('upsertCompany', err as AxiosError);
    }
  }

  async getCompany(companyId: string): Promise<NfeioCompany> {
    try {
      const r = await axios.get<{ companies: NfeioCompany }>(
        `${this.baseUrl}/companies/${companyId}`,
        { headers: this.headers(), timeout: TIMEOUT },
      );
      return r.data.companies;
    } catch (err) {
      throw this.mapError('getCompany', err as AxiosError);
    }
  }

  async emitirNFSe(companyId: string, payload: NfeioServiceInvoiceInput): Promise<NfeioServiceInvoice> {
    try {
      const r = await axios.post<{ serviceInvoice: NfeioServiceInvoice }>(
        `${this.baseUrl}/companies/${companyId}/serviceinvoices`,
        payload,
        { headers: this.headers(), timeout: TIMEOUT },
      );
      return r.data.serviceInvoice;
    } catch (err) {
      throw this.mapError('emitirNFSe', err as AxiosError);
    }
  }

  async consultarNFSe(companyId: string, nfId: string): Promise<NfeioServiceInvoice> {
    try {
      const r = await axios.get<{ serviceInvoice: NfeioServiceInvoice }>(
        `${this.baseUrl}/companies/${companyId}/serviceinvoices/${nfId}`,
        { headers: this.headers(), timeout: TIMEOUT },
      );
      return r.data.serviceInvoice;
    } catch (err) {
      throw this.mapError('consultarNFSe', err as AxiosError);
    }
  }

  async cancelarNFSe(companyId: string, nfId: string, motivo: string): Promise<NfeioServiceInvoice> {
    try {
      const r = await axios.delete<{ serviceInvoice: NfeioServiceInvoice }>(
        `${this.baseUrl}/companies/${companyId}/serviceinvoices/${nfId}`,
        {
          headers: this.headers(),
          timeout: TIMEOUT,
          data: { reason: motivo },
        },
      );
      return r.data.serviceInvoice;
    } catch (err) {
      throw this.mapError('cancelarNFSe', err as AxiosError);
    }
  }

  private mapError(op: string, err: AxiosError): Error {
    const status = err.response?.status;
    const data = err.response?.data as Record<string, unknown> | undefined;
    const msg = (data?.message as string)
      || (data?.error as string)
      || err.message;
    const wrapped = new Error(`[NFe.io ${op}] HTTP ${status || '?'}: ${msg}`);
    return wrapped;
  }
}

/** Factory: cria client a partir da apiKey do tenant. */
export function nfeioClient(apiKey: string): NfeioClient {
  return new NfeioClient(apiKey);
}

export type { NfeioClient };
