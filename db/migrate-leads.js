/**
 * Migration one-shot : ajoute la table `leads` si elle n'existe pas.
 * Safe à relancer plusieurs fois (CREATE TABLE IF NOT EXISTS).
 * Usage : node db/migrate-leads.js
 */
import 'dotenv/config';
import { query } from '../lib/db.js';

const sql = `
CREATE TABLE IF NOT EXISTS leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  quiz        JSONB NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL DEFAULT 'quiz',
  converted   BOOLEAN NOT NULL DEFAULT FALSE,
  order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email   ON leads (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_leads_converted      ON leads (converted) WHERE converted = FALSE;
CREATE INDEX IF NOT EXISTS idx_leads_created        ON leads (created_at DESC);
`;

console.log('[migrate-leads] Applying leads table...');
try {
  await query(sql);
  console.log('✓ Table leads created / already exists');
  process.exit(0);
} catch (e) {
  console.error('✗ Migration failed:', e.message);
  process.exit(1);
}
