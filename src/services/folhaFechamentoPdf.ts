// v3.10.2 — Relatório PDF do Fechamento de Folha em formato tabular.
// v3.15.17 — gerarPdfFechamentoCompleto: relatorio + comprovantes embedded.

import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';

interface FechamentoRow extends RowDataPacket {
  id: number;
  obra_id: number;
  data_inicio: Date | string;
  data_fim: Date | string;
  data_fim_prevista: Date | string | null;
  rotulo: string | null;
  data_fechamento: Date | string;
  total_funcionarios: number;
  total_valor: string | number;
  total_vales: string | number;
  total_liquido: string | number;
  status: string;
  observacoes: string | null;
  fechado_por: string | null;
}

interface ItemRow extends RowDataPacket {
  id: number;
  fechamento_id: number;
  funcionario_id: number;
  funcionario_nome: string;
  funcao: string | null;
  diaria: string | number;
  dias_integral: string | number;
  dias_manha: string | number;
  dias_tarde: string | number;
  dias_equivalente: string | number;
  valor_total: string | number;
  valor_vales: string | number;
  valor_liquido: string | number;
  status_pagamento: string;
  data_pagamento: Date | string | null;
  forma_pagamento: string | null;
}

interface DiaRow extends RowDataPacket {
  data: Date | string;
  periodo: 'integral' | 'manha' | 'tarde';
  valor: string | number | null;
}

interface EquipeRow extends RowDataPacket {
  telefone: string | null;
  chave_pix: string | null;
  tipo_chave_pix: string | null;
  cpf: string | null;
}

function fmtMoeda(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fmtDataBR(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, dd] = s.split('-');
  return `${dd}/${m}/${y}`;
}

function fmtDDMM(d: Date | string): string {
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [, m, dd] = s.split('-');
  return `${dd}/${m}`;
}

function letraPeriodo(p: 'integral' | 'manha' | 'tarde'): string {
  if (p === 'integral') return 'I';
  if (p === 'manha')    return 'M';
  return 'T';
}

function statusLabel(st: string): { txt: string; cor: string } {
  if (st === 'paga')      return { txt: '[ PAGO ]',     cor: '#16a34a' };
  if (st === 'cancelada') return { txt: '[ CANCELADO ]', cor: '#dc2626' };
  return                          { txt: '[ ABERTA ]',   cor: '#f59e0b' };
}

type Col = { key: string; label: string; w: number; align?: 'left' | 'right' | 'center'; };
type Row = Record<string, string>;

const COR = {
  verde: '#10b981',
  verdeEsc: '#0e8c63',
  cinzaBorda: '#d4d4d8',
  cinzaFundo: '#f4f4f5',
  cinzaTexto: '#52525b',
  pretoTexto: '#18181b',
};

function desenhaCabecalhoTabela(doc: PDFKit.PDFDocument, x: number, y: number, cols: Col[], hAlt = 22): number {
  let cx = x;
  doc.save();
  doc.rect(x, y, cols.reduce((s, c) => s + c.w, 0), hAlt).fillColor(COR.verde).fill();
  doc.fontSize(9).fillColor('#fff').font('Helvetica-Bold');
  for (const c of cols) {
    doc.text(c.label, cx + 4, y + 7, { width: c.w - 8, align: c.align || 'left', lineBreak: false });
    cx += c.w;
  }
  doc.restore();
  doc.font('Helvetica');
  return y + hAlt;
}

function desenhaLinhaTabela(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  cols: Col[],
  row: Row,
  opts: { fundoAlternado?: boolean; corTexto?: string; bold?: boolean; hMin?: number } = {}
): number {
  const larg = cols.reduce((s, c) => s + c.w, 0);
  doc.fontSize(9);
  let hMax = opts.hMin ?? 18;
  for (const c of cols) {
    const txt = row[c.key] ?? '';
    const h = doc.heightOfString(txt, { width: c.w - 8, align: c.align || 'left' }) + 8;
    if (h > hMax) hMax = h;
  }
  if (opts.fundoAlternado) {
    doc.save().rect(x, y, larg, hMax).fillColor(COR.cinzaFundo).fill().restore();
  }
  doc.save().strokeColor(COR.cinzaBorda).lineWidth(0.5)
     .moveTo(x, y + hMax).lineTo(x + larg, y + hMax).stroke().restore();

  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica');
  doc.fillColor(opts.corTexto || COR.pretoTexto);
  let cx = x;
  for (const c of cols) {
    const txt = row[c.key] ?? '';
    doc.text(txt, cx + 4, y + 4, { width: c.w - 8, align: c.align || 'left', lineBreak: true });
    cx += c.w;
  }
  doc.font('Helvetica');
  return y + hMax;
}

function desenhaTabelaCompleta(
  doc: PDFKit.PDFDocument,
  x: number,
  yInit: number,
  cols: Col[],
  rows: Row[]
): number {
  let y = yInit;
  y = desenhaCabecalhoTabela(doc, x, y, cols);
  const limiteY = doc.page.height - doc.page.margins.bottom - 40;
  for (let i = 0; i < rows.length; i++) {
    let hPrev = 18;
    doc.fontSize(9);
    for (const c of cols) {
      const txt = rows[i][c.key] ?? '';
      const h = doc.heightOfString(txt, { width: c.w - 8, align: c.align || 'left' }) + 8;
      if (h > hPrev) hPrev = h;
    }
    if (y + hPrev > limiteY) {
      doc.addPage();
      y = doc.page.margins.top;
      y = desenhaCabecalhoTabela(doc, x, y, cols);
    }
    y = desenhaLinhaTabela(doc, x, y, cols, rows[i], { fundoAlternado: i % 2 === 1 });
  }
  doc.save().strokeColor(COR.cinzaBorda).lineWidth(0.5)
     .rect(x, yInit, cols.reduce((s, c) => s + c.w, 0), y - yInit).stroke().restore();
  return y;
}

export async function gerarPdfFechamento(fechamentoId: number): Promise<Buffer> {
  const [head] = await pool.query<FechamentoRow[]>(
    `SELECT f.*, o.nome AS obra_nome, o.cliente AS obra_cliente, o.endereco AS obra_endereco, o.cidade AS obra_cidade
       FROM folha_fechamentos f
       JOIN romatec_obras o ON o.id = f.obra_id
      WHERE f.id = ?`,
    [fechamentoId]
  );
  if (head.length === 0) throw new Error('Fechamento nao encontrado.');
  const fech = head[0] as FechamentoRow & {
    obra_nome: string; obra_cliente: string | null; obra_endereco: string | null; obra_cidade: string | null;
  };

  const [itens] = await pool.query<ItemRow[]>(
    `SELECT * FROM folha_fechamento_itens WHERE fechamento_id = ? ORDER BY funcionario_nome`,
    [fechamentoId]
  );

  const dadosEquipe = new Map<number, EquipeRow>();
  const diasPorFuncionario = new Map<number, DiaRow[]>();
  for (const it of itens) {
    const [equipe] = await pool.query<EquipeRow[]>(
      `SELECT telefone, chave_pix, tipo_chave_pix, cpf FROM romatec_obra_equipe WHERE id = ? LIMIT 1`,
      [it.funcionario_id]
    );
    if (equipe.length > 0) dadosEquipe.set(it.funcionario_id, equipe[0]);

    const [dias] = await pool.query<DiaRow[]>(
      `SELECT data, periodo, valor FROM romatec_obra_funcionario_dias
        WHERE fechamento_id = ? AND funcionario_id = ?
        ORDER BY data ASC`,
      [fechamentoId, it.funcionario_id]
    );
    diasPorFuncionario.set(it.funcionario_id, dias);
  }

  const logoFile = path.join(__dirname, '..', 'public', 'romatec-logo-removebg-preview.png');

  const doc = new PDFDocument({
    size: 'A4', margin: 40, bufferPages: true,
    info: { Title: `Fechamento de Folha #${fech.id}`, Author: 'Romatec Consultoria Imobiliaria' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // CABEÇALHO
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, 40, 30, { fit: [100, 50] }); } catch { /* opt */ }
  }
  doc.fontSize(15).fillColor(COR.pretoTexto).font('Helvetica-Bold')
    .text('RELATÓRIO DE FECHAMENTO DE FOLHA', 150, 40, { width: 405, align: 'right' });
  doc.fontSize(10).fillColor(COR.cinzaTexto).font('Helvetica')
    .text(`Fechamento #${fech.id}${fech.rotulo ? ' — ' + fech.rotulo : ''}`, 150, 60, { width: 405, align: 'right' });

  doc.strokeColor(COR.verde).lineWidth(2).moveTo(40, 90).lineTo(555, 90).stroke();
  doc.y = 100;

  // TABELA "Dados do Fechamento"
  doc.fontSize(11).fillColor(COR.verde).font('Helvetica-Bold').text('Dados do Fechamento', 40, doc.y);
  doc.moveDown(0.3);
  let y = doc.y;

  const colsDados: Col[] = [
    { key: 'k', label: 'Campo', w: 130 },
    { key: 'v', label: 'Valor', w: 385 },
  ];
  const linhasDados: Row[] = [
    { k: 'Obra', v: `${fech.obra_nome}${fech.obra_cliente ? ' — ' + fech.obra_cliente : ''}` },
    ...(fech.obra_endereco ? [{ k: 'Endereço', v: String(fech.obra_endereco) }] as Row[] : []),
    ...(fech.obra_cidade   ? [{ k: 'Cidade',   v: String(fech.obra_cidade)   }] as Row[] : []),
    { k: 'Período', v: `${fmtDataBR(fech.data_inicio)} a ${fmtDataBR(fech.data_fim)}` },
    ...(fech.data_fim_prevista ? [{ k: 'Período previsto', v: fmtDataBR(fech.data_fim_prevista) }] as Row[] : []),
    { k: 'Data do fechamento', v: fmtDataBR(fech.data_fechamento) },
    ...(fech.fechado_por ? [{ k: 'Fechado por', v: String(fech.fechado_por) }] as Row[] : []),
    { k: 'Status', v: fech.status.toUpperCase() },
    ...(fech.observacoes ? [{ k: 'Observações', v: String(fech.observacoes) }] as Row[] : []),
  ];
  y = desenhaTabelaCompleta(doc, 40, y, colsDados, linhasDados);
  doc.y = y + 10;

  // TABELA "Totais"
  doc.fontSize(11).fillColor(COR.verde).font('Helvetica-Bold').text('Totais', 40, doc.y);
  doc.moveDown(0.3);
  y = doc.y;
  const colsTot: Col[] = [
    { key: 'k', label: 'Item',  w: 200 },
    { key: 'v', label: 'Valor', w: 315, align: 'right' },
  ];
  const linhasTot: Row[] = [
    { k: 'Funcionários',    v: String(fech.total_funcionarios) },
    { k: 'Bruto',           v: fmtMoeda(fech.total_valor) },
    { k: 'Vales',           v: fmtMoeda(fech.total_vales) },
    { k: 'Líquido a pagar', v: fmtMoeda(fech.total_liquido) },
  ];
  y = desenhaTabelaCompleta(doc, 40, y, colsTot, linhasTot);
  doc.y = y + 12;

  // RESUMO FINANCEIRO
  if (doc.y > 680) { doc.addPage(); doc.y = doc.page.margins.top; }
  doc.fontSize(11).fillColor(COR.verde).font('Helvetica-Bold').text('Resumo Financeiro por Colaborador', 40, doc.y);
  doc.moveDown(0.3);
  y = doc.y;

  const colsResumo: Col[] = [
    { key: 'nome',   label: 'Colaborador', w: 130 },
    { key: 'funcao', label: 'Função',      w: 80 },
    { key: 'eq',     label: 'Dias eq.',    w: 50, align: 'right' },
    { key: 'diaria', label: 'Diária',      w: 65, align: 'right' },
    { key: 'bruto',  label: 'Bruto',       w: 65, align: 'right' },
    { key: 'liq',    label: 'Líquido',     w: 65, align: 'right' },
    { key: 'st',     label: 'Status',      w: 60, align: 'center' },
  ];
  const linhasResumo: Row[] = itens.map(it => ({
    nome: it.funcionario_nome,
    funcao: it.funcao || '-',
    eq: String(Number(it.dias_equivalente).toFixed(1)).replace('.', ','),
    diaria: fmtMoeda(it.diaria),
    bruto: fmtMoeda(it.valor_total),
    liq: fmtMoeda(it.valor_liquido),
    st: it.status_pagamento === 'paga' ? 'PAGO' : it.status_pagamento === 'cancelada' ? 'CANC' : 'ABERTA',
  }));
  y = desenhaTabelaCompleta(doc, 40, y, colsResumo, linhasResumo);
  doc.y = y + 16;

  // DETALHE POR COLABORADOR
  // v3.10.3: render defensivo com page-break manual + datas inline (em vez
  // de grid absoluto que disparava auto-page-break por data).
  doc.fontSize(11).fillColor(COR.verde).font('Helvetica-Bold').text('Detalhamento por Colaborador', 40, doc.y);
  doc.moveDown(0.3);

  const limiteY = doc.page.height - doc.page.margins.bottom - 40;

  for (const it of itens) {
    const eq = dadosEquipe.get(it.funcionario_id);
    const dias = diasPorFuncionario.get(it.funcionario_id) || [];
    const stat = statusLabel(it.status_pagamento);

    const blocoX = 40;
    const blocoW = 515;
    const semPix = !eq?.chave_pix;
    const pixLabel = eq?.chave_pix
      ? `${eq.chave_pix}${eq.tipo_chave_pix ? ' (' + eq.tipo_chave_pix.toUpperCase() + ')' : ''}`
      : 'NAO CADASTRADA - informar antes de marcar como pago';

    const linhasDet: Row[] = [
      { k: 'Função', v: it.funcao || '-' },
      ...(eq?.telefone ? [{ k: 'Telefone', v: eq.telefone }] as Row[] : []),
      ...(eq?.cpf      ? [{ k: 'CPF',      v: eq.cpf      }] as Row[] : []),
      { k: 'Diária', v: fmtMoeda(it.diaria) },
      { k: 'Dias trabalhados', v: `Integral: ${it.dias_integral}  ·  Manhã: ${it.dias_manha}  ·  Tarde: ${it.dias_tarde}  ·  Equivalente: ${Number(it.dias_equivalente).toFixed(2).replace('.', ',')} dias` },
      { k: 'Valor Bruto', v: fmtMoeda(it.valor_total) },
      { k: 'Vales', v: fmtMoeda(it.valor_vales) },
      { k: 'Líquido a pagar', v: fmtMoeda(it.valor_liquido) },
      { k: 'Chave PIX', v: pixLabel },
      ...(it.status_pagamento === 'paga' ? [{
        k: 'Pagamento',
        v: `Pago em ${fmtDataBR(it.data_pagamento)}${it.forma_pagamento ? ' via ' + it.forma_pagamento : ''}`,
      }] as Row[] : []),
    ];

    // Texto inline das datas (string com separador, deixa o pdfkit fazer wrap)
    const datasTexto = dias.length > 0
      ? dias.map(d => `${fmtDDMM(d.data)} (${letraPeriodo(d.periodo)})`).join('   ·   ')
      : '';

    // Estimativa de altura do bloco:
    //   header verde     = 22
    //   linhas det       = ~22 * N
    //   datas (se tiver) = label 18 + altura wrap do texto
    const alturaLinhas = linhasDet.length * 22;
    let alturaDatas = 0;
    if (datasTexto) {
      doc.fontSize(9);
      alturaDatas = 18 + doc.heightOfString(datasTexto, { width: blocoW - 16 }) + 8;
    }
    const alturaTotal = 22 + alturaLinhas + alturaDatas + 12;

    // Cabe na pagina atual?
    if (doc.y + alturaTotal > limiteY) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }

    const blocoY = doc.y;

    // Faixa verde do header
    doc.save().rect(blocoX, blocoY, blocoW, 22).fillColor(COR.verdeEsc).fill().restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#fff')
       .text(it.funcionario_nome, blocoX + 8, blocoY + 6, { width: blocoW - 100, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff')
       .text(stat.txt, blocoX + blocoW - 90, blocoY + 7, { width: 82, align: 'right', lineBreak: false });
    doc.font('Helvetica');

    let by = blocoY + 22;

    const colsDet: Col[] = [
      { key: 'k', label: '', w: 140 },
      { key: 'v', label: '', w: blocoW - 140 },
    ];

    for (let i = 0; i < linhasDet.length; i++) {
      const isLiquido = linhasDet[i].k === 'Líquido a pagar';
      const isPix = linhasDet[i].k === 'Chave PIX';
      const corTexto = isLiquido ? COR.verdeEsc : (isPix && semPix) ? '#dc2626' : COR.pretoTexto;
      by = desenhaLinhaTabela(doc, blocoX, by, colsDet, linhasDet[i], {
        fundoAlternado: i % 2 === 1,
        corTexto,
        bold: isLiquido,
      });
    }

    // Datas inline com wrap (sem grid absoluto pra evitar auto-page-break por data)
    if (datasTexto) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COR.pretoTexto)
         .text('Datas trabalhadas (I = integral · M = manhã · T = tarde):', blocoX + 8, by + 4);
      doc.font('Helvetica');
      by += 18;
      doc.fontSize(9).fillColor(COR.cinzaTexto);
      const hDatas = doc.heightOfString(datasTexto, { width: blocoW - 16 });
      doc.text(datasTexto, blocoX + 8, by, { width: blocoW - 16, lineBreak: true });
      by += hDatas + 8;
    }

    // Borda do bloco inteiro
    doc.save().strokeColor(COR.cinzaBorda).lineWidth(0.5)
       .rect(blocoX, blocoY, blocoW, by - blocoY).stroke().restore();

    doc.y = by + 12;
  }

  // TOTAL GERAL
  if (doc.y > 740) { doc.addPage(); doc.y = doc.page.margins.top; }
  doc.moveDown(0.4);
  doc.strokeColor(COR.verde).lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor(COR.verde).font('Helvetica-Bold')
     .text(`TOTAL GERAL LÍQUIDO: ${fmtMoeda(fech.total_liquido)}`, 40, doc.y, { width: 515, align: 'right' });
  doc.fontSize(9).fillColor(COR.cinzaTexto).font('Helvetica')
     .text(`(${fech.total_funcionarios} colaboradores)`, 40, doc.y + 2, { width: 515, align: 'right' });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor(COR.cinzaTexto).font('Helvetica')
      .text(
        `Romatec Consultoria Imobiliaria · Relatorio gerado em ${fmtDataBR(new Date())}   |   Pagina ${i + 1}/${range.count}`,
        40, doc.page.height - 30,
        { width: 515, align: 'center', lineBreak: false }
      );
    doc.page.margins.bottom = savedMargin;
  }

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

export async function atualizarChavePixFuncionario(
  funcionarioId: number,
  chavePix: string,
  tipoChavePix?: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria',
): Promise<void> {
  if (tipoChavePix) {
    await pool.execute(
      `UPDATE romatec_obra_equipe
          SET chave_pix = ?, tipo_chave_pix = ?, chave_pix_atualizada_em = NOW()
        WHERE id = ?`,
      [chavePix.trim(), tipoChavePix, funcionarioId]
    );
  } else {
    await pool.execute(
      `UPDATE romatec_obra_equipe
          SET chave_pix = ?, chave_pix_atualizada_em = NOW()
        WHERE id = ?`,
      [chavePix.trim(), funcionarioId]
    );
  }
}

export async function getDadosPagamentoItem(itemId: number): Promise<{
  funcionario_id: number;
  funcionario_nome: string;
  funcao: string | null;
  telefone: string | null;
  cpf: string | null;
  chave_pix: string | null;
  tipo_chave_pix: string | null;
  valor_liquido: number;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT fi.funcionario_id, fi.funcionario_nome, fi.funcao, fi.valor_liquido,
            e.telefone, e.chave_pix, e.tipo_chave_pix, e.cpf
       FROM folha_fechamento_itens fi
       LEFT JOIN romatec_obra_equipe e ON e.id = fi.funcionario_id
      WHERE fi.id = ?
      LIMIT 1`,
    [itemId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    funcionario_id: Number(r.funcionario_id),
    funcionario_nome: String(r.funcionario_nome),
    funcao: r.funcao ?? null,
    telefone: r.telefone ?? null,
    cpf: r.cpf ?? null,
    chave_pix: r.chave_pix ?? null,
    tipo_chave_pix: r.tipo_chave_pix ?? null,
    valor_liquido: Number(r.valor_liquido),
  };
}

// v3.15.17: PDF unificado = relatorio do fechamento + 1 pagina por comprovante.
// Imagens (JPG/PNG) viram pagina A4 com a foto ajustada. PDFs (boleto/comprovante
// bancario) sao mergeados pagina-por-pagina via pdf-lib.
export async function gerarPdfFechamentoCompleto(fechamentoId: number): Promise<Buffer> {
  const relatorio = await gerarPdfFechamento(fechamentoId);

  // Itens que tem comprovante anexado
  const [itensComComprovante] = await pool.query<RowDataPacket[]>(
    `SELECT id, funcionario_nome, comprovante_arquivo, comprovante_mime, comprovante_filename
       FROM folha_fechamento_itens
      WHERE fechamento_id = ?
        AND comprovante_arquivo IS NOT NULL
      ORDER BY funcionario_nome`,
    [fechamentoId]
  );
  if (itensComComprovante.length === 0) return relatorio;

  const merged = await PDFLibDocument.create();
  const principal = await PDFLibDocument.load(relatorio);
  const principalPages = await merged.copyPages(principal, principal.getPageIndices());
  principalPages.forEach(p => merged.addPage(p));

  const A4_W = 595.28, A4_H = 841.89;
  const margem = 30;
  for (const r of itensComComprovante) {
    const nome = String(r.funcionario_nome);
    const mime = String(r.comprovante_mime || '');
    const buf = r.comprovante_arquivo as Buffer;
    const filename = String(r.comprovante_filename || `comprovante-${r.id}`);
    try {
      if (mime === 'application/pdf') {
        const anexo = await PDFLibDocument.load(buf);
        const pgs = await merged.copyPages(anexo, anexo.getPageIndices());
        pgs.forEach(p => merged.addPage(p));
      } else if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/webp') {
        // pdf-lib so suporta embedPng e embedJpg. webp precisa fallback — pula com aviso.
        if (mime === 'image/webp') {
          console.warn(`[pdf-completo] item ${r.id} webp nao suportado por pdf-lib, pulado`);
          continue;
        }
        const img = mime === 'image/png'
          ? await merged.embedPng(buf)
          : await merged.embedJpg(buf);
        const maxW = A4_W - 2 * margem;
        const maxH = A4_H - 2 * margem - 40; // 40 reservado pro rotulo
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const page = merged.addPage([A4_W, A4_H]);
        page.drawImage(img, { x: (A4_W - w) / 2, y: A4_H - h - margem - 30, width: w, height: h });
        page.drawText(`Comprovante: ${nome}`, { x: margem, y: A4_H - 18, size: 11 });
        page.drawText(filename, { x: margem, y: 18, size: 8 });
      } else {
        console.warn(`[pdf-completo] item ${r.id} mime ${mime} nao suportado, pulado`);
      }
    } catch (err) {
      console.warn(`[pdf-completo] falha mergear item ${r.id} (${filename}): ${(err as Error).message}`);
    }
  }
  const out = await merged.save();
  return Buffer.from(out);
}
