-- The team, and matching praise to real people.
--
-- `team_praise_records` has carried `matched_staff_id`, `matched_by_user_id`
-- and `matched_at` since the first migration, with a status enum containing
-- 'matched' — but `matched_staff_id` pointed at a table nobody had built, so
-- every praise record has sat at 'unmatched' forever and the column has been an
-- unenforced uuid this whole time.
--
-- This is that table, plus the foreign key that makes the existing constraint
-- mean something.
--
-- WHY MATCHING IS A HUMAN DECISION
-- ===============================
-- A customer types a first name from memory, through a phone keyboard, after a
-- meal. "Amara", "amara", "Amira", "the tall guy called Am—". Guessing which
-- colleague was meant, and then showing that guess as fact, gets somebody
-- credited for work they did not do and somebody else quietly overlooked.
--
-- So ReviewBoost never matches automatically. It shows the owner what was
-- written and who is on the team, and the owner decides. The schema records who
-- decided and when, because that is a judgement, not a computation.
--
-- WHY THIS TABLE CANNOT SEE RATINGS
-- =================================
-- There is no path from staff_members to customer_responses. Praise is matched
-- to a person; the star rating that happened to accompany it is not carried
-- along and is not joinable from here. An owner deciding whether to recognise
-- someone should be reacting to what a customer wrote about them, not to a
-- number that may have been about the wait, the parking, or the weather.

set local check_function_bodies = off;

-- ---------------------------------------------------------------- staff ----

create table public.staff_members (
    id             uuid primary key default gen_random_uuid(),
    org_id         uuid not null references public.organizations (id) on delete cascade,

    -- Encrypted like every other free-text field holding a person's name. This
    -- is employee personal data, and it sits in the same threat model as the
    -- customer note: a database copy must not become a staff list.
    --
    -- The cost is that the database cannot sort or search it, so ordering and
    -- de-duplication happen in the application after decryption. For a roster of
    -- a few dozen people per business that is free; if a chain ever needs
    -- thousands, this is the decision to revisit.
    name_encrypted text not null,
    key_version    smallint not null default 1,

    -- Optional and deliberately not a job title dropdown. "Kitchen", "Saturday
    -- girl", "my son" — small businesses do not have an HR taxonomy and asking
    -- them to pick one is how a simple screen becomes a form.
    role_label     text check (role_label is null or char_length(role_label) between 1 and 60),

    -- Someone who has left keeps their history. Deleting them would silently
    -- rewrite past praise, and the owner would lose the record of good work that
    -- actually happened.
    is_active      boolean not null default true,

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    constraint staff_members_id_org_key unique (id, org_id)
);

comment on table public.staff_members is
    'The people who work at a business. Matched to customer praise by hand, never automatically.';

create index staff_members_org_idx on public.staff_members (org_id, is_active);

create trigger staff_members_touch before update on public.staff_members
    for each row execute function app.touch_updated_at();

-- ------------------------------------------------- the missing foreign key --

-- Composite, carrying org_id, so praise can never be matched to somebody at a
-- different business. The refusal happens in the database rather than depending
-- on the application remembering to check.
alter table public.team_praise_records
    drop constraint if exists team_praise_matched_staff_fk;

alter table public.team_praise_records
    add constraint team_praise_matched_staff_fk
    foreign key (matched_staff_id, org_id)
    references public.staff_members (id, org_id) on delete set null;

-- `on delete set null` rather than cascade: if a staff row is ever hard-deleted,
-- the praise itself must survive. The customer's words are the record; the
-- match is an annotation on top of it.

-- Matched implies a matcher and a moment, the same way resolved implies a
-- resolver. Half-written state is how "who dealt with this?" becomes
-- unanswerable six months later.
alter table public.team_praise_records
    drop constraint if exists team_praise_match_complete;

alter table public.team_praise_records
    add constraint team_praise_match_complete
    check (
        (matched_staff_id is null and matched_at is null)
        or (matched_staff_id is not null and matched_at is not null)
    );

-- Telling someone they were praised is the entire point of the feature, and it
-- happens out loud, in a kitchen — not in this app. Recording it stops the same
-- praise being passed on twice or, worse, never.
alter table public.team_praise_records
    add column if not exists shared_at timestamptz;

alter table public.team_praise_records
    add column if not exists shared_by uuid references auth.users (id) on delete set null;

alter table public.team_praise_records
    drop constraint if exists team_praise_shared_complete;

alter table public.team_praise_records
    add constraint team_praise_shared_complete
    check ((shared_at is null) = (shared_by is null));

-- The two lists the Praise screen draws, kept off a sequential scan.
create index if not exists team_praise_unmatched_idx
    on public.team_praise_records (org_id, created_at desc)
    where status = 'unmatched';

create index if not exists team_praise_staff_idx
    on public.team_praise_records (org_id, matched_staff_id, created_at desc)
    where matched_staff_id is not null;

-- ---------------------------------------------------------------- rls ----
--
-- ENABLE, never FORCE. FORCE applies policies to the table owner too, which
-- breaks every SECURITY DEFINER function owned by that role — including the
-- public flow's own writers.

alter table public.staff_members enable row level security;

create policy staff_members_select_member on public.staff_members
    for select to authenticated
    using (app.is_org_member(org_id));

-- Anyone in the business can add and correct the roster. Deliberately not
-- restricted to owners: the person who knows that the new starter is called
-- Chidi is the shift manager, not the person who signed up for the account, and
-- a roster only one human can edit is a roster that goes stale.
create policy staff_members_write_member on public.staff_members
    for insert to authenticated
    with check (app.is_org_member(org_id));

create policy staff_members_update_member on public.staff_members
    for update to authenticated
    using (app.is_org_member(org_id))
    with check (app.is_org_member(org_id));

-- No delete policy. Someone who leaves is deactivated, never removed, so the
-- praise they earned keeps pointing at a real name.

-- ------------------------------------------------------------- grants ----
--
-- A policy without a grant is inert: PostgreSQL checks the table privilege
-- first and the policy never runs. The absence of exactly this block is what
-- once left every dashboard policy dead.

grant select, insert, update on public.staff_members to authenticated;

-- Nothing for the anonymous customer path. A customer names a person; they have
-- no business reading the payroll.
revoke all on public.staff_members from anon;

-- RLS does not apply to TRUNCATE — it is a table privilege, so no policy can
-- stop it. It has to be revoked explicitly or any signed-in user can empty the
-- table.
revoke truncate, trigger, references on public.staff_members from authenticated;
