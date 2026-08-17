-- Remove direct authenticated UPDATE on review_stands and provide
-- rpc_update_stand with authorization, row locking, validation, and
-- idempotent auditing.
--
-- No TypeScript code does a direct .update() on review_stands.
-- The last_opened_at write happens inside rpc_create_public_session
-- (SECURITY DEFINER), which runs as postgres and does not need the grant.

revoke update on public.review_stands from authenticated;

create function public.rpc_update_stand(
    p_stand_id uuid,
    p_label    text default null,
    p_status   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor    uuid := (select auth.uid());
    v_org_id   uuid;
    v_cur_label  text;
    v_cur_status text;
    v_new_status public.stand_status;
    v_changed    boolean := false;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_label is not null then
        p_label := btrim(p_label);
        if char_length(p_label) < 1 or char_length(p_label) > 80 then
            raise exception 'label must be between 1 and 80 characters'
                using errcode = 'P0001';
        end if;
    end if;

    if p_status is not null then
        begin
            v_new_status := p_status::public.stand_status;
        exception when invalid_text_representation then
            raise exception 'invalid stand status'
                using errcode = 'P0001';
        end;
    end if;

    select org_id, label, status::text
    into v_org_id, v_cur_label, v_cur_status
    from public.review_stands
    where id = p_stand_id
    for update;

    if v_org_id is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if not exists (
        select 1 from public.organization_members
        where org_id = v_org_id
          and user_id = v_actor
          and status = 'active'
          and role in ('owner', 'admin')
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    if p_label is null and p_status is null then
        return;
    end if;

    if p_label is not null and p_label is distinct from v_cur_label then
        v_changed := true;
    end if;
    if p_status is not null and p_status is distinct from v_cur_status then
        v_changed := true;
    end if;

    if not v_changed then
        return;
    end if;

    update public.review_stands
    set label = coalesce(p_label, label),
        status = coalesce(v_new_status, status)
    where id = p_stand_id;

    insert into public.audit_events
        (org_id, actor_user_id, actor_type, action, target_type, target_id, metadata)
    values
        (v_org_id, v_actor, 'user', 'stand.updated', 'review_stand',
         p_stand_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.rpc_update_stand(uuid, text, text) from public, anon;
grant execute on function public.rpc_update_stand(uuid, text, text) to authenticated;
