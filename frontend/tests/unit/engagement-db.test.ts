import type { PGlite } from "@electric-sql/pglite";
import {
  createEngagementDatabase,
  orgA,
  orgB,
  ownerA,
  ownerB,
  viewerA,
} from "@/tests/fixtures/engagement-database";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

// Executes the actual new migration in embedded PostgreSQL. The existing
// tenant/session boundary is a small fixture; this is not a full Supabase
// migration reset or a multi-connection lock contention test.
let db: PGlite;
async function role(
  name: "postgres" | "authenticated" | "service_role" | "anon",
  user = ownerA,
) {
  await db.exec(`set local role ${name}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
    user,
  ]);
}
async function rejected(sql: string, args: unknown[] = [], message?: string) {
  await db.exec("savepoint expected_failure");
  await expect(db.query(sql, args)).rejects.toThrow(message);
  await db.exec("rollback to savepoint expected_failure");
}
async function enable() {
  await role("authenticated");
  await db.query(
    "select public.rpc_set_engagement_program($1,true,true,true,2,'A free coffee')",
    [orgA],
  );
}
async function enroll(
  session = "session-a",
  hash = "member-a",
  consent = true,
) {
  await role("service_role");
  const { rows } = await db.query<{
    result: { memberId: string; stamps: number; memberTokenEncrypted: string };
  }>(
    "select public.rpc_public_enroll_loyalty('stand-a',null,$1,null,$2,$3,'enroll-consent',$4) as result",
    [session, hash, `encrypted-${hash}`, consent],
  );
  return rows[0]!.result;
}
async function transaction(
  kind: string,
  reference: string,
  hash = "member-a",
  org = orgA,
) {
  return db.query<{
    result: { stamps: number; rewards: number; replayed: boolean };
  }>("select public.rpc_loyalty_transaction($1,$2,null,$3,$4) as result", [
    org,
    hash,
    kind,
    reference,
  ]);
}

beforeAll(async () => {
  db = await createEngagementDatabase();
}, 30_000);
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
});
afterAll(async () => {
  await db?.close();
});

describe("loyalty PostgreSQL boundary", () => {
  it("enables RLS, fixes definer search paths, and denies anonymous function execution", async () => {
    const tables = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where relname in ('engagement_programs','loyalty_members','loyalty_transactions','wallet_sync_jobs')",
    );
    expect(tables.rows).toHaveLength(4);
    expect(tables.rows.every((row) => row.relrowsecurity)).toBe(true);
    const functions = await db.query<{ allowed: boolean; config: string[] }>(
      "select has_function_privilege('anon',p.oid,'EXECUTE') as allowed, p.proconfig as config from pg_proc p where p.proname in ('rpc_set_engagement_program','rpc_public_enroll_loyalty','rpc_public_withdraw_loyalty','rpc_loyalty_transaction','rpc_engagement_summary')",
    );
    expect(functions.rows).toHaveLength(5);
    for (const fn of functions.rows) {
      expect(fn.allowed).toBe(false);
      expect(fn.config).toContain('search_path=""');
    }
  });
  it("is disabled by default and denies public direct RPC use", async () => {
    await role("service_role");
    await rejected(
      "select public.rpc_public_enroll_loyalty('stand-a',null,'session-a',null,'m','e','h',true)",
      [],
      "program_disabled",
    );
    await role("anon");
    await rejected(
      "select public.rpc_public_withdraw_loyalty('m',null)",
      [],
      "permission denied",
    );
  });
  it("allows only owner/admin configuration and isolates tenant reads", async () => {
    await enable();
    await role("authenticated", viewerA);
    await rejected(
      "select public.rpc_set_engagement_program($1,true,true,true,2,'Coffee')",
      [orgA],
      "not_found_or_forbidden",
    );
    await role("authenticated", ownerB);
    expect(
      (await db.query("select * from public.engagement_programs")).rows,
    ).toHaveLength(0);
    await rejected(
      "select public.rpc_set_engagement_program($1,true,true,true,2,'Coffee')",
      [orgA],
      "not_found_or_forbidden",
    );
  });
  it("enrolls exactly once per session, queues once, and never earns from a tap", async () => {
    await enable();
    const first = await enroll();
    expect(await enroll("session-a", "new-random-token-on-retry")).toEqual(
      first,
    );
    expect(first.stamps).toBe(0);
    await role("postgres");
    expect(
      (await db.query("select * from public.wallet_sync_jobs")).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select * from public.loyalty_transactions")).rows,
    ).toHaveLength(0);
  });
  it("rejects wrong or expired sessions and protects member capability columns", async () => {
    await enable();
    await enroll();
    await rejected(
      "select public.rpc_public_enroll_loyalty('stand-a',null,'wrong-session',null,'m','e','h',true)",
      [],
      "session_unavailable",
    );
    await role("postgres");
    await db.exec(
      "update public.public_review_sessions set expires_at=now()-interval '1 minute'",
    );
    await role("service_role");
    await rejected(
      "select public.rpc_public_enroll_loyalty('stand-a',null,'session-b',null,'m','e','h',true)",
      [],
      "session_unavailable",
    );
    await role("authenticated");
    await rejected(
      "select token_encrypted from public.loyalty_members",
      [],
      "permission denied",
    );
    await rejected(
      "update public.loyalty_members set stamps=100",
      [],
      "permission denied",
    );
  });
  it("deduplicates purchases, issues and consumes a reward once", async () => {
    await enable();
    await enroll();
    await role("authenticated");
    expect(
      (await transaction("earn", "receipt-1")).rows[0]!.result,
    ).toMatchObject({ stamps: 1, rewards: 0, replayed: false });
    expect(
      (await transaction("earn", "receipt-1")).rows[0]!.result.replayed,
    ).toBe(true);
    expect(
      (await transaction("earn", "receipt-2")).rows[0]!.result,
    ).toMatchObject({ stamps: 0, rewards: 1 });
    expect(
      (await transaction("redeem", "redemption-1")).rows[0]!.result.rewards,
    ).toBe(0);
    expect(
      (await transaction("redeem", "redemption-1")).rows[0]!.result.replayed,
    ).toBe(true);
    await rejected(
      "select public.rpc_loyalty_transaction($1,'member-a',null,'redeem','redemption-2')",
      [orgA],
      "reward_unavailable",
    );
  });
  it("rejects reuse of a receipt on another member or across tenants", async () => {
    await enable();
    await enroll();
    await enroll("session-b", "member-b");
    await role("authenticated");
    await transaction("earn", "receipt-1");
    await rejected(
      "select public.rpc_loyalty_transaction($1,'member-b',null,'earn','receipt-1')",
      [orgA],
      "purchase_reference_conflict",
    );
    await role("authenticated", ownerB);
    await rejected(
      "select public.rpc_loyalty_transaction($1,'member-a',null,'earn','receipt-2')",
      [orgB],
      "not_found_or_forbidden",
    );
  });
  it("keeps withdrawal working while disabled and blocks further earning", async () => {
    await enable();
    await enroll();
    await role("authenticated");
    await db.query(
      "select public.rpc_set_engagement_program($1,false,false,false,2,'Coffee')",
      [orgA],
    );
    await role("service_role");
    await db.exec("select public.rpc_public_withdraw_loyalty('member-a',null)");
    await enable();
    await rejected(
      "select public.rpc_loyalty_transaction($1,'member-a',null,'earn','receipt-1')",
      [orgA],
      "membership_withdrawn",
    );
    expect(
      (
        await db.query(
          "select reminders_consent,withdrawn_at from public.loyalty_members",
        )
      ).rows[0],
    ).toMatchObject({
      reminders_consent: false,
      withdrawn_at: expect.any(Date),
    });
  });
  it("refuses viewer earning and stops new transactions immediately when disabled", async () => {
    await enable();
    await enroll();
    await role("authenticated", viewerA);
    await rejected(
      "select public.rpc_loyalty_transaction($1,'member-a',null,'earn','receipt-1')",
      [orgA],
      "not_found_or_forbidden",
    );
    await role("authenticated");
    await db.query(
      "select public.rpc_set_engagement_program($1,false,false,false,2,'Coffee')",
      [orgA],
    );
    await rejected(
      "select public.rpc_loyalty_transaction($1,'member-a',null,'earn','receipt-1')",
      [orgA],
      "program_disabled",
    );
  });
  it("never converts review handoffs or queued jobs into claimed outcomes", async () => {
    await enable();
    await enroll();
    await role("authenticated");
    const result = await db.query<{ result: Record<string, unknown> }>(
      "select public.rpc_engagement_summary($1,now()-interval '1 day') as result",
      [orgA],
    );
    expect(result.rows[0]!.result).toMatchObject({
      tapSessions: 2,
      googleHandoffs: 0,
      loyaltyEnrollments: 1,
      confirmedPurchases: 0,
      publishedGoogleReviews: null,
      individualReviewAttribution: "unavailable",
      walletDelivery: "not_configured",
      walletUpdatesPending: 1,
    });
    await role("authenticated", ownerB);
    await rejected(
      "select public.rpc_engagement_summary($1,now()-interval '1 day')",
      [orgA],
      "not_found_or_forbidden",
    );
  });
});
