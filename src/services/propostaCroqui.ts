// v3.63.0 — Serviço de Pontos/Croqui da Proposta de Demarcação (Fase 1c).
//
// Reutiliza o MOTOR compartilhado (geometria.ts) — NÃO duplica cálculo:
//   - calcularLados / areaGauss / perimetro / geoParaUtm / detectarZonaUtm
// Persiste em propostas_demarcacao_pontos / _lados (FK → propostas).
// O import Proposta→Laudo reaproveita salvarPontosDoLaudo (lógica já testada).

import type { RowDataPacket } from 'mysql2/promise';
import pool from '../database/connection';
import {
  calcularLados, areaGauss, perimetro, geoParaUtm, detectarZonaUtm,
  importarRTK, importarKML, importarGPX, detectarFormatoArquivo,
} from './geometria';
import { gerarCroquiSvg, type PontoSvg, type LadoSvg } from './croquiSvg';
import { getParams } from './pricing/params';

export interface PontoPropostaIn {
  ordem: number;
  vertice: string;
  utmE?: number | null;
  utmN?: number | null;
  lat?: number | null;
  lng?: number | null;
}

export interface ResumoGeometria {
  areaM2: number;
  areaHa: number;
  perimetroM: number;
  numVertices: number;
}

// Tarifa do Alinhamento de Cerca — lê de params (NÃO hardcoda). Fallback 0.42.
export function tarifaAlinhamento(): number {
  const v = getParams().demarcacao_lotes_2026?.opcionais?.alinhamento_cerca?.valor_unitario;
  return typeof v === 'number' && v > 0 ? v : 0.42;
}

// Deriva {e,n} UTM de um ponto (usa UTM direto, ou converte de lat/lng).
function coordUtm(p: PontoPropostaIn): { e: number; n: number } | null {
  if (p.utmE != null && p.utmN != null) return { e: Number(p.utmE), n: Number(p.utmN) };
  if (p.lat != null && p.lng != null) {
    try {
      const zona = detectarZonaUtm(Number(p.lng));
      const hem = Number(p.lat) >= 0 ? 'N' : 'S';
      const u = geoParaUtm({ lat: Number(p.lat), lng: Number(p.lng), zona, hemisferio: hem });
      return { e: u.e, n: u.n };
    } catch { return null; }
  }
  return null;
}

function calcularResumo(pontos: PontoPropostaIn[]): ResumoGeometria {
  const utm = pontos.map(coordUtm);
  const todosComUtm = utm.every(u => u !== null);
  if (!todosComUtm || pontos.length < 3) {
    return { areaM2: 0, areaHa: 0, perimetroM: 0, numVertices: pontos.length };
  }
  const pts = utm as Array<{ e: number; n: number }>;
  const areaM2 = +areaGauss(pts).toFixed(2);
  return {
    areaM2,
    areaHa: +(areaM2 / 10000).toFixed(4),
    perimetroM: +perimetro(pts).toFixed(2),
    numVertices: pontos.length,
  };
}

// ── Parse da coletora (reusa o motor do laudo: CSV/TXT/KML/GPX) ─────────────
export function parseColetora(texto: string, formato?: string): PontoPropostaIn[] {
  const fmt = String(formato || '').toLowerCase();
  let pts;
  if (fmt === 'kml') pts = importarKML(texto).pontos;
  else if (fmt === 'gpx') pts = importarGPX(texto).pontos;
  else if (fmt === 'csv' || fmt === 'txt') pts = importarRTK(texto).pontos;
  else {
    const det = detectarFormatoArquivo(texto);
    pts = det === 'KML' ? importarKML(texto).pontos
        : det === 'GPX' ? importarGPX(texto).pontos
        : importarRTK(texto).pontos;
  }
  return pts.map((p, i) => ({
    ordem: i + 1,
    vertice: p.rotulo || `M-${i + 1}`,
    utmE: p.e ?? null,
    utmN: p.n ?? null,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
  }));
}

// ── Gera o SVG do croqui a partir dos pontos (stateless — pro preview/PDF) ───
export interface SvgPropostaOpts {
  larguraPx?: number;
  alturaPx?: number;
  tipoImovel?: 'URBANO' | 'RURAL';
  areaTotalM2?: number;
  utmZona?: number;
  destacarLados?: number[];
  tituloDestaque?: string;
}
export function gerarSvgProposta(pontosIn: PontoPropostaIn[], opts: SvgPropostaOpts = {}): string {
  const utm = pontosIn.map(coordUtm);
  const validos = utm.every(u => u !== null) && pontosIn.length >= 2;
  const pontosSvg: PontoSvg[] = pontosIn.map((p, i) => ({
    rotulo: p.vertice, e: utm[i]?.e ?? 0, n: utm[i]?.n ?? 0,
  }));
  const ladosSvg: LadoSvg[] = validos
    ? calcularLados(utm as Array<{ e: number; n: number }>).map(l => ({
        i_idx: l.i_idx, f_idx: l.f_idx, distancia_m: l.distancia_m,
      }))
    : [];
  return gerarCroquiSvg(pontosSvg, ladosSvg, {
    larguraPx: opts.larguraPx ?? 700,
    alturaPx: opts.alturaPx ?? 520,
    tipoImovel: opts.tipoImovel,
    areaTotalM2: opts.areaTotalM2,
    utmZona: opts.utmZona ?? 23,
    utmHemisferio: 'S',
    destacarLados: opts.destacarLados,
    tituloDestaque: opts.tituloDestaque,
  });
}

// ── PUT /pontos ────────────────────────────────────────────────────────────
export async function salvarPontos(
  propostaId: number,
  pontosIn: PontoPropostaIn[]
): Promise<{ pontos: PontoPropostaIn[]; lados: RowDataPacket[]; resumo: ResumoGeometria }> {
  // Validação
  if (!Array.isArray(pontosIn)) throw new Error('pontos deve ser um array.');
  if (pontosIn.length > 0 && pontosIn.length < 3) {
    throw new Error('Mínimo 3 pontos para formar a poligonal (ou 0 para limpar).');
  }
  const vistos = new Set<string>();
  pontosIn.forEach((p, i) => {
    if (p.ordem !== i + 1) throw new Error(`ordem deve ser sequencial a partir de 1 (esperado ${i + 1}, veio ${p.ordem}).`);
    const v = String(p.vertice || '').trim();
    if (!v) throw new Error(`vértice vazio na ordem ${p.ordem}.`);
    if (vistos.has(v)) throw new Error(`vértice duplicado: "${v}".`);
    vistos.add(v);
    for (const k of ['utmE', 'utmN', 'lat', 'lng'] as const) {
      const val = p[k];
      if (val != null && !Number.isFinite(Number(val))) throw new Error(`${k} inválido na ordem ${p.ordem}.`);
    }
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Preserva flag `alinhar` por ordem se o nº de vértices não mudou.
    const [oldLados] = await conn.query<RowDataPacket[]>(
      `SELECT ordem, alinhar FROM propostas_demarcacao_lados WHERE proposta_id = ?`,
      [propostaId]
    );
    const [oldPontos] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM propostas_demarcacao_pontos WHERE proposta_id = ?`,
      [propostaId]
    );
    const mesmoNumero = Number(oldPontos[0]?.n || 0) === pontosIn.length;
    const alinharPorOrdem = new Map<number, number>();
    if (mesmoNumero) for (const l of oldLados) alinharPorOrdem.set(Number(l.ordem), Number(l.alinhar) || 0);

    // Limpa pontos+lados (CASCADE não cobre re-save; deletamos explicitamente).
    await conn.execute('DELETE FROM propostas_demarcacao_lados WHERE proposta_id = ?', [propostaId]);
    await conn.execute('DELETE FROM propostas_demarcacao_pontos WHERE proposta_id = ?', [propostaId]);

    // Insere pontos
    for (const p of pontosIn) {
      await conn.execute(
        `INSERT INTO propostas_demarcacao_pontos (proposta_id, ordem, vertice, utm_e, utm_n, lat, lng)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [propostaId, p.ordem, String(p.vertice).trim(),
         p.utmE ?? null, p.utmN ?? null, p.lat ?? null, p.lng ?? null]
      );
    }

    // Calcula lados (precisa de UTM em todos; senão lados vazio)
    const utm = pontosIn.map(coordUtm);
    const todosComUtm = utm.every(u => u !== null) && pontosIn.length >= 3;
    if (todosComUtm) {
      const lados = calcularLados(utm as Array<{ e: number; n: number }>);
      for (const l of lados) {
        const alinhar = alinharPorOrdem.get(l.ordem) ?? 0;
        await conn.execute(
          `INSERT INTO propostas_demarcacao_lados
             (proposta_id, ordem, vertice_de, vertice_para, distancia_m, azimute, alinhar)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [propostaId, l.ordem, pontosIn[l.i_idx].vertice, pontosIn[l.f_idx].vertice,
           +l.distancia_m.toFixed(2), +l.azimute.toFixed(2), alinhar]
        );
      }
    }

    const resumo = calcularResumo(pontosIn);
    await conn.execute(
      `UPDATE propostas SET area_calculada_m2 = ?, perimetro_calculado_m = ? WHERE id = ?`,
      [resumo.areaM2 || null, resumo.perimetroM || null, propostaId]
    );

    await conn.commit();
    const [ladosOut] = await pool.query<RowDataPacket[]>(
      `SELECT ordem, vertice_de, vertice_para, distancia_m, azimute, alinhar
         FROM propostas_demarcacao_lados WHERE proposta_id = ? ORDER BY ordem`,
      [propostaId]
    );
    return { pontos: pontosIn, lados: ladosOut, resumo };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── GET /pontos ────────────────────────────────────────────────────────────
export async function obterPontos(propostaId: number): Promise<{
  pontos: RowDataPacket[];
  lados: RowDataPacket[];
  resumo: ResumoGeometria;
  alinhamento: { lados: number[]; extensaoM: number; origem: string };
}> {
  const [pontos] = await pool.query<RowDataPacket[]>(
    `SELECT ordem, vertice, utm_e, utm_n, lat, lng
       FROM propostas_demarcacao_pontos WHERE proposta_id = ? ORDER BY ordem`,
    [propostaId]
  );
  const [lados] = await pool.query<RowDataPacket[]>(
    `SELECT ordem, vertice_de, vertice_para, distancia_m, azimute, alinhar
       FROM propostas_demarcacao_lados WHERE proposta_id = ? ORDER BY ordem`,
    [propostaId]
  );
  const [prop] = await pool.query<RowDataPacket[]>(
    `SELECT alinhamento_origem FROM propostas WHERE id = ?`,
    [propostaId]
  );
  const pontosIn: PontoPropostaIn[] = pontos.map(p => ({
    ordem: Number(p.ordem), vertice: String(p.vertice),
    utmE: p.utm_e != null ? Number(p.utm_e) : null,
    utmN: p.utm_n != null ? Number(p.utm_n) : null,
    lat: p.lat != null ? Number(p.lat) : null,
    lng: p.lng != null ? Number(p.lng) : null,
  }));
  const alinhados = lados.filter(l => Number(l.alinhar) === 1);
  const extensaoM = +alinhados.reduce((s, l) => s + Number(l.distancia_m), 0).toFixed(2);
  return {
    pontos, lados,
    resumo: calcularResumo(pontosIn),
    alinhamento: {
      lados: alinhados.map(l => Number(l.ordem)),
      extensaoM,
      origem: String(prop[0]?.alinhamento_origem || 'manual'),
    },
  };
}

// ── PUT /alinhamento ───────────────────────────────────────────────────────
export async function definirAlinhamento(
  propostaId: number,
  ladosOrdem: number[]
): Promise<{ extensaoM: number; valorAlinhamento: number; origem: 'manual' | 'croqui' }> {
  if (!Array.isArray(ladosOrdem)) throw new Error('ladosOrdem deve ser um array.');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [todos] = await conn.query<RowDataPacket[]>(
      `SELECT ordem, distancia_m FROM propostas_demarcacao_lados WHERE proposta_id = ?`,
      [propostaId]
    );
    const ordensValidas = new Set(todos.map(l => Number(l.ordem)));
    for (const o of ladosOrdem) {
      if (!ordensValidas.has(Number(o))) throw new Error(`lado inexistente: ordem ${o}.`);
    }
    const sel = new Set(ladosOrdem.map(Number));
    await conn.execute(
      `UPDATE propostas_demarcacao_lados SET alinhar = 0 WHERE proposta_id = ?`,
      [propostaId]
    );
    if (sel.size > 0) {
      const ph = [...sel].map(() => '?').join(', ');
      await conn.execute(
        `UPDATE propostas_demarcacao_lados SET alinhar = 1
          WHERE proposta_id = ? AND ordem IN (${ph})`,
        [propostaId, ...sel]
      );
    }
    const extensaoM = +todos
      .filter(l => sel.has(Number(l.ordem)))
      .reduce((s, l) => s + Number(l.distancia_m), 0)
      .toFixed(2);
    const origem: 'manual' | 'croqui' = sel.size > 0 ? 'croqui' : 'manual';
    await conn.execute(
      `UPDATE propostas SET alinhamento_extensao_m = ?, alinhamento_origem = ? WHERE id = ?`,
      [sel.size > 0 ? extensaoM : null, origem, propostaId]
    );
    await conn.commit();
    const valorAlinhamento = +(extensaoM * tarifaAlinhamento()).toFixed(2);
    return { extensaoM, valorAlinhamento, origem };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ── POST /importar-proposta (Proposta → Laudo) ─────────────────────────────
export async function importarPontosParaLaudo(
  laudoId: number,
  propostaId: number,
  sobrescrever: boolean
): Promise<{ importados: number }> {
  const [jaTem] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM laudos_demarcacao_pontos WHERE laudo_id = ?`,
    [laudoId]
  );
  if (Number(jaTem[0]?.n || 0) > 0 && !sobrescrever) {
    const err = new Error('Laudo já tem pontos. Use sobrescrever=1 para substituir.') as Error & { code?: number };
    err.code = 409;
    throw err;
  }

  const [pontos] = await pool.query<RowDataPacket[]>(
    `SELECT ordem, vertice, utm_e, utm_n, lat, lng
       FROM propostas_demarcacao_pontos WHERE proposta_id = ? ORDER BY ordem`,
    [propostaId]
  );
  if (pontos.length === 0) throw new Error('Proposta não tem pontos para importar.');
  const [ladosProp] = await pool.query<RowDataPacket[]>(
    `SELECT ordem, alinhar FROM propostas_demarcacao_lados WHERE proposta_id = ?`,
    [propostaId]
  );
  const alinharPorOrdem = new Map<number, number>();
  for (const l of ladosProp) alinharPorOrdem.set(Number(l.ordem), Number(l.alinhar) || 0);

  // Reusa salvarPontosDoLaudo (cuida de UTM↔Geo, lados, área, perímetro).
  const m = await import('../integrations/laudos');
  const pontosLaudo = pontos.map(p => ({
    ordem: Number(p.ordem),
    rotulo: String(p.vertice),
    utm_e: p.utm_e != null ? Number(p.utm_e) : null,
    utm_n: p.utm_n != null ? Number(p.utm_n) : null,
    lat_decimal: p.lat != null ? Number(p.lat) : null,
    long_decimal: p.lng != null ? Number(p.lng) : null,
  })) as unknown as Parameters<typeof m.salvarPontosDoLaudo>[1];
  await m.salvarPontosDoLaudo(laudoId, pontosLaudo);

  // Propaga flag `alinhar` pros lados do laudo, casando por ordem.
  for (const [ordem, alinhar] of alinharPorOrdem) {
    if (alinhar === 1) {
      await pool.execute(
        `UPDATE laudos_demarcacao_lados SET alinhar = 1 WHERE laudo_id = ? AND ordem = ?`,
        [laudoId, ordem]
      );
    }
  }
  return { importados: pontos.length };
}
