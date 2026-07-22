// src/middleware/apiAuthGate.ts
// v3.124.0 — Gate de autenticação para TODO o prefixo /api.
//
// Motivo: até a v3.123.1 a proteção era rota a rota, e a maioria simplesmente
// não tinha. Levantamento no server.ts: 198 rotas /api sem nenhum middleware de
// auth, 104 delas mutações — incluindo DELETE /api/obras/:id e o CRUD de
// parcelas, etapas e equipe. Qualquer um na internet, sem cookie e sem token,
// conseguia ler e escrever.
//
// A inversão do padrão é o ponto: em vez de "aberto por omissão, protegido se
// alguém lembrar", passa a ser "protegido por omissão, aberto só com motivo
// escrito". Rota nova nasce fechada.
//
// Fora do escopo deste gate (continuam públicos, por desenho):
//   - /webhook/*        entrada de Z-API, Telegram e nfeio
//   - /v/*              validação pública de recibo/laudo/entrega/inventário
//   - /recibos/confirmar/:token e /r/:token/responder — o prestador confirma o
//     recibo pelo link do WhatsApp, sem ter login no sistema
// Nenhum desses fica sob /api, então o gate não os alcança.
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from './auth';

export interface RotaPublica {
  /** Testado contra o caminho JÁ relativo ao mount /api (ex.: '/auth/login'). */
  match: RegExp;
  /** Se omitido, vale para qualquer método. */
  metodos?: readonly string[];
  /** Por que esta rota precisa ficar aberta. Sem motivo, não entra na lista. */
  motivo: string;
}

/**
 * Allowlist do /api. Cada entrada precisa de um motivo — a ideia é que ninguém
 * acrescente item aqui no automático.
 */
export const ROTAS_PUBLICAS_API: readonly RotaPublica[] = [
  {
    match: /^\/auth(\/|$)/,
    motivo: 'login/refresh: quem ainda não tem o cookie precisa conseguir obtê-lo',
  },
  {
    match: /^\/version$/,
    metodos: ['GET'],
    motivo: 'badge de versão do app e checagem de deploy externa',
  },
  {
    match: /^\/galeria(\/|$)/,
    motivo: 'integração AvalieImob: autentica por X-API-Key (requireApiKey), não por cookie de usuário',
  },
  {
    match: /^\/wifi\/lead$/,
    metodos: ['POST'],
    motivo: 'captive portal: o visitante do Wi-Fi não tem login — é justamente o cadastro dele',
  },
  {
    match: /^\/avalieimob\/lead-webhook$/,
    metodos: ['POST'],
    motivo: 'webhook de entrada do AvalieImob (serviço externo, sem sessão)',
  },
];

/**
 * Decide se o par (método, caminho) dispensa autenticação.
 * @param caminho caminho relativo ao mount /api — '/auth/login', não '/api/auth/login'.
 */
export function ehRotaApiPublica(metodo: string, caminho: string): boolean {
  // Normaliza: tira query string e barra final redundante.
  const limpo = caminho.split('?')[0].replace(/(.)\/+$/, '$1');
  return ROTAS_PUBLICAS_API.some(r =>
    r.match.test(limpo) && (!r.metodos || r.metodos.includes(metodo.toUpperCase())),
  );
}

/**
 * Middleware para montar em `app.use('/api', apiAuthGate)`.
 * Dentro de um `app.use` com path, o Express já entrega `req.path` relativo ao
 * mount, que é o que a allowlist espera.
 */
export function apiAuthGate(req: Request, res: Response, next: NextFunction): void {
  if (ehRotaApiPublica(req.method, req.path)) { next(); return; }
  requireAuth(req, res, next);
}
