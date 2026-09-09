-- Additive owner-systems foundation. Does not touch stand tokens or
-- rpc_public_resolve_stand. Single-token QR/NFC stays the live path.
-- See docs/dev/DUAL_QR_NFC_BACKCOMPAT.md.

begin;

-- Artwork bytes stay off the Data API (app schema is not exposed).
create table app.customer_page_artwork (
    org_id           uuid primary key references public.organizations (id) on delete cascade,
    draft_mime       text check (draft_mime in ('image/jpeg', 'image/png', 'image/webp')),
    draft_bytes      bytea,
    published_mime   text check (published_mime in ('image/jpeg', 'image/png', 'image/webp')),
    published_bytes  bytea,
    updated_at       timestamptz not null default now()
);

create table public.customer_page_settings (
    org_id               uuid primary key references public.organizations (id) on delete cascade,
    draft_offset_x       numeric not null default 0,
    draft_offset_y       numeric not null default 0,
    draft_scale          numeric not null default 1,
    draft_tagline        text check (draft_tagline is null or char_length(draft_tagline) <= 80),
    published_offset_x   numeric not null default 0,
    published_offset_y   numeric not null default 0,
    published_scale      numeric not null default 1,
    published_tagline    text check (published_tagline is null or char_length(published_tagline) <= 80),
    has_draft_hero       boolean not null default false,
    has_published_hero   boolean not null default false,
    published_at         timestamptz,
    updated_at           timestamptz not null default now()
);

create table public.entitlement_snapshots (
    org_id                   uuid primary key references public.organizations (id) on delete cascade,
    plan_id                  text not null default 'starter'
        check (plan_id in ('starter', 'growth', 'pro')),
    status                   text not null default 'active'
        check (status in ('active', 'cancelled', 'past_due')),
    stripe_customer_id       text,
    stripe_subscription_id   text,
    source                   text not null default 'catalog'
        check (source in ('catalog', 'stripe_stub', 'stripe')),
    cancelled_at             timestamptz,
    updated_at               timestamptz not null default now()
);

alter table public.customer_page_settings enable row level security;
alter table public.entitlement_snapshots enable row level security;

revoke all on public.customer_page_settings from public, anon, authenticated;
revoke all on public.entitlement_snapshots from public, anon, authenticated;

grant select on public.customer_page_settings to authenticated;
grant select on public.entitlement_snapshots to authenticated;

create policy customer_page_settings_select on public.customer_page_settings
    for select to authenticated
    using (app.is_org_member(org_id));

create policy entitlement_snapshots_select on public.entitlement_snapshots
    for select to authenticated
    using (app.is_org_member(org_id));

-- ------------------------------------------------------------ owner RPCs --

create or replace function public.rpc_get_customer_page()
returns table (
    org_ok boolean,
    draft_offset_x numeric,
    draft_offset_y numeric,
    draft_scale numeric,
    draft_tagline text,
    has_draft_hero boolean,
    published_offset_x numeric,
    published_offset_y numeric,
    published_scale numeric,
    published_tagline text,
    has_published_hero boolean,
    published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select om.org_id into v_org_id
    from public.organization_members om
    where om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin')
    order by om.created_at
    limit 1;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    return query
    select
        true,
        coalesce(s.draft_offset_x, 0),
        coalesce(s.draft_offset_y, 0),
        coalesce(s.draft_scale, 1),
        s.draft_tagline,
        coalesce(s.has_draft_hero, false),
        coalesce(s.published_offset_x, 0),
        coalesce(s.published_offset_y, 0),
        coalesce(s.published_scale, 1),
        s.published_tagline,
        coalesce(s.has_published_hero, false),
        s.published_at
    from (select v_org_id as org_id) o
    left join public.customer_page_settings s on s.org_id = o.org_id;
end;
$$;

create or replace function public.rpc_save_customer_page_draft(
    p_offset_x numeric,
    p_offset_y numeric,
    p_scale numeric,
    p_tagline text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select om.org_id into v_org_id
    from public.organization_members om
    where om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin')
    order by om.created_at
    limit 1;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    insert into public.customer_page_settings as s (
        org_id, draft_offset_x, draft_offset_y, draft_scale, draft_tagline
    )
    values (
        v_org_id,
        coalesce(p_offset_x, 0),
        coalesce(p_offset_y, 0),
        coalesce(p_scale, 1),
        nullif(btrim(p_tagline), '')
    )
    on conflict (org_id) do update
    set draft_offset_x = excluded.draft_offset_x,
        draft_offset_y = excluded.draft_offset_y,
        draft_scale = excluded.draft_scale,
        draft_tagline = excluded.draft_tagline,
        updated_at = now();
end;
$$;

create or replace function public.rpc_save_customer_page_artwork(
    p_mime text,
    p_bytes bytea
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
        raise exception 'invalid_artwork' using errcode = '22023';
    end if;

    if p_bytes is null or octet_length(p_bytes) = 0 or octet_length(p_bytes) > 2000000 then
        raise exception 'invalid_artwork' using errcode = '22023';
    end if;

    select om.org_id into v_org_id
    from public.organization_members om
    where om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin')
    order by om.created_at
    limit 1;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    insert into app.customer_page_artwork as a (org_id, draft_mime, draft_bytes)
    values (v_org_id, p_mime, p_bytes)
    on conflict (org_id) do update
    set draft_mime = excluded.draft_mime,
        draft_bytes = excluded.draft_bytes,
        updated_at = now();

    insert into public.customer_page_settings as s (org_id, has_draft_hero)
    values (v_org_id, true)
    on conflict (org_id) do update
    set has_draft_hero = true,
        updated_at = now();
end;
$$;

create or replace function public.rpc_publish_customer_page()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select om.org_id into v_org_id
    from public.organization_members om
    where om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin')
    order by om.created_at
    limit 1;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    update app.customer_page_artwork
    set published_mime = draft_mime,
        published_bytes = draft_bytes,
        updated_at = now()
    where org_id = v_org_id
      and draft_bytes is not null;

    update public.customer_page_settings
    set published_offset_x = draft_offset_x,
        published_offset_y = draft_offset_y,
        published_scale = draft_scale,
        published_tagline = draft_tagline,
        has_published_hero = has_draft_hero,
        published_at = now(),
        updated_at = now()
    where org_id = v_org_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'customer_page.published', 'organization',
         v_org_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.rpc_get_customer_page_artwork(p_side text)
returns table (mime text, bytes bytea)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
    v_org_id uuid;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    select om.org_id into v_org_id
    from public.organization_members om
    where om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin')
    order by om.created_at
    limit 1;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_side = 'published' then
        return query
        select a.published_mime, a.published_bytes
        from app.customer_page_artwork a
        where a.org_id = v_org_id
          and a.published_bytes is not null;
    else
        return query
        select a.draft_mime, a.draft_bytes
        from app.customer_page_artwork a
        where a.org_id = v_org_id
          and a.draft_bytes is not null;
    end if;
end;
$$;

-- Public presentation: token hash only. Never returns org/location/stand ids.
create or replace function public.rpc_public_customer_presentation(
    p_token_hash text,
    p_previous_token_hash text
)
returns table (
    has_hero boolean,
    offset_x numeric,
    offset_y numeric,
    scale numeric,
    tagline text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    select
        coalesce(s.has_published_hero, false),
        coalesce(s.published_offset_x, 0),
        coalesce(s.published_offset_y, 0),
        coalesce(s.published_scale, 1),
        s.published_tagline
    from public.review_stands st
    join public.customer_page_settings s on s.org_id = st.org_id
    where st.status = 'active'
      and (
          st.public_token_hash = p_token_hash
          or (p_previous_token_hash is not null and st.public_token_hash = p_previous_token_hash)
      )
    limit 1;
end;
$$;

create or replace function public.rpc_public_customer_hero(
    p_token_hash text,
    p_previous_token_hash text
)
returns table (mime text, bytes bytea)
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    select a.published_mime, a.published_bytes
    from public.review_stands st
    join app.customer_page_artwork a on a.org_id = st.org_id
    where st.status = 'active'
      and a.published_bytes is not null
      and (
          st.public_token_hash = p_token_hash
          or (p_previous_token_hash is not null and st.public_token_hash = p_previous_token_hash)
      )
    limit 1;
end;
$$;

create or replace function public.rpc_apply_entitlement_snapshot(
    p_org_id uuid,
    p_plan_id text,
    p_status text,
    p_source text,
    p_stripe_customer_id text,
    p_stripe_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_plan_id is null or p_plan_id not in ('starter', 'growth', 'pro') then
        raise exception 'invalid_plan' using errcode = '22023';
    end if;
    if p_status is null or p_status not in ('active', 'cancelled', 'past_due') then
        raise exception 'invalid_status' using errcode = '22023';
    end if;

    insert into public.entitlement_snapshots as e (
        org_id, plan_id, status, source,
        stripe_customer_id, stripe_subscription_id,
        cancelled_at
    )
    values (
        p_org_id, p_plan_id, p_status, coalesce(p_source, 'catalog'),
        p_stripe_customer_id, p_stripe_subscription_id,
        case when p_status = 'cancelled' then now() else null end
    )
    on conflict (org_id) do update
    set plan_id = excluded.plan_id,
        status = excluded.status,
        source = excluded.source,
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id,
        cancelled_at = excluded.cancelled_at,
        updated_at = now();
end;
$$;

revoke all on function public.rpc_get_customer_page() from public, anon;
revoke all on function public.rpc_save_customer_page_draft(numeric, numeric, numeric, text) from public, anon;
revoke all on function public.rpc_save_customer_page_artwork(text, bytea) from public, anon;
revoke all on function public.rpc_publish_customer_page() from public, anon;
revoke all on function public.rpc_get_customer_page_artwork(text) from public, anon;
revoke all on function public.rpc_public_customer_presentation(text, text) from public, anon, authenticated;
revoke all on function public.rpc_public_customer_hero(text, text) from public, anon, authenticated;
revoke all on function public.rpc_apply_entitlement_snapshot(uuid, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.rpc_get_customer_page() to authenticated;
grant execute on function public.rpc_save_customer_page_draft(numeric, numeric, numeric, text) to authenticated;
grant execute on function public.rpc_save_customer_page_artwork(text, bytea) to authenticated;
grant execute on function public.rpc_publish_customer_page() to authenticated;
grant execute on function public.rpc_get_customer_page_artwork(text) to authenticated;
grant execute on function public.rpc_public_customer_presentation(text, text) to service_role;
grant execute on function public.rpc_public_customer_hero(text, text) to service_role;
grant execute on function public.rpc_apply_entitlement_snapshot(uuid, text, text, text, text, text) to service_role;

commit;
