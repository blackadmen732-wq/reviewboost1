-- Revoke INSERT on locations and review_stands from authenticated.
--
-- Migration 20260808000700_grant_lockdown.sql granted full CRUD on these
-- tables to authenticated. Rows are created exclusively through
-- rpc_create_organization (SECURITY DEFINER), which inserts as postgres.
-- No TypeScript code does a direct .insert() on either table.
--
-- With INSERT still granted, a Data API caller could create rows with
-- attacker-controlled values — fake locations, stands pointing to
-- arbitrary tokens — bypassing the onboarding RPC's validation entirely.

revoke insert on public.locations from authenticated;
revoke insert on public.review_stands from authenticated;

-- Also revoke DELETE — the product never deletes locations or stands;
-- deactivation is the only removal path.
revoke delete on public.locations from authenticated;
revoke delete on public.review_stands from authenticated;
