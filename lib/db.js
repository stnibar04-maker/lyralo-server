import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10
});

pool.on('error', (err) => console.error('[db] pool error', err));

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function logActivity(orderId, actor, action, meta = {}) {
  await query(
    `INSERT INTO activity_log (order_id, actor, action, meta) VALUES ($1, $2, $3, $4)`,
    [orderId, actor, action, meta]
  );
}

export default pool;
