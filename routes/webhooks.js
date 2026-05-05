import { Router } from 'express';
import getRawBody from 'raw-body';
import { query, logActivity } from '../lib/db.js';
import { verifyShopifyHmac, extractQuizFromOrder, totalCents } from '../lib/shopify.js';
import { runLyricsStage, runSongStage } from '../lib/orchestrator.js';
import { sendOrderReceived } from '../lib/email.js';

const router = Router();

// raw body capture (needed for HMAC verification on Shopify webhooks)
router.use((req, res, next) => {
  getRawBody(req, { limit: '5mb' }, (err, buf) => {
    if (err) return res.status(400).send('bad body');
    req.rawBody = buf;
    try { req.body = JSON.parse(buf.toString('utf8')); } catch { req.body = {}; }
    next();
  });
});

// ----- Shopify: orders/create -----
router.post('/shopify/orders/create', async (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const webhookId = req.get('X-Shopify-Webhook-Id') || req.get('X-Shopify-Webhook-Id'.toLowerCase());

  if (!verifyShopifyHmac(req.rawBody, hmac)) {
    return res.status(401).send('invalid hmac');
  }

  // Idempotency
  if (webhookId) {
    const dup = await query(
      `INSERT INTO webhook_events (source, topic, external_id, payload)
       VALUES ('shopify', 'orders/create', $1, $2)
       ON CONFLICT (source, external_id) DO NOTHING
       RETURNING id`,
      [webhookId, req.body]
    );
    if (dup.rowCount === 0) return res.status(200).send('dup');
  }

  // Respond fast — process async
  res.status(200).send('ok');
  processNewOrder(req.body).catch(e => console.error('[webhook] processNewOrder', e));
});

// ----- Shopify: orders/cancelled -----
router.post('/shopify/orders/cancelled', async (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  if (!verifyShopifyHmac(req.rawBody, hmac)) return res.status(401).send('invalid hmac');

  const sid = req.body.id;
  await query(
    `UPDATE orders SET status='refunded' WHERE shopify_order_id=$1`, [sid]
  );
  res.status(200).send('ok');
});

// ----- Suno: optional callback (some providers POST when ready) -----
router.post('/suno', async (req, res) => {
  // Provider-specific. Most providers send { taskId, code, data: { sunoData: [...] } }
  const data = req.body || {};
  const taskId = data?.data?.taskId || data?.task_id || data?.taskId;
  if (!taskId) return res.status(400).send('missing taskId');

  try {
    // Defer to the standard poller logic
    const { pollPendingSongs } = await import('../lib/orchestrator.js');
    await pollPendingSongs();
    res.status(200).send('ok');
  } catch (e) {
    console.error('[suno webhook]', e);
    res.status(500).send('err');
  }
});

// ====================================================================
async function processNewOrder(order) {
  const quiz = extractQuizFromOrder(order);
  const customer = order.customer || {};
  const email = order.email || order.contact_email || customer.email;
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || quiz.senderName;
  const bundle = quiz.bundle === 'complete' ? 'complete' : 'single';

  const inserted = await query(
    `INSERT INTO orders (
        shopify_order_id, shopify_order_no, customer_email, customer_name,
        bundle, currency, amount_cents, quiz, status, free_revisions
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'lyrics_pending', $9)
     ON CONFLICT (shopify_order_id) DO UPDATE
       SET quiz = EXCLUDED.quiz, customer_email = EXCLUDED.customer_email
     RETURNING id`,
    [
      order.id,
      order.order_number ? `#${order.order_number}` : order.name || null,
      email, name,
      bundle,
      (order.currency || 'USD').toUpperCase(),
      totalCents(order),
      quiz,
      bundle === 'complete' ? 999 : 1   // complete = unlimited revisions
    ]
  );
  const orderId = inserted.rows[0].id;
  await logActivity(orderId, 'system', 'order.received', { shopify_id: order.id, bundle });

  // Marquer le lead comme converti (si existant)
  await query(
    `UPDATE leads SET converted = TRUE, order_id = $1, updated_at = now()
     WHERE LOWER(email) = LOWER($2) AND converted = FALSE`,
    [orderId, email]
  ).catch(() => {}); // silently ignore if leads table absent

  // Fire and forget receipt email (don't block pipeline)
  sendOrderReceived({
    to: email,
    name,
    orderNo: order.name || order.order_number,
    recipient: quiz.recipient,
    occasion: quiz.occasion,
    bundle
  }).catch(e => console.error('[email] receipt', e.message));

  // Kick off lyrics → song
  try {
    await runLyricsStage(orderId);
    await runSongStage(orderId);
  } catch (e) {
    console.error('[orchestrator]', e.message);
    await query(`UPDATE orders SET status='failed', notes=$2 WHERE id=$1`, [orderId, e.message]);
    await logActivity(orderId, 'system', 'pipeline.error', { error: e.message });
  }
}

export default router;
