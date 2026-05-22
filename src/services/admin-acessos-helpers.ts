// v3.24.2: helpers puros do PR C — extraidos pra modulo standalone porque
// importar de src/routes/adminAcessos.ts arrasta dep transitiva (voyageai
// via propostasConsultoria) que falha em ESM nos testes.
//
// Funcoes 100% puras (sem DB, sem HTTP, sem deps de runtime).

import crypto from 'crypto';

// Charset sem caracteres ambiguos (0/O, 1/l/I). Pra ler/digitar no celular.
const CHARS_SENHA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function gerarSenhaTemporaria(len = 8): string {
  let s = '';
  const buf = crypto.randomBytes(len * 2);
  for (let i = 0; i < len; i++) {
    s += CHARS_SENHA[buf[i] % CHARS_SENHA.length];
  }
  return s;
}

export function montarMensagemCredenciais(input: {
  nome: string;
  login: string;
  senha: string;
  urlLogin: string;
}): string {
  return (
    `🔐 *Acesso ZAYRA — Romatec*\n\n` +
    `Olá, ${input.nome}! Seu acesso ao sistema foi liberado.\n\n` +
    `🌐 Link: ${input.urlLogin}\n` +
    `👤 Login: ${input.login}\n` +
    `🔑 Senha temporária: ${input.senha}\n\n` +
    `⚠️ Recomendamos trocar a senha após o primeiro acesso.\n\n` +
    `Qualquer dúvida, fale com o José Romário.`
  );
}

// Email padrao derivado do nome do colaborador. Slug do nome + .id@romatec.local
export function emailPadrao(equipeId: number, nome: string): string {
  const slug = nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 30);
  return `${slug || 'colab'}.${equipeId}@romatec.local`;
}
