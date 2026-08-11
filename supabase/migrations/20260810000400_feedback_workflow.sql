-- Feedback workflow: acting on what a customer said.
--
-- WHY THERE IS NO "REPLY TO THE CUSTOMER" HERE
-- ============================================
-- A reply in the Birdeye/Podium sense — responding to the reviewer — is not
-- possible against this data model, and that is a deliberate product decision
-- rather than a gap to be filled later.
--
-- The public flow collects no email, no phone number, no name and no account.
-- There is no row anywhere in this schema that can be turned into a delivery
-- address. Anonymity is the reason people write "waited 25 minutes and the
-- order was wrong" instead of writing nothing, and adding a contact field to
-- enable replies would cost more honest feedback than the replies would be
-- worth.
--
-- So the workflow this migration supports is the one the data honestly allows:
-- an owner records **what they did about it**, and marks it handled. That turns
-- a complaint from something read into something closed, which is the part that
-- actually changes the business.
--
-- Reviews left on Google are public and can be replied to on Google. That is
-- where a public response belongs, and it already works without us.

set local check_function_bodies = off;

-- --------------------------------------------------------- action notes ----

create table public.response_notes (
    id               uuid primary key default gen_random_uuid(),
    org_id           uuid not null references public.organizations (id) on delete cascade,
    response_id      uuid not null,

    -- The team member who wrote it. Kept so a busy owner can see who dealt with
    -- something without having to ask.
    author_id        uuid not null references auth.users (id) on delete restrict,

    -- Encrypted like every other free-text field. An internal note routinely
    -- contains more sensitive detail than the customer's own message — staff
    -- names, disciplinary context, refunds — so it gets the same protection.
    body_encrypted   text not null,
    body_key_version smallint not null default 1,

    created_at       timestamptz not null default now(),

    constraint response_notes_id_org_key unique (id, org_id),

    -- Composite, carrying org_id: a note can never be attached to another
    -- tenant's feedback, and the refusal happens in the database rather than
    -- depending on the application remembering to check.
    constraint response_notes_response_fk
        foreign key (response_id, org_id)
        references public.customer_responses (id, org_id) on delete cascade
);

comment on table public.response_notes is
    'What the business did about a piece of feedback. Internal only; never sent to the customer, who is anonymous by design.';

-- The only access pattern: every note on one response, oldest first.
create index response_notes_thread_idx
    on public.response_notes (org_id, response_id, created_at);

-- ------------------------------------------------------- resolution ----

-- Who closed it, alongside the existing resolved_at. Accountability for free:
-- "marked done" with no name attached is how things get marked done without
-- being done.
alter table public.customer_responses
    add column if not exists resolved_by uuid references auth.users (id) on delete set null;

-- resolved_at without resolved_by, or the reverse, means somebody wrote one and
-- forgot the other. Enforced here so that cannot happen through any path.
alter table public.customer_responses
    drop constraint if exists customer_responses_resolution_complete;

alter table public.customer_responses
    add constraint customer_responses_resolution_complete
    check ((resolved_at is null) = (resolved_by is null));

-- Finding what still needs attention is the single most common owner query, and
-- it should not scan the table once a busy location has ten thousand rows.
create index if not exists customer_responses_unresolved_idx
    on public.customer_responses (org_id, submitted_at desc)
    where resolved_at is null;

-- ---------------------------------------------------------------- rls ----
--
-- ENABLE, never FORCE. FORCE applies policies to the table owner as well, which
-- breaks every SECURITY DEFINER function owned by that role — including the
-- public flow's own writers. This is the same trap the legacy schema fell into.

alter table public.response_notes enable row level security;

create policy response_notes_select_member on public.response_notes
    for select to authenticated
    using (app.is_org_member(org_id));

-- Insert is restricted twice over: the writer must belong to the organization,
-- *and* must be recording the note under their own name. Without the second
-- clause a member could attribute their note to a colleague.
create policy response_notes_insert_member on public.response_notes
    for insert to authenticated
    with check (
        app.is_org_member(org_id)
        and author_id = (select auth.uid())
    );

-- Deliberately no update and no delete policy.
--
-- This is a record of what a business did about a complaint. Something that can
-- be quietly rewritten afterwards is not a record. If a note is wrong, the
-- honest fix is another note saying so.

-- ------------------------------------------------- seeing your own team ----
--
-- Until now a user could read only their own profile row, which means an action
-- note written by a colleague renders with no name against it. Every multi-user
-- feature has this problem — "who dealt with this?" is unanswerable, and a note
-- nobody is accountable for is close to worthless.
--
-- So members of the same organization may see one another. The widening is
-- narrow and matches what people already assume: colleagues in one business
-- know each other's names. It does not expose anyone outside that business, and
-- profiles hold no contact details or secrets — display name, avatar, locale.

-- THE PROFILES TABLE HAS ALWAYS BEEN EMPTY
-- ----------------------------------------
-- `profiles` was created in the first migration, and the RLS policy on it
-- carries a comment saying the row "is created by a trigger on signup". That
-- trigger was never written. Nothing in any migration, and nothing in the
-- application, has ever inserted into this table.
--
-- It went unnoticed because nothing read from it until now: the dashboard only
-- ever needed the organization name. The moment a feature needs to say *who*
-- did something, every byline is blank.
--
-- Found while building the action thread. Fixed here rather than filed, because
-- a table that silently contains nothing is worse than one that does not exist.

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        -- Whatever the identity provider gave us, falling back to the part of
        -- the email before the @. Better a rough name than a blank one, and an
        -- owner can correct it.
        nullif(
            trim(coalesce(
                new.raw_user_meta_data ->> 'full_name',
                new.raw_user_meta_data ->> 'name',
                split_part(coalesce(new.email, ''), '@', 1)
            )),
            ''
        )
    )
    -- Signup can be retried, and a duplicate here must never fail the signup
    -- itself. Losing a display name is recoverable; losing an account is not.
    on conflict (id) do nothing;

    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function app.handle_new_user();

-- Everyone who signed up before this migration existed.
insert into public.profiles (id, display_name)
select
    u.id,
    nullif(
        trim(coalesce(
            u.raw_user_meta_data ->> 'full_name',
            u.raw_user_meta_data ->> 'name',
            split_part(coalesce(u.email, ''), '@', 1)
        )),
        ''
    )
from auth.users as u
on conflict (id) do nothing;

create or replace function app.shares_organization(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    -- SECURITY DEFINER so this reads organization_members without re-entering
    -- that table's own policy, which would recurse. Safe because it answers a
    -- single yes/no about the caller and returns no rows.
    select exists (
        select 1
        from public.organization_members as mine
        join public.organization_members as theirs
          on theirs.org_id = mine.org_id
        where mine.user_id = (select auth.uid())
          and mine.status = 'active'
          and theirs.user_id = p_user_id
          and theirs.status = 'active'
    );
$$;

comment on function app.shares_organization(uuid) is
    'True when the caller and the given user are both active members of the same organization.';

revoke all on function app.shares_organization(uuid) from public;
grant execute on function app.shares_organization(uuid) to authenticated;

drop policy if exists profiles_select_org_peer on public.profiles;

create policy profiles_select_org_peer on public.profiles
    for select to authenticated
    using (app.shares_organization(id));

-- Update stays self-only. Being able to see a colleague is not permission to
-- rename them.

-- ------------------------------------------------------------- grants ----
--
-- A policy without a grant is inert: PostgreSQL checks the table privilege
-- first and the policy never runs. Both are required, and the absence of this
-- block is precisely what once left every dashboard policy dead.

grant select, insert on public.response_notes to authenticated;

-- Nothing for the public roles. Internal notes are the most sensitive text in
-- the product and the anonymous customer path has no business touching them.
revoke all on public.response_notes from anon;

-- RLS does not apply to TRUNCATE — it is a table-level privilege, so a policy
-- cannot stop it. It has to be revoked explicitly or any signed-in user can
-- empty the table.
revoke truncate, trigger, references on public.response_notes from authenticated;
