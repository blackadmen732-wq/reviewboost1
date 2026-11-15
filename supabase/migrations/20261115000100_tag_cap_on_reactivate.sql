-- A retired Tag that comes back counts against the plan, like a new one.
--
-- WHY
-- ---
-- `rpc_create_stand` counts every Tag that is not retired, under a lock on the
-- business's entitlement, and refuses one past the plan's limit. Retiring a Tag
-- frees its slot, which is right. But `rpc_update_stand` (granted to every
-- signed-in owner and admin) could set a retired Tag back to `active` or
-- `paused` with no count at all. Retire one, create one, bring the first back,
-- and repeat: a Starter business (3 Tags) could serve customers from any number
-- of them. No screen calls this function today, but an owner's own session can
-- call it directly, so the rule has to live here.
--
-- WHAT CHANGES
-- ------------
-- Only the move out of `retired`. It takes the same entitlement lock, the same
-- limit (`app.entitlement_tag_limit`) and the same count as creating a Tag, and
-- refuses with the same errors: `entitlement_missing`, `entitlement_inactive`,
-- `tag_limit_reached`. Renaming, pausing, resuming a paused Tag and retiring
-- are unchanged: none of them adds a Tag to the count.
--
-- Lock order: the Tag's row, then the entitlement row. `rpc_create_stand` takes
-- only the entitlement row (its new Tag has no row to lock yet), so the two
-- cannot wait on each other in a cycle. Two reactivations at once serialize on
-- the entitlement row, and the second counts after the first has committed.
--
-- Same signature and return type, so `create or replace` keeps every grant.

create or replace function public.rpc_update_stand(
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
    v_plan_id    text;
    v_ent_status text;
    v_limit      integer;
    v_count      integer;
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

    -- Leaving `retired` puts the Tag back in the count, so it is checked the
    -- way a new Tag is. The Tag itself is still retired here, so it is not
    -- counted twice: the count is every other Tag that already holds a slot.
    if v_cur_status = 'retired'
       and v_new_status is not null
       and v_new_status <> 'retired' then

        select e.plan_id, app.entitlement_effective_status(e.status, e.trial_ends_at)
          into v_plan_id, v_ent_status
          from public.entitlement_snapshots e
         where e.org_id = v_org_id
           for update;

        if not found then
            raise exception 'entitlement_missing' using errcode = 'P0001';
        end if;

        v_limit := app.entitlement_tag_limit(v_plan_id, v_ent_status);
        if v_limit <= 0 then
            raise exception 'entitlement_inactive' using errcode = 'P0001';
        end if;

        select count(*)::integer into v_count
          from public.review_stands s
         where s.org_id = v_org_id
           and s.status <> 'retired';

        if v_count >= v_limit then
            raise exception 'tag_limit_reached' using errcode = 'P0001';
        end if;
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
