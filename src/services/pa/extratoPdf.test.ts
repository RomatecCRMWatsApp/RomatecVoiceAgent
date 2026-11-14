import { describe, it, expect } from 'vitest';
import { filtrarExtrato, htmlExtrato, textoResumoExtrato, descreverFiltro } from './extratoPdf';

const item = (lote: string, nome: string, situacao: string, vencido: number, extra: Record<string, unknown> = {}) => ({
  associado_id: Number(lote), numero: `PASM-0${lote}`, nome, lote, telefone: '(99) 99999-0000', whatsapp_status: 'VALIDO',
  contratado: 1000, recebido: 300, em_aberto: 700, vencido, a_vencer: 700 - vencido, pct_pago: 30, situacao, ultimo_pagamento: '2026-10-10', parciais: 0,
  envio: { em_aberto: 2, gerados: 2, enviados: 1 },
  parcelas: [
    { rotulo: 'Boleto 1', tipo: 'BOLETO', valor: 350, recebido: 0, saldo: 350, vencimento: '2026-11-10', status: 'VENCIDO', boleto: { enviado_em: '2026-11-14' } },
    { rotulo: 'Boleto 2', tipo: 'BOLETO', valor: 350, recebido: 0, saldo: 350, vencimento: '2026-12-10', status: 'A_VENCER', boleto: null },
  ], ...extra,
});
const lista = [item('10', 'ELINEUZA PIMENTA', 'EM_ATRASO', 350), item('02', 'ADENILSON SOUSA', 'EM_ATRASO', 350), item('05', 'MARIA EM DIA', 'EM_DIA', 0)];
const d = { projeto: { nome: 'PA Salete Moreno', municipio: 'Açailândia', uf: 'MA', associacao: 'Associação PA Salete Moreno' }, rt: { nome: 'José Romário Pinto Bezerra', registro: 'CFT 01209185369' }, marca: { brasao: null, emblema: null }, data: '14/11/2026' };
const emp = { nome: 'Romatec Consultoria Total', cnpj: '17.261.987/0001-09', cidade: 'Açailândia/MA', rt: 'José Romário Pinto Bezerra — CFT 01209185369', associacao: 'Associação PA Salete Moreno', associacao_cnpj: '00.000.000/0001-00' };

describe('extrato financeiro em PDF / WhatsApp', () => {
  it('filtra e ordena igual à tela', () => {
    expect(filtrarExtrato(lista, { sit: 'EM_ATRASO', ordem: 'lote' }).map((x) => x.lote)).toEqual(['02', '10']);
    expect(filtrarExtrato(lista, { busca: '5' }).map((x) => x.lote)).toEqual(['05']);
    expect(filtrarExtrato(lista, { busca: 'maria' }).map((x) => x.nome)).toEqual(['MARIA EM DIA']);
    expect(filtrarExtrato(lista, {}).length).toBe(3);
    expect(descreverFiltro({ sit: 'EM_ATRASO' })).toBe('Situação: Em atraso');
  });
  it('PDF com dados da empresa, do assentamento, totais do filtro e parcelas vencidas', () => {
    const h = htmlExtrato({ posicao_em: '2026-11-14', totais: {}, lista }, d, emp, { sit: 'EM_ATRASO' }, '14/11/2026 10:30');
    expect(h).toContain('EXTRATO FINANCEIRO DOS ASSOCIADOS');
    expect(h).toContain('Romatec Consultoria Total');
    expect(h).toContain('17.261.987/0001-09');
    expect(h).toContain('Associação PA Salete Moreno');
    expect(h).toContain('00.000.000/0001-00');
    expect(h).toContain('ADENILSON SOUSA');
    expect(h).not.toContain('MARIA EM DIA');
    expect(h).toMatch(/2 associado\(s\)/);
    expect(h).toMatch(/P1 10\/11\/2026 · R\$\s?350,00 — vencido · enviado/);
    expect(h).toMatch(/P2 10\/12\/2026 · R\$\s?350,00 — a vencer · sem boleto/);
  });
  it('resumo em texto para o WhatsApp', () => {
    const t = textoResumoExtrato({ posicao_em: '2026-11-14', lista }, 'PA Salete Moreno', { sit: 'EM_ATRASO' });
    expect(t).toContain('📋 *Situação: Em atraso — PA Salete Moreno*');
    expect(t).toMatch(/Vencido: \*R\$\s?700,00\*/);
    expect(t).toMatch(/• Lote 02 — ADENILSON SOUSA: \*R\$\s?350,00 vencido\* \(P1 10\/11\) · \(99\) 99999-0000/);
  });
});
