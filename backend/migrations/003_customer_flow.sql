-- ReviewBoost customer flow v1
--
-- The five anonymous endpoints under /api/v1/public/q/:token.
--
-- REVIEW INTEGRITY
-- ----------------
-- Nothing here stores, reads, or derives a rating threshold. Every rating from
-- 1 to 5 is stored in `customer_responses`, and the public Google opportunity
-- is a property of the business, never of the rating. The private note and Team
-- Praise paths are strictly additive.
--
-- HOW AN ANONYMOUS CUSTOMER WRITES INTO A TENANT
-- ----------------------------------------------
-- The customer has no session, so there is no tenant context, so Row Level
-- Security cannot be satisfied by the caller. The obvious answer — SECURITY
-- DEFINER functions — does not work here: every tenant table is declared FORCE
-- ROW LEVEL SECURITY, which is what makes the policies apply to the table owner
-- as well, and the owner is the role that would define those functions. A
-- definer function would therefore be subject to the same policy it is trying
-- to satisfy and would silently write nothing.
--
-- Instead the server derives the tenant from the stand token and then binds it,
-- in two steps inside one transaction:
--
--   1. Bind `app.public_stand_token` to the token from the URL. The narrow
--      SELECT policy below then exposes exactly one stand row — the one whose
--      token the caller already holds. Stands cannot be enumerated, and this is
--      only reachable when no tenant context is set.
--
--   2. Read `account_id` from that row and bind `app.current_account_id`. Every
--      subsequent statement runs under ordinary tenant RLS.
--
-- The client never supplies a tenant and cannot influence one: an account id in
-- the request body is ignored, because the only input to step 1 is the token.
--
-- OPAQUE IDENTIFIERS
-- ------------------
-- `sessionId` and `responseId` on the wire are 32 bytes of entropy stored only
-- as a keyed HMAC. A database disclosure does not hand an attacker usable
-- capability tokens, and no internal UUID is ever public.

-- Referenced by composite key below, so tenant consistency is enforced by the
-- database rather than by the application remembering to check it.
ALTER TABLE qr_stands ADD CONSTRAINT qr_stands_id_account_key UNIQUE (id, account_id);

-- --------------------------------------------------------- sessions --------

CREATE TABLE public_review_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    stand_id            UUID NOT NULL,
    -- Keyed HMAC of the opaque token handed to the customer. Never the token.
    session_token_hash  TEXT NOT NULL UNIQUE,
    locale              TEXT NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'),
    -- Keyed hash of coarse network and device data, for short-term abuse
    -- prevention only. Never a raw address, and never customer identity.
    client_hash         TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT public_review_sessions_id_account_key UNIQUE (id, account_id),
    CONSTRAINT public_review_sessions_stand_fk
        FOREIGN KEY (stand_id, account_id) REFERENCES qr_stands(id, account_id) ON DELETE CASCADE
);

CREATE INDEX idx_public_sessions_account_time ON public_review_sessions(account_id, created_at DESC);
CREATE INDEX idx_public_sessions_stand_time ON public_review_sessions(stand_id, created_at DESC);
CREATE INDEX idx_public_sessions_expiry ON public_review_sessions(expires_at);

-- ------------------------------------------------ customer responses -------

CREATE TABLE customer_responses (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    stand_id              UUID NOT NULL,
    session_id            UUID NOT NULL,
    response_token_hash   TEXT NOT NULL UNIQUE,
    -- Every rating is stored. 4 and 5 are not conversions that skip storage,
    -- and 1 to 3 are not diverted anywhere.
    rating                SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    -- Optional for every rating. AES-256-GCM at rest.
    note_encrypted        TEXT,
    note_key_version      SMALLINT NOT NULL DEFAULT 1,
    submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at               TIMESTAMPTZ,
    resolved_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One logical response per session.
    CONSTRAINT customer_responses_session_key UNIQUE (session_id),
    CONSTRAINT customer_responses_id_account_key UNIQUE (id, account_id),
    CONSTRAINT customer_responses_stand_fk
        FOREIGN KEY (stand_id, account_id) REFERENCES qr_stands(id, account_id) ON DELETE CASCADE,
    CONSTRAINT customer_responses_session_fk
        FOREIGN KEY (session_id, account_id)
        REFERENCES public_review_sessions(id, account_id) ON DELETE CASCADE
);

CREATE INDEX idx_customer_responses_account_time ON customer_responses(account_id, submitted_at DESC);
CREATE INDEX idx_customer_responses_stand_time ON customer_responses(stand_id, submitted_at DESC);
CREATE INDEX idx_customer_responses_unread ON customer_responses(account_id, submitted_at DESC)
    WHERE read_at IS NULL;

-- --------------------------------------------- google opportunity ----------

-- Records that the public Google action was *selected*. It has never meant, and
-- must never be reported as meaning, that a review was written, submitted, or
-- published, or that a rating changed on Google. ReviewBoost cannot observe any
-- of those things.
CREATE TABLE google_review_clicks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    response_id  UUID NOT NULL,
    clicked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT google_review_clicks_response_key UNIQUE (response_id),
    CONSTRAINT google_review_clicks_response_fk
        FOREIGN KEY (response_id, account_id)
        REFERENCES customer_responses(id, account_id) ON DELETE CASCADE
);

CREATE INDEX idx_google_clicks_account_time ON google_review_clicks(account_id, clicked_at DESC);

-- ------------------------------------------------------ team praise --------

-- Deliberately carries no rating column and no Google state. The owner decides
-- recognition without seeing the star rating that happened to accompany it.
CREATE TABLE team_praise_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id              UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    stand_id                UUID NOT NULL,
    response_id             UUID NOT NULL,
    first_name_encrypted    TEXT NOT NULL,
    praise_note_encrypted   TEXT,
    encryption_key_version  SMALLINT NOT NULL DEFAULT 1,
    -- Matching is a later phase and is always a human decision. ReviewBoost
    -- never guesses which employee the customer meant.
    status                  TEXT NOT NULL DEFAULT 'unmatched' CHECK (status = 'unmatched'),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT team_praise_response_key UNIQUE (response_id),
    CONSTRAINT team_praise_stand_fk
        FOREIGN KEY (stand_id, account_id) REFERENCES qr_stands(id, account_id) ON DELETE CASCADE,
    CONSTRAINT team_praise_response_fk
        FOREIGN KEY (response_id, account_id)
        REFERENCES customer_responses(id, account_id) ON DELETE CASCADE
);

CREATE INDEX idx_team_praise_account_time ON team_praise_records(account_id, created_at DESC);
CREATE INDEX idx_team_praise_unmatched ON team_praise_records(account_id, created_at DESC)
    WHERE status = 'unmatched';

-- ----------------------------------------------------- idempotency ---------

CREATE TABLE idempotency_records (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id               UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    -- The anonymous capability scope: one public stand token. Keys issued for
    -- one business can therefore never collide with another's.
    scope                    TEXT NOT NULL,
    operation                TEXT NOT NULL,
    method                   TEXT NOT NULL,
    route                    TEXT NOT NULL,
    -- Keyed HMAC of the client's Idempotency-Key. The raw key is never stored.
    key_hash                 TEXT NOT NULL,
    -- Keyed HMAC of the canonical request body. A retry carrying different data
    -- is a conflict, not a replay.
    request_hash             TEXT NOT NULL,
    state                    TEXT NOT NULL DEFAULT 'in_progress'
                             CHECK (state IN ('in_progress', 'completed')),
    response_status          SMALLINT,
    -- Encrypted, because the replayed body carries the opaque session and
    -- response capability tokens that are hashed everywhere else.
    response_body_encrypted  TEXT,
    claimed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at             TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at               TIMESTAMPTZ NOT NULL,

    CONSTRAINT idempotency_scope_operation_key UNIQUE (scope, operation, key_hash),
    CONSTRAINT idempotency_completed_has_status
        CHECK (state <> 'completed' OR response_status IS NOT NULL)
);

CREATE INDEX idx_idempotency_expiry ON idempotency_records(expires_at);
CREATE INDEX idx_idempotency_account ON idempotency_records(account_id, created_at DESC);

-- ------------------------------------------------ row level security -------

DO $$
DECLARE
    tenant_table TEXT;
BEGIN
    FOREACH tenant_table IN ARRAY ARRAY[
        'public_review_sessions', 'customer_responses', 'google_review_clicks',
        'team_praise_records', 'idempotency_records'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
        -- FORCE is what makes the policy apply to the table owner, which is the
        -- role the application connects as. Without it every policy below is
        -- silently inert and the schema isolates nothing.
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL
               USING (account_id = current_account_id())
               WITH CHECK (account_id = current_account_id())',
            tenant_table || '_tenant_isolation', tenant_table
        );
    END LOOP;
END $$;

/**
 * The public bootstrap.
 *
 * Exposes exactly one stand: the active one whose public token the caller has
 * already bound to `app.public_stand_token`. It cannot be used to enumerate,
 * because the token is the lookup key and 16 bytes of entropy is not guessable,
 * and it is unreachable once a tenant context exists — an authenticated request
 * always has `app.current_account_id` set, so this policy contributes nothing
 * to it.
 *
 * SELECT only. The public path never writes to `qr_stands`.
 */
CREATE POLICY qr_stands_public_token_lookup ON qr_stands FOR SELECT
    USING (
        current_account_id() IS NULL
        AND is_active
        AND public_id = NULLIF(current_setting('app.public_stand_token', true), '')
    );

/**
 * Retention.
 *
 * The purge job runs with no tenant context, so it needs a way through the
 * isolation policy. Rather than granting a blanket bypass, these permit exactly
 * the two retention operations and nothing else, and only when no tenant
 * context is set — a tenant-scoped request gains nothing from them.
 *
 * Sessions are *not* deleted. A session row is the scan record a business paid
 * for, and `customer_responses` cascades from it, so deleting one would destroy
 * business history to expire a hash. Only the short-lived network hash is
 * scrubbed; the WITH CHECK is what forces the update to be a scrub rather than
 * an arbitrary edit.
 */
CREATE POLICY public_review_sessions_scrub ON public_review_sessions FOR UPDATE
    USING (
        current_account_id() IS NULL
        AND client_hash IS NOT NULL
        AND created_at <= now() - INTERVAL '7 days'
    )
    WITH CHECK (current_account_id() IS NULL AND client_hash IS NULL);

CREATE POLICY idempotency_records_retention ON idempotency_records FOR DELETE
    USING (current_account_id() IS NULL AND expires_at <= now());
