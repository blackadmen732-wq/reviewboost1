-- Fix customer-page RPCs: accept explicit p_org_id instead of
-- silently picking the user's earliest org membership.
-- Without this, a multi-org owner modifies the wrong org's page.

-- Drop old parameter-less signatures first
drop function if exists public.rpc_get_customer_page();
drop function if exists public.rpc_publish_customer_page();
drop function if exists public.rpc_save_customer_page_draft(numeric, numeric, numeric, text);
drop function if exists public.rpc_save_customer_page_artwork(text, bytea);
drop function if exists public.rpc_get_customer_page_artwork(text);

create or replace function public.rpc_get_customer_page(p_org_id uuid)
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
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members om
        where om.user_id = v_actor
          and om.org_id = p_org_id
          and om.status = 'active'
          and om.role in ('owner', 'admin')
    ) then
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
    from (select p_org_id as org_id) o
    left join public.customer_page_settings s on s.org_id = o.org_id;
end;
$$;

create or replace function public.rpc_save_customer_page_draft(
    p_org_id uuid,
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
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members om
        where om.user_id = v_actor
          and om.org_id = p_org_id
          and om.status = 'active'
          and om.role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    insert into public.customer_page_settings as s (
        org_id, draft_offset_x, draft_offset_y, draft_scale, draft_tagline
    )
    values (
        p_org_id,
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
    p_org_id uuid,
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

    if not exists (
        select 1 from public.organization_members om
        where om.user_id = v_actor
          and om.org_id = p_org_id
          and om.status = 'active'
          and om.role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    insert into app.customer_page_artwork as a (org_id, draft_mime, draft_bytes)
    values (p_org_id, p_mime, p_bytes)
    on conflict (org_id) do update
    set draft_mime = excluded.draft_mime,
        draft_bytes = excluded.draft_bytes,
        updated_at = now();

    insert into public.customer_page_settings as s (org_id, has_draft_hero)
    values (p_org_id, true)
    on conflict (org_id) do update
    set has_draft_hero = true,
        updated_at = now();
end;
$$;

create or replace function public.rpc_publish_customer_page(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members om
        where om.user_id = v_actor
          and om.org_id = p_org_id
          and om.status = 'active'
          and om.role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    update app.customer_page_artwork
    set published_mime = draft_mime,
        published_bytes = draft_bytes,
        updated_at = now()
    where org_id = p_org_id
      and draft_bytes is not null;

    update public.customer_page_settings
    set published_offset_x = draft_offset_x,
        published_offset_y = draft_offset_y,
        published_scale = draft_scale,
        published_tagline = draft_tagline,
        has_published_hero = has_draft_hero,
        published_at = now(),
        updated_at = now()
    where org_id = p_org_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (p_org_id, v_actor, 'user', 'customer_page.published', 'organization',
         p_org_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.rpc_get_customer_page_artwork(
    p_org_id uuid,
    p_side text
)
returns table (mime text, bytes bytea)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := (select auth.uid());
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if not exists (
        select 1 from public.organization_members om
        where om.user_id = v_actor
          and om.org_id = p_org_id
          and om.status = 'active'
          and om.role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_side = 'published' then
        return query
        select a.published_mime, a.published_bytes
        from app.customer_page_artwork a
        where a.org_id = p_org_id
          and a.published_bytes is not null;
    else
        return query
        select a.draft_mime, a.draft_bytes
        from app.customer_page_artwork a
        where a.org_id = p_org_id
          and a.draft_bytes is not null;
    end if;
end;
$$;

-- Grants for new signatures
revoke all on function public.rpc_get_customer_page(uuid) from public, anon;
revoke all on function public.rpc_save_customer_page_draft(uuid, numeric, numeric, numeric, text) from public, anon;
revoke all on function public.rpc_save_customer_page_artwork(uuid, text, bytea) from public, anon;
revoke all on function public.rpc_publish_customer_page(uuid) from public, anon;
revoke all on function public.rpc_get_customer_page_artwork(uuid, text) from public, anon;

grant execute on function public.rpc_get_customer_page(uuid) to authenticated;
grant execute on function public.rpc_save_customer_page_draft(uuid, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.rpc_save_customer_page_artwork(uuid, text, bytea) to authenticated;
grant execute on function public.rpc_publish_customer_page(uuid) to authenticated;
grant execute on function public.rpc_get_customer_page_artwork(uuid, text) to authenticated;
