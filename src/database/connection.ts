import mysql from 'mysql2/promise';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  throw new Error(
    '[DB] DATABASE_URL não configurada. Defina a variável de ambiente antes de iniciar o servidor.',
  );
}

// Pass URI as string — mysql2 createPool({ uri }) ignores the field in some versions
const pool = mysql.createPool(DB_URL);

export default pool;
