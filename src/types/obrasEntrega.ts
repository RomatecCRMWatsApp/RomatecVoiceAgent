// src/types/obrasEntrega.ts
// v3.81.0 — Contratos do módulo "Entrega de Obra" (Relatório de Entrega / RE).
//
// Nota de adaptação ao repo: o dono do documento é o `sub` do JWT (string),
// portanto `colaborador_id` é string (coluna VARCHAR), não INT como no rascunho
// do spec. Fotos/NF trafegam como base64 (data URL ou base64 puro) — no banco
// ficam em LONGTEXT (Railway sem volume em disco).

export type EntregaStatus = 'rascunho' | 'em_revisao' | 'concluido' | 'entregue';
export type EntregaFotoTipo = 'antes' | 'execucao' | 'depois' | 'sobra_material';

export const ENTREGA_STATUS: EntregaStatus[] = ['rascunho', 'em_revisao', 'concluido', 'entregue'];
export const ENTREGA_FOTO_TIPOS: EntregaFotoTipo[] = ['antes', 'execucao', 'depois', 'sobra_material'];

export interface EntregaFoto {
  id?: number;
  entrega_id?: number;
  tipo: EntregaFotoTipo;
  mime: string;
  data_base64: string;      // base64 puro (sem prefixo data:)
  legenda?: string | null;
  ordem?: number;
}

export interface EntregaMaterialSobra {
  id?: number;
  entrega_id?: number;
  material: string;
  quantidade?: number | null;
  unidade?: string | null;
  foto_mime?: string | null;
  foto_base64?: string | null;
  observacao?: string | null;
  ordem?: number;
}

export interface ObraEntrega {
  id?: number;
  colaborador_id: string;          // = req.user.sub (subject do JWT)
  proposta_id: number;
  obra_id?: number | null;
  numero?: string | null;          // RE-AAAA-NNNN (auto)
  titulo?: string | null;
  cliente?: string | null;
  cliente_telefone?: string | null;
  endereco_obra?: string | null;
  cidade_uf?: string | null;
  resumo_proposta?: string | null;
  descricao_execucao?: string | null;   // markdown
  status?: EntregaStatus;
  valor_orcado?: number | null;
  valor_receber?: number | null;
  nota_fiscal_nome?: string | null;
  nota_fiscal_mime?: string | null;
  nota_fiscal_base64?: string | null;
  responsavel_equipe_id?: number | null;
  responsavel_nome?: string | null;
  responsavel_cargo?: string | null;
  responsavel_foto_base64?: string | null;   // data URL ou base64 puro
  data_execucao?: string | null;   // YYYY-MM-DD
  data_entrega?: string | null;    // DATETIME ISO
  hash_publico?: string | null;
  recebimento_confirmado_em?: string | null;
  recebimento_ip?: string | null;
  created_at?: string;
  updated_at?: string;
  fotos?: EntregaFoto[];
  materiais_sobra?: EntregaMaterialSobra[];
}

/** Resumo leve pra listagem (sem base64 pesado). */
export interface ObraEntregaResumo {
  id: number;
  numero: string | null;
  titulo: string | null;
  cliente: string | null;
  proposta_id: number;
  obra_id: number | null;
  status: EntregaStatus;
  valor_receber: number | null;
  data_entrega: string | null;
  hash_publico: string | null;
  recebimento_confirmado_em: string | null;
  created_at: string;
  updated_at: string;
}

/** Snapshot puxado da proposta de origem ao criar a RE. */
export interface PropostaOrigem {
  proposta_id: number;
  numero: string | null;
  cliente: string | null;
  cliente_telefone: string | null;
  endereco_obra: string | null;
  cidade_uf: string | null;
  resumo: string | null;
  valor_orcado: number | null;
  obra_id: number | null;
  fotos_antes: EntregaFoto[];
}
