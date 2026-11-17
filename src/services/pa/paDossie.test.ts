import { describe, it, expect } from 'vitest';
import { statusPeloSaldo, pendenciaDossie, textoEnvioDossie, textoConclusao, VERSICULOS_CONCLUSAO } from './paDossie';

describe('dossiê v3.170.0', () => {
  it('só libera com saldo zero E taxa de marcos paga', () => {
    expect(statusPeloSaldo('AGUARDANDO_PAGAMENTO', 0, true)).toBe('PRONTO');
    expect(statusPeloSaldo('AGUARDANDO_PAGAMENTO', 0, false)).toBe('AGUARDANDO_PAGAMENTO');
    expect(statusPeloSaldo('PRONTO', 0, false)).toBe('AGUARDANDO_PAGAMENTO');
    expect(statusPeloSaldo('ENVIADO', 0, false)).toBe('ENVIADO');
    expect(statusPeloSaldo('PRONTO', 27)).toBe('AGUARDANDO_PAGAMENTO');
  });
  it('diz o que trava', () => {
    expect(pendenciaDossie(0, { lancados: 0, pagos: false })).toBe('taxa de marcos ainda não lançada');
    expect(pendenciaDossie(27, { lancados: 1, pagos: false })).toMatch(/taxa de marcos em aberto · R\$\s?27,00 em aberto/);
    expect(pendenciaDossie(0, { lancados: 1, pagos: true })).toBeNull();
  });
  it('mensagem do dossiê: carteirinha, TRT, boleto da TRT e vias impressas', () => {
    const t = textoEnvioDossie('MARIA DAS GRAÇAS', '14');
    expect(t).toMatch(/^Olá, Maria!/);
    expect(t).toContain('*LT-14*');
    expect(t).toContain('modelo SIGEF');
    expect(t).toContain('*carteirinha de associado(a)*');
    expect(t).toContain('*TRT (Termo de Responsabilidade Técnica)*');
    expect(t).toContain('*boleto da TRT*');
    expect(t).toContain('*vias impressas e assinadas*');
  });
  it('mensagem de conclusão em nome de José Romário, com versículo', () => {
    const t = textoConclusao('SILVANA DA SILVA GOMES', '14', 'Projeto de Assentamento Salete Moreno', 3);
    expect(t).toMatch(/^Olá, Silvana! 🙏/);
    expect(t).toContain('lote de produção *LT-14*');
    expect(t).toContain('agradeço de coração pela confiança');
    expect(t).toContain(VERSICULOS_CONCLUSAO[3].ref);
    expect(t).toContain('*José Romário Pinto Bezerra*');
    expect(t).toContain('Romatec Consultoria Total');
  });
});
