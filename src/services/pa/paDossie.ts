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
import { lancamentoQuitado } from './regrasFinanceiras';
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
    marcos: { lancados: marcosL.length, pagos: marcosL.length > 0 && marcosL.every((l) => lancamentoQuitado({ valor: l.valor, valor_recebido: l.valor_recebido, status: l.status })), valor: marcosL.reduce((s, l) => s + num(l.valor), 0) },
    pagamentos: pags.map((p) => ({ data: isoDate(p.pago_em), forma: String(p.forma), valor: num(p.valor), tipo: String(p.tipo), item: `${ROT[String(p.tipo)] ?? p.tipo}${p.tipo === 'BOLETO' ? ' ' + num(p.parcela) : ''}` })),
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
      revisao_enviada_em: isoDateTime(d.revisao_enviada_em ?? null),
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
/** v3.187.0: contrato assinado do associado (gov.br, ou a ficha + contrato digitalizada) como peça do dossiê. */
async function contratoAssinado(aid: number): Promise<Peca | null> {
  const d = await one(pool, `SELECT id, tipo, mime FROM pa_documentos WHERE associado_id = ? AND arquivo_presente = 1 AND tipo IN ('PROCESSO_ASSINADO','PROCESSO_FICHA_CONTRATO')
    ORDER BY FIELD(tipo, 'PROCESSO_ASSINADO', 'PROCESSO_FICHA_CONTRATO'), versao DESC, id DESC LIMIT 1`, [aid]).catch(() => null);
  if (!d) return null;
  const f = await one<{ conteudo: Buffer }>(pool, 'SELECT conteudo FROM pa_documentos_arquivos WHERE documento_id = ?', [d.id]).catch(() => null);
  if (!f?.conteudo) return null;
  const titulo = d.tipo === 'PROCESSO_ASSINADO' ? 'Contrato assinado (gov.br)' : 'Ficha e contrato assinados';
  const mime = String(d.mime || '');
  try {
    if (/pdf/i.test(mime) || f.conteudo.subarray(0, 4).toString() === '%PDF') return await peca(titulo, Buffer.from(f.conteudo));
    if (/image\/(jpe?g|png)/i.test(mime)) {
      const doc = await PDFDocument.create();
      const img = /png/i.test(mime) ? await doc.embedPng(f.conteudo) : await doc.embedJpg(f.conteudo);
      const pg = doc.addPage([595.28, 841.89]);
      const esc2 = Math.min((595.28 - 56) / img.width, (841.89 - 56) / img.height);
      pg.drawImage(img, { x: (595.28 - img.width * esc2) / 2, y: (841.89 - img.height * esc2) / 2, width: img.width * esc2, height: img.height * esc2 });
      return await peca(titulo, Buffer.from(await doc.save()));
    }
  } catch (e) { console.warn('[pa-dossie] contrato:', (e as Error).message); }
  return null;
}

/** v3.187.0: capa final (contracapa) com os próximos passos: TRT, pagamento e vias impressas. */
function htmlCapaFinal(o: { pa: string; municipio: string; lote: string; nome: string; rt: string; rtReg: string; data: string; logo: string; brasao: string }): string {
  return docHtml('Capa final', `<div style="min-height:262mm;display:flex;flex-direction:column;justify-content:space-between;border:2.5mm solid #0C3320;border-radius:4mm;padding:14mm 12mm;outline:.8mm solid #C9A84C;outline-offset:-5mm">
    <div style="text-align:center">${o.brasao ? `<img src="${o.brasao}" style="height:30mm">` : ''}
      <div style="font-size:11pt;letter-spacing:2px;color:#7A5B12;margin-top:6mm">${esc(o.pa.toUpperCase())} · ${esc(o.municipio)}</div>
      <h1 style="color:#0C3320;font-size:22pt;margin:6mm 0 2mm">Próximos passos</h1>
      <div style="font-size:12pt">Lote de produção <b>LT-${esc(o.lote)}</b> · ${esc(o.nome)}</div></div>
    <div style="font-size:12pt;line-height:1.6">
      <div style="background:#FFF4DC;border:1.2mm solid #C9A84C;border-radius:3mm;padding:6mm 7mm">
        <b style="color:#0C3320;font-size:14pt">Compareça ao escritório da Romatec</b><br>${esc(ENDERECO_ROMATEC)}<br>Leve um <b>documento com foto</b>.
        <ol style="margin:4mm 0 0;padding-left:6mm">
          <li><b>Solicitar a TRT</b> — Termo de Responsabilidade Técnica do seu lote.</li>
          <li><b>Recolher o valor da TRT</b> — você recebe o boleto e faz o pagamento.</li>
          <li><b>Retirar as vias impressas e assinadas</b> do mapa e do memorial descritivo — prontas em até ${PRAZO_VIAS_DIAS_UTEIS} dias úteis após a confirmação do pagamento da TRT.</li>
          <li><b>Retirar a carteirinha de associado(a)</b> impressa.</li>
        </ol></div>
      <p style="margin-top:6mm;font-size:10.5pt;color:#444">Este dossiê digital tem valor informativo. As vias oficiais são as impressas e assinadas pelo responsável técnico, entregues após a TRT.</p></div>
    <div style="text-align:center">${o.logo ? `<img src="${o.logo}" style="height:16mm">` : ''}
      <div style="margin-top:3mm;font-size:10.5pt"><b>${esc(o.rt)}</b><br>${esc(o.rtReg)}<br>Romatec Consultoria Total · Açailândia/MA · ${esc(o.data)}</div></div></div>`);
}

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

  // 1) capa
  const { readFileSync, existsSync } = await import('node:fs');
  const path = await import('node:path');
  const asset = (nome: string | null, mime: string) => {
    if (!nome) return '';
    const fp = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((x) => existsSync(x));
    return fp ? `data:${mime};base64,${readFileSync(fp).toString('base64')}` : '';
  };
  // v3.188.0: capa padrão aprovada (Capa_Dossie_LT-05_Salete_Moreno_Romatec.pdf) — mesmo gerador da capa avulsa
  const lp = await import('./paLotesProducao');
  const { pdfCapaDossie } = await import('./paCapaDossie');
  const capa = await peca('Capa', await pdfCapaDossie(await lp.dadosCapaLote(projetoId, await lp.buscarLoteProducao(projetoId, lote))));

  // v3.187.0: ordem do dossiê — capa → sumário → mapa e memorial (tradicional) → planta e memorial (SIGEF)
  // → contrato assinado → termo de quitação com extrato (contrato + taxa de marcos) → carteirinha → capa final
  const individual = await peca(`Mapa e memorial descritivo do LT-${lote} — modelo tradicional`, (await pdfSubdivisao(projetoId, [lote], false, 'tradicional')).pdf);
  const sigef = await peca(`Planta e memorial descritivo do LT-${lote} — modelo SIGEF`, (await pdfSubdivisao(projetoId, [lote], false, 'sigef')).pdf);
  const contrato = await contratoAssinado(ben.associado_id);

  // 7) carteirinha (sem marcar "emitida" — só visualização dentro do dossiê)
  let carteirinha: Peca | null = null;
  try {
    const ct = await import('./paCarteirinha');
    const { projeto, itens } = await ct.dadosCarteirinhas(projetoId, [ben.associado_id]);
    const emissao = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const { htmlToPdf } = await import('../../pdf/htmlToPdf');
    carteirinha = await peca('Carteirinha de associado(a)', await htmlToPdf(await ct.htmlCarteirinhas(projeto, itens, emissao, 'pdf'), { format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } }));
  } catch (e) { console.warn('[pa-dossie] carteirinha:', (e as Error).message); }

  // 8) termo de quitação do contrato (valor acordado) com extrato dos pagamentos do contrato e da taxa de marcos
  const pgContrato = f.pagamentos.filter((x) => x.tipo !== 'MARCO'), pgMarcos = f.pagamentos.filter((x) => x.tipo === 'MARCO');
  const tabela = (ls: typeof f.pagamentos, rot: string) => `<table><thead><tr><th>Data</th><th>Referência</th><th>Forma</th><th style="text-align:right">Valor</th></tr></thead><tbody>
      ${ls.map((x) => `<tr><td>${dbr(x.data)}</td><td>${esc(x.item)}</td><td>${esc(x.forma)}</td><td style="text-align:right">${brl(x.valor)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}
      <tr><td colspan="3"><b>${rot}</b></td><td style="text-align:right"><b>${brl(ls.reduce((t, x) => t + x.valor, 0))}</b></td></tr></tbody></table>`;
  const termo = quitado ? await peca('Termo de quitação e extrato de pagamentos', await pdfDeHtml(docHtml('Termo de quitação', `${cabecalho(cab, 'TERMO DE QUITAÇÃO')}
    <h2>Termo de quitação</h2>
    <p>A <b>ROMATEC CONSULTORIA TOTAL</b> (J R P BEZERRA LTDA, CNPJ 17.261.987/0001-09), com sede em ${esc(ENDERECO_ROMATEC)}, declara para os devidos fins que <b>${esc(a?.nome)}</b>, CPF ${esc(a?.cpf)}, associado(a) nº ${esc(a?.numero)} do ${esc(p.nome)}, lote de produção <b>LT-${esc(lote)}</b>${den}, <b>quitou integralmente o valor do contrato de prestação de serviços técnicos de ${brl(f.contrato)}</b>${f.marcos.valor > 0 ? ` e a <b>taxa dos marcos de concreto de ${brl(f.marcos.valor)}</b>` : ''}, conforme o extrato abaixo, nada mais havendo a reclamar a esse título.</p>
    <h2 style="margin-top:14px">Extrato — contrato (${brl(f.contrato)})</h2>
    ${tabela(pgContrato, 'Total do contrato pago')}
    ${f.marcos.valor > 0 ? `<h2 style="margin-top:14px">Extrato — taxa dos marcos de concreto (${brl(f.marcos.valor)})</h2>${tabela(pgMarcos, 'Total da taxa de marcos paga')}` : ''}
    <p style="margin-top:12px"><b>Total recebido: ${brl(f.recebido)}</b></p>
    <p>A quitação refere-se exclusivamente ao serviço técnico contratado e à taxa de marcos; a <b>TRT (Termo de Responsabilidade Técnica)</b> e serviços posteriores (certificação, CAR, CCIR, ITR e outros) são cobrados à parte.</p>
    <p>Açailândia/MA, ${esc(hoje)}.</p>
    <div class="ass"><div>ROMATEC CONSULTORIA TOTAL — J R P BEZERRA LTDA</div>CNPJ 17.261.987/0001-09</div>`))) : null;

  // 9) capa final — encerramento com os próximos passos
  const capaFinal = await peca('Capa final — próximos passos', await pdfDeHtml(htmlCapaFinal({
    pa: p.nome, municipio: `${p.municipio}/${p.uf}`, lote, nome: String(a?.nome ?? ''), rt: cab.rt.nome, rtReg: cab.rt.registro, data: hoje,
    logo: asset('logo_romatec.jpg', 'image/jpeg'), brasao: asset(cab.marca.brasao, 'image/png'),
  })));

  const corpo = [individual, sigef, contrato, termo, carteirinha, capaFinal].filter((x): x is Peca => !!x);
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
      <tr><td>Contrato assinado</td><td>${contrato ? 'Anexado a este dossiê' : 'Não anexado no sistema — via física no escritório'}</td></tr>
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
    `A demarcação do seu lote *LT-${lote}* foi concluída e os pagamentos estão quitados. ✅ Segue o seu *dossiê digital* em PDF, com:`,
    '• mapa e memorial descritivo do lote (modelo tradicional);',
    '• planta e memorial descritivo no *modelo SIGEF*;',
    '• o seu *contrato assinado*;',
    '• *termo de quitação* com o extrato dos pagamentos (contrato e taxa de marcos);',
    '• a sua *carteirinha de associado(a)*.',
    '',
    '⚠️ *IMPORTANTE — compareça ao escritório da Romatec*',
    `📍 ${ENDERECO_ROMATEC}`,
    'Leve um *documento com foto* para:',
    '1️⃣ *Solicitar a TRT* (Termo de Responsabilidade Técnica) do seu lote;',
    '2️⃣ *Recolher o valor da TRT e fazer o pagamento*;',
    `3️⃣ *Pegar as vias impressas e assinadas* do mapa e do memorial — ficam prontas em até ${PRAZO_VIAS_DIAS_UTEIS} dias úteis após o pagamento da TRT.`,
    '',
    'As vias oficiais são as impressas e assinadas pelo responsável técnico. Sem a TRT paga, elas não são liberadas.',
    '',
    'Obrigada pela confiança! 🙏',
  ].join('\n');
}

/** Número do CEO para a cópia do dossiê (mesma configuração do atendimento automático). */
export const numeroCeo = () => String(process.env.CEO_WHATSAPP_PHONE || process.env.PA_CONTATO_WHATSAPP || process.env.ROMATEC_CONTATO_WHATSAPP || '(99) 99181-1246').replace(/\D/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1');

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
    try { if (!d.revisao_enviada_em || automatico) await wa.enviarDocumentoNumero(numeroCeo(), r.pdf, r.nome, `📋 Cópia — dossiê do *LT-${lote}* enviado para *${d.nome}* (vila ${d.lote_vila})${automatico ? ' automaticamente após a quitação' : ''}.`); else await wa.enviarWhatsAppNumero(numeroCeo(), `✅ Dossiê do *LT-${lote}* aprovado e enviado para *${d.nome}*.`); }
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

/**
 * v3.187.0: dossiê PRONTO (lote medido + tudo pago) é gerado sozinho e vai primeiro para a REVISÃO do CEO
 * (PDF no WhatsApp dele); o associado só recebe depois do "✅ Aprovar e enviar" em Dossiês.
 * PA_DOSSIE_SEM_APROVACAO=1 volta ao envio direto ao associado.
 */
export async function enviarProntos(projetoId: number, associadoIds: number[] | null = null) {
  const ds = (await listarDossies(projetoId)).filter((d) => d.status === 'PRONTO' && (!associadoIds || associadoIds.includes(d.associado_id)));
  const out: Array<{ lote: string; ok: boolean; erro?: string }> = [];
  const semAprovacao = process.env.PA_DOSSIE_SEM_APROVACAO === '1';
  for (const d of ds) {
    try {
      if (semAprovacao) { if (!d.whatsapp_valido) continue; const r = await enviarDossie(projetoId, d.lote, null, true); if (r.enviado) out.push({ lote: d.lote, ok: true }); continue; }
      if (d.revisao_enviada_em) continue;
      const trava = await exec(pool, 'UPDATE pa_dossies SET revisao_enviada_em = NOW() WHERE projeto_id = ? AND lote = ? AND revisao_enviada_em IS NULL', [projetoId, d.lote]);
      if (!trava.affectedRows) continue;
      try {
        const r = await pdfDossie(projetoId, d.lote);
        const wa = await import('./paWhatsapp');
        await wa.enviarDocumentoNumero(numeroCeo(), r.pdf, r.nome, `📋 *Dossiê pronto para aprovação* — *LT-${d.lote}* · ${d.nome} (vila ${d.lote_vila}).\n\nConfira o PDF. Se estiver certo, abra *Gestão de PA → Dossiês* e toque em *✅ Aprovar e enviar*${d.whatsapp_valido ? '' : ' (o associado está sem WhatsApp válido — entregue a via impressa)'}.`);
        await registrarEvento(pool, { projeto_id: projetoId, associado_id: d.associado_id, usuario: 'automatico', tipo: 'DOSSIE_PARA_APROVACAO', dados: { lote: d.lote } });
        out.push({ lote: d.lote, ok: true });
      } catch (e) {
        await exec(pool, 'UPDATE pa_dossies SET revisao_enviada_em = NULL WHERE projeto_id = ? AND lote = ?', [projetoId, d.lote]);
        throw e;
      }
    } catch (e) { out.push({ lote: d.lote, ok: false, erro: (e as Error).message.slice(0, 160) }); console.warn('[pa-dossie] LT-' + d.lote + ':', (e as Error).message); }
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
