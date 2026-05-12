// src/services/mapearDxfQuadras.ts
//
// Casa polígonos extraídos do DXF com registros existentes em
// loteamento_quadras / loteamento_lotes (mesma tabela de v2.8.0).
// Pura. Sem I/O. Sem auto-confirmar — apenas sugere.

import type { DxfPoligono, DxfReport } from './parserDxfPython';

export interface QuadraCadastrada {
  id: number;
  nome: string;
}

export interface LoteCadastrado {
  id: number;
  quadra_id: number;
  numero_lote: string;
}

export interface MatchSugerido<T> {
  dxf: DxfPoligono;
  match: T | null;
  motivo_unmapped?: string;
}

export interface MapeamentoResultado {
  quadras: MatchSugerido<QuadraCadastrada>[];
  lotes: MatchSugerido<LoteCadastrado>[];
  relatorio: {
    quadras_matched: number;
    quadras_unmapped: number;
    lotes_matched: number;
    lotes_unmapped: number;
  };
}

/** Normaliza variantes "Q-01" "Q. 01" "QUADRA 01" "q1" para canonical "Q01". */
export function normalizarLabelQuadra(s: string): string {
  if (!s) return '';
  return s
    .toUpperCase()
    .replace(/\bQUADRA\b/g, 'Q')
    .replace(/[^A-Z0-9]/g, '');
}

function normalizarNumeroLote(s: string): string {
  return (s || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function mapearDxfQuadras(
  report: DxfReport,
  quadrasCad: QuadraCadastrada[],
  lotesCad: LoteCadastrado[],
): MapeamentoResultado {
  const idxQuadra = new Map<string, QuadraCadastrada>();
  for (const q of quadrasCad) idxQuadra.set(normalizarLabelQuadra(q.nome), q);

  const quadras: MatchSugerido<QuadraCadastrada>[] = report.quadras.map(dxf => {
    const norm = normalizarLabelQuadra(dxf.label);
    const m = idxQuadra.get(norm);
    return m
      ? { dxf, match: m }
      : { dxf, match: null, motivo_unmapped: `nenhuma quadra cadastrada com label ${dxf.label}` };
  });

  const dxfLabelParaId = new Map<string, number>();
  for (const q of quadras) {
    if (q.match) dxfLabelParaId.set(normalizarLabelQuadra(q.dxf.label), q.match.id);
  }

  const idxLote = new Map<string, LoteCadastrado>();
  for (const l of lotesCad) {
    idxLote.set(`${l.quadra_id}::${normalizarNumeroLote(l.numero_lote)}`, l);
  }

  const lotes: MatchSugerido<LoteCadastrado>[] = report.lotes.map(dxf => {
    if (!dxf.quadra_label) {
      return { dxf, match: null, motivo_unmapped: 'lote DXF sem quadra inferida' };
    }
    const qId = dxfLabelParaId.get(normalizarLabelQuadra(dxf.quadra_label));
    if (!qId) {
      return {
        dxf,
        match: null,
        motivo_unmapped: `quadra ${dxf.quadra_label} nao mapeada`,
      };
    }
    const m = idxLote.get(`${qId}::${normalizarNumeroLote(dxf.label)}`);
    return m
      ? { dxf, match: m }
      : { dxf, match: null, motivo_unmapped: `lote ${dxf.label} nao cadastrado na quadra` };
  });

  return {
    quadras,
    lotes,
    relatorio: {
      quadras_matched: quadras.filter(q => q.match).length,
      quadras_unmapped: quadras.filter(q => !q.match).length,
      lotes_matched: lotes.filter(l => l.match).length,
      lotes_unmapped: lotes.filter(l => !l.match).length,
    },
  };
}
