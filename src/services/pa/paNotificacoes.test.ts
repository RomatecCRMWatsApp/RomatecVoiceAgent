import { describe, it, expect } from 'vitest';
import { textoConfirmacaoAssociado, textoAvisoAdmin, VERSICULOS, numerosAdmin, type DadosConfirmacao } from './paNotificacoes';
import { variarSaudacao } from './paWhatsapp';

const base: DadosConfirmacao = {
  pagamento_id: 42, projeto: 'Projeto de Assentamento Salete Moreno', forma: 'PIX', valor: 400, pago_em: '2026-11-06 14:32:10',
  origem: 'Asaas — baixa automática do boleto', recebido_hoje: { valor: 1200, qtd: 3 },
  associados: [{ associado_id: 7, nome: 'MARIA DAS GRAÇAS SOUSA', numero: 'A-012', lote: '12', whatsapp_valido: true,
    itens: [{ rotulo: 'Parcela 3/12', vencimento: '2026-11-10', valor_pago: 400, quitada: true, saldo: 0 }], total: 400, abertas: 9, saldo_devedor: 3600 }],
};

describe('confirmação de pagamento no WhatsApp', () => {
  it('mensagem do associado: agradecimento, parcela, lote, PA, valor, data, saldo e versículo', () => {
    const t = textoConfirmacaoAssociado(base, base.associados[0]);
    expect(t).toMatch(/^Olá, Maria! 🙏/);
    expect(t).toContain('Muito obrigado');
    expect(t).toContain('Associado: MARIA DAS GRAÇAS SOUSA (A-012)');
    expect(t).toContain('Lote: 12 — Projeto de Assentamento Salete Moreno');
    expect(t).toContain('Parcela 3/12 (venc. 10/11/2026)');
    expect(t).toContain('quitada');
    expect(t).toMatch(/Valor recebido: \*R\$\s?400,00\*/);
    expect(t).toContain('Pago em: 06/11/2026 às 14:32 · Pix');
    expect(t).toMatch(/Parcelas em aberto: 9 \(R\$\s?3\.600,00\)/);
    const v = VERSICULOS[42 % VERSICULOS.length];
    expect(t).toContain(v.texto); expect(t).toContain(v.ref);
    // a saudação varia no envio (anti-bloqueio) e continua começando pelo nome
    expect(variarSaudacao(t, new Date('2026-11-06T13:00:00Z'))).toMatch(/^(Olá|Oi|Bom dia), Maria!/);
  });
  it('versículos aprovados: 11 de gratidão/confiança, sem os de trabalho', () => {
    expect(VERSICULOS).toHaveLength(11);
    const refs = VERSICULOS.map((v) => v.ref);
    expect(refs).toContain('1 Tessalonicenses 5:18');
    expect(refs).toContain('Provérbios 3:5');
    for (const fora of ['Salmos 128:2', 'Salmos 90:17', 'Colossenses 3:23']) expect(refs).not.toContain(fora);
  });
  it('quitou tudo: parabeniza; parcial: mostra quanto falta; Asaas sem horário', () => {
    const q = textoConfirmacaoAssociado({ ...base, pago_em: '2026-11-06 12:00:00' }, { ...base.associados[0], abertas: 0, saldo_devedor: 0 });
    expect(q).toContain('todas as suas parcelas estão quitadas');
    expect(q).toContain('Pago em: 06/11/2026 · Pix');
    const p = textoConfirmacaoAssociado(base, { ...base.associados[0], itens: [{ rotulo: 'Sinal', vencimento: null, valor_pago: 200, quitada: false, saldo: 200 }], total: 200 });
    expect(p).toMatch(/Sinal — R\$\s?200,00 · falta R\$\s?200,00/);
  });
  it('aviso ao administrador: total, origem, recebido no dia e se o associado foi avisado', () => {
    const t = textoAvisoAdmin(base, [{ nome: 'MARIA DAS GRAÇAS SOUSA', ok: true }, { nome: 'JOSÉ RIBAMAR', ok: false, motivo: 'WhatsApp não validado no cadastro' }]);
    expect(t).toContain('💰 *Pagamento recebido — Projeto de Assentamento Salete Moreno*');
    expect(t).toContain('MARIA DAS GRAÇAS SOUSA (A-012) · Lote 12');
    expect(t).toMatch(/Total: \*R\$\s?400,00\* · Pix · 06\/11\/2026 14:32/);
    expect(t).toContain('Origem: Asaas — baixa automática do boleto');
    expect(t).toMatch(/Recebido hoje no PA: R\$\s?1\.200,00 \(3 pagamentos\)/);
    expect(t).toContain('✅ Maria avisado no WhatsApp');
    expect(t).toContain('⚠️ José não avisado: WhatsApp não validado no cadastro');
  });
  it('número do administrador: PA_ADMIN_WHATSAPP tem prioridade, aceita lista', () => {
    const a = process.env.PA_ADMIN_WHATSAPP, c = process.env.CEO_WHATSAPP_PHONE;
    process.env.CEO_WHATSAPP_PHONE = '+55 99 99154-6099'; delete process.env.PA_ADMIN_WHATSAPP;
    expect(numerosAdmin()).toEqual(['5599991546099']);
    process.env.PA_ADMIN_WHATSAPP = '5599991111111, 5599992222222';
    expect(numerosAdmin()).toEqual(['5599991111111', '5599992222222']);
    if (a === undefined) delete process.env.PA_ADMIN_WHATSAPP; else process.env.PA_ADMIN_WHATSAPP = a;
    if (c === undefined) delete process.env.CEO_WHATSAPP_PHONE; else process.env.CEO_WHATSAPP_PHONE = c;
  });
});
