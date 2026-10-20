/** Conexão MySQL a partir do .env da ZAYRA — aceita DATABASE_URL, DB_* ou MYSQL_*. */
import 'dotenv/config';
import mysql, { type PoolOptions } from 'mysql2/promise';

export function opcoesConexao(): PoolOptions {
  const e = process.env;
  const url = e.DATABASE_URL ?? e.MYSQL_URL;
  if (url && /^mysql:\/\//i.test(url)) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  const host = e.DB_HOST ?? e.MYSQL_HOST ?? e.DATABASE_HOST ?? 'localhost';
  const user = e.DB_USER ?? e.MYSQL_USER ?? e.DATABASE_USER ?? e.DB_USERNAME;
  const password = e.DB_PASSWORD ?? e.MYSQL_PASSWORD ?? e.DATABASE_PASSWORD ?? e.DB_PASS ?? '';
  const database = e.DB_NAME ?? e.MYSQL_DATABASE ?? e.DATABASE_NAME ?? e.DB_DATABASE;
  if (!user || !database) {
    throw new Error('Credenciais do MySQL não encontradas no .env (DATABASE_URL, DB_USER/DB_NAME ou MYSQL_USER/MYSQL_DATABASE)');
  }
  return { host, port: Number(e.DB_PORT ?? e.MYSQL_PORT ?? 3306), user, password, database };
}

export function criarPool(extra: PoolOptions = {}) {
  return mysql.createPool({ ...opcoesConexao(), connectionLimit: 2, ...extra });
}
