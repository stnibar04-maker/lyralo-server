import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query } from '../lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

console.log('Running schema migration...');
try {
  await query(sql);
  console.log('✓ Schema applied');
  process.exit(0);
} catch (e) {
  console.error('✗ Migration failed:', e.message);
  process.exit(1);
}
