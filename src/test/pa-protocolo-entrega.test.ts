import { describe, it, expect } from 'vitest';
import { itensProtocolo, hashProtocolo, mascararCpf, mascararFone, textoProtocolo, horaBrasilia, htmlProtocolo } from '../services/pa/paProtocoloEntrega';

describe('v3.198.0 protocolo de entrega das vias físicas', () => {
  it('sem TRT: TRT entra como pendente; com TRT: entregue com o número', () => {
    const s = itensProtocolo({ lote: '05', contratoAssinado: true, quitado: true, trtNumero: null });
    expect(s.at(-1)).toMatchObject({ pendente: true });
    expect(s.filter((i) => !i.pendente)).toHaveLength(8);
    const c = itensProtocolo({ lote: '05', contratoAssinado: false, quitado: false, trtNumero: 'BR123' });
    expect(c.at(-1)).toMatchObject({ detalhe: 'nº BR123' });
    expect(c.some((i) => /Contrato|quitação/.test(i.item))).toBe(false);
  });
  it('hash muda se qualquer dado da confirmação muda', () => {
    const base = { numero: 'PE-PASM-2026-0001', lote: '05', associado: 'A', cpf: '123.456.789-00', itens: [{ item: 'x' }], entregue_em: '2026-11-21 13:00:00', confirmado_em: '2026-11-21 14:00:00', ip: '1.1.1.1', ua: 'ua', enviado_para: '5599' };
    const h = hashProtocolo(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashProtocolo({ ...base, ip: '1.1.1.2' })).not.toBe(h);
    expect(hashProtocolo({ ...base })).toBe(h);
  });
  it('máscaras e horário de Brasília', () => {
    expect(mascararCpf('12345678900')).toBe('***.456.789-**');
    expect(mascararFone('5599991811246')).toBe('(99) 9****-1246');
    expect(horaBrasilia('2026-11-21 14:10:00')).toBe('21/11/2026 às 11:10');
  });
  it('mensagem e PDF não expõem o CPF completo', () => {
    const t = textoProtocolo('MARIA DA SILVA', '05', 'PE-X-1', 'https://x/pa/protocolo/abc', true);
    expect(t).toContain('Olá, Maria!'); expect(t).toContain('TRT');
    const h = htmlProtocolo({ numero: 'PE-X-1', lote: '05', nome: 'Maria', cpf: mascararCpf('12345678900'), numero_associado: 'PASM-1', lote_vila: '1', denominacao: null, projeto: 'PA', municipio: 'Açailândia/MA', associacao: 'A',
      itens: itensProtocolo({ lote: '05', contratoAssinado: true, quitado: true, trtNumero: null }), sem_trt: true, entregue_em: null, entregue_por: null, enviado_em: null, enviado_para: null, confirmado_em: null, ip: null, ua: null, obs: null, hash: null, link: 'l', qr: '' });
    expect(h).not.toContain('12345678900'); expect(h).toContain('AGUARDANDO CONFIRMAÇÃO');
  });
});
