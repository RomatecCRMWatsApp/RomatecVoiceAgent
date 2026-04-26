export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
  audioBuffer?: Buffer;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Lead {
  id: string;
  nome: string;
  telefone: string;
  score: 'quente' | 'morno' | 'frio';
  stage?: string | null;
  campanha_origem?: string | null;
  last_activity_at?: string | null;
  created_at: string;
}

export interface Campanha {
  id: string;
  nome: string;
  status: 'ativa' | 'pausada' | 'concluida';
  total_contatos: number;
  enviados: number;
  respondidos: number;
}

export interface Cliente {
  id: string;
  nome: string;
  cpf_cnpj?: string;
  telefone?: string;
  email?: string;
  cidade?: string;
}

export interface Contrato {
  id: string;
  cliente_id: string;
  tipo: string;
  status: string;
  valor?: number;
  created_at: string;
}

export interface ResumoDia {
  data: string;
  leads_novos: number;
  agendamentos_hoje: number;
  contratos_pendentes: number;
  campanhas_ativas: number;
  servicos_online: boolean;
}
