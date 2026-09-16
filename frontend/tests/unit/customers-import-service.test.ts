import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.CUSTOMER_NOTE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
});

const load = () => import("@/lib/server/customers/import-service");
const loadCsv = () => import("@/lib/server/customers/csv");
import type { SupabaseClient } from "@supabase/supabase-js";

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A minimal in-memory stand-in for the Supabase client's `rpc` + `from`. Only
 * the RPC calls the import service actually makes and the two tables the
 * replay path reads back. `runtime` toggles let a test simulate an RPC error
 * or a job that already `existed`.
 */
interface FakeState {
  calls: RpcCall[];
  jobId: string;
  customersByPhone: Map<string, string>;
  nextCustomerId: number;
  // Backing store for replay: per-job stored counts + rows.
  jobs: Map<string, {
    total_rows: number;
    imported_count: number;
    matched_count: number;
    duplicate_count: number;
    invalid_count: number;
    skipped_count: number;
    unknown_consent_count: number;
  }>;
  jobRows: Map<string, Array<{
    row_number: number;
    action: string;
    matched_customer_id: string | null;
    external_id: string | null;
    error: string | null;
  }>>;
  // Set by tests to make `rpc_customer_import_begin` report an existing job.
  existedForKey: Set<string>;
  // Phone hashes with a recorded consent state for this org.
  knownConsentHashes: Set<string>;
  // Tests set these to make specific RPCs error out.
  failRpc: Set<string>;
}

function makeClient(state: FakeState): SupabaseClient {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (state.failRpc.has(name)) return { data: null, error: { message: name + " failed" } };
    if (name === "rpc_customer_import_begin") {
      const key = String(args.p_idempotency_key);
      const existed = state.existedForKey.has(key);
      return { data: [{ job_id: state.jobId, existed, status: existed ? "succeeded" : "running" }], error: null };
    }
    if (name === "rpc_customer_import_finish") {
      const jid = String(args.p_job_id);
      state.jobs.set(jid, {
        total_rows: Number(args.p_total ?? 0),
        imported_count: Number(args.p_imported ?? 0),
        matched_count: Number(args.p_matched ?? 0),
        duplicate_count: Number(args.p_duplicate ?? 0),
        invalid_count: Number(args.p_invalid ?? 0),
        skipped_count: Number(args.p_skipped ?? 0),
        unknown_consent_count: Number(args.p_unknown_consent ?? 0),
      });
      return { data: null, error: null };
    }
    if (name === "rpc_customer_import_record_row") {
      const jid = String(args.p_job_id);
      const list = state.jobRows.get(jid) ?? [];
      list.push({
        row_number: Number(args.p_row_number),
        action: String(args.p_action),
        matched_customer_id: (args.p_matched_customer_id as string | null) ?? null,
        external_id: (args.p_external_id as string | null) ?? null,
        error: (args.p_error as string | null) ?? null,
      });
      state.jobRows.set(jid, list);
      return { data: null, error: null };
    }
    if (name === "rpc_customer_upsert_by_phone") {
      const key = `${args.p_org_id}|${args.p_phone_hash}`;
      const existing = state.customersByPhone.get(key);
      if (existing) return { data: [{ customer_id: existing, matched: true }], error: null };
      const id = `c-${state.nextCustomerId++}`;
      state.customersByPhone.set(key, id);
      return { data: [{ customer_id: id, matched: false }], error: null };
    }
    if (name === "rpc_customer_count_known_consent") {
      const hashes = (args.p_phone_hashes as string[]) ?? [];
      let known = 0;
      for (const h of hashes) if (state.knownConsentHashes.has(h)) known += 1;
      return { data: known, error: null };
    }
    return { data: null, error: null };
  };

  const from = <T>(table: string) => {
    let jobId: string | null = null;
    // Chainable stub that captures the last `eq("id"/"job_id", …)` filter.
    const builder = {
      select() { return builder; },
      eq(col: string, value: unknown) {
        if (col === "id" || col === "job_id") jobId = String(value);
        return builder;
      },
      order() { return builder; },
      maybeSingle: async () => {
        if (table === "customer_import_jobs" && jobId) {
          const row = state.jobs.get(jobId) ?? null;
          return { data: row as T | null, error: null };
        }
        return { data: null as T | null, error: null };
      },
      then: async <R,>(onFulfilled: (r: { data: T[] | null; error: unknown }) => R): Promise<R> => {
        if (table === "customer_import_rows" && jobId) {
          const rows = state.jobRows.get(jobId) ?? [];
          return onFulfilled({ data: rows as T[], error: null });
        }
        return onFulfilled({ data: [] as T[], error: null });
      },
    };
    return builder;
  };

  return { rpc, from } as unknown as SupabaseClient;
}

function newState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    calls: [],
    jobId: "job-1",
    customersByPhone: new Map(),
    nextCustomerId: 1,
    jobs: new Map(),
    jobRows: new Map(),
    existedForKey: new Set(),
    knownConsentHashes: new Set(),
    failRpc: new Set(),
    ...overrides,
  };
}

const OPTIONS = {
  orgId: "7c000000-0000-0000-0000-0000000000a1",
  actorUserId: null,
  sourceKind: "csv" as const,
  sourceConnectionId: null,
  idempotencyKey: "req-import-abc123",
  dryRun: false,
};

describe("customer import service — pipeline", () => {
  it("imports a two-row CSV, hashes phones, and records per-row outcomes", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\nBob,+15551230002\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });

    const state = newState();
    const result = await runCustomerImport(makeClient(state), adapter, OPTIONS);

    expect(result.replayed).toBe(false);
    expect(result.status).toBe("succeeded");
    expect(result.counts.total).toBe(2);
    expect(result.counts.imported).toBe(2);
    expect(result.counts.unknownConsent).toBe(2); // no consent state → all touched phones unknown
    // Every RPC upsert used a hashed phone; raw values never crossed the wire.
    const upserts = state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone");
    expect(upserts).toHaveLength(2);
    for (const c of upserts) {
      expect(JSON.stringify(c.args)).not.toContain("+15551230001");
      expect(JSON.stringify(c.args)).not.toContain("+15551230002");
    }
  });

  it("counts unknown consent HONESTLY against sms_consent_state, not as a blanket upper bound", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const { toStoredCustomerPhone } = await import("@/lib/server/customers/normalize");
    // Alice's phone hash matches the DB's "already-opted-in" row.
    const aliceHash = toStoredCustomerPhone("+15551230001").phoneHash;

    const body = "First,Cell\nAlice,+15551230001\nBob,+15551230002\n";
    const state = newState({ knownConsentHashes: new Set([aliceHash]) });
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });
    const result = await runCustomerImport(makeClient(state), adapter, OPTIONS);

    // 2 touched, 1 known → 1 unknown, not 2.
    expect(result.counts.unknownConsent).toBe(1);
    // And we actually asked the DB for the count.
    expect(state.calls.some((c) => c.name === "rpc_customer_count_known_consent")).toBe(true);
  });

  it("REPLAYS a finished job on retry (same idempotencyKey) instead of re-executing", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\n";
    const adapter = () => new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });

    const state = newState();
    const client = makeClient(state);

    // First run: normal import.
    const first = await runCustomerImport(client, adapter(), OPTIONS);
    expect(first.replayed).toBe(false);
    expect(first.counts.imported).toBe(1);
    const upsertsAfterFirst = state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone").length;

    // Retry: the fake reports the job existed and is `succeeded`. The service
    // must NOT call the upsert / row-record / finish RPCs again — it reads
    // the stored counts and per-row outcomes and returns them.
    state.existedForKey.add(OPTIONS.idempotencyKey);
    const second = await runCustomerImport(client, adapter(), OPTIONS);

    expect(second.replayed).toBe(true);
    expect(second.status).toBe("succeeded");
    expect(second.counts.imported).toBe(1);
    expect(second.rows).toHaveLength(1);
    // No additional writes on the retry — this is the whole point.
    expect(state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone").length).toBe(upsertsAfterFirst);
    expect(state.calls.filter((c) => c.name === "rpc_customer_import_finish").length).toBe(1);
  });

  it("finalises the job as failed when an RPC fails, so a retry doesn't see a stale 'running' row", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });
    const state = newState({ failRpc: new Set(["rpc_customer_upsert_by_phone"]) });
    // The upsert failure lands as an "invalid" row outcome (not a throw), so
    // let's fail record_row instead to hit the throw path — that's the code
    // route the reviewer flagged.
    state.failRpc = new Set(["rpc_customer_import_record_row"]);

    await expect(runCustomerImport(makeClient(state), adapter, OPTIONS)).rejects.toThrow();
    // The finish call must have run WITH an error string so status becomes
    // failed — never left running.
    const finish = state.calls.find((c) => c.name === "rpc_customer_import_finish");
    expect(finish).toBeTruthy();
    expect(finish!.args.p_error).toBeTruthy();
  });

  it("propagates adapter parse errors WITHOUT opening a job row", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter, CsvParseError } = await loadCsv();
    // A CSV with an unterminated quoted cell fails at parse time.
    const adapter = new CsvCustomerSourceAdapter('name,phone\n"unterminated', { phone: "phone" });
    const state = newState();
    await expect(runCustomerImport(makeClient(state), adapter, OPTIONS)).rejects.toBeInstanceOf(CsvParseError);
    // No begin RPC was called — the pipeline parses BEFORE opening a job.
    expect(state.calls.some((c) => c.name === "rpc_customer_import_begin")).toBe(false);
  });

  it("writes a customer_visits row when the source supplies observedAt", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell,POS,When\nAlice,+15551230001,pos-1,2026-05-01T10:00:00Z\n";
    const adapter = new CsvCustomerSourceAdapter(body, {
      displayName: "First", phone: "Cell", externalId: "POS", observedAt: "When",
    });
    const state = newState();
    await runCustomerImport(makeClient(state), adapter, OPTIONS);

    const visit = state.calls.find((c) => c.name === "rpc_customer_visit_upsert");
    expect(visit).toBeTruthy();
    expect(visit!.args.p_external_id).toBe("pos-1");
    expect(String(visit!.args.p_occurred_at)).toContain("2026-05-01");
  });

  it("marks a within-batch phone repeat as duplicate, not a second insert", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\nAlice again,+15551230001\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });
    const state = newState();
    const result = await runCustomerImport(makeClient(state), adapter, OPTIONS);
    expect(result.counts.imported).toBe(1);
    expect(result.counts.duplicate).toBe(1);
    expect(state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone")).toHaveLength(1);
  });

  it("reports invalid rows with a per-row message and does not stop the batch", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,not-a-phone\nBob,+15551230002\nCarol,\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });
    const state = newState();
    const result = await runCustomerImport(makeClient(state), adapter, OPTIONS);
    expect(result.counts.total).toBe(3);
    expect(result.counts.imported).toBe(1);
    expect(result.counts.invalid).toBe(2);
  });

  it("dry-run touches no writers and reports outcomes as 'skipped'", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });
    const state = newState();
    const result = await runCustomerImport(makeClient(state), adapter, { ...OPTIONS, dryRun: true });
    expect(result.counts.skipped).toBe(1);
    expect(state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone")).toHaveLength(0);
    expect(state.calls.filter((c) => c.name === "rpc_customer_import_record_row")).toHaveLength(0);
  });

  it("passes external_id through to the link RPC when the source provides one", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell,POS\nAlice,+15551230001,pos-42\n";
    const adapter = new CsvCustomerSourceAdapter(body, {
      displayName: "First", phone: "Cell", externalId: "POS",
    });
    const state = newState();
    await runCustomerImport(makeClient(state), adapter, OPTIONS);
    const link = state.calls.find((c) => c.name === "rpc_customer_external_link");
    expect(link).toBeTruthy();
    expect((link!.args as Record<string, unknown>).p_external_id).toBe("pos-42");
  });
});
