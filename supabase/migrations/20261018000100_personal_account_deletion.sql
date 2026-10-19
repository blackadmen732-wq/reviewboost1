-- Deleting your own login, when you are not deleting a business.
--
-- WHY
-- ---
-- `rpc_delete_organization` deletes a business, and only its owner may call
-- it. A team member, or someone who signed in and never created a business,
-- had no way to delete their own account from inside the app: the screen told
-- them to "ask an owner to remove you", which removes access and keeps the
-- login. Apple 5.1.1(v) asks for deletion of the account itself, started in the
-- app, by the person it belongs to. (docs/design/PR67_LAUNCH_GAPS.md, L1.)
--
-- WHAT STOPPED IT
-- ---------------
-- One foreign key. `response_notes.author_id` was `not null ... on delete
-- restrict`, so removing anyone who had ever written a note on a rating
-- failed. Every other reference to auth.users already cascades (profiles,
-- memberships) or sets null (who resolved, who uploaded, who sent).
--
-- THE POLICY
-- ----------
--   * Notes stay with the business. They are the business's record of what it
--     did about a rating, not the writer's property. The byline becomes null,
--     and the app shows "Former team member".
--   * Nobody can delete the last owner out from under a business. If the
--     caller is the only active owner of any business, they are told which one
--     and asked to delete that business first (the existing, typed, Stripe-
--     cancelling path). A co-owned business keeps its other owner.
--   * The login itself is removed by the API with the Auth Admin API, exactly
--     like the business path does today. Memberships and the profile cascade.
--
-- This function only decides whether it is allowed. It changes nothing, so a
-- lost response or a retry can never half-delete anyone.

-- ============================================== notes outlive their author ===

alter table public.response_notes
    alter column author_id drop not null;

alter table public.response_notes
    drop constraint if exists response_notes_author_id_fkey;

alter table public.response_notes
    add constraint response_notes_author_id_fkey
    foreign key (author_id) references auth.users (id) on delete set null;

comment on column public.response_notes.author_id is
    'Who wrote the note. Null once that person deleted their own account; the note stays with the business.';

-- ========================================================= the decision ===

-- Businesses the caller is the only active owner of. Empty means they may go.
-- Reads auth.uid() and nothing else: there is no argument naming a person.
create or replace function public.rpc_my_account_deletion_blockers()
returns table (org_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
    select o.id, o.name
    from public.organization_members m
    join public.organizations o on o.id = m.org_id
    where m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = 'owner'
      and not exists (
          select 1
          from public.organization_members other
          where other.org_id = m.org_id
            and other.user_id <> m.user_id
            and other.status = 'active'
            and other.role = 'owner'
      )
    order by o.name;
$$;

comment on function public.rpc_my_account_deletion_blockers() is
    'Businesses the signed-in person is the only active owner of. Personal account deletion is refused until this is empty.';

revoke all on function public.rpc_my_account_deletion_blockers() from public, anon;
grant execute on function public.rpc_my_account_deletion_blockers() to authenticated;
