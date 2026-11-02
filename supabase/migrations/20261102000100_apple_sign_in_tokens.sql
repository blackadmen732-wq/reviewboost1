-- Sign in with Apple: keep Apple's refresh token so it can be revoked.
--
-- App Store Review Guideline 5.1.1(v) requires in-app account deletion, and
-- Apple requires apps that offer Sign in with Apple to revoke the user's
-- tokens through the Sign in with Apple REST API when that account is deleted.
-- Revoking needs a token Apple issued to us, so the one refresh token from the
-- first sign-in is kept here until the account is deleted, and for nothing
-- else: ReviewBoost never calls Apple with it except to revoke it.
--
-- The token is encrypted by the server under a key the database never sees.
-- `client_id` records which Apple client obtained it (the iPhone app's bundle
-- ID, or the web Services ID), because Apple only revokes a token presented by
-- the client it was issued to.
--
-- Same containment as integration_credentials: no client role has any
-- privilege, there are no policies, and the service role reaches the table
-- only through the two functions below.

create table public.apple_sign_in_tokens (
    user_id            uuid primary key references auth.users (id) on delete cascade,
    client_id          text not null check (char_length(client_id) between 3 and 255),
    refresh_token_enc  text not null check (char_length(refresh_token_enc) between 16 and 8192),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

alter table public.apple_sign_in_tokens enable row level security;
revoke all on public.apple_sign_in_tokens from public, anon, authenticated;

comment on table public.apple_sign_in_tokens is
    'Encrypted Sign in with Apple refresh token per user, kept only to revoke it when the account is deleted. Service role via rpc_* only.';

-- Store, or replace, the token for one user. A later sign-in replaces the
-- earlier token: either one revokes the same Apple authorization.
create or replace function public.rpc_apple_sign_in_token_store(
    p_user_id            uuid,
    p_client_id          text,
    p_refresh_token_enc  text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if p_user_id is null or p_client_id is null or p_refresh_token_enc is null then
        raise exception 'user, client and token are required' using errcode = 'P0001';
    end if;

    insert into public.apple_sign_in_tokens as t (user_id, client_id, refresh_token_enc)
    values (p_user_id, p_client_id, p_refresh_token_enc)
    on conflict (user_id) do update
        set client_id         = excluded.client_id,
            refresh_token_enc = excluded.refresh_token_enc,
            updated_at        = now();
end;
$$;
revoke all on function public.rpc_apple_sign_in_token_store(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_apple_sign_in_token_store(uuid, text, text) to service_role;

comment on function public.rpc_apple_sign_in_token_store(uuid, text, text) is
    'Service role only. Keeps one user''s encrypted Sign in with Apple refresh token for revocation at account deletion.';

-- Read and remove in one step, so a token is revoked at most once and never
-- outlives the deletion that asked for it.
create or replace function public.rpc_apple_sign_in_token_take(p_user_id uuid)
returns table (
    client_id          text,
    refresh_token_enc  text
)
language sql
volatile
security definer
set search_path = ''
as $$
    delete from public.apple_sign_in_tokens t
     where t.user_id = p_user_id
    returning t.client_id, t.refresh_token_enc;
$$;
revoke all on function public.rpc_apple_sign_in_token_take(uuid) from public, anon, authenticated;
grant execute on function public.rpc_apple_sign_in_token_take(uuid) to service_role;

comment on function public.rpc_apple_sign_in_token_take(uuid) is
    'Service role only. Returns and deletes one user''s Sign in with Apple token so account deletion can revoke it with Apple.';
