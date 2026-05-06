// Background poller — checks Suno jobs every 30s + lead recovery emails.
import { pollPendingSongs } from '../lib/orchestrator.js';
import { sendLeadRecovery } from '../lib/email.js';
import { query } from '../lib/db.js';

const INTERVAL_MS     = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const LEAD_POLL_MS    = 5 * 60 * 1000; // vérifier les leads toutes les 5 min

// Délais entre les relances
const RECOVERY_DELAYS = [
  60 * 60 * 1000,       // relance 1 : +1h après la capture
  24 * 60 * 60 * 1000,  // relance 2 : +24h après la relance 1
  48 * 60 * 60 * 1000,  // relance 3 : +48h après la relance 2
];

let busy = false;
let leadBusy = false;

export function startPoller() {
  // ── Suno poller ──────────────────────────────────────────────
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const out = await pollPendingSongs();
      if (out.updated > 0) console.log(`[poller] ${out.updated}/${out.polled} jobs updated`);
    } catch (e) {
      console.error('[poller] error', e.message);
    } finally {
      busy = false;
    }
  }, INTERVAL_MS);

  // ── Lead recovery poller ─────────────────────────────────────
  setInterval(async () => {
    if (leadBusy) return;
    leadBusy = true;
    try {
      await pollLeadRecovery();
    } catch (e) {
      console.error('[lead-poller] error', e.message);
    } finally {
      leadBusy = false;
    }
  }, LEAD_POLL_MS);

  console.log(`[poller] started (suno: every ${INTERVAL_MS}ms, leads: every ${LEAD_POLL_MS/1000}s)`);
}

async function pollLeadRecovery() {
  const now = Date.now();

  // Leads à relancer : non convertis, recovery_count < 3
  // Condition : soit jamais relancé (recovery_count=0) et créé il y a > 1h
  //             soit déjà relancé et dernière relance il y a assez longtemps
  const { rows: leads } = await query(`
    SELECT * FROM leads
    WHERE converted = FALSE
      AND recovery_count < 3
      AND (
        (recovery_count = 0 AND created_at      <= now() - interval '1 hour')
        OR
        (recovery_count = 1 AND last_recovery_at <= now() - interval '24 hours')
        OR
        (recovery_count = 2 AND last_recovery_at <= now() - interval '48 hours')
      )
    LIMIT 20
  `);

  if (!leads.length) return;

  console.log(`[lead-poller] ${leads.length} lead(s) à relancer`);

  for (const lead of leads) {
    try {
      const attempt = lead.recovery_count + 1;
      await sendLeadRecovery({ to: lead.email, quiz: lead.quiz || {}, attempt });
      await query(
        `UPDATE leads
         SET recovery_count = recovery_count + 1,
             last_recovery_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [lead.id]
      );
      console.log(`[lead-poller] relance #${attempt} envoyée → ${lead.email}`);
    } catch (e) {
      console.error(`[lead-poller] échec pour ${lead.email}:`, e.message);
    }
  }
}
