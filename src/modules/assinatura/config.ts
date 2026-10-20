import path from 'node:path';

function obrigatorio(nome: string): string {
  const v = process.env[nome];
  if (!v || !v.trim()) throw new Error(`Variável de ambiente ${nome} não definida`);
  return v.trim();
}

export const configAssinatura = {
  /** Chave mestra AES-256 (32 bytes em base64) que cifra o PFX em repouso. */
  get masterKey(): Buffer {
    const k = Buffer.from(obrigatorio('ASSINATURA_MASTER_KEY'), 'base64');
    if (k.length !== 32) throw new Error('ASSINATURA_MASTER_KEY deve conter exatamente 32 bytes em base64');
    return k;
  },
  /** Token de acesso do painel do RT (Bearer). */
  get tokenRT(): string {
    const t = obrigatorio('ASSINATURA_RT_TOKEN');
    if (t.length < 32) throw new Error('ASSINATURA_RT_TOKEN deve ter no mínimo 32 caracteres');
    return t;
  },
  storageDir: process.env.ASSINATURA_STORAGE_DIR ?? path.resolve('storage/assinatura'),
  local: process.env.ASSINATURA_LOCAL ?? 'Açailândia/MA',
  contato: process.env.ASSINATURA_CONTATO ?? 'contato@consultoriaromatec.com.br',
  maxTentativasSenha: 5,
  bloqueioMinutos: 15,
  tamanhoMaxMB: 40,
  maxDocsPorLote: 50,
  diasAlertaVencimento: 30,
} as const;
