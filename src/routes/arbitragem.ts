// v3.129.0 — Rotas da Calculadora de Divisão de Capital (Dutching / Arbitragem).
// Prefixo: /api/zayra/arbitragem. Todas exigem sessão (requireAuth). Escopo do
// histórico SEMPRE restrito ao user_sub (o `sub` do JWT), nunca do body.
//
// Capacidade PESSOAL da ZAYRA — não aparece em menu nem tela da Gestão de Obras.
// Router em arquivo próprio (padrão Diário/Prontuário): o import de requireAuth
// é local ao módulo, então NÃO reincide no TDZ de boot do server.ts.
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import {
  calcularDivisao,
  calcularPorLucro,
  ArbitragemError,
  type ResultadoArbitragem,
  type CodigoErroArbitragem,
} from '../services/arbitragemService';
import * as repo from '../services/arbitragemRepository';

const router = Router();

// Código de erro → HTTP.
const HTTP_POR_CODIGO: Record<CodigoErroArbitragem | 'ID_INVALIDO' | 'NAO_ENCONTRADO', number> = {
  RESULTADOS_INSUFICIENTES: 400,
  RESULTADOS_EXCEDIDOS: 400,
  ROTULO_VAZIO: 400,
  ROTULO_DUPLICADO: 400,
  ODD_INVALIDA: 400,
  ODD_FORA_DE_FAIXA: 400,
  CAPITAL_INVALIDO: 400,
  LUCRO_ALVO_INVALIDO: 400,
  PAYLOAD_INVALIDO: 400,
  SEM_ARBITRAGEM: 422,
  ID_INVALIDO: 400,
  NAO_ENCONTRADO: 404,
};

function userSubDe(req: Request): string | null {
  const u = (req as AuthedRequest).user;
  return u?.sub ? String(u.sub) : null;
}

function tratarErro(err: unknown, res: Response): void {
  if (err instanceof ArbitragemError) {
    const status = HTTP_POR_CODIGO[err.codigo] ?? 400;
    res.status(status).json({ erro: err.codigo, mensagem: err.message, ...(err.extra ?? {}) });
    return;
  }
  console.error('[arbitragem] ERRO_INTERNO:', (err as Error)?.message);
  res.status(500).json({ erro: 'ERRO_INTERNO', mensagem: 'Falha ao processar o cálculo.' });
}

// Persiste sem derrubar a resposta: persistência é acessória (caso 8 da spec).
async function persistirOuNull(
  userSub: string,
  resultado: ResultadoArbitragem,
  persistir: boolean,
  lucroAlvo: number | null,
): Promise<number | null> {
  if (!persistir) return null;
  try {
    return await repo.registrar(userSub, resultado, lucroAlvo);
  } catch (err) {
    console.error('[arbitragem] persistência falhou (id: null):', (err as Error)?.message);
    return null;
  }
}

// ─── POST /calcular ─────────────────────────────────────────────────────
router.post('/calcular', requireAuth, async (req: Request, res: Response) => {
  const userSub = userSubDe(req);
  if (!userSub) {
    res.status(401).json({ erro: 'NAO_AUTENTICADO', mensagem: 'Sessão inválida.' });
    return;
  }
  try {
    const { evento, capital, arredondamento, resultados } = req.body ?? {};
    const persistir = req.body?.persistir !== false; // default true
    const resultado = calcularDivisao({ evento, capital, arredondamento, resultados });
    const id = await persistirOuNull(userSub, resultado, persistir, null);
    res.status(200).json({ id, ...resultado });
  } catch (err) {
    tratarErro(err, res);
  }
});

// ─── POST /por-lucro ────────────────────────────────────────────────────
router.post('/por-lucro', requireAuth, async (req: Request, res: Response) => {
  const userSub = userSubDe(req);
  if (!userSub) {
    res.status(401).json({ erro: 'NAO_AUTENTICADO', mensagem: 'Sessão inválida.' });
    return;
  }
  try {
    const { evento, lucroAlvo, arredondamento, resultados } = req.body ?? {};
    const persistir = req.body?.persistir !== false;
    const resultado = calcularPorLucro({ evento, lucroAlvo, arredondamento, resultados });
    const id = await persistirOuNull(userSub, resultado, persistir, Number(lucroAlvo));
    res.status(200).json({ id, ...resultado });
  } catch (err) {
    tratarErro(err, res);
  }
});

// ─── GET /historico ─────────────────────────────────────────────────────
router.get('/historico', requireAuth, async (req: Request, res: Response) => {
  const userSub = userSubDe(req);
  if (!userSub) {
    res.status(401).json({ erro: 'NAO_AUTENTICADO', mensagem: 'Sessão inválida.' });
    return;
  }
  try {
    const limite = req.query.limite != null ? Number(req.query.limite) : 30;
    const offset = req.query.offset != null ? Number(req.query.offset) : 0;
    const registros = await repo.listar(userSub, limite, offset);
    res.status(200).json({ registros });
  } catch (err) {
    tratarErro(err, res);
  }
});

// ─── DELETE /historico/:id ──────────────────────────────────────────────
router.delete('/historico/:id', requireAuth, async (req: Request, res: Response) => {
  const userSub = userSubDe(req);
  if (!userSub) {
    res.status(401).json({ erro: 'NAO_AUTENTICADO', mensagem: 'Sessão inválida.' });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ erro: 'ID_INVALIDO', mensagem: 'ID inválido.' });
    return;
  }
  try {
    const ok = await repo.excluir(userSub, id);
    if (!ok) {
      res.status(404).json({ erro: 'NAO_ENCONTRADO', mensagem: 'Registro não encontrado.' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    tratarErro(err, res);
  }
});

export default router;
