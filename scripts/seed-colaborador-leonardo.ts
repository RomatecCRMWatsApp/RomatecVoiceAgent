// v3.24.1: PR B — seed do primeiro colaborador (Leonardo da Silva Oliveira).
//
// Uso local (apontando pro Railway DB via DATABASE_URL no .env):
//   npx tsx scripts/seed-colaborador-leonardo.ts
//
// O que faz:
// 1. Procura "Leonardo da Silva Oliveira" em romatec_obra_equipe (LIKE % name %)
// 2. Se nao encontrar, lista os 10 mais proximos e aborta
// 3. Se encontrar, cria registro em users com:
//    - email derivado (leonardo.silva@romatec.local) — placeholder; CEO pode trocar
//    - senha temporaria aleatoria de 8 chars sem ambiguidade (sem 0/O/1/l/I)
//    - hash bcrypt cost 12
// 4. Vincula em tenant_users com role='colaborador' + equipe_id=<id do Leonardo>
// 5. Imprime credenciais no console (UNICA VEZ — nao re-imprime apos)
//
// NAO envia WhatsApp automaticamente (CEO dispara via painel admin na PR C).
//
// Idempotente: se ja existir user com esse email OU se tenant_users ja tem o vinculo,
// pula e imprime aviso. Pra recriar do zero, apaga manualmente antes de re-rodar.

import 'dotenv/config';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../src/database/connection';

const NOME_BUSCA = 'Leonardo da Silva Oliveira';
const EMAIL_PADRAO = 'leonardo.silva@romatec.local';
const TENANT_ID_PADRAO = 1;
const CHARS_SENHA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O/1/l/I

function gerarSenha(len = 8): string {
  let s = '';
  const buf = crypto.randomBytes(len * 2);
  for (let i = 0; i < len; i++) {
    s += CHARS_SENHA[buf[i] % CHARS_SENHA.length];
  }
  return s;
}

interface EquipeRow extends RowDataPacket {
  id: number;
  nome: string;
  funcao: string | null;
  telefone: string | null;
  valor_dia: string | number | null;
  ativo: number;
}

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
}

interface TenantUserRow extends RowDataPacket {
  id: number;
  role: string;
  equipe_id: number | null;
}

async function main() {
  console.log(`\n[seed-leonardo] buscando "${NOME_BUSCA}" em romatec_obra_equipe...\n`);

  const [rows] = await pool.execute<EquipeRow[]>(
    `SELECT id, nome, funcao, telefone, valor_dia, ativo
       FROM romatec_obra_equipe
      WHERE nome LIKE ?
      ORDER BY ativo DESC, id ASC
      LIMIT 5`,
    [`%${NOME_BUSCA}%`],
  );

  if (rows.length === 0) {
    console.error(`[seed-leonardo] ❌ Nao encontrei "${NOME_BUSCA}" em romatec_obra_equipe.`);
    console.error('Listando 10 colaboradores ativos pra voce verificar o nome correto:\n');
    const [todos] = await pool.execute<EquipeRow[]>(
      `SELECT id, nome, funcao FROM romatec_obra_equipe WHERE ativo = 1 ORDER BY nome LIMIT 10`,
    );
    for (const r of todos) {
      console.error(`  - id=${r.id} | ${r.nome} | ${r.funcao || '(sem funcao)'}`);
    }
    process.exit(1);
  }

  const leonardo = rows[0];
  console.log(`[seed-leonardo] ✓ Encontrado: id=${leonardo.id} | ${leonardo.nome} | ${leonardo.funcao || '(sem funcao)'}\n`);

  // Verifica se ja existe user com esse email
  const [usersExistentes] = await pool.execute<UserRow[]>(
    `SELECT id, email FROM users WHERE email = ? LIMIT 1`,
    [EMAIL_PADRAO],
  );
  let userId: number;
  let credenciaisNovas = false;

  if (usersExistentes.length > 0) {
    userId = usersExistentes[0].id;
    console.log(`[seed-leonardo] ⚠ User com email ${EMAIL_PADRAO} ja existe (id=${userId}). NAO regenerando senha.`);
    console.log('  Pra regenerar, apague antes: DELETE FROM users WHERE id = ' + userId + ';\n');
  } else {
    const senha = gerarSenha(8);
    const hash = await bcrypt.hash(senha, 12);

    // Schema do DB pode ser legacy/hibrido — tentar com TODOS os campos esperados
    // (openId UNIQUE da legacy + password_hash da SaaS). Tabela em prod tem ambos.
    const openId = `colab-${leonardo.id}-${Date.now()}`;
    const [ins] = await pool.execute<ResultSetHeader>(
      `INSERT INTO users (openId, email, name, phone, loginMethod, role, password_hash)
       VALUES (?, ?, ?, ?, 'password', 'user', ?)`,
      [openId, EMAIL_PADRAO, leonardo.nome, leonardo.telefone, hash],
    );
    userId = ins.insertId;
    credenciaisNovas = true;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Acesso criado para ${leonardo.nome}`);
    console.log(`   Login: ${EMAIL_PADRAO}`);
    console.log(`   Senha temporaria: ${senha}`);
    console.log(`   ⚠ ANOTE AGORA — nao sera reimpressa.`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  // Vincula em tenant_users (idempotente — INSERT IGNORE)
  const [tuExistentes] = await pool.execute<TenantUserRow[]>(
    `SELECT id, role, equipe_id FROM tenant_users WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  if (tuExistentes.length > 0) {
    const tu = tuExistentes[0];
    console.log(`[seed-leonardo] ⚠ tenant_users ja tem vinculo (id=${tu.id}, role=${tu.role}, equipe_id=${tu.equipe_id ?? 'null'})`);
    if (tu.equipe_id == null || tu.equipe_id !== leonardo.id) {
      console.log(`  Atualizando equipe_id pra ${leonardo.id}...`);
      await pool.execute(
        `UPDATE tenant_users SET equipe_id = ?, role = 'colaborador' WHERE id = ?`,
        [leonardo.id, tu.id],
      );
      console.log('  ✓ Atualizado.\n');
    } else {
      console.log('  ✓ Vinculo ja correto. Nada a fazer.\n');
    }
  } else {
    await pool.execute(
      `INSERT INTO tenant_users (tenant_id, user_id, role, equipe_id)
       VALUES (?, ?, 'colaborador', ?)`,
      [TENANT_ID_PADRAO, userId, leonardo.id],
    );
    console.log(`[seed-leonardo] ✓ Vinculado em tenant_users (tenant=${TENANT_ID_PADRAO}, role=colaborador, equipe_id=${leonardo.id})\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Proximo passo:');
  if (credenciaisNovas) {
    console.log(`  1. Envie as credenciais acima pro ${leonardo.nome} via WhatsApp manualmente`);
    console.log(`     (PR C vai automatizar isso via painel admin).`);
    console.log(`  2. Leonardo acessa /login no celular e entra.`);
    console.log(`  3. Sera redirecionado pra /minha-quinzena.`);
  } else {
    console.log(`  User ja existia — vinculo confirmado/atualizado. Sem nova senha gerada.`);
    console.log(`  Se precisar resetar a senha, apague o user e re-rode:`);
    console.log(`    DELETE FROM tenant_users WHERE user_id = ${userId};`);
    console.log(`    DELETE FROM users WHERE id = ${userId};`);
    console.log(`    npx tsx scripts/seed-colaborador-leonardo.ts`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-leonardo] FATAL:', err);
  process.exit(1);
});
