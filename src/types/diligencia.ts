// v3.54.0 — Tipos do módulo Diligências de Campo.

export type DiligenciaFinalidade =
  | 'avaliacao'
  | 'georreferenciamento'
  | 'desmembramento'
  | 'remembramento'
  | 'averbacao'
  | 'vistoria'
  | 'demarcacao';

export type DiligenciaStatus =
  | 'pendente'
  | 'confirmado'
  | 'remarcado'
  | 'cancelado';

export interface DiligenciaRow {
  id: number;
  proposta_id: number;
  finalidade: DiligenciaFinalidade;
  telefone: string;
  email: string | null;
  data_sugerida: Date;
  status: DiligenciaStatus;
  resposta_cliente: string | null;
  data_confirmacao: Date | null;
  lembrete_enviado: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Linha enriquecida com dados da proposta (JOIN), usada na listagem/templates. */
export interface DiligenciaComProposta extends DiligenciaRow {
  proposta_numero: string;
  cliente_nome: string;
  endereco_imovel: string | null;
}

export interface CreateDiligenciaDto {
  proposta_id: number;
  finalidade: DiligenciaFinalidade;
  telefone: string;
  email?: string;
  data_sugerida: string; // ISO 8601
}

export interface UpdateDiligenciaDto {
  status?: DiligenciaStatus;
  resposta_cliente?: string;
  data_sugerida?: string;
  data_confirmacao?: string;
  lembrete_enviado?: boolean;
}

export const DILIGENCIA_FINALIDADES: DiligenciaFinalidade[] = [
  'avaliacao', 'georreferenciamento', 'desmembramento', 'remembramento',
  'averbacao', 'vistoria', 'demarcacao',
];

export const DILIGENCIA_STATUSES: DiligenciaStatus[] = [
  'pendente', 'confirmado', 'remarcado', 'cancelado',
];
