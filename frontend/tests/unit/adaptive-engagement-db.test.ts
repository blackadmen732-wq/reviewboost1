import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import {
  prepareEngagement,
  dispatchEngagement,
} from "@/lib/server/engagement/adaptive-service";
import { deliveryProviders } from "@/lib/server/engagement/providers";
import {
  createEngagementDatabase,
  orgA,
  orgB,
  ownerA,
  ownerB,
} from "@/tests/fixtures/engagement-database";

let db: PGlite;
async function role(
  name: "postgres" | "authenticated" | "service_role" | "anon",
  user = ownerA,
) {
  await db.exec(`set local role ${name}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
}
async function reject(sql: string, args: unknown[] = [], message?: string) {
  await db.exec("savepoint failure");
  await expect(db.query(sql, args)).rejects.toThrow(message);
  await db.exec("rollback to savepoint failure");
}
function memberIdentity(seed: string, control: boolean) {
  for (let i = 0; i < 1000; i++) {
    const h = createHash("sha256").update(`${seed}:${i}`).digest("hex");
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const held =
      createHash("sha256").update(`${orgA}:${id}`).digest().readUInt32BE(0) %
        100 <
      10;
    if (held === control) return id;
  }
  throw new Error("No fixture identity found.");
}
async function setupMember(
  hash = "member-a",
  session = "session-a",
  control = false,
) {
  await role("authenticated");
  await db.query(
    "select public.rpc_set_engagement_program($1,true,true,true,10,'A free coffee')",
    [orgA],
  );
  const memberId = memberIdentity(hash, control);
  await role("postgres");
  await db.query(
    "insert into public.loyalty_members(id,org_id,enrollment_session_id,token_hash,token_encrypted,enrollment_hash,reminders_consent) select $1,$2,id,$3,'encrypted','consent',true from public.public_review_sessions where session_token_hash=$4",
    [memberId, orgA, hash, session],
  );
  await db.query("update public.loyalty_members set stamps=9 where id=$1", [
    memberId,
  ]);
  await db.query(
    "insert into public.engagement_destinations(org_id,member_id,provider,target,active) values($1,$2,'webhook',$3,true)",
    [orgA, memberId, hash],
  );
  await role("authenticated");
  const { rows: ex } = await db.query<{ id: string }>(
    "select public.rpc_set_engagement_experiment($1,'one_visit_away',true) as id",
    [orgA],
  );
  return { memberId, experimentId: ex[0]!.id };
}
async function reserve(memberId: string, experimentId: string) {
  return db.query<{ value: { id: string; state: string; replayed: boolean } }>(
    "select public.rpc_reserve_engagement($1,$2,$3,'one_visit_away_a','cold_start','{}','webhook') as value",
    [orgA, memberId, experimentId],
  );
}
async function claim() {
  await role("service_role");
  return (
    await db.query<{ value: Array<{ id: string; leaseToken: string }> }>(
      "select public.rpc_claim_engagement(5,array['webhook']) as value",
    )
  ).rows[0]!.value;
}
async function finish(id: string, lease: string, result: string) {
  return (
    await db.query<{ value: boolean }>(
      "select public.rpc_finish_engagement($1,$2,$3,'receipt',null) as value",
      [id, lease, result],
    )
  ).rows[0]!.value;
}
async function mature(id: string) {
  await role("postgres");
  await db.query(
    "update public.engagement_assignments set assigned_at=now()-interval '8 days',observe_until=now()-interval '1 day',accepted_at=case when state='accepted' then now()-interval '8 days' end where id=$1",
    [id],
  );
}
async function historicalPurchase(memberId: string) {
  await role("postgres");
  await db.query(
    "insert into public.loyalty_transactions(org_id,member_id,kind,purchase_reference,actor_user_id,stamps_after,rewards_after,created_at) values($1,$2,'earn','historical-fixture',$3,0,1,now()-interval '2 days')",
    [orgA, memberId, ownerA],
  );
}

beforeAll(async () => {
  db = await createEngagementDatabase(true);
}, 30_000);
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await db?.close();
});

describe("adaptive engagement database", () => {
  it("upgrades existing purchases into events without inventing message outcomes", async () => {
    const legacy = await createEngagementDatabase();
    try {
      const id = "01234567-89ab-4cde-8fab-0123456789ab";
      await legacy.query(
        "insert into public.loyalty_members(id,org_id,enrollment_session_id,token_hash,token_encrypted,enrollment_hash) select $1,$2,id,'legacy','encrypted','consent' from public.public_review_sessions where session_token_hash='session-a'",
        [id, orgA],
      );
      await legacy.query(
        "insert into public.loyalty_transactions(org_id,member_id,kind,purchase_reference,actor_user_id,stamps_after,rewards_after) values($1,$2,'earn','legacy-receipt',$3,1,0)",
        [orgA, id, ownerA],
      );
      await legacy.exec(
        readFileSync(
          resolve(
            "../supabase/migrations/20261115200703_adaptive_engagement.sql",
          ),
          "utf8",
        ),
      );
      expect(
        (
          await legacy.query(
            "select kind from public.engagement_events order by kind",
          )
        ).rows,
      ).toEqual([{ kind: "enrolled" }, { kind: "purchase_confirmed" }]);
      expect(
        (await legacy.query("select id from public.engagement_assignments"))
          .rows,
      ).toHaveLength(0);
    } finally {
      await legacy.close();
    }
  });
  it("records enrollment events without creating purchases or sending", async () => {
    await setupMember();
    expect(
      (await db.query("select kind from public.engagement_events")).rows,
    ).toEqual([{ kind: "enrolled" }]);
  });
  it("persists one assignment per member/window and recovers it on retry", async () => {
    const m = await setupMember();
    const first = (await reserve(m.memberId, m.experimentId)).rows[0]!.value;
    expect(["queued", "control"]).toContain(first.state);
    expect(
      (await reserve(m.memberId, m.experimentId)).rows[0]!.value,
    ).toMatchObject({ id: first.id, replayed: true });
    expect(
      (await db.query("select id from public.engagement_assignments")).rows,
    ).toHaveLength(1);
  });
  it("isolates contexts and refuses unauthorized direct delivery writes", async () => {
    await setupMember();
    await role("authenticated", ownerB);
    await reject(
      "select public.rpc_engagement_context($1,20)",
      [orgA],
      "not_found_or_forbidden",
    );
    expect(
      (await db.query("select * from public.engagement_experiments")).rows,
    ).toHaveLength(0);
    await role("anon");
    await reject(
      "select public.rpc_claim_engagement(10,array['webhook'])",
      [],
      "permission denied",
    );
    await role("authenticated");
    await reject(
      "update public.engagement_assignments set state='accepted'",
      [],
      "permission denied",
    );
  });
  it("never learns a failure from an unfinished outcome window", async () => {
    const m = await setupMember();
    await reserve(m.memberId, m.experimentId);
    const { rows } = await db.query<{
      value: {
        experiments: Array<{ arms: Array<{ wins: number; losses: number }> }>;
      };
    }>("select public.rpc_engagement_context($1,20) as value", [orgA]);
    expect(
      rows[0]!.value.experiments[0]!.arms.every(
        (a) => a.wins === 0 && a.losses === 0,
      ),
    ).toBe(true);
  });
  it("holds out the same customer and never dispatches a control assignment", async () => {
    const m = await setupMember("control", "session-a", true);
    expect(
      (await reserve(m.memberId, m.experimentId)).rows[0]!.value.state,
    ).toBe("control");
    expect(await claim()).toEqual([]);
    await role("postgres");
    expect(
      (
        await db.query(
          "select variant,title,body from public.engagement_assignments",
        )
      ).rows[0],
    ).toEqual({ variant: null, title: null, body: null });
  });
  it("acknowledges a provider receipt once and rejects wrong leases", async () => {
    const m = await setupMember();
    await reserve(m.memberId, m.experimentId);
    const jobs = await claim();
    expect(jobs).toHaveLength(1);
    const j = jobs[0]!;
    expect(
      await finish(j.id, "00000000-0000-4000-8000-000000000000", "accepted"),
    ).toBe(false);
    expect(await finish(j.id, j.leaseToken, "accepted")).toBe(true);
    expect(await finish(j.id, j.leaseToken, "accepted")).toBe(false);
    await role("authenticated");
    expect(
      (
        await db.query(
          "select kind from public.engagement_events where kind='provider_accepted'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("cancels queued messages after opt-out and refuses further assignments", async () => {
    const m = await setupMember();
    await reserve(m.memberId, m.experimentId);
    await role("service_role");
    await db.exec("select public.rpc_public_withdraw_loyalty('member-a',null)");
    expect(await claim()).toEqual([]);
    await role("authenticated");
    expect(
      (await db.query("select state from public.engagement_assignments"))
        .rows[0],
    ).toEqual({ state: "cancelled" });
  });
  it("defers quiet hours without cancelling the queued message", async () => {
    const m = await setupMember();
    await reserve(m.memberId, m.experimentId);
    await role("postgres");
    const zone = (
      await db.query<{ timezone: string }>(
        "select timezone from public.organizations where id=$1",
        [orgA],
      )
    ).rows[0]!.timezone;
    await db.query(
      "update public.organizations set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=2 limit 1) where id=$1",
      [orgA],
    );
    expect(await claim()).toEqual([]);
    await role("postgres");
    expect(
      (await db.query("select state from public.engagement_assignments"))
        .rows[0],
    ).toEqual({ state: "queued" });
    await db.query("update public.organizations set timezone=$1 where id=$2", [
      zone,
      orgA,
    ]);
    expect(await claim()).toHaveLength(1);
  });
  it("never retries an expired in-flight request", async () => {
    const m = await setupMember();
    await reserve(m.memberId, m.experimentId);
    const j = (await claim())[0]!;
    await role("postgres");
    await db.query(
      "update public.engagement_assignments set attempted_at=now()-interval '3 minutes' where id=$1",
      [j.id],
    );
    expect(await claim()).toEqual([]);
    expect(await finish(j.id, j.leaseToken, "accepted")).toBe(false);
    await role("authenticated");
    expect(
      (await db.query("select state from public.engagement_assignments"))
        .rows[0],
    ).toEqual({ state: "unknown" });
    expect(
      (
        await db.query(
          "select kind from public.engagement_events where kind='send_unknown'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("learns from a recorded purchase after an accepted send and completed window", async () => {
    const m = await setupMember();
    await reserve(m.memberId, m.experimentId);
    const j = (await claim())[0]!;
    await finish(j.id, j.leaseToken, "accepted");
    await mature(j.id);
    await historicalPurchase(m.memberId);
    await role("authenticated");
    const { rows } = await db.query<{
      value: {
        experiments: Array<{
          arms: Array<{ id: string; wins: number; losses: number }>;
        }>;
      };
    }>("select public.rpc_engagement_context($1,20) as value", [orgA]);
    expect(
      rows[0]!.value.experiments[0]!.arms.find(
        (a) => a.id === "one_visit_away_a",
      ),
    ).toEqual({ id: "one_visit_away_a", wins: 1, losses: 0 });
  });
  it("excludes ambiguous sends from learning while retaining assignment outcomes", async () => {
    const m = await setupMember();
    await reserve(m.memberId, m.experimentId);
    const j = (await claim())[0]!;
    await finish(j.id, j.leaseToken, "unknown");
    await mature(j.id);
    await historicalPurchase(m.memberId);
    await role("authenticated");
    const { rows } = await db.query<{
      value: {
        experiments: Array<{ arms: Array<{ wins: number; losses: number }> }>;
      };
    }>("select public.rpc_engagement_context($1,20) as value", [orgA]);
    expect(
      rows[0]!.value.experiments[0]!.arms.every(
        (a) => a.wins === 0 && a.losses === 0,
      ),
    ).toBe(true);
    expect(
      (
        await db.query(
          "select converted_at,converted_after_accept_at from public.engagement_assignments",
        )
      ).rows[0],
    ).toMatchObject({
      converted_at: expect.any(Date),
      converted_after_accept_at: null,
    });
  });
  it("leaves Google reviews outside its learned outcomes", async () => {
    await setupMember();
    const { rows } = await db.query<{
      value: { experiments: unknown[]; eventCounts: Record<string, number> };
    }>("select public.rpc_engagement_experiment_report($1) as value", [orgA]);
    expect(rows[0]!.value.experiments).toHaveLength(1);
    expect(rows[0]!.value.eventCounts).toEqual({ enrolled: 1 });
    await role("authenticated", ownerB);
    await reject(
      "select public.rpc_engagement_experiment_report($1)",
      [orgA],
      "not_found_or_forbidden",
    );
    expect(
      (
        await db.query(
          "select public.rpc_engagement_experiment_report($1) as value",
          [orgB],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("runs preparation, HTTP delivery receipts, purchase tracking, and learning together", async () => {
    const m = await setupMember();
    vi.stubEnv(
      "ENGAGEMENT_DELIVERY_WEBHOOK_URL",
      "https://delivery.example.test/messages",
    );
    vi.stubEnv("ENGAGEMENT_DELIVERY_WEBHOOK_SECRET", "test-".repeat(12));
    const send = vi.fn(async () =>
      Response.json({ accepted: true, reference: "gateway-test-receipt" }),
    );
    vi.stubGlobal("fetch", send);
    const adapter = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (!/^rpc_[a-z_]+$/.test(name)) throw new Error("Invalid fixture RPC");
        const entries = Object.entries(args);
        const expressions = entries.map(
          ([key, value], i) =>
            `${key} => ${Array.isArray(value) ? `ARRAY(SELECT jsonb_array_elements_text($${i + 1}::jsonb))` : `$${i + 1}`}`,
        );
        try {
          const result = await db.query<{ value: unknown }>(
            `select public.${name}(${expressions.join(",")}) as value`,
            entries.map(([, value]) =>
              typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : value,
            ),
          );
          return { data: result.rows[0]!.value, error: null };
        } catch (error) {
          return {
            data: null,
            error: {
              message:
                error instanceof Error ? error.message : "Fixture query failed",
            },
          };
        }
      },
    } as unknown as SupabaseClient;
    const providers = deliveryProviders();
    await role("authenticated");
    expect(
      (await prepareEngagement(adapter, orgA, false, providers)).queued,
    ).toBe(1);
    await role("service_role");
    expect(await dispatchEngagement(providers, adapter)).toMatchObject({
      accepted: 1,
      unknown: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    await role("postgres");
    const assignment = (
      await db.query<{ id: string }>(
        "select id from public.engagement_assignments",
      )
    ).rows[0]!;
    await mature(assignment.id);
    await historicalPurchase(m.memberId);
    await role("authenticated");
    const { rows } = await db.query<{
      value: { experiments: Array<{ arms: Array<{ wins: number }> }> };
    }>("select public.rpc_engagement_context($1,20) as value", [orgA]);
    expect(
      rows[0]!.value.experiments[0]!.arms.reduce((n, a) => n + a.wins, 0),
    ).toBe(1);
  });
});
