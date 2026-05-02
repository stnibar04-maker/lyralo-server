// Background poller — checks Suno jobs every 30s.
// Runs as a setInterval inside the same Node process for simplicity.
import { pollPendingSongs } from '../lib/orchestrator.js';

const INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
let busy = false;

export function startPoller() {
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
  console.log(`[poller] started (every ${INTERVAL_MS}ms)`);
}
