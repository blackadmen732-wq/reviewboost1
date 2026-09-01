-- Revoke the default PUBLIC execute grant on rpc_record_nfc_provision.
--
-- Postgres grants EXECUTE on every new function to PUBLIC, and `anon`
-- inherits it. The NFC provisioning migration granted to `authenticated`
-- but never revoked that default, so the function was reachable at
-- /rest/v1/rpc/rpc_record_nfc_provision without signing in.
--
-- The body already raises `not_authenticated` when auth.uid() is null, so
-- no anonymous caller could actually record a provisioning event. This
-- closes the gap at the grant layer instead, which is where every sibling
-- RPC (rpc_create_stand, rpc_rotate_stand_token, rpc_update_stand) already
-- closes it — an unauthenticated caller should not be able to reach the
-- function body at all.

begin;

revoke all on function public.rpc_record_nfc_provision(uuid, uuid, text)
  from public, anon;

grant execute on function public.rpc_record_nfc_provision(uuid, uuid, text)
  to authenticated;

commit;
