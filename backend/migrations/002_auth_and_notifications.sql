-- Authentication support: verification tokens, MFA, brute-force controls,
-- device recognition, and the transactional email outbox.
--
-- None of these tables are under RLS. They are keyed on user rather than
-- account and must be readable before a tenant context exists — during login,
-- during a password reset, and from the maintenance job. They are scoped
-- explicitly in the repository layer instead.

-- ---------------------------------------------- verification + reset -------

CREATE TYPE user_token_purpose AS ENUM ('email_verification', 'password_reset');

CREATE TABLE user_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose      user_token_purpose NOT NULL,
    -- Only the HMAC is stored, so a database disclosure cannot be replayed
    -- against the reset flow.
    token_hash   TEXT UNIQUE NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_tokens_pending ON user_tokens(user_id, purpose)
    WHERE consumed_at IS NULL;
CREATE INDEX idx_user_tokens_expiry ON user_tokens(expires_at)
    WHERE consumed_at IS NULL;

-- --------------------------------------------------------------- MFA -------

CREATE TABLE user_mfa (
    user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- TOTP shared secret, AES-256-GCM encrypted. It is equivalent to a
    -- password: anyone holding it can mint valid codes forever.
    secret_encrypted      TEXT NOT NULL,
    -- Set only once the user proves they can generate a valid code, so a
    -- mistyped setup cannot lock them out of their own account.
    confirmed_at          TIMESTAMPTZ,
    recovery_code_hashes  TEXT[] NOT NULL DEFAULT '{}',
    recovery_codes_used   INTEGER NOT NULL DEFAULT 0,
    -- Blocks replay: a TOTP code is valid for a ~30s step, and the same step
    -- must never be accepted twice.
    last_used_step        BIGINT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------- brute-force controls ----

-- Lockout is keyed on the *target account*, not the caller. Rate limiting by
-- IP is defeated by a botnet; counting failures per email is not.
CREATE TABLE login_attempts (
    id            BIGSERIAL PRIMARY KEY,
    email         CITEXT NOT NULL,
    ip_hash       TEXT,
    succeeded     BOOLEAN NOT NULL,
    attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_attempts_recent ON login_attempts(email, attempted_at DESC)
    WHERE NOT succeeded;
CREATE INDEX idx_login_attempts_cleanup ON login_attempts(attempted_at);

-- Signup cannot be throttled by email — an attacker varies it freely. Only a
-- per-source cap bounds automated account creation.
CREATE TABLE registration_attempts (
    id            BIGSERIAL PRIMARY KEY,
    ip_hash       TEXT NOT NULL,
    attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_registration_attempts ON registration_attempts(ip_hash, attempted_at DESC);

-- --------------------------------------- activity log + known devices ------

-- Distinct from audit_events, which records business actions. This records
-- authentication events, so a user can answer "who signed in, from where".
CREATE TABLE security_events (
    id                    BIGSERIAL PRIMARY KEY,
    user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
    account_id            UUID REFERENCES accounts(id) ON DELETE CASCADE,
    event_type            TEXT NOT NULL,
    ip_hash               TEXT,
    device_label          TEXT,
    user_agent            TEXT,
    approximate_location  TEXT,
    succeeded             BOOLEAN NOT NULL DEFAULT TRUE,
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_security_events_user ON security_events(user_id, created_at DESC);
CREATE INDEX idx_security_events_cleanup ON security_events(created_at);

-- Lets a sign-in from an unrecognised device be detected and emailed about,
-- which is the earliest signal a user gets that someone has their password.
CREATE TABLE known_devices (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- HMAC of (browser family + platform + network), never raw values.
    fingerprint    TEXT NOT NULL,
    device_label   TEXT,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, fingerprint)
);

-- ------------------------------------------------------- email outbox ------

-- Queued rather than sent inline, so a slow or failing provider can never
-- block a password change, and every send is retryable and auditable.
CREATE TABLE email_outbox (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    to_encrypted  TEXT NOT NULL,
    template      TEXT NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    sent_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_outbox_pending ON email_outbox(created_at) WHERE status = 'pending';

-- ---------------------------------------------------------- functions ------

/**
 * Record a login outcome and report whether the account is now locked.
 *
 * Counting and locking are one statement so two concurrent attempts cannot
 * both read a stale count and slip past the threshold.
 */
CREATE OR REPLACE FUNCTION record_login_attempt(
    p_email      CITEXT,
    p_ip_hash    TEXT,
    p_succeeded  BOOLEAN,
    p_threshold  INTEGER DEFAULT 10,
    p_lock_mins  INTEGER DEFAULT 15
) RETURNS TABLE (locked BOOLEAN, locked_until TIMESTAMPTZ, recent_failures INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    failures INTEGER;
    lock_at  TIMESTAMPTZ;
BEGIN
    INSERT INTO login_attempts (email, ip_hash, succeeded)
    VALUES (p_email, p_ip_hash, p_succeeded);

    IF p_succeeded THEN
        UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = p_email;
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, 0;
        RETURN;
    END IF;

    SELECT COUNT(*)::INTEGER INTO failures
      FROM login_attempts
     WHERE email = p_email
       AND NOT succeeded
       AND attempted_at > now() - make_interval(mins => p_lock_mins);

    IF failures >= p_threshold THEN
        lock_at := now() + make_interval(mins => p_lock_mins);
        UPDATE users SET locked_until = lock_at, failed_login_count = failures
         WHERE email = p_email;
        RETURN QUERY SELECT TRUE, lock_at, failures;
    ELSE
        UPDATE users SET failed_login_count = failures WHERE email = p_email;
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ, failures;
    END IF;
END $$;

/** Bounded account creation per source address. */
CREATE OR REPLACE FUNCTION check_registration_rate(
    p_ip_hash   TEXT,
    p_max       INTEGER DEFAULT 5,
    p_window_h  INTEGER DEFAULT 1
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    recent INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER INTO recent
      FROM registration_attempts
     WHERE ip_hash = p_ip_hash
       AND attempted_at > now() - make_interval(hours => p_window_h);

    IF recent >= p_max THEN
        RETURN FALSE;
    END IF;

    INSERT INTO registration_attempts (ip_hash) VALUES (p_ip_hash);
    RETURN TRUE;
END $$;

/**
 * Record a security event and report whether this device is new for the user.
 *
 * Both halves in one statement, so two concurrent logins cannot both see an
 * empty device list and both suppress the "new device" notification.
 */
CREATE OR REPLACE FUNCTION record_security_event(
    p_user_id      UUID,
    p_account_id   UUID,
    p_event_type   TEXT,
    p_ip_hash      TEXT,
    p_fingerprint  TEXT,
    p_device_label TEXT,
    p_user_agent   TEXT,
    p_location     TEXT DEFAULT NULL,
    p_succeeded    BOOLEAN DEFAULT TRUE,
    p_metadata     JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (is_new_device BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    device_existed BOOLEAN := TRUE;
BEGIN
    INSERT INTO security_events
        (user_id, account_id, event_type, ip_hash, device_label, user_agent,
         approximate_location, succeeded, metadata)
    VALUES
        (p_user_id, p_account_id, p_event_type, p_ip_hash, p_device_label,
         left(p_user_agent, 400), p_location, p_succeeded, p_metadata);

    IF p_user_id IS NOT NULL AND p_fingerprint IS NOT NULL AND p_succeeded THEN
        INSERT INTO known_devices (user_id, fingerprint, device_label)
        VALUES (p_user_id, p_fingerprint, p_device_label)
        ON CONFLICT (user_id, fingerprint) DO UPDATE SET last_seen_at = now()
        -- xmax is non-zero only when the row already existed and was updated.
        RETURNING (xmax <> 0) INTO device_existed;
    END IF;

    RETURN QUERY SELECT NOT COALESCE(device_existed, TRUE);
END $$;

REVOKE ALL ON FUNCTION record_login_attempt(CITEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_registration_rate(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_security_event(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC;
