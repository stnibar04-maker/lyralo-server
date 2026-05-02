import crypto from 'node:crypto';

// Verify Shopify webhook HMAC signature.
// Pass the RAW request body (Buffer or string) — not the parsed JSON.
export function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!hmacHeader || !rawBody) return false;
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[shopify] SHOPIFY_WEBHOOK_SECRET not set — webhook rejected');
    return false;
  }
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

// Extract Lyralo quiz answers from a Shopify order payload.
// Shopify can pass them via:
//  1. note_attributes (key/value pairs sent at checkout)
//  2. line_items[].properties (cart-attached props)
//  3. order.note (free-form text)
export function extractQuizFromOrder(order) {
  const out = {};
  const fields = ['recipient', 'occasion', 'name', 'story', 'traits', 'genre', 'mood', 'senderName', 'bundle', 'currency'];

  // 1. note_attributes
  for (const attr of order.note_attributes || []) {
    const k = attr.name?.replace(/^lyralo_/, '');
    if (k && fields.includes(k)) out[k] = attr.value;
  }

  // 2. line_items properties
  for (const li of order.line_items || []) {
    for (const prop of li.properties || []) {
      const k = prop.name?.replace(/^lyralo_/, '');
      if (k && fields.includes(k) && !out[k]) out[k] = prop.value;
    }
  }

  // Bundle inference: line item title contains "complete" or "gift"
  if (!out.bundle) {
    const titles = (order.line_items || []).map(l => (l.title || '').toLowerCase()).join(' ');
    if (titles.includes('complete') || titles.includes('bundle')) out.bundle = 'complete';
    else out.bundle = 'single';
  }

  return out;
}

// Order subtotal in minor units (cents).
export function totalCents(order) {
  const total = parseFloat(order.total_price || order.current_total_price || '0');
  return Math.round(total * 100);
}

// Send a private note to the customer via Shopify Admin API (optional).
export async function appendCustomerNote(orderId, text) {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) return;
  await fetch(`https://${shop}/admin/api/2024-10/orders/${orderId}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: { id: orderId, note: text } })
  });
}
