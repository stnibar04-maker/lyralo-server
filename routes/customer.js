// Public customer endpoints — no admin auth.
import { Router } from 'express';
import { query, logActivity } from '../lib/db.js';

const router = Router();

// ── EMAIL CAPTURE (quiz step avant checkout) ─────────────────────────────────
// Déclenché dès que le client passe le step email → avant de voir les bundles.
// Upsert : si même email revient on met à jour le quiz (+ récent).
router.post('/email-capture', async (req, res) => {
  try {
    const { email, quiz = {}, source = 'quiz' } = req.body || {};
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      return res.status(400).json({ error: 'email invalide' });
    }

    await query(
      `INSERT INTO leads (email, quiz, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (LOWER(email))
       DO UPDATE SET quiz = $2, source = $3, updated_at = now()
       WHERE leads.converted = FALSE`,   // ne pas écraser si déjà converti
      [clean, JSON.stringify(quiz), source]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[email-capture]', err.message);
    // On swallow silently côté client — ne pas bloquer le quiz
    res.status(500).json({ ok: false });
  }
});

// Lookup orders by email (no PII besides their own)
router.get('/orders', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'email required' });

  const r = await query(
    `SELECT o.id, o.shopify_order_no, o.bundle, o.status, o.created_at, o.delivered_at,
            o.free_revisions, o.used_revisions,
            (SELECT json_agg(json_build_object(
                'id', s.id, 'audio_url', s.audio_url, 'cover_url', s.cover_url,
                'duration_sec', s.duration_sec, 'genre', s.genre, 'is_current', s.is_current
            )) FROM songs s WHERE s.order_id = o.id AND s.is_current = TRUE) AS songs,
            (SELECT json_agg(json_build_object(
                'id', l.id, 'title', l.title, 'content', l.content, 'version', l.version
            )) FROM (SELECT * FROM lyrics WHERE order_id = o.id ORDER BY version DESC LIMIT 1) l) AS lyrics
       FROM orders o
      WHERE LOWER(o.customer_email) = $1
      ORDER BY o.created_at DESC LIMIT 25`,
    [email]
  );
  res.json({ orders: r.rows });
});

// Customer requests a revision
router.post('/orders/:id/revisions', async (req, res) => {
  const { email, customer_notes, change_type = 'lyrics' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!customer_notes || customer_notes.trim().length < 5) {
    return res.status(400).json({ error: 'please describe what you would like changed' });
  }

  const { rows: [order] } = await query(
    `SELECT * FROM orders WHERE id=$1 AND LOWER(customer_email)=LOWER($2)`,
    [req.params.id, email]
  );
  if (!order) return res.status(404).json({ error: 'order not found' });

  const remaining = (order.free_revisions || 0) - (order.used_revisions || 0);
  if (remaining <= 0) {
    return res.status(402).json({
      error: 'no_free_revisions_left',
      message: 'You have used all your free revisions. Contact support@lyralo.com to add more.'
    });
  }

  const r = await query(
    `INSERT INTO revisions (order_id, requested_by, change_type, customer_notes, is_free, status)
     VALUES ($1, 'customer', $2, $3, TRUE, 'pending') RETURNING *`,
    [order.id, change_type, customer_notes]
  );
  await logActivity(order.id, order.customer_email, 'revision.requested', { change_type });

  res.json({ ok: true, revision: r.rows[0], remaining: remaining - 1 });
});

export default router;
