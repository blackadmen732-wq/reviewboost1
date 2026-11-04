-- Sign in with Apple tokens: kept only for revocation, reachable only by the
-- service role, and gone with the account.
--
--   supabase test db

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- ------------------------------------------------------------- seeding ----

insert into auth.users (id, email)
values ('a9a9a9a9-0000-0000-0000-000000000001', 'apple-owner@example.test'),
       ('a9a9a9a9-0000-0000-0000-000000000002', 'other@example.test');

-- --------------------------------------------------------- containment ----

select ok(
    (select relrowsecurity from pg_class where oid = 'public.apple_sign_in_tokens'::regclass),
    'row level security is on'
);

select is(
    (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'apple_sign_in_tokens'),
    0,
    'there are no policies: no client role can read or write a row'
);

select ok(
    not has_table_privilege('authenticated', 'public.apple_sign_in_tokens', 'select'),
    'a signed-in user cannot read the table'
);

select ok(
    not has_table_privilege('anon', 'public.apple_sign_in_tokens', 'select'),
    'an anonymous caller cannot read the table'
);

select ok(
    not has_function_privilege('authenticated', 'public.rpc_apple_sign_in_token_store(uuid, text, text)', 'execute'),
    'a signed-in user cannot store a token'
);

select ok(
    not has_function_privilege('authenticated', 'public.rpc_apple_sign_in_token_take(uuid)', 'execute'),
    'a signed-in user cannot take a token'
);

select ok(
    has_function_privilege('service_role', 'public.rpc_apple_sign_in_token_take(uuid)', 'execute'),
    'the service role can take a token'
);

-- ------------------------------------------------------------ behavior ----

select public.rpc_apple_sign_in_token_store(
    'a9a9a9a9-0000-0000-0000-000000000001', 'fit.reviewboost.app', 'v1:first-ciphertext-value');
select public.rpc_apple_sign_in_token_store(
    'a9a9a9a9-0000-0000-0000-000000000001', 'fit.reviewboost.app', 'v1:second-ciphertext-value');

select is(
    (select refresh_token_enc from public.apple_sign_in_tokens
      where user_id = 'a9a9a9a9-0000-0000-0000-000000000001'),
    'v1:second-ciphertext-value',
    'a later sign-in replaces the stored token'
);

select is(
    (select refresh_token_enc from public.rpc_apple_sign_in_token_take('a9a9a9a9-0000-0000-0000-000000000001')),
    'v1:second-ciphertext-value',
    'taking returns the token to revoke'
);

select is(
    (select count(*)::int from public.rpc_apple_sign_in_token_take('a9a9a9a9-0000-0000-0000-000000000001')),
    0,
    'a token is taken at most once'
);

select public.rpc_apple_sign_in_token_store(
    'a9a9a9a9-0000-0000-0000-000000000002', 'fit.reviewboost.web', 'v1:other-ciphertext-value');
delete from auth.users where id = 'a9a9a9a9-0000-0000-0000-000000000002';

select is(
    (select count(*)::int from public.apple_sign_in_tokens
      where user_id = 'a9a9a9a9-0000-0000-0000-000000000002'),
    0,
    'deleting the account removes its token'
);

select throws_ok(
    $$ select public.rpc_apple_sign_in_token_store(null, 'fit.reviewboost.app', 'v1:ciphertext-value') $$,
    'P0001',
    null,
    'a token needs a user'
);

select * from finish();

rollback;
