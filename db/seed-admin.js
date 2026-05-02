import bcrypt from 'bcryptjs';
import { query } from '../lib/db.js';
import 'dotenv/config';

const email = process.argv[2] || process.env.SEED_ADMIN_EMAIL;
const password = process.argv[3] || process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  console.error('Usage: node db/seed-admin.js <email> <password>');
  console.error('   or set SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD env vars');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
try {
  const r = await query(
    `INSERT INTO admins (email, password_hash, role)
     VALUES ($1, $2, 'super')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email, role`,
    [email.toLowerCase(), hash]
  );
  console.log('✓ Admin upserted:', r.rows[0]);
  process.exit(0);
} catch (e) {
  console.error('✗ Seed failed:', e.message);
  process.exit(1);
}
