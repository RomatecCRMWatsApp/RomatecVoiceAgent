import mysql from 'mysql2/promise';

const DB_URL =
  process.env.DATABASE_URL ??
  'mysql://root:mzhpVamVFtfKDLkQtfxGnjnlVLrVEaAf@mainline.proxy.rlwy.net:56439/railway';

// Pass URI as string — mysql2 createPool({ uri }) ignores the field in some versions
const pool = mysql.createPool(DB_URL);

export default pool;
