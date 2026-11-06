// src/modules/assinatura/antiBruteForce.ts
// v3.152.0 — Lockout da senha do certificado, COMPARTILHADO entre o painel do RT
// (criarRotasAssinatura) e a página pública de aprovação (/assinatura/aprovar).
// Uma única contagem: maxTentativasSenha erradas → bloqueio de bloqueioMinutos
// (configAssinatura). Em memória (single-process). Protege a OPERAÇÃO de assinar,
// independente de por onde a tentativa entrou.
import { configAssinatura } from './config.js';

const estado = { falhas: 0, ate: 0 };

/** Minutos restantes de bloqueio, ou null se liberado. */
export function minutosBloqueado(): number | null {
  if (Date.now() < estado.ate) return Math.ceil((estado.ate - Date.now()) / 60_000);
  return null;
}

/** Registra uma senha inválida; ativa o bloqueio ao atingir o limite. */
export function registrarFalhaSenha(): { bloqueado: boolean; falhas: number } {
  estado.falhas += 1;
  if (estado.falhas >= configAssinatura.maxTentativasSenha) {
    estado.ate = Date.now() + configAssinatura.bloqueioMinutos * 60_000;
    estado.falhas = 0;
    return { bloqueado: true, falhas: configAssinatura.maxTentativasSenha };
  }
  return { bloqueado: false, falhas: estado.falhas };
}

/** Zera o contador após uma assinatura bem-sucedida. */
export function resetarFalhasSenha(): void {
  estado.falhas = 0;
}
