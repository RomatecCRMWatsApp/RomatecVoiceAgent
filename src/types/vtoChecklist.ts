// src/types/vtoChecklist.ts
// v3.78.0 — Contratos do VTO · Checklist de Atividades da Obra (Gestão de Obra).
//
// Nota de adaptação ao repo: o dono do documento é o `sub` do JWT (string),
// portanto `colaborador_id` é string (coluna VARCHAR), não INT como no rascunho
// original do spec — o filtro de dono no WHERE compara a string do subject.

export type VtoStatus = 'nao_iniciado' | 'iniciado' | 'em_andamento' | 'concluido';
export type VtoDocStatus = 'rascunho' | 'finalizado' | 'enviado';

export interface VtoCatalogoItem {
  disciplina_ordem: number;
  disciplina_nome: string;
  atividade: string;
  atividade_ordem: number;
}

export interface VtoChecklistItem {
  id?: number;
  disciplina_ordem: number;
  disciplina_nome: string;
  atividade: string;
  atividade_ordem: number;
  status: VtoStatus;
  comodo_local?: string | null;
  metros_quadrados?: number | null;
  observacao?: string | null;
}

export interface VtoChecklist {
  id?: number;
  colaborador_id: string;          // = req.user.sub (subject do JWT)
  obra_id?: number | null;
  numero_vto?: string | null;
  obra_nome: string;
  cliente?: string | null;
  endereco?: string | null;
  cidade_uf?: string | null;
  data_vistoria?: string | null;   // YYYY-MM-DD
  etapa?: string | null;
  responsavel_tecnico?: string;
  art_trt?: string | null;
  observacoes_gerais?: string | null;
  pendencias?: string | null;
  proxima_vistoria?: string | null;
  percentual_fisico?: number;
  status?: VtoDocStatus;
  hash_validacao?: string | null;
  created_at?: string;
  updated_at?: string;
  itens: VtoChecklistItem[];
}

export interface PercentualResultado {
  geral: number;                              // 0..100
  porDisciplina: Record<number, number>;      // disciplina_ordem -> 0..100
}
