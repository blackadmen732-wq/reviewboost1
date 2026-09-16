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

interface FakeState {
  calls: RpcCall[];
  jobId: string;
  // (org, phoneHash) → customer id, so a re-imported phone reports matched=true.
  customersByPhone: Map<string, string>;
  nextCustomerId: number;
}

function makeClient(state: FakeState): SupabaseClient {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (name === "rpc_customer_import_begin") return { data: state.jobId, error: null };
    if (name === "rpc_customer_upsert_by_phone") {
      const key = `${args.p_org_id}|${args.p_phone_hash}`;
      const existing = state.customersByPhone.get(key);
      if (existing) return { data: [{ customer_id: existing, matched: true }], error: null };
      const id = `c-${state.nextCustomerId++}`;
      state.customersByPhone.set(key, id);
      return { data: [{ customer_id: id, matched: false }], error: null };
    }
    return { data: null, error: null };
  };
  return { rpc } as unknown as SupabaseClient;
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

    const state: FakeState = { calls: [], jobId: "job-1", customersByPhone: new Map(), nextCustomerId: 1 };
    const result = await runCustomerImport(makeClient(state), adapter, OPTIONS);

    expect(result.jobId).toBe("job-1");
    expect(result.counts.total).toBe(2);
    expect(result.counts.imported).toBe(2);
    expect(result.counts.matched).toBe(0);
    expect(result.counts.duplicate).toBe(0);
    expect(result.counts.invalid).toBe(0);
    expect(result.counts.unknownConsent).toBe(2); // no consent state minted for new customers
    // Per-row outcomes have the row numbers from the CSV (data starts at row 2).
    expect(result.rows.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(result.rows[0]!.action).toBe("imported");
    // The pipeline never handed the raw phone to any RPC.
    const upserts = state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone");
    expect(upserts).toHaveLength(2);
    for (const c of upserts) {
      const args = c.args as Record<string, string>;
      expect(args.p_phone_hash).toMatch(/^[0-9a-f]{32,}$/);
      expect(JSON.stringify(c.args)).not.toContain("+15551230001");
      expect(JSON.stringify(c.args)).not.toContain("+15551230002");
    }
  });

  it("marks a within-batch phone repeat as duplicate, not a second insert", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\nAlice again,+15551230001\nBob,+15551230002\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });

    const state: FakeState = { calls: [], jobId: "job-2", customersByPhone: new Map(), nextCustomerId: 1 };
    const result = await runCustomerImport(makeClient(state), adapter, OPTIONS);

    expect(result.counts.imported).toBe(2);
    expect(result.counts.duplicate).toBe(1);
    expect(result.counts.invalid).toBe(0);
    // Only two upsert RPCs — the duplicate never reached the DB.
    expect(state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone")).toHaveLength(2);
    const dup = result.rows.find((r) => r.action === "duplicate");
    expect(dup?.error).toMatch(/duplicate of row/i);
  });

  it("reports invalid rows with a per-row message and does not stop the batch", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,not-a-phone\nBob,+15551230002\nCarol,\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });

    const state: FakeState = { calls: [], jobId: "job-3", customersByPhone: new Map(), nextCustomerId: 1 };
    const result = await runCustomerImport(makeClient(state), adapter, OPTIONS);

    expect(result.counts.total).toBe(3);
    expect(result.counts.imported).toBe(1);
    expect(result.counts.invalid).toBe(2);
    const invalids = result.rows.filter((r) => r.action === "invalid");
    expect(invalids).toHaveLength(2);
    expect(invalids[0]!.error).toMatch(/phone/i);
  });

  it("dry-run touches no writers and reports outcomes as 'skipped'", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\n";
    const adapter = new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });

    const state: FakeState = { calls: [], jobId: "job-4", customersByPhone: new Map(), nextCustomerId: 1 };
    const result = await runCustomerImport(makeClient(state), adapter, { ...OPTIONS, dryRun: true });

    expect(result.counts.skipped).toBe(1);
    expect(state.calls.filter((c) => c.name === "rpc_customer_upsert_by_phone")).toHaveLength(0);
    expect(state.calls.filter((c) => c.name === "rpc_customer_import_record_row")).toHaveLength(0);
  });

  it("a retried import with the same idempotency key reuses the job row and reports matched (not duplicate imports)", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell\nAlice,+15551230001\n";
    const adapter = () =>
      new CsvCustomerSourceAdapter(body, { displayName: "First", phone: "Cell" });

    const state: FakeState = { calls: [], jobId: "job-5", customersByPhone: new Map(), nextCustomerId: 1 };
    const client = makeClient(state);
    const first = await runCustomerImport(client, adapter(), OPTIONS);
    const second = await runCustomerImport(client, adapter(), OPTIONS);

    // Same job id both times (the fake rpc_customer_import_begin returns the
    // shared state.jobId — matching the definer's on-conflict-do-nothing).
    expect(first.jobId).toBe(second.jobId);
    expect(second.counts.imported).toBe(0);
    expect(second.counts.matched).toBe(1);
  });

  it("passes external_id through to the link RPC when the source provides one", async () => {
    const { runCustomerImport } = await load();
    const { CsvCustomerSourceAdapter } = await loadCsv();
    const body = "First,Cell,POS\nAlice,+15551230001,pos-42\n";
    const adapter = new CsvCustomerSourceAdapter(body, {
      displayName: "First", phone: "Cell", externalId: "POS",
    });

    const state: FakeState = { calls: [], jobId: "job-6", customersByPhone: new Map(), nextCustomerId: 1 };
    await runCustomerImport(makeClient(state), adapter, OPTIONS);
    const link = state.calls.find((c) => c.name === "rpc_customer_external_link");
    expect(link).toBeTruthy();
    expect((link!.args as Record<string, unknown>).p_external_id).toBe("pos-42");
  });
});
