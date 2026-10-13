// v3.142.0 — Perfis de acesso do módulo PA (spec §5.7, LGPD).
//
//   ADMIN               tudo (inclui excluir e liberar entrega retida)
//   OPERADOR            lê/escreve, sem exclusão
//   DIRECAO_ASSOCIACAO  só leitura, CPF mascarado, sem documentos
//
// Perfil vem de pa_usuarios_perfil (override por usuário); sem linha, sai do
// role do JWT: owner/admin → ADMIN, viewer → DIRECAO_ASSOCIACAO, resto → OPERADOR.
import type { AuthRole } from '../auth';
import { mascararCpf } from './validadores';

export type PerfilPa = 'ADMIN' | 'OPERADOR' | 'DIRECAO_ASSOCIACAO';

export function perfilPorRole(role: AuthRole | string | null | undefined): PerfilPa {
  if (role === 'owner' || role === 'admin') return 'ADMIN';
  if (role === 'viewer') return 'DIRECAO_ASSOCIACAO';
  return 'OPERADOR';
}

export function podeEscrever(p: PerfilPa): boolean {
  return p === 'ADMIN' || p === 'OPERADOR';
}
export function podeExcluir(p: PerfilPa): boolean {
  return p === 'ADMIN';
}
export function podeVerDocumentos(p: PerfilPa): boolean {
  return p !== 'DIRECAO_ASSOCIACAO';
}
export function vePiiCompleto(p: PerfilPa): boolean {
  return p !== 'DIRECAO_ASSOCIACAO';
}

const CAMPOS_CPF = ['cpf', 'conjuge_cpf', 'recebedor_cpf'] as const;
// RG sai inteiro: a CIN usa o próprio CPF como número ("018.411.673-20 SSP/MA (CIN)").
const CAMPOS_OCULTOS_DIRECAO = ['rg', 'pagador_cpf_parcial'] as const;

/** Aplica a visão do perfil sobre um registro (não altera o original). */
export function filtrarPorPerfil<T extends Record<string, unknown>>(row: T, p: PerfilPa): T {
  if (vePiiCompleto(p)) return row;
  const out: Record<string, unknown> = { ...row };
  for (const c of CAMPOS_CPF) if (c in out) out[c] = mascararCpf(out[c]);
  for (const c of CAMPOS_OCULTOS_DIRECAO) if (c in out) out[c] = null;
  return out as T;
}
