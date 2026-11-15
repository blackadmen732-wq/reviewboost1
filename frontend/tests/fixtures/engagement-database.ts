import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
export const orgA = "11111111-1111-4111-8111-111111111111";
export const orgB = "22222222-2222-4222-8222-222222222222";
export const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const viewerA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ownerB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export async function createEngagementDatabase(adaptive = false) {
  const db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, app to authenticated, service_role;
    create table auth.users(id uuid primary key);
    create type public.member_role as enum ('owner','admin','member','viewer');
    create table public.organizations(id uuid primary key, timezone text default 'UTC', name text default 'Test business', status text default 'active');
    create table public.organization_members(org_id uuid, user_id uuid, role public.member_role, status text);
    create table public.public_review_sessions(id uuid primary key default gen_random_uuid(), org_id uuid references public.organizations(id),
      stand_id uuid, session_token_hash text, expires_at timestamptz, created_at timestamptz default now(), unique(id,org_id));
    create table public.destination_selections(org_id uuid, provider text, selected_at timestamptz default now());
    create table public.audit_events(org_id uuid, actor_user_id uuid, action text, target_type text, target_id text);
    create function app.resolve_public_stand(text,text) returns table(stand_id uuid,org_id uuid) language sql as $$
      select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, '${orgA}'::uuid where $1 = 'stand-a' $$;
  `);
  const helpers = readFileSync(
    resolve("../supabase/migrations/20260808000300_rls_policies.sql"),
    "utf8",
  ).split(
    "-- --------------------------------------------------------- enable RLS",
  )[0]!;
  await db.exec(helpers);
  await db.exec(
    readFileSync(
      resolve("../supabase/migrations/20261115083121_engagement_loyalty.sql"),
      "utf8",
    ),
  );
  await db.query("insert into auth.users values ($1),($2),($3)", [
    ownerA,
    viewerA,
    ownerB,
  ]);
  await db.query("insert into public.organizations(id) values ($1),($2)", [
    orgA,
    orgB,
  ]);
  await db.query(
    "insert into public.organization_members values ($1,$2,'owner','active'),($1,$3,'viewer','active'),($4,$5,'owner','active')",
    [orgA, ownerA, viewerA, orgB, ownerB],
  );
  await db.query(
    "insert into public.public_review_sessions(org_id,stand_id,session_token_hash,expires_at) values ($1,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','session-a',now()+interval '1 day'),($1,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','session-b',now()+interval '1 day')",
    [orgA],
  );

  if (adaptive)
    await db.exec(
      readFileSync(
        resolve(
          "../supabase/migrations/20261115200703_adaptive_engagement.sql",
        ),
        "utf8",
      ),
    );
  const offset = new Date().getUTCHours() - 12;
  await db.query("update public.organizations set timezone=$1", [
    `Etc/GMT${offset >= 0 ? "+" : ""}${offset}`,
  ]);
  return db;
}
