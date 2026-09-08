import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();

vi.mock("@/lib/server/supabase", () => ({
  serviceRoleClient: () => ({ rpc }),
}));

vi.mock("@/lib/server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const load = () => import("@/lib/server/rate-limit");

const BUDGET = { bucket: "sms_schedule", limit: 60, windowSeconds: 60 };

beforeEach(() => {
  rpc.mockReset();
});

describe("consumeRateLimit — fail closed", () => {
  it("resolves when the store allows the request", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 1 }], error: null });
    const { consumeRateLimit } = await load();
    await expect(consumeRateLimit(BUDGET, "org-1", "req-1")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("rpc_consume_rate_limit", {
      p_bucket: "sms_schedule",
      p_bucket_key: "org-1",
      p_limit: 60,
      p_window_seconds: 60,
    });
  });

  it("returns 429 when the budget is exhausted", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 17 }], error: null });
    const { consumeRateLimit } = await load();
    await expect(consumeRateLimit(BUDGET, "org-1", "req-1")).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      headers: { "Retry-After": "17" },
    });
  });

  it("fails closed (503) when the store is unreachable", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const { consumeRateLimit } = await load();
    await expect(consumeRateLimit(BUDGET, "org-1", "req-1")).rejects.toMatchObject({
      status: 503,
      code: "service_unavailable",
    });
  });

  it("fails closed (503) on an empty decision — never an empty allow", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { consumeRateLimit } = await load();
    await expect(consumeRateLimit(BUDGET, "org-1", "req-1")).rejects.toMatchObject({
      status: 503,
      code: "service_unavailable",
    });
  });

  it("fails closed (503) on a malformed decision without allowed", async () => {
    rpc.mockResolvedValue({ data: [{ retry_after_seconds: 1 }], error: null });
    const { consumeRateLimit } = await load();
    await expect(consumeRateLimit(BUDGET, "org-1", "req-1")).rejects.toMatchObject({
      status: 503,
      code: "service_unavailable",
    });
  });

  it("fails closed (503) on a bare object — table RPCs must return an array", async () => {
    rpc.mockResolvedValue({ data: { allowed: true, retry_after_seconds: 1 }, error: null });
    const { consumeRateLimit } = await load();
    await expect(consumeRateLimit(BUDGET, "org-1", "req-1")).rejects.toMatchObject({
      status: 503,
      code: "service_unavailable",
    });
  });
});
