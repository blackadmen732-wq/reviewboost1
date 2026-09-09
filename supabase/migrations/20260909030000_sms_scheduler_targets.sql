-- Scheduler targets for reconciliation and credit expiry.
-- Service-role only. Does not send SMS. Does not change quota math.

create or replace function app.sms_list_unresolved_attempts(p_limit integer)
returns table (
    id uuid,
    org_id uuid,
    request_id uuid,
    provider text,
    provider_message_id text
)
language sql
security definer
set search_path = ''
as $$
    select a.id, a.org_id, a.request_id, a.provider, a.provider_message_id
      from public.sms_delivery_attempts a
     where a.reconciliation_state = 'unresolved'
     order by a.settled_at nulls first, a.created_at
     limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

create or replace function public.rpc_sms_list_unresolved_attempts(p_limit integer)
returns table (
    id uuid,
    org_id uuid,
    request_id uuid,
    provider text,
    provider_message_id text
)
language sql
security definer
set search_path = ''
as $$
    select * from app.sms_list_unresolved_attempts(p_limit);
$$;

do $$
declare
    fn text;
begin
    foreach fn in array array[
        'app.sms_list_unresolved_attempts(integer)',
        'public.rpc_sms_list_unresolved_attempts(integer)'
    ]
    loop
        execute format('revoke all on function %s from public, anon, authenticated;', fn);
        execute format('grant execute on function %s to service_role;', fn);
    end loop;
end $$;
