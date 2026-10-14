// v3.148.0 — Foto do associado (miniatura) e carteirinha do associado.
// Tudo sai do cadastro na hora: mudou nome, telefone, chácara ou a foto 3x4
// (documento FOTO_3X4 mais recente), a próxima carteirinha já vem atualizada.
// Layout: cartão CR80 (85,6 × 54 mm) com frente e verso lado a lado — imprime,
// recorta, dobra no meio e plastifica. A4 com 4 cartões por página.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { PaErro } from './erros';
import { pool, rows, one, exec, num, isoDate, registrarEvento } from './paDb';
import { buscarProjeto, type Projeto } from './paRepo';
import { marcaArquivos } from './marcaProjeto';

// ─── Foto ─────────────────────────────────────────────────────────────────
export type TamanhoFoto = 'mini' | 'cart';
const DIM: Record<TamanhoFoto, { w: number; h: number }> = { mini: { w: 96, h: 128 }, cart: { w: 330, h: 440 } };
const cacheFoto = new Map<string, Buffer>();

async function documentoFoto(aid: number): Promise<number | null> {
  const d = await one(pool, `SELECT id FROM pa_documentos WHERE associado_id = ? AND tipo = 'FOTO_3X4' AND arquivo_presente = 1 ORDER BY versao DESC, id DESC LIMIT 1`, [aid]);
  return d ? num(d.id) : null;
}

/** Foto 3x4 reduzida (JPEG, recorte 3:4). null se o associado não tem foto. */
export async function fotoAssociado(aid: number, tam: TamanhoFoto = 'mini'): Promise<{ jpeg: Buffer; documento_id: number } | null> {
  const docId = await documentoFoto(aid);
  if (!docId) return null;
  const chave = `${docId}:${tam}`;
  const cache = cacheFoto.get(chave);
  if (cache) return { jpeg: cache, documento_id: docId };
  const f = await one<{ conteudo: Buffer }>(pool, 'SELECT conteudo FROM pa_documentos_arquivos WHERE documento_id = ?', [docId]);
  if (!f?.conteudo) return null;
  const sharp = (await import('sharp')).default;
  let jpeg: Buffer;
  try {
    jpeg = await sharp(f.conteudo).rotate().resize(DIM[tam].w, DIM[tam].h, { fit: 'cover', position: 'attention' }).jpeg({ quality: tam === 'mini' ? 72 : 86 }).toBuffer();
  } catch {
    return null; // arquivo não é imagem (ex.: PDF enviado como foto)
  }
  if (cacheFoto.size > 400) cacheFoto.delete(cacheFoto.keys().next().value as string);
  cacheFoto.set(chave, jpeg);
  return { jpeg, documento_id: docId };
}

// ─── Dados da carteirinha ─────────────────────────────────────────────────
export interface DadosCarteirinha {
  associado_id: number; numero: string; nome: string; cpf: string; lote: string; terra: string | null;
  nascimento: string | null; telefone: string | null; conjuge: string | null; foto: string | null;
}

function asset(nome: string | null): string {
  if (!nome) return '';
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? `data:${nome.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${readFileSync(f).toString('base64')}` : '';
}

export async function dadosCarteirinhas(projetoId: number, ids: number[] | null): Promise<{ projeto: Projeto; itens: DadosCarteirinha[] }> {
  const projeto = await buscarProjeto(projetoId);
  const params: unknown[] = [projetoId];
  let filtro = '';
  if (ids && ids.length) { filtro = ` AND a.id IN (${ids.map(() => '?').join(',')})`; params.push(...ids); }
  const as = await rows(pool, `
    SELECT a.id, a.numero, a.nome, a.cpf, a.nascimento, a.telefone, a.conjuge_nome, a.denominacao_terra, lt.numero AS lote
    FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE a.projeto_id = ? AND a.ativo = 1${filtro} ORDER BY CAST(lt.numero AS UNSIGNED), lt.numero`, params);
  if (!as.length) throw new PaErro('SEM_ASSOCIADOS', 'Nenhum associado para gerar carteirinha', 404);
  const itens: DadosCarteirinha[] = [];
  for (const a of as) {
    const f = await fotoAssociado(num(a.id), 'cart').catch(() => null);
    itens.push({
      associado_id: num(a.id), numero: String(a.numero), nome: String(a.nome), cpf: String(a.cpf), lote: String(a.lote),
      terra: (a.denominacao_terra as string) ?? null, nascimento: isoDate(a.nascimento), telefone: (a.telefone as string) ?? null,
      conjuge: (a.conjuge_nome as string) ?? null, foto: f ? `data:image/jpeg;base64,${f.jpeg.toString('base64')}` : null,
    });
  }
  return { projeto, itens };
}

// ─── HTML ─────────────────────────────────────────────────────────────────
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const dBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const iniciais = (nome: string) => nome.trim().split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function textoQr(p: Pick<Projeto, 'codigo' | 'nome'>, a: DadosCarteirinha): string {
  return [`${p.nome}`, `Associado ${a.numero} — Lote ${a.lote}`, a.nome, `CPF ${a.cpf}`].join('\n');
}

async function cartao(p: Projeto, a: DadosCarteirinha, img: { brasao: string; emblema: string; logo: string }, emissao: string): Promise<string> {
  const qr = await QRCode.toDataURL(textoQr(p, a), { margin: 0, width: 220, errorCorrectionLevel: 'M', color: { dark: '#0C3320', light: '#FFFFFF' } });
  const assoc = p.associacao_nome || p.nome;
  const local = `${p.municipio}/${p.uf}`;
  return `<div class="par">
    <div class="card frente">
      <div class="topo">${img.brasao ? `<img class="bras" src="${img.brasao}">` : ''}<div class="tt"><div class="assoc">${esc(assoc)}</div><div class="tit">CARTEIRA DO ASSOCIADO</div></div></div>
      <div class="corpo">
        <div class="foto">${a.foto ? `<img src="${a.foto}">` : `<span>${esc(iniciais(a.nome))}</span>`}</div>
        <div class="dados">
          <div class="nome">${esc(a.nome)}</div>
          <div class="ln"><b>Nº</b> ${esc(a.numero)} &nbsp; <b>LOTE</b> ${esc(a.lote)}</div>
          <div class="ln"><b>CPF</b> ${esc(a.cpf)}</div>
          ${a.terra ? `<div class="ln"><b>TERRA</b> ${esc(a.terra)}</div>` : ''}
          ${a.nascimento ? `<div class="ln"><b>NASC.</b> ${dBr(a.nascimento)}</div>` : ''}
        </div>
      </div>
      <div class="rod">${esc(p.nome)} · ${esc(local)}</div>
    </div>
    <div class="dobra"></div>
    <div class="card verso">
      ${img.emblema ? `<img class="wm" src="${img.emblema}">` : ''}
      <div class="vt">
        <p>Este cartão identifica o(a) portador(a) como associado(a) do <b>${esc(p.nome)}</b>. É pessoal e intransferível.</p>
        ${a.conjuge ? `<p class="mini"><b>Cônjuge:</b> ${esc(a.conjuge)}</p>` : ''}
        ${a.telefone ? `<p class="mini"><b>Telefone:</b> ${esc(a.telefone)}</p>` : ''}
        <div class="ass"><div class="linha"></div><div class="mini">${p.presidente_nome ? `${esc(p.presidente_nome)}<br>` : ''}Presidente da Associação</div></div>
      </div>
      <div class="qr"><img src="${qr}"><div class="mini c">Emitida em ${esc(emissao)}</div></div>
      <div class="vrod">${img.logo ? `<img src="${img.logo}">` : ''}<span>Romatec Consultoria Total · Açailândia/MA</span></div>
    </div>
  </div>`;
}

export async function htmlCarteirinhas(p: Projeto, itens: DadosCarteirinha[], emissao: string, modo: 'pdf' | 'tela' = 'pdf'): Promise<string> {
  const m = marcaArquivos(p.codigo);
  const img = { brasao: asset(m.brasao), emblema: asset(m.emblema), logo: asset('logo_romatec.jpg') };
  const cartoes: string[] = [];
  for (const a of itens) cartoes.push(await cartao(p, a, img, emissao));
  const paginas: string[] = [];
  for (let i = 0; i < cartoes.length; i += 4) paginas.push(`<section class="pag">${cartoes.slice(i, i + 4).join('')}</section>`);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Carteirinhas — ${esc(p.nome)}</title><style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1C1C18; ${modo === 'tela' ? 'background:#e9e5d9;padding:14px;' : ''} }
    .pag { display: flex; flex-direction: column; gap: 8mm; align-items: center; ${modo === 'pdf' ? 'page-break-after: always;' : 'margin-bottom:8mm;'} }
    .pag:last-child { page-break-after: auto; }
    .par { display: flex; align-items: stretch; }
    .dobra { width: 0; border-left: 0.3mm dashed #b9b2a0; margin: 0 2.5mm; }
    .card { width: 85.6mm; height: 54mm; border-radius: 3.2mm; overflow: hidden; position: relative; background: #fff; border: 0.25mm solid #cfc7b0; ${modo === 'tela' ? 'box-shadow:0 2px 8px rgba(0,0,0,.18);' : ''} }
    .frente .topo { height: 13mm; background: linear-gradient(90deg, #0C3320, #14472B); display: flex; align-items: center; gap: 2mm; padding: 0 3mm; border-bottom: 0.8mm solid #C9A84C; }
    .frente .bras { height: 10.5mm; width: auto; }
    .frente .assoc { color: #fff; font-size: 6.2pt; line-height: 1.15; font-weight: 700; text-transform: uppercase; }
    .frente .tit { color: #E3D19A; font-size: 7.4pt; font-weight: 800; letter-spacing: .5pt; margin-top: .6mm; }
    .corpo { display: flex; gap: 3mm; padding: 2.6mm 3mm 0; }
    .foto { width: 21mm; height: 28mm; flex: 0 0 21mm; border: 0.6mm solid #C9A84C; border-radius: 1.6mm; overflow: hidden; background: #f1efe8; display: flex; align-items: center; justify-content: center; }
    .foto img { width: 100%; height: 100%; object-fit: cover; }
    .foto span { font-size: 16pt; font-weight: 800; color: #9c967f; }
    .dados { flex: 1; min-width: 0; }
    .nome { font-size: 8.4pt; font-weight: 800; color: #0C3320; line-height: 1.15; text-transform: uppercase; margin-bottom: 1.4mm; max-height: 7.6mm; overflow: hidden; }
    .ln { font-size: 6.6pt; line-height: 1.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ln b { color: #a07a10; font-size: 5.6pt; letter-spacing: .3pt; }
    .rod { position: absolute; left: 0; right: 0; bottom: 0; height: 5.2mm; background: #0C3320; color: #E3D19A; font-size: 5.6pt; display: flex; align-items: center; justify-content: center; letter-spacing: .3pt; }
    .verso { background: #FBFAF5; }
    .verso .wm { position: absolute; right: -6mm; top: 4mm; width: 44mm; opacity: .08; }
    .vt { position: absolute; left: 3.5mm; top: 3.2mm; width: 54mm; font-size: 6.2pt; line-height: 1.35; }
    .vt p { margin: 0 0 1.4mm; }
    .mini { font-size: 5.6pt; color: #4b4838; }
    .ass { margin-top: 3mm; }
    .ass .linha { border-top: 0.25mm solid #1C1C18; width: 46mm; margin-bottom: .6mm; }
    .qr { position: absolute; right: 3.5mm; top: 4mm; width: 20mm; }
    .qr img { width: 20mm; height: 20mm; display: block; }
    .c { text-align: center; margin-top: .8mm; }
    .vrod { position: absolute; left: 0; right: 0; bottom: 0; height: 7mm; border-top: 0.6mm solid #C9A84C; display: flex; align-items: center; gap: 2mm; padding: 0 3.5mm; background: #fff; font-size: 5.6pt; color: #0C3320; font-weight: 700; }
    .vrod img { height: 5mm; width: auto; }
    ${modo === 'tela' ? 'html,body{overflow-x:hidden}.par{flex-direction:column;gap:4mm}.dobra{display:none}.pag{gap:7mm}#cx{transform-origin:0 0;width:max-content}' : ''}
  </style></head><body>${modo === 'tela' ? `<div id="cx">${paginas.join('')}</div><script>(function(){var c=document.getElementById('cx');function f(){c.style.transform='';var w=document.documentElement.clientWidth-28,s=Math.min(1,w/c.scrollWidth);c.style.transform='scale('+s+')';document.body.style.height=(c.scrollHeight*s+28)+'px';}window.addEventListener('resize',f);window.addEventListener('load',f);f();})();</script>` : paginas.join('')}</body></html>`;
}

export async function pdfCarteirinhas(projetoId: number, ids: number[] | null, usuario: string | null): Promise<{ pdf: Buffer; nome: string; quantidade: number }> {
  const { projeto, itens } = await dadosCarteirinhas(projetoId, ids);
  const emissao = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const html = await htmlCarteirinhas(projeto, itens, emissao, 'pdf');
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  const pdf = await htmlToPdf(html, { format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
  const idsGerados = itens.map((i) => i.associado_id);
  await exec(pool, `UPDATE pa_associados SET carteirinha_emitida_em = NOW() WHERE id IN (${idsGerados.map(() => '?').join(',')})`, idsGerados);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'CARTEIRINHA_PDF', dados: { quantidade: itens.length, associados: idsGerados } });
  const nome = itens.length === 1 ? `CARTEIRINHA-LOTE-${itens[0].lote}-${itens[0].nome.split(/\s+/)[0]}.pdf` : `CARTEIRINHAS-${projeto.codigo}-${itens.length}.pdf`;
  // Cabeçalho HTTP só aceita ASCII: tira acentos do nome do arquivo.
  return { pdf, nome: nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9.-]/g, '_'), quantidade: itens.length };
}

export async function previaCarteirinhas(projetoId: number, ids: number[] | null): Promise<string> {
  const { projeto, itens } = await dadosCarteirinhas(projetoId, ids);
  const emissao = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return htmlCarteirinhas(projeto, itens, emissao, 'tela');
}

export function lerIds(v: unknown): number[] | null {
  const ids = String(v ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? [...new Set(ids)].slice(0, 500) : null;
}
