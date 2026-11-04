-- Deleting the account, for real.
--
-- Until now the only way out was an email to privacy@reviewboost.fit. That is
-- not a deletion route a store will accept — Apple's 5.1.1(v) requires an app
-- that creates accounts to let a person start deleting one from inside it —
-- and it is not one a person can use at the moment they most want to.
--
-- WHY THIS HARD-DELETES WHEN THE REST OF THE SCHEMA DOES NOT
-- ----------------------------------------------------------
-- `organizations.closed_at` exists because closing a business is not deleting
-- it: a closed business can reopen, and its ratings are its own history. The
-- comment on that column — "Nothing is hard-deleted while dependent business
-- history exists" — is the right rule for closure and the wrong one for this.
-- A deletion request is a request to stop holding the data. A status flag that
-- leaves every phone number and every encrypted note in place answers a
-- different question than the one being asked.
--
-- So this is the one path that truly removes. Every tenant table cascades from
-- `organizations`, which is what makes that safe to say: the delete is one
-- statement and the foreign keys carry it everywhere, rather than a list of
-- tables that will drift out of date the first time someone adds one. The
-- pgTAP test asserts that completeness rather than trusting it.
--
-- WHAT DELIBERATELY SURVIVES
-- --------------------------
--   * `sms_webhook_inbox.org_id` is `on delete set null`, so a signature-
--     verified provider receipt outlives the account with nothing tying it to
--     one. Its body is encrypted and its phone numbers went with the cascade.
--   * The tombstone below, which records that an id was deleted and when. A
--     deletion nobody can confirm is one support cannot answer a question
--     about. It holds counts, never content, and no name.
--   * Stripe invoices. Money that has moved is a record both sides are
--     required to keep; the subscription is cancelled, and the API route does
--     that *before* this function runs, because a business billed for an
--     account that no longer exists is the worst outcome available here.

-- ========================================================== the tombstone ===

create table if not exists public.account_deletions (
    id             bigint generated always as identity primary key,
    -- Deliberately NOT a foreign key, to either table. The rows these would
    -- point at are the rows this record exists to say were destroyed, and a
    -- cascade would take the evidence with them.
    org_id         uuid not null,
    actor_user_id  uuid,
    -- Counts, never contents. "How much went" is answerable without holding
    -- anything back that was supposed to go.
    removed        jsonb not null default '{}'::jsonb,
    created_at     timestamptz not null default now()
);

comment on table public.account_deletions is
    'One row per deleted organization: that it happened, when, who asked, and how much went. No name, no contents, and no foreign key that a cascade could follow.';

alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public, anon, authenticated;
-- No policy, by design. The people who could read it no longer have an
-- account; support reads it with the service role.

-- ====================================================== the deletion ========

-- Takes the organization explicitly and the business's own name as a
-- confirmation, and checks both here rather than only in the UI. A typed
-- confirmation enforced solely in a form is a convention; enforced in the
-- function it is a property, and this is the one call in the system where
-- getting the wrong tenant is unrecoverable.
--
-- Identity is never an argument. The actor is `auth.uid()` and nothing else,
-- so there is no shape of this call in which one person names another and
-- deletes their business.
create or replace function public.rpc_delete_organization(
    p_org_id       uuid,
    p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor   uuid := (select auth.uid());
    v_name    text;
    v_removed jsonb;
begin
    if v_actor is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;

    if p_org_id is null then
        raise exception 'organization is required' using errcode = 'P0001';
    end if;

    -- Locked before the authority check so that two concurrent deletions
    -- cannot both pass it and both try to cascade.
    select name into v_name
      from public.organizations
     where id = p_org_id
     for update;

    -- A business that does not exist, and one the caller may not delete, are
    -- the same error. Telling them apart would confirm that a guessed id is a
    -- real business.
    if v_name is null then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Owner only. An admin can run the business day to day; ending it is not
    -- part of that, and the role split exists precisely so this call is
    -- narrower than the others.
    if not exists (
        select 1 from public.organization_members
         where org_id = p_org_id
           and user_id = v_actor
           and status = 'active'
           and role = 'owner'
    ) then
        raise exception 'not_found_or_forbidden' using errcode = 'P0001';
    end if;

    -- Case- and space-insensitive, because the check is for deliberateness,
    -- not for typing accuracy. Someone who has typed their own business name
    -- has understood the question; someone who clicked through a dialog has
    -- not.
    if p_confirmation is null
       or lower(btrim(p_confirmation)) <> lower(btrim(v_name)) then
        raise exception 'confirmation_mismatch' using errcode = 'P0001';
    end if;

    -- Counted before the delete, for the tombstone. These are the tables a
    -- person would ask about: what the business collected, and who it texted.
    select jsonb_build_object(
               'locations',     (select count(*) from public.locations where org_id = p_org_id),
               'tags',          (select count(*) from public.review_stands where org_id = p_org_id),
               'ratings',       (select count(*) from public.customer_responses where org_id = p_org_id),
               'phone_numbers', (select count(*) from public.sms_consent_state where org_id = p_org_id),
               'texts_sent',    (select count(*) from public.text_requests where org_id = p_org_id),
               'members',       (select count(*) from public.organization_members where org_id = p_org_id)
           )
      into v_removed;

    -- Written before the delete. `audit_events` cascades from the
    -- organization, so an audit row about this would be destroyed by the
    -- statement it describes.
    insert into public.account_deletions (org_id, actor_user_id, removed)
    values (p_org_id, v_actor, v_removed);

    -- One statement. Every tenant table carries `org_id ... on delete
    -- cascade`, so this reaches all of them, including the ones added after
    -- this function was written.
    delete from public.organizations where id = p_org_id;

    return v_removed;
end;
$$;

revoke all on function public.rpc_delete_organization(uuid, text) from public, anon;
grant execute on function public.rpc_delete_organization(uuid, text) to authenticated;

-- ================================================== billing references ======

-- The Stripe ids for one organization, so the API route can cancel the
-- subscription before the rows holding these ids are destroyed.
--
-- `billing_customers` is deliberately unreadable by members, and this does not
-- change that: the function is service-role only and the route never returns
-- what it reads. It exists so the service-role client keeps its rule of
-- calling narrow `app.*` functions rather than querying tables.
create or replace function app.billing_refs_for_org(p_org_id uuid)
returns table (
    stripe_customer_id     text,
    stripe_subscription_id text,
    stripe_status          text
)
language sql
stable
security definer
set search_path = ''
as $$
    select c.stripe_customer_id, s.stripe_subscription_id, s.stripe_status
      from public.billing_customers c
      left join public.billing_subscriptions s on s.org_id = c.org_id
     where c.org_id = p_org_id;
$$;

revoke all on function app.billing_refs_for_org(uuid) from public, anon, authenticated;
grant execute on function app.billing_refs_for_org(uuid) to service_role;
