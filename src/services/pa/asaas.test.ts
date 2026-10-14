// v3.143.0 — Asaas (payloads, ambiente, erros) e variantes de número do WhatsApp. Sem rede.
import { describe, it, expect, vi } from 'vitest';
import {
  configAsaas, payloadCliente, payloadCobranca, vencimentoBoleto, statusLocal, asaasReq, buscarOuCriarCliente,
} from './asaas';
import { variantesNumero } from './paWhatsapp';

const proj = { nome: 'Projeto de Assentamento Salete Moreno', municipio: 'Açailândia', cep_padrao: '65930000', boleto_multa_pct: 2, boleto_juros_mes_pct: 1 };
const assoc = { nome: 'FULANA TESTE', cpf: '529.982.247-25', telefone_e164: '+5599991546099', email: 'fulana@teste.com', lote: '40', denominacao_terra: 'Chácara Boa Vista', associado_id: 7 };
const resp = (status: number, body: unknown) => ({ status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

describe('configuração', () => {
  it('sem chave → null; ambiente pelo prefixo ou pela env', () => {
    expect(configAsaas({})).toBeNull();
    expect(configAsaas({ ASAAS_API_KEY: '$aact_prod_abc' })).toMatchObject({ ambiente: 'producao', baseUrl: 'https://api.asaas.com/v3' });
    expect(configAsaas({ ASAAS_API_KEY: '$aact_hmlg_abc' })).toMatchObject({ ambiente: 'sandbox', baseUrl: 'https://api-sandbox.asaas.com/v3' });
    expect(configAsaas({ ASAAS_API_KEY: 'x', ASAAS_AMBIENTE: 'producao' })?.ambiente).toBe('producao');
  });
});

describe('payloads', () => {
  it('cliente: CPF/telefone só dígitos, CEP do projeto, sem notificação do Asaas', () => {
    const c = payloadCliente(assoc, proj);
    expect(c).toMatchObject({
      name: 'FULANA TESTE', cpfCnpj: '52998224725', mobilePhone: '99991546099', email: 'fulana@teste.com', postalCode: '65930000',
      addressNumber: 'S/N', province: 'Zona Rural', externalReference: 'pa-assoc-7', notificationDisabled: true,
    });
    expect(c.address).toContain('Lote 40');
  });
  it('cliente: e-mail inválido some; sem CEP é erro', () => {
    expect(payloadCliente({ ...assoc, email: 'naotem' }, proj).email).toBeUndefined();
    expect(() => payloadCliente(assoc, { ...proj, cep_padrao: null })).toThrow(/CEP/);
  });
  it('cobrança: boleto com multa/juros do projeto e referência da parcela', () => {
    expect(payloadCobranca({ customerId: 'cus_1', lancamentoId: 99, valor: 350, vencimento: '2026-11-10', descricao: 'Parcela 1/2', projeto: proj })).toEqual({
      customer: 'cus_1', billingType: 'BOLETO', value: 350, dueDate: '2026-11-10', description: 'Parcela 1/2',
      externalReference: 'pa-lanc-99', fine: { value: 2 }, interest: { value: 1 },
    });
    expect(() => payloadCobranca({ customerId: 'c', lancamentoId: 1, valor: 0, vencimento: '2026-11-10', descricao: 'x', projeto: proj })).toThrow();
  });
  it('vencimento passado vira hoje; status do Asaas → local', () => {
    expect(vencimentoBoleto('2026-11-10', '2026-10-13')).toBe('2026-11-10');
    expect(vencimentoBoleto('2026-10-01', '2026-10-13')).toBe('2026-10-13');
    expect(vencimentoBoleto(null, '2026-10-13')).toBe('2026-10-13');
    expect(statusLocal('RECEIVED')).toBe('PAGO');
    expect(statusLocal('CONFIRMED')).toBe('PAGO');
    expect(statusLocal('OVERDUE')).toBe('VENCIDO');
    expect(statusLocal('REFUNDED')).toBe('ESTORNADO');
    expect(statusLocal('PENDING')).toBe('PENDENTE');
  });
});

describe('cliente HTTP', () => {
  const cfg = { apiKey: '$aact_hmlg_x', baseUrl: 'https://api-sandbox.asaas.com/v3', ambiente: 'sandbox' as const };
  it('manda access_token e User-Agent; 400 vira ASAAS_RECUSOU com a descrição', async () => {
    const f = vi.fn().mockResolvedValue(resp(400, { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF informado é inválido.' }] }));
    await expect(asaasReq(cfg, 'POST', '/customers', {}, f)).rejects.toMatchObject({ codigo: 'ASAAS_RECUSOU', message: expect.stringContaining('CPF informado') });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api-sandbox.asaas.com/v3/customers');
    expect(init.headers.access_token).toBe('$aact_hmlg_x');
    expect(init.headers['User-Agent']).toBeTruthy();
  });
  it('401 = chave inválida; 500 tenta de novo', async () => {
    await expect(asaasReq(cfg, 'GET', '/x', undefined, vi.fn().mockResolvedValue(resp(401, {})))).rejects.toMatchObject({ codigo: 'ASAAS_CHAVE_INVALIDA' });
    const f = vi.fn().mockResolvedValueOnce(resp(500, {})).mockResolvedValueOnce(resp(200, { id: 'pay_1' }));
    await expect(asaasReq(cfg, 'GET', '/payments/pay_1', undefined, f)).resolves.toEqual({ id: 'pay_1' });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('reaproveita cliente existente pelo CPF (não duplica no Asaas)', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(200, { data: [{ id: 'cus_existente' }] }));
    await expect(buscarOuCriarCliente(cfg, payloadCliente(assoc, proj), f)).resolves.toBe('cus_existente');
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockResolvedValueOnce(resp(200, { data: [] })).mockResolvedValueOnce(resp(200, { id: 'cus_novo' }));
    await expect(buscarOuCriarCliente(cfg, payloadCliente(assoc, proj), g)).resolves.toBe('cus_novo');
    expect(g.mock.calls[1][1].method).toBe('POST');
  });
});

describe('WhatsApp — variantes do número', () => {
  it('celular com 9: tenta com e sem o 9 (contas antigas)', () => {
    expect(variantesNumero('+5599991546099')).toEqual(['5599991546099', '559991546099']);
    expect(variantesNumero('+559932221111')).toEqual(['559932221111']);
  });
});

describe('WhatsApp — código Pix em mensagem separada', () => {
  it('tira o copia-e-cola do texto e devolve à parte', async () => {
    const { separarCodigosPix } = await import('./paWhatsapp');
    const code = '00020126530014br.gov.bcb.pix0131romatec-consultoria-256@jim.com5204000053039865406700.005802BR5925ROMATEC CONSULTORIA TOTAL6010ACAILANDIA62070503***63040E35';
    const r = separarCodigosPix(`Olá!\nTotal: R$ 700,00\nPix copia e cola:\n${code}\nObrigada!`);
    expect(r.codigos).toEqual([code]);
    expect(r.principal).not.toContain('000201');
    expect(r.principal).toContain('na próxima mensagem');
    expect(r.principal).toContain('Obrigada!');
    expect(separarCodigosPix('sem pix aqui').codigos).toEqual([]);
  });
});
