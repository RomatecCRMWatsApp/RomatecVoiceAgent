// v3.161.0 — Confirmação automática de pagamento pelo WhatsApp.
//
// A cada pagamento lançado (webhook/sincronização do Asaas, recibo InfinitePay ou
// lançamento manual) o sistema envia:
//   • ao ASSOCIADO: agradecimento + confirmação (parcela, lote, valor, data, forma,
//     saldo em aberto) + um versículo bíblico;
//   • ao ADMINISTRADOR (PA_ADMIN_WHATSAPP ou CEO_WHATSAPP_PHONE): aviso de que o
//     dinheiro caiu, com a origem e o total recebido no dia no PA.
//
// Garantias:
//   • uma vez só: o pagamento é "reservado" (notificado_em) antes do envio;
//   • nada de histórico: pagamentos do seed/importação e os anteriores a esta
//     versão já nascem marcados (migração) — só pagamentos novos disparam;
//   • Z-API fora do ar: a parte que falhou volta pra fila e o vigia tenta de novo
//     (a cada 10 min, até 6 tentativas, por 3 dias) sem repetir o que já foi;
//   • ritmo anti-bloqueio: tudo passa pela mesma fila serializada do paWhatsapp.
import { PaErro } from './erros';
import { pool, rows, one, exec, num, registrarEvento } from './paDb';
import { enviarWhatsAppAssociado, enviarWhatsAppNumero } from './paWhatsapp';

export const VERSICULOS: ReadonlyArray<{ texto: string; ref: string }> = [
  { texto: 'Confia ao Senhor as tuas obras, e teus pensamentos serão estabelecidos.', ref: 'Provérbios 16:3' },
  { texto: 'Confia no Senhor e faze o bem; habitarás na terra e, verdadeiramente, serás alimentado.', ref: 'Salmos 37:3' },
  { texto: 'Pois comerás do trabalho das tuas mãos; feliz serás, e te irá bem.', ref: 'Salmos 128:2' },
  { texto: 'O Senhor te abençoe e te guarde; o Senhor faça resplandecer o seu rosto sobre ti e tenha misericórdia de ti.', ref: 'Números 6:24-25' },
  { texto: 'O meu Deus, segundo as suas riquezas, suprirá todas as vossas necessidades em glória, por Cristo Jesus.', ref: 'Filipenses 4:19' },
  { texto: 'E seja sobre nós a graça do Senhor, nosso Deus; e confirma sobre nós a obra das nossas mãos.', ref: 'Salmos 90:17' },
  { texto: 'Em tudo dai graças, porque esta é a vontade de Deus em Cristo Jesus para convosco.', ref: '1 Tessalonicenses 5:18' },
  { texto: 'E, tudo quanto fizerdes, fazei-o de todo o coração, como ao Senhor e não aos homens.', ref: 'Colossenses 3:23' },
];

const FORMA: Record<string, string> = {
  PIX: 'Pix', BOLETO: 'Boleto', ESPECIE: 'Dinheiro', CARTAO_DEBITO: 'Cartão de débito', CARTAO_CREDITO: 'Cartão de crédito', MISTO: 'Misto',
};
const ROTULO: Record<string, string> = { SINAL: 'Sinal', AVISTA: 'Pagamento à vista', AJUSTE: 'Ajuste' };
export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const horaBr = (iso: string | null) => (iso && iso.length >= 16 && iso.slice(11, 16) !== '12:00' && iso.slice(11, 16) !== '00:00' ? iso.slice(11, 16) : null);

export interface ItemConfirmacao { rotulo: string; vencimento: string | null; valor_pago: number; quitada: boolean; saldo: number }
export interface DadosAssociadoConfirmacao {
  associado_id: number; nome: string; numero: string; lote: string;
  whatsapp_valido: boolean; itens: ItemConfirmacao[]; total: number; abertas: number; saldo_devedor: number;
}
export interface DadosConfirmacao {
  pagamento_id: number; projeto: string; forma: string; valor: number; pago_em: string | null;
  origem: string; associados: DadosAssociadoConfirmacao[]; recebido_hoje: { valor: number; qtd: number };
}

const primeiroNome = (n: string) => {
  const p = n.trim().split(/\s+/)[0] || n;
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
};
const linhaItem = (i: ItemConfirmacao) =>
  `${i.rotulo}${i.vencimento ? ` (venc. ${dataBr(i.vencimento)})` : ''} — ${brl(i.valor_pago)}${i.quitada ? ' ✔️ quitada' : ` · falta ${brl(i.saldo)}`}`;

/** Mensagem de agradecimento/confirmação ao associado (começa com "Olá," → a saudação varia no envio). */
export function textoConfirmacaoAssociado(d: DadosConfirmacao, a: DadosAssociadoConfirmacao): string {
  const v = VERSICULOS[d.pagamento_id % VERSICULOS.length];
  const hora = horaBr(d.pago_em);
  const ref = a.itens.length === 1 ? `📄 Referente a: ${linhaItem(a.itens[0])}` : `📄 Referente a:\n${a.itens.map((i) => `   • ${linhaItem(i)}`).join('\n')}`;
  const saldo = a.abertas === 0
    ? '🎉 Com este pagamento, *todas as suas parcelas estão quitadas*. Parabéns!'
    : `📌 Parcelas em aberto: ${a.abertas} (${brl(a.saldo_devedor)}).`;
  return [
    `Olá, ${primeiroNome(a.nome)}! 🙏`,
    '',
    `Recebemos o seu pagamento. Muito obrigado pela confiança e pelo compromisso com o ${d.projeto}!`,
    '',
    '✅ *Pagamento confirmado*',
    `👤 Associado: ${a.nome} (${a.numero})`,
    `🏡 Lote: ${a.lote} — ${d.projeto}`,
    ref,
    `💰 Valor recebido: *${brl(a.total)}*`,
    `📅 Pago em: ${dataBr(d.pago_em)}${hora ? ` às ${hora}` : ''} · ${FORMA[d.forma] ?? d.forma}`,
    '',
    saldo,
    '',
    `📖 _"${v.texto}"_ (${v.ref})`,
    '',
    'Deus abençoe você e sua família!',
    'Romatec Consultoria Total',
  ].join('\n');
}

/** Aviso ao administrador: caiu dinheiro (sem precisar abrir o app). */
export function textoAvisoAdmin(d: DadosConfirmacao, avisados: Array<{ nome: string; ok: boolean; motivo?: string }>): string {
  const hora = horaBr(d.pago_em);
  const blocos = d.associados.map((a) => [
    `👤 ${a.nome} (${a.numero}) · Lote ${a.lote}`,
    ...a.itens.map((i) => `   📄 ${linhaItem(i)}`),
    a.abertas === 0 ? '   🎉 associado quitou tudo' : `   📌 em aberto: ${a.abertas} parcela(s) · ${brl(a.saldo_devedor)}`,
  ].join('\n'));
  const av = avisados.map((x) => (x.ok ? `✅ ${primeiroNome(x.nome)} avisado no WhatsApp` : `⚠️ ${primeiroNome(x.nome)} não avisado: ${x.motivo ?? 'falha no envio'}`));
  return [
    `💰 *Pagamento recebido — ${d.projeto}*`,
    '',
    ...blocos,
    '',
    `💵 Total: *${brl(d.valor)}* · ${FORMA[d.forma] ?? d.forma} · ${dataBr(d.pago_em)}${hora ? ` ${hora}` : ''}`,
    `🔎 Origem: ${d.origem}`,
    `📊 Recebido hoje no PA: ${brl(d.recebido_hoje.valor)} (${d.recebido_hoje.qtd} pagamento${d.recebido_hoje.qtd === 1 ? '' : 's'})`,
    ...(av.length ? ['', ...av] : []),
  ].join('\n');
}

function origemDe(p: Record<string, unknown>): string {
  const por = String(p.criado_por ?? '');
  if (/^asaas/i.test(por) || /^asaas:/i.test(String(p.id_transacao ?? ''))) return 'Asaas — baixa automática do boleto';
  if (p.url_recibo) return `recibo InfinitePay lançado por ${por || '—'}`;
  return `lançamento manual por ${por || '—'}`;
}

/** Monta os dados da confirmação a partir do banco. */
export async function dadosConfirmacao(pagamentoId: number): Promise<DadosConfirmacao> {
  const p = await one(pool, `SELECT p.*, pr.nome AS projeto_nome, DATE_FORMAT(p.pago_em, '%Y-%m-%d %H:%i:%s') AS pago_txt FROM pa_pagamentos p JOIN pa_projetos pr ON pr.id = p.projeto_id WHERE p.id = ?`, [pagamentoId]);
  if (!p) throw new PaErro('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento não encontrado', 404);
  const rs = await rows(pool, `
    SELECT r.valor AS rateado, l.id AS lancamento_id, l.tipo, l.parcela, l.valor, l.valor_recebido, l.status,
      DATE_FORMAT(l.vencimento, '%Y-%m-%d') AS venc, a.id AS aid, a.nome, a.numero, a.whatsapp_status, a.whatsapp_numero, lt.numero AS lote,
      (SELECT COUNT(*) FROM pa_lancamentos x WHERE x.associado_id = a.id AND x.tipo = 'BOLETO' AND x.status <> 'CANCELADO') AS tot_boletos
    FROM pa_pagamento_rateio r JOIN pa_lancamentos l ON l.id = r.lancamento_id
    JOIN pa_associados a ON a.id = l.associado_id JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE r.pagamento_id = ? ORDER BY CAST(lt.numero AS UNSIGNED), l.parcela`, [pagamentoId]);
  const porAssoc = new Map<number, DadosAssociadoConfirmacao>();
  for (const r of rs) {
    const aid = num(r.aid);
    let a = porAssoc.get(aid);
    if (!a) {
      a = { associado_id: aid, nome: String(r.nome), numero: String(r.numero), lote: String(r.lote), whatsapp_valido: r.whatsapp_status === 'VALIDO' && !!r.whatsapp_numero, itens: [], total: 0, abertas: 0, saldo_devedor: 0 };
      porAssoc.set(aid, a);
    }
    const saldo = Math.max(0, Math.round((num(r.valor) - num(r.valor_recebido)) * 100) / 100);
    a.itens.push({
      rotulo: r.tipo === 'BOLETO' ? `Parcela ${num(r.parcela)}/${num(r.tot_boletos)}` : ROTULO[String(r.tipo)] ?? String(r.tipo),
      vencimento: r.venc ? String(r.venc) : null, valor_pago: num(r.rateado), quitada: r.status === 'PAGO' || saldo < 0.01, saldo,
    });
    a.total = Math.round((a.total + num(r.rateado)) * 100) / 100;
  }
  for (const a of porAssoc.values()) {
    const s = await one(pool, `SELECT COUNT(*) AS n, COALESCE(SUM(valor - valor_recebido), 0) AS saldo FROM pa_lancamentos WHERE associado_id = ? AND status NOT IN ('PAGO','CANCELADO')`, [a.associado_id]);
    a.abertas = num(s?.n); a.saldo_devedor = Math.max(0, num(s?.saldo));
  }
  const hoje = await one(pool, `SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS v FROM pa_pagamentos WHERE projeto_id = ? AND DATE(pago_em) = DATE(?)`, [p.projeto_id, p.pago_txt]);
  return {
    pagamento_id: pagamentoId, projeto: String(p.projeto_nome), forma: String(p.forma), valor: num(p.valor), pago_em: p.pago_txt ? String(p.pago_txt) : null,
    origem: origemDe(p), associados: [...porAssoc.values()], recebido_hoje: { valor: num(hoje?.v), qtd: num(hoje?.n) },
  };
}

export function numerosAdmin(): string[] {
  return String(process.env.PA_ADMIN_WHATSAPP || process.env.CEO_WHATSAPP_PHONE || '').split(/[,;]+/).map((x) => x.replace(/\D/g, '')).filter((x) => x.length >= 10);
}
export const notificacaoLigada = () => process.env.PA_NOTIFICAR_PAGAMENTOS !== '0';
const MAX_TENTATIVAS = 6;

interface EstadoNotificacao { tentativas: number; ok_associados: number[]; ok_admin: boolean; associados: Array<{ id: number; nome: string; ok: boolean; motivo?: string }>; admin?: { ok: boolean; motivo?: string }; em?: string }

/**
 * Envia a confirmação de um pagamento. `forcar` (botão "reenviar") manda tudo de novo.
 * Nunca lança por falha de envio — devolve o que aconteceu.
 */
export async function notificarPagamento(pagamentoId: number, opts: { forcar?: boolean; usuario?: string | null } = {}): Promise<EstadoNotificacao & { pulado?: string }> {
  const p = await one(pool, 'SELECT id, projeto_id, seed_chave, notificacao_json FROM pa_pagamentos WHERE id = ?', [pagamentoId]);
  if (!p) throw new PaErro('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento não encontrado', 404);
  const ant: EstadoNotificacao = (typeof p.notificacao_json === 'string' ? JSON.parse(p.notificacao_json) : p.notificacao_json) ?? { tentativas: 0, ok_associados: [], ok_admin: false, associados: [] };
  if (!opts.forcar) {
    // reserva: só um processo envia (webhook + vigia + sincronização podem coincidir)
    const r = await exec(pool, 'UPDATE pa_pagamentos SET notificado_em = NOW() WHERE id = ? AND notificado_em IS NULL', [pagamentoId]);
    if (!r.affectedRows) return { ...ant, pulado: 'ja_notificado' };
  }
  const est: EstadoNotificacao = opts.forcar ? { tentativas: 0, ok_associados: [], ok_admin: false, associados: [] } : { ...ant, associados: [] };
  est.tentativas++;
  let falhaTemporaria = false;
  try {
    const d = await dadosConfirmacao(pagamentoId);
    for (const a of d.associados) {
      if (est.ok_associados.includes(a.associado_id)) { est.associados.push({ id: a.associado_id, nome: a.nome, ok: true }); continue; }
      if (!a.whatsapp_valido) { est.associados.push({ id: a.associado_id, nome: a.nome, ok: false, motivo: 'WhatsApp não validado no cadastro' }); continue; }
      try {
        await enviarWhatsAppAssociado(a.associado_id, textoConfirmacaoAssociado(d, a), 'CONFIRMACAO_PAGAMENTO', opts.usuario ?? 'sistema');
        est.ok_associados.push(a.associado_id);
        est.associados.push({ id: a.associado_id, nome: a.nome, ok: true });
      } catch (err) {
        const msg = (err as Error).message.slice(0, 160);
        if (err instanceof PaErro && err.codigo === 'ZAPI_INDISPONIVEL') falhaTemporaria = true;
        est.associados.push({ id: a.associado_id, nome: a.nome, ok: false, motivo: msg });
      }
    }
    const adm = numerosAdmin();
    if (!est.ok_admin && adm.length) {
      const texto = textoAvisoAdmin(d, est.associados);
      try {
        for (const n of adm) await enviarWhatsAppNumero(n, texto);
        est.ok_admin = true; est.admin = { ok: true };
      } catch (err) {
        falhaTemporaria = true;
        est.admin = { ok: false, motivo: (err as Error).message.slice(0, 160) };
      }
    } else if (!adm.length) est.admin = { ok: false, motivo: 'PA_ADMIN_WHATSAPP/CEO_WHATSAPP_PHONE não configurado' };
  } catch (err) {
    falhaTemporaria = true;
    est.admin = { ok: false, motivo: (err as Error).message.slice(0, 160) };
  }
  est.em = new Date().toISOString();
  const devolver = !opts.forcar && falhaTemporaria && est.tentativas < MAX_TENTATIVAS;
  await exec(pool, `UPDATE pa_pagamentos SET notificacao_json = ?${devolver ? ', notificado_em = NULL' : ''} WHERE id = ?`, [JSON.stringify(est), pagamentoId]);
  await registrarEvento(pool, {
    projeto_id: num(p.projeto_id), usuario: opts.usuario ?? 'sistema', tipo: 'PAGAMENTO_CONFIRMACAO',
    dados: { pagamento_id: pagamentoId, tentativa: est.tentativas, associados: est.associados, admin: est.admin ?? null, nova_tentativa: devolver },
  });
  return est;
}

/** Chamado depois do lançamento: dispara em segundo plano (não atrasa a baixa). */
export function agendarNotificacao(pagamentoId: number): void {
  if (!notificacaoLigada() || process.env.VITEST) return;
  setTimeout(() => {
    notificarPagamento(pagamentoId).catch((err) => console.error(`[pa-notificacao] pagamento ${pagamentoId}:`, (err as Error).message));
  }, 2_000);
}

/** Vigia: reenvia o que ficou pendente (Z-API fora do ar, servidor reiniciado no meio). */
export async function processarPendentes(): Promise<number> {
  if (!notificacaoLigada()) return 0;
  const ps = await rows(pool, `SELECT id FROM pa_pagamentos WHERE notificado_em IS NULL AND seed_chave IS NULL
    AND criado_em >= NOW() - INTERVAL 3 DAY ORDER BY id LIMIT 20`);
  for (const p of ps) {
    try { await notificarPagamento(num(p.id)); } catch (err) { console.error(`[pa-notificacao] pendente ${p.id}:`, (err as Error).message); }
  }
  return ps.length;
}

let vigia: NodeJS.Timeout | null = null;
export function iniciarVigiaNotificacoes(): void {
  if (vigia || !notificacaoLigada()) return;
  const rodar = () => { processarPendentes().catch((err) => console.error('[pa-notificacao] vigia:', (err as Error).message)); };
  setTimeout(rodar, 60_000);
  vigia = setInterval(rodar, 10 * 60_000);
  vigia.unref?.();
}
