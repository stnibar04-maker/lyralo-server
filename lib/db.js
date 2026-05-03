import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// SSL is opt-in. Coolify's internal Postgres has no SSL — keep it off by default.
// For managed Postgres (Neon, Supabase, RDS) either:
//   1. Set DATABASE_SSL=true env var, OR
//   2. Append `?sslmode=require` to your DATABASE_URL.
const sslEnabled =
  process.env.DATABASE_SSL === 'true' ||
  /sslmode=require/i.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
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
