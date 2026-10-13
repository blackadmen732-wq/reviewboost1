-- Customers an owner adds by hand, in the one customer model.
--
-- PR #76's foundation already has the model: `customers` (one reachable
-- contact per business, keyed by phone, because consent, opt-out and
-- suppression are keyed by phone) and `customer_source_profiles` (how each
-- source knows that contact), with `source_kind` 'manual' reserved for this.
-- An earlier draft on this branch added a separate `customer_contacts` table;
-- it never ran anywhere and is replaced by this file, so there is one model.
--
-- What "manual" means here:
--
--   * An owner or admin typed this person in. Their name is the owner's name
--     for them, kept on the manual profile, and it is what the owner sees.
--   * The same number from Square (or any source) is the same customer with a
--     second profile. Nothing is merged by name; a name that differs between
--     sources sets `names_differ`, as the integration path already does.
--   * Saving is not consent. Nothing here writes to the consent ledger.
--   * Removing deletes the manual profile only. Data from a connected app,
--     consent history and past Text Requests are untouched; the customer row
--     goes only when nothing else knows them.
--
-- Reads go through the caller's own RLS (owner/admin only, set by PR #76).
-- Writes are definer functions that read the caller from auth.uid(), require
-- an active owner or admin of the named business, and write an audit event
-- carrying ids only.

-- One manual profile per customer.
create unique index if not exists customer_source_profiles_one_manual
    on public.customer_source_profiles (customer_id)
    where source_kind = 'manual';

-- ------------------------------------------------------------- list -------

-- Everyone this business can text, with what an owner needs beside each:
-- the name they know them by, where they came from, whether they agreed to
-- review-request texts, their last visit, and how the last text went.
-- SECURITY INVOKER: a member, viewer or another business gets nothing.
create or replace function public.rpc_customers_list(p_org_id uuid)
returns table (
    id                   uuid,
    name_encrypted       text,
    names_differ         boolean,
    phone_encrypted      text,
    phone_last_four      text,
    has_manual           boolean,
    sources              text[],
    consent_status       text,
    last_visit_at        timestamptz,
    last_visit_kind      text,
    last_visit_location  uuid,
    last_request_status  text,
    last_request_at      timestamptz,
    created_at           timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
    select c.id,
           coalesce(m.name_encrypted, c.display_name_encrypted),
           c.names_differ,
           c.phone_encrypted,
           c.phone_last_four,
           m.id is not null,
           coalesce(
               (select array_agg(distinct coalesce(ic.provider_id, p.source_kind) order by coalesce(ic.provider_id, p.source_kind))
                  from public.customer_source_profiles p
                  left join public.integration_connections ic on ic.id = p.connection_id
                 where p.customer_id = c.id and p.status = 'active'),
               '{}'::text[]),
           s.status::text,
           v.occurred_at,
           v.kind,
           v.location_id,
           r.status::text,
           r.created_at,
           c.created_at
      from public.customers c
      left join public.customer_source_profiles m
             on m.customer_id = c.id and m.source_kind = 'manual'
      left join public.sms_consent_state s
             on s.org_id = c.org_id and s.phone_hash = c.phone_hash and s.purpose = 'review_request'
      left join lateral (
            select cv.occurred_at, cv.kind, cv.location_id
              from public.customer_visits cv
             where cv.customer_id = c.id and cv.status in ('completed', 'appointment_time_passed')
             order by cv.occurred_at desc
             limit 1
      ) v on true
      left join lateral (
            select t.status, t.created_at
              from public.text_requests t
             where t.org_id = c.org_id and t.recipient_phone_hash = c.phone_hash
             order by t.created_at desc
             limit 1
      ) r on true
     where c.org_id = p_org_id
       and c.phone_encrypted is not null
     order by coalesce(v.occurred_at, c.created_at) desc
     limit 2000;
$$;

revoke all on function public.rpc_customers_list(uuid) from public, anon;
grant execute on function public.rpc_customers_list(uuid) to authenticated;

-- ----------------------------------------------------- shared checks ------

create or replace function app.customer_manual_authorize(p_org_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;
    if not app.has_org_role(p_org_id, array['owner', 'admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;
    return v_actor;
end;
$$;

revoke all on function app.customer_manual_authorize(uuid) from public, anon, authenticated;

create or replace function app.customer_refresh_names_differ(p_customer_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    update public.customers cu
       set names_differ = (
           select count(distinct p.name_digest) > 1
             from public.customer_source_profiles p
            where p.customer_id = cu.id and p.status = 'active' and p.name_digest is not null)
     where cu.id = p_customer_id;
$$;

revoke all on function app.customer_refresh_names_differ(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------- save -------

-- Add (p_customer_id null) or change one customer by hand.
--
-- Adding a number already known from a connected app attaches the owner's
-- name to that same customer ('linked'); adding a number already added by hand
-- is refused ('contact_exists'). A number can be changed only on a customer
-- nothing else knows: a number from Square is Square's to change.
create or replace function public.rpc_customer_manual_save(
    p_org_id            uuid,
    p_customer_id       uuid,
    p_name_encrypted    text,
    p_name_digest       text,
    p_phone_hash        text,
    p_phone_encrypted   text,
    p_phone_key_version smallint,
    p_phone_last_four   text,
    p_request_id        text
)
returns table (customer_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
    v_actor      uuid;
    v_customer   uuid;
    v_outcome    text;
    v_current    public.customers%rowtype;
    v_other      uuid;
begin
    v_actor := app.customer_manual_authorize(p_org_id);

    if p_phone_hash is not null and (p_phone_encrypted is null or p_phone_last_four !~ '^[0-9]{4}$') then
        raise exception 'invalid_phone' using errcode = '22023';
    end if;

    if p_customer_id is null then
        if p_phone_hash is null then
            raise exception 'invalid_phone' using errcode = '22023';
        end if;

        select c.id into v_customer from public.customers c
         where c.org_id = p_org_id and c.phone_hash = p_phone_hash
           for update;

        if v_customer is null then
            insert into public.customers
                (org_id, phone_hash, phone_encrypted, phone_key_version, phone_last_four, display_name_encrypted)
            values
                (p_org_id, p_phone_hash, p_phone_encrypted, coalesce(p_phone_key_version, 1::smallint),
                 p_phone_last_four, p_name_encrypted)
            returning id into v_customer;
            v_outcome := 'created';
        elsif exists (select 1 from public.customer_source_profiles p
                       where p.customer_id = v_customer and p.source_kind = 'manual') then
            raise exception 'contact_exists' using errcode = 'P0001';
        else
            v_outcome := 'linked';
        end if;

        insert into public.customer_source_profiles
            (org_id, customer_id, source_kind, name_encrypted, name_digest)
        values
            (p_org_id, v_customer, 'manual', p_name_encrypted, p_name_digest);
    else
        select * into v_current from public.customers c
         where c.id = p_customer_id and c.org_id = p_org_id
           for update;
        if v_current.id is null then
            raise exception 'not_found_or_forbidden' using errcode = 'P0001';
        end if;
        v_customer := v_current.id;

        if p_phone_hash is not null and p_phone_hash <> v_current.phone_hash then
            if exists (select 1 from public.customer_source_profiles p
                        where p.customer_id = v_customer and p.source_kind <> 'manual') then
                raise exception 'phone_from_source' using errcode = 'P0001';
            end if;
            select c.id into v_other from public.customers c
             where c.org_id = p_org_id and c.phone_hash = p_phone_hash;
            if v_other is not null then
                raise exception 'contact_exists' using errcode = 'P0001';
            end if;
            update public.customers c
               set phone_hash = p_phone_hash,
                   phone_encrypted = p_phone_encrypted,
                   phone_key_version = coalesce(p_phone_key_version, 1::smallint),
                   phone_last_four = p_phone_last_four
             where c.id = v_customer;
        end if;

        insert into public.customer_source_profiles as p
            (org_id, customer_id, source_kind, name_encrypted, name_digest)
        values
            (p_org_id, v_customer, 'manual', p_name_encrypted, p_name_digest)
        on conflict (customer_id) where source_kind = 'manual'
        do update set name_encrypted = excluded.name_encrypted,
                      name_digest = excluded.name_digest,
                      last_synced_at = now();
        v_outcome := 'updated';
    end if;

    if p_name_encrypted is not null then
        update public.customers c set display_name_encrypted = p_name_encrypted where c.id = v_customer;
    end if;
    perform app.customer_refresh_names_differ(v_customer);

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer.manual_' || v_outcome, 'customer', v_customer::text,
         p_request_id, '{}'::jsonb);

    return query select v_customer, v_outcome;
end;
$$;

revoke all on function public.rpc_customer_manual_save(
    uuid, uuid, text, text, text, text, smallint, text, text) from public, anon;
grant execute on function public.rpc_customer_manual_save(
    uuid, uuid, text, text, text, text, smallint, text, text) to authenticated;

-- ----------------------------------------------------------- remove -------

-- Remove what the owner added by hand. Returns 'deleted' when the customer is
-- gone, 'kept_from_source' when a connected app still knows them (only the
-- owner's name was removed), 'not_found' otherwise.
create or replace function public.rpc_customer_manual_delete(
    p_org_id      uuid,
    p_customer_id uuid,
    p_request_id  text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor   uuid;
    v_removed uuid;
    v_outcome text;
begin
    v_actor := app.customer_manual_authorize(p_org_id);

    delete from public.customer_source_profiles p
     where p.customer_id = p_customer_id and p.org_id = p_org_id and p.source_kind = 'manual'
    returning p.id into v_removed;

    if v_removed is null then
        return 'not_found';
    end if;

    if exists (select 1 from public.customer_source_profiles p where p.customer_id = p_customer_id)
       or exists (select 1 from public.customer_visits v where v.customer_id = p_customer_id) then
        -- The name shown falls back to the most recent source's.
        update public.customers c
           set display_name_encrypted = (
               select p.name_encrypted from public.customer_source_profiles p
                where p.customer_id = c.id and p.status = 'active' and p.name_encrypted is not null
                order by p.source_updated_at desc nulls last, p.updated_at desc
                limit 1)
         where c.id = p_customer_id;
        perform app.customer_refresh_names_differ(p_customer_id);
        v_outcome := 'kept_from_source';
    else
        delete from public.customers c where c.id = p_customer_id and c.org_id = p_org_id;
        v_outcome := 'deleted';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer.manual_removed', 'customer', p_customer_id::text,
         p_request_id, jsonb_build_object('outcome', v_outcome));

    return v_outcome;
end;
$$;

revoke all on function public.rpc_customer_manual_delete(uuid, uuid, text) from public, anon;
grant execute on function public.rpc_customer_manual_delete(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------- export -------

-- An export puts every number in a file on someone's computer. Allowed (it is
-- the business's own list) and recorded, with a count and nothing else.
create or replace function public.rpc_customers_record_export(
    p_org_id     uuid,
    p_count      integer,
    p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid;
begin
    v_actor := app.customer_manual_authorize(p_org_id);
    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer.exported', 'organization', p_org_id::text,
         p_request_id, jsonb_build_object('count', greatest(coalesce(p_count, 0), 0)));
end;
$$;

revoke all on function public.rpc_customers_record_export(uuid, integer, text) from public, anon;
grant execute on function public.rpc_customers_record_export(uuid, integer, text) to authenticated;
