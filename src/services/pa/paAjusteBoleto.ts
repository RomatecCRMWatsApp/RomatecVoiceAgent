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
export interface Ajuste { modo: ModoAjuste; valor: number; forma: Forma; pago_em: string | null; obs: string | null; enviar: boolean; url_recibo: string | null }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function lerAjuste(b: Record<string, unknown>): Ajuste {
  const modo = b.modo === 'NOVO_VALOR' ? 'NOVO_VALOR' : 'PAGO_POR_FORA';
  const valor = centavos(typeof b.valor === 'number' ? b.valor : Number(String(b.valor ?? '').trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
  if (!(valor > 0)) throw new PaErro('CAMPO_INVALIDO', modo === 'NOVO_VALOR' ? 'Informe o novo valor da parcela' : 'Informe quanto o associado já pagou', 400);
  const forma = String(b.forma ?? 'ESPECIE').toUpperCase() as Forma;
  if (!FORMAS.includes(forma)) throw new PaErro('CAMPO_INVALIDO', 'Forma de pagamento inválida', 400);
  const d = String(b.pago_em ?? '').slice(0, 10);
  return { modo, valor, forma, pago_em: /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d} 12:00:00` : null, obs: b.obs ? String(b.obs).slice(0, 500) : null, enviar: b.enviar === true,
    url_recibo: /^https:\/\/recibo\.infinitepay\.io\//.test(String(b.url_recibo ?? '')) ? String(b.url_recibo).slice(0, 400) : null };
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
  if (a.modo === 'PAGO_POR_FORA' && a.forma === 'PIX' && !a.url_recibo) throw new PaErro('ID_TRANSACAO_OBRIGATORIO', 'Pix precisa do link do recibo InfinitePay (para não lançar em duplicidade) — ou escolha Espécie', 400);

  // 1) aplica o ajuste (o pagamento primeiro: se o recibo for recusado, o boleto antigo continua valendo)
  if (a.modo === 'PAGO_POR_FORA') {
    await lancarPagamento(b.projeto_id, {
      forma: a.url_recibo ? 'PIX' : a.forma, valor: a.valor, pago_em: a.url_recibo ? '' : (a.pago_em ?? agoraBrasilSql()), id_transacao: null, pagador_nome: null, pagador_cpf_parcial: null,
      pagador_instituicao: null, vinculo_pagador: null, url_recibo: a.url_recibo, comprovante_doc_id: null,
      obs: a.obs ?? `Pago por fora (boleto #${boletoId} cancelado e reemitido com o saldo)`, associado_id: b.associado_id, rateio: [{ lancamento_id: b.lancamento_id, valor: a.valor }],
    }, usuario);
  } else {
    const st = statusAposRecebimento(plano.valor_parcela, l.recebido, String(lr.status) as StatusLancamento);
    await exec(pool, 'UPDATE pa_lancamentos SET valor = ?, status = ? WHERE id = ?', [plano.valor_parcela, st, b.lancamento_id]);
    await registrarEvento(pool, { projeto_id: b.projeto_id, associado_id: b.associado_id, usuario, tipo: 'PARCELA_VALOR_AJUSTADO',
      dados: { lancamento_id: b.lancamento_id, de: l.valor, para: plano.valor_parcela, boleto_cancelado: boletoId, obs: a.obs } });
  }
  // 2) cancela o boleto antigo (Asaas + sistema)
  await cancelarBoleto(boletoId, usuario);
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

// ─── v3.199.0: ✂️ dividir a parcela em duas (ou mais) datas ───────────────────────────────────────
// Ex.: parcela de R$ 325 → R$ 250 hoje + R$ 75 em 27/11. Cancela o boleto no Asaas, a parcela original
// fica com a 1ª parte (valor e vencimento novos) e cada parte seguinte vira um lançamento AJUSTE
// ("Parcela 2 — parte 2/2"), com boleto próprio. A soma das partes tem que dar o saldo da parcela.
export interface ParteDivisao { valor: number; vencimento: string }
export function lerDivisao(b: Record<string, unknown>): { partes: ParteDivisao[]; enviar: boolean } {
  const ps = Array.isArray(b.partes) ? b.partes : [];
  const partes = ps.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const valor = centavos(typeof o.valor === 'number' ? o.valor : Number(String(o.valor ?? '').trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
    const vencimento = String(o.vencimento ?? '').slice(0, 10);
    return { valor, vencimento };
  });
  return { partes, enviar: b.enviar === true };
}
/** Confere a divisão (pura — testável). */
export function planejarDivisao(saldo: number, partes: ParteDivisao[], hoje: string) {
  if (partes.length < 2 || partes.length > 6) throw new PaErro('CAMPO_INVALIDO', 'Divida em 2 a 6 partes', 400);
  for (const [i, p] of partes.entries()) {
    if (!(p.valor > 0)) throw new PaErro('CAMPO_INVALIDO', `Informe o valor da parte ${i + 1}`, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.vencimento)) throw new PaErro('CAMPO_INVALIDO', `Informe o vencimento da parte ${i + 1}`, 400);
    if (p.vencimento < hoje) throw new PaErro('CAMPO_INVALIDO', `O vencimento da parte ${i + 1} já passou`, 400);
  }
  const soma = centavos(partes.reduce((s, p) => s + p.valor, 0));
  if (Math.abs(soma - saldo) > 0.009) throw new PaErro('SOMA_DIFERENTE', `As partes somam ${brl(soma)}, mas o saldo da parcela é ${brl(saldo)}`, 400);
  return [...partes].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

export async function dividirBoleto(boletoId: number, d: { partes: ParteDivisao[]; enviar: boolean }, usuario: string | null) {
  const b = await buscarBoleto(boletoId);
  if (b.status !== 'PENDENTE' && b.status !== 'VENCIDO') throw new PaErro('BOLETO_NAO_AJUSTAVEL', `Boleto ${b.status.toLowerCase()} não pode ser dividido`, 409);
  const lr = await one(pool, 'SELECT id, associado_id, tipo, parcela, valor, valor_recebido, status, vencimento FROM pa_lancamentos WHERE id = ?', [b.lancamento_id]);
  if (!lr) throw new PaErro('LANCAMENTO_NAO_ENCONTRADO', 'Parcela do boleto não encontrada', 404);
  const recebido = num(lr.valor_recebido), saldo = centavos(num(lr.valor) - recebido);
  const { hojeBrasil } = await import('./paDb');
  const partes = planejarDivisao(saldo, d.partes, hojeBrasil());
  const tipo = String(lr.tipo), parc = num(lr.parcela);
  const nomeParc = tipo === 'BOLETO' ? `Parcela ${parc}` : tipo === 'SINAL' ? 'Sinal' : tipo === 'MARCO' ? 'Taxa de marcos' : tipo === 'AVISTA' ? 'Pagamento à vista' : `Ajuste ${parc}`;
  // 1) cancela o boleto atual (Asaas + sistema) antes de mexer nos valores
  await cancelarBoleto(boletoId, usuario);
  // 2) parcela original = 1ª parte; partes seguintes = lançamentos AJUSTE
  const ids: number[] = [b.lancamento_id];
  const { transacao } = await import('./paDb');
  await transacao(async (c) => {
    const p0 = partes[0];
    await exec(c, "UPDATE pa_lancamentos SET valor = ?, vencimento = ?, status = IF(valor_recebido > 0.009, 'PARCIAL', 'A_VENCER'), descricao = ? WHERE id = ?",
      [centavos(recebido + p0.valor), p0.vencimento, `${nomeParc} — parte 1/${partes.length} (dividida)`, b.lancamento_id]);
    const mx = await one(c, "SELECT COALESCE(MAX(parcela), 0) AS m FROM pa_lancamentos WHERE associado_id = ? AND tipo = 'AJUSTE' FOR UPDATE", [b.associado_id]);
    let n = num(mx?.m);
    for (const [i, p] of partes.slice(1).entries()) {
      n++;
      const ins = await exec(c, "INSERT INTO pa_lancamentos (associado_id, tipo, parcela, valor, vencimento, status, valor_recebido, descricao) VALUES (?, 'AJUSTE', ?, ?, ?, 'A_VENCER', 0, ?)",
        [b.associado_id, n, p.valor, p.vencimento, `${nomeParc} — parte ${i + 2}/${partes.length} (dividida)`]);
      ids.push(ins.insertId);
    }
  });
  await registrarEvento(pool, { projeto_id: b.projeto_id, associado_id: b.associado_id, usuario, tipo: 'PARCELA_DIVIDIDA',
    dados: { lancamento_id: b.lancamento_id, boleto_cancelado: boletoId, saldo, partes, lancamentos: ids } });
  // 3) um boleto para cada parte
  const novos: Array<{ lancamento_id: number; boleto_id: number | null; valor: number; vencimento: string; erro: string | null }> = [];
  for (const [i, lid] of ids.entries()) {
    try { const nb = await emitirBoleto(lid, usuario); novos.push({ lancamento_id: lid, boleto_id: nb?.id ?? null, valor: partes[i].valor, vencimento: partes[i].vencimento, erro: null }); }
    catch (e) { novos.push({ lancamento_id: lid, boleto_id: null, valor: partes[i].valor, vencimento: partes[i].vencimento, erro: (e as Error).message.slice(0, 200) }); }
  }
  // 4) envio opcional no WhatsApp (os boletos novos numa mensagem só)
  let enviado = false, erro_envio: string | null = null;
  if (d.enviar && novos.some((x) => x.boleto_id)) {
    try {
      const m = await mensagemParaLancamentos(b.associado_id, ids);
      const wa = await import('./paWhatsapp');
      await wa.enviarWhatsAppAssociado(b.associado_id, m.mensagem, 'COBRANCA', usuario);
      for (const id of m.boleto_ids) await marcarEnviado(id);
      enviado = true;
    } catch (e) { erro_envio = (e as Error).message; }
  }
  return { boleto_cancelado: boletoId, partes: novos, enviado, erro_envio };
}
