// Coordinates the full pipeline:  intake → lyrics → song(s) → review → delivery
import { query, logActivity, tx } from './db.js';
import { generateLyrics, regenerateLyrics } from './claude.js';
import { submitGeneration, getStatus, takesForBundle, variantStyle } from './suno.js';
import { sendOrderReceived, sendSongDelivered } from './email.js';

// =====================================================================
// STAGE 1 — Lyrics
// =====================================================================
export async function runLyricsStage(orderId) {
  const { rows: [order] } = await query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!order) throw new Error('order not found');
  if (order.status !== 'lyrics_pending') return { skipped: true, status: order.status };

  await logActivity(orderId, 'system', 'lyrics.start', {});
  const result = await generateLyrics(order.quiz);

  const v = await tx(async (c) => {
    const { rows: [maxV] } = await c.query(`SELECT COALESCE(MAX(version),0)+1 AS v FROM lyrics WHERE order_id = $1`, [orderId]);
    await c.query(
      `INSERT INTO lyrics (order_id, version, title, content, prompt_meta) VALUES ($1, $2, $3, $4, $5)`,
      [orderId, maxV.v, result.title, result.content, result.meta]
    );
    await c.query(`UPDATE orders SET status = 'lyrics_ready' WHERE id = $1`, [orderId]);
    return maxV.v;
  });

  await logActivity(orderId, 'system', 'lyrics.ready', { version: v, title: result.title });
  return { ok: true, title: result.title, version: v };
}

// =====================================================================
// STAGE 2 — Song generation (1 or 2 takes depending on bundle)
// =====================================================================
export async function runSongStage(orderId) {
  const { rows: [order] } = await query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!order) throw new Error('order not found');
  if (order.status !== 'lyrics_ready') return { skipped: true, status: order.status };

  const { rows: [latestLyrics] } = await query(
    `SELECT * FROM lyrics WHERE order_id = $1 ORDER BY version DESC LIMIT 1`, [orderId]
  );
  if (!latestLyrics) throw new Error('no lyrics yet');

  const takes = takesForBundle(order.bundle);
  const genre = order.quiz?.genre || 'pop';
  const mood  = order.quiz?.mood || '';
  const submitted = [];

  for (let i = 0; i < takes; i++) {
    const style = variantStyle(genre, i);
    const { jobId, raw } = await submitGeneration({
      title: `${latestLyrics.title}${takes > 1 ? ` (Take ${i + 1})` : ''}`,
      lyrics: latestLyrics.content,
      style,
      mood
    });
    const { rows: [song] } = await query(
      `INSERT INTO songs (order_id, lyrics_id, suno_job_id, genre, status, meta)
       VALUES ($1, $2, $3, $4, 'queued', $5) RETURNING *`,
      [orderId, latestLyrics.id, jobId, style, { take: i + 1, totalTakes: takes, submitResp: raw }]
    );
    submitted.push(song);
    await logActivity(orderId, 'system', 'suno.submit', { take: i + 1, jobId, style });
  }

  await query(`UPDATE orders SET status = 'song_generating' WHERE id = $1`, [orderId]);
  return { ok: true, takes, jobs: submitted.map(s => s.suno_job_id) };
}

// =====================================================================
// STAGE 3 — Poll Suno jobs (called by cron)
// =====================================================================
export async function pollPendingSongs() {
  const { rows: pending } = await query(
    `SELECT * FROM songs WHERE status IN ('queued','generating') ORDER BY created_at LIMIT 25`
  );
  let updated = 0;
  for (const song of pending) {
    try {
      const { status, clips } = await getStatus(song.suno_job_id);
      const upStatus = String(status).toUpperCase();

      if (clips.length > 0 && (upStatus === 'SUCCESS' || upStatus === 'COMPLETE' || upStatus === 'COMPLETED')) {
        const clip = clips[0];
        await query(
          `UPDATE songs
             SET status='ready', audio_url=$2, cover_url=$3, duration_sec=$4, suno_clip_id=$5, ready_at=now()
           WHERE id=$1`,
          [song.id, clip.audioUrl, clip.coverUrl, clip.duration, clip.id]
        );
        await logActivity(song.order_id, 'system', 'suno.ready', { take: song.meta?.take, audioUrl: clip.audioUrl });
        updated++;
        await maybeAdvanceOrderToReview(song.order_id);
      } else if (upStatus === 'GENERATING' || upStatus === 'PENDING' || upStatus === 'PROCESSING') {
        if (song.status !== 'generating') {
          await query(`UPDATE songs SET status='generating' WHERE id=$1`, [song.id]);
        }
      } else if (upStatus === 'FAILED' || upStatus === 'ERROR') {
        await query(`UPDATE songs SET status='failed' WHERE id=$1`, [song.id]);
        await logActivity(song.order_id, 'system', 'suno.failed', { jobId: song.suno_job_id });
      }
    } catch (e) {
      console.error('[poller] song', song.id, e.message);
    }
  }
  return { polled: pending.length, updated };
}

// When all required takes for an order are READY → move to awaiting_review
async function maybeAdvanceOrderToReview(orderId) {
  const { rows: [order] } = await query(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  if (!order) return;
  if (!['song_generating'].includes(order.status)) return;

  const need = takesForBundle(order.bundle);
  const { rows: [{ ready }] } = await query(
    `SELECT COUNT(*)::int AS ready FROM songs
      WHERE order_id=$1 AND status='ready'
        AND created_at >= COALESCE(
          (SELECT MAX(created_at) FROM revisions WHERE order_id=$1 AND status='applied'),
          '1970-01-01'::timestamptz
        )`,
    [orderId]
  );
  if (ready >= need) {
    // Mark the latest N ready songs as current
    await query(
      `UPDATE songs SET is_current = (id IN (
         SELECT id FROM songs WHERE order_id=$1 AND status='ready' ORDER BY created_at DESC LIMIT $2
       )) WHERE order_id=$1`,
      [orderId, need]
    );
    await query(`UPDATE orders SET status='awaiting_review' WHERE id=$1`, [orderId]);
    await logActivity(orderId, 'system', 'order.awaiting_review', { takesReady: ready });
  }
}

// =====================================================================
// STAGE 4 — Approve & deliver to customer
// =====================================================================
export async function approveAndDeliver(orderId, adminEmail) {
  const { rows: [order] } = await query(`SELECT * FROM orders WHERE id=$1`, [orderId]);
  if (!order) throw new Error('order not found');

  const { rows: songs } = await query(
    `SELECT * FROM songs WHERE order_id=$1 AND is_current=TRUE ORDER BY created_at`, [orderId]
  );
  if (!songs.length) throw new Error('no current song to deliver');

  // Pull the latest lyrics so we can include the title + a preview in the email
  const { rows: [latestLyrics] } = await query(
    `SELECT * FROM lyrics WHERE order_id=$1 ORDER BY version DESC LIMIT 1`, [orderId]
  );

  await query(
    `UPDATE orders SET status='delivered', delivered_at=now() WHERE id=$1`, [orderId]
  );
  await logActivity(orderId, adminEmail || 'admin', 'order.approved', { songCount: songs.length });

  await sendSongDelivered({
    to: order.customer_email,
    name: order.customer_name,
    orderNo: order.shopify_order_no,
    trackUrl: `${process.env.PUBLIC_BASE_URL || ''}/track?email=${encodeURIComponent(order.customer_email)}`,
    songUrls: songs.map(s => s.audio_url).filter(Boolean),
    recipient: order.quiz?.recipient,
    occasion: order.quiz?.occasion,
    lyricsTitle: latestLyrics?.title,
    lyricsContent: latestLyrics?.content
  }).catch(e => console.error('[email] delivery failed:', e.message));

  return { ok: true, songCount: songs.length };
}

// =====================================================================
// STAGE 5 — Apply approved revision (regen lyrics + N songs)
// =====================================================================
export async function applyRevision(revisionId, adminEmail) {
  const { rows: [rev] } = await query(`SELECT * FROM revisions WHERE id=$1`, [revisionId]);
  if (!rev) throw new Error('revision not found');
  if (rev.status !== 'approved') throw new Error('revision is not approved');

  const { rows: [order] } = await query(`SELECT * FROM orders WHERE id=$1`, [rev.order_id]);
  const { rows: [prev] } = await query(
    `SELECT * FROM lyrics WHERE order_id=$1 ORDER BY version DESC LIMIT 1`, [rev.order_id]
  );

  // 1) Regenerate lyrics with the customer's notes
  if (rev.change_type === 'lyrics' || rev.change_type === 'full') {
    const result = await regenerateLyrics(order.quiz, prev?.content || '', rev.customer_notes);
    await query(
      `INSERT INTO lyrics (order_id, version, title, content, prompt_meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [order.id, (prev?.version || 0) + 1, result.title, result.content, result.meta]
    );
  }

  // 2) Mark all existing songs as not current
  await query(`UPDATE songs SET is_current=FALSE WHERE order_id=$1`, [order.id]);

  // 3) Submit fresh Suno jobs (1 or 2 depending on bundle)
  const { rows: [latestLyrics] } = await query(
    `SELECT * FROM lyrics WHERE order_id=$1 ORDER BY version DESC LIMIT 1`, [order.id]
  );
  const takes = takesForBundle(order.bundle);
  const genre = order.quiz?.genre || 'pop';
  const mood  = order.quiz?.mood || '';
  for (let i = 0; i < takes; i++) {
    const style = variantStyle(genre, i);
    const { jobId } = await submitGeneration({
      title: `${latestLyrics.title}${takes > 1 ? ` (Take ${i + 1})` : ''}`,
      lyrics: latestLyrics.content,
      style, mood
    });
    await query(
      `INSERT INTO songs (order_id, lyrics_id, suno_job_id, genre, status, meta)
       VALUES ($1, $2, $3, $4, 'queued', $5)`,
      [order.id, latestLyrics.id, jobId, style, { take: i + 1, totalTakes: takes, revisionId }]
    );
  }

  // 4) Update revision + order
  await query(
    `UPDATE revisions SET status='applied', decided_at=now() WHERE id=$1`, [revisionId]
  );
  await query(
    `UPDATE orders SET status='song_generating', used_revisions = used_revisions + 1 WHERE id=$1`, [order.id]
  );

  await logActivity(order.id, adminEmail || 'admin', 'revision.applied', { revisionId, takes });
  return { ok: true, takes };
}
