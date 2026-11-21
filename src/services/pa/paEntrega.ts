// v3.196.0 — Entrega das vias impressas do dossiê (passo "Entregue"):
//   1) upload da TRT (PDF) + comprovante/boleto pago → o sistema LÊ o número da TRT no PDF;
//   2) gera as vias com o nº da TRT na capa e no rodapé de todas as peças;
//   3) o técnico posiciona as assinaturas (página + posição) e assina com o certificado A1 (PFX + senha) —
//      assinatura digital PAdES (ICP-Brasil) + selo visível em cada posição;
//   4) PDF assinado para baixar/imprimir; depois de impresso → arquivar e marcar como entregue.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { PaErro } from './erros';
import { pool, one, exec, num, registrarEvento } from './paDb';
import { uploadDocumento } from './paDocumentos';
import { pdfDossie, listarDossies } from './paDossie';
import { CadesSigner } from '../../modules/assinatura/cadesSigner.js';
import { abrirPfx, descartar, mascararCpf, ErroSenhaCertificado, type CertificadoCarregado } from '../../modules/assinatura/certificado.js';
import { cifrar, decifrar } from '../../modules/assinatura/cofre.js';
import { configAssinatura } from '../../modules/assinatura/config.js';
import { minutosBloqueado, registrarFalhaSenha, resetarFalhasSenha } from '../../modules/assinatura/antiBruteForce.js';

// ─── número da TRT ──────────────────────────────────────────────────────────
/** Lê o número da TRT no texto do PDF (pura — testável). */
export function extrairNumeroTrt(texto: string): string | null {
  const t = texto.replace(/ /g, ' ');
  const pads: RegExp[] = [
    /\b(BR\d{9,16})\b/i,                                                              // CFT/CFTA: BR20261234567
    /TRT[^\n]{0,60}?N[º°o.]*\s*[:\-]?\s*([A-Z]{0,4}\d[\dA-Z.\-/]{5,28})/i,              // "TRT OBRA/SERVIÇO Nº ..."
    /N[ºo°.]*\s*(?:da\s+)?TRT\s*[:\-]?\s*([A-Z]{0,4}\d[\dA-Z.\-/]{5,28})/i,             // "Nº da TRT: ..."
    /Termo de Responsabilidade T[ée]cnica[^\n]{0,60}?([A-Z]{0,4}\d{7,16})/i,
  ];
  for (const r of pads) { const m = r.exec(t); if (m) return m[1].replace(/[.\-/]+$/, '').toUpperCase(); }
  return null;
}
async function textoPdf(buf: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const p = new PDFParse({ data: buf });
  try { return (await p.getText()).text || ''; } catch { return ''; } finally { await p.destroy().catch(() => undefined); }
}

type Arquivo = { buffer: Buffer; originalname: string; mimetype: string };
/** Passo 1: TRT + comprovante. Lê o número da TRT (ou usa o informado) e libera a assinatura. */
export async function registrarTrtEntrega(projetoId: number, lote: string, arq: { trt?: Arquivo; comprovante?: Arquivo }, numeroManual: unknown, usuario: string | null, nomeUsuario: string | null) {
  const d = await one(pool, 'SELECT * FROM pa_dossies WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  if (d.status !== 'ENVIADO' && d.status !== 'ENTREGUE') throw new PaErro('DOSSIE_NAO_ENVIADO', 'A entrega começa depois que o dossiê foi enviado ao associado', 409);
  if (!arq.trt && !d.trt_doc_id) throw new PaErro('SEM_TRT', 'Envie o PDF da TRT', 400);
  if (!arq.comprovante && !d.comprovante_trt_doc_id) throw new PaErro('SEM_COMPROVANTE', 'Envie o boleto/comprovante de pagamento da TRT', 400);
  const aid = num(d.associado_id);
  let numero = String(numeroManual ?? '').trim().toUpperCase().slice(0, 40) || null;
  if (!numero && arq.trt && /pdf/i.test(arq.trt.mimetype || arq.trt.originalname)) numero = extrairNumeroTrt(await textoPdf(arq.trt.buffer));
  if (!numero) numero = (d.trt_numero as string) || null;
  if (!numero) throw new PaErro('TRT_NUMERO_NAO_LIDO', 'Não consegui ler o número da TRT no arquivo — digite o número', 422);
  const trtDoc = arq.trt ? await uploadDocumento(aid, 'TRT', arq.trt, usuario).catch((e) => { if ((e as PaErro).codigo === 'DOCUMENTO_DUPLICADO') return { id: (e as PaErro & { detalhe?: { documento_id?: number } }).detalhe?.documento_id ?? null }; throw e; }) : null;
  const compDoc = arq.comprovante ? await uploadDocumento(aid, 'COMPROVANTE_TRT', arq.comprovante, usuario).catch((e) => { if ((e as PaErro).codigo === 'DOCUMENTO_DUPLICADO') return { id: (e as PaErro & { detalhe?: { documento_id?: number } }).detalhe?.documento_id ?? null }; throw e; }) : null;
  const quem = nomeUsuario ?? usuario;
  await exec(pool, `UPDATE pa_dossies SET trt_numero = ?, trt_emitida_em = COALESCE(trt_emitida_em, NOW()), trt_emitida_por = COALESCE(trt_emitida_por, ?),
    trt_paga_em = COALESCE(trt_paga_em, NOW()), trt_paga_por = COALESCE(trt_paga_por, ?), trt_doc_id = COALESCE(?, trt_doc_id), comprovante_trt_doc_id = COALESCE(?, comprovante_trt_doc_id),
    assinado_doc_id = NULL, assinado_em = NULL WHERE id = ?`, [numero, quem, quem, trtDoc?.id ?? null, compDoc?.id ?? null, d.id]);
  cacheVias.delete(`${projetoId}:${lote}`);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: aid, usuario, tipo: 'DOSSIE_TRT_ANEXADA', dados: { lote, numero, lido_do_pdf: !numeroManual } });
  return { lote, trt_numero: numero, lido_do_pdf: !numeroManual };
}

// ─── vias com a TRT ────────────────────────────────────────────────────────
const cacheVias = new Map<string, { trt: string; pdf: Buffer; nome: string; em: number }>();
/** Carimba "TRT nº …" no rodapé de todas as páginas (menos a capa, que já traz o número). */
export async function carimbarTrt(pdf: Buffer, trt: string, rt: string): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const f = await doc.embedFont(StandardFonts.HelveticaBold);
  const txt = `TRT nº ${trt} · Resp. técnico: ${rt}`;
  doc.getPages().forEach((pg, i) => {
    if (i === 0) return;
    const { width } = pg.getSize();
    const w = f.widthOfTextAtSize(txt, 7);
    pg.drawRectangle({ x: width - w - 22, y: 6, width: w + 10, height: 11, color: rgb(1, 1, 1), opacity: 0.85 });
    pg.drawText(txt, { x: width - w - 17, y: 9, size: 7, font: f, color: rgb(12 / 255, 51 / 255, 32 / 255) });
  });
  return Buffer.from(await doc.save());
}
export async function viasEntrega(projetoId: number, lote: string): Promise<{ pdf: Buffer; nome: string; trt: string }> {
  const d = await one(pool, 'SELECT trt_numero FROM pa_dossies WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  const trt = (d?.trt_numero as string) || '';
  if (!trt) throw new PaErro('SEM_TRT', 'Anexe a TRT e o comprovante primeiro', 409);
  const k = `${projetoId}:${lote}`, c = cacheVias.get(k);
  if (c && c.trt === trt && Date.now() - c.em < 30 * 60_000) return { pdf: c.pdf, nome: c.nome, trt };
  const r = await pdfDossie(projetoId, lote, { trt });
  const pdf = await carimbarTrt(r.pdf, trt, 'José Romário Pinto Bezerra · CFT 01209185369');
  const nome = r.nome.replace(/^DOSSIE-/, 'VIAS-ENTREGA-');
  cacheVias.set(k, { trt, pdf, nome, em: Date.now() });
  return { pdf, nome, trt };
}

// ─── certificado A1 do RT ──────────────────────────────────────────────────
interface CertRow { titular: string; cpf: string | null; emissor: string; serial: string; valido_ate: Date | string; pfx_cifrado: Buffer; iv: Buffer; tag: Buffer }
async function certAtivo(): Promise<CertRow | null> {
  return (await one<CertRow>(pool, 'SELECT * FROM assinatura_certificados WHERE ativo = 1 ORDER BY valido_ate DESC LIMIT 1').catch(() => null)) ?? null;
}
export async function statusCertificadoPa() {
  const c = await certAtivo();
  if (!c) return { configurado: false };
  const dias = Math.floor((new Date(c.valido_ate).getTime() - Date.now()) / 86_400_000);
  return { configurado: true, titular: c.titular, emissor: c.emissor, valido_ate: new Date(c.valido_ate).toISOString().slice(0, 10), dias_restantes: dias, vencido: dias < 0 };
}
/** Importa o PFX do RT (cifrado com a chave mestra). A senha só confere o arquivo — não é guardada. */
export async function importarCertificadoPa(pfx: Buffer | undefined, senha: unknown, usuario: string | null) {
  if (!pfx?.length) throw new PaErro('SEM_ARQUIVO', 'Envie o arquivo .pfx / .p12 do certificado A1', 400);
  let cert: CertificadoCarregado;
  try { cert = abrirPfx(pfx, String(senha ?? '')); } catch (e) { throw new PaErro('SENHA_CERTIFICADO', e instanceof ErroSenhaCertificado ? 'Senha do certificado incorreta' : `Certificado inválido: ${(e as Error).message}`, 400); }
  try {
    if (cert.validoAte.getTime() < Date.now()) throw new PaErro('CERTIFICADO_VENCIDO', 'Este certificado está vencido', 400);
    const c = cifrar(pfx, configAssinatura.masterKey);
    await exec(pool, 'UPDATE assinatura_certificados SET ativo = 0');
    await exec(pool, `INSERT INTO assinatura_certificados (titular, cpf, emissor, serial, valido_de, valido_ate, pfx_cifrado, iv, tag, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE pfx_cifrado = VALUES(pfx_cifrado), iv = VALUES(iv), tag = VALUES(tag), valido_de = VALUES(valido_de), valido_ate = VALUES(valido_ate), ativo = 1`,
      [cert.titular, cert.cpf, cert.emissor, cert.serial, cert.validoDe, cert.validoAte, c.dados, c.iv, c.tag]);
    await registrarEvento(pool, { projeto_id: null, usuario, tipo: 'CERTIFICADO_IMPORTADO', dados: { titular: cert.titular, valido_ate: cert.validoAte } });
    return statusCertificadoPa();
  } finally { descartar(cert); }
}

// ─── assinatura com selos posicionados ─────────────────────────────────────
export interface PosicaoAssinatura { pagina: number; x: number; y: number; w?: number; h?: number } // frações (0–1) a partir do canto superior esquerdo
export function validarPosicoes(v: unknown, paginas: number): PosicaoAssinatura[] {
  if (!Array.isArray(v) || !v.length) throw new PaErro('SEM_POSICAO', 'Posicione ao menos uma assinatura', 400);
  return v.slice(0, 200).map((p) => {
    const o = p as Record<string, unknown>;
    const r = { pagina: Math.trunc(Number(o.pagina)), x: Number(o.x), y: Number(o.y), w: Number(o.w ?? 0.3), h: Number(o.h ?? 0.075) };
    if (!(r.pagina >= 0 && r.pagina < paginas) || ![r.x, r.y, r.w, r.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new PaErro('POSICAO_INVALIDA', 'Posição de assinatura inválida', 400);
    return r;
  });
}
const VERDE = rgb(12 / 255, 51 / 255, 32 / 255), DOURADO = rgb(201 / 255, 168 / 255, 76 / 255);
export async function assinarEntrega(projetoId: number, lote: string, senha: unknown, posicoesQ: unknown, usuario: string | null) {
  const bloq = minutosBloqueado();
  if (bloq) throw new PaErro('SENHA_BLOQUEADA', `Muitas senhas erradas — tente de novo em ${bloq} min`, 429);
  const d = await one(pool, 'SELECT * FROM pa_dossies WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  if (!d) throw new PaErro('DOSSIE_NAO_ENCONTRADO', 'Dossiê não encontrado', 404);
  const reg = await certAtivo();
  if (!reg) throw new PaErro('SEM_CERTIFICADO', 'Cadastre o certificado digital A1 (PFX) antes de assinar', 409);
  const vias = await viasEntrega(projetoId, lote);
  const doc = await PDFDocument.load(vias.pdf, { updateMetadata: false });
  const posicoes = validarPosicoes(posicoesQ, doc.getPageCount());
  let cert: CertificadoCarregado;
  try { cert = abrirPfx(decifrar({ dados: reg.pfx_cifrado, iv: reg.iv, tag: reg.tag }, configAssinatura.masterKey), String(senha ?? '')); }
  catch (e) {
    if (e instanceof ErroSenhaCertificado) { const f = registrarFalhaSenha(); throw new PaErro('SENHA_CERTIFICADO', f.bloqueado ? 'Senha incorreta — assinatura bloqueada por alguns minutos' : 'Senha do certificado incorreta', 401); }
    throw e;
  }
  try {
    resetarFalhasSenha();
    const agora = new Date();
    const fR = await doc.embedFont(StandardFonts.Helvetica), fB = await doc.embedFont(StandardFonts.HelveticaBold);
    const quando = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    for (const p of posicoes) {
      const pg = doc.getPage(p.pagina);
      const { width, height } = pg.getSize();
      const w = Math.max(120, (p.w ?? 0.3) * width), h = Math.max(34, (p.h ?? 0.075) * height);
      const x = Math.min(width - w - 4, Math.max(4, p.x * width)), y = Math.min(height - 4, Math.max(h + 4, height - p.y * height)) - h;
      pg.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), opacity: 0.92, borderColor: VERDE, borderWidth: 0.9 });
      pg.drawRectangle({ x, y: y + h - 2.2, width: w, height: 2.2, color: DOURADO });
      const s = Math.min(8.5, h / 5.2);
      const linhas: Array<[string, typeof fB, number]> = [['Assinado digitalmente por', fR, s * 0.85], [cert.titular.toUpperCase(), fB, s], [`CPF ${mascararCpf(cert.cpf)} · ICP-Brasil`, fR, s * 0.8], [`${quando} · ${configAssinatura.local}`, fR, s * 0.8]];
      let ty = y + h - 4 - s;
      for (const [t, f, sz] of linhas) { pg.drawText(t.slice(0, 90), { x: x + 5, y: ty, size: sz, font: f, color: VERDE, maxWidth: w - 10 }); ty -= sz * 1.25; }
    }
    pdflibAddPlaceholder({ pdfDoc: doc, reason: `Vias técnicas do LT-${lote} — TRT nº ${vias.trt}`, contactInfo: configAssinatura.contato, name: cert.titular, location: configAssinatura.local, signingTime: agora, signatureLength: 16384, subFilter: SUBFILTER_ETSI_CADES_DETACHED, appName: 'ZAYRA · Romatec Consultoria Total' });
    const comPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }));
    const assinado = await new SignPdf().sign(comPlaceholder, new CadesSigner(cert), agora);
    const nome = vias.nome.replace(/\.pdf$/i, '-ASSINADO.pdf');
    const salvo = await uploadDocumento(num(d.associado_id), 'DOSSIE_ENTREGA', { buffer: assinado, originalname: nome, mimetype: 'application/pdf' }, usuario);
    await exec(pool, 'UPDATE pa_dossies SET assinado_doc_id = ?, assinado_em = NOW() WHERE id = ?', [salvo.id, d.id]);
    await registrarEvento(pool, { projeto_id: projetoId, associado_id: num(d.associado_id), usuario, tipo: 'DOSSIE_ASSINADO', dados: { lote, trt: vias.trt, assinaturas: posicoes.length, documento_id: salvo.id } });
    return { lote, documento_id: salvo.id, nome, assinaturas: posicoes.length };
  } finally { descartar(cert); }
}

export async function viasAssinadas(projetoId: number, lote: string): Promise<{ pdf: Buffer; nome: string }> {
  const d = await one(pool, 'SELECT assinado_doc_id FROM pa_dossies WHERE projeto_id = ? AND lote = ?', [projetoId, lote]);
  if (!d?.assinado_doc_id) throw new PaErro('NAO_ASSINADO', 'As vias ainda não foram assinadas', 404);
  const f = await one<{ conteudo: Buffer; nome_original: string }>(pool, 'SELECT a.conteudo, d.nome_original FROM pa_documentos_arquivos a JOIN pa_documentos d ON d.id = a.documento_id WHERE a.documento_id = ?', [d.assinado_doc_id]);
  if (!f) throw new PaErro('NAO_ASSINADO', 'Arquivo assinado não encontrado', 404);
  return { pdf: f.conteudo, nome: f.nome_original || `VIAS-LT-${lote}-ASSINADO.pdf` };
}
export async function situacaoEntrega(projetoId: number) {
  const ds = await listarDossies(projetoId);
  return ds;
}
