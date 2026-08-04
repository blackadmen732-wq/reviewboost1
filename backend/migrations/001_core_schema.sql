-- ReviewBoost core schema
--
-- TENANCY MODEL
-- -------------
-- `accounts` is the tenant. Users join accounts through `account_members`,
-- which carries the role. Every table holding customer data has an `account_id`
-- and is protected by Row Level Security keyed on the `app.current_account_id`
-- setting, which src/db/pool.js binds per transaction.
--
-- Two details here are load-bearing and easy to get wrong:
--
--   1. RLS is declared FORCE. PostgreSQL exempts the table *owner* from row
--      security by default, and managed Postgres hands you an owner role — so
--      without FORCE every policy below is silently inert. The schema would
--      look correct and isolate nothing.
--
--   2. Auth and billing tables are deliberately NOT under RLS. They must be
--      readable before a tenant context exists (login) or entirely outside one
--      (Stripe webhooks). A policy of `id = current_account_id()` on `accounts`
--      makes login impossible. Those tables are scoped explicitly in the
--      repository layer instead, and that layer never relies on RLS.
--
-- Provider callbacks arrive with no tenant context at all. Rather than
-- loosening the policies, they go through SECURITY DEFINER functions that
-- derive the tenant from the row they touch and can affect exactly one.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- enums ----

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TYPE subscription_status AS ENUM (
    'trialing', 'active', 'past_due', 'canceled', 'incomplete'
);

CREATE TYPE campaign_status AS ENUM (
    'draft', 'queued', 'running', 'paused', 'completed', 'failed', 'canceled'
);

CREATE TYPE message_status AS ENUM (
    'pending', 'queued', 'sent', 'delivered', 'failed', 'suppressed', 'duplicate'
);

-- ------------------------------------------------------- tenancy + auth ----

CREATE TABLE accounts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name         TEXT NOT NULL CHECK (length(business_name) BETWEEN 1 AND 120),
    slug                  TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,63}$'),
    google_review_url     TEXT NOT NULL,
    timezone              TEXT NOT NULL DEFAULT 'UTC',
    -- Opt-in per-account IP restriction. Enforced in the application, which
    -- refuses to enable it unless the caller's own address is already covered.
    ip_allowlist_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- citext so 'Sam@x.com' and 'sam@x.com' are one account. Deliberately no
    -- Gmail-style dot stripping: that collapses genuinely distinct addresses.
    email               CITEXT UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    full_name           TEXT,
    email_verified_at   TIMESTAMPTZ,
    last_login_at       TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Bumping this retires every access token issued earlier. It is how logout
    -- everywhere and a password change take effect before token expiry.
    token_version       INTEGER NOT NULL DEFAULT 0,
    -- Brute-force lockout, keyed on the target account rather than the caller,
    -- so a distributed attack across many addresses still trips it.
    locked_until        TIMESTAMPTZ,
    failed_login_count  INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        user_role NOT NULL DEFAULT 'member',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, user_id)
);

CREATE TABLE refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- Only the HMAC is stored. A database disclosure must not yield usable
    -- sessions.
    token_hash    TEXT UNIQUE NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    -- Set when this token is exchanged, so replay of a rotated token is
    -- detectable and can revoke the whole family.
    replaced_by   UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    user_agent    TEXT,
    ip_hash       TEXT,
    device_label  TEXT,
    approximate_location TEXT,
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_members_user ON account_members(user_id);
CREATE INDEX idx_account_members_account ON account_members(account_id);
CREATE INDEX idx_refresh_tokens_active ON refresh_tokens(user_id, last_used_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_expiry ON refresh_tokens(expires_at)
    WHERE revoked_at IS NULL;

-- -------------------------------------------------------------- billing ----

CREATE TABLE billing_subscriptions (
    account_id              UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    stripe_customer_id      TEXT UNIQUE,
    stripe_subscription_id  TEXT UNIQUE,
    status                  subscription_status NOT NULL DEFAULT 'trialing',
    plan                    TEXT NOT NULL DEFAULT 'starter',
    monthly_sms_allowance   INTEGER NOT NULL DEFAULT 500 CHECK (monthly_sms_allowance >= 0),
    trial_ends_at           TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_by_subscription ON billing_subscriptions(stripe_subscription_id);
CREATE INDEX idx_billing_by_customer ON billing_subscriptions(stripe_customer_id);

-- Stripe delivers webhooks at least once. Claiming the event id here makes
-- handling exactly once.
CREATE TABLE stripe_events (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same idea for Twilio status callbacks, which also retry and arrive
-- out of order.
CREATE TABLE provider_webhook_events (
    id            TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------- tenant data ----
-- All PII below is AES-256-GCM ciphertext in the form "v1:iv:tag:data".
-- The *_lookup columns hold keyed HMACs, which allow indexed equality search
-- without storing plaintext. A bare digest would not do: phone numbers and
-- IPv4 addresses have far too little entropy to resist brute force.

CREATE TABLE contacts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone_encrypted  TEXT NOT NULL,
    phone_lookup     TEXT NOT NULL,
    name_encrypted   TEXT,
    email_encrypted  TEXT,
    -- TCPA: we must be able to prove consent, and when it was given.
    consent          BOOLEAN NOT NULL DEFAULT FALSE,
    consent_source   TEXT,
    consent_at       TIMESTAMPTZ,
    timezone         TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, phone_lookup)
);

CREATE TABLE suppressions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone_lookup  TEXT NOT NULL,
    reason        TEXT NOT NULL DEFAULT 'stop_keyword',
    source        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, phone_lookup)
);

CREATE TABLE campaigns (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    message_template      TEXT NOT NULL,
    review_link           TEXT NOT NULL,
    status                campaign_status NOT NULL DEFAULT 'draft',
    total_recipients      INTEGER NOT NULL DEFAULT 0,
    sent_count            INTEGER NOT NULL DEFAULT 0,
    delivered_count       INTEGER NOT NULL DEFAULT 0,
    failed_count          INTEGER NOT NULL DEFAULT 0,
    suppressed_count      INTEGER NOT NULL DEFAULT 0,
    estimated_cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_cents >= 0),
    scheduled_at          TIMESTAMPTZ,
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    campaign_id      UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
    phone_encrypted  TEXT NOT NULL,
    phone_lookup     TEXT NOT NULL,
    body_encrypted   TEXT NOT NULL,
    provider_sid     TEXT UNIQUE,
    status           message_status NOT NULL DEFAULT 'pending',
    -- Money is always an integer count of cents. Never a float, anywhere.
    segment_count    INTEGER NOT NULL DEFAULT 1 CHECK (segment_count >= 0),
    cost_in_cents    INTEGER NOT NULL DEFAULT 0 CHECK (cost_in_cents >= 0),
    encoding         TEXT,
    error_code       TEXT,
    error_message    TEXT,
    sent_at          TIMESTAMPTZ,
    delivered_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supports the duplicate-protection lookup, which asks "have we messaged this
-- number for this account inside the dedupe window?"
CREATE INDEX idx_messages_dedupe ON messages(account_id, phone_lookup, created_at DESC);
CREATE INDEX idx_messages_campaign ON messages(campaign_id, status);
CREATE INDEX idx_messages_account_created ON messages(account_id, created_at DESC);
CREATE INDEX idx_messages_pending ON messages(status) WHERE status IN ('queued', 'sent');
CREATE INDEX idx_contacts_account ON contacts(account_id, created_at DESC);
CREATE INDEX idx_campaigns_account ON campaigns(account_id, created_at DESC);
CREATE INDEX idx_suppressions_lookup ON suppressions(account_id, phone_lookup);

-- ------------------------------------------------------------- QR / NFC ----

CREATE TABLE qr_stands (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- Public, unguessable identifier used in /q/:publicId. Kept separate from
    -- the primary key so internal ids are never exposed and stands cannot be
    -- enumerated.
    public_id         TEXT UNIQUE NOT NULL,
    label             TEXT NOT NULL DEFAULT 'Front Desk',
    destination_url   TEXT,
    primary_color     TEXT NOT NULL DEFAULT '#111827' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
    background_color  TEXT NOT NULL DEFAULT '#FFFFFF' CHECK (background_color ~ '^#[0-9A-Fa-f]{6}$'),
    -- Ratings at or above this go to Google; below it are intercepted.
    review_threshold  SMALLINT NOT NULL DEFAULT 4 CHECK (review_threshold BETWEEN 1 AND 5),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    scans_count       INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE qr_scans (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    stand_id     UUID NOT NULL REFERENCES qr_stands(id) ON DELETE CASCADE,
    -- Keyed HMAC of the client address. An unsalted digest of an IPv4 address
    -- is reversible by exhausting a 2^32 space in seconds.
    ip_hash      TEXT NOT NULL,
    user_agent   TEXT,
    device_type  TEXT,
    country      TEXT,
    converted    BOOLEAN NOT NULL DEFAULT FALSE,
    scanned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE private_feedback (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    stand_id            UUID REFERENCES qr_stands(id) ON DELETE SET NULL,
    rating              SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback_encrypted  TEXT NOT NULL,
    phone_encrypted     TEXT,
    email_encrypted     TEXT,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qr_stands_account ON qr_stands(account_id) WHERE is_active;
CREATE INDEX idx_qr_scans_account_time ON qr_scans(account_id, scanned_at DESC);
CREATE INDEX idx_qr_scans_stand_time ON qr_scans(stand_id, scanned_at DESC);
-- Serves the dedupe probe on the hot public scan path.
CREATE INDEX idx_qr_scans_dedupe ON qr_scans(stand_id, ip_hash, scanned_at DESC);
CREATE INDEX idx_private_feedback_account ON private_feedback(account_id, created_at DESC);

-- ----------------------------------------------------- usage + audit log ---

CREATE TABLE usage_daily (
    account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    usage_date     DATE NOT NULL,
    messages_sent  INTEGER NOT NULL DEFAULT 0,
    segments_sent  INTEGER NOT NULL DEFAULT 0,
    cost_in_cents  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, usage_date)
);

CREATE TABLE audit_events (
    id             BIGSERIAL PRIMARY KEY,
    account_id     UUID REFERENCES accounts(id) ON DELETE CASCADE,
    actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    action         TEXT NOT NULL,
    target_type    TEXT,
    target_id      TEXT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_hash        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_account_time ON audit_events(account_id, created_at DESC);

-- Optional per-account network restriction, consulted by ip_is_allowed below.
-- Not under RLS: the check runs before a tenant context exists on some paths.
CREATE TABLE account_ip_allowlist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    cidr        CIDR NOT NULL,
    label       TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, cidr)
);

CREATE INDEX idx_ip_allowlist_account ON account_ip_allowlist(account_id);

-- -------------------------------------------------- row level security -----

CREATE OR REPLACE FUNCTION current_account_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_account_id', true), '')::UUID;
$$;

DO $$
DECLARE
    tenant_table TEXT;
BEGIN
    FOREACH tenant_table IN ARRAY ARRAY[
        'contacts', 'suppressions', 'campaigns', 'messages',
        'qr_stands', 'qr_scans', 'private_feedback', 'usage_daily', 'audit_events'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
        -- FORCE is what makes the policy apply to the table owner as well,
        -- which is the role the application actually connects as.
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL
               USING (account_id = current_account_id())
               WITH CHECK (account_id = current_account_id())',
            tenant_table || '_tenant_isolation', tenant_table
        );
    END LOOP;
END $$;

-- ------------------------------------------- security definer functions ----
-- Everything below runs as the definer so the public, uncredentialed paths can
-- touch exactly one row without any tenant context and without weakening the
-- policies above.

/** Apply a delivery status update from a Twilio callback. */
CREATE OR REPLACE FUNCTION record_delivery_status(
    p_provider_sid  TEXT,
    p_status        message_status,
    p_error_code    TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    updated_account UUID;
BEGIN
    UPDATE messages
       SET status        = p_status,
           error_code    = COALESCE(p_error_code, error_code),
           error_message = COALESCE(p_error_message, error_message),
           delivered_at  = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
           updated_at    = now()
     WHERE provider_sid = p_provider_sid
     RETURNING account_id INTO updated_account;

    RETURN updated_account;
END $$;

/** Suppress a recipient who replied STOP, resolved from the message thread. */
CREATE OR REPLACE FUNCTION suppress_contact_by_provider(
    p_provider_sid TEXT,
    p_reason       TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    target_account UUID;
    target_lookup  TEXT;
BEGIN
    SELECT account_id, phone_lookup INTO target_account, target_lookup
      FROM messages WHERE provider_sid = p_provider_sid;

    IF target_account IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO suppressions (account_id, phone_lookup, reason, source)
    VALUES (target_account, target_lookup, p_reason, 'inbound_sms')
    ON CONFLICT (account_id, phone_lookup) DO NOTHING;

    RETURN target_account;
END $$;

/**
 * Atomically reserve monthly quota.
 *
 * Locks the subscription row so two concurrent campaigns cannot both pass a
 * check-then-act test and jointly exceed the plan allowance.
 */
CREATE OR REPLACE FUNCTION reserve_message_quota(
    p_account_id UUID,
    p_count      INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    allowance INTEGER;
    used      INTEGER;
BEGIN
    IF p_count <= 0 THEN
        RAISE EXCEPTION 'invalid_quota_request';
    END IF;

    SELECT monthly_sms_allowance INTO allowance
      FROM billing_subscriptions WHERE account_id = p_account_id FOR UPDATE;

    IF allowance IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT COALESCE(SUM(messages_sent), 0) INTO used
      FROM usage_daily
     WHERE account_id = p_account_id
       AND usage_date >= date_trunc('month', CURRENT_DATE);

    IF used + p_count > allowance THEN
        RETURN FALSE;
    END IF;

    INSERT INTO usage_daily (account_id, usage_date, messages_sent)
    VALUES (p_account_id, CURRENT_DATE, p_count)
    ON CONFLICT (account_id, usage_date)
    DO UPDATE SET messages_sent = usage_daily.messages_sent + EXCLUDED.messages_sent;

    RETURN TRUE;
END $$;

CREATE OR REPLACE FUNCTION record_usage_cost(
    p_account_id UUID,
    p_segments   INTEGER,
    p_cents      INTEGER
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO usage_daily (account_id, usage_date, segments_sent, cost_in_cents)
    VALUES (p_account_id, CURRENT_DATE, p_segments, p_cents)
    ON CONFLICT (account_id, usage_date) DO UPDATE
       SET segments_sent = usage_daily.segments_sent + EXCLUDED.segments_sent,
           cost_in_cents = usage_daily.cost_in_cents + EXCLUDED.cost_in_cents;
END $$;

/**
 * Record a QR scan, deduplicated by hashed address inside a short window.
 *
 * The insert and the existence check are one statement, so two simultaneous
 * scans cannot both pass a separate check and double-count.
 */
CREATE OR REPLACE FUNCTION register_scan(
    p_stand_id      UUID,
    p_ip_hash       TEXT,
    p_user_agent    TEXT,
    p_device_type   TEXT,
    p_dedupe_window INTERVAL DEFAULT '30 seconds'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    stand_account UUID;
    inserted      BOOLEAN := FALSE;
BEGIN
    SELECT account_id INTO stand_account FROM qr_stands WHERE id = p_stand_id AND is_active;
    IF stand_account IS NULL THEN
        RETURN FALSE;
    END IF;

    INSERT INTO qr_scans (account_id, stand_id, ip_hash, user_agent, device_type)
    SELECT stand_account, p_stand_id, p_ip_hash, left(p_user_agent, 400), p_device_type
     WHERE NOT EXISTS (
        SELECT 1 FROM qr_scans
         WHERE stand_id = p_stand_id
           AND ip_hash = p_ip_hash
           AND scanned_at > now() - p_dedupe_window
     );

    GET DIAGNOSTICS inserted = ROW_COUNT;

    IF inserted THEN
        UPDATE qr_stands SET scans_count = scans_count + 1 WHERE id = p_stand_id;
    END IF;

    RETURN inserted;
END $$;

/**
 * Store intercepted low-rating feedback.
 *
 * The tenant is derived from the stand. The public endpoint never accepts an
 * account id from the client — doing so would let anyone who scanned a code
 * write unlimited fake feedback into that tenant.
 */
CREATE OR REPLACE FUNCTION submit_private_feedback(
    p_stand_id           UUID,
    p_rating             SMALLINT,
    p_feedback_encrypted TEXT,
    p_phone_encrypted    TEXT DEFAULT NULL,
    p_email_encrypted    TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    stand_account UUID;
    feedback_id   UUID;
BEGIN
    SELECT account_id INTO stand_account FROM qr_stands WHERE id = p_stand_id AND is_active;
    IF stand_account IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO private_feedback
        (account_id, stand_id, rating, feedback_encrypted, phone_encrypted, email_encrypted)
    VALUES
        (stand_account, p_stand_id, p_rating, p_feedback_encrypted,
         p_phone_encrypted, p_email_encrypted)
    RETURNING id INTO feedback_id;

    UPDATE qr_scans SET converted = TRUE
     WHERE id = (
        SELECT id FROM qr_scans
         WHERE stand_id = p_stand_id
         ORDER BY scanned_at DESC
         LIMIT 1
     );

    RETURN feedback_id;
END $$;

/** Is this address permitted for the account? An empty list allows everything. */
CREATE OR REPLACE FUNCTION ip_is_allowed(
    p_account_id UUID,
    p_ip         INET
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    enabled BOOLEAN;
    entries INTEGER;
BEGIN
    SELECT ip_allowlist_enabled INTO enabled FROM accounts WHERE id = p_account_id;
    IF NOT COALESCE(enabled, FALSE) THEN
        RETURN TRUE;
    END IF;

    SELECT COUNT(*)::INTEGER INTO entries
      FROM account_ip_allowlist WHERE account_id = p_account_id;

    -- Fail open on an empty list: enabling the feature with no entries would
    -- otherwise lock the owner out of their own account with no way back in.
    IF entries = 0 THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM account_ip_allowlist
         WHERE account_id = p_account_id AND p_ip << cidr
    );
END $$;

REVOKE ALL ON FUNCTION record_delivery_status(TEXT, message_status, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION suppress_contact_by_provider(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_message_quota(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_usage_cost(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_scan(UUID, TEXT, TEXT, TEXT, INTERVAL) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_private_feedback(UUID, SMALLINT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ip_is_allowed(UUID, INET) FROM PUBLIC;

-- ---------------------------------------------------------- updated_at -----

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;

CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER messages_touch BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
