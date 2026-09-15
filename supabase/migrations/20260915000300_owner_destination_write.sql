-- The owner's write authority over the door.
--
-- Changing where a Tag leads must never change the Tag. Same token, same QR,
-- same NFC chip, same `/q/{token}` — and the very next scan arrives at the new
-- destination. That is the whole point of ReviewBoost owning the door, and it
-- only holds if there is one authoritative, authorised write for it.
--
-- `rpc_update_location(p_google_review_url)` is not that write. It names one
-- provider in its signature, and it takes no organization, so which business
-- is being changed is inferred from the location id alone. This adds a write
-- that takes the selected organization explicitly, proves the caller may act
-- for it, validates the destination server-side, and records an audit event.
--
-- The legacy RPC keeps working for names; its Google field stays in step
-- through the compatibility trigger. It is no longer the authority.

create or replace function public.rpc_update_location_destination(
    p_org_id      uuid,
    p_location_id uuid,
    p_provider    text,
    p_url         text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor        uuid := (select auth.uid());
    v_location_org uuid;
    v_cur_provider text;
    v_cur_url      text;
    v_clearing     boolean;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_org_id is null or p_location_id is null then
        raise exception 'org and location are required' using errcode = 'P0001';
    end if;

    v_clearing := p_url is null or btrim(p_url) = '';

    -- An unknown provider is refused before anything is read, so a typo in a
    -- provider name can never be stored as a destination nobody validates.
    if not v_clearing and (p_provider is null or p_provider not in ('google')) then
        raise exception 'unknown_destination_provider' using errcode = 'P0001';
    end if;

    if not v_clearing then
        p_url := btrim(p_url);
        if not public._validate_destination_url(p_provider, p_url) then
            raise exception 'invalid_destination_url' using errcode = 'P0001';
        end if;
    end if;

    select org_id, destination_provider, destination_url
      into v_location_org, v_cur_provider, v_cur_url
      from public.locations
     where id = p_location_id
     for update;

    -- Three different failures — no such location, a location in another
    -- organization, and a caller who may not act for this one — deliberately
    -- raise the same error. Telling them apart would confirm that a guessed
    -- location id is real and which tenant owns it.
    if v_location_org is null or v_location_org <> p_org_id then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
         where org_id = p_org_id
           and user_id = v_actor
           and status = 'active'
           and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if v_clearing then
        if v_cur_provider is null and v_cur_url is null then
            return;
        end if;
        update public.locations
           set destination_provider = null,
               destination_url      = null,
               google_review_url    = null,
               updated_at           = now()
         where id = p_location_id
           and org_id = p_org_id;
    else
        if v_cur_provider is not distinct from p_provider
           and v_cur_url is not distinct from p_url then
            return;
        end if;
        update public.locations
           set destination_provider = p_provider,
               destination_url      = p_url,
               -- Compatibility storage, kept in step for as long as anything
               -- still reads it. Only Google has a legacy column to mirror.
               google_review_url    = case
                                          when p_provider = 'google' then p_url
                                          else google_review_url
                                      end,
               updated_at           = now()
         where id = p_location_id
           and org_id = p_org_id;
    end if;

    -- The URLs are recorded because a destination is public information an
    -- owner chose, and "who pointed our Tags somewhere else, and when" is
    -- exactly the question an audit log exists to answer.
    perform app.record_audit_event(
        p_org_id,
        'location.destination_updated',
        'location',
        p_location_id::text,
        null,
        jsonb_build_object(
            'from_provider', v_cur_provider,
            'to_provider',   case when v_clearing then null else p_provider end,
            'from_url',      v_cur_url,
            'to_url',        case when v_clearing then null else p_url end
        )
    );
end;
$$;

revoke all on function public.rpc_update_location_destination(uuid, uuid, text, text)
    from public, anon;
grant execute on function public.rpc_update_location_destination(uuid, uuid, text, text)
    to authenticated;

-- ===================================================== audit allowlist ======

-- The audit recorder refuses any action name not on its list, which is what
-- keeps the log a closed vocabulary rather than free text. The new action has
-- to be added there deliberately. Everything else about this function is
-- unchanged from 20260811000100.
create or replace function app.record_audit_event(
    p_org_id      uuid,
    p_action      text,
    p_target_type text,
    p_target_id   text,
    p_request_id  text default null,
    p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor uuid := (select auth.uid());
    allowed_actions constant text[] := array[
        'stand.token_rotated',
        'stand.created',
        'stand.deactivated',
        'location.created',
        'location.updated',
        'location.destination_updated',
        'member.role_changed',
        'member.suspended',
        'member.removed',
        'member.invited',
        'organization.created',
        'organization.updated',
        'staff.created',
        'staff.updated'
    ];
begin
    if actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_action is null or not (p_action = any(allowed_actions)) then
        raise exception 'unknown audit action: %', coalesce(p_action, '(null)')
            using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members m
         where m.org_id = p_org_id and m.user_id = actor and m.status = 'active'
    ) then
        raise exception 'not a member of that organization' using errcode = '42501';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, actor, 'user', p_action, p_target_type, p_target_id, p_request_id, p_metadata);
end;
$$;

revoke all on function app.record_audit_event(uuid, text, text, text, text, jsonb)
    from public, anon;
