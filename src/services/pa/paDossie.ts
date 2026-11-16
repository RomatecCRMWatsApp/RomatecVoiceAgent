// v3.169.0 — Dossiês de pronta entrega. Lote fechado em campo (MEDIDO) gera o dossiê:
// carta ao associado (comparecer ao escritório para a anotação técnica e retirar a via
// impressa) + termo de quitação + mapa e memorial descritivo do lote, num PDF só.
// Status: AGUARDANDO_PAGAMENTO → PRONTO (tudo pago; aguarda o CEO autorizar) → ENVIADO
// (WhatsApp) → ENTREGUE (a secretária marca a entrega física da via impressa).
import { PDFDocument } from 'pdf-lib';
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDate, isoDateTime, registrarEvento } from './paDb';
import { buscarProjeto } from './paRepo';
import { pdfSubdivisao, vinculosParcelas, dadosCabecalho } from './paMapas';
import { cabecalho, pdfDeHtml } from './mapasPdf';

export const ENDERECO_ROMATEC = 'Rua São Raimundo, n.º 10, Centro · Açailândia/MA · CEP 65.930-000';
export type StatusDossie = 'AGUARDANDO_PAGAMENTO' | 'PRONTO' | 'ENVIADO' | 'ENTREGUE';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dbr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const ROT: Record<string, string> = { SINAL: 'Sinal', AVISTA: 'À vista', BOLETO: 'Parcela', AJUSTE: 'Ajuste', MARCO: 'Taxa de marcos' };

/** Status pelo saldo (pura — testável): enviado/entregue não voltam; o resto segue o financeiro. */
export function statusPeloSaldo(atual: StatusDossie, saldo: number): StatusDossie {
  if (atual === 'ENVIADO' || atual === 'ENTREGUE') return atual;
  return saldo > 0.009 ? 'AGUARDANDO_PAGAMENTO' : 'PRONTO';
}

async function financeiro(aid: number) {
  const ls = await rows(pool, "SELECT tipo, parcela, valor, valor_recebido, status FROM pa_lancamentos WHERE associado_id = ? AND status <> 'CANCELADO' ORDER BY FIELD(tipo,'SINAL','AVISTA','BOLETO','AJUSTE','MARCO'), parcela", [aid]);
  const pags = await rows(pool, `SELECT p.pago_em, p.forma, r.valor, l.tipo, l.parcela FROM pa_pagamento_rateio r JOIN pa_pagamentos p ON p.id = r.pagamento_id
    JOIN pa_lancamentos l ON l.id = r.lancamento_id WHERE l.associado_id = ? ORDER BY p.pago_em`, [aid]);
  const total = ls.reduce((s, l) => s + num(l.valor), 0);
  const recebido = ls.reduce((s, l) => s + num(l.valor_recebido), 0);
  return { saldo: Math.max(0, Math.round((total - recebido) * 100) / 100), total, recebido, pagamentos: pags.map((p) => ({ data: isoDate(p.pago_em), forma: String(p.forma), valor: num(p.valor), item: `${ROT[String(p.tipo)] ?? p.tipo}${p.tipo === 'BOLETO' ? ' ' + num(p.parcela) : ''}` })) };
}

/** Cria o dossiê do lote (idempotente). Chamado quando o lote fecha em campo. */
export async function criarDossie(projetoId: number, lote: string, usuario: string | null) {
  const ben = (await vinculosParcelas(projetoId))[lote];
  if (!ben) throw new PaErro('LOTE_SEM_ASSOCIADO', `LT-${lote} não tem associado vinculado`, 409);
  const f = await financeiro(ben.associado_id);
  const st = statusPeloSaldo('PRONTO', f.saldo);
  await exec(pool, 'INSERT IGNORE INTO pa_dossies (projeto_id, lote, associado_id, status, gerado_em) VALUES (?, ?, ?, ?, NOW())', [projetoId, lote, ben.associado_id, st]);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: ben.associado_id, usuario, tipo: 'DOSSIE_GERADO', dados: { lote, status: st } });
  return { lote, status: st };
}

export async function listarDossies(projetoId: number) {
  const ds = await rows(pool, `SELECT d.*, a.nome, a.numero, a.whatsapp_status, a.whatsapp_numero, a.denominacao_terra, lt.numero lote_vila, c.concluido_em, c.usuario_nome medidor
    FROM pa_dossies d JOIN pa_associados a ON a.id = d.associado_id JOIN pa_lotes lt ON lt.id = a.lote_id
    LEFT JOIN pa_campo_lotes c ON c.projeto_id = d.projeto_id AND c.lote = d.lote WHERE d.projeto_id = ?`, [projetoId]);
  const out = [];
  for (const d of ds) {
    const f = await financeiro(num(d.associado_id));
    const st = statusPeloSaldo(d.status as StatusDossie, f.saldo);
    if (st !== d.status) await exec(pool, 'UPDATE pa_dossies SET status = ? WHERE id = ?', [st, d.id]);
    out.push({
      lote: String(d.lote), associado_id: num(d.associado_id), nome: String(d.nome), numero: String(d.numero), lote_vila: String(d.lote_vila), denominacao: (d.denominacao_terra as string) ?? null,
      whatsapp_valido: d.whatsapp_status === 'VALIDO' && !!d.whatsapp_numero, status: st, saldo: f.saldo, medido_em: d.concluido_em ? isoDateTime(d.concluido_em) : null, medidor: (d.medidor as string) ?? null,
      gerado_em: isoDateTime(d.gerado_em), enviado_em: isoDateTime(d.enviado_em), enviado_por: (d.enviado_por as string) ?? null, entregue_em: isoDateTime(d.entregue_em), entregue_por: (d.entregue_por as string) ?? null, entregue_obs: (d.entregue_obs as string) ?? null,
    });
  }
  return out.sort((a, b) => a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true }));
}

/** PDF do dossiê: carta + termo de quitação (se quitado) + mapa e memorial do lote. */
export async function pdfDossie(projetoId: number, lote: string): Promise<{ pdf: Buffer; nome: string; quitado: boolean }> {
  const p = await buscarProjeto(projetoId);
  const ben = (await vinculosParcelas(projetoId))[lote];
  if (!ben) throw new PaErro('LOTE_SEM_ASSOCIADO', `LT-${lote} não tem associado vinculado`, 404);
  const a = await one(pool, 'SELECT a.nome, a.cpf, a.numero, a.denominacao_terra, lt.numero lote_vila FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.id = ?', [ben.associado_id]);
  const c = await one(pool, 'SELECT * FROM pa_campo_lotes WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  const f = await financeiro(ben.associado_id);
  const quitado = f.saldo <= 0.009;
  const cab = dadosCabecalho(p);
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
  const den = a?.denominacao_terra ? ` — "${esc(a.denominacao_terra)}"` : '';
  const css = `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#1C1C18;font-size:10.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
    .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}.cab .lg img{height:11mm}.cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
    .cab h1{margin:0;font-size:13pt}.cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}.cab .t{flex:1}
    p{text-align:justify;line-height:1.55;margin:0 0 3.5mm;font-family:'Times New Roman',serif;font-size:11.5pt}
    h2{color:#0C3320;font-size:12pt;margin:6mm 0 3mm;text-align:center}
    table{width:100%;border-collapse:collapse;font-size:9pt;margin:2mm 0 4mm}th{background:#0C3320;color:#fff;padding:1.5mm;text-align:left}td{border-bottom:1px solid #ddd;padding:1.5mm}
    .ass{margin-top:16mm;text-align:center;font-size:9.5pt}.ass div{border-top:1px solid #333;width:90mm;margin:0 auto 1mm;padding-top:1mm}
    .quebra{page-break-before:always}.box{border:1px solid #C9A84C;border-radius:2mm;padding:3mm 4mm;background:#FBF8EE;margin:4mm 0}`;
  const carta = `${cabecalho(cab, `DOSSIÊ DO LOTE LT-${lote}`)}
    <h2>Comunicado de conclusão da demarcação</h2>
    <p>Açailândia/MA, ${esc(hoje)}.</p>
    <p>Prezado(a) <b>${esc(a?.nome)}</b>, associado(a) nº ${esc(a?.numero)} do ${esc(p.nome)} (lote da vila ${esc(a?.lote_vila)}),</p>
    <p>Informamos que a <b>locação e demarcação do seu lote de produção LT-${esc(lote)}${den}</b> foi concluída em campo${c ? ` em ${dbr(isoDate(c.concluido_em))}` : ''}, com área de <b>${num(c?.area_ha ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 4 })} ha</b>${c?.perimetro_m ? ` e perímetro de ${num(c.perimetro_m).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m` : ''}, com os marcos de concreto cravados nos vértices.</p>
    <p>Seguem neste dossiê o <b>mapa e o memorial descritivo</b> do lote${quitado ? ' e o <b>termo de quitação</b> do serviço' : ''}.</p>
    <div class="box"><b>Próximo passo:</b> compareça ao escritório da Romatec Consultoria Total — <b>${esc(ENDERECO_ROMATEC)}</b> — para a emissão da <b>anotação de responsabilidade técnica (TRT)</b> e para retirar a <b>via impressa e assinada</b> do mapa e do memorial descritivo. Leve um documento com foto.</div>
    <p>Atenciosamente,</p>
    <div class="ass"><div>${esc(cab.rt.nome)}</div>${esc(cab.rt.registro)}<br>Romatec Consultoria Total</div>`;
  const termo = quitado ? `<div class="quebra"></div>${cabecalho(cab, 'TERMO DE QUITAÇÃO')}
    <h2>Termo de quitação</h2>
    <p>A <b>ROMATEC CONSULTORIA TOTAL</b> (J R P BEZERRA LTDA, CNPJ 17.261.987/0001-09), com sede em ${esc(ENDERECO_ROMATEC)}, declara para os devidos fins que recebeu de <b>${esc(a?.nome)}</b>, CPF ${esc(a?.cpf)}, associado(a) nº ${esc(a?.numero)} do ${esc(p.nome)}, a totalidade dos valores referentes ao serviço técnico de levantamento georreferenciado e demarcação do <b>lote de produção LT-${esc(lote)}${den}</b> (lote da vila ${esc(a?.lote_vila)}), no total de <b>${brl(f.recebido)}</b>, conforme os pagamentos abaixo, dando plena, geral e irrevogável quitação dos valores do serviço.</p>
    <table><thead><tr><th>Data</th><th>Referência</th><th>Forma</th><th style="text-align:right">Valor</th></tr></thead><tbody>
      ${f.pagamentos.map((x) => `<tr><td>${dbr(x.data)}</td><td>${esc(x.item)}</td><td>${esc(x.forma)}</td><td style="text-align:right">${brl(x.valor)}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total recebido</b></td><td style="text-align:right"><b>${brl(f.recebido)}</b></td></tr></tbody></table>
    <p>A quitação refere-se exclusivamente ao serviço técnico contratado; serviços posteriores (certificação, CAR, CCIR, ITR e outros) serão cobrados à parte.</p>
    <p>Açailândia/MA, ${esc(hoje)}.</p>
    <div class="ass"><div>ROMATEC CONSULTORIA TOTAL — J R P BEZERRA LTDA</div>CNPJ 17.261.987/0001-09</div>` : '';
  const capa = await pdfDeHtml(`<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Dossiê LT-${esc(lote)}</title><style>${css}</style></head><body>${carta}${termo}</body></html>`);
  const mapa = await pdfSubdivisao(projetoId, [lote], false, 'tradicional');
  const out = await PDFDocument.create();
  for (const buf of [capa, mapa.pdf]) {
    const doc = await PDFDocument.load(buf);
    (await out.copyPages(doc, doc.getPageIndices())).forEach((pg) => out.addPage(pg));
  }
  return { pdf: Buffer.from(await out.save()), nome: `DOSSIE-LT-${lote}-${String(a?.nome ?? '').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toUpperCase()}.pdf`, quitado };
}

/** CEO autoriza: manda o dossiê pelo WhatsApp do sistema (só quitado). */
export async function enviarDossie(projetoId: number, lote: string, usuario: string | null) {
  const d = (await listarDossies(projetoId)).find((x) => x.lote === lote);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  if (d.status === 'AGUARDANDO_PAGAMENTO') throw new PaErro('AGUARDANDO_PAGAMENTO', `Ainda há ${brl(d.saldo)} em aberto — o dossiê só sai com tudo pago`, 409);
  if (!d.whatsapp_valido) throw new PaErro('SEM_WHATSAPP', 'Associado sem WhatsApp válido — entregue a via impressa', 409);
  const a = await one(pool, 'SELECT whatsapp_numero FROM pa_associados WHERE id = ?', [d.associado_id]);
  const r = await pdfDossie(projetoId, lote);
  const primeiro = d.nome.split(/\s+/)[0]; const nome = primeiro.charAt(0) + primeiro.slice(1).toLowerCase();
  const texto = [`Olá, ${nome}! Aqui é a Zayra, da Romatec Consultoria Total. 🌱`, ``, `A demarcação do seu lote *LT-${lote}* foi concluída. Segue o dossiê com o *mapa*, o *memorial descritivo* e o *termo de quitação*.`, ``, `📍 Compareça ao escritório da Romatec (${ENDERECO_ROMATEC}) para a emissão da *anotação técnica (TRT)* e para retirar a *via impressa*. Leve um documento com foto.`, ``, `Obrigada pela confiança!`].join('\n');
  const wa = await import('./paWhatsapp');
  await wa.enviarDocumentoNumero(String(a?.whatsapp_numero ?? ''), r.pdf, r.nome, texto);
  await exec(pool, "UPDATE pa_dossies SET status = 'ENVIADO', enviado_em = NOW(), enviado_por = ? WHERE projeto_id = ? AND lote = ? AND status <> 'ENTREGUE'", [usuario, projetoId, lote]);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: d.associado_id, usuario, tipo: 'DOSSIE_ENVIADO', dados: { lote } });
  return { lote, status: 'ENVIADO' as StatusDossie };
}

/** Secretária marca a entrega física da via impressa. */
export async function marcarEntregue(projetoId: number, lote: string, obs: unknown, usuario: string | null, nomeUsuario: string | null) {
  const o = obs ? String(obs).trim().slice(0, 255) || null : null;
  const r = await exec(pool, "UPDATE pa_dossies SET status = 'ENTREGUE', entregue_em = NOW(), entregue_por = ?, entregue_obs = ? WHERE projeto_id = ? AND lote = ?", [nomeUsuario ?? usuario, o, projetoId, lote]);
  if (!r.affectedRows) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'DOSSIE_ENTREGUE', dados: { lote, obs: o } });
  return { lote, status: 'ENTREGUE' as StatusDossie };
}
