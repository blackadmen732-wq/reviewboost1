-- Rate limiting for the anonymous customer flow.
--
-- WHY THIS IS IN THE DATABASE
-- ---------------------------
-- Route Handlers are serverless: each request may land on a different instance
-- with its own memory. An in-process counter would therefore be per-instance,
-- and an attacker gets the budget multiplied by however many instances happen
-- to be warm. The database is the only state every instance shares.
--
-- The cost is one upsert per public request. At this scale that is cheaper than
-- the alternative being wrong, and the bucket rows are tiny and self-expiring.
-- If the write volume ever becomes the bottleneck, the fix is a durable shared
-- counter — not a return to per-instance memory.
--
-- WHAT IS AND IS NOT STORED
-- -------------------------
-- `bucket_key` is a keyed digest computed by the application: either a stand
-- token digest or a rotating client fingerprint. **No raw IP address is ever
-- written here**, and the fingerprint rotates daily so it cannot be used to
-- follow a device across weeks. It is an abuse control, not an identity.

create table public.rate_limit_buckets (
    bucket      text not null,
    bucket_key  text not null,
    window_started_at timestamptz not null,
    request_count integer not null default 0,
    expires_at  timestamptz not null,

    primary key (bucket, bucket_key)
);

create index rate_limit_buckets_expiry_idx on public.rate_limit_buckets (expires_at);

alter table public.rate_limit_buckets enable row level security;
-- No policy: infrastructure, not tenant data. RLS on with no policy denies
-- every client role, and the server reaches it through the definer function
-- below.

/**
 * Consume one unit from a fixed window, atomically.
 *
 * The whole check-and-increment is a single statement, so two concurrent
 * requests cannot both read "under the limit" and both proceed — the classic
 * read-then-write race that makes a rate limiter decorative.
 *
 * Returns whether the request is allowed and how long until the window resets,
 * so the caller can send an honest `Retry-After`.
 */
create or replace function app.consume_rate_limit(
    p_bucket         text,
    p_bucket_key     text,
    p_limit          integer,
    p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    row_after public.rate_limit_buckets%rowtype;
begin
    insert into public.rate_limit_buckets as b
        (bucket, bucket_key, window_started_at, request_count, expires_at)
    values
        (p_bucket, p_bucket_key, now(), 1, now() + make_interval(secs => p_window_seconds))
    on conflict (bucket, bucket_key) do update
        set request_count = case
                -- Window elapsed: start a new one rather than carrying the
                -- old count forward.
                when b.expires_at <= now() then 1
                else b.request_count + 1
            end,
            window_started_at = case when b.expires_at <= now() then now() else b.window_started_at end,
            expires_at = case
                when b.expires_at <= now() then now() + make_interval(secs => p_window_seconds)
                else b.expires_at
            end
    returning * into row_after;

    return query
        select row_after.request_count <= p_limit,
               greatest(1, ceil(extract(epoch from (row_after.expires_at - now())))::integer);
end;
$$;

/** Retention. Expired buckets carry no value and should not accumulate. */
create or replace function app.purge_rate_limit_buckets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    purged integer;
begin
    delete from public.rate_limit_buckets b where b.expires_at <= now() - interval '1 hour';
    get diagnostics purged = row_count;
    return purged;
end;
$$;

revoke all on function app.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function app.purge_rate_limit_buckets() from public, anon, authenticated;

grant execute on function app.consume_rate_limit(text, text, integer, integer) to service_role;
grant execute on function app.purge_rate_limit_buckets() to service_role;
