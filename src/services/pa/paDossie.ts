// v3.169.0 — Dossiês de pronta entrega. Lote fechado em campo (MEDIDO) gera o dossiê.
// Status: AGUARDANDO_PAGAMENTO → PRONTO (tudo pago) → ENVIADO (WhatsApp) → ENTREGUE (via impressa).
//
// v3.170.0 (pedido do CEO, 16/11/2026):
//   • o dossiê só libera com o lote MEDIDO + contrato quitado + TAXA DE MARCOS paga (sem a taxa lançada não libera);
//   • acervo completo num PDF: capa · sumário e prazos · comunicado · mapa geral do PA · mapa individual +
//     memorial descritivo · planta + memorial modelo SIGEF · carteirinha do associado · termo de quitação
//     (valor acordado no contrato + taxa de marcos, com a lista de pagamentos);
//   • a mensagem orienta: retirar a carteirinha e solicitar a TRT no escritório → pagar o boleto da TRT →
//     voltar para retirar as vias impressas e assinadas;
//   • etapa da TRT (emitida → paga) acompanhada no sistema: a entrega das vias impressas só é marcada com a TRT paga;
//   • na entrega, sai sozinha a mensagem de conclusão (gratidão + versículo), em nome de José Romário.
import { PDFDocument } from 'pdf-lib';
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDate, isoDateTime, registrarEvento } from './paDb';
import { buscarProjeto } from './paRepo';
import { pdfSubdivisao, vinculosParcelas, dadosCabecalho } from './paMapas';
import { cabecalho, pdfDeHtml } from './mapasPdf';

export const ENDERECO_ROMATEC = 'Rua São Raimundo, n.º 10, Centro · Açailândia/MA · CEP 65.930-000';
export type StatusDossie = 'AGUARDANDO_PAGAMENTO' | 'PRONTO' | 'ENVIADO' | 'ENTREGUE';
/** Prazo para as vias impressas ficarem prontas depois da TRT paga (dias úteis). */
export const PRAZO_VIAS_DIAS_UTEIS = Number(process.env.PA_PRAZO_VIAS_DIAS) || 5;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dbr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const ROT: Record<string, string> = { SINAL: 'Sinal', AVISTA: 'À vista', BOLETO: 'Parcela', AJUSTE: 'Ajuste', MARCO: 'Taxa de marcos' };
const primeiroNome = (n: string) => { const p = String(n).trim().split(/\s+/)[0] || ''; return p.charAt(0) + p.slice(1).toLowerCase(); };

/**
 * Status pelo financeiro (pura — testável): enviado/entregue não voltam; o resto segue o saldo
 * e a taxa de marcos (v3.170.0: sem a taxa de marcos paga, não libera).
 */
export function statusPeloSaldo(atual: StatusDossie, saldo: number, marcosPagos = true): StatusDossie {
  if (atual === 'ENVIADO' || atual === 'ENTREGUE') return atual;
  return saldo > 0.009 || !marcosPagos ? 'AGUARDANDO_PAGAMENTO' : 'PRONTO';
}

/** O que ainda segura o dossiê (texto para a tela). */
export function pendenciaDossie(saldo: number, marcos: { lancados: number; pagos: boolean }): string | null {
  const p: string[] = [];
  if (!marcos.lancados) p.push('taxa de marcos ainda não lançada');
  else if (!marcos.pagos) p.push('taxa de marcos em aberto');
  if (saldo > 0.009) p.push(`${brl(saldo)} em aberto`);
  return p.length ? p.join(' · ') : null;
}

async function financeiro(aid: number) {
  const ls = await rows(pool, "SELECT tipo, parcela, valor, valor_recebido, status FROM pa_lancamentos WHERE associado_id = ? AND status <> 'CANCELADO' ORDER BY FIELD(tipo,'SINAL','AVISTA','BOLETO','AJUSTE','MARCO'), parcela", [aid]);
  const pags = await rows(pool, `SELECT p.pago_em, p.forma, r.valor, l.tipo, l.parcela FROM pa_pagamento_rateio r JOIN pa_pagamentos p ON p.id = r.pagamento_id
    JOIN pa_lancamentos l ON l.id = r.lancamento_id WHERE l.associado_id = ? ORDER BY p.pago_em`, [aid]);
  const total = ls.reduce((s, l) => s + num(l.valor), 0);
  const recebido = ls.reduce((s, l) => s + num(l.valor_recebido), 0);
  const marcosL = ls.filter((l) => l.tipo === 'MARCO');
  const contrato = ls.filter((l) => l.tipo !== 'MARCO').reduce((s, l) => s + num(l.valor), 0);
  return {
    saldo: Math.max(0, Math.round((total - recebido) * 100) / 100), total, recebido, contrato: Math.round(contrato * 100) / 100,
    marcos: { lancados: marcosL.length, pagos: marcosL.length > 0 && marcosL.every((l) => l.status === 'PAGO' || num(l.valor_recebido) >= num(l.valor) - 0.009), valor: marcosL.reduce((s, l) => s + num(l.valor), 0) },
    pagamentos: pags.map((p) => ({ data: isoDate(p.pago_em), forma: String(p.forma), valor: num(p.valor), item: `${ROT[String(p.tipo)] ?? p.tipo}${p.tipo === 'BOLETO' ? ' ' + num(p.parcela) : ''}` })),
  };
}

/** Cria o dossiê do lote (idempotente). Chamado quando o lote fecha em campo. */
export async function criarDossie(projetoId: number, lote: string, usuario: string | null) {
  const ben = (await vinculosParcelas(projetoId))[lote];
  if (!ben) throw new PaErro('LOTE_SEM_ASSOCIADO', `LT-${lote} não tem associado vinculado`, 409);
  const f = await financeiro(ben.associado_id);
  const st = statusPeloSaldo('PRONTO', f.saldo, f.marcos.pagos);
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
    const st = statusPeloSaldo(d.status as StatusDossie, f.saldo, f.marcos.pagos);
    if (st !== d.status) await exec(pool, 'UPDATE pa_dossies SET status = ? WHERE id = ?', [st, d.id]);
    out.push({
      lote: String(d.lote), associado_id: num(d.associado_id), nome: String(d.nome), numero: String(d.numero), lote_vila: String(d.lote_vila), denominacao: (d.denominacao_terra as string) ?? null,
      whatsapp_valido: d.whatsapp_status === 'VALIDO' && !!d.whatsapp_numero, status: st, saldo: f.saldo, marcos_pagos: f.marcos.pagos, marcos_lancados: f.marcos.lancados,
      pendencia: pendenciaDossie(f.saldo, f.marcos), medido_em: d.concluido_em ? isoDateTime(d.concluido_em) : null, medidor: (d.medidor as string) ?? null,
      gerado_em: isoDateTime(d.gerado_em), enviado_em: isoDateTime(d.enviado_em), enviado_por: (d.enviado_por as string) ?? null, entregue_em: isoDateTime(d.entregue_em), entregue_por: (d.entregue_por as string) ?? null, entregue_obs: (d.entregue_obs as string) ?? null,
      trt_numero: (d.trt_numero as string) ?? null, trt_emitida_em: isoDateTime(d.trt_emitida_em ?? null), trt_emitida_por: (d.trt_emitida_por as string) ?? null,
      trt_paga_em: isoDateTime(d.trt_paga_em ?? null), trt_paga_por: (d.trt_paga_por as string) ?? null, conclusao_enviada_em: isoDateTime(d.conclusao_enviada_em ?? null),
    });
  }
  return out.sort((a, b) => a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true }));
}

const CSS = `@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#1C1C18;font-size:10.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cab{display:flex;align-items:center;gap:4mm;background:linear-gradient(120deg,#0C3320,#14472B);color:#fff;border-radius:2.5mm;padding:3mm 4mm;border-bottom:1.2mm solid #C9A84C}
  .cab .lg{background:#fff;border-radius:1.5mm;padding:1mm 2mm;height:13mm;display:flex;align-items:center}.cab .lg img{height:11mm}.cab .em{height:15mm;width:15mm;border-radius:50%;background:#fff;padding:.5mm}
  .cab h1{margin:0;font-size:13pt}.cab .s{color:#E3D19A;font-size:8pt;margin-top:.8mm}.cab .t{flex:1}
  p{text-align:justify;line-height:1.55;margin:0 0 3.5mm;font-family:'Times New Roman',serif;font-size:11.5pt}
  h2{color:#0C3320;font-size:12pt;margin:6mm 0 3mm;text-align:center}
  table{width:100%;border-collapse:collapse;font-size:9pt;margin:2mm 0 4mm}th{background:#0C3320;color:#fff;padding:1.5mm;text-align:left}td{border-bottom:1px solid #ddd;padding:1.5mm}
  .ass{margin-top:16mm;text-align:center;font-size:9.5pt}.ass div{border-top:1px solid #333;width:90mm;margin:0 auto 1mm;padding-top:1mm}
  .quebra{page-break-before:always}.box{border:1px solid #C9A84C;border-radius:2mm;padding:3mm 4mm;background:#FBF8EE;margin:4mm 0}
  ol.passos{margin:2mm 0 0;padding-left:6mm;line-height:1.6;font-size:10.5pt}`;
const docHtml = (titulo: string, corpo: string) => `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>${corpo}</body></html>`;

/** Capa do dossiê (página inteira). */
function htmlCapa(o: { pa: string; municipio: string; associacao: string | null; lote: string; nome: string; numero: string; loteVila: string; denominacao: string | null; areaHa: number | null; rt: string; rtReg: string; data: string; logo: string; brasao: string }) {
  const area = o.areaHa ? `${o.areaHa.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ha · ${(o.areaHa / 4.84).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} alqueires` : '';
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .pg{width:210mm;height:297mm;background:linear-gradient(160deg,#0C3320 0%,#14472B 62%,#1e5a36 100%);color:#fff;position:relative;display:flex;flex-direction:column;align-items:center;padding:22mm 18mm 16mm;text-align:center}
    .faixa{position:absolute;left:0;right:0;top:0;height:5mm;background:#C9A84C}.faixa.b{top:auto;bottom:0}
    .lg{background:#fff;border-radius:3mm;padding:2.5mm 5mm;display:inline-block}.lg img{height:20mm;display:block}
    .bras{height:62mm;margin:12mm 0 6mm;filter:drop-shadow(0 1.5mm 3mm rgba(0,0,0,.4))}
    .kick{color:#E3D19A;letter-spacing:3px;font-size:10pt;text-transform:uppercase;margin-top:10mm}
    h1{font-size:26pt;margin:3mm 0 1mm;letter-spacing:.5px}h2{font-size:15pt;margin:0 0 6mm;color:#E3D19A;font-weight:400}
    .box{background:rgba(255,255,255,.08);border:1px solid rgba(201,168,76,.7);border-radius:3mm;padding:6mm 8mm;width:150mm;text-align:left;font-size:11pt;line-height:1.7}
    .box b{color:#E3D19A;font-weight:700;display:inline-block;width:42mm}
    .rod{margin-top:auto;font-size:8.5pt;color:#d9e6dd;line-height:1.6}.rod b{color:#fff}
  </style></head><body><div class="pg"><div class="faixa"></div><div class="faixa b"></div>
    ${o.logo ? `<div class="lg"><img src="${o.logo}"></div>` : ''}
    <div class="kick">Dossiê técnico do lote de produção</div>
    <h1>LOTE LT-${esc(o.lote)}</h1><h2>${esc(o.pa)}</h2>
    ${o.brasao ? `<img class="bras" src="${o.brasao}">` : '<div style="height:20mm"></div>'}
    <div class="box">
      <div><b>Associado(a)</b>${esc(o.nome)}</div>
      <div><b>Nº do associado</b>${esc(o.numero)} · lote da vila ${esc(o.loteVila)}</div>
      ${o.denominacao ? `<div><b>Denominação</b>“${esc(o.denominacao)}”</div>` : ''}
      ${area ? `<div><b>Área</b>${area}</div>` : ''}
      <div><b>Município</b>${esc(o.municipio)}</div>
      ${o.associacao ? `<div><b>Associação</b>${esc(o.associacao)}</div>` : ''}
      <div><b>Emissão</b>${esc(o.data)}</div>
    </div>
    <div class="rod"><b>Romatec Consultoria Total</b> · J R P BEZERRA LTDA · CNPJ 17.261.987/0001-09<br>${esc(ENDERECO_ROMATEC)}<br>Responsável técnico: ${esc(o.rt)} · ${esc(o.rtReg)}</div>
  </div></body></html>`;
}

/** Peça do acervo e quantas páginas tem (para o sumário). */
type Peca = { titulo: string; pdf: Buffer; paginas: number };
async function peca(titulo: string, pdf: Buffer, soPrimeira = false): Promise<Peca> {
  let buf = pdf;
  if (soPrimeira) {
    const src = await PDFDocument.load(pdf); const d = await PDFDocument.create();
    const [pg] = await d.copyPages(src, [0]); d.addPage(pg); buf = Buffer.from(await d.save());
  }
  return { titulo, pdf: buf, paginas: (await PDFDocument.load(buf)).getPageCount() };
}

/**
 * PDF do dossiê (acervo completo): capa · sumário e prazos · comunicado · mapa geral · mapa individual + memorial ·
 * planta + memorial SIGEF · carteirinha · termo de quitação.
 */
export async function pdfDossie(projetoId: number, lote: string): Promise<{ pdf: Buffer; nome: string; quitado: boolean }> {
  const p = await buscarProjeto(projetoId);
  const ben = (await vinculosParcelas(projetoId))[lote];
  if (!ben) throw new PaErro('LOTE_SEM_ASSOCIADO', `LT-${lote} não tem associado vinculado`, 404);
  const a = await one(pool, 'SELECT a.id, a.nome, a.cpf, a.numero, a.denominacao_terra, a.contrato_status, a.contrato_assinado_em, lt.numero lote_vila FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.id = ?', [ben.associado_id]);
  const c = await one(pool, 'SELECT * FROM pa_campo_lotes WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  const f = await financeiro(ben.associado_id);
  const quitado = f.saldo <= 0.009 && f.marcos.pagos;
  const cab = dadosCabecalho(p);
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
  const den = a?.denominacao_terra ? ` — "${esc(a.denominacao_terra)}"` : '';
  const areaHa = c?.area_ha != null ? num(c.area_ha) : null;

  // 1) capa
  const { readFileSync, existsSync } = await import('node:fs');
  const path = await import('node:path');
  const asset = (nome: string | null, mime: string) => {
    if (!nome) return '';
    const fp = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((x) => existsSync(x));
    return fp ? `data:${mime};base64,${readFileSync(fp).toString('base64')}` : '';
  };
  const capa = await peca('Capa', await pdfDeHtml(htmlCapa({
    pa: p.nome, municipio: `${p.municipio}/${p.uf}`, associacao: p.associacao_nome, lote, nome: String(a?.nome ?? ''), numero: String(a?.numero ?? ''), loteVila: String(a?.lote_vila ?? ''),
    denominacao: (a?.denominacao_terra as string) ?? null, areaHa, rt: cab.rt.nome, rtReg: cab.rt.registro, data: hoje,
    logo: asset('logo_romatec.jpg', 'image/jpeg'), brasao: asset(cab.marca.brasao, 'image/png'),
  })));

  // 3) comunicado
  const carta = await peca('Comunicado de conclusão da demarcação e próximos passos', await pdfDeHtml(docHtml(`Dossiê LT-${lote}`, `${cabecalho(cab, `DOSSIÊ DO LOTE LT-${lote}`)}
    <h2>Comunicado de conclusão da demarcação</h2>
    <p>Açailândia/MA, ${esc(hoje)}.</p>
    <p>Prezado(a) <b>${esc(a?.nome)}</b>, associado(a) nº ${esc(a?.numero)} do ${esc(p.nome)} (lote da vila ${esc(a?.lote_vila)}),</p>
    <p>Informamos que a <b>locação e demarcação do seu lote de produção LT-${esc(lote)}${den}</b> foi concluída em campo${c ? ` em ${dbr(isoDate(c.concluido_em))}` : ''}${areaHa ? `, com área de <b>${areaHa.toLocaleString('pt-BR', { minimumFractionDigits: 4 })} ha</b>` : ''}${c?.perimetro_m ? ` e perímetro de ${num(c.perimetro_m).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} m` : ''}, com os marcos de concreto cravados nos vértices.</p>
    <p>Este dossiê reúne o <b>mapa geral do assentamento</b>, o <b>mapa e o memorial descritivo</b> do seu lote (modelo tradicional e <b>modelo SIGEF</b>), a sua <b>carteirinha de associado(a)</b> e o <b>termo de quitação</b> dos valores acordados.</p>
    <div class="box"><b>Próximos passos:</b>
      <ol class="passos">
        <li>Compareça ao escritório da Romatec Consultoria Total — <b>${esc(ENDERECO_ROMATEC)}</b> — com um documento com foto, para <b>retirar a carteirinha de associado(a)</b> e solicitar a emissão da <b>TRT (Termo de Responsabilidade Técnica)</b> do seu lote.</li>
        <li>Você receberá o <b>boleto da TRT</b> para pagamento.</li>
        <li>Após a confirmação do pagamento da TRT, as <b>vias impressas e assinadas</b> do mapa e do memorial descritivo ficam prontas em até ${PRAZO_VIAS_DIAS_UTEIS} dias úteis — retorne ao escritório para retirá-las.</li>
      </ol></div>
    <p>Atenciosamente,</p>
    <div class="ass"><div>${esc(cab.rt.nome)}</div>${esc(cab.rt.registro)}<br>Romatec Consultoria Total</div>`)));

  // 4–6) mapas e memoriais
  const geral = await peca('Mapa geral do assentamento (subdivisão em lotes)', (await pdfSubdivisao(projetoId, [], true, 'tradicional')).pdf, true);
  const individual = await peca(`Mapa individual e memorial descritivo do LT-${lote}`, (await pdfSubdivisao(projetoId, [lote], false, 'tradicional')).pdf);
  const sigef = await peca(`Planta e memorial descritivo do LT-${lote} — modelo SIGEF`, (await pdfSubdivisao(projetoId, [lote], false, 'sigef')).pdf);

  // 7) carteirinha (sem marcar "emitida" — só visualização dentro do dossiê)
  let carteirinha: Peca | null = null;
  try {
    const ct = await import('./paCarteirinha');
    const { projeto, itens } = await ct.dadosCarteirinhas(projetoId, [ben.associado_id]);
    const emissao = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const { htmlToPdf } = await import('../../pdf/htmlToPdf');
    carteirinha = await peca('Carteirinha de associado(a)', await htmlToPdf(await ct.htmlCarteirinhas(projeto, itens, emissao, 'pdf'), { format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } }));
  } catch (e) { console.warn('[pa-dossie] carteirinha:', (e as Error).message); }

  // 8) termo de quitação (valor acordado no contrato + taxa de marcos)
  const termo = quitado ? await peca('Termo de quitação', await pdfDeHtml(docHtml('Termo de quitação', `${cabecalho(cab, 'TERMO DE QUITAÇÃO')}
    <h2>Termo de quitação</h2>
    <p>A <b>ROMATEC CONSULTORIA TOTAL</b> (J R P BEZERRA LTDA, CNPJ 17.261.987/0001-09), com sede em ${esc(ENDERECO_ROMATEC)}, declara para os devidos fins que recebeu de <b>${esc(a?.nome)}</b>, CPF ${esc(a?.cpf)}, associado(a) nº ${esc(a?.numero)} do ${esc(p.nome)}, a totalidade dos valores referentes ao serviço técnico de levantamento georreferenciado e demarcação do <b>lote de produção LT-${esc(lote)}${den}</b> (lote da vila ${esc(a?.lote_vila)}): o valor acordado no <b>contrato de prestação de serviços</b>${a?.contrato_status === 'ASSINADO' && a?.contrato_assinado_em ? ` assinado em ${dbr(isoDate(a.contrato_assinado_em))}` : ''}, de <b>${brl(f.contrato)}</b>${f.marcos.lancados ? `, e a <b>taxa dos marcos de concreto</b>, de <b>${brl(f.marcos.valor)}</b>` : ''} — total recebido de <b>${brl(f.recebido)}</b>, conforme os pagamentos abaixo — dando plena, geral e irrevogável quitação dos valores do serviço.</p>
    <table><thead><tr><th>Data</th><th>Referência</th><th>Forma</th><th style="text-align:right">Valor</th></tr></thead><tbody>
      ${f.pagamentos.map((x) => `<tr><td>${dbr(x.data)}</td><td>${esc(x.item)}</td><td>${esc(x.forma)}</td><td style="text-align:right">${brl(x.valor)}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total recebido</b></td><td style="text-align:right"><b>${brl(f.recebido)}</b></td></tr></tbody></table>
    <p>A quitação refere-se exclusivamente ao serviço técnico contratado; a TRT e serviços posteriores (certificação, CAR, CCIR, ITR e outros) serão cobrados à parte.</p>
    <p>Açailândia/MA, ${esc(hoje)}.</p>
    <div class="ass"><div>ROMATEC CONSULTORIA TOTAL — J R P BEZERRA LTDA</div>CNPJ 17.261.987/0001-09</div>`))) : null;

  const corpo = [carta, geral, individual, sigef, carteirinha, termo].filter((x): x is Peca => !!x);
  // 2) sumário e prazos (as páginas contam a capa e o próprio sumário)
  let pagina = 3;
  const itens = corpo.map((x) => { const ini = pagina; pagina += x.paginas; return { titulo: x.titulo, de: ini, ate: pagina - 1 }; });
  const sumario = await peca('Sumário', await pdfDeHtml(docHtml('Sumário', `${cabecalho(cab, `DOSSIÊ DO LOTE LT-${lote} — SUMÁRIO`)}
    <h2>Sumário do dossiê</h2>
    <table><thead><tr><th>#</th><th>Documento</th><th style="text-align:right">Páginas</th></tr></thead><tbody>
      <tr><td>1</td><td>Capa</td><td style="text-align:right">1</td></tr><tr><td>2</td><td>Sumário e prazos</td><td style="text-align:right">2</td></tr>
      ${itens.map((x, i) => `<tr><td>${i + 3}</td><td>${esc(x.titulo)}</td><td style="text-align:right">${x.de === x.ate ? x.de : `${x.de}–${x.ate}`}</td></tr>`).join('')}
    </tbody></table>
    <h2>Prazos e etapas da entrega</h2>
    <table><thead><tr><th>Etapa</th><th>Situação / prazo</th></tr></thead><tbody>
      <tr><td>Demarcação do lote em campo</td><td>Concluída${c ? ` em ${dbr(isoDate(c.concluido_em))}` : ''}</td></tr>
      <tr><td>Pagamentos do contrato e taxa de marcos</td><td>${quitado ? 'Quitados' : 'Pendentes'}</td></tr>
      <tr><td>Entrega digital deste dossiê</td><td>${esc(hoje)}</td></tr>
      <tr><td>Retirada da carteirinha e solicitação da TRT</td><td>No escritório da Romatec, com documento com foto</td></tr>
      <tr><td>Pagamento do boleto da TRT</td><td>Até o vencimento do boleto</td></tr>
      <tr><td>Retirada das vias impressas e assinadas</td><td>Em até ${PRAZO_VIAS_DIAS_UTEIS} dias úteis após a confirmação do pagamento da TRT</td></tr>
    </tbody></table>
    <p style="font-size:9.5pt">Escritório: ${esc(ENDERECO_ROMATEC)}. Documentos elaborados conforme NBR 13133 (execução de levantamento topográfico) e NBR 17047 (levantamento cadastral territorial), coordenadas no Sistema Geodésico Brasileiro (SIRGAS 2000).</p>`)));

  const out = await PDFDocument.create();
  for (const pc of [capa, sumario, ...corpo]) {
    const doc = await PDFDocument.load(pc.pdf);
    (await out.copyPages(doc, doc.getPageIndices())).forEach((pg) => out.addPage(pg));
  }
  return { pdf: Buffer.from(await out.save()), nome: `DOSSIE-LT-${lote}-${String(a?.nome ?? '').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toUpperCase()}.pdf`, quitado };
}

/** Mensagem que acompanha o dossiê no WhatsApp (pura — testável). */
export function textoEnvioDossie(nome: string, lote: string): string {
  return [
    `Olá, ${primeiroNome(nome)}! Aqui é a Zayra, da Romatec Consultoria Total. 🌱`,
    '',
    `A demarcação do seu lote *LT-${lote}* foi concluída e os pagamentos estão quitados. Segue o seu *dossiê digital*, com:`,
    '• mapa geral do assentamento;',
    '• mapa e memorial descritivo do seu lote (modelo tradicional e modelo SIGEF);',
    '• sua *carteirinha de associado(a)*;',
    '• *termo de quitação* dos valores acordados.',
    '',
    '*Próximos passos:*',
    `1️⃣ Compareça ao escritório da Romatec (${ENDERECO_ROMATEC}) com um documento com foto para *retirar a carteirinha* e solicitar a *TRT (Termo de Responsabilidade Técnica)* do seu lote.`,
    '2️⃣ Você recebe o *boleto da TRT* para pagar.',
    `3️⃣ Depois do pagamento da TRT, as *vias impressas e assinadas* do mapa e do memorial ficam prontas em até ${PRAZO_VIAS_DIAS_UTEIS} dias úteis — é só voltar ao escritório para retirar.`,
    '',
    'Obrigada pela confiança!',
  ].join('\n');
}

/** Número do CEO para a cópia do dossiê (mesma configuração do atendimento automático). */
const numeroCeo = () => String(process.env.CEO_WHATSAPP_PHONE || process.env.PA_CONTATO_WHATSAPP || process.env.ROMATEC_CONTATO_WHATSAPP || '(99) 99181-1246').replace(/\D/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1');

/**
 * Envia o dossiê ao associado (WhatsApp cadastrado) e uma cópia ao CEO.
 * v3.169.2: sai sozinho quando o lote está medido e TODAS as cobranças do associado estão pagas;
 * o botão do ADMIN fica para reenviar. A trava (UPDATE … WHERE status) evita envio em dobro.
 */
export async function enviarDossie(projetoId: number, lote: string, usuario: string | null, automatico = false) {
  const d = (await listarDossies(projetoId)).find((x) => x.lote === lote);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  if (d.status === 'AGUARDANDO_PAGAMENTO') throw new PaErro('AGUARDANDO_PAGAMENTO', `Dossiê travado: ${d.pendencia ?? 'pagamentos pendentes'} — só sai com o contrato e a taxa de marcos pagos`, 409);
  if (!d.whatsapp_valido) throw new PaErro('SEM_WHATSAPP', 'Associado sem WhatsApp válido — entregue a via impressa', 409);
  const quem = automatico ? 'automatico' : usuario;
  // trava: só um envio por vez (automático não reenvia o que já saiu)
  const trava = await exec(pool, `UPDATE pa_dossies SET status = 'ENVIADO', enviado_em = NOW(), enviado_por = ? WHERE projeto_id = ? AND lote = ? AND status ${automatico ? "= 'PRONTO'" : "IN ('PRONTO','ENVIADO')"}`, [quem, projetoId, lote]);
  if (!trava.affectedRows) return { lote, status: d.status, enviado: false };
  try {
    const a = await one(pool, 'SELECT whatsapp_numero FROM pa_associados WHERE id = ?', [d.associado_id]);
    const r = await pdfDossie(projetoId, lote);
    const wa = await import('./paWhatsapp');
    await wa.enviarDocumentoNumero(String(a?.whatsapp_numero ?? ''), r.pdf, r.nome, textoEnvioDossie(d.nome, lote));
    // cópia para o CEO (falha aqui não desfaz o envio ao associado)
    try { await wa.enviarDocumentoNumero(numeroCeo(), r.pdf, r.nome, `📋 Cópia — dossiê do *LT-${lote}* enviado para *${d.nome}* (vila ${d.lote_vila})${automatico ? ' automaticamente após a quitação' : ''}.`); }
    catch (e) { console.warn('[pa-dossie] cópia CEO:', (e as Error).message); }
    await registrarEvento(pool, { projeto_id: projetoId, associado_id: d.associado_id, usuario: quem, tipo: 'DOSSIE_ENVIADO', dados: { lote, automatico } });
    return { lote, status: 'ENVIADO' as StatusDossie, enviado: true };
  } catch (e) {
    // não saiu: volta para PRONTO para tentar de novo (pagamento seguinte ou botão)
    await exec(pool, "UPDATE pa_dossies SET status = ?, enviado_em = ?, enviado_por = ? WHERE projeto_id = ? AND lote = ?", [d.status === 'ENVIADO' ? 'ENVIADO' : 'PRONTO', d.enviado_em, d.enviado_por, projetoId, lote]);
    await registrarEvento(pool, { projeto_id: projetoId, associado_id: d.associado_id, usuario: quem, tipo: 'DOSSIE_FALHA_ENVIO', dados: { lote, erro: (e as Error).message.slice(0, 200) } });
    throw e;
  }
}

/** Dispara sozinho os dossiês que ficaram PRONTOS (lote medido + tudo pago). Chamado após pagamento e ao fechar lote. */
export async function enviarProntos(projetoId: number, associadoIds: number[] | null = null) {
  const ds = (await listarDossies(projetoId)).filter((d) => d.status === 'PRONTO' && d.whatsapp_valido && (!associadoIds || associadoIds.includes(d.associado_id)));
  const out: Array<{ lote: string; ok: boolean; erro?: string }> = [];
  for (const d of ds) {
    try { const r = await enviarDossie(projetoId, d.lote, null, true); if (r.enviado) out.push({ lote: d.lote, ok: true }); }
    catch (e) { out.push({ lote: d.lote, ok: false, erro: (e as Error).message.slice(0, 160) }); console.warn('[pa-dossie] envio automático LT-' + d.lote + ':', (e as Error).message); }
  }
  return out;
}

// ─── v3.170.0: etapa da TRT ────────────────────────────────────────────────
/** Registra a TRT emitida (com o número) ou paga. Só depois do dossiê enviado/entregue em mãos. */
export async function registrarTrt(projetoId: number, lote: string, acao: unknown, numero: unknown, usuario: string | null, nomeUsuario: string | null) {
  const d = await one(pool, 'SELECT * FROM pa_dossies WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  if (d.status === 'AGUARDANDO_PAGAMENTO') throw new PaErro('AGUARDANDO_PAGAMENTO', 'O dossiê ainda está travado pelos pagamentos — a TRT vem depois', 409);
  const quem = nomeUsuario ?? usuario;
  if (acao === 'emitida') {
    const n = numero ? String(numero).trim().slice(0, 40) || null : null;
    await exec(pool, 'UPDATE pa_dossies SET trt_emitida_em = COALESCE(trt_emitida_em, NOW()), trt_emitida_por = COALESCE(trt_emitida_por, ?), trt_numero = COALESCE(?, trt_numero) WHERE id = ?', [quem, n, d.id]);
  } else if (acao === 'paga') {
    if (!d.trt_emitida_em) throw new PaErro('TRT_NAO_EMITIDA', 'Registre a TRT emitida antes de marcar o pagamento', 409);
    await exec(pool, 'UPDATE pa_dossies SET trt_paga_em = COALESCE(trt_paga_em, NOW()), trt_paga_por = COALESCE(trt_paga_por, ?) WHERE id = ?', [quem, d.id]);
  } else throw new PaErro('CAMPO_INVALIDO', 'Ação da TRT inválida (emitida | paga)', 400);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: num(d.associado_id), usuario, tipo: acao === 'emitida' ? 'DOSSIE_TRT_EMITIDA' : 'DOSSIE_TRT_PAGA', dados: { lote, numero: numero ?? null } });
  return { lote, acao };
}

// ─── v3.170.0: mensagem de conclusão (gratidão + versículo), em nome de José Romário ─
export const VERSICULOS_CONCLUSAO: ReadonlyArray<{ texto: string; ref: string }> = [
  { texto: 'Entrega o teu caminho ao Senhor; confia nele, e ele tudo fará.', ref: 'Salmos 37:5' },
  { texto: 'Confia no Senhor e faze o bem; habitarás na terra e, verdadeiramente, serás alimentado.', ref: 'Salmos 37:3' },
  { texto: 'Tendo por certo isto mesmo: que aquele que em vós começou a boa obra a aperfeiçoará até ao Dia de Jesus Cristo.', ref: 'Filipenses 1:6' },
  { texto: 'E seja sobre nós a graça do Senhor, nosso Deus; e confirma sobre nós a obra das nossas mãos.', ref: 'Salmos 90:17' },
  { texto: 'O Senhor te abençoe e te guarde; o Senhor faça resplandecer o seu rosto sobre ti e tenha misericórdia de ti; o Senhor sobre ti levante o seu rosto e te dê a paz.', ref: 'Números 6:24-26' },
  { texto: 'Em tudo dai graças, porque esta é a vontade de Deus em Cristo Jesus para convosco.', ref: '1 Tessalonicenses 5:18' },
];

/** Mensagem de conclusão do processo (pura — testável). */
export function textoConclusao(nome: string, lote: string, pa: string, seed: number): string {
  const v = VERSICULOS_CONCLUSAO[Math.abs(seed) % VERSICULOS_CONCLUSAO.length];
  return [
    `Olá, ${primeiroNome(nome)}! 🙏`,
    '',
    `Com muita alegria, concluímos todas as etapas do processo do seu lote de produção *LT-${lote}* no ${pa}: a demarcação em campo com os marcos, os mapas e memoriais, a carteirinha de associado(a), a TRT e a entrega das vias impressas.`,
    '',
    'Em nome da Romatec Consultoria Total, agradeço de coração pela confiança no nosso trabalho e pela parceria em cada fase. Que esta terra seja lugar de sustento, de paz e de muitas colheitas para você e sua família.',
    '',
    `📖 _"${v.texto}"_ (${v.ref})`,
    '',
    'Conte sempre conosco. Deus abençoe!',
    '',
    'Com gratidão,',
    '*José Romário Pinto Bezerra*',
    'Romatec Consultoria Total',
  ].join('\n');
}

/** Envia a mensagem de conclusão uma única vez (trava no banco). Nunca lança. */
export async function enviarConclusao(projetoId: number, lote: string): Promise<{ enviado: boolean; motivo?: string }> {
  const trava = await exec(pool, 'UPDATE pa_dossies SET conclusao_enviada_em = NOW() WHERE projeto_id = ? AND lote = ? AND conclusao_enviada_em IS NULL', [projetoId, lote]);
  if (!trava.affectedRows) return { enviado: false, motivo: 'já enviada' };
  const d = await one(pool, `SELECT d.id, d.associado_id, a.nome, a.whatsapp_status, a.whatsapp_numero, p.nome pa FROM pa_dossies d JOIN pa_associados a ON a.id = d.associado_id
    JOIN pa_projetos p ON p.id = d.projeto_id WHERE d.projeto_id = ? AND d.lote = ?`, [projetoId, lote]);
  if (!d || d.whatsapp_status !== 'VALIDO' || !d.whatsapp_numero) {
    await exec(pool, 'UPDATE pa_dossies SET conclusao_enviada_em = NULL WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
    return { enviado: false, motivo: 'associado sem WhatsApp válido' };
  }
  try {
    const wa = await import('./paWhatsapp');
    await wa.enviarWhatsAppAssociado(num(d.associado_id), textoConclusao(String(d.nome), lote, String(d.pa), num(d.id)), 'CONCLUSAO_PROCESSO', 'automatico');
    return { enviado: true };
  } catch (e) {
    await exec(pool, 'UPDATE pa_dossies SET conclusao_enviada_em = NULL WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
    console.warn('[pa-dossie] conclusão LT-' + lote + ':', (e as Error).message);
    return { enviado: false, motivo: (e as Error).message.slice(0, 160) };
  }
}

/** Secretária marca a entrega física das vias impressas (só com a TRT paga) → mensagem de conclusão sai sozinha. */
export async function marcarEntregue(projetoId: number, lote: string, obs: unknown, usuario: string | null, nomeUsuario: string | null) {
  const d = await one(pool, 'SELECT status, trt_paga_em FROM pa_dossies WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  if (d.status === 'AGUARDANDO_PAGAMENTO') throw new PaErro('AGUARDANDO_PAGAMENTO', 'Dossiê travado pelos pagamentos — não pode ser entregue', 409);
  if (!d.trt_paga_em) throw new PaErro('TRT_NAO_PAGA', 'As vias impressas só são entregues depois da TRT paga — registre a TRT emitida e paga', 409);
  const o = obs ? String(obs).trim().slice(0, 255) || null : null;
  await exec(pool, "UPDATE pa_dossies SET status = 'ENTREGUE', entregue_em = NOW(), entregue_por = ?, entregue_obs = ? WHERE projeto_id = ? AND lote = ?", [nomeUsuario ?? usuario, o, projetoId, lote]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'DOSSIE_ENTREGUE', dados: { lote, obs: o } });
  const conclusao = await enviarConclusao(projetoId, lote);
  return { lote, status: 'ENTREGUE' as StatusDossie, conclusao };
}
