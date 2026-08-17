-- Column-level UPDATE restrictions for entity tables.
--
-- locations and review_stands had table-wide UPDATE which allowed
-- changing org_id, id, and other server-controlled columns through
-- the Data API.

-- ============================================================
-- A. LOCATIONS — restrict UPDATE to editable fields only
-- ============================================================

revoke update on public.locations from authenticated;

grant update (name, google_review_url, status) on public.locations to authenticated;

-- ============================================================
-- B. REVIEW STANDS — restrict UPDATE to editable fields only
-- ============================================================

revoke update on public.review_stands from authenticated;

grant update (
    label,
    status,
    public_token_hash,
    public_token_prefix,
    public_token_key_version,
    public_token_encrypted,
    token_encryption_key_version,
    token_rotated_at,
    last_opened_at
) on public.review_stands to authenticated;

-- ============================================================
-- C. ORGANIZATIONS — restrict UPDATE to editable fields only
-- ============================================================

revoke update on public.organizations from authenticated;

grant update (name, timezone, default_locale, status) on public.organizations to authenticated;

-- ============================================================
-- D. PROFILES — restrict UPDATE to user-editable fields only
-- ============================================================

revoke update on public.profiles from authenticated;

grant update (display_name, avatar_url, locale) on public.profiles to authenticated;
