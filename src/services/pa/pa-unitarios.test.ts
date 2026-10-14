// v3.142.0 — Testes unitários do módulo PA (sem banco): CPF, telefone, BR Code,
// regras financeiras, LGPD e parser InfinitePay (fixtures sintéticas).
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  cpfValido, formatarCpf, mascararCpf, cpfParcialConfere, normalizarTelefone, dataBrParaIso, dataHoraBrParaSql,
} from './validadores';
import { gerarPixCopiaECola, crc16 } from './pixBrCode';
import { planoPagamento, ratearAutomatico, statusEfetivo, statusAposRecebimento, vencimentoMensal } from './regrasFinanceiras';
import { perfilPorRole, filtrarPorPerfil, podeEscrever, podeVerDocumentos } from './lgpd';
import { parseReciboHtml, parseRecibo, destinoEhRomatec, validarUrlRecibo } from './infinitepay';
import { PaErro } from './erros';

const fx = (n: string) => readFileSync(path.join(__dirname, '__fixtures__', n), 'utf8');

describe('CPF', () => {
  it('valida dígitos verificadores', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('123')).toBe(false);
    expect(cpfValido(null)).toBe(false);
  });
  it('formata e mascara (6 dígitos centrais)', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
    expect(mascararCpf('529.982.247-25')).toBe('***.982.247-**');
    expect(mascararCpf(null)).toBeNull();
  });
  it('confere CPF parcial do comprovante (dígitos 4–9)', () => {
    expect(cpfParcialConfere('529.982.247-25', '***.982.247-**')).toBe(true);
    expect(cpfParcialConfere('529.982.247-25', '***982247**')).toBe(true);
    expect(cpfParcialConfere('529.982.247-25', '***.189.983-**')).toBe(false);
    expect(cpfParcialConfere('529.982.247-25', '***.***.***-**')).toBeNull();
  });
});

describe('telefone E.164', () => {
  it('normaliza celular com DDD', () => {
    expect(normalizarTelefone('(99) 9 9154-6099')).toEqual({ e164: '+5599991546099', avisos: [] });
    expect(normalizarTelefone('+55 99 99154-6099').e164).toBe('+5599991546099');
  });
  it('avisa sem bloquear', () => {
    expect(normalizarTelefone('(99) 55667-3942').avisos.join()).toMatch(/não começa com 9/);
    expect(normalizarTelefone('(65) 9 9270-3619')).toEqual({ e164: '+5565992703619', avisos: [] }); // outro estado: aceito sem aviso
    expect(normalizarTelefone('(20) 9 8888-7777').avisos.join()).toMatch(/DDD 20 não existe/);
    const dois = normalizarTelefone('(99) 9 9232-7068 / (99) 9 9193-4972');
    expect(dois.e164).toBe('+5599992327068');
    expect(dois.avisos.join()).toMatch(/2 telefones/);
    expect(normalizarTelefone('A INFORMAR').e164).toBeNull();
    expect(normalizarTelefone('(99) 9154-609').e164).toBeNull();
  });
});

describe('datas BR', () => {
  it('converte dd/mm/aaaa e data/hora do comprovante', () => {
    expect(dataBrParaIso('24/08/1978')).toBe('1978-08-24');
    expect(dataBrParaIso('31/02/2026')).toBeNull();
    expect(dataBrParaIso('A INFORMAR')).toBeNull();
    expect(dataHoraBrParaSql('10/10/2026 às 17:45:03 (BRT)')).toBe('2026-10-10 17:45:03');
    expect(dataHoraBrParaSql('10/10/2026 às 20:35')).toBe('2026-10-10 20:35:00');
    expect(dataHoraBrParaSql('10/10/2026')).toBe('2026-10-10 00:00:00');
  });
});

describe('Pix BR Code', () => {
  it('chave atual sem valor → CRC 7A1E (critério de aceite)', () => {
    const code = gerarPixCopiaECola({ chave: 'romatec-consultoria-256@jim.com', favorecido: 'ROMATEC CONSULTORIA TOTAL', cidade: 'ACAILANDIA' });
    expect(code).toBe('00020126530014br.gov.bcb.pix0131romatec-consultoria-256@jim.com5204000053039865802BR5925ROMATEC CONSULTORIA TOTAL6010ACAILANDIA62070503***63047A1E');
    expect(code.endsWith('63047A1E')).toBe(true);
  });
  it('com valor (campo 54) e CRC consistente', () => {
    const code = gerarPixCopiaECola({ chave: 'romatec-consultoria-256@jim.com', favorecido: 'Romatec Consultoria Total', cidade: 'Açailândia', valor: 350 });
    expect(code).toContain('5406350.00');
    expect(code).toContain('6010ACAILANDIA');
    expect(crc16(code.slice(0, -4))).toBe(code.slice(-4));
  });
  it('exige chave', () => {
    expect(() => gerarPixCopiaECola({ chave: '', favorecido: 'X', cidade: 'Y' })).toThrow();
  });
});

describe('regras financeiras', () => {
  const proj = { valor_lote: 1000, sinal_padrao: 300, boleto_padrao: 350, prazo_sinal: '2026-10-13' };
  const valores = (s: number) => planoPagamento(proj, s, 10, '2026-10-10').map((p) => `${p.tipo}${p.parcela || ''}=${p.valor}`);
  it('sinal padrão → 2×350', () => expect(valores(300)).toEqual(['SINAL=300', 'BOLETO1=350', 'BOLETO2=350']));
  it('400 → 2×300; 350 → 2×325', () => {
    expect(valores(400)).toEqual(['SINAL=400', 'BOLETO1=300', 'BOLETO2=300']);
    expect(valores(350)).toEqual(['SINAL=350', 'BOLETO1=325', 'BOLETO2=325']);
  });
  it('entrada ≥ 500 → parcela única (500→1×500; 650→1×350)', () => {
    expect(valores(500)).toEqual(['SINAL=500', 'BOLETO1=500']);
    expect(valores(650)).toEqual(['SINAL=650', 'BOLETO1=350']);
  });
  it('à vista', () => expect(valores(1000)).toEqual(['AVISTA=1000']));
  it('parcelas ímpares somam o saldo exato', () => {
    const p = planoPagamento(proj, 333.33, 10, '2026-10-10');
    expect(p[1].valor + p[2].valor).toBeCloseTo(666.67, 2);
  });
  it('vencimento no dia fixo, com clamp de fim de mês', () => {
    expect(vencimentoMensal('2026-10-10', 1, 10)).toBe('2026-11-10');
    expect(vencimentoMensal('2027-01-15', 1, 31)).toBe('2027-02-28');
  });
  it('status: pago, parcial e vencido calculado na leitura', () => {
    expect(statusAposRecebimento(300, 300, 'A_PAGAR')).toBe('PAGO');
    expect(statusAposRecebimento(300, 200, 'A_PAGAR')).toBe('PARCIAL');
    const l = { tipo: 'BOLETO' as const, valor: 350, valor_recebido: 0, status: 'A_VENCER' as const, vencimento: '2026-11-10' };
    expect(statusEfetivo(l, '2026-11-09')).toBe('A_VENCER');
    expect(statusEfetivo(l, '2026-11-11')).toBe('VENCIDO');
  });
  it('rateio automático quita em ordem', () => {
    expect(ratearAutomatico(500, [{ id: 1, saldo: 100 }, { id: 2, saldo: 350 }, { id: 3, saldo: 350 }]))
      .toEqual([{ lancamento_id: 1, valor: 100 }, { lancamento_id: 2, valor: 350 }, { lancamento_id: 3, valor: 50 }]);
  });
});

describe('LGPD', () => {
  it('mapeia role → perfil', () => {
    expect(perfilPorRole('owner')).toBe('ADMIN');
    expect(perfilPorRole('admin')).toBe('ADMIN');
    expect(perfilPorRole('financeiro')).toBe('OPERADOR');
    expect(perfilPorRole('viewer')).toBe('DIRECAO_ASSOCIACAO');
    expect(podeEscrever('DIRECAO_ASSOCIACAO')).toBe(false);
    expect(podeVerDocumentos('DIRECAO_ASSOCIACAO')).toBe(false);
  });
  it('Direção não vê CPF completo nem RG (CIN = CPF)', () => {
    const a = { nome: 'X', cpf: '529.982.247-25', conjuge_cpf: '529.982.247-25', rg: '529.982.247-25 SSP/MA (CIN)', telefone: '+5599' };
    const v = filtrarPorPerfil(a, 'DIRECAO_ASSOCIACAO');
    expect(v.cpf).toBe('***.982.247-**');
    expect(v.conjuge_cpf).toBe('***.982.247-**');
    expect(v.rg).toBeNull();
    expect(JSON.stringify(v)).not.toContain('529.982.247-25');
    expect(filtrarPorPerfil(a, 'OPERADOR').cpf).toBe('529.982.247-25');
  });
});

describe('InfinitePay — parser (fixtures sintéticas)', () => {
  it('recibo em HTML com rótulos', () => {
    const r = parseReciboHtml(fx('recibo-infinitepay-ok.html'));
    expect(r.valor).toBe(300);
    expect(r.pago_em).toBe('2026-10-10 14:03:00');
    expect(r.status).toMatch(/enviado/i);
    expect(r.origem).toEqual({ nome: 'MARIA TESTE DA SILVA', cpf: '***.189.983-**', instituicao: 'NU PAGAMENTOS - IP' });
    expect(r.destino.nome).toBe('ROMATEC CONSULTORIA TOTAL');
    expect(r.destino.chave).toBe('romatec-consultoria-256@jim.com');
    expect(r.id_transacao).toBe('E18236120202610101703s0aa11bb22c');
    expect(destinoEhRomatec(r)).toBe(true);
  });
  it('página Next.js com dados no __NEXT_DATA__', () => {
    const r = parseReciboHtml(fx('recibo-infinitepay-nextdata.html'));
    expect(r.valor).toBe(650);
    expect(r.id_transacao).toBe('E00360305202610111555a1b2c3d4e5f');
    expect(r.pago_em).toBe('2026-10-11 12:55:10');
    expect(r.origem.nome).toBe('JOAO EXEMPLO PEREIRA');
    expect(r.origem.cpf).toBe('***456789**');
  });
  it('link cortado → RECIBO_NAO_ENCONTRADO', () => {
    expect(() => parseReciboHtml(fx('recibo-infinitepay-nao-encontrado.html'))).toThrow(PaErro);
    try { parseReciboHtml(fx('recibo-infinitepay-nao-encontrado.html')); } catch (e) { expect((e as PaErro).codigo).toBe('RECIBO_NAO_ENCONTRADO'); }
  });
  it('destino que não é a Romatec é recusado', () => {
    const r = parseReciboHtml(fx('recibo-infinitepay-ok.html').replace(/ROMATEC CONSULTORIA TOTAL/g, 'OUTRA EMPRESA LTDA').replace('romatec-consultoria-256@jim.com', 'x@y.com'));
    expect(destinoEhRomatec(r, 'romatec-consultoria-256@jim.com')).toBe(false);
  });
  it('só aceita https://recibo.infinitepay.io/statements/…', () => {
    expect(() => validarUrlRecibo('https://evil.com/statements/abc')).toThrow(PaErro);
    expect(() => validarUrlRecibo('http://recibo.infinitepay.io/statements/abc')).toThrow(PaErro);
    expect(validarUrlRecibo('https://recibo.infinitepay.io/statements/abc123').hostname).toBe('recibo.infinitepay.io');
  });
  it('fetch: 404 vira RECIBO_NAO_ENCONTRADO; 5xx tenta de novo (2 retentativas)', async () => {
    const f404 = vi.fn().mockResolvedValue({ status: 404, text: async () => '' });
    await expect(parseRecibo('https://recibo.infinitepay.io/statements/abc', f404)).rejects.toMatchObject({ codigo: 'RECIBO_NAO_ENCONTRADO' });
    expect(f404).toHaveBeenCalledTimes(1);

    const ok = fx('recibo-infinitepay-ok.html');
    const fRetry = vi.fn()
      .mockResolvedValueOnce({ status: 503, text: async () => '' })
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ status: 200, text: async () => ok });
    const r = await parseRecibo('https://recibo.infinitepay.io/statements/abc', fRetry);
    expect(r.valor).toBe(300);
    expect(fRetry).toHaveBeenCalledTimes(3);

    const fDown = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(parseRecibo('https://recibo.infinitepay.io/statements/abc', fDown)).rejects.toMatchObject({ codigo: 'RECIBO_INDISPONIVEL' });
    expect(fDown).toHaveBeenCalledTimes(3);
  });
});
