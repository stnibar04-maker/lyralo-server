-- =========================================================
--  Lyralo automation schema (PostgreSQL 14+)
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----- ADMIN USERS -----
CREATE TABLE IF NOT EXISTS admins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT,
  role            TEXT NOT NULL DEFAULT 'admin',          -- admin | super
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- ----- ORDERS -----
-- One row per Shopify order. JSONB for flexible quiz payload.
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id  BIGINT UNIQUE,                        -- numeric Shopify order id
  shopify_order_no  TEXT,                                  -- e.g. "#1042"
  customer_email    TEXT NOT NULL,
  customer_name     TEXT,
  bundle            TEXT NOT NULL DEFAULT 'single',       -- single | complete
  currency          TEXT NOT NULL DEFAULT 'USD',
  amount_cents      INTEGER NOT NULL DEFAULT 0,
  quiz              JSONB NOT NULL DEFAULT '{}',          -- recipient, occasion, story, traits, genre, mood, name, etc.
  status            TEXT NOT NULL DEFAULT 'lyrics_pending',
  -- lyrics_pending | lyrics_ready | song_generating | awaiting_review | approved | delivered | refunded | failed
  free_revisions    INTEGER NOT NULL DEFAULT 1,           -- granted; complete bundle = 999 (effectively unlimited)
  used_revisions    INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,                                   -- internal admin notes
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_email          ON orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders (created_at DESC);

-- ----- LYRICS -----
-- Each Claude generation = one row. Latest = current.
CREATE TABLE IF NOT EXISTS lyrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL DEFAULT 1,
  title         TEXT,
  content       TEXT NOT NULL,
  prompt_meta   JSONB,                                    -- model, tokens, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lyrics_order ON lyrics (order_id, version DESC);

-- ----- SONGS -----
-- Each Suno generation = one row. is_current marks the chosen take.
CREATE TABLE IF NOT EXISTS songs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  lyrics_id     UUID REFERENCES lyrics(id) ON DELETE SET NULL,
  suno_job_id   TEXT,
  suno_clip_id  TEXT,
  audio_url     TEXT,
  cover_url     TEXT,
  duration_sec  INTEGER,
  genre         TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',           -- queued | generating | ready | failed
  is_current    BOOLEAN NOT NULL DEFAULT FALSE,
  meta          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_songs_order  ON songs (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_songs_status ON songs (status) WHERE status IN ('queued','generating');

-- ----- REVISIONS -----
-- A customer-requested change. Admin must approve before regenerating.
CREATE TABLE IF NOT EXISTS revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  requested_by    TEXT NOT NULL DEFAULT 'customer',      -- customer | admin
  change_type     TEXT NOT NULL DEFAULT 'lyrics',        -- lyrics | vocals | genre | full
  customer_notes  TEXT,
  admin_notes     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected | applied
  is_free         BOOLEAN NOT NULL DEFAULT TRUE,
  decided_by      UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_revisions_order  ON revisions (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_status ON revisions (status);

-- ----- ACTIVITY LOG -----
CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGSERIAL PRIMARY KEY,
  order_id    UUID REFERENCES orders(id) ON DELETE CASCADE,
  actor       TEXT,                                      -- system | admin email | customer
  action      TEXT NOT NULL,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_order ON activity_log (order_id, created_at DESC);

-- ----- WEBHOOK LEDGER (idempotency) -----
CREATE TABLE IF NOT EXISTS webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,                          -- shopify | suno | stripe
  topic           TEXT NOT NULL,
  external_id     TEXT NOT NULL,                          -- e.g. shopify X-Shopify-Webhook-Id
  payload         JSONB NOT NULL,
  processed       BOOLEAN NOT NULL DEFAULT FALSE,
  error           TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_external ON webhook_events (source, external_id);

-- ----- TRIGGER: keep orders.updated_at fresh -----
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_touch ON orders;
CREATE TRIGGER trg_orders_touch BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
