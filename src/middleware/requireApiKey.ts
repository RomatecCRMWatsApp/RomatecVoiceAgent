// v3.61.x — Auth service-to-service para a integração AvalieImob → ZAYRA.
// O AvalieImob chama os endpoints de exportação da galeria com o header X-API-Key.
// NÃO usa o JWT de usuário (os dois sistemas têm segredos próprios).
//
// Env esperada no ZAYRA (Railway):
//   AVALIEIMOB_API_KEY=<mesma chave configurada como ZAYRA_API_KEY no AvalieImob>
import type { Request, Response, NextFunction } from 'express';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.AVALIEIMOB_API_KEY || '';
  const provided = (req.header('x-api-key') || '').trim();

  if (!expected) {
    res.status(500).json({ error: 'AVALIEIMOB_API_KEY não configurada no ZAYRA' });
    return;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: 'API key inválida' });
    return;
  }
  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
