// src/services/relatorioDemarcacao.ts
// Service de Relatório de Fatura de Demarcações
// RomatecVoiceAgent v1.99.15 — Romatec Consultoria Total

import { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import * as crypto from 'crypto';

export interface ListarFiltro {
  loteadorId?: number;
  loteamento?: string;
  dataInicio?: string;   // YYYY-MM-DD
  dataFim?: string;
  busca?: string;        // texto livre (numero, contrato, lote)
}

export interface LaudoListado {
  id: number;
  numero: string;
  tipo_imovel: string | null;
  imovel_descricao: string | null;
  contrato: string | null;
  quadra: string | null;
  lote: string | null;
  data_demarcacao: string | null;
  area_m2: number;
  valor: number;
  status_faturamento: 'pendente' | 'faturado' | 'pago' | 'cancelado';
  relatorio_id: number | null;
  relatorio_numero: string | null;
  faturado_em: string | null;
  pago_em: string | null;
}

export interface CriarRelatorioInput {
  laudoIds: number[];
  loteadorId?: number;
  loteadorNome: string;
  loteadorDocumento?: string;
  loteadorWhatsapp?: string;
  loteamento?: string;
  dataVencimento?: string;
  observacoes?: string;
  emitidoPor: string;
}

export class RelatorioDemarcacaoService {
  constructor(private pool: Pool) {}

  // ===================== LISTAR A FATURAR =====================
  // v3.15.9: usa nomes reais de coluna (laudos_demarcacao tem numero_laudo,
  // denominacao_imovel, numero_contrato, numero_lote, area_total_m2 — sem
  // data_demarcacao especifica, usa data_pagamento ou created_at)
  async listarAFaturar(filtro: ListarFiltro = {}): Promise<LaudoListado[]> {
    const where: string[] = [`l.status_faturamento = 'pendente'`, `l.ativo = 1`];
    const params: any[] = [];

    if (filtro.loteamento) {
      where.push(`l.loteamento LIKE ?`);
      params.push(`%${filtro.loteamento}%`);
    }
    if (filtro.dataInicio) { where.push(`COALESCE(l.data_pagamento, DATE(l.created_at)) >= ?`); params.push(filtro.dataInicio); }
    if (filtro.dataFim)    { where.push(`COALESCE(l.data_pagamento, DATE(l.created_at)) <= ?`); params.push(filtro.dataFim); }
    if (filtro.busca) {
      where.push(`(l.numero_laudo LIKE ? OR l.numero_contrato LIKE ? OR l.numero_lote LIKE ? OR l.denominacao_imovel LIKE ? OR l.loteamento LIKE ?)`);
      const b = `%${filtro.busca}%`;
      params.push(b, b, b, b, b);
    }

    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
          l.id,
          l.numero_laudo AS numero,
          l.tipo_imovel,
          l.denominacao_imovel AS imovel_descricao,
          l.numero_contrato AS contrato,
          l.quadra,
          l.numero_lote AS lote,
          COALESCE(l.data_pagamento, DATE(l.created_at)) AS data_demarcacao,
          l.area_total_m2 AS area_m2,
          COALESCE(l.valor_demarcacao, 0) AS valor,
          l.status_faturamento, l.relatorio_id, l.faturado_em, l.pago_em,
          NULL AS relatorio_numero
         FROM laudos_demarcacao l
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(l.data_pagamento, l.created_at) DESC, l.id DESC`,
      params
    );
    return rows as any;
  }

  // ===================== LISTAR JÁ FATURADAS =====================
  async listarJaFaturadas(filtro: ListarFiltro = {}): Promise<LaudoListado[]> {
    const where: string[] = [`l.status_faturamento IN ('faturado','pago')`, `l.ativo = 1`];
    const params: any[] = [];

    if (filtro.loteamento) { where.push(`l.loteamento LIKE ?`); params.push(`%${filtro.loteamento}%`); }
    if (filtro.dataInicio) { where.push(`COALESCE(l.data_pagamento, DATE(l.created_at)) >= ?`); params.push(filtro.dataInicio); }
    if (filtro.dataFim)    { where.push(`COALESCE(l.data_pagamento, DATE(l.created_at)) <= ?`); params.push(filtro.dataFim); }
    if (filtro.busca) {
      where.push(`(l.numero_laudo LIKE ? OR l.numero_contrato LIKE ? OR l.numero_lote LIKE ? OR r.numero LIKE ?)`);
      const b = `%${filtro.busca}%`;
      params.push(b, b, b, b);
    }

    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
          l.id,
          l.numero_laudo AS numero,
          l.tipo_imovel,
          l.denominacao_imovel AS imovel_descricao,
          l.numero_contrato AS contrato,
          l.quadra,
          l.numero_lote AS lote,
          COALESCE(l.data_pagamento, DATE(l.created_at)) AS data_demarcacao,
          l.area_total_m2 AS area_m2,
          COALESCE(l.valor_demarcacao, 0) AS valor,
          l.status_faturamento, l.relatorio_id, l.faturado_em, l.pago_em,
          r.numero AS relatorio_numero
         FROM laudos_demarcacao l
         LEFT JOIN relatorios_demarcacao r ON r.id = l.relatorio_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.faturado_em DESC, l.id DESC`,
      params
    );
    return rows as any;
  }

  // ===================== PREVIEW (totais antes de gerar) =====================
  async previewSelecao(laudoIds: number[]): Promise<{
    itens: LaudoListado[];
    qtd: number;
    areaTotal: number;
    valorTotal: number;
  }> {
    if (!laudoIds?.length) return { itens: [], qtd: 0, areaTotal: 0, valorTotal: 0 };
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT
          l.id,
          l.numero_laudo AS numero,
          l.tipo_imovel,
          l.denominacao_imovel AS imovel_descricao,
          l.numero_contrato AS contrato,
          l.quadra,
          l.numero_lote AS lote,
          COALESCE(l.data_pagamento, DATE(l.created_at)) AS data_demarcacao,
          l.area_total_m2 AS area_m2,
          COALESCE(l.valor_demarcacao, 0) AS valor,
          l.status_faturamento, l.relatorio_id
         FROM laudos_demarcacao l
        WHERE l.id IN (?)`,
      [laudoIds]
    );
    const itens = rows as any as LaudoListado[];
    const pendentes = itens.filter(i => i.status_faturamento === 'pendente');
    const areaTotal = pendentes.reduce((s, i) => s + Number(i.area_m2 || 0), 0);
    const valorTotal = pendentes.reduce((s, i) => s + Number(i.valor || 0), 0);
    return {
      itens: pendentes,
      qtd: pendentes.length,
      areaTotal: +areaTotal.toFixed(2),
      valorTotal: +valorTotal.toFixed(2),
    };
  }

  // ===================== CRIAR RELATÓRIO =====================
  async criarRelatorio(input: CriarRelatorioInput): Promise<{
    relatorioId: number;
    numero: string;
    qtd: number;
    areaTotal: number;
    valorTotal: number;
    hashValidacao: string;
  }> {
    if (!input.laudoIds?.length) throw new Error('Selecione ao menos um laudo.');
    if (!input.loteadorNome) throw new Error('Informe o loteador/destinatário.');

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1) Buscar laudos selecionados COM LOCK
      const [laudos] = await conn.query<RowDataPacket[]>(
        `SELECT id,
                numero_laudo AS numero,
                tipo_imovel,
                denominacao_imovel AS imovel_descricao,
                numero_contrato AS contrato,
                quadra,
                numero_lote AS lote,
                COALESCE(data_pagamento, DATE(created_at)) AS data_demarcacao,
                area_total_m2 AS area_m2,
                COALESCE(valor_demarcacao, 0) AS valor,
                status_faturamento
           FROM laudos_demarcacao
          WHERE id IN (?)
          FOR UPDATE`,
        [input.laudoIds]
      );
      if (laudos.length === 0) throw new Error('Nenhum laudo encontrado.');

      const naoPendentes = laudos.filter((l: any) => l.status_faturamento !== 'pendente');
      if (naoPendentes.length > 0) {
        throw new Error(`Laudos já faturados: ${naoPendentes.map((l: any) => l.numero).join(', ')}`);
      }
      const semValor = laudos.filter((l: any) => Number(l.valor) <= 0);
      if (semValor.length > 0) {
        throw new Error(`Laudos sem valor definido: ${semValor.map((l: any) => l.numero).join(', ')}`);
      }

      // 2) Buscar dados de pagamento do emissor
      const [dpRows] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM dados_pagamento_emissor WHERE ativo = 1 ORDER BY id DESC LIMIT 1`
      );
      const dp = dpRows[0] || {};

      // 3) Gerar número sequencial
      const ano = new Date().getFullYear();
      await conn.execute(
        `INSERT INTO relatorios_demarcacao_seq (ano, ultimo_numero) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE ultimo_numero = ultimo_numero + 1`,
        [ano]
      );
      const [seqRows] = await conn.query<RowDataPacket[]>(
        `SELECT ultimo_numero FROM relatorios_demarcacao_seq WHERE ano = ?`,
        [ano]
      );
      const seq = String(seqRows[0].ultimo_numero).padStart(4, '0');
      const numero = `REL-${ano}-${seq}`;

      // 4) Totais
      const qtd = laudos.length;
      const areaTotal = +(laudos as any[]).reduce((s, l) => s + Number(l.area_m2 || 0), 0).toFixed(2);
      const valorTotal = +(laudos as any[]).reduce((s, l) => s + Number(l.valor || 0), 0).toFixed(2);

      // 5) Datas do período
      const datas = (laudos as any[]).map(l => l.data_demarcacao).filter(Boolean).sort();
      const periodoInicio = datas[0] || null;
      const periodoFim = datas[datas.length - 1] || null;

      const dataEmissao = new Date().toISOString().slice(0, 10);

      // 6) Inserir cabeçalho
      const [insRel] = await conn.execute<ResultSetHeader>(
        `INSERT INTO relatorios_demarcacao
           (numero, loteador_id, loteador_nome, loteador_documento, loteador_whatsapp,
            loteamento, data_emissao, data_vencimento, periodo_inicio, periodo_fim,
            qtd_itens, area_total_m2, valor_total,
            pagamento_pix, pagamento_banco, pagamento_agencia, pagamento_conta,
            pagamento_titular, pagamento_documento,
            observacoes, status, emitido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'emitido', ?)`,
        [
          numero, input.loteadorId ?? null, input.loteadorNome,
          input.loteadorDocumento ?? null, input.loteadorWhatsapp ?? null,
          input.loteamento ?? null, dataEmissao, input.dataVencimento ?? null,
          periodoInicio, periodoFim,
          qtd, areaTotal, valorTotal,
          dp.pix ?? null, dp.banco ?? null, dp.agencia ?? null, dp.conta ?? null,
          dp.titular ?? null, dp.documento ?? null,
          input.observacoes ?? null, input.emitidoPor,
        ]
      );
      const relatorioId = insRel.insertId;

      // 7) Hash de validação (para QR code do PDF)
      const hash = crypto.createHash('sha256')
        .update(`${relatorioId}|${numero}|${valorTotal}|${dataEmissao}`)
        .digest('hex')
        .slice(0, 16);
      await conn.execute(
        `UPDATE relatorios_demarcacao SET hash_validacao = ? WHERE id = ?`,
        [hash, relatorioId]
      );

      // 8) Inserir itens (snapshot)
      for (const l of laudos as any[]) {
        await conn.execute(
          `INSERT INTO relatorios_demarcacao_itens
             (relatorio_id, laudo_id, laudo_numero, tipo_imovel, imovel_descricao,
              contrato, quadra, lote, data_demarcacao, area_m2, valor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            relatorioId, l.id, l.numero, l.tipo_imovel, l.imovel_descricao,
            l.contrato, l.quadra, l.lote, l.data_demarcacao,
            Number(l.area_m2), Number(l.valor),
          ]
        );
      }

      // 9) Marcar laudos como faturados
      await conn.execute(
        `UPDATE laudos_demarcacao
            SET status_faturamento = 'faturado',
                relatorio_id = ?,
                faturado_em = NOW()
          WHERE id IN (?)`,
        [relatorioId, input.laudoIds]
      );

      await conn.commit();
      return { relatorioId, numero, qtd, areaTotal, valorTotal, hashValidacao: hash };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  // ===================== OBTER DETALHE =====================
  async obterDetalhe(relatorioId: number) {
    const [head] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM relatorios_demarcacao WHERE id = ?`,
      [relatorioId]
    );
    if (head.length === 0) return null;
    const [itens] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM relatorios_demarcacao_itens
        WHERE relatorio_id = ?
        ORDER BY data_demarcacao, id`,
      [relatorioId]
    );
    return { ...head[0], itens };
  }

  // ===================== PREVIEW DO ENVIO (texto + telefone) =====================
  // v3.15.7: gera texto formal pra WhatsApp com lista de serviços, totais,
  // dados bancários, agradecimento e contato do CEO. UI pode editar antes de enviar.
  async previewEnvio(relatorioId: number): Promise<{
    relatorio_id: number;
    telefone: string;
    contato_default: string;
    texto: string;
    pdf_url: string;
  }> {
    const det: any = await this.obterDetalhe(relatorioId);
    if (!det) throw new Error('Relatório não encontrado.');
    const tel = String(det.loteador_whatsapp || '').replace(/\D/g, '');
    return {
      relatorio_id: relatorioId,
      telefone: tel,
      contato_default: '(99) 9 9181-1246',
      texto: montarTextoEnvio(det),
      pdf_url: `/api/relatorios-demarcacao/${relatorioId}/pdf`,
    };
  }

  // ===================== MARCAR COMO PAGO =====================
  async marcarPago(relatorioId: number, usuario: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rel] = await conn.query<RowDataPacket[]>(
        `SELECT id, status FROM relatorios_demarcacao WHERE id = ? FOR UPDATE`,
        [relatorioId]
      );
      if (rel.length === 0) throw new Error('Relatório não encontrado.');
      if (rel[0].status === 'pago') throw new Error('Relatório já está pago.');
      if (rel[0].status === 'cancelado') throw new Error('Relatório cancelado.');

      await conn.execute(
        `UPDATE relatorios_demarcacao SET status = 'pago', pago_em = NOW() WHERE id = ?`,
        [relatorioId]
      );
      await conn.execute(
        `UPDATE laudos_demarcacao
            SET status_faturamento = 'pago', pago_em = NOW()
          WHERE relatorio_id = ?`,
        [relatorioId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  // ===================== CANCELAR RELATÓRIO =====================
  // Devolve os laudos ao status 'pendente'
  async cancelar(relatorioId: number, motivo: string): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rel] = await conn.query<RowDataPacket[]>(
        `SELECT status FROM relatorios_demarcacao WHERE id = ? FOR UPDATE`,
        [relatorioId]
      );
      if (rel.length === 0) throw new Error('Relatório não encontrado.');
      if (rel[0].status === 'pago') throw new Error('Relatório pago não pode ser cancelado.');

      await conn.execute(
        `UPDATE relatorios_demarcacao
            SET status = 'cancelado', observacoes = CONCAT(COALESCE(observacoes,''), '\nCANCELADO: ', ?)
          WHERE id = ?`,
        [motivo, relatorioId]
      );
      await conn.execute(
        `UPDATE laudos_demarcacao
            SET status_faturamento = 'pendente', relatorio_id = NULL, faturado_em = NULL
          WHERE relatorio_id = ?`,
        [relatorioId]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
}

// ===================== HELPERS =====================
function fmtMoedaBR(v: number | string): string {
  return Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function fmtDataBR(d: any): string {
  if (!d) return '-';
  const s = String(d).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : '-';
}
function montarDescItem(it: any): string {
  const partes: string[] = [];
  if (it.imovel_descricao) partes.push(String(it.imovel_descricao));
  if (it.contrato) partes.push(`Contr. ${it.contrato}`);
  if (it.quadra) partes.push(`Q.${it.quadra}`);
  if (it.lote) partes.push(`Lote ${it.lote}`);
  return partes.join(' · ') || '-';
}

/** v3.15.7: texto formal pra envio do relatório via WhatsApp.
 *  Inclui lista de serviços executados, totais, dados bancários completos,
 *  agradecimento e contato CEO. UI permite editar antes do envio. */
export function montarTextoEnvio(det: any): string {
  const linhasServicos = (det.itens || []).map((it: any, i: number) =>
    `${(i + 1).toString().padStart(2, '0')}. *${it.laudo_numero}* — ${montarDescItem(it)}` +
    `\n     📏 ${fmtMoedaBR(it.area_m2)} m² · 💰 R$ ${fmtMoedaBR(it.valor)}`
  ).join('\n');

  const linhasBanco: string[] = [];
  if (det.pagamento_pix)   linhasBanco.push(`• *PIX (${/@/.test(det.pagamento_pix) ? 'e-mail' : 'chave'}):* ${det.pagamento_pix}`);
  if (det.pagamento_banco) linhasBanco.push(`• *Banco:* ${det.pagamento_banco} · *Ag.:* ${det.pagamento_agencia || '-'} · *C/C:* ${det.pagamento_conta || '-'}`);
  if (det.pagamento_titular) linhasBanco.push(`• *Titular:* ${det.pagamento_titular}${det.pagamento_documento ? ` · *CNPJ/CPF:* ${det.pagamento_documento}` : ''}`);

  const venc = det.data_vencimento ? `\n📅 *Vencimento:* ${fmtDataBR(det.data_vencimento)}` : '';

  return [
    `Prezado(a) ${det.loteador_nome},`,
    ``,
    `Esperamos que esteja bem.`,
    ``,
    `Em primeiro lugar, *agradecemos a confiança e a parceria* com a *Romatec Consultoria Imobiliária* na execução dos serviços técnicos de demarcação descritos abaixo.`,
    ``,
    `Encaminhamos, em caráter formal, o *Relatório de Demarcações Faturáveis ${det.numero}*, contendo o detalhamento dos serviços executados e o respectivo valor a receber:`,
    ``,
    `📋 *Serviços executados (${det.qtd_itens} ${det.qtd_itens === 1 ? 'laudo' : 'laudos'}):*`,
    linhasServicos,
    ``,
    `📐 *Área total demarcada:* ${fmtMoedaBR(det.area_total_m2)} m²`,
    `💰 *Valor total a receber:* *R$ ${fmtMoedaBR(det.valor_total)}*${venc}`,
    ``,
    `🏦 *Dados para pagamento:*`,
    ...linhasBanco,
    ``,
    `📎 *PDF detalhado em anexo* (segue na próxima mensagem).`,
    ``,
    `📞 *Contato Romatec (dúvidas):* WhatsApp (99) 9 9181-1246`,
    ``,
    `Reforçamos nosso compromisso com a *qualidade técnica*, a *precisão dos levantamentos* e a *transparência* em toda a relação contratual. Agradecemos novamente a oportunidade de prestar nossos serviços.`,
    ``,
    `Cordialmente,`,
    `*Romatec Consultoria Imobiliária*`,
    `_Engenharia · Agrimensura · Gestão de Obras_`,
  ].join('\n');
}
