// v3.66.0: tipos da extração elétrica (IA-documento + parser de texto).
// Standalone — sem deps de mysql/pdfkit/express.

export type TipoAlimentacao = 'monofasico' | 'bifasico' | 'trifasico';
export type TipoCircuito = 'ilum' | 'tug' | 'tue';

export interface CircuitoEletrico {
  id: string;                 // "C1", "C2"...
  descricao: string;          // "TUEs — Chuveiro elétrico"
  tipo: TipoCircuito;
  disjuntorA: number;
  polos: 1 | 2 | 3;
  condutorFaseMm2: number;    // 1.5 | 2.5 | 4 | 6 | 10...
  condutorProtecaoMm2?: number | null;
  potenciaVA: number;
  lanceMedioM?: number;       // comprimento médio do circuito (ajustável); default por tipo
}

export interface PontosEletricos {
  iluminacao: number;
  tug10A: number;
  tue20A: number;
  interruptorSimples: number;
  interruptorParalelo: number;
  interruptorIntermediario: number;
  conjuntos: number;          // conjunto interruptor+tomada
  tomadasPiso: number;
}

export interface EletrodutoExtraido { tipo: string; diametro: string; comprimentoM: number; }
export interface CaixaExtraida { tipo: string; qtd: number; }

export interface AlimentacaoEletrica {
  tipo: TipoAlimentacao;
  tensaoV: 127 | 220 | 380;
  ramalSecaoMm2: number;
  disjuntorGeralA: number;
  piVA?: number | null;
  pdVA?: number | null;
}

export interface ObraExtraida {
  titulo?: string; endereco?: string; municipio?: string; uf?: string;
  proprietario?: string; cpfCnpj?: string;
  areaConstruidaM2?: number; areaLoteM2?: number; taxaOcupacaoPct?: number;
  nPavimentos?: number; prancha?: string; dataProjeto?: string;
}

export interface ExtracaoEletrica {
  obra: ObraExtraida;
  alimentacao: AlimentacaoEletrica;
  circuitos: CircuitoEletrico[];
  pontos: PontosEletricos;
  eletrodutos: EletrodutoExtraido[];
  caixas: CaixaExtraida[];
  confianca: number;          // 0..1
  observacoes: string[];
  divergencias: string[];
}

export const PONTOS_ZERO: PontosEletricos = {
  iluminacao: 0, tug10A: 0, tue20A: 0, interruptorSimples: 0,
  interruptorParalelo: 0, interruptorIntermediario: 0, conjuntos: 0, tomadasPiso: 0,
};

// Default de comprimento de lance por tipo de circuito (m) — usado quando a IA
// não traz; ajustável pelo usuário na revisão.
export const LANCE_DEFAULT_M: Record<TipoCircuito, number> = {
  ilum: 14, tug: 16, tue: 10,
};
