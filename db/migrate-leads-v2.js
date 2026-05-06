/**
 * Migration : ajoute recovery_count + last_recovery_at à la table leads.
 * Safe à relancer (ALTER TABLE IF NOT EXISTS n'existe pas en PG,
 * on utilise DO $$ BEGIN ... EXCEPTION WHEN duplicate_column THEN END $$).
 * Usage : node db/migrate-leads-v2.js
 */
import 'dotenv/config';
import { query } from '../lib/db.js';

const sql = `
DO $$ BEGIN
  ALTER TABLE leads ADD COLUMN recovery_count   INTEGER     NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE leads ADD COLUMN last_recovery_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
`;

console.log('[migrate-leads-v2] Adding recovery columns...');
try {
  await query(sql);
  console.log('✓ Columns recovery_count + last_recovery_at added (or already exist)');
  process.exit(0);
} catch (e) {
  console.error('✗ Migration failed:', e.message);
  process.exit(1);
}
