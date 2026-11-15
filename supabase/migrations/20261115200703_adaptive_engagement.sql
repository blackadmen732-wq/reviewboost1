-- Durable experiments, first-party events, and delivery/outcome accounting.
-- No private rating or guessed Google reviewer identity is an input.
create table public.engagement_experiments (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id),
    campaign text not null check (campaign in ('reward_ready','one_visit_away','return_visit')),
    active boolean not null default false,
    created_at timestamptz not null default now(),
    unique(org_id,campaign), unique(id,org_id)
);
create table public.engagement_destinations (
    id uuid primary key default gen_random_uuid(), org_id uuid not null,
    member_id uuid not null, provider text not null check (provider in ('google_wallet','webhook')),
    target text not null check (char_length(target) between 1 and 256),
    active boolean not null default false, created_at timestamptz not null default now(),
    unique(member_id,provider), unique(provider,target), unique(id,org_id),
    foreign key (member_id,org_id) references public.loyalty_members(id,org_id)
);
create table public.engagement_assignments (
    id uuid primary key default gen_random_uuid(), org_id uuid not null,
    experiment_id uuid not null, member_id uuid not null, destination_id uuid not null,
    cycle bigint not null,
    cohort text not null check (cohort in ('control','treatment')),
    variant text,
    decision_source text not null check (decision_source in ('control','cold_start','explore','thompson')),
    model_snapshot jsonb not null default '{}'::jsonb check (octet_length(model_snapshot::text) < 8192),
    title text, body text,
    state text not null check (state in ('control','queued','sending','accepted','rejected','unknown','cancelled')),
    lease_token uuid, attempted_at timestamptz, accepted_at timestamptz,
    provider_reference text check (char_length(provider_reference) <= 256),
    failure_code text check (char_length(failure_code) <= 80),
    assigned_at timestamptz not null default now(),
    observe_until timestamptz not null default now() + interval '7 days',
    converted_at timestamptz, converted_after_accept_at timestamptz,
    unique(org_id,member_id,cycle), unique(id,org_id),
    foreign key (experiment_id,org_id) references public.engagement_experiments(id,org_id),
    foreign key (member_id,org_id) references public.loyalty_members(id,org_id),
    foreign key (destination_id,org_id) references public.engagement_destinations(id,org_id),
    check (observe_until > assigned_at),
    check ((cohort='control' and state='control' and variant is null and title is null and body is null)
        or (cohort='treatment' and state<>'control' and variant is not null and title is not null and body is not null))
);
create table public.engagement_events (
    id bigint generated always as identity primary key,
    org_id uuid not null references public.organizations(id), member_id uuid,
    kind text not null check (kind in ('enrolled','consent_withdrawn','purchase_confirmed','reward_redeemed',
        'assigned','queued','send_attempted','provider_accepted','provider_rejected','send_unknown','cancelled','purchase_observed')),
    source_id text not null check (char_length(source_id) <= 120),
    occurred_at timestamptz not null default now(),
    unique(org_id,kind,source_id),
    foreign key (member_id,org_id) references public.loyalty_members(id,org_id)
);
create index engagement_assignments_due_idx on public.engagement_assignments(assigned_at) where state='queued';
create index engagement_assignments_member_idx on public.engagement_assignments(org_id,member_id,observe_until);
create index engagement_assignments_model_idx on public.engagement_assignments(experiment_id,variant,assigned_at);
create index engagement_events_org_idx on public.engagement_events(org_id,occurred_at desc);
alter table public.engagement_programs add column last_prepared_at timestamptz;

alter table public.engagement_experiments enable row level security;
alter table public.engagement_destinations enable row level security;
alter table public.engagement_assignments enable row level security;
alter table public.engagement_events enable row level security;
revoke all on public.engagement_experiments, public.engagement_destinations, public.engagement_assignments, public.engagement_events
    from public,anon,authenticated;
grant select on public.engagement_experiments,public.engagement_events to authenticated;
grant select(id,org_id,member_id,provider,active,created_at) on public.engagement_destinations to authenticated;
grant select(id,org_id,experiment_id,member_id,cycle,cohort,variant,decision_source,title,body,state,assigned_at,
    observe_until,attempted_at,accepted_at,converted_at,converted_after_accept_at,failure_code)
    on public.engagement_assignments to authenticated;
create policy experiment_read on public.engagement_experiments for select to authenticated using(app.is_org_member(org_id));
create policy destination_read on public.engagement_destinations for select to authenticated using(app.is_org_member(org_id));
create policy assignment_read on public.engagement_assignments for select to authenticated using(app.is_org_member(org_id));
create policy event_read on public.engagement_events for select to authenticated using(app.is_org_member(org_id));

create table app.engagement_templates (
    id text primary key, campaign text not null, title text not null, body text not null
);
revoke all on app.engagement_templates from public,anon,authenticated;
insert into app.engagement_templates values
('reward_ready_a','reward_ready','Your reward is ready','{reward}. Open your loyalty card to see your available reward.'),
('reward_ready_b','reward_ready','You have earned it','{reward} is available. See the details on your loyalty card.'),
('one_visit_away_a','one_visit_away','One visit away','One more qualifying purchase earns your next reward.'),
('one_visit_away_b','one_visit_away','Your next purchase counts','You are one qualifying purchase away from your next reward.'),
('return_visit_a','return_visit','Your next visit counts','Your loyalty card is ready for your next qualifying purchase.'),
('return_visit_b','return_visit','Your rewards journey continues','Come back when you are ready. Your loyalty progress is saved.');

-- One source of campaign eligibility, rechecked again at dispatch.
create function app.engagement_campaign(p_member uuid, p_org uuid)
returns text language sql stable security definer set search_path='' as $$
    select case when m.rewards>0 then 'reward_ready'
        when p.stamps_required-m.stamps=1 then 'one_visit_away'
        when coalesce((select max(t.created_at) from public.loyalty_transactions t
            where t.org_id=m.org_id and t.member_id=m.id and t.kind='earn'),m.created_at) <= now()-interval '14 days'
        then 'return_visit' end
    from public.loyalty_members m join public.engagement_programs p on p.org_id=m.org_id
    join public.organizations o on o.id=m.org_id
    where m.id=p_member and m.org_id=p_org and o.status='active'
      and p.enabled and p.loyalty_enabled and p.reminders_enabled
      and m.reminders_consent and m.withdrawn_at is null
$$;
revoke all on function app.engagement_campaign(uuid,uuid) from public,anon,authenticated;

create function public.rpc_set_engagement_experiment(p_org_id uuid,p_campaign text,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
    if auth.uid() is null or not app.has_org_role(p_org_id,array['owner','admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode='42501'; end if;
    insert into public.engagement_experiments(org_id,campaign,active) values(p_org_id,p_campaign,p_active)
    on conflict(org_id,campaign) do update set active=excluded.active returning id into v_id;
    insert into public.audit_events(org_id,actor_user_id,action,target_type,target_id)
    values(p_org_id,auth.uid(),'engagement.experiment_changed','experiment',v_id::text);
    return v_id;
end;
$$;
revoke all on function public.rpc_set_engagement_experiment(uuid,text,boolean) from public,anon;
grant execute on function public.rpc_set_engagement_experiment(uuid,text,boolean) to authenticated;

create function public.rpc_bind_engagement_destination(p_org_id uuid,p_member_id uuid,p_provider text,p_target text,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
    if auth.uid() is null or not app.has_org_role(p_org_id,array['owner','admin']::public.member_role[])
       or not exists(select 1 from public.loyalty_members where id=p_member_id and org_id=p_org_id and withdrawn_at is null) then
        raise exception 'not_found_or_forbidden' using errcode='42501'; end if;
    if not p_active then
        update public.engagement_destinations set active=false where org_id=p_org_id and member_id=p_member_id and provider=p_provider;
        insert into public.audit_events(org_id,actor_user_id,action,target_type,target_id)
        values(p_org_id,auth.uid(),'engagement.destination_changed','loyalty_member',p_member_id::text);
        return;
    end if;
    if p_provider='webhook' then
        if p_target is distinct from p_member_id::text then raise exception 'invalid_destination'; end if;
    elsif p_provider='google_wallet' then
        if p_target !~ '^[0-9]{8,30}\.rb_[a-f0-9]{40}$' or split_part(p_target,'.',2) is distinct from
            'rb_'||substr(encode(sha256(convert_to(p_org_id::text||':'||p_member_id::text,'UTF8')),'hex'),1,40) then
            raise exception 'invalid_destination'; end if;
    else raise exception 'invalid_destination'; end if;
    insert into public.engagement_destinations(org_id,member_id,provider,target,active)
    values(p_org_id,p_member_id,p_provider,p_target,p_active)
    on conflict(member_id,provider) do update set active=excluded.active;
    insert into public.audit_events(org_id,actor_user_id,action,target_type,target_id)
    values(p_org_id,auth.uid(),'engagement.destination_changed','loyalty_member',p_member_id::text);
end;
$$;
revoke all on function public.rpc_bind_engagement_destination(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.rpc_bind_engagement_destination(uuid,uuid,text,text,boolean) to authenticated;

-- Shared implementation. Only narrow authenticated/service wrappers expose it.
create function app.engagement_context(p_org_id uuid,p_limit integer)
returns jsonb language sql stable security definer set search_path='' as $$
    select jsonb_build_object('orgId',o.id,'timezone',o.timezone,
      'program',coalesce((select jsonb_build_object('enabled',p.enabled,'loyaltyEnabled',p.loyalty_enabled,
        'remindersEnabled',p.reminders_enabled,'stampsRequired',p.stamps_required,'rewardLabel',p.reward_label)
        from public.engagement_programs p where p.org_id=o.id),'null'::jsonb),
      'experiments',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'campaign',e.campaign,'active',e.active,
        'arms',(select jsonb_agg(jsonb_build_object('id',t.id,'wins',
          (select count(*) from public.engagement_assignments a where a.experiment_id=e.id and a.variant=t.id
            and a.state='accepted' and a.observe_until<=now() and a.assigned_at>=now()-interval '90 days' and a.converted_after_accept_at is not null),
          'losses',(select count(*) from public.engagement_assignments a where a.experiment_id=e.id and a.variant=t.id
            and a.state='accepted' and a.observe_until<=now() and a.assigned_at>=now()-interval '90 days' and a.converted_after_accept_at is null)) order by t.id)
          from app.engagement_templates t where t.campaign=e.campaign))) from public.engagement_experiments e where e.org_id=o.id),'[]'::jsonb),
      'members',coalesce((select jsonb_agg(x) from (select m.id,app.engagement_campaign(m.id,o.id) as campaign,
          (select jsonb_agg(d.provider order by d.created_at,d.id) from public.engagement_destinations d where d.member_id=m.id and d.org_id=o.id and d.active) as providers
        from public.loyalty_members m where m.org_id=o.id and app.engagement_campaign(m.id,o.id) is not null
        and exists(select 1 from public.engagement_destinations d where d.member_id=m.id and d.org_id=o.id and d.active)
        and not exists(select 1 from public.engagement_assignments a where a.org_id=o.id and a.member_id=m.id
            and (a.observe_until>now() or a.cycle=floor(extract(epoch from now())/604800)::bigint
                or (a.state in ('sending','accepted','unknown') and a.attempted_at>now()-interval '7 days')))
        and (m.last_marketing_delivered_at is null or m.last_marketing_delivered_at<=now()-interval '7 days')
        order by m.created_at,m.id limit greatest(1,least(p_limit,100))) x),'[]'::jsonb))
    from public.organizations o where o.id=p_org_id and o.status='active'
$$;
revoke all on function app.engagement_context(uuid,integer) from public,anon,authenticated;

create function public.rpc_engagement_context(p_org_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
    if auth.uid() is null or not app.has_org_role(p_org_id,array['owner','admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode='42501'; end if;
    return app.engagement_context(p_org_id,p_limit);
end;
$$;
revoke all on function public.rpc_engagement_context(uuid,integer) from public,anon;
grant execute on function public.rpc_engagement_context(uuid,integer) to authenticated;
create function public.rpc_engagement_worker_context(p_org_id uuid,p_limit integer)
returns jsonb language sql security definer set search_path='' as $$ select app.engagement_context(p_org_id,p_limit) $$;
revoke all on function public.rpc_engagement_worker_context(uuid,integer) from public,anon,authenticated;
grant execute on function public.rpc_engagement_worker_context(uuid,integer) to service_role;

create function app.reserve_engagement(p_org_id uuid,p_member_id uuid,p_experiment_id uuid,p_variant text,p_source text,p_snapshot jsonb,p_provider text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
    m public.loyalty_members%rowtype; e public.engagement_experiments%rowtype;
    d public.engagement_destinations%rowtype; a public.engagement_assignments%rowtype;
    t app.engagement_templates%rowtype; v_control boolean; v_campaign text; v_cycle bigint;
begin
    -- Same lock order as the original purchase RPC and settings write.
    perform 1 from public.organizations where id=p_org_id for update;
    select * into m from public.loyalty_members where id=p_member_id and org_id=p_org_id for update;
    if m.id is null then raise exception 'not_found_or_forbidden'; end if;
    v_cycle:=floor(extract(epoch from now())/604800)::bigint;
    select * into a from public.engagement_assignments where org_id=p_org_id and member_id=m.id and cycle=v_cycle;
    if a.id is not null then return jsonb_build_object('id',a.id,'state',a.state,'replayed',true); end if;
    if exists(select 1 from public.engagement_assignments where org_id=p_org_id and member_id=m.id
        and (observe_until>now() or (state in ('sending','accepted','unknown') and attempted_at>now()-interval '7 days')))
       or (m.last_marketing_delivered_at is not null and m.last_marketing_delivered_at>now()-interval '7 days') then
        return jsonb_build_object('state','suppressed','reason','frequency_limit'); end if;
    select * into e from public.engagement_experiments where id=p_experiment_id and org_id=p_org_id and active;
    v_campaign:=app.engagement_campaign(m.id,p_org_id);
    if e.id is null or v_campaign is null or e.campaign<>v_campaign then
        return jsonb_build_object('state','suppressed','reason','not_eligible'); end if;
    if not exists(select 1 from public.organizations o where o.id=p_org_id
        and extract(hour from now() at time zone o.timezone)>=9 and extract(hour from now() at time zone o.timezone)<20) then
        return jsonb_build_object('state','suppressed','reason','quiet_hours'); end if;
    select * into d from public.engagement_destinations where org_id=p_org_id and member_id=m.id and active and provider=p_provider order by created_at,id limit 1;
    if d.id is null then return jsonb_build_object('state','suppressed','reason','no_destination'); end if;
    select * into t from app.engagement_templates where id=p_variant and campaign=e.campaign;
    if t.id is null or p_source is null or p_source not in ('cold_start','explore','thompson') then raise exception 'invalid_variant'; end if;
    -- UUID members are random. This stable, business-wide holdout prevents
    -- cross-campaign contamination. SHA256 matches the preview control group.
    v_control := (('x'||substr(encode(sha256(convert_to(p_org_id::text||':'||m.id::text,'UTF8')),'hex'),1,8))::bit(32)::bigint % 100)<10;
    insert into public.engagement_assignments(org_id,experiment_id,member_id,destination_id,cycle,cohort,variant,
        decision_source,model_snapshot,title,body,state)
    values(p_org_id,e.id,m.id,d.id,v_cycle,case when v_control then 'control' else 'treatment' end,
        case when not v_control then t.id end,case when v_control then 'control' else p_source end,
        coalesce(p_snapshot,'{}'::jsonb),case when not v_control then t.title end,
        case when not v_control then replace(t.body,'{reward}',(select reward_label from public.engagement_programs where org_id=p_org_id)) end,
        case when v_control then 'control' else 'queued' end) returning * into a;
    insert into public.engagement_events(org_id,member_id,kind,source_id) values(p_org_id,m.id,'assigned',a.id::text);
    if not v_control then insert into public.engagement_events(org_id,member_id,kind,source_id) values(p_org_id,m.id,'queued',a.id::text); end if;
    return jsonb_build_object('id',a.id,'state',a.state,'replayed',false);
end;
$$;
revoke all on function app.reserve_engagement(uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
create function public.rpc_reserve_engagement(p_org_id uuid,p_member_id uuid,p_experiment_id uuid,p_variant text,p_source text,p_snapshot jsonb,p_provider text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
    if auth.uid() is null or not app.has_org_role(p_org_id,array['owner','admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode='42501'; end if;
    return app.reserve_engagement(p_org_id,p_member_id,p_experiment_id,p_variant,p_source,p_snapshot,p_provider);
end;
$$;
revoke all on function public.rpc_reserve_engagement(uuid,uuid,uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.rpc_reserve_engagement(uuid,uuid,uuid,text,text,jsonb,text) to authenticated;
create function public.rpc_reserve_engagement_worker(p_org_id uuid,p_member_id uuid,p_experiment_id uuid,p_variant text,p_source text,p_snapshot jsonb,p_provider text)
returns jsonb language sql security definer set search_path='' as $$
    select app.reserve_engagement(p_org_id,p_member_id,p_experiment_id,p_variant,p_source,p_snapshot,p_provider)
$$;
revoke all on function public.rpc_reserve_engagement_worker(uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.rpc_reserve_engagement_worker(uuid,uuid,uuid,text,text,jsonb,text) to service_role;

create function app.record_loyalty_learning_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_kind text;
begin
    if tg_table_name='loyalty_members' then
        if tg_op='INSERT' then v_kind:='enrolled';
        elsif old.withdrawn_at is null and new.withdrawn_at is not null then v_kind:='consent_withdrawn';
        else return new; end if;
        insert into public.engagement_events(org_id,member_id,kind,source_id) values(new.org_id,new.id,v_kind,new.id::text) on conflict do nothing;
    else
        v_kind:=case when new.kind='earn' then 'purchase_confirmed' else 'reward_redeemed' end;
        insert into public.engagement_events(org_id,member_id,kind,source_id,occurred_at)
        values(new.org_id,new.member_id,v_kind,new.id::text,new.created_at) on conflict do nothing;
        if new.kind='earn' then
            update public.engagement_assignments set converted_at=coalesce(converted_at,new.created_at),
                converted_after_accept_at=case when state='accepted' and new.created_at>=accepted_at
                    then coalesce(converted_after_accept_at,new.created_at) else converted_after_accept_at end
            where org_id=new.org_id and member_id=new.member_id and new.created_at>=assigned_at and new.created_at<=observe_until;
        end if;
    end if;
    return new;
end;
$$;
revoke all on function app.record_loyalty_learning_event() from public,anon,authenticated;
create trigger loyalty_learning_enrollment after insert or update on public.loyalty_members for each row execute function app.record_loyalty_learning_event();
create trigger loyalty_learning_purchase after insert on public.loyalty_transactions for each row execute function app.record_loyalty_learning_event();

-- Upgrade existing loyalty data from the actual ledger. No assignments or
-- delivery successes are invented for activity before experimentation existed.
insert into public.engagement_events(org_id,member_id,kind,source_id,occurred_at)
    select org_id,id,'enrolled',id::text,created_at from public.loyalty_members on conflict do nothing;
insert into public.engagement_events(org_id,member_id,kind,source_id,occurred_at)
    select org_id,id,'consent_withdrawn',id::text,withdrawn_at from public.loyalty_members where withdrawn_at is not null on conflict do nothing;
insert into public.engagement_events(org_id,member_id,kind,source_id,occurred_at)
    select org_id,member_id,case when kind='earn' then 'purchase_confirmed' else 'reward_redeemed' end,id::text,created_at
    from public.loyalty_transactions on conflict do nothing;

-- Claimed requests are never blindly retried after an uncertain provider
-- response. An expired in-flight lease becomes unknown, not queued again.
create function public.rpc_claim_engagement(p_limit integer,p_providers text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.engagement_assignments%rowtype; d public.engagement_destinations%rowtype; rows_out jsonb:='[]'::jsonb;
begin
    with stale as (update public.engagement_assignments set state='unknown',failure_code='lease_expired'
        where state='sending' and attempted_at<now()-interval '2 minutes' returning org_id,member_id,id)
    insert into public.engagement_events(org_id,member_id,kind,source_id)
        select org_id,member_id,'send_unknown',id::text from stale on conflict do nothing;
    for a in select q.* from public.engagement_assignments q where q.state='queued'
        and exists(select 1 from public.engagement_destinations t where t.id=q.destination_id and t.provider=any(p_providers))
        and exists(select 1 from public.organizations o where o.id=q.org_id
            and extract(hour from now() at time zone o.timezone)>=9 and extract(hour from now() at time zone o.timezone)<20)
        order by q.assigned_at,q.id limit greatest(1,least(p_limit,100)) for update skip locked loop
        select * into d from public.engagement_destinations where id=a.destination_id and org_id=a.org_id;
        if not d.provider=any(p_providers) then continue; end if;
        if a.assigned_at<now()-interval '1 day' or not d.active
           or app.engagement_campaign(a.member_id,a.org_id) is distinct from
              (select campaign from public.engagement_experiments where id=a.experiment_id and active)
           or not exists(select 1 from public.engagement_experiments where id=a.experiment_id and active) then
            update public.engagement_assignments set state='cancelled',failure_code='eligibility_changed' where id=a.id;
            insert into public.engagement_events(org_id,member_id,kind,source_id) values(a.org_id,a.member_id,'cancelled',a.id::text) on conflict do nothing;
            continue;
        end if;
        update public.engagement_assignments set state='sending',lease_token=gen_random_uuid(),attempted_at=now()
        where id=a.id returning * into a;
        insert into public.engagement_events(org_id,member_id,kind,source_id) values(a.org_id,a.member_id,'send_attempted',a.id::text);
        rows_out:=rows_out||jsonb_build_array(jsonb_build_object('id',a.id,'leaseToken',a.lease_token,'orgId',a.org_id,
            'memberId',a.member_id,'provider',d.provider,'target',d.target,'title',a.title,'body',a.body));
    end loop;
    return rows_out;
end;
$$;
revoke all on function public.rpc_claim_engagement(integer,text[]) from public,anon,authenticated;
grant execute on function public.rpc_claim_engagement(integer,text[]) to service_role;

create function public.rpc_finish_engagement(p_id uuid,p_lease uuid,p_result text,p_reference text,p_failure_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.engagement_assignments%rowtype; v_now timestamptz:=now();
begin
    if p_result is null or p_result not in ('accepted','rejected','unknown') then raise exception 'invalid_result'; end if;
    select * into a from public.engagement_assignments where id=p_id;
    if a.id is null then return false; end if;
    perform 1 from public.organizations where id=a.org_id for update;
    perform 1 from public.loyalty_members where id=a.member_id and org_id=a.org_id for update;
    select * into a from public.engagement_assignments where id=p_id for update;
    if a.id is null or a.lease_token is distinct from p_lease or a.state<>'sending' then return false; end if;
    update public.engagement_assignments set state=p_result,provider_reference=p_reference,failure_code=p_failure_code,
        accepted_at=case when p_result='accepted' then v_now end where id=a.id;
    if p_result='accepted' then
        update public.loyalty_members set last_marketing_delivered_at=v_now where id=a.member_id and org_id=a.org_id;
    end if;
    insert into public.engagement_events(org_id,member_id,kind,source_id)
    values(a.org_id,a.member_id,case p_result when 'accepted' then 'provider_accepted' when 'rejected' then 'provider_rejected' else 'send_unknown' end,a.id::text);
    return true;
end;
$$;
revoke all on function public.rpc_finish_engagement(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.rpc_finish_engagement(uuid,uuid,text,text,text) to service_role;

create function public.rpc_engagement_active_orgs(p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
    select array_agg(x.org_id) into ids from (select p.org_id from public.engagement_programs p
        join public.organizations o on o.id=p.org_id where p.enabled and p.loyalty_enabled and p.reminders_enabled and o.status='active'
        and exists(select 1 from public.engagement_experiments e where e.org_id=p.org_id and e.active)
        order by p.last_prepared_at nulls first,p.org_id limit greatest(1,least(p_limit,25))) x;
    update public.engagement_programs set last_prepared_at=now() where org_id=any(ids);
    return coalesce(to_jsonb(ids),'[]'::jsonb);
end;
$$;
revoke all on function public.rpc_engagement_active_orgs(integer) from public,anon,authenticated;
grant execute on function public.rpc_engagement_active_orgs(integer) to service_role;

create function public.rpc_engagement_experiment_report(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
    if auth.uid() is null or not app.has_org_role(p_org_id,array['owner','admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode='42501'; end if;
    return jsonb_build_object('experiments',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'campaign',e.campaign,'active',e.active,
        'cohorts',(select coalesce(jsonb_agg(c),'[]'::jsonb) from (
            select a.cohort,count(*) as assigned,count(*) filter(where a.observe_until<=now()) as matured,
                count(*) filter(where a.observe_until<=now() and a.converted_at is not null) as converted,
                count(*) filter(where a.state='accepted') as provider_accepted,
                count(*) filter(where a.state='unknown') as unknown_sends
            from public.engagement_assignments a where a.experiment_id=e.id group by a.cohort) c),
        'variants',(select coalesce(jsonb_agg(v),'[]'::jsonb) from (
            select a.variant,count(*) filter(where a.state='accepted' and a.observe_until<=now()) as matured,
                count(*) filter(where a.state='accepted' and a.observe_until<=now() and a.converted_after_accept_at is not null) as converted
            from public.engagement_assignments a where a.experiment_id=e.id and a.variant is not null group by a.variant) v)))
        from public.engagement_experiments e where e.org_id=p_org_id),'[]'::jsonb),
        'recent',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,cohort,variant,state,title,assigned_at,observe_until
            from public.engagement_assignments where org_id=p_org_id order by assigned_at desc limit 20) x),
        'members',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select m.id,m.stamps,m.rewards,m.reminders_consent,
            (select coalesce(jsonb_agg(jsonb_build_object('provider',d.provider,'active',d.active)),'[]'::jsonb)
                from public.engagement_destinations d where d.org_id=m.org_id and d.member_id=m.id) as destinations
            from public.loyalty_members m where m.org_id=p_org_id and m.withdrawn_at is null order by m.created_at desc limit 25) x),
        'eventCounts',(select coalesce(jsonb_object_agg(kind,n),'{}'::jsonb) from (
            select kind,count(*) as n from public.engagement_events where org_id=p_org_id and occurred_at>=now()-interval '30 days' group by kind) x));
end;
$$;
revoke all on function public.rpc_engagement_experiment_report(uuid) from public,anon;
grant execute on function public.rpc_engagement_experiment_report(uuid) to authenticated;
