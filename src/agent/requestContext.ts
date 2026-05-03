// v1.65.23: contexto da requisicao via AsyncLocalStorage. Extraido de
// tools.ts (v1.65.26) pra ficar testavel sem puxar todo o agente.
//
// Resolve Issue #2: variaveis module-level vazavam contexto entre
// chamadas concorrentes (Telegram + WhatsApp + Web). Agora cada chain
// async tem store proprio.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { TeamRole } from '../services/teamMembers';

export interface RequestContext {
  caller: { role: TeamRole; nome: string } | null;
  sessionId: string | null;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  ctx: { caller: { role: TeamRole; nome: string } | null; sessionId: string | null },
  fn: () => T | Promise<T>,
): T | Promise<T> {
  // copia o ctx pro store ser mutavel sem afetar quem passou
  const store: RequestContext = { caller: ctx.caller, sessionId: ctx.sessionId };
  return requestStorage.run(store, fn);
}

export function setCurrentCaller(c: { role: TeamRole; nome: string } | null): void {
  const store = requestStorage.getStore();
  if (store) {
    store.caller = c;
  }
  // Sem store ativo: no-op silencioso (callers legados que nao migraram
  // pro runWithRequestContext seguem funcionando, so nao propagam o caller).
}

export function getCurrentCaller(): { role: TeamRole; nome: string } | null {
  return requestStorage.getStore()?.caller ?? null;
}

export function setCurrentSessionId(s: string | null): void {
  const store = requestStorage.getStore();
  if (store) {
    store.sessionId = s;
  }
}

export function getCurrentSessionId(): string | null {
  return requestStorage.getStore()?.sessionId ?? null;
}
