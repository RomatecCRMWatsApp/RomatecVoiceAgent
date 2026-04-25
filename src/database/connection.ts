import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL ??
    'mysql://root:mzhpVamVFtfKDLkQtfxGnjnlVLrVEaAf@mainline.proxy.rlwy.net:56439/railway',
  waitForConnections: true,
  connectionLimit:    10,
});

export default pool;
