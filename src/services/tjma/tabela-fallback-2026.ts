// v1.66.0: tabela de emolumentos TJMA 2026 (Resolucao GP 143/2025).
// Valores TOTAL incluem emolumentos + FERC + FADEP + FEMP + FERRFIS.
// Limite geral maximo: R$ 23.946,65 (Tabela XVI item 16.3.36 e correlatos).
//
// Tabelas relevantes pra Romatec:
// - Tabela XVI 16.3 (Registro de atos com valor declarado): registro de
//   propriedade, desmembramento (cada matricula nova).
// - Tabela XVI 16.9 (Registros torrens com valor declarado): base usada
//   para averbacao com valor declarado (16.22.1).
// - Tabela XVI 16.22.4: averbacao de georreferenciamento SIGEF = R$ 557,94.
// - Tabela XVI 16.22.6: desdobro/unificacao = R$ 161,54.
// - Tabela XVI 16.22.2: averbacao sem valor declarado = R$ 134,43.

import type { Faixa } from './index';

// ── Tabela 16.3 — Registro de atos com valor declarado ─────────────────────
export const TABELA_16_3: Faixa[] = [
  { ate: 5917.36,       valor: 111.11 },
  { ate: 7692.57,       valor: 140.01 },
  { ate: 9615.72,       valor: 158.55 },
  { ate: 12019.65,      valor: 196.77 },
  { ate: 15024.56,      valor: 244.66 },
  { ate: 18780.69,      valor: 306.77 },
  { ate: 23475.86,      valor: 384.85 },
  { ate: 29344.81,      valor: 481.65 },
  { ate: 36681.02,      valor: 599.84 },
  { ate: 45851.29,      valor: 750.69 },
  { ate: 57314.07,      valor: 939.28 },
  { ate: 71642.58,      valor: 1173.09 },
  { ate: 89553.26,      valor: 1466.33 },
  { ate: 111941.56,     valor: 1832.33 },
  { ate: 139926.94,     valor: 2289.78 },
  { ate: 174908.66,     valor: 2862.74 },
  { ate: 218635.83,     valor: 3578.55 },
  { ate: 273294.81,     valor: 4474.29 },
  { ate: 341618.50,     valor: 5590.81 },
  { ate: 427023.14,     valor: 6989.72 },
  { ate: 533778.91,     valor: 8736.26 },
  { ate: 667223.64,     valor: 10920.44 },
  { ate: 834029.56,     valor: 13651.34 },
  { ate: 1042536.94,    valor: 16209.99 },
  { ate: 1303171.21,    valor: 17299.63 },
  { ate: 1563805.44,    valor: 17818.55 },
  { ate: 1876566.51,    valor: 18353.16 },
  { ate: 2251879.82,    valor: 18903.80 },
  { ate: 2702255.82,    valor: 19470.93 },
  { ate: 3242706.98,    valor: 20055.05 },
  { ate: 3891248.37,    valor: 20656.61 },
  { ate: 4669498.05,    valor: 21276.39 },
  { ate: 5603397.67,    valor: 21914.57 },
  { ate: 6724077.19,    valor: 22572.09 },
  { ate: 8068892.63,    valor: 23249.22 },
  { ate: Infinity,      valor: 23946.65 },
];

// ── Tabela 16.9 — Registros torrens com valor declarado ───────────────────
// Usado como base de averbacao com valor declarado (16.22.1).
export const TABELA_16_9: Faixa[] = [
  { ate: 5917.36,       valor: 55.79 },
  { ate: 7692.57,       valor: 69.61 },
  { ate: 9615.72,       valor: 79.21 },
  { ate: 12019.65,      valor: 97.91 },
  { ate: 15024.56,      valor: 122.40 },
  { ate: 18780.69,      valor: 153.07 },
  { ate: 23475.86,      valor: 192.35 },
  { ate: 29344.81,      valor: 240.90 },
  { ate: 36681.02,      valor: 300.16 },
  { ate: 45851.29,      valor: 375.12 },
  { ate: 57314.07,      valor: 469.55 },
  { ate: 71642.58,      valor: 586.80 },
  { ate: 89553.26,      valor: 733.25 },
  { ate: 111941.56,     valor: 916.01 },
  { ate: 139926.94,     valor: 1144.81 },
  { ate: 174908.66,     valor: 1431.60 },
  { ate: 218635.83,     valor: 1789.11 },
  { ate: 273294.81,     valor: 2237.14 },
  { ate: 341618.50,     valor: 2795.50 },
  { ate: 427023.14,     valor: 3494.94 },
  { ate: 533778.91,     valor: 4367.74 },
  { ate: 667223.64,     valor: 5460.36 },
  { ate: 834029.56,     valor: 6826.00 },
  { ate: 1042536.94,    valor: 8254.14 },
  { ate: 1303171.21,    valor: 8652.66 },
  { ate: 1563805.44,    valor: 8912.43 },
  { ate: 1876566.51,    valor: 9179.87 },
  { ate: 2251879.82,    valor: 9455.21 },
  { ate: 2702255.82,    valor: 9738.85 },
  { ate: 3242706.98,    valor: 10030.99 },
  { ate: 3891248.37,    valor: 10331.76 },
  { ate: 4669498.05,    valor: 10641.97 },
  { ate: 5603397.67,    valor: 10961.14 },
  { ate: 6724077.19,    valor: 11289.88 },
  { ate: 8068892.63,    valor: 11628.53 },
  { ate: Infinity,      valor: 11977.56 },
];

// Valores fixos — atos sem faixa por valor
export const VALOR_AVERBACAO_SEM_VALOR_DECLARADO = 134.43;     // 16.22.2
export const VALOR_AVERBACAO_GEORREF_SIGEF       = 557.94;     // 16.22.4
export const VALOR_DESDOBRO_UNIFICACAO           = 161.54;     // 16.22.6
export const VALOR_REGISTRO_LOTE_DESM_INCORP     = 161.54;     // 16.5 / 16.6 (por unidade)
export const VALOR_PRENOTACAO                    = 43.37;      // 16.1
export const VALOR_MATRICULA                     = 102.15;     // 16.2
