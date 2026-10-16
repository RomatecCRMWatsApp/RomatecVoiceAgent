// v3.149.0 — Ata da Assembleia Geral Extraordinária de aprovação da contratação
// da empresa de georreferenciamento (padrão INCRA), personalizada Romatec.
// Mesmo conteúdo em PDF (impressão) e DOCX (edição no Word). Dados do projeto e
// lista de presença com TODOS os associados ativos para assinatura.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { pool, rows, registrarEvento } from './paDb';
import { buscarProjeto, type Projeto } from './paRepo';
import { marcaArquivos } from './marcaProjeto';

export const CONTRATADA = {
  nome: 'ROMATEC CONSULTORIA TOTAL', razao: 'J R P BEZERRA LTDA', cnpj: '17.261.987/0001-09', cidade: 'Açailândia/MA',
};

export interface DadosAta {
  data: string | null;            // aaaa-mm-dd
  hora_inicio: string | null;     // hh:mm
  hora_fim: string | null;
  local: string | null;
  presidente_mesa: string | null;
  secretario: string | null;
  edital_data: string | null;     // data do edital/convocação
  votos_favor: string | null;
  votos_contra: string | null;
  abstencoes: string | null;
  presentes: string | null;
  observacoes: string | null;
}

const LINHA = '____________________';
const CURTA = '________';
const s = (v: unknown, max = 200) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };
export function lerDadosAta(q: Record<string, unknown>): DadosAta {
  const data = s(q.data, 10);
  return {
    data: data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null,
    hora_inicio: s(q.hora_inicio, 5), hora_fim: s(q.hora_fim, 5), local: s(q.local), presidente_mesa: s(q.presidente_mesa, 160),
    secretario: s(q.secretario, 160), edital_data: s(q.edital_data, 10), votos_favor: s(q.votos_favor, 6), votos_contra: s(q.votos_contra, 6),
    abstencoes: s(q.abstencoes, 6), presentes: s(q.presentes, 6), observacoes: s(q.observacoes, 2000),
  };
}

// ─── Datas por extenso ────────────────────────────────────────────────────
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const UN = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
export function numeroExtenso(n: number): string {
  if (n < 20) return UN[n] || 'zero';
  if (n < 100) return DEZ[Math.floor(n / 10)] + (n % 10 ? ' e ' + UN[n % 10] : '');
  if (n < 1000) { const c = Math.floor(n / 100), r = n % 100; const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'][c]; return n === 100 ? 'cem' : C + (r ? ' e ' + numeroExtenso(r) : ''); }
  const m = Math.floor(n / 1000), r = n % 1000;
  return (m === 1 ? 'mil' : numeroExtenso(m) + ' mil') + (r ? (r < 100 || r % 100 === 0 ? ' e ' : ' ') + numeroExtenso(r) : '');
}
export function dataExtenso(iso: string | null): string {
  if (!iso) return `aos ${LINHA} dias do mês de ${LINHA} do ano de ${LINHA}`;
  const [a, m, d] = iso.split('-').map(Number);
  return `${d === 1 ? 'ao primeiro dia' : `aos ${numeroExtenso(d)} dias`} do mês de ${MESES[m - 1]} do ano de ${numeroExtenso(a)}`;
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dBr = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : LINHA);
const ou = (v: string | null, alt = LINHA) => v || alt;

// ─── Conteúdo (fonte única para PDF e DOCX) ───────────────────────────────
type Run = { t: string; b?: boolean };
type Bloco =
  | { k: 'titulo'; t: string }
  | { k: 'sub'; t: string }
  | { k: 'p'; r: Run[] }
  | { k: 'item'; n: string; r: Run[] };

export interface Associado { lote: string; numero: string; nome: string; cpf: string }

export function conteudoAta(p: Projeto, d: DadosAta, totalAssociados: number): Bloco[] {
  const assoc = p.associacao_nome || `Associação do ${p.nome}`;
  const cnpj = p.associacao_cnpj ? `inscrita no CNPJ sob o nº ${p.associacao_cnpj}` : 'com inscrição no CNPJ em processo de homologação';
  const parcela = Math.max(0, p.valor_lote - p.sinal_padrao);
  const nParc = p.boleto_padrao > 0 ? Math.round(parcela / p.boleto_padrao) : 0;
  const rt = `${p.rt_nome || 'José Romário Pinto Bezerra'}${p.rt_registro ? `, ${p.rt_registro}` : ''}`;
  const votos = (d.votos_favor || d.votos_contra || d.abstencoes)
    ? `${ou(d.votos_favor, '0')} votos favoráveis, ${ou(d.votos_contra, '0')} votos contrários e ${ou(d.abstencoes, '0')} abstenções`
    : `${CURTA} votos favoráveis, ${CURTA} votos contrários e ${CURTA} abstenções`;
  return [
    { k: 'titulo', t: 'ATA DA ASSEMBLEIA GERAL EXTRAORDINÁRIA' },
    { k: 'sub', t: `APROVAÇÃO DA CONTRATAÇÃO DE EMPRESA ESPECIALIZADA EM GEORREFERENCIAMENTO, TOPOGRAFIA E DEMARCAÇÃO DAS PARCELAS DO ${p.nome.toUpperCase()}` },
    { k: 'p', r: [
      { t: `${dataExtenso(d.data).replace(/^a/, 'A')}, às ${ou(d.hora_inicio, '____h____')} horas, ` },
      { t: `no(a) ${ou(d.local, `${LINHA}${LINHA}`)}, ` },
      { t: `município de ${p.municipio}/${p.uf}, reuniram-se em Assembleia Geral Extraordinária os associados e associadas da ` },
      { t: assoc.toUpperCase(), b: true },
      { t: `, ${cnpj}, beneficiários do ${p.nome}, regularmente convocados por edital ${d.edital_data ? `publicado/afixado em ${dBr(d.edital_data)}` : 'de convocação afixado em local público e comunicado aos associados'}, conforme o Estatuto Social, com a presença de ` },
      { t: `${ou(d.presentes, CURTA)} (${d.presentes && /^\d+$/.test(d.presentes) ? numeroExtenso(Number(d.presentes)) : CURTA + CURTA})`, b: true },
      { t: ` associados, de um total de ${totalAssociados} (${numeroExtenso(totalAssociados)}) associados cadastrados, conforme Lista de Presença e Assinaturas anexa (Anexo I), que é parte integrante desta ata, verificado o quórum estatutário.` },
    ] },
    { k: 'p', r: [
      { t: 'Para presidir os trabalhos foi aclamado(a) o(a) Sr(a). ' }, { t: ou(d.presidente_mesa, `${LINHA}${LINHA}`), b: true },
      { t: ', que convidou o(a) Sr(a). ' }, { t: ou(d.secretario, `${LINHA}${LINHA}`), b: true },
      { t: ' para secretariar a reunião e lavrar a presente ata. Instalada a assembleia, o(a) Presidente procedeu à leitura da seguinte ' }, { t: 'ORDEM DO DIA', b: true }, { t: ':' },
    ] },
    { k: 'item', n: '1.', r: [{ t: 'Apresentação dos serviços técnicos de georreferenciamento de todo o Projeto de Assentamento — perímetro, parcelas (lotes), área da vila, áreas comunitárias e estradas —, com levantamento topográfico, demarcação, plantas, memoriais descritivos e demais peças técnicas;' }] },
    { k: 'item', n: '2.', r: [{ t: 'Escolha e aprovação da contratação da empresa ' }, { t: `${CONTRATADA.nome} (${CONTRATADA.razao}), CNPJ ${CONTRATADA.cnpj}`, b: true }, { t: `, com sede em ${CONTRATADA.cidade}, tendo como Responsável Técnico ${rt}, profissional credenciado(a) no INCRA para georreferenciamento (SIGEF);` }] },
    { k: 'item', n: '3.', r: [{ t: 'Aprovação do valor global, do rateio entre os associados, da forma de pagamento e da prestação de contas;' }] },
    { k: 'item', n: '4.', r: [{ t: 'Doação das peças técnicas ao INCRA por meio de Termo de Doação;' }] },
    { k: 'item', n: '5.', r: [{ t: 'Ratificação dos serviços de levantamento de campo já iniciados e autorização à Diretoria para assinar o contrato e representar a Associação perante os órgãos competentes;' }] },
    { k: 'item', n: '6.', r: [{ t: 'Assuntos gerais.' }] },
    { k: 'p', r: [
      { t: 'ITEM 1 — ', b: true },
      { t: `O representante da empresa apresentou aos presentes o escopo dos serviços, que compreende: (a) o georreferenciamento de todo o ${p.nome}, abrangendo o perímetro, as parcelas, a área da vila, as áreas comunitárias e as estradas, com vértices definidos por posicionamento GNSS no Sistema Geodésico Brasileiro (SIRGAS 2000) e precisão compatível com a ` },
      { t: 'Norma Técnica para Georreferenciamento de Imóveis Rurais (NTGIR)', b: true },
      { t: ', o Manual Técnico de Posicionamento e o Manual Técnico de Limites e Confrontações do INCRA, em atendimento à Lei nº 10.267/2001 e ao Decreto nº 4.449/2002; (b) a demarcação física das parcelas com implantação de marcos; (c) a elaboração da planta geral, das plantas individuais e dos memoriais descritivos; (d) a preparação dos arquivos para análise e certificação no Sistema de Gestão Fundiária (SIGEF/INCRA); e (e) a entrega das peças técnicas ao INCRA para fins de titulação, nos termos da ' },
      { t: 'Norma Técnica Conjunta INCRA nº 01/2017', b: true },
      { t: ', ou da norma que vier a substituí-la, observadas a Lei nº 8.629/1993, a Lei nº 13.465/2017 e o Decreto nº 9.311/2018, no que couber. Os serviços serão executados sob o acompanhamento e a fiscalização do INCRA.' },
    ] },
    { k: 'p', r: [
      { t: 'Foram prestados aos presentes os seguintes esclarecimentos, conforme orientação do INCRA: (i) a contratação é ' },
      { t: 'facultativa', b: true },
      { t: ' e a sua não realização não retira dos assentados o direito à titulação; (ii) a escolha da empresa e a negociação dos custos cabem exclusivamente à Associação, não havendo indicação de profissionais nem fixação de valores pelo INCRA, cujo acompanhamento é gratuito; (iii) a contratação não assegura prazo para a titulação, que depende também da situação dominial do imóvel, do cumprimento das cláusulas contratuais pelos assentados e da atualização cadastral com supervisão ocupacional realizadas pelo INCRA; e (iv) a Diretoria deverá consultar o INCRA sobre a situação do assentamento e solicitar as peças técnicas existentes para subsidiar os trabalhos. Foram esclarecidas as dúvidas dos associados.' },
    ] },
    { k: 'p', r: [
      { t: 'ITEM 2 — ', b: true },
      { t: 'Posta em votação a escolha da empresa ' }, { t: CONTRATADA.nome, b: true },
      { t: ` para a execução dos serviços descritos no Item 1, mediante contrato de prestação de serviços firmado entre a Associação e a empresa, a proposta foi ` }, { t: 'APROVADA', b: true }, { t: ` por ${votos}.` },
    ] },
    { k: 'p', r: [
      { t: 'ITEM 3 — ', b: true },
      { t: 'Foi aprovado o valor global estimado de ' }, { t: `${brl(p.valor_lote * totalAssociados)} (${totalAssociados} lotes × ${brl(p.valor_lote)})`, b: true },
      { t: `, rateado igualmente entre os associados beneficiários na razão de ${brl(p.valor_lote)} por lote, pagos da seguinte forma: entrada de ${brl(p.sinal_padrao)} e saldo de ${brl(parcela)}${nParc > 0 ? ` em ${nParc} (${numeroExtenso(nParc)}) parcela(s) de ${brl(p.boleto_padrao)}` : ''}, por boleto bancário ou Pix vinculados ao contrato da Associação, com controle por lote. Os pagamentos serão comprovados por recibos e notas fiscais emitidos pela contratada em favor do contrato, e a Diretoria prestará contas aos associados, em assembleia, dos valores arrecadados e dos serviços executados, com base no extrato de pagamentos por lote.` },
    ] },
    { k: 'p', r: [
      { t: 'ITEM 4 — ', b: true },
      { t: 'A assembleia aprovou que, concluídos os trabalhos, as peças técnicas (plantas, memoriais descritivos, arquivos de georreferenciamento e relatórios) sejam ' },
      { t: 'doadas ao INCRA por meio de Termo de Doação', b: true },
      { t: ' firmado pela Associação, para análise, certificação no SIGEF e prosseguimento da titulação das parcelas.' },
    ] },
    { k: 'p', r: [
      { t: 'ITEM 5 — ', b: true },
      { t: 'A assembleia ratificou os serviços de levantamento de campo já iniciados pela contratada e autorizou a Diretoria da Associação, representada por seu(sua) Presidente, a firmar o contrato de prestação de serviços com a empresa aprovada, a acompanhar a execução dos trabalhos, a fornecer as informações e documentos necessários, a firmar o Termo de Doação e a representar a Associação perante o INCRA, o órgão estadual de terras, o Cartório de Registro de Imóveis e demais órgãos públicos, para os fins desta deliberação.' },
    ] },
    { k: 'p', r: [
      { t: 'ITEM 6 — ', b: true },
      { t: d.observacoes ? d.observacoes : `Assuntos gerais: ${LINHA}${LINHA}${LINHA}${LINHA}${LINHA}${LINHA}.` },
    ] },
    { k: 'p', r: [
      { t: `Nada mais havendo a tratar, o(a) Presidente agradeceu a presença de todos e declarou encerrada a assembleia às ${ou(d.hora_fim, '____h____')} horas. Para constar, eu, ${ou(d.secretario, LINHA + LINHA)}, Secretário(a), lavrei a presente ata, que, lida e achada conforme, vai assinada por mim, pelo(a) Presidente da Assembleia, pelo(a) Presidente da Associação e pelos associados presentes na Lista de Presença e Assinaturas (Anexo I).` },
    ] },
    { k: 'p', r: [{ t: `${p.municipio}/${p.uf}, ${d.data ? dBr(d.data) : `${LINHA} de ${LINHA} de ${LINHA}`}.` }] },
  ];
}

export const ASSINATURAS = (p: Projeto, d: DadosAta) => [
  { nome: d.presidente_mesa, cargo: 'Presidente da Assembleia' },
  { nome: d.secretario, cargo: 'Secretário(a)' },
  { nome: p.presidente_nome, cargo: 'Presidente da Associação' },
  { nome: p.rt_nome ? `${p.rt_nome} — ${CONTRATADA.nome}` : CONTRATADA.nome, cargo: 'Contratada (Responsável Técnico)' },
];

async function associadosDoProjeto(projetoId: number): Promise<Associado[]> {
  const r = await rows(pool, `
    SELECT a.numero, a.nome, a.cpf, lt.numero AS lote FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE a.projeto_id = ? AND a.ativo = 1 ORDER BY CAST(lt.numero AS UNSIGNED), lt.numero`, [projetoId]);
  return r.map((x) => ({ lote: String(x.lote), numero: String(x.numero), nome: String(x.nome), cpf: String(x.cpf) }));
}

function arquivoBrand(nome: string | null): Buffer | null {
  if (!nome) return null;
  const f = [path.resolve(__dirname, '../../public/brand/pa', nome), path.resolve(process.cwd(), 'src/public/brand/pa', nome), path.resolve(process.cwd(), 'dist/public/brand/pa', nome)].find((c) => existsSync(c));
  return f ? readFileSync(f) : null;
}

// ─── PDF (HTML) ───────────────────────────────────────────────────────────
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const EXTRAS = 8; // linhas em branco no fim da lista para quem não está cadastrado

export function htmlAta(p: Projeto, d: DadosAta, lista: Associado[]): string {
  const m = marcaArquivos(p.codigo);
  const b64 = (buf: Buffer | null, mime: string) => (buf ? `data:${mime};base64,${buf.toString('base64')}` : '');
  const bras = b64(arquivoBrand(m.brasao), 'image/png');
  const logo = b64(arquivoBrand('logo_romatec.jpg'), 'image/jpeg');
  const blocos = conteudoAta(p, d, lista.length);
  const corpo = blocos.map((bl) => {
    if (bl.k === 'titulo') return `<h1>${esc(bl.t)}</h1>`;
    if (bl.k === 'sub') return `<h2>${esc(bl.t)}</h2>`;
    const txt = bl.r.map((r) => (r.b ? `<b>${esc(r.t)}</b>` : esc(r.t))).join('');
    return bl.k === 'item' ? `<p class="item"><span>${esc(bl.n)}</span>${txt}</p>` : `<p>${txt}</p>`;
  }).join('');
  const ass = ASSINATURAS(p, d).map((a) => `<div class="as"><div class="ln"></div><b>${esc(a.nome || '')}</b><span>${esc(a.cargo)}</span></div>`).join('');
  const linhas = [...lista.map((a, i) => ({ ...a, i: i + 1 })), ...Array.from({ length: EXTRAS }, (_, k) => ({ i: lista.length + k + 1, lote: '', numero: '', nome: '', cpf: '' }))];
  const tabela = `<table><thead><tr><th style="width:7mm">Nº</th><th style="width:11mm">Lote</th><th>Nome do(a) associado(a)</th><th style="width:31mm">CPF</th><th style="width:62mm">Assinatura</th></tr></thead><tbody>
    ${linhas.map((a) => `<tr><td class="c">${a.i}</td><td class="c">${esc(a.lote)}</td><td>${esc(a.nome)}</td><td class="c">${esc(a.cpf)}</td><td></td></tr>`).join('')}</tbody></table>`;
  const cab = `<div class="cab">${bras ? `<img class="bras" src="${bras}">` : '<span></span>'}<div class="ct"><div class="a1">${esc((p.associacao_nome || `Associação do ${p.nome}`).toUpperCase())}</div><div class="a2">${esc(p.municipio)}/${esc(p.uf)} · ${p.associacao_cnpj ? 'CNPJ ' + esc(p.associacao_cnpj) : 'CNPJ em homologação'}</div></div>${logo ? `<img class="logo" src="${logo}">` : '<span></span>'}</div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ata — ${esc(p.nome)}</title><style>
    @page { size: A4; margin: 16mm 18mm 18mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11.5pt; color: #111; margin: 0; }
    .cab { display: flex; align-items: center; justify-content: space-between; gap: 4mm; border-bottom: 1.2mm solid #0C3320; padding-bottom: 2.5mm; margin-bottom: 1mm; }
    .cab .bras { height: 19mm; } .cab .logo { height: 13mm; }
    .ct { text-align: center; flex: 1; } .a1 { font-family: Arial, sans-serif; font-weight: 800; font-size: 10.5pt; color: #0C3320; } .a2 { font-family: Arial, sans-serif; font-size: 8.5pt; color: #555; margin-top: 1mm; }
    .faixa { height: .7mm; background: #C9A84C; margin-bottom: 5mm; }
    h1 { text-align: center; font-size: 13.5pt; margin: 2mm 0 1.5mm; letter-spacing: .3pt; }
    h2 { text-align: center; font-size: 10.5pt; margin: 0 0 5mm; font-weight: 700; line-height: 1.35; }
    p { text-align: justify; line-height: 1.6; margin: 0 0 3mm; text-indent: 10mm; }
    p.item { text-indent: 0; padding-left: 16mm; position: relative; margin-bottom: 1.6mm; }
    p.item span { position: absolute; left: 10mm; font-weight: 700; }
    .assin { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm 12mm; margin-top: 14mm; page-break-inside: avoid; }
    .as { text-align: center; font-size: 10pt; } .as .ln { border-top: .3mm solid #111; margin-bottom: 1.2mm; } .as b { display: block; min-height: 4mm; } .as span { color: #444; font-size: 9pt; }
    .anexo { page-break-before: always; }
    .anexo h1 { margin-top: 0; } .anexo h2 { margin-bottom: 3mm; }
    table { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 8.6pt; }
    th { background: #0C3320; color: #fff; padding: 1.6mm 1.2mm; border: .25mm solid #0C3320; }
    td { border: .25mm solid #888; padding: 0 1.4mm; height: 8.6mm; }
    tr:nth-child(even) td { background: #f6f3ea; }
    td.c { text-align: center; }
    thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body>
    ${cab}<div class="faixa"></div>${corpo}<div class="assin">${ass}</div>
    <section class="anexo">${cab}<div class="faixa"></div><h1>ANEXO I — LISTA DE PRESENÇA E ASSINATURAS</h1>
      <h2>Assembleia Geral Extraordinária de ${d.data ? dBr(d.data) : LINHA} — ${esc(p.nome)}</h2>${tabela}</section>
  </body></html>`;
}

export async function pdfAta(projetoId: number, d: DadosAta, usuario: string | null): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const lista = await associadosDoProjeto(projetoId);
  const { htmlToPdf } = await import('../../pdf/htmlToPdf');
  const pdf = await htmlToPdf(htmlAta(p, d, lista), {
    format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:7.5pt;font-family:Arial;color:#777;padding:0 18mm;display:flex;justify-content:space-between"><span>Ata da AGE — ${esc(p.nome)} · documento elaborado por Romatec Consultoria Total</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', right: '18mm', bottom: '18mm', left: '18mm' },
  });
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'ATA_ASSEMBLEIA', dados: { formato: 'pdf', data: d.data, associados: lista.length } });
  return { pdf, nome: `ATA-ASSEMBLEIA-CONTRATACAO-${p.codigo}${d.data ? '-' + d.data : ''}.pdf` };
}

// ─── DOCX (Word editável) ─────────────────────────────────────────────────
const VERDE = '0C3320';
export async function docxAta(projetoId: number, d: DadosAta, usuario: string | null): Promise<{ docx: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const lista = await associadosDoProjeto(projetoId);
  const m = marcaArquivos(p.codigo);
  const bras = arquivoBrand(m.brasao);
  const logo = arquivoBrand('logo_romatec.jpg');
  const FONTE = 'Times New Roman';
  const run = (r: Run, size = 23) => new TextRun({ text: r.t, bold: r.b, font: FONTE, size });
  const semBorda = { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } };

  const cabecalho = () => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...semBorda, insideHorizontal: semBorda.top, insideVertical: semBorda.top, bottom: { style: BorderStyle.SINGLE, size: 18, color: VERDE } },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, borders: semBorda, children: [new Paragraph({ children: bras ? [new ImageRun({ type: 'png', data: bras, transformation: { width: 62, height: 70 } })] : [] })] }),
      new TableCell({ width: { size: 62, type: WidthType.PERCENTAGE }, borders: semBorda, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: (p.associacao_nome || `Associação do ${p.nome}`).toUpperCase(), bold: true, font: 'Arial', size: 20, color: VERDE })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${p.municipio}/${p.uf} · ${p.associacao_cnpj ? 'CNPJ ' + p.associacao_cnpj : 'CNPJ em homologação'}`, font: 'Arial', size: 16, color: '555555' })] }),
      ] }),
      new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, borders: semBorda, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: logo ? [new ImageRun({ type: 'jpg', data: logo, transformation: { width: 110, height: 42 } })] : [] })] }),
    ] })],
  });

  const corpo = conteudoAta(p, d, lista.length).map((bl) => {
    if (bl.k === 'titulo') return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: bl.t, bold: true, font: FONTE, size: 27 })] });
    if (bl.k === 'sub') return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: bl.t, bold: true, font: FONTE, size: 21 })] });
    if (bl.k === 'item') return new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { left: 900, hanging: 340 }, spacing: { after: 80, line: 340 }, children: [run({ t: bl.n + ' ', b: true }), ...bl.r.map((r) => run(r))] });
    return new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 567 }, spacing: { after: 140, line: 360 }, children: bl.r.map((r) => run(r)) });
  });

  const assinaturas = ASSINATURAS(p, d);
  const celAss = (a: { nome: string | null; cargo: string }) => new TableCell({ borders: semBorda, width: { size: 50, type: WidthType.PERCENTAGE }, children: [
    new Paragraph({ spacing: { before: 700 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '_______________________________________', font: FONTE, size: 22 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: a.nome || ' ', bold: true, font: FONTE, size: 20 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: a.cargo, font: FONTE, size: 18, color: '444444' })] }),
  ] });
  const tabelaAss = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...semBorda, insideHorizontal: semBorda.top, insideVertical: semBorda.top },
    rows: [new TableRow({ children: [celAss(assinaturas[0]), celAss(assinaturas[1])] }), new TableRow({ children: [celAss(assinaturas[2]), celAss(assinaturas[3])] })],
  });

  const cel = (t: string, w: number, opts: { head?: boolean; center?: boolean } = {}) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE }, shading: opts.head ? { fill: VERDE, color: 'auto', type: 'clear' as never } : undefined,
    children: [new Paragraph({ alignment: opts.center || opts.head ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun({ text: t, font: 'Arial', size: 17, bold: opts.head, color: opts.head ? 'FFFFFF' : '111111' })] })],
  });
  const linhas = [...lista.map((a, i) => ({ ...a, i: i + 1 })), ...Array.from({ length: EXTRAS }, (_, k) => ({ i: lista.length + k + 1, lote: '', numero: '', nome: '', cpf: '' }))];
  const tabelaLista = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: [cel('Nº', 6, { head: true }), cel('Lote', 8, { head: true }), cel('Nome do(a) associado(a)', 40, { head: true }), cel('CPF', 17, { head: true }), cel('Assinatura', 29, { head: true })] }),
      ...linhas.map((a) => new TableRow({ height: { value: 480, rule: 'atLeast' as never }, cantSplit: true, children: [cel(String(a.i), 6, { center: true }), cel(a.lote, 8, { center: true }), cel(a.nome, 40), cel(a.cpf, 17, { center: true }), cel('', 29)] })),
    ],
  });

  const rodape = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
    new TextRun({ text: `Ata da AGE — ${p.nome} · documento elaborado por Romatec Consultoria Total · Página `, font: 'Arial', size: 14, color: '777777' }),
    new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 14, color: '777777' }),
    new TextRun({ text: ' de ', font: 'Arial', size: 14, color: '777777' }),
    new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 14, color: '777777' }),
  ] })] });
  const margem = { top: 900, right: 1020, bottom: 1020, left: 1020 };
  const doc = new Document({
    creator: 'Romatec Consultoria Total', title: `Ata da Assembleia — ${p.nome}`,
    sections: [
      { properties: { page: { margin: margem } }, headers: { default: new Header({ children: [cabecalho()] }) }, footers: { default: rodape }, children: [...corpo, tabelaAss] },
      { properties: { page: { margin: margem } }, headers: { default: new Header({ children: [cabecalho()] }) }, footers: { default: rodape }, children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new TextRun({ text: 'ANEXO I — LISTA DE PRESENÇA E ASSINATURAS', bold: true, font: FONTE, size: 25 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: `Assembleia Geral Extraordinária de ${d.data ? dBr(d.data) : LINHA} — ${p.nome}`, font: FONTE, size: 20 })] }),
        tabelaLista,
      ] },
    ],
  });
  const docx = await Packer.toBuffer(doc);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'ATA_ASSEMBLEIA', dados: { formato: 'docx', data: d.data, associados: lista.length } });
  return { docx, nome: `ATA-ASSEMBLEIA-CONTRATACAO-${p.codigo}${d.data ? '-' + d.data : ''}.docx` };
}
