// v1.56.0 — Lembrete proativo de vencimento de documentos.
//
// Cobre os documentos que vencem na rotina Romatec:
// - ART CREA-MA (anuidade CREA + ART específica por serviço)
// - Certidões negativas (federal/estadual/municipal/trabalhista — 30-90 dias)
// - Certidão de matrícula (90 dias geralmente)
// - Certidão de ônus reais (30 dias)
// - CCIR (anual)
// - CAR/SICAR (sem expiração mas tem inscrições anuais)
// - Alvará / AVCB (anual / 3-5 anos)
// - Boletos / IPTU
// - Compromisso de venda (prazo de carência)
// - Contratos de locação (renovação)
//
// Cada documento cadastrado dispara alerta proativo automático em D-30, D-15,
// D-7, D-3, D-1 e D+0 (vencido). Alerta usa o mesmo pipeline de
// romatec_proactive_alerts (com dedup por alert_key).

import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import type { Alert } from '../agent/proactiveDetectors';

export type TipoDocumento =
  | 'art_crea'
  | 'anuidade_crea'
  | 'cnd_federal'
  | 'cnd_estadual'
  | 'cnd_municipal'
  | 'cnd_trabalhista'
  | 'matricula'
  | 'onus_reais'
  | 'ccir'
  | 'car_sicar'
  | 'alvara'
  | 'avcb'
  | 'iptu'
  | 'boleto'
  | 'compromisso_venda'
  | 'locacao'
  | 'apolice_seguro'
  | 'outro';

interface DocVencimentoRow extends RowDataPacket {
  id:               number;
  descricao:        string;
  tipo:             TipoDocumento;
  numero_doc:       string | null;
  data_emissao:     Date | null;
  data_vencimento:  Date;
  obra_id:          number | null;
  contato_nome:     string | null;
  responsavel:      string | null;
  observacoes:      string | null;
  ativo:            number;
  criado_em:        Date;
  atualizado_em:    Date;
}

let _tableReady = false;
async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_documentos_vencimento (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      descricao       VARCHAR(255) NOT NULL,
      tipo            VARCHAR(40) NOT NULL,
      numero_doc      VARCHAR(80),
      data_emissao    DATE,
      data_vencimento DATE NOT NULL,
      obra_id         INT,
      contato_nome    VARCHAR(150),
      responsavel     VARCHAR(150),
      observacoes     TEXT,
      ativo           TINYINT(1) DEFAULT 1,
      criado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_venc      (data_vencimento, ativo),
      INDEX idx_tipo      (tipo, ativo),
      INDEX idx_obra      (obra_id, ativo)
    )
  `);
  _tableReady = true;
}

// ── CRUD ────────────────────────────────────────────────────────────────────
export async function cadastrarDocumento(input: {
  descricao:        string;
  tipo:             TipoDocumento;
  data_vencimento:  string; // YYYY-MM-DD
  numero_doc?:      string;
  data_emissao?:    string;
  obra_id?:         number;
  contato_nome?:    string;
  responsavel?:     string;
  observacoes?:     string;
}): Promise<{ id: number; descricao: string; data_vencimento: string }> {
  await ensureTable();
  if (!input.descricao?.trim()) throw new Error('descricao é obrigatória.');
  if (!input.tipo) throw new Error('tipo é obrigatório.');
  if (!input.data_vencimento) throw new Error('data_vencimento é obrigatória (formato YYYY-MM-DD).');

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_documentos_vencimento
       (descricao, tipo, numero_doc, data_emissao, data_vencimento, obra_id, contato_nome, responsavel, observacoes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.descricao.trim(),
      input.tipo,
      input.numero_doc?.trim() ?? null,
      input.data_emissao ?? null,
      input.data_vencimento,
      input.obra_id ?? null,
      input.contato_nome?.trim() ?? null,
      input.responsavel?.trim() ?? null,
      input.observacoes?.trim() ?? null,
    ],
  );
  return { id: r.insertId, descricao: input.descricao, data_vencimento: input.data_vencimento };
}

export async function listarDocumentos(opts?: {
  apenas_ativos?:  boolean;
  vencendo_em?:    number; // dias (ex: 30 = vence nos próximos 30d)
  vencidos?:       boolean;
  tipo?:           TipoDocumento;
  obra_id?:        number;
}): Promise<DocVencimentoRow[]> {
  await ensureTable();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts?.apenas_ativos !== false) where.push('ativo = 1');
  if (opts?.tipo)    { where.push('tipo = ?');    params.push(opts.tipo); }
  if (opts?.obra_id) { where.push('obra_id = ?'); params.push(opts.obra_id); }
  if (opts?.vencendo_em != null) {
    where.push(`data_vencimento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`);
    params.push(opts.vencendo_em);
  }
  if (opts?.vencidos) where.push('data_vencimento < CURDATE()');

  const sql = `
    SELECT * FROM romatec_documentos_vencimento
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY data_vencimento ASC
    LIMIT 200
  `;
  const [rows] = await pool.execute<DocVencimentoRow[]>(sql, params);
  return rows;
}

export async function marcarRenovado(input: {
  id:                number;
  nova_data_vencimento: string;
  novo_numero_doc?:  string;
  observacoes?:      string;
}): Promise<{ id: number; renovado: boolean; nova_data: string }> {
  await ensureTable();
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_documentos_vencimento
       SET data_vencimento = ?,
           numero_doc      = COALESCE(?, numero_doc),
           observacoes     = CONCAT(IFNULL(observacoes,''), ?)
     WHERE id = ?`,
    [
      input.nova_data_vencimento,
      input.novo_numero_doc?.trim() ?? null,
      `\n[${new Date().toISOString().slice(0,10)}] Renovado: ${input.observacoes ?? 'sem obs'}`,
      input.id,
    ],
  );
  return {
    id:        input.id,
    renovado:  r.affectedRows > 0,
    nova_data: input.nova_data_vencimento,
  };
}

export async function apagarDocumento(id: number): Promise<{ id: number; apagado: boolean }> {
  await ensureTable();
  const [r] = await pool.execute<ResultSetHeader>(
    `UPDATE romatec_documentos_vencimento SET ativo = 0 WHERE id = ?`,
    [id],
  );
  return { id, apagado: r.affectedRows > 0 };
}

// ── Detector proativo ──────────────────────────────────────────────────────
// Roda como parte do pipeline rodarTodosDetectores() — gera alertas em
// D-30, D-15, D-7, D-3, D-1, D+0 (vencido). Cada janela é alert_key único
// pra dedup funcionar (um doc pode disparar 6 alertas no total ao longo da vida).
export async function detectarDocumentosVencendo(): Promise<Alert[]> {
  await ensureTable();
  const [rows] = await pool.execute<DocVencimentoRow[]>(`
    SELECT * FROM romatec_documentos_vencimento
    WHERE ativo = 1
      AND data_vencimento BETWEEN DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                              AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
  `);

  const alerts: Alert[] = [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  for (const r of rows) {
    const venc = new Date(r.data_vencimento);
    venc.setHours(0, 0, 0, 0);
    const diasRestantes = Math.round((venc.getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000));

    let janela: string | null = null;
    let urgency: Alert['urgency'] = 'medium';

    if      (diasRestantes <= -1) { janela = 'vencido';   urgency = 'urgent'; }
    else if (diasRestantes === 0) { janela = 'vence_hoje'; urgency = 'urgent'; }
    else if (diasRestantes === 1) { janela = 'd-1'; urgency = 'high'; }
    else if (diasRestantes <= 3)  { janela = 'd-3'; urgency = 'high'; }
    else if (diasRestantes <= 7)  { janela = 'd-7'; urgency = 'medium'; }
    else if (diasRestantes <= 15) { janela = 'd-15'; urgency = 'low'; }
    else if (diasRestantes <= 30) { janela = 'd-30'; urgency = 'low'; }
    if (!janela) continue;

    const tipoLabel = TIPO_LABELS[r.tipo] ?? r.tipo;
    const dataStr = venc.toLocaleDateString('pt-BR');
    const titulo  = janela === 'vencido'
      ? `🚨 ${tipoLabel} VENCEU: ${r.descricao}`
      : janela === 'vence_hoje'
      ? `⚠️ ${tipoLabel} vence HOJE: ${r.descricao}`
      : `⏳ ${tipoLabel} vence em ${diasRestantes}d: ${r.descricao}`;

    const ctxParts: string[] = [];
    if (r.numero_doc)   ctxParts.push(`nº ${r.numero_doc}`);
    if (r.contato_nome) ctxParts.push(`titular: ${r.contato_nome}`);
    if (r.responsavel)  ctxParts.push(`resp: ${r.responsavel}`);
    if (r.obra_id)      ctxParts.push(`obra ${r.obra_id}`);
    const ctx = ctxParts.length ? ` (${ctxParts.join(' · ')})` : '';

    alerts.push({
      alert_key: `doc_venc:${r.id}:${janela}`,
      detector:  'documentos_vencimento',
      type:      janela === 'vencido' ? 'urgent' : 'reminder',
      urgency,
      title:     titulo,
      message:   `${r.descricao}${ctx} — vencimento ${dataStr}. ${
        janela === 'vencido'
          ? 'Documento já está VENCIDO. Renove urgente e atualize com marcar_documento_renovado.'
          : `Faltam ${diasRestantes} dia(s).`
      }${r.observacoes ? `\nObs: ${r.observacoes}` : ''}`,
      payload: {
        documento_id: r.id,
        tipo:         r.tipo,
        data_vencimento: r.data_vencimento,
        dias_restantes:  diasRestantes,
        janela,
      },
    });
  }
  return alerts;
}

const TIPO_LABELS: Record<TipoDocumento, string> = {
  art_crea:           'ART CREA',
  anuidade_crea:      'Anuidade CREA',
  cnd_federal:        'CND Federal',
  cnd_estadual:       'CND Estadual',
  cnd_municipal:      'CND Municipal',
  cnd_trabalhista:    'CND Trabalhista',
  matricula:          'Certidão de Matrícula',
  onus_reais:         'Certidão de Ônus Reais',
  ccir:               'CCIR',
  car_sicar:          'CAR/SICAR',
  alvara:             'Alvará',
  avcb:               'AVCB',
  iptu:               'IPTU',
  boleto:             'Boleto',
  compromisso_venda:  'Compromisso de Venda',
  locacao:            'Contrato de Locação',
  apolice_seguro:     'Apólice de Seguro',
  outro:              'Documento',
};

export function listarTiposDocumento(): Array<{ tipo: TipoDocumento; label: string }> {
  return Object.entries(TIPO_LABELS).map(([tipo, label]) => ({
    tipo: tipo as TipoDocumento,
    label,
  }));
}
