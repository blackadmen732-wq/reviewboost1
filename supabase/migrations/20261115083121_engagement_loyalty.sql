-- Optional loyalty backend. No wallet provider, Google review identity match,
-- or marketing delivery is implied by these records.
create table public.engagement_programs (
    org_id uuid primary key references public.organizations(id),
    enabled boolean not null default false,
    loyalty_enabled boolean not null default false,
    reminders_enabled boolean not null default false,
    stamps_required integer not null default 10 check (stamps_required between 2 and 100),
    reward_label text not null default 'Your next reward' check (char_length(reward_label) between 1 and 120),
    updated_at timestamptz not null default now()
);

create table public.loyalty_members (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id),
    enrollment_session_id uuid not null unique,
    token_hash text not null unique,
    token_encrypted text not null,
    enrollment_hash text not null,
    reminders_consent boolean not null default false,
    last_marketing_delivered_at timestamptz,
    consent_recorded_at timestamptz not null default now(),
    withdrawn_at timestamptz,
    stamps integer not null default 0 check (stamps >= 0),
    rewards integer not null default 0 check (rewards >= 0),
    revision integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(id, org_id),
    foreign key (enrollment_session_id, org_id) references public.public_review_sessions(id, org_id)
);

create table public.loyalty_transactions (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id),
    member_id uuid not null,
    kind text not null check (kind in ('earn', 'redeem')),
    purchase_reference text not null check (char_length(purchase_reference) between 1 and 120),
    actor_user_id uuid not null references auth.users(id),
    stamps_after integer not null,
    rewards_after integer not null,
    created_at timestamptz not null default now(),
    foreign key (member_id, org_id) references public.loyalty_members(id, org_id),
    -- One purchase / redemption reference cannot be reused on another card.
    unique (org_id, kind, purchase_reference)
);

-- An enqueue is not delivery. A provider worker must acknowledge an actual
-- update before changing state to delivered. No worker is enabled here.
create table public.wallet_sync_jobs (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null references public.organizations(id),
    member_id uuid not null,
    revision integer not null,
    state text not null default 'pending' check (state in ('pending', 'delivered')),
    created_at timestamptz not null default now(),
    foreign key (member_id, org_id) references public.loyalty_members(id, org_id),
    unique (member_id, revision)
);

create index loyalty_members_org_idx on public.loyalty_members(org_id, created_at);
create index loyalty_transactions_member_idx on public.loyalty_transactions(org_id, member_id, created_at desc);
create index wallet_sync_jobs_pending_idx on public.wallet_sync_jobs(org_id, created_at) where state = 'pending';

alter table public.engagement_programs enable row level security;
alter table public.loyalty_members enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.wallet_sync_jobs enable row level security;
revoke all on public.engagement_programs, public.loyalty_members, public.loyalty_transactions, public.wallet_sync_jobs
    from public, anon, authenticated;
grant select on public.engagement_programs, public.loyalty_transactions, public.wallet_sync_jobs to authenticated;
-- Never expose recoverable member capabilities or session correlation.
grant select(id, org_id, reminders_consent, last_marketing_delivered_at, withdrawn_at, stamps, rewards, revision, created_at, updated_at)
    on public.loyalty_members to authenticated;
create policy engagement_read on public.engagement_programs for select to authenticated
    using (app.is_org_member(org_id));
create policy loyalty_member_read on public.loyalty_members for select to authenticated
    using (app.is_org_member(org_id));
create policy loyalty_transaction_read on public.loyalty_transactions for select to authenticated
    using (app.is_org_member(org_id));
create policy wallet_job_read on public.wallet_sync_jobs for select to authenticated
    using (app.is_org_member(org_id));

create function public.rpc_set_engagement_program(
    p_org_id uuid, p_enabled boolean, p_loyalty_enabled boolean,
    p_reminders_enabled boolean, p_stamps_required integer, p_reward_label text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
    if (select auth.uid()) is null or not app.has_org_role(p_org_id, array['owner','admin']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode = '42501';
    end if;
    -- Serialize settings changes with earning / redemption / enrollment.
    perform 1 from public.organizations where id = p_org_id for update;
    insert into public.engagement_programs(org_id, enabled, loyalty_enabled, reminders_enabled, stamps_required, reward_label)
    values(p_org_id, p_enabled, p_loyalty_enabled, p_reminders_enabled, p_stamps_required, btrim(p_reward_label))
    on conflict (org_id) do update set
        enabled = excluded.enabled, loyalty_enabled = excluded.loyalty_enabled,
        reminders_enabled = excluded.reminders_enabled, stamps_required = excluded.stamps_required,
        reward_label = excluded.reward_label, updated_at = now();
    insert into public.audit_events(org_id, actor_user_id, action, target_type, target_id)
    values(p_org_id, auth.uid(), 'engagement.settings_changed', 'organization', p_org_id::text);
end;
$$;
revoke all on function public.rpc_set_engagement_program(uuid,boolean,boolean,boolean,integer,text) from public, anon;
grant execute on function public.rpc_set_engagement_program(uuid,boolean,boolean,boolean,integer,text) to authenticated;

-- Called only by the server after validating and rate-limiting the public
-- request. Both the stand and its unexpired session must match. No rating is
-- read. Existing review sessions and review links keep working when disabled.
create function public.rpc_public_enroll_loyalty(
    p_token_hash text, p_previous_token_hash text,
    p_session_hash text, p_previous_session_hash text,
    p_member_hash text, p_member_encrypted text,
    p_enrollment_hash text, p_reminders_consent boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    s record;
    sess public.public_review_sessions%rowtype;
    m public.loyalty_members%rowtype;
    prog public.engagement_programs%rowtype;
begin
    select * into s from app.resolve_public_stand(p_token_hash, p_previous_token_hash);
    if s.stand_id is null then raise exception 'session_unavailable'; end if;
    perform 1 from public.organizations where id = s.org_id for update;
    select * into prog from public.engagement_programs where org_id = s.org_id;
    if not coalesce(prog.enabled and prog.loyalty_enabled, false) then raise exception 'program_disabled'; end if;
    select * into sess from public.public_review_sessions
    where stand_id = s.stand_id and org_id = s.org_id
      and session_token_hash in (p_session_hash, p_previous_session_hash)
      and expires_at > now() for update;
    if sess.id is null then raise exception 'session_unavailable'; end if;
    select * into m from public.loyalty_members where enrollment_session_id = sess.id;
    if m.id is not null then
        if m.enrollment_hash <> p_enrollment_hash then raise exception 'enrollment_conflict'; end if;
        if m.withdrawn_at is not null then raise exception 'membership_withdrawn'; end if;
    else
        insert into public.loyalty_members(org_id, enrollment_session_id, token_hash, token_encrypted, enrollment_hash, reminders_consent)
        values(s.org_id, sess.id, p_member_hash, p_member_encrypted, p_enrollment_hash, p_reminders_consent) returning * into m;
        insert into public.wallet_sync_jobs(org_id, member_id, revision) values(m.org_id, m.id, m.revision);
    end if;
    return jsonb_build_object('memberId', m.id, 'memberTokenEncrypted', m.token_encrypted,
        'stamps', m.stamps, 'rewards', m.rewards, 'walletDelivery', 'not_configured');
end;
$$;
revoke all on function public.rpc_public_enroll_loyalty(text,text,text,text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.rpc_public_enroll_loyalty(text,text,text,text,text,text,text,boolean) to service_role;

-- Possession of the opaque member token authorizes withdrawal. This remains
-- available while the program is disabled. It can never opt somebody in.
create function public.rpc_public_withdraw_loyalty(p_member_hash text, p_previous_member_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.loyalty_members%rowtype;
begin
    select * into m from public.loyalty_members
    where token_hash in (p_member_hash, p_previous_member_hash) for update;
    if m.id is null or m.withdrawn_at is not null then return; end if;
    update public.loyalty_members set withdrawn_at = now(), reminders_consent = false,
        revision = revision + 1, updated_at = now() where id = m.id;
    insert into public.wallet_sync_jobs(org_id, member_id, revision) values(m.org_id, m.id, m.revision + 1);
end;
$$;
revoke all on function public.rpc_public_withdraw_loyalty(text,text) from public, anon, authenticated;
grant execute on function public.rpc_public_withdraw_loyalty(text,text) to service_role;

-- Each call represents one staff-confirmed purchase or one redemption, never
-- a public NFC tap. Org locking serializes duplicate references across cards.
create function public.rpc_loyalty_transaction(p_org_id uuid, p_member_hash text, p_previous_member_hash text, p_kind text, p_purchase_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    m public.loyalty_members%rowtype;
    prog public.engagement_programs%rowtype;
    tx public.loyalty_transactions%rowtype;
    v_stamps integer;
    v_rewards integer;
begin
    if (select auth.uid()) is null or not app.has_org_role(p_org_id, array['owner','admin','member']::public.member_role[]) then
        raise exception 'not_found_or_forbidden' using errcode = '42501';
    end if;
    if p_kind is null or p_kind not in ('earn','redeem')
       or p_purchase_reference is null or char_length(btrim(p_purchase_reference)) not between 1 and 120 then
        raise exception 'invalid_transaction';
    end if;
    p_purchase_reference := btrim(p_purchase_reference);
    perform 1 from public.organizations where id = p_org_id for update;
    select * into m from public.loyalty_members
    where token_hash in (p_member_hash, p_previous_member_hash) and org_id = p_org_id for update;
    if m.id is null then raise exception 'not_found_or_forbidden'; end if;
    select * into tx from public.loyalty_transactions
    where org_id = p_org_id and kind = p_kind and purchase_reference = p_purchase_reference;
    if tx.id is not null then
        if tx.member_id <> m.id then raise exception 'purchase_reference_conflict'; end if;
        return jsonb_build_object('transactionId', tx.id, 'stamps', tx.stamps_after, 'rewards', tx.rewards_after, 'replayed', true);
    end if;
    select * into prog from public.engagement_programs where org_id = p_org_id;
    if not coalesce(prog.enabled and prog.loyalty_enabled, false) then raise exception 'program_disabled'; end if;
    if m.withdrawn_at is not null then raise exception 'membership_withdrawn'; end if;
    v_stamps := m.stamps;
    v_rewards := m.rewards;
    if p_kind = 'earn' then
        v_stamps := v_stamps + 1;
        v_rewards := v_rewards + v_stamps / prog.stamps_required;
        v_stamps := v_stamps % prog.stamps_required;
    else
        if v_rewards < 1 then raise exception 'reward_unavailable'; end if;
        v_rewards := v_rewards - 1;
    end if;
    update public.loyalty_members set stamps = v_stamps, rewards = v_rewards,
        revision = revision + 1, updated_at = now() where id = m.id;
    insert into public.loyalty_transactions(org_id, member_id, kind, purchase_reference, actor_user_id, stamps_after, rewards_after)
    values(p_org_id, m.id, p_kind, p_purchase_reference, auth.uid(), v_stamps, v_rewards) returning * into tx;
    insert into public.wallet_sync_jobs(org_id, member_id, revision) values(p_org_id, m.id, m.revision + 1);
    return jsonb_build_object('transactionId', tx.id, 'stamps', v_stamps, 'rewards', v_rewards, 'replayed', false);
end;
$$;
revoke all on function public.rpc_loyalty_transaction(uuid,text,text,text,text) from public, anon;
grant execute on function public.rpc_loyalty_transaction(uuid,text,text,text,text) to authenticated;

-- Aggregate existing observations; never infer individual published reviews.
create function public.rpc_engagement_summary(p_org_id uuid, p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
    if (select auth.uid()) is null or not app.is_org_member(p_org_id) then
        raise exception 'not_found_or_forbidden' using errcode = '42501';
    end if;
    if p_since is null or p_since > now() or p_since < now() - interval '366 days' then raise exception 'invalid_range'; end if;
    return jsonb_build_object(
        'tapSessions', (select count(*) from public.public_review_sessions where org_id = p_org_id and created_at >= p_since),
        'googleHandoffs', (select count(*) from public.destination_selections where org_id = p_org_id and provider = 'google' and selected_at >= p_since),
        'loyaltyEnrollments', (select count(*) from public.loyalty_members where org_id = p_org_id and created_at >= p_since),
        'confirmedPurchases', (select count(*) from public.loyalty_transactions where org_id = p_org_id and kind = 'earn' and created_at >= p_since),
        'rewardRedemptions', (select count(*) from public.loyalty_transactions where org_id = p_org_id and kind = 'redeem' and created_at >= p_since),
        'walletUpdatesPending', (select count(*) from public.wallet_sync_jobs where org_id = p_org_id and state = 'pending'),
        'publishedGoogleReviews', null, 'individualReviewAttribution', 'unavailable',
        'walletDelivery', 'not_configured');
end;
$$;
revoke all on function public.rpc_engagement_summary(uuid,timestamptz) from public, anon;
grant execute on function public.rpc_engagement_summary(uuid,timestamptz) to authenticated;
