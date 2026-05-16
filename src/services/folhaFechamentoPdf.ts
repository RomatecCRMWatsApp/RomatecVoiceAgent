// v3.10.1 — Relatório PDF do Fechamento de Folha.
//
// Conteúdo:
//   - Cabecalho: obra, periodo, status, totais
//   - Por colaborador:
//       * Nome, funcao, telefone
//       * Diaria, dias trabalhados (datas individuais com periodo)
//       * Valor total e valor liquido
//       * Chave PIX cadastrada (com aviso se nao houver)
//   - Rodape com totalizacao geral

import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
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
  cpf: string | null;
}

function fmtMoeda(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fmtDataBR(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, dd] = s.split('-');
  return `${dd}/${m}/${y}`;
}

function fmtDDMM(d: Date | string): string {
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [, m, dd] = s.split('-');
  return `${dd}/${m}`;
}

function badgePeriodo(p: 'integral' | 'manha' | 'tarde'): string {
  if (p === 'integral') return '●';     // dia inteiro
  if (p === 'manha')    return '◐';     // só manhã
  return '◑';                            // só tarde
}

export async function gerarPdfFechamento(fechamentoId: number): Promise<Buffer> {
  // 1. Cabeçalho do fechamento + obra
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

  // 2. Itens
  const [itens] = await pool.query<ItemRow[]>(
    `SELECT * FROM folha_fechamento_itens WHERE fechamento_id = ? ORDER BY funcionario_nome`,
    [fechamentoId]
  );

  // 3. Dias trabalhados por funcionario + dados de pagamento
  const dadosEquipe = new Map<number, EquipeRow>();
  const diasPorFuncionario = new Map<number, DiaRow[]>();
  for (const it of itens) {
    const [equipe] = await pool.query<EquipeRow[]>(
      `SELECT telefone, chave_pix, cpf FROM romatec_obra_equipe WHERE id = ? LIMIT 1`,
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

  // 4. Monta PDF
  const corHex = '#10b981';
  const logoFile = path.join(__dirname, '..', 'public', 'romatec-logo-removebg-preview.png');

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
    Title: `Fechamento de Folha #${fech.id}`,
    Author: 'Romatec Consultoria Imobiliaria',
  }});
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // Cabeçalho com logo
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, { fit: [120, 60], align: 'center' }); } catch { /* opt */ }
  } else {
    doc.fontSize(16).fillColor(corHex).text('Romatec Consultoria Imobiliaria', { align: 'center' });
  }
  doc.moveDown(0.5);
  doc.strokeColor(corHex).lineWidth(2).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.8);

  // Titulo
  doc.fontSize(15).fillColor('#111').text('RELATÓRIO DE FECHAMENTO DE FOLHA', { align: 'center' });
  const subtitulo = `Fechamento #${fech.id}${fech.rotulo ? ' — ' + fech.rotulo : ''}`;
  doc.fontSize(11).fillColor('#444').text(subtitulo, { align: 'center' });
  doc.moveDown(0.8);

  // Dados do fechamento
  doc.fontSize(11).fillColor(corHex).text('Dados do Fechamento');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#111');
  doc.text(`Obra: ${fech.obra_nome}${fech.obra_cliente ? ' — ' + fech.obra_cliente : ''}`);
  if (fech.obra_endereco) doc.text(`Endereço: ${fech.obra_endereco}`);
  if (fech.obra_cidade) doc.text(`Cidade: ${fech.obra_cidade}`);
  doc.text(`Período: ${fmtDataBR(fech.data_inicio)} a ${fmtDataBR(fech.data_fim)}`);
  if (fech.data_fim_prevista) doc.text(`Período previsto (corte padrão): ${fmtDataBR(fech.data_fim_prevista)}`);
  doc.text(`Data do fechamento: ${fmtDataBR(fech.data_fechamento)}`);
  if (fech.fechado_por) doc.text(`Fechado por: ${fech.fechado_por}`);
  doc.text(`Status: ${fech.status.toUpperCase()}`);
  if (fech.observacoes) doc.text(`Observações: ${fech.observacoes}`);
  doc.moveDown(0.6);

  // Totais
  doc.fontSize(11).fillColor(corHex).text('Totais');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#111');
  doc.text(`Funcionários: ${fech.total_funcionarios}`);
  doc.text(`Bruto: ${fmtMoeda(fech.total_valor)}`);
  doc.text(`Vales: ${fmtMoeda(fech.total_vales)}`);
  doc.font('Helvetica-Bold').text(`Líquido a pagar: ${fmtMoeda(fech.total_liquido)}`);
  doc.font('Helvetica');
  doc.moveDown(0.8);

  // Detalhe por colaborador
  doc.fontSize(12).fillColor(corHex).text('Detalhamento por Colaborador');
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(corHex).lineWidth(1).stroke();
  doc.moveDown(0.4);

  for (const it of itens) {
    // Quebra de pagina automatica se nao caber bloco completo (estimativa minima)
    if (doc.y > 720) doc.addPage();

    const eq = dadosEquipe.get(it.funcionario_id);
    const dias = diasPorFuncionario.get(it.funcionario_id) || [];

    // Linha separadora suave entre colaboradores
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    // Status badge na linha do nome
    const statusLabel =
      it.status_pagamento === 'paga'      ? '✓ PAGO' :
      it.status_pagamento === 'cancelada' ? '✗ CANCELADO' :
                                            '○ ABERTA';
    const statusColor =
      it.status_pagamento === 'paga'      ? '#16a34a' :
      it.status_pagamento === 'cancelada' ? '#dc2626' :
                                            '#f59e0b';

    doc.fontSize(12).font('Helvetica-Bold').fillColor('#111')
      .text(it.funcionario_nome, 48, doc.y, { continued: true, width: 380 })
      .font('Helvetica').fontSize(9).fillColor(statusColor)
      .text(`  [${statusLabel}]`, { continued: false });

    doc.font('Helvetica').fontSize(9).fillColor('#666');
    const linha2: string[] = [];
    if (it.funcao) linha2.push(it.funcao);
    if (eq?.telefone) linha2.push('Tel: ' + eq.telefone);
    if (eq?.cpf) linha2.push('CPF: ' + eq.cpf);
    if (linha2.length > 0) doc.text(linha2.join(' · '));

    doc.moveDown(0.2);

    // Tabela de dias
    doc.fontSize(9).fillColor('#111');
    const diasIntStr = String(it.dias_integral);
    const diasManStr = String(it.dias_manha);
    const diasTarStr = String(it.dias_tarde);
    const equivStr = String(it.dias_equivalente);
    doc.text(
      `Dias: integral ${diasIntStr} · manhã ${diasManStr} · tarde ${diasTarStr}  ` +
      `=  ${equivStr} dias equiv. × ${fmtMoeda(it.diaria)}/dia`
    );

    // Lista de datas individuais (se tiver)
    if (dias.length > 0) {
      const linhasDatas: string[] = [];
      let cur = '';
      for (const d of dias) {
        const tag = `${fmtDDMM(d.data)} ${badgePeriodo(d.periodo)}`;
        const tentativa = cur ? `${cur}  ${tag}` : tag;
        if (tentativa.length > 90) {
          linhasDatas.push(cur);
          cur = tag;
        } else {
          cur = tentativa;
        }
      }
      if (cur) linhasDatas.push(cur);

      doc.fontSize(8).fillColor('#555');
      doc.text('Datas: ' + linhasDatas[0]);
      for (let i = 1; i < linhasDatas.length; i++) {
        doc.text('       ' + linhasDatas[i]);
      }
      doc.fontSize(8).fillColor('#999').text('● = integral   ◐ = manhã   ◑ = tarde');
    }

    doc.moveDown(0.2);

    // Linha de valores
    doc.fontSize(10).fillColor('#111');
    const valBruto = fmtMoeda(it.valor_total);
    const valVales = fmtMoeda(it.valor_vales);
    const valLiq = fmtMoeda(it.valor_liquido);
    doc.text(`Bruto: ${valBruto}   Vales: ${valVales}   `, 48, doc.y, { continued: true })
      .font('Helvetica-Bold').text(`Líquido: ${valLiq}`, { continued: false });
    doc.font('Helvetica');

    // Dados de pagamento
    doc.moveDown(0.2);
    doc.fontSize(9);
    if (eq?.chave_pix) {
      doc.fillColor('#10b981').text(`Chave PIX: ${eq.chave_pix}`);
    } else {
      doc.fillColor('#dc2626').text('⚠ Sem chave PIX cadastrada — informar antes de marcar como pago');
    }

    // Se já pago, mostra forma e data
    if (it.status_pagamento === 'paga') {
      doc.fontSize(9).fillColor('#16a34a').text(
        `Pago em ${fmtDataBR(it.data_pagamento)}` +
        (it.forma_pagamento ? ` via ${it.forma_pagamento}` : '')
      );
    }

    doc.moveDown(0.4);
  }

  // Rodape totalizacao
  if (doc.y > 720) doc.addPage();
  doc.moveDown(0.3);
  doc.strokeColor(corHex).lineWidth(1).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.4);
  doc.fontSize(12).fillColor(corHex).font('Helvetica-Bold')
    .text(`TOTAL GERAL LÍQUIDO: ${fmtMoeda(fech.total_liquido)}`, { align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#666')
    .text(`(${fech.total_funcionarios} colaboradores)`, { align: 'right' });

  // Footer em todas as paginas
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor('#999').text(
      `Romatec Consultoria Imobiliária — Relatório gerado em ${fmtDataBR(new Date())}   |   Página ${i + 1}/${range.count}`,
      48, doc.page.height - 30,
      { width: 499, align: 'center', lineBreak: false }
    );
    doc.page.margins.bottom = savedMargin;
  }

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

/** Atualiza chave PIX de um funcionario no cadastro (usado no fluxo "Marcar Pago" quando vem PIX novo). */
export async function atualizarChavePixFuncionario(funcionarioId: number, chavePix: string): Promise<void> {
  await pool.execute(
    `UPDATE romatec_obra_equipe
        SET chave_pix = ?, chave_pix_atualizada_em = NOW()
      WHERE id = ?`,
    [chavePix.trim(), funcionarioId]
  );
}

/** Retorna chave PIX cadastrada do funcionario dono de um item (pra pré-preencher modal). */
export async function getDadosPagamentoItem(itemId: number): Promise<{
  funcionario_id: number;
  funcionario_nome: string;
  funcao: string | null;
  telefone: string | null;
  cpf: string | null;
  chave_pix: string | null;
  valor_liquido: number;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT fi.funcionario_id, fi.funcionario_nome, fi.funcao, fi.valor_liquido,
            e.telefone, e.chave_pix, e.cpf
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
    valor_liquido: Number(r.valor_liquido),
  };
}
