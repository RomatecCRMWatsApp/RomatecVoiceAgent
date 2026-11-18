// v3.168.0 — Taxa de marcos de concreto: um boleto por associado (padrão R$ 27,00),
// mesmo vencimento para todos. Um clique: cria o lançamento MARCO de quem ainda não tem,
// emite os boletos no Asaas (em segundo plano — são dezenas de chamadas) e, se pedido,
// manda pela fila lenta do WhatsApp (anti-bloqueio, 30–60 s entre associados).
import { PaErro } from './erros';
import { pool, rows, exec, num, isoDate, isoDateTime, hojeBrasil, registrarEvento } from './paDb';
import { mapLancamento } from './paRepo';
import { configAsaas } from './asaas';

export const VALOR_MARCO_PADRAO = 27;

export interface SituacaoMarco {
  associado_id: number; nome: string; numero: string; lote_vila: string; parcela: string | null; whatsapp_valido: boolean;
  lancamento: { id: number; valor: number; vencimento: string | null; status: string; saldo: number } | null;
  boleto: { id: number; status: string; enviado_em: string | null } | null;
}

export async function situacaoMarcos(projetoId: number): Promise<SituacaoMarco[]> {
  const amb = configAsaas()?.ambiente ?? 'sandbox';
  const r = await rows(pool, `
    SELECT a.id aid, a.nome, a.numero, a.parcela AS parcela_rural, a.whatsapp_status, a.whatsapp_numero, lt.numero lote_vila, l.*
    FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id
    LEFT JOIN pa_lancamentos l ON l.associado_id = a.id AND l.tipo = 'MARCO' AND l.status <> 'CANCELADO'
    WHERE a.projeto_id = ? AND a.ativo = 1`, [projetoId]);
  const ids = r.filter((x) => x.id != null).map((x) => num(x.id));
  const bs = ids.length ? await rows(pool, `SELECT id, lancamento_id, status, enviado_em FROM pa_boletos WHERE lancamento_id IN (${ids.map(() => '?').join(',')}) AND ambiente = ? AND status <> 'CANCELADO' ORDER BY id`, [...ids, amb]) : [];
  const bol = new Map(bs.map((b) => [num(b.lancamento_id), { id: num(b.id), status: String(b.status), enviado_em: isoDateTime(b.enviado_em) }]));
  return r.map((x) => {
    const l = x.id != null ? mapLancamento(x) : null;
    return {
      associado_id: num(x.aid), nome: String(x.nome), numero: String(x.numero), lote_vila: String(x.lote_vila), parcela: (x.parcela_rural as string) ?? null,
      whatsapp_valido: x.whatsapp_status === 'VALIDO' && !!x.whatsapp_numero,
      lancamento: l ? { id: l.id, valor: l.valor, vencimento: isoDate(l.vencimento), status: l.status_efetivo, saldo: l.saldo } : null,
      boleto: l ? bol.get(l.id) ?? null : null,
    };
  }).sort((a, b) => a.lote_vila.localeCompare(b.lote_vila, 'pt-BR', { numeric: true }));
}

/** Cria o lançamento MARCO de quem não tem; quem tem, sem nenhum pagamento e com valor/vencimento
 *  diferente: sem boleto → ajusta já; com boleto → vai para "reemitir" (o job cancela no Asaas, ajusta e emite de novo). */
export async function prepararLancamentos(projetoId: number, valor: number, vencimento: string, aids: number[] | null, usuario: string | null) {
  if (!(valor > 0) || valor > 10000) throw new PaErro('CAMPO_INVALIDO', 'Valor da taxa de marcos inválido', 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || vencimento < hojeBrasil()) throw new PaErro('CAMPO_INVALIDO', 'Informe o vencimento (hoje ou depois)', 400);
  const sit = (await situacaoMarcos(projetoId)).filter((s) => !aids || aids.includes(s.associado_id));
  let criados = 0, ajustados = 0;
  const reemitir: Array<{ lancamento_id: number; boleto_id: number; nome: string }> = [];
  for (const s of sit) {
    if (!s.lancamento) {
      await exec(pool, "INSERT INTO pa_lancamentos (associado_id, tipo, parcela, valor, vencimento, status, descricao) VALUES (?, 'MARCO', 0, ?, ?, 'A_VENCER', 'Taxa de marcos de concreto')", [s.associado_id, valor, vencimento]);
      criados++;
    } else if (s.lancamento.saldo >= s.lancamento.valor - 0.009 && s.lancamento.status !== 'PAGO' && (Math.abs(s.lancamento.valor - valor) > 0.009 || s.lancamento.vencimento !== vencimento)) {
      // v3.168.1: valor/vencimento editado → ajusta (e, se já tinha boleto, reemite)
      if (s.boleto && s.boleto.status !== 'PAGO') reemitir.push({ lancamento_id: s.lancamento.id, boleto_id: s.boleto.id, nome: s.nome });
      else if (!s.boleto) { await exec(pool, 'UPDATE pa_lancamentos SET valor = ?, vencimento = ? WHERE id = ?', [valor, vencimento, s.lancamento.id]); ajustados++; }
    }
  }
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'MARCOS_LANCADOS', dados: { valor, vencimento, criados, ajustados, reemitir: reemitir.length, associados: sit.length } });
  return { criados, ajustados, reemitir, associados: sit.map((s) => s.associado_id) };
}

export interface JobMarcos {
  projeto_id: number; status: 'RODANDO' | 'CONCLUIDO' | 'ERRO'; fase: string; total: number; emitidos: number; ja_tinham: number; reemitidos: number;
  erros: Array<{ nome: string; erro: string }>; fila_iniciada: boolean; fila_erro: string | null; iniciado_em: string; terminado_em: string | null;
}
let job: JobMarcos | null = null;
export const estadoJob = () => job;

/** v3.175.3: envio manual de UM associado (sem cascata). Passa pela mesma vez/intervalo global do WhatsApp do sistema. */
export async function enviarUm(projetoId: number, aid: number, usuario: string | null) {
  const wa = await import('./paWhatsapp');
  if (wa.estadoFila()?.status === 'RODANDO') throw new PaErro('FILA_EM_ANDAMENTO', 'O envio automático está rodando — aguarde terminar ou pare a fila', 409);
  const s = (await situacaoMarcos(projetoId)).find((x) => x.associado_id === aid);
  if (!s?.lancamento || !s.boleto) throw new PaErro('SEM_BOLETO', 'Gere o boleto da taxa de marcos antes de enviar', 409);
  if (s.lancamento.saldo <= 0.009) throw new PaErro('SEM_SALDO', 'Taxa de marcos já paga', 409);
  if (!s.whatsapp_valido) throw new PaErro('SEM_WHATSAPP', 'Associado sem WhatsApp válido', 409);
  const fin = await import('./paFinanceiro');
  const bol = await import('./paBoletos');
  const m = await fin.mensagemParaLancamentos(aid, [s.lancamento.id]);
  await wa.enviarWhatsAppAssociado(aid, m.mensagem, 'COBRANCA_MARCO', usuario);
  for (const b of m.boleto_ids) await bol.marcarEnviado(b);
  return { associado_id: aid, enviado: true };
}

/** Um clique: lançamentos → boletos no Asaas → (opcional) fila do WhatsApp. Roda em segundo plano. */
export async function gerarTaxaMarcos(projetoId: number, opts: { valor: number; vencimento: string; associado_ids: number[] | null; enviar: boolean }, usuario: string | null): Promise<JobMarcos> {
  if (job?.status === 'RODANDO') throw new PaErro('MARCOS_EM_ANDAMENTO', 'A geração da taxa de marcos já está em andamento', 409);
  if (!configAsaas()) throw new PaErro('ASAAS_NAO_CONFIGURADO', 'Asaas não configurado', 503);
  const prep = await prepararLancamentos(projetoId, opts.valor, opts.vencimento, opts.associado_ids, usuario);
  const j: JobMarcos = { projeto_id: projetoId, status: 'RODANDO', fase: 'Emitindo boletos no Asaas', total: prep.associados.length, emitidos: 0, ja_tinham: 0, reemitidos: 0, erros: [], fila_iniciada: false, fila_erro: null, iniciado_em: new Date().toISOString(), terminado_em: null };
  job = j;
  void (async () => {
    try {
      const bol = await import('./paBoletos');
      // v3.168.1: valor ou vencimento mudou → cancela o boleto antigo no Asaas e ajusta antes de emitir o novo
      if (prep.reemitir.length) j.fase = 'Cancelando boletos antigos (valor/vencimento alterado)';
      for (const r of prep.reemitir) {
        try {
          await bol.cancelarBoleto(r.boleto_id, usuario);
          await exec(pool, 'UPDATE pa_lancamentos SET valor = ?, vencimento = ? WHERE id = ?', [opts.valor, opts.vencimento, r.lancamento_id]);
          j.reemitidos++;
        } catch (e) { j.erros.push({ nome: r.nome, erro: `não consegui cancelar o boleto antigo: ${(e as Error).message.slice(0, 120)}` }); }
      }
      j.fase = 'Emitindo boletos no Asaas';
      const alvo = (await situacaoMarcos(projetoId)).filter((s) => prep.associados.includes(s.associado_id) && s.lancamento && s.lancamento.saldo > 0.009);
      for (const s of alvo) {
        if (s.boleto) { j.ja_tinham++; continue; }
        try { await bol.emitirBoleto(s.lancamento!.id, usuario); j.emitidos++; }
        catch (e) { j.erros.push({ nome: s.nome, erro: (e as Error).message.slice(0, 160) }); }
      }
      if (opts.enviar) {
        j.fase = 'Enviando pelo WhatsApp (fila lenta)';
        const depois = (await situacaoMarcos(projetoId)).filter((s) => prep.associados.includes(s.associado_id) && s.whatsapp_valido && s.boleto && !s.boleto.enviado_em && s.lancamento && s.lancamento.saldo > 0.009);
        try {
          const wa = await import('./paWhatsapp');
          const fin = await import('./paFinanceiro');
          wa.iniciarFila(projetoId, depois.map((s) => ({ associado_id: s.associado_id, nome: s.nome, lancamento_ids: [s.lancamento!.id] })), usuario, async (it) => {
            const m = await fin.mensagemParaLancamentos(it.associado_id, it.lancamento_ids);
            await wa.enviarWhatsAppAssociado(it.associado_id, m.mensagem, 'COBRANCA_MARCO', usuario);
            for (const b of m.boleto_ids) await bol.marcarEnviado(b);
          });
          j.fila_iniciada = true;
        } catch (e) { j.fila_erro = (e as Error).message.slice(0, 200); }
      }
      j.status = 'CONCLUIDO'; j.fase = j.fila_iniciada ? 'Boletos emitidos — envio pelo WhatsApp em andamento' : 'Boletos emitidos';
    } catch (e) {
      j.status = 'ERRO'; j.fase = (e as Error).message.slice(0, 200);
    } finally {
      j.terminado_em = new Date().toISOString();
      await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'MARCOS_BOLETOS', dados: { emitidos: j.emitidos, reemitidos: j.reemitidos, ja_tinham: j.ja_tinham, erros: j.erros.length, fila: j.fila_iniciada } });
    }
  })();
  return j;
}
