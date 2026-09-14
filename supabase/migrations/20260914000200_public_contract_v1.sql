-- The V1 public customer contract, enforced in the database.
--
-- V1 is: open the Tag, tap 1 to 5, the rating is saved privately, Google is
-- offered. Nothing else is collected from a customer.
--
-- The application already stopped sending notes and retired the public praise
-- route, but an endpoint removed in TypeScript is removed until someone adds it
-- back. Revoking the grant means the write path is gone in the one place that
-- cannot be undone by a refactor.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- --------------------------------------------
-- It drops no table, no column, and no row. `public.team_praise_records` keeps
-- every record a business collected, `customer_responses.note_encrypted` keeps
-- every note a customer wrote, and the owner-side read, match, and tally paths
-- are untouched. That history belongs to the business. Retiring a
-- customer-facing write path is not a reason to destroy what it wrote.
--
-- The function itself is also kept, only ungranted. Dropping it would take the
-- idempotency and token-rotation behaviour encoded in it with no way back; a
-- revoke is reversible with one line if V2 wants the feature again.

begin;

-- The public write path for Team Praise. `service_role` is the only role that
-- ever held this, because the public routes call it through the service client.
revoke execute on function public.rpc_public_submit_team_praise(
    text, text, text, text, text, uuid, text, text, smallint, integer, text, text, text, text
) from service_role;

comment on function public.rpc_public_submit_team_praise(
    text, text, text, text, text, uuid, text, text, smallint, integer, text, text, text, text
) is
    'Retired from the V1 public contract: no role holds EXECUTE. Kept, not '
    'dropped, so the idempotency and token-rotation behaviour survives if a '
    'later version reintroduces the feature. Historical rows in '
    'team_praise_records are unaffected and stay readable to owners.';

comment on column public.customer_responses.note_encrypted is
    'Customer-written note, AES-256-GCM. V1 collects no note: every row written '
    'from V1 onward has this null. Existing ciphertext is historical data and '
    'stays readable through the owner paths.';

-- Evidence, not decoration: a future migration that re-grants the public praise
-- path has to delete this row to make its intent explicit.
insert into public.audit_events
    (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
values
    (null, null, 'system', 'public_contract.v1_applied', 'function',
     'rpc_public_submit_team_praise',
     jsonb_build_object(
         'removed', jsonb_build_array('public_team_praise', 'public_response_note'),
         'retained', jsonb_build_array('team_praise_records', 'customer_responses.note_encrypted')
     ));

commit;
