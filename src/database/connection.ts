import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error(
    '[DB] DATABASE_URL não configurada. Defina a variável de ambiente antes de iniciar o servidor.',
  );
}

// v1.66.24: pool maior pra reduzir wait quando varias requests batem juntas
// (chat ZAYRA + tools + dashboard + briefings). Default mysql2 = 10.
const pool = mysql.createPool({
  uri: DB_URL,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 25,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
});

export default pool;
