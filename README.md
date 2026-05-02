# Lyralo Server — Custom Song Automation

> Shopify webhook → Claude (lyrics) → Suno (song) → Admin review → Customer delivery

Backend + admin dashboard + customer order tracking, all in one Express app.
Designed to run on a single VPS so you can host Lyralo + Keitaro tracker + landing pages on the same machine.

---

## What's inside

```
server/
├── server.js              Express entry — mounts webhooks, admin API, customer API, static
├── lib/
│   ├── db.js              Postgres pool wrapper
│   ├── auth.js            Admin login, JWT cookie, bcrypt
│   ├── claude.js          Lyrics generator (Anthropic SDK)
│   ├── suno.js            Suno API wrapper (submit + poll + bundle takes)
│   ├── shopify.js         HMAC verification + quiz extraction
│   ├── email.js           Transactional emails (Resend)
│   └── orchestrator.js    Pipeline coordinator (lyrics → song → review → deliver)
├── routes/
│   ├── webhooks.js        POST /webhooks/shopify/orders/create + /suno
│   ├── admin.js           Admin REST API (orders, revisions, manual controls)
│   └── customer.js        Public customer endpoints (track, request revision)
├── jobs/
│   └── poller.js          Background Suno polling (every 30s)
├── db/
│   ├── schema.sql         Full Postgres schema
│   ├── migrate.js         Apply schema
│   └── seed-admin.js      Create the first admin
├── public/
│   ├── login.html         Admin sign-in page
│   ├── dashboard.html     Admin SPA (orders, revisions, manual controls)
│   └── track.html         Customer "Track Your Order" page
├── Dockerfile             Production container (works on any Docker host)
└── .env.example           All env vars documented
```

---

## How the pipeline works

```
┌─────────────────────┐
│ Shopify checkout    │  Customer fills the quiz (8 steps) → places order
│ (lyralo.com)        │
└──────────┬──────────┘
           │  POST /webhooks/shopify/orders/create  (signed with HMAC)
           ▼
┌─────────────────────┐
│ Lyralo server       │  1. Verify HMAC, store in `orders` table
│ (this code)         │  2. Send "we got it 🎵" email
│                     │  3. Run lyrics stage → Claude API → store lyrics
│                     │  4. Run song stage → Suno API → 1 or 2 takes (depending on bundle)
│                     │  5. Background poller checks Suno every 30s
└──────────┬──────────┘
           │  When all takes ready → status = awaiting_review
           ▼
┌─────────────────────┐
│ /dashboard          │  Admin opens dashboard, listens to song(s)
│ (admin)             │  Click "Approve & deliver" → customer gets delivery email
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ /track              │  Customer listens → can request 1 free revision (or unlimited if Complete Gift)
│ (customer)          │  Revision sits in admin queue → admin approves → loop back to step 4
└─────────────────────┘
```

**Key behavior — bundle awareness**
* `Single Song` ($67) → 1 take, 1 free revision
* `Complete Gift` ($87) → 2 takes (different style each), unlimited revisions
* When admin approves a revision, it regenerates **both takes** for Complete Gift orders.

---

## Deployment — VPS path (recommended if you'll also host Keitaro)

We deploy on a Hetzner VPS using **Coolify** — a free open-source PaaS that gives you the Render/Railway experience on your own server. ~30 minutes total.

### Step 1 — Buy the VPS (5 min)

1. Create a Hetzner Cloud account: https://www.hetzner.com/cloud
2. New project → "Lyralo"
3. Add server with these specs:
   - Image: **Ubuntu 24.04 LTS**
   - Type: **CCX13** (€12.49/mo, 2 dedicated AMD vCPU, 8GB RAM, 80GB NVMe)
   - Location: **Falkenstein (eu-central)** if EU customers, **Ashburn (us-east)** if US-heavy
   - SSH key: upload yours (or click "create key" — Hetzner saves it for you)
   - Name: `lyralo-prod`
4. Click create. You get a public IP (e.g. `5.75.xxx.xxx`).

### Step 2 — Install Coolify (3 min)

SSH into your fresh server:

```bash
ssh root@YOUR_SERVER_IP
```

Then run the Coolify installer:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Wait ~5 min. At the end it prints a URL like `http://YOUR_SERVER_IP:8000`. Open it.
Create your Coolify admin account (email + password).

### Step 3 — Point your domain (5 min)

In your domain registrar (Namecheap/Cloudflare/etc.), create A records:

| Subdomain | Value |
|---|---|
| `app.lyralo.com` | `YOUR_SERVER_IP` (this server) |
| `coolify.lyralo.com` | `YOUR_SERVER_IP` (Coolify UI) |
| `track.lyralo.com` | `YOUR_SERVER_IP` (alias for /track if you want a separate domain) |

### Step 4 — Push this code to a GitHub repo (5 min)

From the project root:

```bash
cd server
git init
git add .
git commit -m "initial commit"
gh repo create lyralo-server --private --source=. --push
```

(or push manually to a new private repo)

### Step 5 — Deploy in Coolify (5 min)

In Coolify UI:

1. **Add a Postgres database**
   - Resources → New → Database → PostgreSQL 16
   - Name: `lyralo-db`
   - Click "Start" — Coolify gives you a connection string. Copy it.

2. **Add the Lyralo app**
   - Resources → New → Application → Public Repository
   - Git URL: `https://github.com/YOUR_USERNAME/lyralo-server`
   - Branch: `main`
   - Build pack: **Dockerfile** (Coolify auto-detects)
   - Domains: `https://app.lyralo.com`
   - Port: `3000`

3. **Add environment variables** (Settings → Environment Variables):
   ```
   NODE_ENV=production
   PORT=3000
   PUBLIC_BASE_URL=https://app.lyralo.com
   DATABASE_URL=postgres://...    ← from step 1
   JWT_SECRET=<generate with: openssl rand -hex 32>
   ANTHROPIC_API_KEY=sk-ant-...
   CLAUDE_MODEL=claude-sonnet-4-6
   SUNO_API_BASE=https://api.sunoapi.org
   SUNO_API_KEY=...
   SUNO_MODEL=V4
   SHOPIFY_WEBHOOK_SECRET=...
   RESEND_API_KEY=re_...
   EMAIL_FROM=Lyralo <hello@lyralo.com>
   ```

4. Click **Deploy**. Coolify will build the Dockerfile and ship it. ~3 min.

### Step 6 — Run the database migration & create your admin (2 min)

In Coolify UI → your app → Terminal (opens a shell INSIDE the running container):

```bash
node db/migrate.js
node db/seed-admin.js admin@lyralo.com YourSuperSecurePassword
```

Done. Visit `https://app.lyralo.com/login` and sign in.

### Step 7 — Wire the Shopify webhook (3 min)

In Shopify admin:
1. **Settings → Notifications → Webhooks** → Create webhook
2. Event: `Order creation`
3. Format: `JSON`
4. URL: `https://app.lyralo.com/webhooks/shopify/orders/create`
5. Save → copy the signing secret → put it in Coolify env vars as `SHOPIFY_WEBHOOK_SECRET` → redeploy.
6. Add a second webhook for `Order cancelled` → `/webhooks/shopify/orders/cancelled` (same secret).

Place a test order on your Shopify store. You should see it appear in `https://app.lyralo.com/dashboard` within 5 seconds.

### Step 8 — (Optional) Install Keitaro on the same VPS

Coolify makes this trivial. Resources → New → Application → Docker image:
- Image: `apache/keitaro` or `keitaroio/tracker:latest`
- Domain: `track.lyralo.com` (or `t.lyralo.com`)
- Coolify auto-handles SSL.

Both Keitaro and Lyralo run on the same machine, behind the same Caddy reverse proxy, with separate domains and SSL certificates.

---

## Alternative — Render (skip the VPS)

If you change your mind and want zero server management:

1. Push the code to GitHub (same as Step 4 above)
2. Render.com → New → **Web Service** → connect repo → Docker → port 3000
3. Add a **Postgres** add-on ($7/mo) → copy DATABASE_URL into env
4. Same env vars as Step 5
5. Deploy. Render gives you `lyralo-server.onrender.com` — point your domain to it.

Cost: ~$14/mo (web $7 + Postgres $7). No VPS, no Coolify, but you can't host Keitaro alongside.

---

## Local development

```bash
cd server
cp .env.example .env       # fill in your local Postgres URL + API keys
npm install
docker run -d --name lyralo-pg -e POSTGRES_PASSWORD=lyralo -e POSTGRES_USER=lyralo -e POSTGRES_DB=lyralo -p 5432:5432 postgres:16
npm run migrate
npm run seed-admin -- admin@lyralo.com password123
npm run dev
```

Open `http://localhost:3000/login`.

---

## Admin dashboard tour

| Page | What you do |
|---|---|
| `/login` | Sign in with the seeded admin |
| `/dashboard` (Orders) | Filter orders by status, search by email/order# |
| Order drawer (click any row) | See quiz brief, lyrics, audio players for both takes, revision history, activity log |
| Quick actions on each order | ↻ Regenerate lyrics+song · ↻ Regenerate song only · ✓ Approve & deliver · + Grant free revision · ✏ Edit notes · 🚦 Override status |
| Revisions queue | Approve (auto-regenerates) or reject (with note emailed to customer) |
| `/track` (public) | Customer enters email → sees songs, downloads MP3, requests revision |

---

## Pipeline statuses

| Status | Meaning |
|---|---|
| `lyrics_pending` | Order received, Claude not yet called |
| `lyrics_ready` | Lyrics saved, Suno not yet called |
| `song_generating` | Suno job(s) submitted, polling every 30s |
| `awaiting_review` | All takes ready, waiting for admin to approve |
| `delivered` | Email sent to customer with download links |
| `failed` | Something broke — check `notes` field and `activity_log` |
| `refunded` | Order cancelled in Shopify |

---

## Manual operations cheat sheet

```bash
# View logs in Coolify
# UI → your app → Logs (live tail)

# Connect to Postgres
# UI → Postgres database → Terminal → psql

# Force Suno poll right now
curl -X POST -H "Cookie: lyralo_admin=YOUR_JWT" https://app.lyralo.com/api/admin/poll

# Grant 3 free revisions to a customer
curl -X POST https://app.lyralo.com/api/admin/orders/ORDER_UUID/grant-revision \
  -H "Cookie: lyralo_admin=YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"count":3,"reason":"VIP customer"}'
```

(Or just use the dashboard — these are all 1-click buttons.)

---

## Cost breakdown (monthly)

| Item | Cost |
|---|---|
| Hetzner CCX13 VPS | €12.49 |
| Domain (lyralo.com) | $1 |
| Anthropic API (~$0.02 per song with Sonnet 4.6) | $20–60 |
| Suno API (~$0.10–0.30 per song depending on provider) | $50–200 |
| Resend (3k emails free, then $20/mo for 50k) | $0–20 |
| **Total at 100 orders/mo** | **~$100** |
| **Total at 1000 orders/mo** | **~$400** |

At $87/order Complete Gift average, your COGS is <$1 per order. Margins ~95%.

---

## Common issues

**"Webhook returns 401 invalid hmac"** — the SHOPIFY_WEBHOOK_SECRET env var doesn't match what Shopify sends. Re-copy from Shopify admin → Notifications → Webhooks → top of page.

**Songs stuck in `song_generating`** — Suno provider may have changed their API shape. Check `lib/suno.js` `getStatus()` parser. Click "⚡ Poll Suno now" in dashboard to force-check.

**Claude returns invalid JSON** — increase `max_tokens` in `lib/claude.js`. Lower `temperature` to 0.7 if it gets too creative.

**Customer can't see their order on /track** — they used a different email at checkout than what we have. Check the `customer_email` column in `orders` table.

---

## Roadmap (post-MVP)

- [ ] Stripe subscription for "Lyralo Pro" (unlimited revisions monthly plan)
- [ ] Multi-admin roles (writer / producer / support) with permissions
- [ ] Audit log export to CSV
- [ ] Public song embed widget (for customer social shares)
- [ ] WhatsApp/SMS delivery option (Twilio)
- [ ] Multi-language lyrics (FR, ES, DE prompts)
