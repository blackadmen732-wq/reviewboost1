-- Customers: the people a business has saved so it can send them a Text
-- Request without retyping their number.
--
-- What this is, and what it is not:
--
--   * A short address book for one-to-one Text Requests. A name (optional), a
--     mobile number, and the place they usually visit.
--   * Not consent. Saving a customer records nothing about whether they agreed
--     to texts. Agreement stays in the append-only consent ledger
--     (sms_consent_events / sms_consent_state), written only through the
--     owner's explicit attestation. The list *reads* that ledger so an owner can
--     see who has agreed; it never writes it.
--   * Not a CRM. No spend, visits or registrations: ReviewBoost does not know
--     them, and inventing them would be worse than leaving them out.
--
-- Privacy:
--
--   * The number and the name are encrypted by the server before they reach
--     the database (AES-GCM, the same key ring as text_requests). The database
--     holds the ciphertext, a keyed digest of the number for matching, and the
--     last four digits for display.
--   * Only an owner or admin can read the list. A phone number is more
--     sensitive than a rating, which is why the consent ledger is owner/admin
--     only too.
--   * Removing a customer deletes the row. It does not delete their consent
--     history or past Text Requests: those are evidence and stay as they were.
--
-- Writes go through the definer functions below, which read the caller from
-- auth.uid() and require an active owner or admin of the named business. Every
-- write leaves an audit event with ids only, never a name or a number.

create table public.customer_contacts (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references public.organizations (id) on delete cascade,
    location_id         uuid references public.locations (id) on delete set null,

    name_encrypted      text,
    name_key_version    smallint not null default 1,

    phone_hash          text not null check (char_length(phone_hash) between 16 and 128),
    phone_encrypted     text not null check (char_length(phone_encrypted) between 16 and 1024),
    phone_key_version   smallint not null default 1,
    phone_last_four     text not null check (phone_last_four ~ '^[0-9]{4}$'),

    created_by          uuid references auth.users (id) on delete set null,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),

    -- One saved entry per number per business, so the list cannot hold two
    -- names for the same phone and disagree about which one was texted.
    constraint customer_contacts_org_phone_unique unique (org_id, phone_hash)
);

create index customer_contacts_org_updated_idx
    on public.customer_contacts (org_id, updated_at desc);

create trigger customer_contacts_touch_updated_at
    before update on public.customer_contacts
    for each row execute function app.touch_updated_at();

alter table public.customer_contacts enable row level security;
revoke all on public.customer_contacts from public, anon, authenticated;
grant select on public.customer_contacts to authenticated;

create policy customer_contacts_select_admin on public.customer_contacts
    for select to authenticated
    using (app.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ------------------------------------------------------------- list -------

-- The list with what an owner needs beside each person: whether they have
-- agreed to review-request texts, and how the last Text Request to them went.
--
-- SECURITY INVOKER: it reads through the caller's own row level security, so a
-- member or viewer gets nothing and another business's rows never appear.
create or replace function public.rpc_customer_contacts_list(p_org_id uuid)
returns table (
    id                      uuid,
    location_id             uuid,
    name_encrypted          text,
    name_key_version        smallint,
    phone_encrypted         text,
    phone_key_version       smallint,
    phone_last_four         text,
    consent_status          text,
    last_request_status     text,
    last_request_at         timestamptz,
    created_at              timestamptz,
    updated_at              timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
    select c.id,
           c.location_id,
           c.name_encrypted,
           c.name_key_version,
           c.phone_encrypted,
           c.phone_key_version,
           c.phone_last_four,
           s.status::text,
           r.status::text,
           r.created_at,
           c.created_at,
           c.updated_at
      from public.customer_contacts c
      left join public.sms_consent_state s
             on s.org_id = c.org_id
            and s.phone_hash = c.phone_hash
            and s.purpose = 'review_request'
      left join lateral (
            select t.status, t.created_at
              from public.text_requests t
             where t.org_id = c.org_id
               and t.recipient_phone_hash = c.phone_hash
             order by t.created_at desc
             limit 1
      ) r on true
     where c.org_id = p_org_id
     order by c.updated_at desc
     limit 2000;
$$;

revoke all on function public.rpc_customer_contacts_list(uuid) from public, anon;
grant execute on function public.rpc_customer_contacts_list(uuid) to authenticated;

-- ------------------------------------------------------------- save -------

-- Create (p_contact_id null) or update one customer.
--
-- The server has already normalised, digested and encrypted the number; the
-- database checks the shape, the caller's role, and that the place (if any)
-- belongs to the same business. A number already saved under this business is
-- refused as `contact_exists`, not merged: which name is right is the owner's
-- call, not ours.
create or replace function public.rpc_customer_contact_save(
    p_org_id             uuid,
    p_contact_id         uuid,
    p_location_id        uuid,
    p_name_encrypted     text,
    p_name_key_version   smallint,
    p_phone_hash         text,
    p_phone_encrypted    text,
    p_phone_key_version  smallint,
    p_phone_last_four    text,
    p_request_id         text
)
returns table (contact_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_id    uuid;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if not app.has_org_role(p_org_id, array['owner', 'admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_location_id is not null and not exists (
        select 1 from public.locations where id = p_location_id and org_id = p_org_id
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    begin
        if p_contact_id is null then
            insert into public.customer_contacts
                (org_id, location_id, name_encrypted, name_key_version,
                 phone_hash, phone_encrypted, phone_key_version, phone_last_four, created_by)
            values
                (p_org_id, p_location_id, p_name_encrypted, coalesce(p_name_key_version, 1::smallint),
                 p_phone_hash, p_phone_encrypted, coalesce(p_phone_key_version, 1::smallint),
                 p_phone_last_four, v_actor)
            returning id into v_id;
        else
            update public.customer_contacts
               set location_id       = p_location_id,
                   name_encrypted    = p_name_encrypted,
                   name_key_version  = coalesce(p_name_key_version, 1::smallint),
                   phone_hash        = p_phone_hash,
                   phone_encrypted   = p_phone_encrypted,
                   phone_key_version = coalesce(p_phone_key_version, 1::smallint),
                   phone_last_four   = p_phone_last_four
             where id = p_contact_id
               and org_id = p_org_id
            returning id into v_id;

            if v_id is null then
                raise exception 'not_found_or_forbidden' using errcode = 'P0001';
            end if;
        end if;
    exception
        when unique_violation then
            raise exception 'contact_exists' using errcode = 'P0001';
    end;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user',
         case when p_contact_id is null then 'customer_contact.created' else 'customer_contact.updated' end,
         'customer_contact', v_id::text, p_request_id,
         jsonb_build_object('locationId', p_location_id));

    return query select v_id, p_contact_id is null;
end;
$$;

revoke all on function public.rpc_customer_contact_save(
    uuid, uuid, uuid, text, smallint, text, text, smallint, text, text) from public, anon;
grant execute on function public.rpc_customer_contact_save(
    uuid, uuid, uuid, text, smallint, text, text, smallint, text, text) to authenticated;

-- ----------------------------------------------------------- remove -------

create or replace function public.rpc_customer_contact_delete(
    p_org_id     uuid,
    p_contact_id uuid,
    p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_id    uuid;
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if not app.has_org_role(p_org_id, array['owner', 'admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    delete from public.customer_contacts
     where id = p_contact_id and org_id = p_org_id
    returning id into v_id;

    if v_id is null then
        return false;
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer_contact.deleted', 'customer_contact', v_id::text,
         p_request_id, '{}'::jsonb);

    return true;
end;
$$;

revoke all on function public.rpc_customer_contact_delete(uuid, uuid, text) from public, anon;
grant execute on function public.rpc_customer_contact_delete(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------- export -------

-- An export puts every saved number in a file on someone's computer. It is
-- allowed (it is the business's own list) and it is recorded, with a count and
-- nothing else.
create or replace function public.rpc_customer_contacts_record_export(
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
    v_actor uuid := (select auth.uid());
begin
    if v_actor is null then
        raise exception 'not_authenticated' using errcode = '42501';
    end if;

    if not app.has_org_role(p_org_id, array['owner', 'admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, request_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer_contact.exported', 'organization', p_org_id::text,
         p_request_id, jsonb_build_object('count', greatest(coalesce(p_count, 0), 0)));
end;
$$;

revoke all on function public.rpc_customer_contacts_record_export(uuid, integer, text) from public, anon;
grant execute on function public.rpc_customer_contacts_record_export(uuid, integer, text) to authenticated;
