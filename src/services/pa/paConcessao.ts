// v3.176.0 — Termo de Concessão de Uso de parcela rural do PA (timbre do PA).
// Caso típico: o lote está cadastrado em nome de um familiar (por segurança/conveniência)
// e quem usa e mora de fato é outra pessoa (ex.: o pai). O titular cadastral CONCEDE o uso,
// a posse direta e a exploração ao CONCESSIONÁRIO, com anuência da Associação. Não transfere
// a titularidade cadastral nem o domínio (Lei nº 8.629/1993 e normas do INCRA).
// Também dá para inverter (a outra pessoa concede ao titular). Só usa o que está no cadastro
// ou foi informado no formulário — nada inventado; campo vazio vira linha para preencher.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PaErro } from './erros';
import { pool, rows, isoDate, registrarEvento } from './paDb';
import { buscarProjeto, type Projeto } from './paRepo';
import { buscarSubdivisao, vinculosParcelas, municipiosDosLotes } from './paMapas';
import { marcaArquivos } from './marcaProjeto';
import { dataExtenso } from './paAta';
import { haAlq } from './unidades';
import { cpfValido, formatarCpf } from './validadores';

export interface PessoaTermo {
  nome: string; cpf: string | null; rg: string | null; nascimento: string | null; naturalidade: string | null; filiacao: string | null;
  estado_civil: string | null; profissao: string | null; endereco: string | null; nacionalidade: string | null;
}
export interface LoteTermo {
  lote: string; area_ha: number; area_util_ha: number | null; perimetro_m: number | null; vertices: number; confrontantes: string[];
  denominacao: string | null; municipio: string | null;
  titular: PessoaTermo & { numero: string | null; lote_vila: string | null };
}
export interface DadosTermo {
  lote: string; outra: PessoaTermo; vinculo: string | null;
  /** false (padrão): o titular do lote concede à outra pessoa; true: a outra pessoa concede ao titular. */
  inverter: boolean;
  /** Declara que o cadastro em nome do titular é só formal e a posse de fato é do concessionário. */
  titularidade_formal: boolean;
  data: string | null; local: string | null; obs: string | null;
}

const LINHA = '______________________________';
const txt = (v: unknown, max = 200) => { const t = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
const dataIso = (v: unknown) => { const t = txt(v, 10); return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };

function lerPessoa(o: Record<string, unknown>): PessoaTermo {
  const nome = txt(o.nome, 160);
  if (!nome) throw new PaErro('CAMPO_INVALIDO', 'Informe o nome completo da outra parte (concessionário)', 400);
  const cpfBruto = txt(o.cpf, 20);
  if (cpfBruto && !cpfValido(cpfBruto)) throw new PaErro('CPF_INVALIDO', `CPF inválido: ${cpfBruto}`, 400);
  return {
    nome: nome.toUpperCase(), cpf: cpfBruto ? formatarCpf(cpfBruto) : null, rg: txt(o.rg, 80), nascimento: dataIso(o.nascimento),
    naturalidade: txt(o.naturalidade, 80), filiacao: txt(o.filiacao, 240), estado_civil: txt(o.estado_civil, 40), profissao: txt(o.profissao, 80),
    endereco: txt(o.endereco, 240), nacionalidade: txt(o.nacionalidade, 40),
  };
}
export function lerDadosTermo(b: Record<string, unknown>): DadosTermo {
  const lote = txt(b.lote, 10);
  if (!lote) throw new PaErro('CAMPO_INVALIDO', 'Escolha o lote', 400);
  return {
    lote, outra: lerPessoa((b.outra ?? {}) as Record<string, unknown>), vinculo: txt(b.vinculo, 60), inverter: b.inverter === true,
    titularidade_formal: b.titularidade_formal !== false, data: dataIso(b.data), local: txt(b.local, 160), obs: txt(b.obs, 1500),
  };
}

const dBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);
const m2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Qualificação civil (só com o que existe; o que falta vira linha para preencher). */
export function qualificar(p: PessoaTermo): string {
  const q = [`<b>${p.nome}</b>`, p.nacionalidade || 'brasileiro(a)'];
  q.push(p.estado_civil ? p.estado_civil.toLowerCase() : `estado civil ${LINHA.slice(0, 14)}`);
  if (p.profissao) q.push(p.profissao.toLowerCase());
  if (p.nascimento) q.push(`nascido(a) em ${dBr(p.nascimento)}`);
  if (p.naturalidade) q.push(`natural de ${p.naturalidade}`);
  if (p.filiacao) q.push(`filho(a) de ${p.filiacao}`);
  q.push(p.rg ? `portador(a) da Carteira de Identidade (RG) nº ${p.rg}` : `RG nº ${LINHA.slice(0, 16)}`);
  q.push(p.cpf ? `inscrito(a) no CPF sob o nº ${p.cpf}` : `CPF nº ${LINHA.slice(0, 16)}`);
  q.push(p.endereco ? `residente e domiciliado(a) em ${p.endereco}` : `residente e domiciliado(a) em ${LINHA}`);
  return q.join(', ');
}

/** Cláusulas do termo (pura — testável). Devolve HTML com <b> já escapado nos dados. */
export function clausulasTermo(p: Pick<Projeto, 'nome' | 'municipio' | 'uf' | 'associacao_nome'>, l: LoteTermo, d: DadosTermo) {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const limpa = (pe: PessoaTermo): PessoaTermo => Object.fromEntries(Object.entries(pe).map(([k, v]) => [k, v == null ? v : esc(v)])) as unknown as PessoaTermo;
  const titular = limpa(l.titular), outra = limpa(d.outra);
  const concedente = d.inverter ? outra : titular, concessionario = d.inverter ? titular : outra;
  const assoc = esc(p.associacao_nome || `Associação do ${p.nome}`);
  const mun = esc(l.municipio || `${p.municipio}/${p.uf}`);
  const loteTxt = `Lote nº ${esc(l.lote)}${l.denominacao ? `, denominado “${esc(l.denominacao)}”` : ''}, do ${esc(p.nome)}`;
  const vinc = d.vinculo ? esc(d.vinculo.toLowerCase()) : null;
  const formal = d.titularidade_formal && !d.inverter;
  const C: Array<{ t: string; p: string[] }> = [];
  C.push({ t: 'DO OBJETO', p: [
    `O presente termo tem por objeto o ${loteTxt}, situado em ${mun}, com área total de <b>${esc(haAlq(l.area_ha))}</b>${l.area_util_ha ? `, área útil de ${esc(haAlq(l.area_util_ha))}` : ''}${l.perimetro_m ? `, perímetro de ${esc(m2(l.perimetro_m))} m` : ''}${l.vertices ? ` e ${l.vertices} vértices` : ''}${l.confrontantes.length ? `, confrontando com: ${esc(l.confrontantes.join('; '))}` : ''}, conforme planta e memorial descritivo do parcelamento georreferenciado do PA (SIRGAS 2000), elaborados pela Romatec Consultoria Total.`,
  ] });
  C.push({ t: 'DA CONCESSÃO DE USO', p: [
    `O(A) CONCEDENTE concede ao(à) CONCESSIONÁRIO(A), a título <b>gratuito</b> e por <b>prazo indeterminado</b>, o direito de <b>uso, posse direta, moradia e exploração agropecuária</b> do imóvel descrito na Cláusula Primeira, com todas as benfeitorias nele existentes.`,
  ] });
  if (formal) C.push({ t: 'DA DECLARAÇÃO DE POSSE', p: [
    `As partes declaram que o lote foi cadastrado em nome do(a) CONCEDENTE por <b>conveniência e segurança familiar</b>, e que é o(a) CONCESSIONÁRIO(A) quem exerce, de fato, a posse, o uso, a moradia e a exploração do imóvel, sendo de sua propriedade as benfeitorias, plantações e criações nele existentes e as que vier a realizar.`,
    `Enquanto o(a) CONCESSIONÁRIO(A) cumprir as obrigações deste termo, a presente concessão <b>não poderá ser revogada por ato unilateral</b> do(a) CONCEDENTE.`,
  ] });
  C.push({ t: 'DAS OBRIGAÇÕES DO(A) CONCESSIONÁRIO(A)', p: [
    `Caberá ao(à) CONCESSIONÁRIO(A): (a) usar o imóvel para moradia e atividade agropecuária, conservando-o; (b) respeitar as Áreas de Preservação Permanente e a Reserva Legal (Lei nº 12.651/2012); (c) observar o estatuto e as deliberações da ${assoc} e as normas do INCRA aplicáveis ao assentamento; (d) não ceder, emprestar ou alienar o uso a terceiros sem anuência escrita do(a) CONCEDENTE e da Associação; (e) manter os marcos e divisas do lote.`,
  ] });
  C.push({ t: 'DA TITULARIDADE', p: [
    `Este termo <b>não transfere a titularidade cadastral nem o domínio</b> do lote, que permanecem em nome do(a) titular junto à Associação e aos órgãos competentes. Eventual transferência dependerá de procedimento próprio, observada a legislação agrária (Lei nº 8.629/1993) e as normas do INCRA.`,
  ] });
  C.push({ t: 'DA EXTINÇÃO', p: [
    `A concessão extingue-se por distrato escrito entre as partes, por renúncia do(a) CONCESSIONÁRIO(A), pelo seu falecimento ou pelo descumprimento das obrigações deste termo, devidamente comprovado perante a Associação.`,
  ] });
  C.push({ t: 'DA ANUÊNCIA DA ASSOCIAÇÃO', p: [
    `A ${assoc}, por seu(sua) representante legal, declara ciência e anuência a este termo e registrará o(a) CONCESSIONÁRIO(A) como responsável pelo uso do lote em seus cadastros.`,
  ] });
  if (d.obs) C.push({ t: 'DISPOSIÇÕES ESPECIAIS', p: [esc(d.obs)] });
  C.push({ t: 'DO FORO', p: [`Fica eleito o foro da Comarca de Açailândia/MA para dirimir quaisquer dúvidas oriundas deste termo, com renúncia a qualquer outro, por mais privilegiado que seja.`] });
  const ORD = ['PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA', 'NONA', 'DÉCIMA'];
  // titular: "titular cadastral do lote"; a outra parte: o vínculo dela com o titular (ex.: pai)
  const papel = (pe: PessoaTermo) => pe === titular
    ? `, titular cadastral do lote${l.titular.numero ? ` (associado(a) nº ${esc(l.titular.numero)})` : ''}`
    : (vinc ? `, <b>${vinc}</b> do(a) titular do lote` : '');
  const preambulo = `Pelo presente instrumento particular, de um lado, como <b>CONCEDENTE</b>, ${qualificar(concedente)}${papel(concedente)}; de outro lado, como <b>CONCESSIONÁRIO(A)</b>, ${qualificar(concessionario)}${papel(concessionario)}; e, como <b>INTERVENIENTE ANUENTE</b>, a <b>${assoc}</b>; têm entre si justo e acordado o presente <b>Termo de Concessão de Uso</b>, que se regerá pelas cláusulas seguintes:`;
  return { preambulo, clausulas: C.map((c, i) => ({ titulo: `CLÁUSULA ${ORD[i]} — ${c.t}`, paragrafos: c.p })), concedente, concessionario, formal };
}

function arquivoBrand(nome: string | null): string {
  if (!nome) return '';
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? `data:${nome.endsWith('.png') ? 'image/png' : 'image/jpeg'};base64,${readFileSync(f).toString('base64')}` : '';
}

export function htmlTermo(p: Projeto, l: LoteTermo, d: DadosTermo): string {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const m = marcaArquivos(p.codigo);
  const bras = arquivoBrand(m.brasao), logo = arquivoBrand('logo_romatec.jpg');
  const t = clausulasTermo(p, l, d);
  const assoc = p.associacao_nome || `Associação do ${p.nome}`;
  const local = d.local || `${p.municipio}/${p.uf}`;
  const ass = (rot: string, pe: PessoaTermo | null, extra = '') => `<div class="as"><div class="dg"></div><div class="ln"></div><b>${pe ? pe.nome : '&nbsp;'}</b><span>${rot}${pe && pe.cpf ? ` · CPF ${pe.cpf}` : ''}${extra}</span></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Termo de Concessão de Uso — Lote ${esc(l.lote)}</title><style>
    @page { size: A4; margin: 15mm 18mm 18mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11.5pt; color: #111; margin: 0; }
    .cab { display: flex; align-items: center; justify-content: space-between; gap: 4mm; border-bottom: 1.2mm solid #0C3320; padding-bottom: 2.5mm; }
    .cab .bras { height: 20mm; } .cab .logo { height: 12mm; }
    .ct { text-align: center; flex: 1; } .a1 { font-family: Arial, sans-serif; font-weight: 800; font-size: 10.5pt; color: #0C3320; } .a2 { font-family: Arial, sans-serif; font-size: 8.5pt; color: #555; margin-top: 1mm; }
    .faixa { height: .7mm; background: #C9A84C; margin: .8mm 0 5mm; }
    h1 { text-align: center; font-size: 14pt; margin: 0 0 1mm; letter-spacing: .4pt; color: #0C3320; }
    .sub { text-align: center; font-family: Arial, sans-serif; font-size: 9.5pt; color: #333; margin-bottom: 5mm; }
    p { text-align: justify; line-height: 1.55; margin: 0 0 2.6mm; text-indent: 10mm; }
    h3 { font-size: 10.8pt; margin: 3.6mm 0 1.4mm; color: #0C3320; letter-spacing: .2pt; }
    .quadro { font-family: Arial, sans-serif; font-size: 8.6pt; border: .3mm solid #0C3320; border-radius: 1.5mm; margin: 0 0 4mm; display: grid; grid-template-columns: repeat(4, 1fr); }
    .quadro div { padding: 1.4mm 2mm; border-right: .2mm solid #c9c2ae; } .quadro div:last-child { border-right: 0; }
    .quadro span { display: block; font-size: 6.8pt; color: #6a6656; text-transform: uppercase; font-weight: 700; } .quadro b { color: #0C3320; }
    .fecho { text-indent: 10mm; margin-top: 4mm; }
    .data { text-align: right; margin: 4mm 0 2mm; }
    .assin { display: grid; grid-template-columns: 1fr 1fr; gap: 9mm 12mm; margin-top: 6mm; page-break-inside: avoid; }
    .as { text-align: center; font-size: 9.6pt; position: relative; padding-top: 12mm; }
    .as .ln { border-top: .3mm solid #111; margin-bottom: 1mm; } .as b { display: block; min-height: 4mm; font-size: 9.4pt; } .as span { color: #444; font-size: 8.4pt; }
    .as .dg { position: absolute; right: -2mm; top: -2mm; width: 14mm; height: 16mm; border: .25mm dashed #999; border-radius: 1mm; }
    .as.sem .dg { display: none; }
    .nota { font-family: Arial, sans-serif; font-size: 7pt; color: #666; margin-top: 5mm; border-top: .2mm solid #C9A84C; padding-top: 1.5mm; }
  </style></head><body>
    <div class="cab">${bras ? `<img class="bras" src="${bras}">` : '<span></span>'}<div class="ct"><div class="a1">${esc(assoc.toUpperCase())}</div><div class="a2">${esc(p.nome)} · ${esc(p.municipio)}/${esc(p.uf)} · ${p.associacao_cnpj ? 'CNPJ ' + esc(p.associacao_cnpj) : 'CNPJ em homologação'}</div></div>${logo ? `<img class="logo" src="${logo}">` : '<span></span>'}</div>
    <div class="faixa"></div>
    <h1>TERMO DE CONCESSÃO DE USO</h1>
    <div class="sub">Lote ${esc(l.lote)}${l.denominacao ? ` · ${esc(l.denominacao)}` : ''} · ${esc(p.nome)}</div>
    <div class="quadro"><div><span>Lote</span><b>${esc(l.lote)}</b>${l.titular.lote_vila ? ` · vila ${esc(l.titular.lote_vila)}` : ''}</div><div><span>Área total</span><b>${esc(haAlq(l.area_ha))}</b></div>
      <div><span>Concedente</span><b>${t.concedente.nome}</b></div><div><span>Concessionário(a)</span><b>${t.concessionario.nome}</b></div></div>
    <p>${t.preambulo}</p>
    ${t.clausulas.map((c) => `<h3>${c.titulo}</h3>${c.paragrafos.map((x) => `<p>${x}</p>`).join('')}`).join('')}
    <p class="fecho">E, por estarem justas e acordadas, as partes assinam o presente termo em 3 (três) vias de igual teor e forma, na presença das testemunhas abaixo, para que produza seus efeitos legais.</p>
    <div class="data">${esc(local)}, ${esc(dataExtenso(d.data))}.</div>
    <div class="assin">
      ${ass('CONCEDENTE', t.concedente)}
      ${ass('CONCESSIONÁRIO(A)', t.concessionario)}
      <div class="as sem"><div class="ln"></div><b>${esc(p.presidente_nome || '')}</b><span>Presidente — ${esc(assoc)} (interveniente anuente)</span></div>
      <div class="as sem"><div class="ln"></div><b>&nbsp;</b><span>Testemunha 1 — nome e CPF</span></div>
      <div class="as sem"><div class="ln"></div><b>&nbsp;</b><span>Testemunha 2 — nome e CPF</span></div>
      <div class="as sem"><div class="ln"></div><b>&nbsp;</b><span>Assinatura a rogo (quem não sabe ou não pode assinar) — nome e CPF</span></div>
    </div>
    <div class="nota">Quadro pontilhado ao lado das assinaturas: impressão digital (polegar direito). Documento elaborado por Romatec Consultoria Total${p.rt_nome ? ` · Responsável técnico: ${esc(p.rt_nome)}${p.rt_registro ? ' · ' + esc(p.rt_registro) : ''}` : ''}. A área e as confrontações seguem o parcelamento georreferenciado do PA.</div>
  </body></html>`;
}

async function pessoaTitular(associadoId: number) {
  const r = await rows(pool, 'SELECT a.numero, a.nome, a.cpf, a.rg, a.nascimento, a.estado_civil, a.endereco, lt.numero AS lote_vila FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.id = ?', [associadoId]);
  const x = r[0];
  if (!x) throw new PaErro('NAO_ENCONTRADO', 'Titular do lote não encontrado', 404);
  return {
    nome: String(x.nome).toUpperCase(), cpf: x.cpf ? String(x.cpf) : null, rg: (x.rg as string) ?? null, nascimento: isoDate(x.nascimento), naturalidade: null, filiacao: null,
    estado_civil: (x.estado_civil as string) ?? null, profissao: null, endereco: (x.endereco as string) ?? null, nacionalidade: null,
    numero: x.numero ? String(x.numero) : null, lote_vila: x.lote_vila ? String(x.lote_vila) : null,
  };
}

async function loteDoTermo(projetoId: number, lote: string): Promise<LoteTermo> {
  const sub = await buscarSubdivisao(projetoId);
  const pc = sub?.parcelas.find((x) => x.lote === lote);
  if (!pc) throw new PaErro('NAO_ENCONTRADO', `Lote ${lote} não está na subdivisão do PA`, 404);
  const ben = (await vinculosParcelas(projetoId))[lote];
  if (!ben) throw new PaErro('SEM_TITULAR', `O lote ${lote} não tem associado vinculado — vincule o titular no Mapa antes de gerar o termo`, 409);
  const mun = await municipiosDosLotes(projetoId).catch(() => null);
  const idx = mun?.por_lote?.[lote];
  return {
    lote, area_ha: pc.perimetro.area_ha, area_util_ha: pc.area_util_ha, perimetro_m: pc.perimetro.perimetro_m, vertices: pc.perimetro.vertices.length,
    confrontantes: [...new Set(pc.lados.map((x) => x.confrontante))].filter(Boolean), denominacao: ben.denominacao ?? null,
    municipio: idx != null && mun ? mun.municipios[idx]?.nome ?? null : null,
    titular: await pessoaTitular(ben.associado_id),
  };
}

/** Lotes com titular e os participantes de cada um (para o formulário). */
export async function opcoesConcessao(projetoId: number) {
  const sub = await buscarSubdivisao(projetoId);
  const vinc = await vinculosParcelas(projetoId);
  const aids = Object.values(vinc).map((v) => v.associado_id);
  const parts = aids.length ? await rows(pool, `SELECT associado_id, nome, vinculo, cpf, rg, nascimento FROM pa_participantes WHERE ativo = 1 AND associado_id IN (${aids.map(() => '?').join(',')}) ORDER BY nome`, aids) : [];
  return {
    lotes: (sub?.parcelas ?? []).filter((pc) => vinc[pc.lote]).map((pc) => {
      const b = vinc[pc.lote];
      return { lote: pc.lote, area_ha: pc.perimetro.area_ha, denominacao: b.denominacao ?? null, titular: b.nome,
        participantes: parts.filter((x) => Number(x.associado_id) === b.associado_id).map((x) => ({ nome: String(x.nome), vinculo: String(x.vinculo), cpf: (x.cpf as string) ?? null, rg: (x.rg as string) ?? null, nascimento: isoDate(x.nascimento) })) };
    }).sort((a, b) => a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true })),
  };
}

export async function pdfConcessao(projetoId: number, corpo: Record<string, unknown>, usuario: string | null): Promise<{ pdf: Buffer; nome: string }> {
  const d = lerDadosTermo(corpo);
  const p = await buscarProjeto(projetoId);
  const l = await loteDoTermo(projetoId, d.lote);
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  const pdf = await htmlToPdf(htmlTermo(p, l, d), {
    format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:7.5pt;font-family:Arial;color:#777;padding:0 18mm;display:flex;justify-content:space-between"><span>Termo de Concessão de Uso — Lote ${l.lote} · ${p.nome}</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
    margin: { top: '15mm', right: '18mm', bottom: '18mm', left: '18mm' },
  });
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'TERMO_CONCESSAO', dados: { lote: l.lote, titular: l.titular.nome, outra: d.outra.nome, inverter: d.inverter } });
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
  return { pdf, nome: `TERMO-CONCESSAO-USO-LT-${l.lote}-${slug(d.outra.nome).slice(0, 40)}.pdf` };
}
