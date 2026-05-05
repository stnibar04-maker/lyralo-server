import { Router } from 'express';
import { query, logActivity } from '../lib/db.js';
import { login, signToken, setAuthCookie, clearAuthCookie, requireAdmin } from '../lib/auth.js';
import {
  runLyricsStage, runSongStage, approveAndDeliver, applyRevision, pollPendingSongs
} from '../lib/orchestrator.js';
import { sendRevisionUpdate } from '../lib/email.js';

const router = Router();

// ----- Auth -----
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing credentials' });
  const admin = await login(email, password);
  if (!admin) return res.status(401).json({ error: 'invalid credentials' });
  const token = signToken(admin);
  setAuthCookie(res, token);
  res.json({ ok: true, admin: { id: admin.id, email: admin.email, role: admin.role, name: admin.name } });
});

router.post('/auth/logout', (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });
router.get('/me', requireAdmin, (req, res) => res.json({ admin: req.admin }));

// All routes below require admin auth
router.use(requireAdmin);

// ----- Stats / overview -----
router.get('/stats', async (req, res) => {
  const today = await query(`SELECT COUNT(*)::int AS c FROM orders WHERE created_at >= now() - interval '24 hours'`);
  const week  = await query(`SELECT COUNT(*)::int AS c FROM orders WHERE created_at >= now() - interval '7 days'`);
  const revenue = await query(`SELECT COALESCE(SUM(amount_cents),0)::bigint AS r FROM orders WHERE created_at >= now() - interval '30 days' AND status NOT IN ('refunded','failed')`);
  const pendingReview = await query(`SELECT COUNT(*)::int AS c FROM orders WHERE status='awaiting_review'`);
  const pendingRevisions = await query(`SELECT COUNT(*)::int AS c FROM revisions WHERE status='pending'`);
  const inFlight = await query(`SELECT COUNT(*)::int AS c FROM orders WHERE status IN ('lyrics_pending','lyrics_ready','song_generating')`);
  res.json({
    orders24h: today.rows[0].c,
    orders7d: week.rows[0].c,
    revenue30d_cents: Number(revenue.rows[0].r),
    pendingReview: pendingReview.rows[0].c,
    pendingRevisions: pendingRevisions.rows[0].c,
    inFlight: inFlight.rows[0].c
  });
});

// ----- List orders (filterable) -----
router.get('/orders', async (req, res) => {
  const { status, q, limit = 50 } = req.query;
  const params = [];
  const where = [];
  if (status && status !== 'all') { params.push(status); where.push(`status = $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(customer_email ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR shopify_order_no ILIKE $${params.length})`);
  }
  const sql = `SELECT id, shopify_order_no, customer_email, customer_name, bundle, currency, amount_cents,
                      status, free_revisions, used_revisions, created_at, updated_at
                 FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC LIMIT ${Math.min(Number(limit), 200)}`;
  const r = await query(sql, params);
  res.json({ orders: r.rows });
});

// ----- Order detail (with lyrics, songs, revisions, log) -----
router.get('/orders/:id', async (req, res) => {
  const id = req.params.id;
  const order = (await query(`SELECT * FROM orders WHERE id=$1`, [id])).rows[0];
  if (!order) return res.status(404).json({ error: 'not found' });
  const lyrics = (await query(`SELECT * FROM lyrics WHERE order_id=$1 ORDER BY version DESC`, [id])).rows;
  const songs = (await query(`SELECT * FROM songs WHERE order_id=$1 ORDER BY created_at DESC`, [id])).rows;
  const revisions = (await query(`SELECT * FROM revisions WHERE order_id=$1 ORDER BY created_at DESC`, [id])).rows;
  const log = (await query(`SELECT * FROM activity_log WHERE order_id=$1 ORDER BY created_at DESC LIMIT 50`, [id])).rows;
  res.json({ order, lyrics, songs, revisions, log });
});

// ----- Update order notes -----
router.patch('/orders/:id', async (req, res) => {
  const { notes, free_revisions } = req.body || {};
  const fields = [];
  const params = [req.params.id];
  if (notes !== undefined) { params.push(notes); fields.push(`notes = $${params.length}`); }
  if (free_revisions !== undefined) { params.push(parseInt(free_revisions, 10)); fields.push(`free_revisions = $${params.length}`); }
  if (!fields.length) return res.json({ ok: true });
  await query(`UPDATE orders SET ${fields.join(', ')} WHERE id = $1`, params);
  await logActivity(req.params.id, req.admin.email, 'order.update', { notes, free_revisions });
  res.json({ ok: true });
});

// ----- Manual: grant a free revision (increments allowance) -----
router.post('/orders/:id/grant-revision', async (req, res) => {
  const { count = 1, reason } = req.body || {};
  await query(`UPDATE orders SET free_revisions = free_revisions + $2 WHERE id = $1`, [req.params.id, parseInt(count, 10)]);
  await logActivity(req.params.id, req.admin.email, 'revision.granted', { count, reason });
  res.json({ ok: true });
});

// ----- Manual: re-run lyrics / re-run songs -----
router.post('/orders/:id/regenerate-lyrics', async (req, res) => {
  await query(`UPDATE orders SET status='lyrics_pending' WHERE id=$1`, [req.params.id]);
  await runLyricsStage(req.params.id);
  await runSongStage(req.params.id);
  await logActivity(req.params.id, req.admin.email, 'manual.regenerate-lyrics', {});
  res.json({ ok: true });
});

router.post('/orders/:id/regenerate-song', async (req, res) => {
  await query(`UPDATE orders SET status='lyrics_ready' WHERE id=$1`, [req.params.id]);
  await runSongStage(req.params.id);
  await logActivity(req.params.id, req.admin.email, 'manual.regenerate-song', {});
  res.json({ ok: true });
});

// ----- Approve & deliver -----
router.post('/orders/:id/approve', async (req, res) => {
  try {
    const out = await approveAndDeliver(req.params.id, req.admin.email);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ----- Status override (for stuck/manual orders) -----
router.post('/orders/:id/status', async (req, res) => {
  const allowed = ['lyrics_pending','lyrics_ready','song_generating','awaiting_review','approved','delivered','refunded','failed'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
  await query(`UPDATE orders SET status=$2 WHERE id=$1`, [req.params.id, status]);
  await logActivity(req.params.id, req.admin.email, 'manual.status-override', { status });
  res.json({ ok: true });
});

// ============= REVISIONS =============
router.get('/revisions', async (req, res) => {
  const { status = 'pending' } = req.query;
  const r = await query(
    `SELECT r.*, o.customer_email, o.customer_name, o.shopify_order_no, o.bundle, o.free_revisions, o.used_revisions
       FROM revisions r JOIN orders o ON o.id = r.order_id
      WHERE ($1 = 'all' OR r.status = $1)
      ORDER BY r.created_at DESC LIMIT 100`,
    [status]
  );
  res.json({ revisions: r.rows });
});

router.post('/revisions/:id/approve', async (req, res) => {
  await query(`UPDATE revisions SET status='approved', decided_by=$2, decided_at=now() WHERE id=$1`, [req.params.id, req.admin.id]);
  const { rows: [rev] } = await query(`SELECT r.*, o.customer_email, o.customer_name FROM revisions r JOIN orders o ON o.id=r.order_id WHERE r.id=$1`, [req.params.id]);
  sendRevisionUpdate({ to: rev.customer_email, name: rev.customer_name, status: 'approved', note: req.body?.note }).catch(()=>{});
  // Apply (regen lyrics + songs) immediately
  try { await applyRevision(req.params.id, req.admin.email); }
  catch (e) { console.error('applyRevision', e.message); }
  res.json({ ok: true });
});

router.post('/revisions/:id/reject', async (req, res) => {
  const note = req.body?.note;
  await query(`UPDATE revisions SET status='rejected', admin_notes=$2, decided_by=$3, decided_at=now() WHERE id=$1`, [req.params.id, note, req.admin.id]);
  const { rows: [rev] } = await query(`SELECT r.*, o.customer_email, o.customer_name FROM revisions r JOIN orders o ON o.id=r.order_id WHERE r.id=$1`, [req.params.id]);
  sendRevisionUpdate({ to: rev.customer_email, name: rev.customer_name, status: 'rejected', note }).catch(()=>{});
  res.json({ ok: true });
});

// Admin can create a revision on behalf of the customer
router.post('/orders/:id/revisions', async (req, res) => {
  const { customer_notes, change_type = 'lyrics', is_free = true } = req.body || {};
  const r = await query(
    `INSERT INTO revisions (order_id, requested_by, change_type, customer_notes, is_free, status)
     VALUES ($1, 'admin', $2, $3, $4, 'pending') RETURNING *`,
    [req.params.id, change_type, customer_notes, is_free]
  );
  await logActivity(req.params.id, req.admin.email, 'revision.created-by-admin', { change_type, is_free });
  res.json({ revision: r.rows[0] });
});

// ----- Manual: trigger Suno polling (debug) -----
router.post('/poll', async (req, res) => {
  const out = await pollPendingSongs();
  res.json(out);
});

// ============= LEADS (abandons quiz avant checkout) =============
router.get('/leads', async (req, res) => {
  const { converted = 'false', limit = 100 } = req.query;
  const filterConverted = converted === 'all' ? null : converted === 'true';
  const params = [];
  const where = filterConverted !== null
    ? [`converted = $${params.push(filterConverted)}`]
    : [];
  const sql = `
    SELECT id, email, source, converted, order_id,
           quiz->>'recipient' AS recipient, quiz->>'occasion' AS occasion,
           quiz->>'genre' AS genre, quiz->>'voiceType' AS voice,
           created_at, updated_at
      FROM leads
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT ${Math.min(Number(limit), 500)}`;
  const r = await query(sql, params);
  res.json({ leads: r.rows });
});

export default router;
