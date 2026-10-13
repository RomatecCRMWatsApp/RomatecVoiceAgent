// v3.143.0 — Boletos do módulo PA via Asaas (BolePix: boleto + Pix da cobrança).
//
// Emissão: 1 boleto ativo (PENDENTE/VENCIDO) por lançamento, no valor do SALDO.
// Baixa: webhook PAYMENT_RECEIVED/CONFIRMED → lancarPagamento() com
// id_transacao "asaas:<pay_id>" (idempotente pelo uk_txid) e rateio na parcela.
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDate, isoDateTime, hojeBrasil, registrarEvento } from './paDb';
import { buscarProjeto, buscarAssociado, mapLancamento } from './paRepo';
import { lancarPagamento } from './paFinanceiro';
import {
  exigirConfigAsaas, configAsaas, payloadCliente, payloadCobranca, vencimentoBoleto, statusLocal,
  buscarOuCriarCliente, criarCobranca, linhaDigitavel, pixDaCobranca, cancelarCobranca, obterCobranca,
  type StatusBoleto,
} from './asaas';
import { novoToken, urlBoletoRomatec } from './paBoletoPdf';

export function mapBoleto(b: Record<string, unknown>) {
  return {
    id: num(b.id), projeto_id: num(b.projeto_id), associado_id: num(b.associado_id), lancamento_id: num(b.lancamento_id),
    provedor: String(b.provedor), externo_id: String(b.externo_id), valor: num(b.valor), vencimento: isoDate(b.vencimento),
    status: String(b.status) as StatusBoleto, linha_digitavel: (b.linha_digitavel as string) ?? null,
    nosso_numero: (b.nosso_numero as string) ?? null, pix_copia_cola: (b.pix_copia_cola as string) ?? null,
    url_boleto: (b.url_boleto as string) ?? null, url_fatura: (b.url_fatura as string) ?? null,
    pago_em: isoDateTime(b.pago_em), valor_pago: b.valor_pago == null ? null : num(b.valor_pago),
    enviado_em: isoDateTime(b.enviado_em), criado_em: isoDateTime(b.criado_em),
    url_romatec: urlBoletoRomatec((b.token_publico as string) ?? null),
    ambiente: String(b.ambiente ?? 'sandbox'),
    // v3.144.3: boleto do ambiente Asaas configurado agora (sandbox x produção).
    ambiente_atual: String(b.ambiente ?? 'sandbox') === ambienteAtual(),
    lote: (b.lote as string) ?? null, associado_nome: (b.associado_nome as string) ?? null,
    tipo: (b.tipo as string) ?? null, parcela: b.parcela == null ? null : num(b.parcela),
  };
}
export type Boleto = ReturnType<typeof mapBoleto>;

const SELECT_BOLETO = `
  SELECT b.*, lt.numero AS lote, a.nome AS associado_nome, l.tipo, l.parcela
  FROM pa_boletos b JOIN pa_associados a ON a.id = b.associado_id JOIN pa_lotes lt ON lt.id = a.lote_id
  JOIN pa_lancamentos l ON l.id = b.lancamento_id`;

export function statusAsaas() {
  const c = configAsaas();
  return {
    configurado: !!c, ambiente: c?.ambiente ?? null,
    webhook_configurado: !!(process.env.ASAAS_WEBHOOK_TOKEN || '').trim(),
  };
}

/** Ambiente Asaas em uso (sem chave = sandbox, só pra comparação). */
export function ambienteAtual(): 'producao' | 'sandbox' {
  return configAsaas()?.ambiente ?? 'sandbox';
}

// Trava em memória contra clique duplo (Railway roda 1 instância do app).
const emitindo = new Set<number>();

function rotuloParcela(tipo: string, parcela: number, totalBoletos: number): string {
  if (tipo === 'BOLETO') return `Parcela ${parcela}/${totalBoletos}`;
  if (tipo === 'SINAL') return 'Sinal';
  if (tipo === 'AVISTA') return 'Pagamento à vista';
  return 'Ajuste';
}

export async function emitirBoleto(lancamentoId: number, usuario: string | null): Promise<Boleto> {
  const cfg = exigirConfigAsaas();
  if (emitindo.has(lancamentoId)) throw new PaErro('EMISSAO_EM_ANDAMENTO', 'Este boleto já está sendo emitido', 409);
  emitindo.add(lancamentoId);
  try {
    const lr = await one(pool, 'SELECT * FROM pa_lancamentos WHERE id = ?', [lancamentoId]);
    if (!lr) throw new PaErro('LANCAMENTO_NAO_ENCONTRADO', 'Lançamento não encontrado', 404);
    const l = mapLancamento(lr);
    if (l.status === 'CANCELADO' || l.saldo <= 0) throw new PaErro('SEM_SALDO', 'Lançamento sem saldo em aberto', 409);
    // Boleto ativo de OUTRO ambiente (ex.: teste do sandbox depois de ligar a produção) não vale
    // mais: cancela só aqui no sistema — no Asaas real ele nem existe.
    await exec(pool, "UPDATE pa_boletos SET status = 'CANCELADO' WHERE lancamento_id = ? AND status IN ('PENDENTE','VENCIDO') AND ambiente <> ?", [lancamentoId, cfg.ambiente]);
    const ativo = await one(pool, "SELECT id FROM pa_boletos WHERE lancamento_id = ? AND status IN ('PENDENTE','VENCIDO') AND ambiente = ?", [lancamentoId, cfg.ambiente]);
    if (ativo) throw new PaErro('BOLETO_JA_EMITIDO', `Já existe boleto ativo para esta parcela (#${ativo.id})`, 409, { boleto_id: num(ativo.id) });

    const a = await buscarAssociado(l.associado_id);
    const projeto = await buscarProjeto(a.projeto_id);
    // Cliente do Asaas só vale no ambiente em que foi criado.
    let customerId = a.asaas_ambiente === cfg.ambiente ? a.asaas_customer_id : null;
    if (!customerId) {
      customerId = await buscarOuCriarCliente(cfg, payloadCliente({
        nome: a.nome, cpf: a.cpf, telefone_e164: a.telefone_e164, email: a.email, lote: a.lote,
        denominacao_terra: a.denominacao_terra, associado_id: a.id,
      }, projeto));
      await exec(pool, 'UPDATE pa_associados SET asaas_customer_id = ?, asaas_ambiente = ? WHERE id = ?', [customerId, cfg.ambiente, a.id]);
    }
    const tot = await one(pool, "SELECT COUNT(*) AS n FROM pa_lancamentos WHERE associado_id = ? AND tipo = 'BOLETO'", [a.id]);
    const venc = vencimentoBoleto(l.vencimento, hojeBrasil());
    const cob = await criarCobranca(cfg, payloadCobranca({
      customerId, lancamentoId, valor: l.saldo, vencimento: venc, projeto,
      descricao: `${projeto.nome} – Lote ${a.lote} – ${rotuloParcela(l.tipo, l.parcela, num(tot?.n))} – ${a.numero}`,
    }));
    // Linha digitável e Pix: melhor esforço (Pix depende de chave cadastrada no Asaas).
    let linha: string | null = null, nosso: string | null = cob.nossoNumero ?? null, pix: string | null = null;
    try { const ld = await linhaDigitavel(cfg, cob.id); linha = ld.identificationField ?? null; nosso = ld.nossoNumero ?? nosso; } catch (e) { console.warn('[pa-boleto] linha digitável:', (e as Error).message); }
    try { const px = await pixDaCobranca(cfg, cob.id); pix = px.payload ?? null; } catch (e) { console.warn('[pa-boleto] pix:', (e as Error).message); }

    const ins = await exec(pool, `
      INSERT INTO pa_boletos (projeto_id, associado_id, lancamento_id, provedor, externo_id, valor, vencimento, status,
        linha_digitavel, nosso_numero, pix_copia_cola, url_boleto, url_fatura, criado_por, token_publico, ambiente)
      VALUES (?, ?, ?, 'ASAAS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      projeto.id, a.id, lancamentoId, cob.id, cob.value ?? l.saldo, cob.dueDate ?? venc, statusLocal(cob.status),
      linha, nosso, pix, cob.bankSlipUrl ?? null, cob.invoiceUrl ?? null, usuario, novoToken(), cfg.ambiente,
    ]);
    await registrarEvento(pool, {
      projeto_id: projeto.id, associado_id: a.id, usuario, tipo: 'BOLETO_EMITIDO',
      dados: { boleto_id: ins.insertId, asaas_id: cob.id, valor: l.saldo, vencimento: venc, lancamento_id: lancamentoId, ambiente: cfg.ambiente },
    });
    return buscarBoleto(ins.insertId);
  } finally {
    emitindo.delete(lancamentoId);
  }
}

export async function buscarBoleto(id: number): Promise<Boleto> {
  const b = await one(pool, `${SELECT_BOLETO} WHERE b.id = ?`, [id]);
  if (!b) throw new PaErro('BOLETO_NAO_ENCONTRADO', 'Boleto não encontrado', 404);
  return mapBoleto(b);
}

export async function listarBoletos(projetoId: number, status?: string | null) {
  const params: unknown[] = [projetoId];
  let f = '';
  if (status && ['PENDENTE', 'VENCIDO', 'PAGO', 'CANCELADO', 'ESTORNADO'].includes(status)) { f = ' AND b.status = ?'; params.push(status); }
  const bs = await rows(pool, `${SELECT_BOLETO} WHERE b.projeto_id = ?${f} ORDER BY b.vencimento, CAST(lt.numero AS UNSIGNED)`, params);
  return bs.map(mapBoleto);
}

export async function boletosDoAssociado(aid: number) {
  return (await rows(pool, `${SELECT_BOLETO} WHERE b.associado_id = ? ORDER BY b.id DESC`, [aid])).map(mapBoleto);
}

/** Lançamentos em aberto sem boleto ativo, com vencimento até `ate` (para emissão em lote). */
export async function elegiveisParaBoleto(projetoId: number, ateIso: string | null, tipos: string[] = ['BOLETO']) {
  await buscarProjeto(projetoId);
  const ate = ateIso && /^\d{4}-\d{2}-\d{2}$/.test(ateIso) ? ateIso : '9999-12-31';
  const ts = tipos.filter((t) => ['SINAL', 'BOLETO', 'AVISTA', 'AJUSTE'].includes(t));
  if (!ts.length) return [];
  const ls = await rows(pool, `
    SELECT l.*, a.nome, lt.numero AS lote FROM pa_lancamentos l
    JOIN pa_associados a ON a.id = l.associado_id AND a.ativo = 1 JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE a.projeto_id = ? AND l.status NOT IN ('PAGO','CANCELADO') AND l.tipo IN (${ts.map(() => '?').join(',')})
      AND (l.vencimento IS NULL OR l.vencimento <= ?)
      AND NOT EXISTS (SELECT 1 FROM pa_boletos b WHERE b.lancamento_id = l.id AND b.status IN ('PENDENTE','VENCIDO') AND b.ambiente = ?)
    ORDER BY l.vencimento, CAST(lt.numero AS UNSIGNED), l.parcela`, [projetoId, ...ts, ate, ambienteAtual()]);
  return ls.map((r) => ({ ...mapLancamento(r), nome: String(r.nome), lote: String(r.lote) })).filter((l) => l.saldo > 0);
}

export async function cancelarBoleto(id: number, usuario: string | null) {
  const b = await buscarBoleto(id);
  if (b.status !== 'PENDENTE' && b.status !== 'VENCIDO') throw new PaErro('BOLETO_NAO_CANCELAVEL', `Boleto ${b.status.toLowerCase()} não pode ser cancelado`, 409);
  const cfg = exigirConfigAsaas();
  // Boleto de outro ambiente (teste do sandbox) não existe no Asaas atual: cancela só aqui.
  if (b.ambiente === cfg.ambiente) await cancelarCobranca(cfg, b.externo_id);
  await exec(pool, "UPDATE pa_boletos SET status = 'CANCELADO' WHERE id = ?", [id]);
  await registrarEvento(pool, { projeto_id: b.projeto_id, associado_id: b.associado_id, usuario, tipo: 'BOLETO_CANCELADO', dados: { boleto_id: id, asaas_id: b.externo_id } });
  return buscarBoleto(id);
}

// ─── v3.144.5: sincronização ativa com o Asaas (não depende do webhook) ──
const EVENTO_POR_STATUS: Record<string, string> = {
  RECEIVED: 'PAYMENT_RECEIVED', CONFIRMED: 'PAYMENT_CONFIRMED', RECEIVED_IN_CASH: 'PAYMENT_RECEIVED_IN_CASH',
  OVERDUE: 'PAYMENT_OVERDUE', REFUNDED: 'PAYMENT_REFUNDED', REFUND_REQUESTED: 'PAYMENT_REFUNDED',
  CHARGEBACK_REQUESTED: 'PAYMENT_CHARGEBACK_REQUESTED', DELETED: 'PAYMENT_DELETED',
};

export interface ResultadoSincronizacao {
  consultados: number; baixados: number; vencidos: number; cancelados: number; estornados: number; sem_mudanca: number;
  erros: Array<{ boleto_id: number; lote: string | null; erro: string }>;
  detalhes: Array<{ boleto_id: number; lote: string | null; associado: string | null; acao: string }>;
}

/**
 * Consulta no Asaas cada boleto em aberto (PENDENTE/VENCIDO) do ambiente atual
 * e aplica a MESMA lógica do webhook (processarEventoAsaas) — idempotente: se o
 * webhook chegar depois, a baixa não duplica (id_transacao asaas:<pay_id>).
 */
export async function sincronizarBoletos(projetoId: number, usuario: string | null): Promise<ResultadoSincronizacao> {
  const cfg = exigirConfigAsaas();
  await buscarProjeto(projetoId);
  const abertos = (await rows(pool, `${SELECT_BOLETO} WHERE b.projeto_id = ? AND b.status IN ('PENDENTE','VENCIDO') AND b.ambiente = ? ORDER BY b.id`, [projetoId, cfg.ambiente])).map(mapBoleto);
  const out: ResultadoSincronizacao = { consultados: 0, baixados: 0, vencidos: 0, cancelados: 0, estornados: 0, sem_mudanca: 0, erros: [], detalhes: [] };
  for (const b of abertos) {
    out.consultados++;
    let acao = 'sem_mudanca';
    try {
      let cob: Awaited<ReturnType<typeof obterCobranca>> | null = null;
      try {
        cob = await obterCobranca(cfg, b.externo_id);
      } catch (err) {
        if (!(err instanceof PaErro) || err.codigo !== 'ASAAS_NAO_ENCONTRADO') throw err;
      }
      const statusAsaas = !cob || (cob as { deleted?: boolean }).deleted ? 'DELETED' : String(cob.status || '').toUpperCase();
      const evento = EVENTO_POR_STATUS[statusAsaas];
      if (evento && !(evento === 'PAYMENT_OVERDUE' && b.status === 'VENCIDO')) {
        const r = await processarEventoAsaas({ event: evento, payment: { ...(cob ?? {}), id: b.externo_id } });
        acao = r.acao;
      }
    } catch (err) {
      out.erros.push({ boleto_id: b.id, lote: b.lote, erro: (err as Error).message.slice(0, 200) });
      if (err instanceof PaErro && (err.codigo === 'ASAAS_CHAVE_INVALIDA' || err.codigo === 'ASAAS_INDISPONIVEL')) break;
      continue;
    }
    if (acao === 'baixado' || acao === 'pago_sem_saldo') out.baixados++;
    else if (acao === 'status:VENCIDO') out.vencidos++;
    else if (acao === 'status:CANCELADO') out.cancelados++;
    else if (acao === 'status:ESTORNADO') out.estornados++;
    else out.sem_mudanca++;
    if (acao !== 'sem_mudanca') out.detalhes.push({ boleto_id: b.id, lote: b.lote, associado: b.associado_nome, acao });
  }
  await registrarEvento(pool, {
    projeto_id: projetoId, usuario, tipo: 'BOLETOS_SINCRONIZADOS',
    dados: { consultados: out.consultados, baixados: out.baixados, vencidos: out.vencidos, cancelados: out.cancelados, estornados: out.estornados, erros: out.erros.length, ambiente: cfg.ambiente },
  });
  return out;
}

export async function marcarEnviado(id: number) {
  await exec(pool, 'UPDATE pa_boletos SET enviado_em = NOW() WHERE id = ?', [id]);
}

// ─── Webhook ──────────────────────────────────────────────────────────────
export interface EventoAsaas {
  event?: string;
  payment?: {
    id?: string; status?: string; value?: number; billingType?: string; dueDate?: string;
    paymentDate?: string | null; clientPaymentDate?: string | null; confirmedDate?: string | null;
    bankSlipUrl?: string | null; invoiceUrl?: string | null;
  };
}

/**
 * Processa um evento do Asaas. Idempotente: o mesmo PAYMENT_RECEIVED duas vezes
 * não duplica a baixa (uk_txid). Cobrança que não é do módulo PA é ignorada.
 */
export async function processarEventoAsaas(ev: EventoAsaas): Promise<{ acao: string; boleto_id?: number }> {
  const pay = ev.payment;
  const evento = String(ev.event || '');
  if (!pay?.id) return { acao: 'ignorado:sem_payment' };
  const br = await one(pool, "SELECT * FROM pa_boletos WHERE provedor = 'ASAAS' AND externo_id = ?", [pay.id]);
  if (!br) return { acao: 'ignorado:nao_e_do_pa' };
  const b = mapBoleto(br);

  if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED' || evento === 'PAYMENT_RECEIVED_IN_CASH') {
    if (b.status === 'PAGO') return { acao: 'ja_pago', boleto_id: b.id };
    const valor = Number(pay.value ?? b.valor);
    const data = (pay.clientPaymentDate || pay.paymentDate || pay.confirmedDate || hojeBrasil()).slice(0, 10);
    const lr = await one(pool, 'SELECT * FROM pa_lancamentos WHERE id = ?', [b.lancamento_id]);
    const saldo = lr ? mapLancamento(lr).saldo : 0;
    let pagamentoId: number | null = null;
    if (saldo > 0) {
      try {
        const r = await lancarPagamento(b.projeto_id, {
          forma: pay.billingType === 'PIX' ? 'PIX' : 'BOLETO', valor, pago_em: `${data} 12:00:00`,
          id_transacao: `asaas:${pay.id}`, pagador_nome: b.associado_nome, pagador_cpf_parcial: null, pagador_instituicao: 'Asaas',
          vinculo_pagador: null, url_recibo: null, comprovante_doc_id: null,
          obs: `Baixa automática Asaas (${evento}) — boleto #${b.id}`, associado_id: null,
          rateio: [{ lancamento_id: b.lancamento_id, valor: Math.min(valor, saldo) }],
        }, 'asaas-webhook');
        pagamentoId = r.pagamento_id;
      } catch (err) {
        if (!(err instanceof PaErro) || err.codigo !== 'TRANSACAO_DUPLICADA') throw err;
        pagamentoId = num((err.detalhe as { pagamento_id?: number } | undefined)?.pagamento_id);
      }
    } else {
      await registrarEvento(pool, {
        projeto_id: b.projeto_id, associado_id: b.associado_id, usuario: 'asaas-webhook', tipo: 'BOLETO_PAGO_SEM_SALDO',
        dados: { boleto_id: b.id, asaas_id: pay.id, valor, aviso: 'parcela já estava quitada — conferir devolução' },
      });
    }
    await exec(pool, "UPDATE pa_boletos SET status = 'PAGO', pago_em = ?, valor_pago = ?, pagamento_id = ? WHERE id = ?", [`${data} 12:00:00`, valor, pagamentoId, b.id]);
    return { acao: saldo > 0 ? 'baixado' : 'pago_sem_saldo', boleto_id: b.id };
  }

  const novo: StatusBoleto | null =
    evento === 'PAYMENT_OVERDUE' ? 'VENCIDO'
      : evento === 'PAYMENT_DELETED' ? 'CANCELADO'
        : evento === 'PAYMENT_REFUNDED' || evento === 'PAYMENT_CHARGEBACK_REQUESTED' ? 'ESTORNADO'
          : evento === 'PAYMENT_RESTORED' ? 'PENDENTE' : null;
  if (novo && b.status !== 'PAGO') {
    await exec(pool, 'UPDATE pa_boletos SET status = ? WHERE id = ?', [novo, b.id]);
  } else if (novo === 'ESTORNADO') {
    // Estorno de boleto já baixado: não desfaz a baixa sozinho — avisa pra conferência.
    await exec(pool, "UPDATE pa_boletos SET status = 'ESTORNADO' WHERE id = ?", [b.id]);
    await registrarEvento(pool, { projeto_id: b.projeto_id, associado_id: b.associado_id, usuario: 'asaas-webhook', tipo: 'BOLETO_ESTORNADO', dados: { boleto_id: b.id, pagamento_id: br.pagamento_id ?? null, aviso: 'estornar a baixa manualmente' } });
  }
  if (evento === 'PAYMENT_UPDATED' && pay.dueDate) {
    await exec(pool, 'UPDATE pa_boletos SET vencimento = ?, valor = COALESCE(?, valor), url_boleto = COALESCE(?, url_boleto) WHERE id = ?', [pay.dueDate, pay.value ?? null, pay.bankSlipUrl ?? null, b.id]);
  }
  return { acao: novo ? `status:${novo}` : `ignorado:${evento || 'sem_evento'}`, boleto_id: b.id };
}
