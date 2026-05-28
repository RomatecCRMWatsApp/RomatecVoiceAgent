// v3.27.0: mint atomico de codigos INCRA FQNS para marcos e vertices de
// Demarcacao de Lotes (Urbana e Rural).
//
// Decisoes:
//   - Lock pessimista FOR UPDATE no row do usuario (contador unico por tecnico).
//     Volume Romatec: baixo (~1-5 propostas/dia). Se escalar pra dezenas de
//     tecnicos concorrentes, considerar migrar pra Redis com INCRBY.
//   - Contadores vitalicios (V, M_CC, M_TG, P) — nunca resetam. Mesmo apos
//     cancelamento de proposta, os codigos JA FORAM CONSUMIDOS (trade-off:
//     integridade da numeracao > eficiencia do contador).
//   - Snapshot em dados_imovel.codigos_mintados (caller responsavel pela
//     persistencia). Anti-replay e' DELEGADO ao caller — antes de invocar,
//     verificar se codigos_mintados ja existe.
//
// Formato dos codigos:
//   Vertices:           FQNS-V-024
//   Marcos concreto:    FQNS-M-0142-CC
//   Marcos tubo galv:   FQNS-M-0089-TG
//   Marcos madeira:     FQNS-P-0067-MD   (P = piquete; madeira tem funcao P)
//
// Larguras (largura_numero do pricing-params):
//   V: 3 digitos | M: 4 digitos | P: 3 digitos

import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { MarcoDiscriminado, CodigosMintadosFQNS } from './types';

interface ContadoresFQNS {
  V: number;
  M_CC: number;
  M_TG: number;
  P: number;
}

export interface MintInput {
  num_vertices: number;
  marcos: MarcoDiscriminado[];
}

export async function mintarCodigosDemarcacao(
  conn: PoolConnection,
  userId: number,
  input: MintInput,
): Promise<CodigosMintadosFQNS> {
  await conn.beginTransaction();
  try {
    // 1) Lock pessimista no row do usuario
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT credencial_incra_prefixo, credencial_contadores
         FROM users
        WHERE id = ?
        FOR UPDATE`,
      [userId],
    );
    if (!rows.length) {
      throw new Error(`Usuario ${userId} nao encontrado`);
    }
    const prefixo = String(rows[0].credencial_incra_prefixo || '').trim();
    if (!prefixo) {
      throw new Error(`Usuario ${userId} sem credencial INCRA configurada (credencial_incra_prefixo vazio)`);
    }

    // mysql2 JSON columns: pode vir como string OU objeto ja parseado
    const raw = rows[0].credencial_contadores;
    let contadores: ContadoresFQNS;
    if (raw == null) {
      contadores = { V: 0, M_CC: 0, M_TG: 0, P: 0 };
    } else if (typeof raw === 'string') {
      contadores = JSON.parse(raw) as ContadoresFQNS;
    } else {
      contadores = raw as ContadoresFQNS;
    }

    // Normaliza chaves ausentes
    contadores = {
      V: Number(contadores.V) || 0,
      M_CC: Number(contadores.M_CC) || 0,
      M_TG: Number(contadores.M_TG) || 0,
      P: Number(contadores.P) || 0,
    };

    // 2) Quantidades por sufixo
    const qtdConcreto = input.marcos
      .filter((m) => m.tipo === 'concreto')
      .reduce((s, m) => s + (Number(m.quantidade) || 0), 0);
    const qtdTubo = input.marcos
      .filter((m) => m.tipo === 'tubo_galvanizado')
      .reduce((s, m) => s + (Number(m.quantidade) || 0), 0);
    const qtdMadeira = input.marcos
      .filter((m) => m.tipo === 'madeira')
      .reduce((s, m) => s + (Number(m.quantidade) || 0), 0);

    // 3) Gera as listas (largura: V/P=3, M=4)
    const vertices = gerarLista(prefixo, 'V', contadores.V + 1, input.num_vertices, 3);
    const concreto = gerarListaComSufixo(prefixo, 'M', contadores.M_CC + 1, qtdConcreto, 4, 'CC');
    const tubo = gerarListaComSufixo(prefixo, 'M', contadores.M_TG + 1, qtdTubo, 4, 'TG');
    const madeira = gerarListaComSufixo(prefixo, 'P', contadores.P + 1, qtdMadeira, 3, 'MD');

    // 4) Atualiza contadores
    const novos: ContadoresFQNS = {
      V: contadores.V + input.num_vertices,
      M_CC: contadores.M_CC + qtdConcreto,
      M_TG: contadores.M_TG + qtdTubo,
      P: contadores.P + qtdMadeira,
    };
    await conn.query<ResultSetHeader>(
      `UPDATE users SET credencial_contadores = ? WHERE id = ?`,
      [JSON.stringify(novos), userId],
    );

    await conn.commit();
    return {
      prefixo,
      mintado_em: new Date().toISOString(),
      vertices,
      marcos_por_tipo: {
        concreto,
        tubo_galvanizado: tubo,
        madeira,
      },
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* swallow */
    }
    console.error('[MintFQNS]', (err as Error).message);
    throw err;
  }
}

// ── Delta-mint para revisao R2+ ───────────────────────────────────────────
// Quando uma proposta ja ENVIADA recebe PUT com mais marcos, os marcos
// pre-existentes preservam codigos e apenas o DELTA consome contador.
//
// Caller computa o delta = novos.qtd - existentes.qtd (por tipo + vertices)
// e chama mintarCodigosDemarcacao com o delta. Os codigos retornados sao
// concatenados aos existentes.
//
// Por simetria de API e' uma funcao separada que valida deltas >= 0 e
// chama o mint principal.
export interface DeltaMintInput {
  delta_vertices: number;          // 0+ adicionais (novos)
  delta_marcos: MarcoDiscriminado[]; // SO o delta — qtd positiva
  codigos_existentes: CodigosMintadosFQNS;
}

export async function mintarDeltaDemarcacao(
  conn: PoolConnection,
  userId: number,
  input: DeltaMintInput,
): Promise<CodigosMintadosFQNS> {
  if (input.delta_vertices < 0) throw new Error('delta_vertices deve ser >= 0');
  for (const m of input.delta_marcos) {
    if (Number(m.quantidade) < 0) throw new Error('delta de marco com quantidade < 0');
  }

  // Se nao ha delta, retorna codigos existentes sem tocar no contador
  const algumaCoisa =
    input.delta_vertices > 0 ||
    input.delta_marcos.some((m) => Number(m.quantidade) > 0);
  if (!algumaCoisa) return input.codigos_existentes;

  const novosCodigos = await mintarCodigosDemarcacao(conn, userId, {
    num_vertices: input.delta_vertices,
    marcos: input.delta_marcos,
  });

  // Mescla preservando os existentes na frente
  return {
    prefixo: input.codigos_existentes.prefixo,
    mintado_em: input.codigos_existentes.mintado_em, // mantem timestamp original do primeiro mint
    vertices: [...input.codigos_existentes.vertices, ...novosCodigos.vertices],
    marcos_por_tipo: {
      concreto: [
        ...input.codigos_existentes.marcos_por_tipo.concreto,
        ...novosCodigos.marcos_por_tipo.concreto,
      ],
      tubo_galvanizado: [
        ...input.codigos_existentes.marcos_por_tipo.tubo_galvanizado,
        ...novosCodigos.marcos_por_tipo.tubo_galvanizado,
      ],
      madeira: [
        ...input.codigos_existentes.marcos_por_tipo.madeira,
        ...novosCodigos.marcos_por_tipo.madeira,
      ],
    },
  };
}

function gerarLista(prefixo: string, funcao: string, inicio: number, qtd: number, largura: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < qtd; i++) {
    out.push(`${prefixo}-${funcao}-${String(inicio + i).padStart(largura, '0')}`);
  }
  return out;
}

function gerarListaComSufixo(
  prefixo: string,
  funcao: string,
  inicio: number,
  qtd: number,
  largura: number,
  sufixo: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < qtd; i++) {
    out.push(`${prefixo}-${funcao}-${String(inicio + i).padStart(largura, '0')}-${sufixo}`);
  }
  return out;
}
