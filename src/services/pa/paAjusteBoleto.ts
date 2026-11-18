// v3.185.0 — Ajustar boleto em aberto: cancela o boleto no Asaas e gera um novo com o valor certo.
//  • PAGO_POR_FORA: o associado já pagou parte (ex.: R$ 20 de R$ 30 em espécie/Pix) → lança o
//    pagamento nessa parcela, cancela o boleto antigo e emite um novo só com o saldo (R$ 10).
//  • NOVO_VALOR: muda o valor da parcela (desconto/correção) → atualiza o lançamento (fica no
//    histórico com o valor antigo), cancela o boleto antigo e emite um novo com o saldo.
// Opcional: envia o boleto novo no WhatsApp do associado.
import { PaErro } from './erros';
import { pool, one, exec, num, registrarEvento, agoraBrasilSql } from './paDb';
import { buscarBoleto, cancelarBoleto, emitirBoleto, marcarEnviado } from './paBoletos';
import { lancarPagamento, mensagemParaLancamentos, FORMAS, type Forma } from './paFinanceiro';
import { centavos, statusAposRecebimento, type StatusLancamento } from './regrasFinanceiras';

export type ModoAjuste = 'PAGO_POR_FORA' | 'NOVO_VALOR';
export interface Ajuste { modo: ModoAjuste; valor: number; forma: Forma; pago_em: string | null; obs: string | null; enviar: boolean }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function lerAjuste(b: Record<string, unknown>): Ajuste {
  const modo = b.modo === 'NOVO_VALOR' ? 'NOVO_VALOR' : 'PAGO_POR_FORA';
  const valor = centavos(typeof b.valor === 'number' ? b.valor : Number(String(b.valor ?? '').trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
  if (!(valor > 0)) throw new PaErro('CAMPO_INVALIDO', modo === 'NOVO_VALOR' ? 'Informe o novo valor da parcela' : 'Informe quanto o associado já pagou', 400);
  const forma = String(b.forma ?? 'ESPECIE').toUpperCase() as Forma;
  if (!FORMAS.includes(forma)) throw new PaErro('CAMPO_INVALIDO', 'Forma de pagamento inválida', 400);
  const d = String(b.pago_em ?? '').slice(0, 10);
  return { modo, valor, forma, pago_em: /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d} 12:00:00` : null, obs: b.obs ? String(b.obs).slice(0, 500) : null, enviar: b.enviar === true };
}

/** Confere o ajuste contra o lançamento (pura — testável). Devolve o saldo que vai no boleto novo. */
export function planejarAjuste(l: { valor: number; recebido: number }, a: Pick<Ajuste, 'modo' | 'valor'>) {
  const saldo = centavos(l.valor - l.recebido);
  if (a.modo === 'PAGO_POR_FORA') {
    if (a.valor > saldo + 0.009) throw new PaErro('VALOR_ACIMA', `O valor pago (${brl(a.valor)}) é maior que o saldo da parcela (${brl(saldo)})`, 400);
    return { saldo_novo: centavos(saldo - a.valor), valor_parcela: l.valor };
  }
  if (a.valor < l.recebido - 0.009) throw new PaErro('VALOR_ABAIXO', `O novo valor (${brl(a.valor)}) é menor que o que já foi recebido (${brl(l.recebido)})`, 400);
  if (Math.abs(a.valor - l.valor) < 0.009) throw new PaErro('SEM_MUDANCA', 'O valor é o mesmo da parcela', 400);
  return { saldo_novo: centavos(a.valor - l.recebido), valor_parcela: a.valor };
}

export async function ajustarBoleto(boletoId: number, a: Ajuste, usuario: string | null) {
  const b = await buscarBoleto(boletoId);
  if (b.status !== 'PENDENTE' && b.status !== 'VENCIDO') throw new PaErro('BOLETO_NAO_AJUSTAVEL', `Boleto ${b.status.toLowerCase()} não pode ser ajustado`, 409);
  const lr = await one(pool, 'SELECT id, associado_id, tipo, valor, valor_recebido, status FROM pa_lancamentos WHERE id = ?', [b.lancamento_id]);
  if (!lr) throw new PaErro('LANCAMENTO_NAO_ENCONTRADO', 'Parcela do boleto não encontrada', 404);
  const l = { valor: num(lr.valor), recebido: num(lr.valor_recebido) };
  const plano = planejarAjuste(l, a);

  // 1) cancela o boleto antigo (Asaas + sistema)
  await cancelarBoleto(boletoId, usuario);
  // 2) aplica o ajuste
  if (a.modo === 'PAGO_POR_FORA') {
    await lancarPagamento(b.projeto_id, {
      forma: a.forma, valor: a.valor, pago_em: a.pago_em ?? agoraBrasilSql(), id_transacao: null, pagador_nome: null, pagador_cpf_parcial: null,
      pagador_instituicao: null, vinculo_pagador: null, url_recibo: null, comprovante_doc_id: null,
      obs: a.obs ?? `Pago por fora (boleto #${boletoId} cancelado e reemitido com o saldo)`, associado_id: b.associado_id, rateio: [{ lancamento_id: b.lancamento_id, valor: a.valor }],
    }, usuario);
  } else {
    const st = statusAposRecebimento(plano.valor_parcela, l.recebido, String(lr.status) as StatusLancamento);
    await exec(pool, 'UPDATE pa_lancamentos SET valor = ?, status = ? WHERE id = ?', [plano.valor_parcela, st, b.lancamento_id]);
    await registrarEvento(pool, { projeto_id: b.projeto_id, associado_id: b.associado_id, usuario, tipo: 'PARCELA_VALOR_AJUSTADO',
      dados: { lancamento_id: b.lancamento_id, de: l.valor, para: plano.valor_parcela, boleto_cancelado: boletoId, obs: a.obs } });
  }
  // 3) boleto novo com o saldo (se sobrou)
  let novo = null as Awaited<ReturnType<typeof emitirBoleto>> | null;
  let erro_emissao: string | null = null;
  if (plano.saldo_novo > 0.009) {
    try { novo = await emitirBoleto(b.lancamento_id, usuario); } catch (e) { erro_emissao = (e as Error).message; }
  }
  // 4) envio opcional no WhatsApp
  let enviado = false, erro_envio: string | null = null;
  if (novo && a.enviar) {
    try {
      const m = await mensagemParaLancamentos(b.associado_id, [b.lancamento_id]);
      const wa = await import('./paWhatsapp');
      await wa.enviarWhatsAppAssociado(b.associado_id, m.mensagem, 'COBRANCA', usuario);
      for (const id of m.boleto_ids) await marcarEnviado(id);
      enviado = true;
    } catch (e) { erro_envio = (e as Error).message; }
  }
  await registrarEvento(pool, { projeto_id: b.projeto_id, associado_id: b.associado_id, usuario, tipo: 'BOLETO_AJUSTADO',
    dados: { modo: a.modo, valor: a.valor, boleto_antigo: boletoId, boleto_novo: novo?.id ?? null, saldo_novo: plano.saldo_novo } });
  return { boleto_cancelado: boletoId, saldo_novo: plano.saldo_novo, boleto_novo: novo, erro_emissao, enviado, erro_envio };
}
